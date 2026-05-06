// prompt-rewriter/app/api/labs/batch/runs/route.ts
//
// POST  创建一个 batch run(初始 cells 全 pending,**不自动 start**)
// GET   列出所有 run summary(瘦版,不带 cells)

import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  BatchQueryModeSchema,
  BatchRunRecordSchema,
  ScoringDimensionSchema,
  type BatchCell,
  type BatchRunRecord,
} from "@/lib/schema";
import { listSummaries, writeRun } from "@/lib/batch-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().default(""),
  query_mode: BatchQueryModeSchema,
  // derive 模式:用 purpose,server 应当**已经派生好 queries**(由前端先调 derive-queries 路由)
  // 不在这里再调一次 LLM,避免创建任务这种纯写操作变成"可能很慢"的复合操作。
  // manual / repeat:queries 由前端直接给。
  purpose: z.string().default(""),
  queries: z.array(z.string().min(1)).min(1, "queries 至少 1 条"),
  skill_ids: z.array(z.string().min(1)).min(1, "至少选一个 skill"),
  scoring_dimensions: z.array(ScoringDimensionSchema).default([]),
  rewrite_llm: z.string().default(""),
  // 是否在每条 skill 前注入 _universal.md。默认 true 跟历史行为一致。
  include_universal: z.boolean().default(true),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // 校验 scoring_dimensions id 不重复(record 内唯一)
  const dimIds = new Set<string>();
  for (const d of data.scoring_dimensions) {
    if (dimIds.has(d.id)) {
      return NextResponse.json(
        { error: `评分维度 id 重复: ${d.id}` },
        { status: 400 }
      );
    }
    dimIds.add(d.id);
  }

  // 初始 cells:N×M 个 pending,二维有序展开成一维数组
  const cells: BatchCell[] = [];
  for (let qi = 0; qi < data.queries.length; qi++) {
    for (const sid of data.skill_ids) {
      cells.push({
        query_idx: qi,
        skill_id: sid,
        status: "pending",
        final_prompt: null,
        image_urls: null,
        scores: {},
        note: "",
        error: null,
        raw: "",
        ms: 0,
      });
    }
  }

  const record: BatchRunRecord = BatchRunRecordSchema.parse({
    id: randomUUID(),
    created_at: new Date().toISOString(),
    name: data.name,
    query_mode: data.query_mode,
    purpose: data.purpose,
    queries: data.queries,
    skill_ids: data.skill_ids,
    scoring_dimensions: data.scoring_dimensions,
    cells,
    rewrite_llm: data.rewrite_llm,
    status: "draft",
    include_universal: data.include_universal,
  });

  await writeRun(record);
  return NextResponse.json(record, { status: 201 });
}

export async function GET() {
  const list = await listSummaries();
  return NextResponse.json({ runs: list });
}
