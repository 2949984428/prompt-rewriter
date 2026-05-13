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

import { runFormatOne } from "@/lib/format-runner";
import {
  createImageTaskRouted,
  getImageResultRouted,
  RoutingMismatchError,
} from "@/lib/image-router";
import { ImageGatewayError } from "@/lib/image";
import { LovartAgentError } from "@/lib/lovart-agent-client";
import { saveImageBytes } from "@/lib/image-store";
import { patchCell, readRun } from "@/lib/batch-store";
import { publish, refreshRunning } from "@/lib/batch-bus";
import type { BatchCell, BatchRunRecord, BatchTestKind } from "@/lib/schema";
// 2026-05-13 Phase 2:Pipeline 测试台 cell runner
import { runPipeline } from "@/lib/pipeline/runner";
import { pipelineDefinition, type PipelineCtx } from "@/lib/pipeline/steps";
// 2026-05-13:Pipeline 测试台 "api_direct" 伪 pipeline 走 runImageWithRetry,
// 跳过 SP1/Planner/SP2,query + 参考图直生图。语义跟 Skill F11-direct-api 一致
import { runImageWithRetry } from "@/lib/pipeline-image-runner";

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
      const r = await getImageResultRouted(taskId);
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
          error: r.error ?? "生图失败",
        };
      }
    } catch (e) {
      // 单次轮询失败不致命,继续重试直到超时
      const msg =
        e instanceof ImageGatewayError || e instanceof LovartAgentError
          ? e.message
          : String(e);
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        return { status: "failed", urls: [], error: msg };
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

// ── 自动重试参数 ──
// 单 cell 失败后自动重试。每次失败 backoff 后再试,最多 MAX_ATTEMPTS 次。
// backoff 用近似 fibonacci:1s → 60s,总等约 3 分钟。
// 全部用完仍失败 → cell 真标 failed,等用户手动 retry 或 retry-all。
const MAX_ATTEMPTS = 10;
const BACKOFF_MS = [1_000, 2_000, 3_000, 5_000, 8_000, 13_000, 20_000, 30_000, 45_000];

type CellOutcome =
  | { kind: "done"; patch: Partial<BatchCell> }
  | { kind: "fail"; patch: Partial<BatchCell>; reason: string };

/**
 * 调用 runCell 的入口需要把 record 级 model 信息传进来做 fail-fast 校验:
 * - 多 model 模式(imageModelIds.length > 1):cell.image_model 必须非空 + 在 list 内
 * - 单 model 模式 / 老 record:cell.image_model 可空,fallback recordImageModel
 * 由 start / retry / retry-all 三个 route 从 record 读取后传入。
 */
export type RunCellRecordContext = {
  imageModelIds: string[];     // record.image_model_ids
  recordImageModel: string;    // record.image_model(老字段,单 model 兜底)
};

/**
 * Pipeline 测试台 cell:跑整条 pipeline(SP1 → 策略 → CreationPlanner → SP2 → 生图)。
 * 复用 lib/pipeline/runner.ts:runPipeline,emit 收集 step3_item 事件作为多张图来源。
 *
 * 落到 cell 上:
 *   - image_urls:取第 1 张图(给 batch grid 显示主图);完整多图在 pipeline_outputs.generations
 *   - pipeline_outputs:含 step1/step2/strategy_pack/creation_planner/generations/trace
 *   - final_prompt:null(pipeline 没单 final_prompt,reviewed prompts 在 pipeline_outputs.step2)
 *
 * 2026-05-13 Phase 2:pipelineId 只支持 "vertical_prompt_rewrite_v1"(唯一 pipeline)。
 * 未来加新 pipeline 时这里做 pipelineId → definition 的 registry 查找。
 */
/**
 * 2026-05-13:Pipeline 测试台 "api_direct" 伪 pipeline cell。
 *
 * **语义跟 Skill 测试台 F11-direct-api 完全一致** —— LLM 推 size(F10/F11 共享同套
 * 启发式)+ server 端强制 final_prompt.prompt = query.trim()(见 format-runner.ts
 * 的 `skill_id === "F11-direct-api"` 分支)。
 *
 * 实现上直接 delegate 到 tryRunCellOnce(skillId="F11-direct-api"),不重复造轮子。
 * 这样修改 F11 行为时,Pipeline 测试台的 baseline 也跟着对齐,**不会出现两边漂移**。
 */
async function tryRunApiDirectCellOnce(args: {
  query: string;
  referenceImages: string[];
}): Promise<CellOutcome> {
  // 沉默使用 runImageWithRetry 仅为 import 占位(实际不调,留着便于后续需要绕开
  // Skill 链路时切换)。tsc 不会报 unused import,但 lint 可能报 → 用一个 void 守一下
  void runImageWithRetry;

  return tryRunCellOnce({
    query: args.query,
    skillId: "F11-direct-api",
    llmModel: undefined, // 用全局默认 LLM(跟 Skill 测试台 F11 跑批一致)
    labelMap: { "F11-direct-api": "API 直出" },
    includeUniversal: true, // 跟历史 F11 跑批一致;影响 system prompt 前面注入 _universal.md
    referenceImages: args.referenceImages,
    imageModel: "gpt-image-2", // Pipeline 测试台 baseline 用 IGW 默认模型
  });
}

async function tryRunPipelineCellOnce(args: {
  query: string;
  pipelineId: string;
  referenceImages: string[];
}): Promise<CellOutcome> {
  const t0 = Date.now();
  // 当前 Phase 2 只有 1 个 pipeline,直接用 pipelineDefinition;后续多 pipeline 时按 id 路由
  void args.pipelineId;

  // Pipeline 测试台:用 pipeline 默认模型(模型选择是 pipeline 设计的一部分,batch 层不该再选)。
  // 这些值跟前端 PipelineLab 的 pipelineSearchModelAtom / pipelineReviewModelAtom /
  // pipelineImageModelAtom 默认值对齐 — 单 query 跟批量跑批用同一组模型,结果可对比。
  // 未来 pipeline registry 接入后,每个 pipeline 自己声明 default models,这里按 pipelineId 查表。
  const PIPELINE_DEFAULT_SEARCH_MODEL = "gemini/gemini-3-flash-preview";
  const PIPELINE_DEFAULT_REVIEW_MODEL = "doubao/seed-2-0-pro-260215";
  const PIPELINE_DEFAULT_IMAGE_MODEL = "gpt-image-2";

  const initialCtx: PipelineCtx = {
    query: args.query,
    searchModel: PIPELINE_DEFAULT_SEARCH_MODEL,
    reviewModel: PIPELINE_DEFAULT_REVIEW_MODEL,
    imageModel: PIPELINE_DEFAULT_IMAGE_MODEL,
    referenceImages: args.referenceImages,
    functionCallCount: 1,        // batch 模式默认 1(每 cell 出 1 图,跟 skill cell 对齐 grid 渲染)
    doGenerate: true,
    alsoRunDirect: false,        // batch 不需要对比直出(grid 视图按 cell 渲染,对比是 Pipeline lab UI 专属)
    startTotal: t0,
  };

  // tee emit:收集 step3_item(完整的 generations)
  const step3Items: Array<Record<string, unknown>> = [];
  const emit = (event: { phase: string; data: Record<string, unknown> }) => {
    if (event.phase === "step3_item") step3Items.push(event.data);
  };

  let runResult;
  try {
    runResult = await runPipeline(pipelineDefinition, initialCtx, emit);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      kind: "fail",
      reason: msg,
      patch: {
        final_prompt: null,
        raw: "",
        ms: Date.now() - t0,
        error: `Pipeline 跑批失败: ${msg}`,
      },
    };
  }
  const { ctx: finalCtx, trace, failedAt } = runResult;

  // 主图:第 1 张已生图的 image_urls(用于 batch grid 缩略图)
  const firstGen = step3Items.find(
    (it) => Array.isArray(it.image_urls) && (it.image_urls as string[]).length > 0,
  );
  const firstUrls = firstGen ? (firstGen.image_urls as string[]) : [];

  // 落盘:gateway url 会过期(参考 step3_item 流程已 emit 完成态),复用 saveImageBytes
  // 多 generation 也跟 batch cell 一样,落到本地,image_urls 字段存第一张
  // 完整 generations 存在 pipeline_outputs.generations(URL 已经是 step3_item 的最终值)
  let finalUrls = firstUrls;
  if (firstGen && firstUrls.length > 0) {
    const taskId = String(firstGen.id ?? `pipe_${Date.now()}`);
    const localPaths = await saveImageBytes(taskId, firstUrls);
    if (localPaths.length === firstUrls.length && localPaths.every((p) => p)) {
      finalUrls = localPaths;
    }
  }

  // 跑批失败但生成了部分 step:整体标 fail,但保留部分产物
  if (failedAt && firstUrls.length === 0) {
    return {
      kind: "fail",
      reason: `pipeline ${failedAt} step 失败`,
      patch: {
        final_prompt: null,
        raw: JSON.stringify({ trace, strategy_versions: finalCtx.strategyVersions }),
        ms: Date.now() - t0,
        error: `pipeline ${failedAt} step 失败`,
        pipeline_outputs: {
          step1: finalCtx.step1 ?? null,
          step2: finalCtx.step2 ?? null,
          strategy_pack: finalCtx.strategyPack ?? null,
          creation_planner: finalCtx.creationPlanner ?? null,
          generations: step3Items,
          trace,
          strategy_versions: finalCtx.strategyVersions ?? {},
        },
      },
    };
  }

  return {
    kind: "done",
    patch: {
      status: "done",
      final_prompt: null,
      image_urls: finalUrls,
      raw: JSON.stringify({ trace, strategy_versions: finalCtx.strategyVersions }),
      ms: Date.now() - t0,
      error: null,
      pipeline_outputs: {
        step1: finalCtx.step1 ?? null,
        step2: finalCtx.step2 ?? null,
        strategy_pack: finalCtx.strategyPack ?? null,
        creation_planner: finalCtx.creationPlanner ?? null,
        generations: step3Items,
        trace,
        strategy_versions: finalCtx.strategyVersions ?? {},
      },
    },
  };
}

