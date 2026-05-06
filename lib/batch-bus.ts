// prompt-rewriter/lib/batch-bus.ts
//
// 跨请求事件总线:start 路由启动后台任务,SSE 路由订阅事件流。
//
// 这俩在 Next.js 是不同的 HTTP 请求,但同 process,所以用 in-memory pubsub 串起来。
// dev hot-reload 会清掉 module 顶层,挂 globalThis 兜底。
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
  // 标记:run 是否已经在跑(防 start 路由被重复点)
  running: Set<string>;
};

function getState(): GlobalState {
  const g = globalThis as unknown as { __batchBusState?: GlobalState };
  if (!g.__batchBusState) {
    g.__batchBusState = { listeners: new Map(), running: new Set() };
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
  // 用快照遍历:listener 内可能取消订阅
  [...set].forEach((l) => {
    try {
      l(event);
    } catch {
      // 单个 listener 报错不影响其他 listener
    }
  });
}

export function markRunning(id: string): boolean {
  const state = getState();
  if (state.running.has(id)) return false;
  state.running.add(id);
  return true;
}

export function markDone(id: string): void {
  getState().running.delete(id);
}

export function isRunning(id: string): boolean {
  return getState().running.has(id);
}
