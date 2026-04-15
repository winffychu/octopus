package balancer

import (
	"sync"
	"sync/atomic"
	"time"
)

// KeyGate 提供 key 级别的 RPM 与并发限流。
// 设计原则与 circuit.go 一致：
//   - 全局 sync.Map 存储，无全局 Mutex
//   - Try/非阻塞/不等待
//   - RPM 不回滚：一旦消费成功，不因后续失败退回
//   - Release 契约：TryAcquireKeySlot 成功后必须调用返回的 releaseFunc
type KeyGate struct {
	state sync.Map // key: keyID(int) -> value: *keyGateState
}

type keyGateState struct {
	inUse     atomic.Int32 // 当前并发占用数
	windowMin atomic.Int64 // 当前 RPM 计数窗口（Unix 分钟）
	rpmCount  atomic.Int32 // 窗口内已消费请求数
}

var defaultKeyGate = &KeyGate{}

// getOrCreateState 获取或创建 key 的运行时状态
func (g *KeyGate) getOrCreateState(keyID int) *keyGateState {
	st := &keyGateState{}
	actual, _ := g.state.LoadOrStore(keyID, st)
	return actual.(*keyGateState)
}

// TryAcquireKeySlot 尝试获取 key 的并发和 RPM 额度。
// 返回 (acquired bool, releaseFunc func())。
// acquired=true 时必须调用 releaseFunc 释放并发槽。
// 顺序：先并发后 RPM，避免 RPM 消费后并发失败导致无效消耗。
func TryAcquireKeySlot(keyID, concurrencyLimit, rpmLimit int) (acquired bool, releaseFunc func()) {
	st := defaultKeyGate.getOrCreateState(keyID)

	// 1. 并发检查
	if concurrencyLimit > 0 {
		n := st.inUse.Add(1)
		if n > int32(concurrencyLimit) {
			st.inUse.Add(-1)
			return false, nil
		}
	}

	// 2. RPM 检查
	if rpmLimit > 0 {
		nowMin := time.Now().Unix() / 60
		prev := st.windowMin.Load()
		if prev != nowMin {
			st.windowMin.Store(nowMin)
			st.rpmCount.Store(0)
		}
		n := st.rpmCount.Add(1)
		if n > int32(rpmLimit) {
			// RPM 超限，回退并发占用
			st.rpmCount.Add(-1)
			if concurrencyLimit > 0 {
				st.inUse.Add(-1)
			}
			return false, nil
		}
	}

	return true, func() {
		if concurrencyLimit > 0 {
			st.inUse.Add(-1)
		}
	}
}
