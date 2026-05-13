// prompt-rewriter/lib/pipeline/steps/step-generate-media.ts
//
// Step 5 · generate_media
//   对每个 reviewed.prompt 并发跑生图。runImageWithRetry 内部已有 10 次 fibonacci
//   重试 —— **绝对不在 step 级再叠 retry**(否则最坏 10×3=30 次,无意义)。

import { defineStep } from "@/lib/pipeline/types";
import { runImageWithRetry } from "@/lib/pipeline-image-runner";
import type { PipelineCtx } from "./types";

export const stepGenerateMedia = defineStep<PipelineCtx>({
  id: "generate_media",
  description:
    "对每个 reviewed.prompt 并发跑生图,内部已有 10 次 fibonacci retry,不再叠 step 级 retry",
  // 注意:不在这里加 retry 配置!runImageWithRetry 自己有完整重试逻辑。
  async run(ctx, emit): Promise<Partial<PipelineCtx>> {
    const t3 = Date.now();
    const reviewed = ctx.step2?.result?.reviewed ?? [];
    if (!ctx.doGenerate || reviewed.length === 0) {
      emit({
        phase: "step3_done",
        data: {
          elapsed_ms: 0,
          skipped: !ctx.doGenerate,
          image_model: null,
        },
      });
      return {};
    }

    emit({
      phase: "step3_start",
      data: { count: reviewed.length, image_model: ctx.imageModel },
    });

    // 并发 —— runImageWithRetry 内部 emit step3_item_progress / step3_item
    // size 按 id 反查 ctx.creationPlanner.function_calls(CreationPlanner LLM 推的),
    // 找不到对应 id(理论不可能,SP2 输出 id 来自 planner)fallback 1024x1024
    const sizeById = new Map(
      (ctx.creationPlanner?.function_calls ?? []).map((fc) => [fc.id, fc.size]),
    );

    // ─── 2026-05-13:对比模式 ─────────────────────────────────────
    // 勾选后,同时也跑一份"直出"(跳过 SP2 改写),emit 包一层把 step3_* phase
    // 改写成 direct_*,前端 reducer 写到 result.step3_direct。
    //
    // 直出方案有 2 套实现,通过 DIRECT_MODE 切换:
    //   "query"   —— 当前启用:用用户原始 query + 参考图直出 1 张图,跟 SP2 改写后 N 张对比
    //   "planner" —— 旧方案(2026-05-13 第一版),保留代码备查:用 planner 拆出的 N 个
    //                function_call prompt 各自直出 1 张,跟 SP2 改写一一对应。代码保留在
    //                `_planner_direct_legacy` 块内,切换 DIRECT_MODE 即可启用
    const DIRECT_MODE: "query" | "planner" = "query";
    const fcs = ctx.creationPlanner?.function_calls ?? [];
    const directEmit: typeof emit = (msg) =>
      emit({
        phase: msg.phase.replace(/^step3_/, "direct_"),
        data: msg.data,
      });
    const shouldRunDirect = ctx.alsoRunDirect && fcs.length > 0;
    if (shouldRunDirect) {
      emit({
        phase: "direct_start",
        data: {
          count: DIRECT_MODE === "query" ? 1 : fcs.length,
          image_model: ctx.imageModel,
        },
      });
    }

    const rewrittenPromises = reviewed.map((r) =>
      runImageWithRetry({
        id: r.id,
        prompt: r.prompt,
        imageModel: ctx.imageModel,
        size: sizeById.get(r.id) ?? "1024x1024",
        referenceImages: ctx.referenceImages,
        emit,
        manualRetry: false,
      }),
    );

    // 旧方案保留:planner 拆 N 张,每张用 fc.prompt 直出。切回时把 DIRECT_MODE 改回 "planner"
    const _planner_direct_legacy = () =>
      fcs.map((fc) =>
        runImageWithRetry({
          id: fc.id,
          prompt: fc.prompt,
          imageModel: ctx.imageModel,
          size: fc.size || "1024x1024",
          referenceImages: ctx.referenceImages,
          emit: directEmit,
          manualRetry: false,
        }),
      );

    const directPromises = shouldRunDirect
      ? DIRECT_MODE === "query"
        ? [
            runImageWithRetry({
              id: "direct_query",
              prompt: ctx.query,
              imageModel: ctx.imageModel,
              // 用第一个 fc 的 size,跟扩写第一张保持画幅一致便于对比;无 fc 时 fallback 1024
              size: fcs[0]?.size || "1024x1024",
              referenceImages: ctx.referenceImages,
              emit: directEmit,
              manualRetry: false,
            }),
          ]
        : _planner_direct_legacy()
      : [];
    await Promise.all([...rewrittenPromises, ...directPromises]);

    emit({
      phase: "step3_done",
      data: {
        elapsed_ms: Date.now() - t3,
        skipped: false,
        image_model: ctx.imageModel,
      },
    });
    if (shouldRunDirect) {
      emit({
        phase: "direct_done",
        data: { elapsed_ms: Date.now() - t3, image_model: ctx.imageModel },
      });
    }
    return {};
  },
});
