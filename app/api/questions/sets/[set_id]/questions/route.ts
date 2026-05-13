// prompt-rewriter/app/api/questions/sets/[set_id]/questions/route.ts
//
// GET /api/questions/sets/<set_id>/questions?l1=&l2=&q=&tag=&has_images=&limit=&offset=
//   → { items: QuestionHead[], total, set_head }

import { NextRequest, NextResponse } from "next/server";
import { listQuestionsInSet } from "@/lib/questions/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ set_id: string }> },
) {
  const { set_id } = await params;
  const { searchParams } = new URL(req.url);
  const has_images_raw = searchParams.get("has_images");
  const data = await listQuestionsInSet(set_id, {
    l1: searchParams.get("l1") ?? undefined,
    l2: searchParams.get("l2") ?? undefined,
    q: searchParams.get("q") ?? undefined,
    tag: searchParams.get("tag") ?? undefined,
    has_images:
      has_images_raw == null
        ? undefined
        : has_images_raw === "1" || has_images_raw === "true",
    limit: Math.max(1, Math.min(500, Number(searchParams.get("limit") ?? 50))),
    offset: Math.max(0, Number(searchParams.get("offset") ?? 0)),
  });
  if (!data.set_head) {
    return NextResponse.json({ error: "set not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
