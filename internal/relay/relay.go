package relay

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/bestruirui/octopus/internal/helper"
	dbmodel "github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/relay/balancer"
	"github.com/bestruirui/octopus/internal/server/resp"
	"github.com/bestruirui/octopus/internal/transformer/inbound"
	"github.com/bestruirui/octopus/internal/transformer/model"
	"github.com/bestruirui/octopus/internal/transformer/outbound"
	"github.com/bestruirui/octopus/internal/utils/log"
	"github.com/gin-gonic/gin"
	"github.com/tmaxmax/go-sse"
)

var loggedStopCodes sync.Map

// getStopCodes 获取停止码配置
func getStopCodes() []int {
	val, err := op.SettingGetString(dbmodel.SettingKeyStopCodes)
	if err != nil || val == "" {
		codes := []int{400, 422}
		logConfiguredStopCodes(codes)
		return codes
	}
	var codes []int
	for _, s := range strings.Split(val, ",") {
		s = strings.TrimSpace(s)
		if code, err := strconv.Atoi(s); err == nil && code >= 100 && code <= 599 {
			codes = append(codes, code)
		}
	}
	if len(codes) == 0 {
		codes = []int{400, 422}
		logConfiguredStopCodes(codes)
		return codes
	}
	logConfiguredStopCodes(codes)
	return codes
}

func logConfiguredStopCodes(codes []int) {
	key := fmt.Sprint(codes)
	if _, loaded := loggedStopCodes.LoadOrStore(key, struct{}{}); loaded {
		return
	}
	log.Infof("configured stop codes: %v", codes)
	for _, code := range codes {
		if code != 400 && code != 422 {
			log.Warnf("non-typical stop code configured: %d; this will stop key failover without recording circuit failure", code)
		}
	}
}

// isStopCode 判断是否为停止码
func isStopCode(statusCode int, stopCodes []int) bool {
	return slices.Contains(stopCodes, statusCode)
}

// shouldRecordCircuitFailure 判断失败是否应计入熔断。
// - 停止码 (400/422): 不计入，请求格式问题不是 key 故障
// - 上游 429: 不计入，临时限流不应污染熔断状态
// - 5xx/timeout/network: 计入，真实故障应触发熔断保护
func shouldRecordCircuitFailure(statusCode int, stopCodes []int) bool {
	if statusCode <= 0 {
		return true
	}
	if statusCode == 429 {
		return false
	}
	return !isStopCode(statusCode, stopCodes)
}

type channelExhaustionSummary struct {
	cooldown429Count int
	circuitOpenCount int
	rateLimitedCount int
	concurrencyCount int
	attemptFailed    bool
}

func countEnabledKeys(channel *dbmodel.Channel) int {
	count := 0
	for _, k := range channel.Keys {
		if k.Enabled && k.ChannelKey != "" {
			count++
		}
	}
	return count
}

func summarizeChannelExhaustion(channel *dbmodel.Channel, summary channelExhaustionSummary) string {
	enabledKeys := countEnabledKeys(channel)
	if enabledKeys == 0 {
		return "channel has no enabled key"
	}
	if summary.cooldown429Count == enabledKeys {
		return "all channel keys are in local 429 cooldown"
	}
	if summary.circuitOpenCount == enabledKeys {
		return "all channel keys are circuit-open"
	}
	if summary.rateLimitedCount+summary.concurrencyCount == enabledKeys {
		switch {
		case summary.rateLimitedCount > 0 && summary.concurrencyCount > 0:
			return "all channel keys are blocked by rpm limit or concurrency"
		case summary.rateLimitedCount > 0:
			return "all channel keys are rate limited"
		default:
			return "all channel keys are blocked by concurrency"
		}
	}
	if summary.attemptFailed {
		return "all channel keys failed after attempts"
	}
	return "no available key"
}

// selectNextKey 已删除，key 选择职责归还 Channel.GetChannelKey(excluded ...int)

