// prompt-rewriter/app/api/questions/sets/route.ts
//
// GET /api/questions/sets   → { sets: QuestionSetHead[] }

import { NextResponse } from "next/server";
import { listSets } from "@/lib/questions/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sets = await listSets();
    return NextResponse.json({ sets });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
