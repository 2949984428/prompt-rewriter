// prompt-rewriter/app/api/questions/tags/route.ts
//
// GET /api/questions/tags  → { tags: [{name, count, qids[]}], total_tagged_questions }

import { NextResponse } from "next/server";
import { listTags } from "@/lib/questions/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await listTags();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
