// prompt-rewriter/app/api/skills/[id]/activate/route.ts
// POST → 切换 active 版本。成功后返回最新 index。
import { NextResponse } from "next/server";
import { activateSkill, loadSkillsIndex, isSafeSkillId } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!isSafeSkillId(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    await activateSkill(id);
    const index = await loadSkillsIndex();
    return NextResponse.json({ ok: true, index });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
