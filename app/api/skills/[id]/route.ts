// prompt-rewriter/app/api/skills/[id]/route.ts
// GET    → 取某版本的内容(纯 markdown)
// PUT    → 覆盖某版本的内容(body 是 markdown 文本)
// PATCH  → 修改元信息 label / notes
// DELETE → 删除某版本(active / 最后一个不能删)
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  loadSkillById,
  saveSkillById,
  updateSkillMeta,
  deleteSkill,
  loadSkillsIndex,
  isSafeSkillId,
} from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchBodySchema = z.object({
  label: z.string().min(1).optional(),
  notes: z.string().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

function guardId(id: string): string | null {
  return isSafeSkillId(id) ? null : "invalid id";
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const bad = guardId(id);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  try {
    const md = await loadSkillById(id);
    return new NextResponse(md, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const bad = guardId(id);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  const body = await req.text();
  if (!body || body.length > 200_000) {
    return NextResponse.json({ error: "empty or too large" }, { status: 400 });
  }
  try {
    await saveSkillById(id, body);
    return NextResponse.json({ ok: true, bytes: body.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const bad = guardId(id);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  try {
    const patch = PatchBodySchema.parse(await req.json());
    const meta = await updateSkillMeta(id, patch);
    const index = await loadSkillsIndex();
    return NextResponse.json({ meta, index });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const bad = guardId(id);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  try {
    await deleteSkill(id);
    const index = await loadSkillsIndex();
    return NextResponse.json({ ok: true, index });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
