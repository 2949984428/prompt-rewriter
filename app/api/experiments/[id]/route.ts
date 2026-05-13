// prompt-rewriter/app/api/experiments/[id]/route.ts
//
// Phase 3a · ExperimentRecord 详情读取 + PATCH(只允许改 tags / metadata)
//
// DELETE 暂不暴露(plan 红线:不主动暴露破坏性接口,清理走脚本)。

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  readExperimentRecord,
  patchExperimentRecord,
} from "@/lib/experiments/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

const PatchBodySchema = z
  .object({
    tags: z.array(z.string()).optional(),
    metadata: z
      .object({
        author: z.string().optional(),
        replay_of: z.string().optional(),
        note: z.string().optional(),
      })
      .partial()
      .optional(),
  })
  .strict(); // 拒绝任何 tags / metadata 之外的字段

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!SAFE_ID.test(id ?? "")) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const record = await readExperimentRecord(id);
  if (!record) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(record);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!SAFE_ID.test(id ?? "")) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  const parsed = PatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid patch body", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    const updated = await patchExperimentRecord(id, parsed.data);
    return NextResponse.json(updated);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (msg.includes("不存在")) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (msg.includes("非法") || msg.includes("只允许")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("[PATCH /api/experiments/:id] 失败:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
