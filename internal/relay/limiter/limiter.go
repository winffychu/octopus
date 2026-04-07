package limiter

import (
	"sync"
	"sync/atomic"
	"time"
)

// KeyLimiter 提供 key 级别的并发与 RPM 限流
// 设计原则：
// 1. Try/非阻塞/不等待：获取不到额度就立即返回 false，由上层决定 skip 并尝试其它 key/渠道
// 2. RPM 不回滚：一旦 TryConsumeRPM 成功，不因后续失败退回
// 3. Release 契约：TryAcquireConcurrency 成功后必须 ReleaseConcurrency；建议调用方使用 defer
type KeyLimiter struct {
	mu sync.Mutex
	m  map[int]*keyState
}

type keyState struct {
	inUse         atomic.Int32
	windowMinute  atomic.Int64
	count         atomic.Int32
}

func New() *KeyLimiter {
	return &KeyLimiter{m: make(map[int]*keyState)}
}

func (l *KeyLimiter) get(keyID int) *keyState {
	l.mu.Lock()
	defer l.mu.Unlock()
	st := l.m[keyID]
	if st == nil {
		st = &keyState{}
		l.m[keyID] = st
	}
	return st
}

// TryAcquireConcurrency 尝试占用并发额度
func (l *KeyLimiter) TryAcquireConcurrency(keyID int, limit int) bool {
	if limit <= 0 {
		return true
	}
	st := l.get(keyID)
	n := st.inUse.Add(1)
	if n > int32(limit) {
		st.inUse.Add(-1)
		return false
	}
	return true
}

// ReleaseConcurrency 释放并发额度
func (l *KeyLimiter) ReleaseConcurrency(keyID int) {
	st := l.get(keyID)
	st.inUse.Add(-1)
}

// TryConsumeRPM 尝试消耗 RPM 额度（按分钟窗口计数）
func (l *KeyLimiter) TryConsumeRPM(keyID int, limit int, now time.Time) bool {
	if limit <= 0 {
		return true
	}
	st := l.get(keyID)
	m := now.Unix() / 60
	prev := st.windowMinute.Load()
	if prev != m {
		st.windowMinute.Store(m)
		st.count.Store(0)
	}
	n := st.count.Add(1)
	return n <= int32(limit)
}