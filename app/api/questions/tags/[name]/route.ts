// prompt-rewriter/app/api/questions/tags/[name]/route.ts
//
// PATCH  /api/questions/tags/<name>   body { rename_to: string }  → 批量重命名
// DELETE /api/questions/tags/<name>                                → 从所有题目移除

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { renameTag, deleteTag } from "@/lib/questions/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  rename_to: z.string().min(1, "rename_to 不能为空"),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
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
    const result = await renameTag(name, body.rename_to.trim());
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  try {
    const result = await deleteTag(name);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
