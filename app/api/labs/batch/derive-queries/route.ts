// prompt-rewriter/app/api/labs/batch/derive-queries/route.ts
//
// 批量测试台模式 A:用户写一段「测试目的」,server 让 LLM 派生 N 条具体 query。
//
// 用 tool calling 强制返回 string[],免 JSON.parse 兜底。

import { NextResponse } from "next/server";
import { z } from "zod";
import { callLLMToolStream, LLMError } from "@/lib/llm";
import { deriveQueriesTool } from "@/lib/tool-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  purpose: z.string().min(1, "测试目的不能为空"),
  n: z.number().int().min(1).max(50, "一次最多派生 50 条"),
  llm_model: z.string().optional(),
});

const SYSTEM = `你是图像生成测试用例的派生器。

# 任务
用户给你一段「测试目的」(可能是场景 / 行业 / 产品形态等)和一个数量 N。
你需要派生 **正好 N 条** 具体的图像生成 query,每条都是用户视角的自然语言指令。

# 多样性约束(同时尽量满足)
- 子场景 / 子品类不同(避免 N 条都在一个角度上重复)
- 构图 / 视觉风格 / 光线条件 至少有 2-3 种不同维度的对照
- 长度从 30 字到 200 字不等,模拟真实用户输入的颗粒度差异
- **不带编号 / 不带前缀**(直接是 query 内容本身)

# 输出
通过工具 \`emit_derived_queries\` 提交 queries 数组,长度严格 = N。`;

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { purpose, n, llm_model } = parsed.data;

  const user = `测试目的:\n\n"""\n${purpose}\n"""\n\n请派生 ${n} 条 query,通过 emit_derived_queries 工具提交。`;

  let raw = "";
  try {
    for await (const delta of callLLMToolStream(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
      deriveQueriesTool,
      llm_model
    )) {
      raw += delta;
    }
    if (!raw.trim()) {
      throw new LLMError("LLM 未通过工具返回任何参数");
    }
    const parsedJson = JSON.parse(raw) as { queries?: unknown };
    if (!Array.isArray(parsedJson.queries)) {
      throw new LLMError("queries 不是数组");
    }
    const queries = parsedJson.queries
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      .map((q) => q.trim());
    if (queries.length === 0) {
      throw new LLMError("派生结果为空");
    }
    // 严格 N 不强制(LLM 偶尔多/少几条),server 截断或保留:多了截断,少了原样返回让用户决定补
    const final = queries.slice(0, n);
    return NextResponse.json({ queries: final, requested_n: n, raw });
  } catch (e) {
    const err = e as LLMError;
    return NextResponse.json(
      { error: err?.message ?? String(e), raw },
      { status: 500 }
    );
  }
}