// Handler 处理入站请求并转发到上游服务
func Handler(inboundType inbound.InboundType, c *gin.Context) {
	// 解析请求
	internalRequest, inAdapter, err := parseRequest(inboundType, c)
	if err != nil {
		return
	}
	supportedModels := c.GetString("supported_models")
	if supportedModels != "" {
		supportedModelsArray := strings.Split(supportedModels, ",")
		if !slices.Contains(supportedModelsArray, internalRequest.Model) {
			resp.Error(c, http.StatusBadRequest, "model not supported")
			return
		}
	}

	requestModel := internalRequest.Model
	apiKeyID := c.GetInt("api_key_id")

	// 获取通道分组
	group, err := op.GroupGetEnabledMap(requestModel, c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusNotFound, "model not found")
		return
	}

	// 创建迭代器（策略排序 + 粘性优先）
	iter := balancer.NewIterator(group, apiKeyID, requestModel)
	if iter.Len() == 0 {
		resp.Error(c, http.StatusServiceUnavailable, "no available channel")
		return
	}

	// 初始化 Metrics
	metrics := NewRelayMetrics(apiKeyID, requestModel, internalRequest)

	// 获取停止码配置
	stopCodes := getStopCodes()

	// 请求级上下文
	req := &relayRequest{
		c:               c,
		inAdapter:       inAdapter,
		internalRequest: internalRequest,
		metrics:         metrics,
		apiKeyID:        apiKeyID,
		requestModel:    requestModel,
		iter:            iter,
		stopCodes:       stopCodes,
	}

	var lastErr error

	for iter.Next() {
		select {
		case <-c.Request.Context().Done():
			log.Infof("request context canceled, stopping retry")
			metrics.Save(c.Request.Context(), false, context.Canceled, iter.Attempts())
			return
		default:
		}

		item := iter.Item()

		// 获取通道
		channel, err := op.ChannelGet(item.ChannelID, c.Request.Context())
		if err != nil {
			log.Warnf("failed to get channel %d: %v", item.ChannelID, err)
			iter.Skip(item.ChannelID, 0, "", fmt.Sprintf("channel_%d", item.ChannelID), fmt.Sprintf("channel not found: %v", err), dbmodel.SkipReasonNoKey)
			lastErr = err
			continue
		}
		if !channel.Enabled {
			iter.Skip(channel.ID, 0, "", channel.Name, "channel disabled", dbmodel.SkipReasonDisabled)
			continue
		}

		// 出站适配器
		outAdapter := outbound.Get(channel.Type)
		if outAdapter == nil {
			iter.Skip(channel.ID, 0, "", channel.Name, fmt.Sprintf("unsupported channel type: %d", channel.Type), dbmodel.SkipReasonDisabled)
			continue
		}

		// 类型兼容性检查
		if internalRequest.IsEmbeddingRequest() && !outbound.IsEmbeddingChannelType(channel.Type) {
			iter.Skip(channel.ID, 0, "", channel.Name, "channel type not compatible with embedding request", dbmodel.SkipReasonDisabled)
			continue
		}
		if internalRequest.IsChatRequest() && !outbound.IsChatChannelType(channel.Type) {
			iter.Skip(channel.ID, 0, "", channel.Name, "channel type not compatible with chat request", dbmodel.SkipReasonDisabled)
			continue
		}

		// 设置实际模型
		internalRequest.Model = item.ModelName

		log.Infof("request model %s, mode: %d, forwarding to channel: %s model: %s (attempt %d/%d, sticky=%t)",
			requestModel, group.Mode, channel.Name, item.ModelName,
			iter.Index()+1, iter.Len(), iter.IsSticky())

		// ====== Key 轮换循环 ======
		// 同一渠道内尽量把仍可用的 key 试完，再切换到下一个渠道。
		attemptedKeyIDs := make([]int, 0, len(channel.Keys))
		keyFailoverDone := false
		exhaustionSummary := channelExhaustionSummary{}

		for !keyFailoverDone {
			// 选 key（排除已尝试的 key）—— 职责在 Channel
			usedKey := channel.GetChannelKey(attemptedKeyIDs...)
			if usedKey.ChannelKey == "" {
				msg := summarizeChannelExhaustion(channel, exhaustionSummary)
				iter.Skip(channel.ID, 0, "", channel.Name, msg, dbmodel.SkipReasonNoKey)
				lastErr = fmt.Errorf("channel %s %s", channel.Name, msg)
				break
			}

			// 熔断检查（key 维度）—— 委托 balancer
			if iter.SkipCircuitBreak(channel.ID, usedKey.ID, usedKey.Remark, channel.Name) {
				exhaustionSummary.circuitOpenCount++
				attemptedKeyIDs = append(attemptedKeyIDs, usedKey.ID)
				continue
			}

			// 并发 + RPM 统一获取 —— 委托 balancer
			acquired, release := balancer.TryAcquireKeySlot(usedKey.ID, usedKey.ConcurrencyLimit, usedKey.RpmLimit)
			if !acquired {
				// 区分并发满还是 RPM 超限
				if usedKey.ConcurrencyLimit > 0 {
					exhaustionSummary.concurrencyCount++
					iter.Skip(channel.ID, usedKey.ID, usedKey.Remark, channel.Name, "key concurrency full", dbmodel.SkipReasonConcurrency)
				} else {
					exhaustionSummary.rateLimitedCount++
					iter.Skip(channel.ID, usedKey.ID, usedKey.Remark, channel.Name, "key rpm limited", dbmodel.SkipReasonRateLimited)
				}
				attemptedKeyIDs = append(attemptedKeyIDs, usedKey.ID)
				continue
			}

			// 执行请求
			ra := &relayAttempt{
				relayRequest:        req,
				outAdapter:          outAdapter,
				channel:             channel,
				usedKey:             &usedKey,
				firstTokenTimeOutSec: group.FirstTokenTimeOut,
			}

			result := ra.attempt()
			release() // 释放并发槽

			if result.Success {
				metrics.Save(c.Request.Context(), true, nil, iter.Attempts())
				return
			}
			if result.Written {
				metrics.Save(c.Request.Context(), false, result.Err, iter.Attempts())
				return
			}

			// 停止码：终止当前渠道内的 key 轮换
			if result.StatusCode > 0 && isStopCode(result.StatusCode, stopCodes) {
				log.Warnf("stop code %d matched for channel %s key %d; stopping key failover", result.StatusCode, channel.Name, usedKey.ID)
				lastErr = result.Err
				keyFailoverDone = true
				break
			}

			exhaustionSummary.attemptFailed = true
			attemptedKeyIDs = append(attemptedKeyIDs, usedKey.ID)
			lastErr = result.Err
		}
	}

	// 所有通道都失败
	metrics.Save(c.Request.Context(), false, lastErr, iter.Attempts())
	resp.Error(c, http.StatusBadGateway, "all channels failed")
}

