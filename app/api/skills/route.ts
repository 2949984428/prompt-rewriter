// prompt-rewriter/app/api/skills/route.ts
// GET  → 列出所有版本 + active 指针
// POST → 创建新版本(可从 fromId fork)
import { NextResponse } from "next/server";
import { z } from "zod";
import { loadSkillsIndex, createSkill } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateBodySchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i),
  label: z.string().min(1),
  notes: z.string().optional().default(""),
  fromId: z.string().optional(),
});

export async function GET() {
  try {
    const index = await loadSkillsIndex();
    return NextResponse.json(index);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = CreateBodySchema.parse(await req.json());
    const meta = await createSkill(body);
    const index = await loadSkillsIndex();
    return NextResponse.json({ meta, index });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
