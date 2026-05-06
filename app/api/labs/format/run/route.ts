// prompt-rewriter/app/api/labs/format/run/route.ts
//
// 并发跑 N 路格式改写。
// 输入:  { query: string, skill_ids: string[], llm_model?: string }
// 输出:  { runs: FormatRunResult[], used_llm_model: string }
//
// 这个路由是 format lab 的"单 query × M skill"入口,
// 真正的跑路逻辑被抽到了 lib/format-runner.ts,以便 batch lab(N×M)复用。
// 一路失败不阻塞其他路:Promise.all + runFormatOne 内部 try/catch 保证 N 个返回项总是齐的。

import { NextResponse } from "next/server";
import { z } from "zod";
import { runFormatOne, loadAllLabels } from "@/lib/format-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  query: z.string().min(1, "query 不能为空"),
  skill_ids: z.array(z.string().min(1)).min(1, "至少选一个格式"),
  // 前端"改写模型"下拉值,空 / undefined → 由 lib/llm.ts 用 env LLM_MODEL 兜底
  llm_model: z.string().optional(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { query, skill_ids, llm_model } = parsed.data;
  const labelMap = await loadAllLabels();

  // 实际生效的 llm_model:前端传空时落到 env 默认,这里要算出真值才能 echo 给前端
  const envDefault = process.env.LLM_MODEL ?? "bedrock/claude-sonnet-4-6";
  const usedLlmModel =
    typeof llm_model === "string" && llm_model.trim().length > 0
      ? llm_model.trim()
      : envDefault;

  // 并发跑所有格式(同一 llm_model 透传给每路)
  const runs = await Promise.all(
    skill_ids.map((id) => runFormatOne(query, id, labelMap, llm_model))
  );

  // 兼容老的对外契约:不返回 ms 字段(原 route 没暴露),其他字段保持
  const compatRuns = runs.map(({ ms: _ms, ...rest }) => rest);

  return NextResponse.json({ runs: compatRuns, used_llm_model: usedLlmModel });
}