// attempt 统一管理一次通道尝试的完整生命周期
func (ra *relayAttempt) attempt() attemptResult {
	span := ra.iter.StartAttempt(ra.channel.ID, ra.usedKey.ID, ra.usedKey.Remark, ra.channel.Name)

	// 转发请求
	statusCode, fwdErr := ra.forward()

	// 更新 channel key 状态
	ra.usedKey.StatusCode = statusCode
	ra.usedKey.LastUseTimeStamp = time.Now().Unix()

	if fwdErr == nil {
		// ====== 成功 ======
		ra.collectResponse()
		ra.usedKey.TotalCost += ra.metrics.Stats.InputCost + ra.metrics.Stats.OutputCost
		op.ChannelKeyUpdate(*ra.usedKey)

		span.End(dbmodel.AttemptSuccess, statusCode, "")

		// Channel 维度统计
		op.StatsChannelUpdate(ra.channel.ID, dbmodel.StatsMetrics{
			WaitTime:        span.Duration().Milliseconds(),
			RequestSuccess:  1,
		})

		// 熔断器：记录成功
		balancer.RecordSuccess(ra.channel.ID, ra.usedKey.ID, ra.internalRequest.Model)
		// 会话保持：更新粘性记录
		balancer.SetSticky(ra.apiKeyID, ra.requestModel, ra.channel.ID, ra.usedKey.ID)

		return attemptResult{Success: true, StatusCode: statusCode}
	}

	// ====== 失败 ======
	op.ChannelKeyUpdate(*ra.usedKey)
	span.End(dbmodel.AttemptFailed, statusCode, fwdErr.Error())

	// Channel 维度统计
	op.StatsChannelUpdate(ra.channel.ID, dbmodel.StatsMetrics{
		WaitTime:        span.Duration().Milliseconds(),
		RequestFailed:   1,
	})

	// 熔断器：记录失败
	if shouldRecordCircuitFailure(statusCode, ra.stopCodes) {
		balancer.RecordFailure(ra.channel.ID, ra.usedKey.ID, ra.internalRequest.Model)
	}

	written := ra.c.Writer.Written()
	if written {
		ra.collectResponse()
	}
	return attemptResult{
		Success:    false,
		Written:    written,
		Err:        fmt.Errorf("channel %s key %d failed: %v", ra.channel.Name, ra.usedKey.ID, fwdErr),
		StatusCode: statusCode,
	}
}

