// prompt-rewriter/lib/batch-runner.ts
//
// 单 cell 执行器:把"跑一格"封装成幂等的、不抛异常的、自动写盘 + 推事件的函数。
//
// 流程:
//   patchCell(running) + publish(cell:running)
//     → runFormatOne 拿 final_prompt
//     → createImageTask + 轮询 getImageResult 拿 url[]
//     → saveImageBytes 落盘成 /api/image-file/...
//     → patchCell(done, final_prompt, image_urls) + publish(cell:done)
//
// 任意环节失败:patchCell(failed, error) + publish(cell:failed),不抛。
//
// 调用方(/start route)负责用 Semaphore 控制并发。

import { runFormatOne, loadAllLabels } from "@/lib/format-runner";
import {
  createImageTask,
  getImageResult,
  ImageGatewayError,
} from "@/lib/image";
import { saveImageBytes } from "@/lib/image-store";
import { patchCell, readRun } from "@/lib/batch-store";
import { publish } from "@/lib/batch-bus";
import type { BatchCell, BatchRunRecord } from "@/lib/schema";

// 轮询参数:gpt-image-2 medium 出图 ~10-40s,留 3 分钟兜底。
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 180_000;

async function pollImageUntilDone(taskId: string): Promise<{
  status: "completed" | "failed";
  urls: string[];
  error: string | null;
}> {
  const startedAt = Date.now();
  while (true) {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      return {
        status: "failed",
        urls: [],
        error: `轮询生图超过 ${POLL_TIMEOUT_MS / 1000}s 未出结果`,
      };
    }
    try {
      const r = await getImageResult(taskId);
      if (r.status === "completed") {
        const urls = (r.artifacts ?? [])
          .filter((a) => a.type === "image")
          .map((a) => a.content);
        return { status: "completed", urls, error: null };
      }
      if (r.status === "failed") {
        return {
          status: "failed",
          urls: [],
          error:
            typeof r.error_details === "string"
              ? r.error_details
              : JSON.stringify(r.error_details ?? {}),
        };
      }
    } catch (e) {
      // 单次轮询失败不致命,继续重试直到超时
      const msg = e instanceof ImageGatewayError ? e.message : String(e);
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        return { status: "failed", urls: [], error: msg };
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/**
 * 跑一个 cell。labelMap 由调用方预加载传入(避免 N×M 个 cell 反复读 index.json)。
 */
export async function runCell(
  runId: string,
  query: string,
  queryIdx: number,
  skillId: string,
  llmModel: string | undefined,
  labelMap: Record<string, string>,
  // 是否在 system prompt 前注入 _universal.md。默认 true 保持向后兼容。
  // 由 /start /retry /retry-all 路由从 record.include_universal 读出后透传。
  includeUniversal: boolean = true
): Promise<void> {
  await patchCell(runId, queryIdx, skillId, { status: "running" });
  publish(runId, {
    type: "cell",
    query_idx: queryIdx,
    skill_id: skillId,
    patch: { status: "running" },
  });

  // 阶段 1:LLM 改写
  const fr = await runFormatOne(query, skillId, labelMap, llmModel, includeUniversal);
  if (!fr.final_prompt || fr.error) {
    const failPatch: Partial<BatchCell> = {
      status: "failed",
      error: fr.error ?? "改写失败",
      raw: fr.raw,
      ms: fr.ms,
    };
    await patchCell(runId, queryIdx, skillId, failPatch);
    publish(runId, {
      type: "cell",
      query_idx: queryIdx,
      skill_id: skillId,
      patch: failPatch,
    });
    return;
  }

  // 阶段 2:生图(创建 + 轮询 + 落盘)
  let taskId: string;
  try {
    const t = await createImageTask({
      prompt: fr.final_prompt.prompt,
      size: fr.final_prompt.size,
      quality: "medium", // 跟 generate-image route 一致硬锁
      n: fr.final_prompt.n,
      output_format: fr.final_prompt.output_format,
    });
    taskId = t.task_id;
  } catch (e) {
    const msg = e instanceof ImageGatewayError ? e.message : String(e);
    const failPatch: Partial<BatchCell> = {
      status: "failed",
      final_prompt: fr.final_prompt,
      raw: fr.raw,
      ms: fr.ms,
      error: `生图任务创建失败: ${msg}`,
    };
    await patchCell(runId, queryIdx, skillId, failPatch);
    publish(runId, {
      type: "cell",
      query_idx: queryIdx,
      skill_id: skillId,
      patch: failPatch,
    });
    return;
  }

  const polled = await pollImageUntilDone(taskId);
  if (polled.status === "failed") {
    const failPatch: Partial<BatchCell> = {
      status: "failed",
      final_prompt: fr.final_prompt,
      raw: fr.raw,
      ms: fr.ms,
      error: polled.error,
    };
    await patchCell(runId, queryIdx, skillId, failPatch);
    publish(runId, {
      type: "cell",
      query_idx: queryIdx,
      skill_id: skillId,
      patch: failPatch,
    });
    return;
  }

  // 落盘:gateway url 会过期,本地路径才可长期复盘
  const localPaths = await saveImageBytes(taskId, polled.urls);
  const finalUrls =
    localPaths.length === polled.urls.length && localPaths.every((p) => p)
      ? localPaths
      : polled.urls;

  const donePatch: Partial<BatchCell> = {
    status: "done",
    final_prompt: fr.final_prompt,
    image_urls: finalUrls,
    raw: fr.raw,
    ms: fr.ms, // 只记 LLM 阶段耗时;生图轮询时间不计(因 gateway 排队抖动)
    error: null,
  };
  await patchCell(runId, queryIdx, skillId, donePatch);
  publish(runId, {
    type: "cell",
    query_idx: queryIdx,
    skill_id: skillId,
    patch: donePatch,
  });
}

/** 进度统计:扫一遍 record 算 done/failed/excluded/total。 */
export function progressOf(record: BatchRunRecord): {
  done: number;
  failed: number;
  excluded: number;
  total: number;
} {
  let done = 0;
  let failed = 0;
  let excluded = 0;
  for (const c of record.cells) {
    if (c.status === "done") done++;
    else if (c.status === "failed") failed++;
    else if (c.status === "excluded") excluded++;
  }
  return { done, failed, excluded, total: record.cells.length };
}

export async function publishProgress(runId: string): Promise<void> {
  const r = await readRun(runId);
  if (!r) return;
  const p = progressOf(r);
  publish(runId, { type: "progress", ...p });
  if (p.done + p.failed + p.excluded >= p.total) {
    publish(runId, { type: "finished" });
  }
}
