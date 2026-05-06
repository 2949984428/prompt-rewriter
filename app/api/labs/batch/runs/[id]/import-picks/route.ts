// prompt-rewriter/app/api/labs/batch/runs/[id]/import-picks/route.ts
//
// POST body = 接收方导出的盲评 .json
//   {
//     run_id: string,         // 必须跟当前 id 一致
//     reviewer?: string,
//     exported_at?: string,
//     picks: { "0": "q1-p3", "1": "q2-p1", ... }   // queryIdx 字符串 → anon_id
//   }
//
// 流程:
//   1. 校验 run_id 匹配
//   2. 重算 anon mapping(deterministic,完全无状态)
//   3. 把 anon_id 翻回 skill_id,组成 ExternalPicks 写到 record.external_picks
//   4. 整段覆盖(同 reviewer 多次提交以最新一份为准)
//
// 反向映射失败(anon_id 不在当前 mapping 里)的项跳过 + 报告。

import { NextResponse } from "next/server";
import { z } from "zod";
import { readRun, writeRun } from "@/lib/batch-store";
import { buildAnonMapping } from "@/lib/export/anon-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  run_id: z.string().min(1),
  reviewer: z.string().default(""),
  exported_at: z.string().optional(),
  // queryIdx 字符串 → anon_id
  picks: z.record(z.string(), z.string()),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { run_id, reviewer, picks } = parsed.data;

  const run = await readRun(id);
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  if (run_id !== run.id) {
    return NextResponse.json(
      {
        error: `run_id 不匹配:导入文件标的是 ${run_id},当前 run 是 ${run.id}。请确认是不是错配文件。`,
      },
      { status: 400 }
    );
  }

  const mapping = buildAnonMapping(run);
  const translated: Record<string, string> = {}; // queryIdx → skill_id
  const skipped: { query_idx: string; anon_id: string; reason: string }[] = [];

  for (const [qiStr, anonId] of Object.entries(picks)) {
    const qi = Number(qiStr);
    const cell = mapping.anonToCell.get(anonId);
    if (!cell) {
      skipped.push({
        query_idx: qiStr,
        anon_id: anonId,
        reason: `anon_id 在当前 mapping 里找不到(可能 skill 列表变过)`,
      });
      continue;
    }
    if (cell.query_idx !== qi) {
      skipped.push({
        query_idx: qiStr,
        anon_id: anonId,
        reason: `anon_id 属于 Q${cell.query_idx + 1},但 picks key 写的是 Q${qi + 1}`,
      });
      continue;
    }
    translated[qiStr] = cell.skill_id;
  }

  const updated = {
    ...run,
    external_picks: {
      reviewer,
      imported_at: new Date().toISOString(),
      picks: translated,
    },
  };
  await writeRun(updated);

  return NextResponse.json({
    ok: true,
    imported: Object.keys(translated).length,
    skipped_count: skipped.length,
    skipped,
    reviewer,
  });
}
