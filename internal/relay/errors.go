package relay

import "fmt"

// UpstreamHTTPError 表示上游返回了非 2xx 的 HTTP 响应
// 必须携带 StatusCode，供错误分类/策略判断/429 冷却使用
type UpstreamHTTPError struct {
	StatusCode int
	BodySnippet string
}

func (e *UpstreamHTTPError) Error() string {
	if e == nil {
		return "upstream http error"
	}
	if e.BodySnippet == "" {
		return fmt.Sprintf("upstream http error: %d", e.StatusCode)
	}
	return fmt.Sprintf("upstream http error: %d: %s", e.StatusCode, e.BodySnippet)
}

// FirstTokenTimeoutError 表示流式请求在约定的时间内没有收到首个 token
// 必须使用强类型错误，避免通过字符串匹配判断
type FirstTokenTimeoutError struct {
	Seconds int
}

func (e *FirstTokenTimeoutError) Error() string {
	if e == nil {
		return "first token timeout"
	}
	return fmt.Sprintf("first token timeout (%ds)", e.Seconds)
}