// prompt-rewriter/app/api/labs/batch/runs/[id]/route.ts
//
// GET    读完整 record(供前端首次拉 + SSE 重连后兜底快照)
// PATCH  局部更新:name / scoring_dimensions / cell_patches[]

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  BatchCellStatusSchema,
  ScoringDimensionSchema,
} from "@/lib/schema";
import {
  patchCell,
  patchRecord,
  readRun,
} from "@/lib/batch-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CellPatchSchema = z.object({
  query_idx: z.number().int().min(0),
  skill_id: z.string().min(1),
  // 多 model 改造后:同 (query_idx, skill_id) 可能有多 cell;此字段空 → 老路径(匹配第一个)
  image_model: z.string().default(""),
  scores: z.record(z.string(), z.number().min(0).max(5)).optional(),
  note: z.string().optional(),
  // 仅允许用户主动改成 excluded(从排行榜剔除)或撤销 excluded(恢复成 done)
  // pending/running/failed 不允许通过 PATCH 改 —— 那是 runner 的状态机
  status: BatchCellStatusSchema.optional(),
});

const PatchSchema = z.object({
  name: z.string().optional(),
  scoring_dimensions: z.array(ScoringDimensionSchema).optional(),
  cell_patches: z.array(CellPatchSchema).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const r = await readRun(id);
  if (!r) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(r);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { name, scoring_dimensions, cell_patches } = parsed.data;

  const current = await readRun(id);
  if (!current) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // record 级 patch
  if (typeof name === "string" || scoring_dimensions) {
    await patchRecord(id, {
      ...(typeof name === "string" ? { name } : {}),
      ...(scoring_dimensions ? { scoring_dimensions } : {}),
    });
  }

  // cell 级 patch:对每条 cell_patch 加白名单校验
  if (cell_patches?.length) {
    for (const cp of cell_patches) {
      // status 仅允许 excluded ↔ done 之间手动切换。其他状态由 runner 控制。
      if (cp.status && cp.status !== "excluded" && cp.status !== "done") {
        return NextResponse.json(
          {
            error: `cell.status 通过 PATCH 仅允许设为 "excluded" 或 "done";收到: ${cp.status}`,
          },
          { status: 400 }
        );
      }
      const partial: Parameters<typeof patchCell>[3] = {};
      if (cp.scores) partial.scores = cp.scores;
      if (typeof cp.note === "string") partial.note = cp.note;
      if (cp.status) partial.status = cp.status;
      await patchCell(id, cp.query_idx, cp.skill_id, partial, cp.image_model);
    }
  }

  const fresh = await readRun(id);
  return NextResponse.json(fresh);
}
