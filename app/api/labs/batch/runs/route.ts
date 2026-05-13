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
  BatchTestKindSchema,
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
  // Skill 批量测试台 schema:skill_ids 至少 1 项
  skill_ids: z.array(z.string()).default([]),
  // 2026-05-13 Phase 2:测试种类(skill / pipeline)
  test_kind: BatchTestKindSchema.default("skill"),
  // Pipeline 测试台 schema:pipeline_ids 至少 1 项(test_kind=pipeline 时)
  pipeline_ids: z.array(z.string()).default([]),
  scoring_dimensions: z.array(ScoringDimensionSchema).default([]),
  rewrite_llm: z.string().default(""),
  // 是否在每条 skill 前注入 _universal.md。默认 true 跟历史行为一致。
  include_universal: z.boolean().default(true),
  // 参考图(base64 data URL 数组)。空 → 文生图;非空 → 全部 cell 走图生图。
  reference_images: z.array(z.string()).max(4).default([]),
  // 方案 C:per-query 参考图(主要给 set 模式从题目集抽 image URL 用)
  per_query_reference_images: z.array(z.array(z.string())).default([]),
  // 生图模型 name。""=IGW 默认(gpt-image-2);"vendor/name"=Lovart Agent。
  image_model: z.string().default(""),
  // 多 model 模式:cells 按 (query × skill × model) 三维笛卡尔积展开。
  // 空数组 → 单 model 模式,只用 image_model 那一个;非空 → 用此列表覆盖。
  image_model_ids: z.array(z.string()).default([]),
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

  // 校验:test_kind 决定要哪个 ids 列表非空
  if (data.test_kind === "skill" && data.skill_ids.length === 0) {
    return NextResponse.json(
      { error: "Skill 测试台必须至少选一个 skill" },
      { status: 400 }
    );
  }
  if (data.test_kind === "pipeline" && data.pipeline_ids.length === 0) {
    return NextResponse.json(
      { error: "Pipeline 测试台必须至少选一个 pipeline" },
      { status: 400 }
    );
  }

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

  // 多 model 模式:image_model_ids 非空 → cells 是 N×M×K 三维笛卡尔积
  // 单 model 模式:image_model_ids 空 → 退化成 N×M(每个 cell.image_model = record.image_model)
  const effModelIds =
    data.image_model_ids.length > 0
      ? data.image_model_ids
      : [data.image_model];

  // 按 test_kind 决定第二维:skill 走 skill_ids,pipeline 走 pipeline_ids
  const cells: BatchCell[] = [];
  const secondDim =
    data.test_kind === "pipeline" ? data.pipeline_ids : data.skill_ids;
  for (let qi = 0; qi < data.queries.length; qi++) {
    for (const id of secondDim) {
      for (const mid of effModelIds) {
        cells.push({
          query_idx: qi,
          skill_id: data.test_kind === "skill" ? id : "",
          pipeline_id: data.test_kind === "pipeline" ? id : "",
          image_model: mid,
          status: "pending",
          final_prompt: null,
          image_urls: null,
          pipeline_outputs: null,
          scores: {},
          note: "",
          error: null,
          raw: "",
          ms: 0,
        });
      }
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
    reference_images: data.reference_images,
    per_query_reference_images: data.per_query_reference_images,
    image_model: data.image_model,
    image_model_ids: data.image_model_ids,
    test_kind: data.test_kind,
    pipeline_ids: data.pipeline_ids,
  });

  await writeRun(record);
  return NextResponse.json(record, { status: 201 });
}

export async function GET() {
  const list = await listSummaries();
  return NextResponse.json({ runs: list });
}
