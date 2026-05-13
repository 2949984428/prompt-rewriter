// prompt-rewriter/app/api/questions/sets/[set_id]/route.ts
//
// GET    /api/questions/sets/<set_id>   → 完整 QuestionSet(含 questions[])
// PATCH  /api/questions/sets/<set_id>   body { name?, description? }
// DELETE /api/questions/sets/<set_id>   → 删除整个题目集

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readSet, patchSet, deleteSet } from "@/lib/questions/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ set_id: string }> },
) {
  const { set_id } = await params;
  const set = await readSet(set_id);
  if (!set) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(set);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ set_id: string }> },
) {
  const { set_id } = await params;
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
    const head = await patchSet(set_id, body);
    return NextResponse.json(head);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 404 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ set_id: string }> },
) {
  const { set_id } = await params;
  try {
    const r = await deleteSet(set_id);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
