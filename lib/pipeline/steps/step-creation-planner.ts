// prompt-rewriter/lib/pipeline/steps/step-creation-planner.ts
//
// Step 3 · CreationPlanner(2026-05-12 从 mock 升级真 LLM 推理)
//   走 ctx.searchModel(默认 Gemini 3 Flash,跟 SP1 同源)
//   输入:用户 query + N(function_call_count) + (可选)SP1 输出的 search_intent
//   输出:N 个 function_call,每个含 prompt + size
//   size 启发式抄 F11-direct-api(显式比例 / 用途词 / 内容类型 / 方向词)
//
// 失败兜底:LLM 调用 / JSON / schema 失败 → fallback mock(原 mock 逻辑)+ size="1024x1024"
//   这样跑批永远不会因为 planner 失败卡住。
// retry 约定跟 SP1 / SP2 对齐:LLM 网络异常 throw → runner retry 3 次

import { defineStep } from "@/lib/pipeline/types";
import { callLLM } from "@/lib/llm";
import { parse as besteffortParse } from "best-effort-json-parser";
import { z } from "zod";
import { resolve as resolveStrategy } from "@/lib/strategies/registry";
import type { PipelineCtx } from "./types";

// LLM 输出 schema(server 端补 id,LLM 不必生成)
const PlannerLLMOutputSchema = z.object({
  function_calls: z
    .array(
      z.object({
        prompt: z.string().min(1),
        size: z.string().min(1),
      }),
    )
    .min(1),
});

export const stepCreationPlanner = defineStep<PipelineCtx>({
  id: "creation_planner",
  description: "Gemini 3 拆 N 个 function_call 草稿,各自含 prompt + size(启发式)",
  retry: { maxAttempts: 3, backoffMs: [1000, 2000, 3000] },
  async run(ctx, emit): Promise<Partial<PipelineCtx>> {
    const t = Date.now();
    const sp = await resolveStrategy("sp-creation-planner");
    const sys = sp.content;

    // user content:query + N + 可选 search_intent
    const userParts: string[] = [
      `用户 query: ${ctx.query}`,
      `function_call_count N: ${ctx.functionCallCount}`,
    ];
    if (ctx.step1?.intent) {
      userParts.push(
        `Search Intent (上游分类输出): ${JSON.stringify(ctx.step1.intent)}`,
      );
    }
    userParts.push("请输出 function_calls JSON。");
    const user = userParts.join("\n\n");

    // LLM 网络异常不 catch,让 runner retry
    const raw = await callLLM(
      [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      ctx.searchModel, // 复用 SP1 model(Gemini 3 Flash)
    );

    // 解析 + schema 校验 → 业务错误走 fallback mock(不抛,保证后续 step 能跑)
    let functionCalls: Array<{ id: string; prompt: string; size: string }>;
    let fallbackReason: string | null = null;

    try {
      const cleaned = extractJsonBlock(raw);
      const parsed = besteffortParse(cleaned);
      const validation = PlannerLLMOutputSchema.safeParse(parsed);
      if (!validation.success) {
        throw new Error(
          `Planner schema 校验失败: ${validation.error.issues
            .map((i) => i.path.join(".") + ": " + i.message)
            .slice(0, 3)
            .join("; ")}`,
        );
      }
      const llmCalls = validation.data.function_calls;
      // 严格按 N 截断 / 补齐
      const targetN = ctx.functionCallCount;
      const trimmed = llmCalls.slice(0, targetN);
      while (trimmed.length < targetN) {
        // LLM 给少了,用 query + 安全 size 补齐
        trimmed.push({
          prompt: ctx.query,
          size: "1024x1024",
        });
      }
      functionCalls = trimmed.map((fc) => ({
        id: `call_${randomHex(16)}`,
        prompt: fc.prompt,
        size: normalizeSize(fc.size),
      }));
    } catch (e) {
      // fallback mock(原 mock 逻辑):N=1 直接 query,N>1 加 (function i/N) 后缀
      fallbackReason = e instanceof Error ? e.message : String(e);
      console.warn(
        `[step-creation-planner] LLM 推理失败,fallback mock:${fallbackReason}`,
      );
      functionCalls = mockFallback(ctx.query, ctx.functionCallCount);
    }

    emit({
      phase: "creation_planner",
      data: {
        function_calls: functionCalls,
        elapsed_ms: Date.now() - t,
        llm_model: ctx.searchModel ?? null,
        sp_version: sp.id,
        fallback: fallbackReason,
      },
    });

    return {
      creationPlanner: { function_calls: functionCalls },
      strategyVersions: {
        ...(ctx.strategyVersions ?? {}),
        planner: sp.id,
      },
    };
  },
});

// ── 工具 ──

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

function randomHex(len: number): string {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

// IGW + minimax 都接受的 size 白名单。LLM 偶尔会输出超出枚举的值,这里兜底归一
const VALID_SIZES = new Set([
  "1024x1024",
  "2048x2048",
  "1536x1024",
  "1024x1536",
  "1792x1008",
  "1008x1792",
  "1536x1152",
  "1152x1536",
]);
function normalizeSize(s: string): string {
  const cleaned = s.trim().toLowerCase().replace(/×/g, "x");
  if (VALID_SIZES.has(cleaned)) return cleaned;
  // "auto" / 不合法值 → 安全公约 1024x1024(minimax 接受)
  return "1024x1024";
}

// 老 mock 兜底逻辑(LLM 失败时用)
function mockFallback(
  query: string,
  count: number,
): Array<{ id: string; prompt: string; size: string }> {
  const arr: Array<{ id: string; prompt: string; size: string }> = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      id: `call_${randomHex(16)}`,
      prompt: count === 1 ? query : `${query} (function ${i + 1}/${count})`,
      size: "1024x1024",
    });
  }
  return arr;
}
