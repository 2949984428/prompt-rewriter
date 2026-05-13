// prompt-rewriter/app/api/experiments/route.ts
//
// Phase 3a · ExperimentRecord 列表查询
//   GET /api/experiments?pipeline_id=&tag=&q=&limit=50&offset=0
//
// POST 留给 Pipeline 主路由内嵌触发,不在这里暴露。

import { NextResponse } from "next/server";
import { z } from "zod";
import { listExperimentRecords } from "@/lib/experiments/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  pipeline_id: z.string().optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    pipeline_id: url.searchParams.get("pipeline_id") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid query", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    const result = await listExperimentRecords(parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[GET /api/experiments] 失败:", e);
    return NextResponse.json(
      { error: String((e as Error).message ?? e) },
      { status: 500 }
    );
  }
}
