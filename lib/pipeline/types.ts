// prompt-rewriter/lib/pipeline/types.ts
//
// Lightweight Pipeline Runner —— 类型定义。
// 设计原则:
//   - 框架只做编排(顺序、错误兜底、ctx 累加),不强制事件命名 / 重试 / parallelism
//   - 步骤 emit 自己的 phase 事件(保留前端原协议),框架 emit 仅做 fatal
//   - 越小越好,真正的"轻量"

export type PipelineEvent = {
  phase: string;
  data: Record<string, unknown>;
};

export type EmitFn = (event: PipelineEvent) => void;

export interface Step<TCtx> {
  id: string;
  description?: string;
  /**
   * 跑这一步。从 ctx 读、emit 进度事件、返回 ctx 的 patch(浅合并)。
   * 同一份 emit 跨 step 共享,前端按 phase 名做 reducer 分流。
   */
  run: (ctx: TCtx, emit: EmitFn) => Promise<Partial<TCtx>>;
}

export interface Pipeline<TCtx> {
  id: string;
  steps: Step<TCtx>[];
}

export function defineStep<TCtx>(spec: Step<TCtx>): Step<TCtx> {
  return spec;
}

export function definePipeline<TCtx>(spec: Pipeline<TCtx>): Pipeline<TCtx> {
  return spec;
}