// parseRequest 解析并验证入站请求
func parseRequest(inboundType inbound.InboundType, c *gin.Context) (*model.InternalLLMRequest, model.Inbound, error) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return nil, nil, err
	}

	inAdapter := inbound.Get(inboundType)
	internalRequest, err := inAdapter.TransformRequest(c.Request.Context(), body)
	if err != nil {
		resp.Error(c, http.StatusInternalServerError, err.Error())
		return nil, nil, err
	}

	// Pass through the original query parameters
	internalRequest.Query = c.Request.URL.Query()

	if err := internalRequest.Validate(); err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return nil, nil, err
	}

	return internalRequest, inAdapter, nil
}

// forward 转发请求到上游服务
func (ra *relayAttempt) forward() (int, error) {
	ctx := ra.c.Request.Context()

	// 构建出站请求
	outboundRequest, err := ra.outAdapter.TransformRequest(
		ctx,
		ra.internalRequest,
		ra.channel.GetBaseUrl(),
		ra.usedKey.ChannelKey,
	)
	if err != nil {
		log.Warnf("failed to create request: %v", err)
		return 0, fmt.Errorf("failed to create request: %w", err)
	}

	// 复制请求头
	ra.copyHeaders(outboundRequest)

	// 发送请求
	response, err := ra.sendRequest(outboundRequest)
	if err != nil {
		return 0, fmt.Errorf("failed to send request: %w", err)
	}
	defer response.Body.Close()

	// 检查响应状态
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, err := io.ReadAll(io.LimitReader(response.Body, 16*1024))
		if err != nil {
			return response.StatusCode, &UpstreamHTTPError{StatusCode: response.StatusCode}
		}
		return response.StatusCode, &UpstreamHTTPError{StatusCode: response.StatusCode, BodySnippet: string(body)}
	}

	// 处理响应
	if ra.internalRequest.Stream != nil && *ra.internalRequest.Stream {
		if err := ra.handleStreamResponse(ctx, response); err != nil {
			return 0, err
		}
		return response.StatusCode, nil
	}
	if err := ra.handleResponse(ctx, response); err != nil {
		return 0, err
	}
	return response.StatusCode, nil
}

// copyHeaders 复制请求头，过滤 hop-by-hop 头
func (ra *relayAttempt) copyHeaders(outboundRequest *http.Request) {
	for key, values := range ra.c.Request.Header {
		if hopByHopHeaders[strings.ToLower(key)] {
			continue
		}
		for _, value := range values {
			outboundRequest.Header.Set(key, value)
		}
	}
	if len(ra.channel.CustomHeader) > 0 {
		for _, header := range ra.channel.CustomHeader {
			outboundRequest.Header.Set(header.HeaderKey, header.HeaderValue)
		}
	}
}

// sendRequest 发送 HTTP 请求
func (ra *relayAttempt) sendRequest(req *http.Request) (*http.Response, error) {
	httpClient, err := helper.ChannelHttpClient(ra.channel)
	if err != nil {
		log.Warnf("failed to get http client: %v", err)
		return nil, err
	}

	response, err := httpClient.Do(req)
	if err != nil {
		log.Warnf("failed to send request: %v", err)
		return nil, err
	}

	return response, nil
}

