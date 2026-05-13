// prompt-rewriter/lib/batch-bus.ts
//
// 跨请求事件总线 + 心跳锁:start 路由启动后台任务,SSE 路由订阅事件流。
//
// 这俩在 Next.js 是不同的 HTTP 请求,但同 process,所以用 in-memory pubsub 串起来。
// dev hot-reload 会清掉 module 顶层,挂 globalThis 兜底。
//
// ── run-level 锁的设计(心跳锁,**不需要外部 force takeover**)── //
// 老版本:Set<string> 标记 in-flight,markDone 释放。
//   问题:dev hot-reload 把后台 `Promise.all` async 杀掉后没人 markDone,
//   锁永远挂着,start 一直 short-circuit;之前只能加 force=true 手动 takeover。
//
// 新版本:Map<string, number> 存"上次心跳 timestamp"。
//   - runner 周期性 refreshRunning(id) 保活
//   - 新 start 来时,若上次心跳 < STALE_MS 内 → 视为真在跑,拒
//   - 若 > STALE_MS 没心跳(hot-reload kill / process 死) → 视为锁已失效,自动 takeover
// 这样不需要手 force,生产环境也无副作用(runner 正常跑时永远刷)。
//
// 不持久化事件:SSE 客户端断开重连时直接读 batch-store 拿当前完整 record(snapshot),
// 然后从断开点之后继续订阅事件即可 —— 因为 batch-store 是事件之后才写盘,
// 重连 snapshot 一定 ≥ 上次断开时见过的状态。

import type { BatchCell } from "@/lib/schema";

export type BatchEvent =
  | {
      type: "cell";
      query_idx: number;
      skill_id: string;
      // 多 model 改造后:同 (query_idx, skill_id) 可能有多 cell,需要 image_model 区分。
      // 老 record / 老 event(没此字段)→ 客户端把它当 "" 处理,与 cell.image_model 默认值对齐。
      image_model?: string;
      patch: Partial<BatchCell>;
    }
  | {
      type: "progress";
      done: number;
      failed: number;
      excluded: number;
      total: number;
    }
  | { type: "finished" };

type Listener = (e: BatchEvent) => void;

type GlobalState = {
  // run_id → 监听器集合
  listeners: Map<string, Set<Listener>>;
  // 心跳锁:run_id → 上次心跳 ms 时间戳。
  // 写入 = 拿锁;timestamp 过期 = 锁失效,允许 takeover。
  running: Map<string, number>;
};

// 心跳过期阈值:超过这么久没刷新 → 锁失效。
// 60s 选取依据:单 cell LLM 改写 + 生图轮询常态 < 30s;留 2× buffer 防误判正在跑的 run。
// 调高会让死锁恢复变慢;调低有误踢风险。
export const LOCK_STALE_MS = 60_000;

function getState(): GlobalState {
  const g = globalThis as unknown as { __batchBusState?: GlobalState };
  if (!g.__batchBusState) {
    g.__batchBusState = { listeners: new Map(), running: new Map() };
  }
  // 兼容老版本 Set 留下的 globalThis 状态(hot-reload 切版时遇到一次):
  // 把 Set 替换成空 Map,丢掉旧锁(反正它们也是 stale 的)
  if (!(g.__batchBusState.running instanceof Map)) {
    g.__batchBusState.running = new Map();
  }
  return g.__batchBusState;
}

export function subscribe(id: string, listener: Listener): () => void {
  const state = getState();
  let set = state.listeners.get(id);
  if (!set) {
    set = new Set();
    state.listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    const s = state.listeners.get(id);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) state.listeners.delete(id);
  };
}

export function publish(id: string, event: BatchEvent): void {
  const state = getState();
  const set = state.listeners.get(id);
  if (!set) return;
  [...set].forEach((l) => {
    try {
      l(event);
    } catch {
      // 单个 listener 报错不影响其他 listener
    }
  });
}

/**
 * 拿锁:写入当前时间戳。
 * 返回 false 表示锁被另一活跃 runner 占着(心跳新鲜);
 * 返回 true 表示空闲 / 锁失效(stale),已成功 takeover。
 */
export function markRunning(id: string): boolean {
  const state = getState();
  const now = Date.now();
  const last = state.running.get(id);
  if (last != null && now - last < LOCK_STALE_MS) {
    // 还有新鲜心跳 → 真在跑,拒
    return false;
  }
  // 没锁 / 锁过期 → 自己接管
  state.running.set(id, now);
  return true;
}

/**
 * 刷新心跳:runner 在 cell 完成 / progress 推送时调,证明自己活着。
 * 没占锁时静默无效(防误刷)。
 */
export function refreshRunning(id: string): void {
  const state = getState();
  if (state.running.has(id)) {
    state.running.set(id, Date.now());
  }
}

export function markDone(id: string): void {
  getState().running.delete(id);
}

/**
 * 锁状态查询:返回 'fresh' / 'stale' / 'idle'。
 * - fresh:有锁且心跳新鲜
 * - stale:有锁但心跳过期(runner 死了)
 * - idle:无锁
 */
export function lockState(id: string): "fresh" | "stale" | "idle" {
  const state = getState();
  const last = state.running.get(id);
  if (last == null) return "idle";
  return Date.now() - last < LOCK_STALE_MS ? "fresh" : "stale";
}

export function isRunning(id: string): boolean {
  return lockState(id) === "fresh";
}