/**
 * 单次尝试:LLM 改写 + 创建生图任务 + 轮询 + 落盘。
 * 不直接 patchCell —— 把成败包成 CellOutcome 让外层 retry 循环决定如何上报。
 */
async function tryRunCellOnce(args: {
  query: string;
  skillId: string;
  llmModel: string | undefined;
  labelMap: Record<string, string>;
  includeUniversal: boolean;
  referenceImages: string[];
  imageModel: string;
}): Promise<CellOutcome> {
  const fr = await runFormatOne(
    args.query,
    args.skillId,
    args.labelMap,
    args.llmModel,
    args.includeUniversal
  );
  if (!fr.final_prompt || fr.error) {
    return {
      kind: "fail",
      reason: fr.error ?? "改写失败",
      patch: {
        final_prompt: null,
        raw: fr.raw,
        ms: fr.ms,
        error: fr.error ?? "改写失败",
      },
    };
  }

  let taskId: string;
  try {
    // 注意:args.imageModel 在 runCell 入口已经过 fail-fast 校验,
    // 这里**不再做 silent fallback**(防"多 model 模式下 cell.image_model 空 → 偷偷跑 IGW"的旧 bug)。
    // 空字符串走 image-router 的 pickProvider("") → igw,这是合法的"单 model 默认网关"语义。
    const t = await createImageTaskRouted({
      model: args.imageModel,
      prompt: fr.final_prompt.prompt,
      size: fr.final_prompt.size,
      quality: "medium", // 跟 generate-image route 一致硬锁(仅对 IGW 路径生效)
      n: fr.final_prompt.n,
      output_format: fr.final_prompt.output_format,
      reference_images: args.referenceImages,
    });
    taskId = t.task_id;
  } catch (e) {
    const msg =
      e instanceof ImageGatewayError ||
      e instanceof LovartAgentError ||
      e instanceof RoutingMismatchError
        ? e.message
        : String(e);
    if (
      e instanceof ImageGatewayError ||
      e instanceof LovartAgentError ||
      e instanceof RoutingMismatchError
    ) {
      const raw =
        "raw" in e && typeof (e as { raw?: unknown }).raw === "string"
          ? ((e as { raw?: string }).raw ?? "").slice(0, 800)
          : "";
      console.error(
        `[batch-runner] ${e.constructor.name} model=${args.imageModel || "(default)"} skill=${args.skillId} msg=${e.message}\n  raw=${raw}`
      );
    }
    return {
      kind: "fail",
      reason: msg,
      patch: {
        final_prompt: fr.final_prompt,
        raw: fr.raw,
        ms: fr.ms,
        error: `生图任务创建失败: ${msg}`,
      },
    };
  }

  const polled = await pollImageUntilDone(taskId);
  if (polled.status === "failed") {
    return {
      kind: "fail",
      reason: polled.error ?? "polling failed",
      patch: {
        final_prompt: fr.final_prompt,
        raw: fr.raw,
        ms: fr.ms,
        error: polled.error,
      },
    };
  }

  // 落盘:gateway url 会过期,本地路径才可长期复盘
  const localPaths = await saveImageBytes(taskId, polled.urls);
  const finalUrls =
    localPaths.length === polled.urls.length && localPaths.every((p) => p)
      ? localPaths
      : polled.urls;

  return {
    kind: "done",
    patch: {
      status: "done",
      final_prompt: fr.final_prompt,
      image_urls: finalUrls,
      raw: fr.raw,
      ms: fr.ms,
      error: null,
    },
  };
}

