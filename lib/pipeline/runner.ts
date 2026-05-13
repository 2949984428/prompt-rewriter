// prompt-rewriter/lib/pipeline/runner.ts
//
// Lightweight pipeline runner —— 顺序跑 step,自动收集 trace,可选 retry。
// 不做 parallelism(那是 Step 3 内部自己用 Promise.all 处理的事)。
// 不做事件命名约束(step 内 emit 啥就是啥)。

import type { Pipeline, EmitFn, PipelineEvent } from "./types";

/**
 * 单个 step 在 trace 里留下的一条记录。
 * status:
 *   - "ok"     : run 正常返回
 *   - "failed" : 所有 retry 用完仍抛
 *   - "skipped": step.run 返回 undefined 或被 onError 决定不抛(暂未启用)
 */
export type TraceEntry = {
  step: string;
  ms: number;
  status: "ok" | "failed" | "skipped";
  attempts: number;
  error?: string;
};

export interface StepRetryConfig {
  maxAttempts: number;
  /** 每次失败后等多久再重试;长度 < maxAttempts-1 时多出来的次数复用最后一个值 */
  backoffMs: number[];
}

// 给 Step 接口扩 retry 字段(types.ts 起头时没加,这里通过模块声明合并)
declare module "./types" {
  interface Step<TCtx> {
    retry?: StepRetryConfig;
  }
}

export interface RunPipelineResult<TCtx> {
  ctx: TCtx;
  trace: TraceEntry[];
  /** 第一个 failed step 的 id(没失败就是 null) */
  failedAt: string | null;
}

/**
 * 跑一条 pipeline。step 内异常 → 按 retry 配置重试 → 全部用完仍失败 → 写 failed
 * 到 trace,**继续跑后续 step**(把决定权交给后续 step 看 ctx 决定要不要早返)。
 *
 * 为什么不直接整条 abort:我们的 SP1 失败时,SP2 仍然可以 fallback 用空 intent
 * 拿默认策略包跑。让 SP1 失败不影响 SP2 启动,行为跟改造前一致。
 */
export async function runPipeline<TCtx>(
  pipeline: Pipeline<TCtx>,
  initialCtx: TCtx,
  emit: EmitFn,
): Promise<RunPipelineResult<TCtx>> {
  let ctx: TCtx = initialCtx;
  const trace: TraceEntry[] = [];
  let failedAt: string | null = null;

  for (const step of pipeline.steps) {
    const stepStart = Date.now();
    const maxAttempts = step.retry?.maxAttempts ?? 1;
    const backoffMs = step.retry?.backoffMs ?? [];
    let attempts = 0;
    let lastError: unknown = null;
    let patch: Partial<TCtx> | undefined = undefined;
    let entryStatus: TraceEntry["status"] = "failed";

    for (let a = 1; a <= maxAttempts; a++) {
      attempts = a;
      try {
        patch = await step.run(ctx, emit);
        entryStatus = "ok";
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (a < maxAttempts) {
          const wait = backoffMs[a - 1] ?? backoffMs[backoffMs.length - 1] ?? 1000;
          console.warn(
            `[pipeline-runner] step=${step.id} attempt ${a}/${maxAttempts} failed (${
              e instanceof Error ? e.message : String(e)
            }),${wait}ms 后重试`,
          );
          await sleep(wait);
        }
      }
    }

    // 浅合并 patch 到 ctx(顶层 key 整个覆盖,不做 deep merge)
    if (patch && typeof patch === "object") {
      ctx = { ...ctx, ...patch };
    }

    const entry: TraceEntry = {
      step: step.id,
      ms: Date.now() - stepStart,
      status: entryStatus,
      attempts,
    };
    if (entryStatus === "failed") {
      entry.error = lastError instanceof Error ? lastError.message : String(lastError);
      if (!failedAt) failedAt = step.id;
    }
    trace.push(entry);
  }

  return { ctx, trace, failedAt };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 把 emit 包成一个会同时收集到本地数组的版本。
 * 给调试/测试用 —— 跑完后看完整 event 序列。生产路径不需要,直接传原 emit。
 */
export function makeTeeEmit(
  base: EmitFn,
): { emit: EmitFn; collected: PipelineEvent[] } {
  const collected: PipelineEvent[] = [];
  return {
    emit: (event) => {
      collected.push(event);
      base(event);
    },
    collected,
  };
}
