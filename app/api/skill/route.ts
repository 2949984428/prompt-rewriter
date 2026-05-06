// prompt-rewriter/app/api/skill/route.ts
// 向后兼容入口:GET 返回当前 active 版本的内容,PUT 写回 active 版本。
// 真正的版本管理走 /api/skills 系列端点。
import { NextResponse } from "next/server";
import { loadActiveSkill, saveActiveSkill } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { md } = await loadActiveSkill();
    return new NextResponse(md, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const body = await req.text();
  if (!body || body.length > 200_000) {
    return NextResponse.json({ error: "empty or too large" }, { status: 400 });
  }
  try {
    const { id } = await saveActiveSkill(body);
    return NextResponse.json({ ok: true, bytes: body.length, active: id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
