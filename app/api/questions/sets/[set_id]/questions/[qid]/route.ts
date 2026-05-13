// prompt-rewriter/app/api/questions/sets/[set_id]/questions/[qid]/route.ts
//
// GET   /api/questions/sets/<set_id>/questions/<qid>   → 完整 Question
// PATCH /api/questions/sets/<set_id>/questions/<qid>   body { tags?, note? }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  readQuestionInSet,
  patchQuestionInSet,
} from "@/lib/questions/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  tags: z.array(z.string()).optional(),
  note: z.string().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ set_id: string; qid: string }> },
) {
  const { set_id, qid } = await params;
  const q = await readQuestionInSet(set_id, qid);
  if (!q) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(q);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ set_id: string; qid: string }> },
) {
  const { set_id, qid } = await params;
  let body: z.infer<typeof PatchSchema>;
  try {
    body = PatchSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "invalid body", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
  try {
    const updated = await patchQuestionInSet(set_id, qid, body);
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 404 },
    );
  }
}
