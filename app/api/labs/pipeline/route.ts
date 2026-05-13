// prompt-rewriter/app/api/labs/pipeline/route.ts
//
// Pipeline 两步流水线 · API 入口（对齐线上格式）
// ─────────────────────────────────────────────────────────────────────
// 流程：
//   Step 1 · search_intent_classification    → SearchIntentResult JSON
//   ─ CreationPlanner (mock)                 → 拆 N 个 function call 草稿
//   Step 2 · media_prompt_review             → reviewed[] 改写后字段表 prompt
//   Step 3 · generate_media                  → 用每个 reviewed.prompt 调生图（n=1 张）
//
// Phase 1 重构后:POST 不再 inline 5 段逻辑,改用 lib/pipeline/runner.ts 编排
// lib/pipeline/steps/* 下的 5 个 step。GET / PUT 不动。

import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runPipeline } from "@/lib/pipeline/runner";
import { pipelineDefinition, type PipelineCtx } from "@/lib/pipeline/steps";
import { writeExperimentRecord } from "@/lib/experiments/store";
import type { ExperimentRecord } from "@/lib/schema";
import { uploadDataUrlToR2 } from "@/lib/r2";
import {
  resolve as resolveStrategy,
  list as registryList,
  write as registryWrite,
} from "@/lib/strategies/registry";

// pipeline_id 跟 Phase 2 / 3a 共用 —— 当前只有这一条主 pipeline
const PIPELINE_ID = "vertical_prompt_rewrite_v1";

// 从 schema-shared re-export,保持外部 import 不破
export {
  SearchIntentSchema,
  MediaPromptReviewSchema,
  type SearchIntent,
  type MediaPromptReviewResult,
} from "@/lib/pipeline/schema-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────── Request schema ───────────
const PipelineRequestSchema = z.object({
  query: z.string().min(1, "query 不能为空"),
  // 全局默认模型(向后兼容)。如果 llm_model_search / llm_model_review 没传,就用这个。
  llm_model: z.string().optional(),
  // 两步可以各自指定 LLM 模型 ──
  llm_model_search: z.string().optional(),  // SP1 · search_intent_classification
  llm_model_review: z.string().optional(),  // SP2 · media_prompt_review
  image_model: z.string().optional(),       // Step 3 · generate_media,空 → 默认 "gpt-image-2"
  // 可选：用户上传参考图 URL
  uploaded_image_urls: z.array(z.string()).optional(),
  // CreationPlanner 拆出多少个 function call（mock 用，默认 1）
  function_call_count: z.number().int().min(1).max(6).default(1),
  // 是否调用生图（默认 true）
  do_generate: z.boolean().default(true),
  // 2026-05-13:勾选后跟 reviewed 并发跑一份"直出"(planner 原始 prompt 跳过 SP2),
  // emit direct_* phase,前端写到 result.step3_direct,DirectCompareCard 渲染对比
  also_run_direct: z.boolean().default(false),
});

// ─────────── POST (NDJSON streaming) ───────────
//
// 5 段流式输出: start / step1 / strategy_pack / creation_planner / step2 /
//   step3_start / step3_item_progress / step3_item / step3_done / done(或 fatal)
// 一行一条事件,UTF-8,换行分隔。
// runner 跑完后 done 事件 data 多带 trace 数组(Phase 1 新增,前端暂不消费)。

