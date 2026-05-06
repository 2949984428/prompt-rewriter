// prompt-rewriter/app/api/labs/fusion/runs/[id]/merge/route.ts
//
// POST → 重试一次融合(append 一条新 attempt)。
//        body 可带 hint(决策 7 主路径)和 strategy_request(决策 7 辅助路径)。
//        source_prompt / rule / rewrite_llm 都从已有 record 读,不允许通过这个 endpoint 改 — 改的话另起新 run。

import { NextResponse } from "next/server";
import { z } from "zod";
import { readRun, appendAttempt } from "@/lib/fusion-store";
import { runFusion } from "@/lib/fusion-runner";
import { FusionMergeStrategySchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RetrySchema = z.object({
  hint: z.string().default(""),
  strategy_request: FusionMergeStrategySchema.optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let bodyJson: unknown = {};
  try {
    bodyJson = await req.json();
  } catch {
    bodyJson = {};
  }
  const parsed = RetrySchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const record = await readRun(id);
  if (!record) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const fusion = await runFusion({
    source_prompt: record.source_prompt,
    rule: record.rule,
    strategy_request: parsed.data.strategy_request,
    hint: parsed.data.hint,
    llm_model: record.rewrite_llm || undefined,
  });

  const updated = await appendAttempt(id, {
    timestamp: new Date().toISOString(),
    strategy_request: parsed.data.strategy_request,
    hint: parsed.data.hint,
    result: fusion.result,
    error: fusion.error,
  });
  return NextResponse.json({ ok: true, record: updated });
}
