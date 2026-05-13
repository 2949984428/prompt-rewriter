// prompt-rewriter/lib/pipeline-image-runner.ts
//
// Pipeline Step 3 的生图 + 自动重试逻辑,跟 batch-runner 同形:
//   - MAX_ATTEMPTS 次,fibonacci backoff
//   - 每次 attempt 开始前推 `step3_item_progress` 事件,前端 chip 实时显示"重试 N/M"
//   - 全部 attempt 用完仍失败 → 推 `step3_item` 终态 error
//
// 被 POST 流式跑批 + 单格手动重试两条路共用。

import { createImageTaskRouted, getImageResultRouted } from "./image-router";
import type { ImageSize } from "./image";

// 跟 batch-runner 对齐
const MAX_ATTEMPTS = 10;
const BACKOFF_MS = [1_000, 2_000, 3_000, 5_000, 8_000, 13_000, 20_000, 30_000, 45_000];

const POLL_INTERVAL_MS = 1500;
// 2026-05-13:从 90s 提到 180s,跟 batch-runner / constants.IMAGE_POLL_TIMEOUT_MS 对齐。
// 实测某些 image gateway(尤其图生图 + 大 size)单次出图需要 2 分钟以上,90s 都跑不完
// 就被判超时,导致 fibonacci backoff 后再次提交 task 又重头跑(浪费成本 + 用户体感 fail)
const POLL_TIMEOUT_MS = 180_000;

export async function pollImageTaskUntilDone(taskId: string): Promise<{
  status: "completed" | "failed";
  urls: string[];
  error: string | null;
}> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    try {
      const r = await getImageResultRouted(taskId);
      if (r.status === "completed") {
        const urls = (r.artifacts ?? [])
          .filter((a) => a.type === "image")
          .map((a) => a.content);
        return { status: "completed", urls, error: null };
      }
      if (r.status === "failed") {
        return { status: "failed", urls: [], error: r.error ?? "生图失败" };
      }
    } catch {
      // 单次失败继续重试
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { status: "failed", urls: [], error: `轮询超时(${POLL_TIMEOUT_MS / 1000}s)` };
}

// IGW 把 gpt-image-2 实际 mapping 到 minimax(对 client 透明,见 CLAUDE.md「几个有意为之的事」),
// minimax 不接受 size="auto",要 WIDTHxHEIGHT。所以这里 fallback 用 1024x1024
// (gpt-image-2 / minimax / seedream 三家都接受的安全公约)。
// 真实 size 由 CreationPlanner LLM 推理后通过 args.size 传入(从 F11-direct-api 启发式继承)。
const SAFE_FALLBACK_SIZE = "1024x1024";

/** 单次尝试:create task + poll until done。失败不抛,返回 error 字段。 */
async function tryGenerateOnce(args: {
  prompt: string;
  imageModel: string;
  size: string;
  referenceImages: string[];
}): Promise<{ urls: string[]; error: string | null }> {
  try {
    const task = await createImageTaskRouted({
      model: args.imageModel,
      prompt: args.prompt.slice(0, 32000),
      // size 已经过 step-creation-planner 的 normalizeSize 归一为 ImageSize 枚举内的值,
      // 但 args.size 类型是 string(LLM 输出边界),这里 cast 是安全的
      size: (args.size || SAFE_FALLBACK_SIZE) as ImageSize,
      quality: "medium",
      n: 1,
      output_format: "png",
      reference_images: args.referenceImages,
    });
    const polled = await pollImageTaskUntilDone(task.task_id);
    return { urls: polled.urls, error: polled.error };
  } catch (e) {
    return { urls: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export type StreamSend = (msg: {
  phase: "step3_item_progress" | "step3_item";
  data: Record<string, unknown>;
}) => void;

/**
 * 一张图的完整 retry 循环。每次 attempt:
 *   - 先 send `step3_item_progress`(含 attempt 计数 + 上一次错)
 *   - 跑一次 tryGenerateOnce
 *   - 成功 → send `step3_item` 终态 done,return
 *   - 失败 → backoff,继续
 * 全部用完 → send `step3_item` 终态 failed 的合并 error 信息,return
 *
 * `emit` 是流控制器塞进来的 send 函数。POST 跑批和单格手动重试都用同一个签名。
 */
export async function runImageWithRetry(args: {
  id: string;
  prompt: string;
  imageModel: string;
  /** CreationPlanner 推出来的 size,空 / 不合法时 fallback 到 1024x1024 */
  size: string;
  referenceImages: string[];
  emit: StreamSend;
  /** 当前是第一次跑(0)还是手动重试触发(0 也行,只是 UI 提示文案没区别) */
  manualRetry?: boolean;
}): Promise<void> {
  const start = Date.now();
  let lastError: string | null = null;
  const effectiveSize = args.size || SAFE_FALLBACK_SIZE;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    args.emit({
      phase: "step3_item_progress",
      data: {
        id: args.id,
        attempt,
        max_attempts: MAX_ATTEMPTS,
        status: "retrying",
        last_error: attempt > 1 ? lastError : null,
        manual_retry: args.manualRetry ?? false,
        size: effectiveSize,
      },
    });

    const result = await tryGenerateOnce({
      prompt: args.prompt,
      imageModel: args.imageModel,
      size: effectiveSize,
      referenceImages: args.referenceImages,
    });

    if (result.error === null && result.urls.length > 0) {
      args.emit({
        phase: "step3_item",
        data: {
          id: args.id,
          prompt: args.prompt,
          image_urls: result.urls,
          error: null,
          elapsed_ms: Date.now() - start,
          attempts: attempt,
          status: "done",
          size: effectiveSize,
        },
      });
      return;
    }

    lastError = result.error ?? "completed but no image returned";

    if (attempt < MAX_ATTEMPTS) {
      const wait = BACKOFF_MS[attempt - 1] ?? 60_000;
      console.warn(
        `[pipeline-image-runner] id=${args.id} model=${args.imageModel || "(default)"} size=${effectiveSize} attempt ${attempt}/${MAX_ATTEMPTS} failed (${lastError.slice(0, 100)}),${wait}ms 后重试`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  args.emit({
    phase: "step3_item",
    data: {
      id: args.id,
      prompt: args.prompt,
      image_urls: [],
      error: `重试 ${MAX_ATTEMPTS} 次仍失败 · 最后:${lastError}`,
      elapsed_ms: Date.now() - start,
      attempts: MAX_ATTEMPTS,
      status: "failed",
      size: effectiveSize,
    },
  });
}

export const PIPELINE_IMAGE_RETRY_CONFIG = {
  MAX_ATTEMPTS,
  BACKOFF_MS,
};
