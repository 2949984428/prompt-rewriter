// prompt-rewriter/app/api/labs/fusion/runs/[id]/route.ts
//
// GET    → 详情(完整 record + 全部 attempts)
// DELETE → 标记 discarded(不真删,留历史可恢复)

import { NextResponse } from "next/server";
import { readRun, patchRecord } from "@/lib/fusion-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const r = await readRun(id);
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ record: r });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const r = await patchRecord(id, { status: "discarded" });
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, record: r });
}
