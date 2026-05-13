// prompt-rewriter/lib/pipeline/steps/step-media-review.ts
//
// Step 4 · SP2 · media_prompt_review
//   把策略包注入 SP2 system 末尾 # Active Blocks,跑改写产出 reviewed[]。
// retry 约定(同 step-search-intent):
//   - LLM 网络/超时异常 → 直接抛,runner retry(maxAttempts=3, backoff [1s,2s,3s])
//   - JSON 解析 / schema 校验失败 → 业务错误,写 step2.error,emit step2 事件,return 成功
//     (和改造前一致,保证前端 Step2Card 能渲染错误态)

import { defineStep } from "@/lib/pipeline/types";
import { callLLM } from "@/lib/llm";
import { parse as besteffortParse } from "best-effort-json-parser";
import { MediaPromptReviewSchema } from "@/lib/pipeline/schema-shared";
import { resolve as resolveStrategy } from "@/lib/strategies/registry";
import type { PipelineCtx } from "./types";

export const stepMediaReview = defineStep<PipelineCtx>({
  id: "media_review",
  description: "SP2 · 把策略包注入 system,跑改写产出 reviewed[]",
  retry: { maxAttempts: 3, backoffMs: [1000, 2000, 3000] },
  async run(ctx, emit): Promise<Partial<PipelineCtx>> {
    const t = Date.now();
    const strategyPack = ctx.strategyPack!;
    const functionCalls = ctx.creationPlanner?.function_calls ?? [];

    // ─── 把 standards / tone bullets 注入到 SP2 system 末尾 # Active Blocks 段 ───
    // 抽屉 UI 是单 textarea 按 \n 切分,可能含空字符串,注入前过滤掉避免空 bullet
    const verticalLines = strategyPack.vertical_standard.standards
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const platformLines = strategyPack.platform_tone.tone
      .map((tt) => tt.trim())
      .filter((tt) => tt.length > 0);

    const verticalBullets =
      verticalLines.length > 0
        ? verticalLines.map((s) => `- ${s}`).join("\n")
        : "_(none for this task)_";
    const platformBullets =
      platformLines.length > 0
        ? platformLines.map((tt) => `- ${tt}`).join("\n")
        : "_(none for this task)_";

    // Phase 2 · 走 Registry 拿 active 版本(每次跑批 readFile,改完立刻生效)
    const sp2 = await resolveStrategy("sp-rewrite");
    const spTemplate = sp2.content;
    const sys = spTemplate
      .replaceAll(
        "{{LOVART_ACTIVE_VERTICAL}}",
        strategyPack.vertical_standard.vertical,
      )
      .replaceAll(
        "{{LOVART_ACTIVE_VERTICAL_LABEL}}",
        strategyPack.vertical_standard.label ?? "",
      )
      .replaceAll("{{LOVART_ACTIVE_VERTICAL_BULLETS}}", verticalBullets)
      .replaceAll(
        "{{LOVART_ACTIVE_PLATFORM}}",
        strategyPack.platform_tone.platform,
      )
      .replaceAll(
        "{{LOVART_ACTIVE_PLATFORM_LABEL}}",
        strategyPack.platform_tone.label ?? "",
      )
      .replaceAll("{{LOVART_ACTIVE_PLATFORM_BULLETS}}", platformBullets);

    // user content 只放 query / items / search intent(策略 bullets 在 system 里)
    const items = functionCalls.map((fc) => ({
      id: fc.id,
      tool: "generate_media" as const,
      prompt: fc.prompt,
    }));
    const userParts: string[] = [];
    userParts.push(`## Recent conversation\n[user]: ${ctx.query}`);
    userParts.push(
      `## Original prompts\n${JSON.stringify({ items }, null, 2)}`,
    );
    if (ctx.step1?.intent) {
      userParts.push(
        `## Search Intent (上游分类输出)\n${JSON.stringify(
          ctx.step1.intent,
          null,
          2,
        )}`,
      );
    }
    const user = userParts.join("\n\n");

    // LLM 调用本身不 catch,让 runner 按 retry 重试
    const raw = await callLLM(
      [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      ctx.reviewModel,
    );

    // 解析 + schema 校验 —— 业务错误走 error 字段
    let step2: PipelineCtx["step2"];
    const cleaned = extractJsonBlock(raw);
    let parsed: unknown;
    try {
      parsed = besteffortParse(cleaned);
    } catch (e) {
      step2 = {
        result: null,
        raw,
        composed_system: sys,
        error: `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`,
      };
      emit({
        phase: "step2",
        data: {
          review_result: null,
          raw,
          composed_system: sys,
          error: step2.error,
          elapsed_ms: Date.now() - t,
          llm_model: ctx.reviewModel ?? null,
          sp_version: sp2.id,
        },
      });
      return {
        step2,
        strategyVersions: { ...(ctx.strategyVersions ?? {}), sp2: sp2.id },
      };
    }
    const validation = MediaPromptReviewSchema.safeParse(parsed);
    if (!validation.success) {
      step2 = {
        result: null,
        raw,
        composed_system: sys,
        error: `MediaPromptReview schema 校验失败: ${validation.error.issues
          .map((i) => i.path.join(".") + ": " + i.message)
          .slice(0, 5)
          .join("; ")}`,
      };
    } else {
      step2 = { result: validation.data, raw, composed_system: sys };
    }

    emit({
      phase: "step2",
      data: {
        review_result: step2.result,
        raw: step2.raw,
        composed_system: step2.composed_system,
        error: step2.error,
        elapsed_ms: Date.now() - t,
        llm_model: ctx.reviewModel ?? null,
        sp_version: sp2.id,
      },
    });

    return {
      step2,
      strategyVersions: { ...(ctx.strategyVersions ?? {}), sp2: sp2.id },
    };
  },
});

function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  return text.trim();
}
