// prompt-rewriter/app/api/labs/fusion/runs/route.ts
//
// POST → 创建融合 run + 立刻跑首次融合(同步,LLM ~20s)
//        创建即跑因为没有"先 draft 再点 start"的两步心智需求 — PM 提交即等结果。
//        失败的 attempt 也会落盘(error 字段),让 PM 看到失败原因 + 重试。
// GET  → 列表

import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { writeRun, listSummaries } from "@/lib/fusion-store";
import { runFusion } from "@/lib/fusion-runner";
import {
  FusionRuleSourceSchema,
  FusionMergeStrategySchema,
  type FusionRunRecord,
} from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().default(""),
  source_prompt: z.string().min(1, "source_prompt 不能为空"),
  rule: FusionRuleSourceSchema,
  strategy_request: FusionMergeStrategySchema.optional(),
  rewrite_llm: z.string().default(""),
});

export async function POST(req: Request) {
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { name, source_prompt, rule, strategy_request, rewrite_llm } = parsed.data;

  // 立刻跑首次融合(同步等结果)
  const fusion = await runFusion({
    source_prompt,
    rule,
    strategy_request,
    llm_model: rewrite_llm || undefined,
  });

  const id = crypto.randomUUID();
  const record: FusionRunRecord = {
    id,
    created_at: new Date().toISOString(),
    name,
    source_prompt,
    rule,
    rewrite_llm,
    attempts: [
      {
        timestamp: new Date().toISOString(),
        strategy_request,
        hint: "",
        result: fusion.result,
        error: fusion.error,
      },
    ],
    status: fusion.result ? "ready" : "draft",
  };
  await writeRun(record);
  return NextResponse.json({ ok: true, id, record }, { status: 201 });
}

export async function GET() {
  const runs = await listSummaries();
  return NextResponse.json({ runs });
}