/**
 * 跑一个 cell。labelMap 由调用方预加载传入(避免 N×M 个 cell 反复读 index.json)。
 * 失败自动重试:最多 MAX_ATTEMPTS 次,带 backoff,全部用完才把 cell 真标 failed。
 *
 * 2026-05-13 Phase 2:Pipeline 测试台共用 runCell,通过 testKind/pipelineId 分流。
 * testKind="skill"   → 原 skill 路径(skillId 用)
 * testKind="pipeline" → pipeline 路径(pipelineId 用,跑完整 pipeline,产物存 cell.pipeline_outputs)
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
  includeUniversal: boolean = true,
  // 参考图(base64 data URL)。非空 → 生图走 image-edit;空 → 走 text-to-image。
  // 由 /start /retry 路由从 record.reference_images 读出后透传。所有 cell 共用。
  referenceImages: string[] = [],
  // 生图模型 name:""(默认) → 内部 IGW;"vendor/name" → Lovart Agent。
  // 由 /start /retry 路由从 record.image_model 读出后透传。所有 cell 共用。
  imageModel: string = "",
  // record 级 model 信息(用于入口 fail-fast 校验)。
  // 不传 → 跳过校验(向后兼容,但下一版加固后强制要求)。
  recordContext?: RunCellRecordContext,
  // Phase 2:test_kind + pipeline_id(skill cell 时不用,pipeline cell 必传)
  testKind: BatchTestKind = "skill",
  pipelineId: string = ""
): Promise<void> {
  // 推 running:每次 attempt 开始都推一次,error 字段挂 "重试 N/M:<上次错>" 让 UI 实时看到
  const pushRunning = async (note: string | null) => {
    const patch: Partial<BatchCell> = { status: "running", error: note };
    await patchCell(runId, queryIdx, skillId, patch, imageModel, pipelineId);
    publish(runId, {
      type: "cell",
      query_idx: queryIdx,
      skill_id: skillId,
      image_model: imageModel,
      patch,
    });
  };

  // ── 入口 fail-fast 校验 ──
  // 防 silent fallback:之前 tryRunCellOnce 里 `args.imageModel || "gpt-image-2"`
  // 会让 cell.image_model 意外为空时偷偷跑 IGW。改成显式抛错,标 cell failed,不进 retry。
  if (recordContext) {
    const isMulti = recordContext.imageModelIds.length > 1;
    const list = recordContext.imageModelIds;
    if (isMulti && !imageModel) {
      const failPatch: Partial<BatchCell> = {
        status: "failed",
        error: `多 model 跑批但 cell.image_model 为空(record.image_model_ids=[${list.join(", ")}])。可能 record 数据损坏,请重建跑批`,
      };
      await patchCell(runId, queryIdx, skillId, failPatch, imageModel, pipelineId);
      publish(runId, {
        type: "cell",
        query_idx: queryIdx,
        skill_id: skillId,
        image_model: imageModel,
        patch: failPatch,
      });
      return;
    }
    if (isMulti && !list.includes(imageModel)) {
      const failPatch: Partial<BatchCell> = {
        status: "failed",
        error: `cell.image_model="${imageModel}" 不在 record.image_model_ids=[${list.join(", ")}] 列表中`,
      };
      await patchCell(runId, queryIdx, skillId, failPatch, imageModel, pipelineId);
      publish(runId, {
        type: "cell",
        query_idx: queryIdx,
        skill_id: skillId,
        image_model: imageModel,
        patch: failPatch,
      });
      return;
    }
    // 单 model 模式 / 老 record:imageModel 空时 fallback recordImageModel(向后兼容)
    if (!isMulti && !imageModel && recordContext.recordImageModel) {
      console.warn(
        `[batch-runner] cell q=${queryIdx} s=${skillId} 用 record.image_model="${recordContext.recordImageModel}" 兜底(cell.image_model 为空)`
      );
      imageModel = recordContext.recordImageModel;
    }
  }

  let lastOutcome: CellOutcome | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await pushRunning(
      attempt === 1
        ? null
        : `重试 ${attempt}/${MAX_ATTEMPTS}(上次:${lastOutcome?.kind === "fail" ? lastOutcome.reason.slice(0, 120) : "?"})`
    );

    // Phase 2:按 testKind 分流。pipeline 路径走 runPipeline,skill 路径走 runFormatOne(原)
    // pipeline 模式不传 llmModel/imageModel —— pipeline 内部自带 SP1/SP2/image 三套默认模型
    // 2026-05-13:pipeline 模式再细分 — "api_direct" 伪 pipeline 跳过 SP,query 直生图(baseline)
    const outcome =
      testKind === "pipeline"
        ? pipelineId === "api_direct"
          ? await tryRunApiDirectCellOnce({ query, referenceImages })
          : await tryRunPipelineCellOnce({
              query,
              pipelineId,
              referenceImages,
            })
        : await tryRunCellOnce({
            query,
            skillId,
            llmModel,
            labelMap,
            includeUniversal,
            referenceImages,
            imageModel,
          });

    if (outcome.kind === "done") {
      await patchCell(runId, queryIdx, skillId, outcome.patch, imageModel, pipelineId);
      publish(runId, {
        type: "cell",
        query_idx: queryIdx,
        skill_id: skillId,
        image_model: imageModel,
        patch: outcome.patch,
      });
      return;
    }

    lastOutcome = outcome;

    // 还有重试机会 → backoff 后下一轮
    if (attempt < MAX_ATTEMPTS) {
      const wait = BACKOFF_MS[attempt - 1] ?? 60_000;
      console.warn(
        `[batch-runner] cell q=${queryIdx} s=${skillId} m=${imageModel || "(default)"} attempt ${attempt}/${MAX_ATTEMPTS} failed (${outcome.reason.slice(0, 100)}),${wait}ms 后重试`
      );
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
  }

  // 全部 attempt 用完 → 真 failed
  const finalPatch: Partial<BatchCell> = {
    ...(lastOutcome?.patch ?? {}),
    status: "failed",
    error: `重试 ${MAX_ATTEMPTS} 次仍失败 · 最后:${lastOutcome?.reason ?? "unknown"}`,
  };
  await patchCell(runId, queryIdx, skillId, finalPatch, imageModel, pipelineId);
  publish(runId, {
    type: "cell",
    query_idx: queryIdx,
    skill_id: skillId,
    image_model: imageModel,
    patch: finalPatch,
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

// globalThis Set 记录已经落过 ExperimentRecord 的 batch run id,防多次 cell 触发重复 build。
// 跨 hot-reload 共享(避免 dev 模式 reload 后再次 publishProgress 又落一份)。
function getExperimentDoneSet(): Set<string> {
  const g = globalThis as unknown as { __batchExperimentDoneSet?: Set<string> };
  if (!g.__batchExperimentDoneSet) g.__batchExperimentDoneSet = new Set();
  return g.__batchExperimentDoneSet;
}

export async function publishProgress(runId: string): Promise<void> {
  const r = await readRun(runId);
  if (!r) return;
  // 心跳:runner 还活着的信号。dev hot-reload kill async 后,refresh 自然停,
  // 60s 后锁过期,下次 start 自动 takeover,不需要外部 force。
  refreshRunning(runId);
  const p = progressOf(r);
  publish(runId, { type: "progress", ...p });
  if (p.done + p.failed + p.excluded >= p.total) {
    publish(runId, { type: "finished" });
    // 2026-05-13:整个 batch run 跑完 → 异步落一份 ExperimentRecord 到 Experiments 平台。
    // 防重复:globalThis Set 记录已经落过的 run id;失败不影响 batch lab 主流程。
    const doneSet = getExperimentDoneSet();
    if (!doneSet.has(r.id)) {
      doneSet.add(r.id);
      const kind = r.test_kind === "pipeline" ? "batch_pipeline" : "batch_skill";
      // 动态 import 避免循环依赖(experiments/store ↔ batch-runner)
      void (async () => {
        try {
          const [{ writeExperimentRecord }, { buildExperimentRecord }] =
            await Promise.all([
              import("@/lib/experiments/store"),
              import("@/lib/experiments/build"),
            ]);
          const exp = buildExperimentRecord(kind, r);
          await writeExperimentRecord(exp);
          console.log(
            `[batch-runner] 跑批 ${r.id} 完成,已落 Experiment ${exp.id}(kind=${kind})`,
          );
        } catch (e) {
          // 落盘失败不影响 batch lab 主流程,只 warn
          doneSet.delete(r.id); // 失败让下次 publish 再试一次
          console.warn(
            `[batch-runner] 落 Experiment 失败 (run=${r.id}):`,
            e instanceof Error ? e.message : String(e),
          );
        }
      })();
    }
  }
}