// handleStreamResponse 处理流式响应
func (ra *relayAttempt) handleStreamResponse(ctx context.Context, response *http.Response) error {
	if ct := response.Header.Get("Content-Type"); ct != "" && !strings.Contains(strings.ToLower(ct), "text/event-stream") {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 16*1024))
		return fmt.Errorf("upstream returned non-SSE content-type %q for stream request: %s", ct, string(body))
	}

	// 设置 SSE 响应头
	ra.c.Header("Content-Type", "text/event-stream")
	ra.c.Header("Cache-Control", "no-cache")
	ra.c.Header("Connection", "keep-alive")
	ra.c.Header("X-Accel-Buffering", "no")

	firstToken := true

	type sseReadResult struct {
		data string
		err  error
	}
	results := make(chan sseReadResult, 1)
	go func() {
		defer close(results)
		readCfg := &sse.ReadConfig{MaxEventSize: maxSSEEventSize}
		for ev, err := range sse.Read(response.Body, readCfg) {
			if err != nil {
				results <- sseReadResult{err: err}
				return
			}
			results <- sseReadResult{data: ev.Data}
		}
	}()

	var firstTokenTimer *time.Timer
	var firstTokenC <-chan time.Time
	if firstToken && ra.firstTokenTimeOutSec > 0 {
		firstTokenTimer = time.NewTimer(time.Duration(ra.firstTokenTimeOutSec) * time.Second)
		firstTokenC = firstTokenTimer.C
		defer func() {
			if firstTokenTimer != nil {
				firstTokenTimer.Stop()
			}
		}()
	}

	for {
		select {
		case <-ctx.Done():
			log.Infof("client disconnected, stopping stream")
			return nil
		case <-firstTokenC:
			log.Warnf("first token timeout (%ds), switching channel", ra.firstTokenTimeOutSec)
			_ = response.Body.Close()
			return &FirstTokenTimeoutError{Seconds: ra.firstTokenTimeOutSec}
		case r, ok := <-results:
			if !ok {
				log.Infof("stream end")
				return nil
			}
			if r.err != nil {
				log.Warnf("failed to read event: %v", r.err)
				return fmt.Errorf("failed to read stream event: %w", r.err)
			}

			data, err := ra.transformStreamData(ctx, r.data)
			if err != nil || len(data) == 0 {
				continue
			}
			if firstToken {
				ra.metrics.SetFirstTokenTime(time.Now())
				firstToken = false
				if firstTokenTimer != nil {
					if !firstTokenTimer.Stop() {
						select {
						case <-firstTokenTimer.C:
						default:
						}
					}
					firstTokenTimer = nil
					firstTokenC = nil
				}
			}

			ra.c.Writer.Write(data)
			ra.c.Writer.Flush()
		}
	}
}

// transformStreamData 转换流式数据
func (ra *relayAttempt) transformStreamData(ctx context.Context, data string) ([]byte, error) {
	internalStream, err := ra.outAdapter.TransformStream(ctx, []byte(data))
	if err != nil {
		log.Warnf("failed to transform stream: %v", err)
		return nil, err
	}
	if internalStream == nil {
		return nil, nil
	}

	inStream, err := ra.inAdapter.TransformStream(ctx, internalStream)
	if err != nil {
		log.Warnf("failed to transform stream: %v", err)
		return nil, err
	}

	return inStream, nil
}

// handleResponse 处理非流式响应
func (ra *relayAttempt) handleResponse(ctx context.Context, response *http.Response) error {
	internalResponse, err := ra.outAdapter.TransformResponse(ctx, response)
	if err != nil {
		log.Warnf("failed to transform response: %v", err)
		return fmt.Errorf("failed to transform outbound response: %w", err)
	}

	inResponse, err := ra.inAdapter.TransformResponse(ctx, internalResponse)
	if err != nil {
		log.Warnf("failed to transform response: %v", err)
		return fmt.Errorf("failed to transform inbound response: %w", err)
	}

	ra.c.Data(http.StatusOK, "application/json", inResponse)
	return nil
}

// collectResponse 收集响应信息
func (ra *relayAttempt) collectResponse() {
	internalResponse, err := ra.inAdapter.GetInternalResponse(ra.c.Request.Context())
	if err != nil || internalResponse == nil {
		return
	}

	ra.metrics.SetInternalResponse(internalResponse, ra.internalRequest.Model)
}
