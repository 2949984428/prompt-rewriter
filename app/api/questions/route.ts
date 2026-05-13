// prompt-rewriter/app/api/questions/route.ts
//
// GET /api/questions  → 全局题目库概览(给 lab.tsx 顶栏 meta chip 用)
//   { sets_count, total_questions, last_updated_at }
//
// 题目本身列表请走 GET /api/questions/sets/<set_id>/questions

import { NextResponse } from "next/server";
import { listSets } from "@/lib/questions/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sets = await listSets();
    const total_questions = sets.reduce((acc, s) => acc + s.count, 0);
    const last_updated_at = sets.length
      ? sets.reduce((max, s) => (s.updated_at > max ? s.updated_at : max), sets[0].updated_at)
      : null;
    return NextResponse.json({
      sets_count: sets.length,
      total_questions,
      last_updated_at,
      sets,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
