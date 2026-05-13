// prompt-rewriter/lib/pipeline/steps/step-search-intent.ts
//
// Step 1 · SP1 · search_intent_classification
//   把用户 query 分类成 vertical/platform 意图。
// retry 约定(plan Part 3.4 的注释结论):
//   - LLM 网络/超时类异常 → 直接抛到 runner,触发 retry(maxAttempts=3, backoff [1s,2s,3s])
//   - schema/JSON 校验失败 → 视为业务错误,写 step1.error,emit step1 事件,return 成功
//     (这样和改造前的 runSearchIntent 行为一致 —— 前端 Step1Card 能渲染错误态)
//   - 想让 retry 也覆盖 schema 失败,把 schema 那段也 throw 出去即可,但前端就看不到 error 了。

import { defineStep } from "@/lib/pipeline/types";
import { callLLM } from "@/lib/llm";
import { parse as besteffortParse } from "best-effort-json-parser";
import { SearchIntentSchema } from "@/lib/pipeline/schema-shared";
import { resolve as resolveStrategy } from "@/lib/strategies/registry";
import type { PipelineCtx } from "./types";

export const stepSearchIntent = defineStep<PipelineCtx>({
  id: "search_intent",
  description: "SP1 · 把用户 query 分类成 vertical/platform 意图",
  retry: { maxAttempts: 3, backoffMs: [1000, 2000, 3000] },
  async run(ctx, emit): Promise<Partial<PipelineCtx>> {
    const t1 = Date.now();
    // Phase 2 · 走 Registry 拿 active 版本(每次跑批 readFile,改完立刻生效)
    const sp1 = await resolveStrategy("sp-classification");
    const sys = sp1.content;
    const user = `用户 query: ${ctx.query}\n\n请输出 SearchIntentResult JSON。`;

    // LLM 调用本身的异常(network/timeout)不 catch,让 runner 按 retry 重试
    const raw = await callLLM(
      [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      ctx.searchModel,
    );

    // 解析 + schema 校验 —— 业务错误,不抛,直接写 step1.error
    let step1: PipelineCtx["step1"];
    const cleaned = extractJsonBlock(raw);
    let parsed: unknown;
    try {
      parsed = besteffortParse(cleaned);
    } catch (e) {
      step1 = {
        intent: null,
        raw,
        error: `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`,
      };
      emit({
        phase: "step1",
        data: {
          search_intent: null,
          raw,
          error: step1.error,
          elapsed_ms: Date.now() - t1,
          llm_model: ctx.searchModel ?? null,
          sp_version: sp1.id,
        },
      });
      return {
        step1,
        strategyVersions: { ...(ctx.strategyVersions ?? {}), sp1: sp1.id },
      };
    }
    const validation = SearchIntentSchema.safeParse(parsed);
    if (!validation.success) {
      step1 = {
        intent: null,
        raw,
        error: `SearchIntent schema 校验失败: ${validation.error.issues
          .map((i) => i.path.join(".") + ": " + i.message)
          .slice(0, 5)
          .join("; ")}`,
      };
    } else {
      step1 = { intent: validation.data, raw };
    }

    emit({
      phase: "step1",
      data: {
        search_intent: step1.intent,
        raw: step1.raw,
        error: step1.error,
        elapsed_ms: Date.now() - t1,
        llm_model: ctx.searchModel ?? null,
        sp_version: sp1.id,
      },
    });

    return {
      step1,
      strategyVersions: { ...(ctx.strategyVersions ?? {}), sp1: sp1.id },
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