export async function POST(req: NextRequest) {
  let body: z.infer<typeof PipelineRequestSchema>;
  try {
    const json = await req.json();
    body = PipelineRequestSchema.parse(json);
  } catch (e) {
    return Response.json(
      { error: "request 参数错误", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  const startTotal = Date.now();

  // 2026-05-13:参考图统一上传到 R2 拿公网 URL 再透传给 image gateway。
  // image gateway image-edit endpoint 对 base64 字符串长度有限制 + 部分 Lovart
  // generator 只接 URL,base64 直接塞 body 容易 fail。
  // uploadDataUrlToR2 内部已有 3 次 retry;真用完仍失败直接 400 抛回前端,**不再
  // fallback base64**(老逻辑会让 image gateway 收到 base64 再失败一次,真实根因
  // 被 image-edit 错误盖住,排查困难)
  let referenceImages: string[];
  try {
    referenceImages = await Promise.all(
      (body.uploaded_image_urls ?? []).map((ref) =>
        ref.startsWith("data:")
          ? uploadDataUrlToR2(ref, "pipeline-ref")
          : Promise.resolve(ref),
      ),
    );
  } catch (e) {
    return Response.json(
      {
        error: "参考图上传 R2 失败",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  const initialCtx: PipelineCtx = {
    query: body.query,
    searchModel: body.llm_model_search || body.llm_model,
    reviewModel: body.llm_model_review || body.llm_model,
    imageModel: body.image_model || "gpt-image-2",
    referenceImages,
    functionCallCount: body.function_call_count,
    doGenerate: body.do_generate,
    alsoRunDirect: body.also_run_direct,
    startTotal,
  };

  // 2026-05-13:发起跑批立刻落一份 ExperimentRecord(status=running),让用户在
  // Experiments lab 实时看到这条 run,即使中途切走 / 关 tab 也有 record。跑完 /
  // fatal 时 writeExperimentRecord 第二次覆盖(同 id) → status 变 finished/failed。
  const experimentId = `exp_${randomUUID()}`;
  try {
    const initialRecord: ExperimentRecord = {
      id: experimentId,
      ts: startTotal,
      pipeline_id: PIPELINE_ID,
      source: { kind: "pipeline_lab", run_id: "" },
      inputs: {
        query: body.query,
        function_call_count: body.function_call_count,
      },
      config_snapshot: {
        strategy_versions: {},
        models: {
          search: initialCtx.searchModel ?? "",
          review: initialCtx.reviewModel ?? "",
          image: initialCtx.imageModel,
        },
      },
      output: {},
      trace: [],
      tags: [],
      metadata: { author: "", note: "" },
      status: "running",
    };
    await writeExperimentRecord(initialRecord);
  } catch (e) {
    console.warn(
      "[pipeline route] 立即落盘 running record 失败(不阻塞主流程):",
      e instanceof Error ? e.message : String(e),
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      // step3_item / direct_item 事件不进 ctx(stepGenerateMedia 只 emit 不累积),
      // 这里在 send 包一层捕获,落 ExperimentRecord 时分别作 output.step3 / step3_direct
      const step3Items: Array<Record<string, unknown>> = [];
      const directItems: Array<Record<string, unknown>> = [];
      // creation_planner / strategy_pack 的 emit 事件 data 含 elapsed_ms / llm_model
      // 等 chip 字段,ctx 上只存 function_calls / bullets 主体。落 ExperimentRecord 时
      // 优先用 emit 上来的完整 data 让 replay 卡片显示一致。
      let creationPlannerFullData: Record<string, unknown> | null = null;
      let strategyPackFullData: Record<string, unknown> | null = null;

      // P0 修复(2026-05-12):client 取消请求 / 关 tab 后,controller 状态变 closed,
      // 但 server 端 runPipeline 仍在跑(LLM retry + 生图 10×fib 重试可能 90s+),
      // 跑完后 send() 调 controller.enqueue on closed controller 会抛 ERR_INVALID_STATE,
      // 错误从 saved → save_failed → fatal 三层 send 级联抛,最后 finally 的 close()
      // 也在 already-closed 上再抛。这里用 flag 记一次,后续 send 静默 noop。
      //
      // 注意:LLM / 生图 retry 现在仍会跑完(浪费成本),要真停得把 req.signal.aborted
      // 传到 callLLM / image gateway 里。短期 fix 只解 throw 链路,资源浪费先观察。
      let streamClosed = false;
      const send = (event: { phase: string; data: Record<string, unknown> }) => {
        if (event.phase === "step3_item") {
          step3Items.push(event.data);
        } else if (event.phase === "direct_item") {
          directItems.push(event.data);
        } else if (event.phase === "creation_planner") {
          creationPlannerFullData = event.data;
        } else if (event.phase === "strategy_pack") {
          strategyPackFullData = event.data;
        }
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch (e) {
          // client 断开 / abort → controller.enqueue 抛 TypeError "Invalid state: Controller is already closed"
          if (
            e instanceof TypeError &&
            /closed|aborted/i.test(e.message)
          ) {
            streamClosed = true;
            console.warn(
              `[pipeline route] client 已断开,跳过后续 ${event.phase} 事件(server 端跑批仍会跑完)`,
            );
          } else {
            throw e;
          }
        }
      };
      try {
        send({ phase: "start", data: { query: body.query } });
        // 立刻 emit experiment_saved 让前端"📌 跳到实验记录"按钮亮起,不必等跑完
        send({ phase: "experiment_saved", data: { id: experimentId } });
        const { trace, ctx: finalCtx } = await runPipeline(
          pipelineDefinition,
          initialCtx,
          send,
        );

        // ─── Phase 3a · ExperimentRecord 第二次落盘(覆盖 running 那条) ───
        // 失败不影响主流程(用户已经看到完整结果),只多推一行 saved/failed phase
        try {
          const record: ExperimentRecord = {
            id: experimentId,
            ts: startTotal,
            pipeline_id: PIPELINE_ID,
            source: { kind: "pipeline_lab", run_id: "" },
            inputs: {
              query: body.query,
              function_call_count: body.function_call_count,
            },
            config_snapshot: {
              // strategy_versions: Phase 2 整合后由 step-strategy-pack 写入 ctx,这里读
              strategy_versions: finalCtx.strategyVersions ?? {},
              models: {
                search: initialCtx.searchModel ?? "",
                review: initialCtx.reviewModel ?? "",
                image: initialCtx.imageModel,
              },
            },
            output: {
              step1: finalCtx.step1 ?? null,
              // 2026-05-13 加:落 creation_planner / strategy_pack 才能让 experiments 回放
              // 显示 step2 卡片 + Step3Card 的策略包折叠区,否则 detail 页是空白
              // 优先用 emit data(含 elapsed_ms / llm_model / fallback chip);emit 没收到
              // (例如直接抛异常没 emit)才 fallback ctx 上的瘦版本
              creation_planner:
                creationPlannerFullData ?? finalCtx.creationPlanner ?? null,
              strategy_pack:
                strategyPackFullData ?? finalCtx.strategyPack ?? null,
              step2: finalCtx.step2 ?? null,
              step3: { generations: step3Items },
              // 仅在用户勾选 also_run_direct 时存,老 record 无此字段(前端守卫)
              ...(body.also_run_direct
                ? { step3_direct: { generations: directItems } }
                : {}),
            },
            trace,
            tags: [],
            metadata: { author: "", note: "" },
            status: "finished",
          };
          await writeExperimentRecord(record);
          // experiment_saved 已经在 start 时 emit 过,这里不重复推
        } catch (e) {
          console.warn("[pipeline route] experiment record 落盘失败:", e);
          send({
            phase: "experiment_save_failed",
            data: { error: e instanceof Error ? e.message : String(e) },
          });
        }

        send({
          phase: "done",
          data: {
            total_elapsed_ms: Date.now() - startTotal,
            trace,
            strategy_versions: finalCtx.strategyVersions ?? {},
          },
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        send({
          phase: "fatal",
          data: { error: errMsg },
        });
        // 把"立即落盘的 running record"覆盖成 failed,让 Experiments lab 能看到失败状态
        try {
          const failedRecord: ExperimentRecord = {
            id: experimentId,
            ts: startTotal,
            pipeline_id: PIPELINE_ID,
            source: { kind: "pipeline_lab", run_id: "" },
            inputs: {
              query: body.query,
              function_call_count: body.function_call_count,
            },
            config_snapshot: {
              strategy_versions: {},
              models: {
                search: initialCtx.searchModel ?? "",
                review: initialCtx.reviewModel ?? "",
                image: initialCtx.imageModel,
              },
            },
            output: {
              step1: null,
              creation_planner: creationPlannerFullData,
              strategy_pack: strategyPackFullData,
              step2: null,
              step3: { generations: step3Items },
            },
            trace: [],
            tags: [],
            metadata: { author: "", note: "" },
            status: "failed",
            error: errMsg,
          };
          await writeExperimentRecord(failedRecord);
        } catch (writeErr) {
          console.warn(
            "[pipeline route] fatal 时回写 failed record 失败:",
            writeErr instanceof Error ? writeErr.message : String(writeErr),
          );
        }
      } finally {
        // 同 send 思路:client 断开后 controller 已 closed,close() 再调会抛
        if (!streamClosed) {
          try {
            controller.close();
          } catch {
            /* already closed by abort */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// ─────────── GET · 读 SP + 策略包（用于编辑抽屉） ───────────
//
// 兼容层:Phase 2 之前抽屉走这条统一接口拿 4 份内容。Phase 2 之后底层
// 已经多版本化,这里依然返回旧 shape,但内容统一从 Registry 的 active 版本读出。
// 前端 agent 改造抽屉走 /api/labs/pipeline/strategies|sps/<ns>/<id> 时,这条
// 可以保留也可以删除(取决于 UI 迁移节奏)。

export async function GET() {
  try {
    const [classification, rewrite, vertical, platform] = await Promise.all([
      resolveStrategy("sp-classification"),
      resolveStrategy("sp-rewrite"),
      resolveStrategy("vertical-standard"),
      resolveStrategy("platform-tone"),
    ]);
    return Response.json({
      sps: {
        classification: classification.content,
        rewrite: rewrite.content,
      },
      strategies: {
        vertical_standard: JSON.parse(vertical.content),
        platform_tone: JSON.parse(platform.content),
      },
      // Phase 2 · 额外透出版本号(老前端不消费也无害)
      versions: {
        sp_classification: classification.id,
        sp_rewrite: rewrite.id,
        vertical_standard: vertical.id,
        platform_tone: platform.id,
      },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// ─────────── PUT · 写 SP 或策略包（抽屉自动保存调） ───────────
//
// 兼容层:body 仍是 { kind, name, content },但写盘 = 写当前 active 版本。
// 旧抽屉无版本概念,默认写入用户当前看到的(即 active)版本。
// Phase 2 多版本 UI 完成后,前端应直接调 PUT /api/labs/pipeline/strategies/<ns>/<id>。

const PutBodySchema = z.object({
  kind: z.enum(["sp", "strategy"]),
  name: z.string().min(1),
  content: z.string(),
});

const SP_NAMES = new Set(["classification", "rewrite"]);
const STRATEGY_NAMES = new Set(["vertical_standard", "platform_tone"]);

export async function PUT(req: NextRequest) {
  let body: z.infer<typeof PutBodySchema>;
  try {
    const json = await req.json();
    body = PutBodySchema.parse(json);
  } catch (e) {
    return Response.json(
      { error: "request 参数错误", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  try {
    if (body.kind === "sp") {
      if (!SP_NAMES.has(body.name)) {
        return Response.json({ error: `未知 SP: ${body.name}` }, { status: 400 });
      }
      const ns = body.name === "classification" ? "sp-classification" : "sp-rewrite";
      const idx = await registryList(ns);
      await registryWrite(ns, idx.active, body.content);
      return Response.json({ ok: true, version: idx.active });
    }

    // kind === "strategy"
    if (!STRATEGY_NAMES.has(body.name)) {
      return Response.json({ error: `未知策略: ${body.name}` }, { status: 400 });
    }
    const ns = body.name === "vertical_standard" ? "vertical-standard" : "platform-tone";
    // registry.write 内部已经做合法 JSON 校验,坏内容直接抛
    const idx = await registryList(ns);
    await registryWrite(ns, idx.active, body.content);
    return Response.json({ ok: true, version: idx.active });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
