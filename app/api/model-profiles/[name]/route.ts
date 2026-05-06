// prompt-rewriter/app/api/model-profiles/[name]/route.ts
import { NextResponse } from "next/server";
import {
  isSafeProfileName,
  loadModelProfile,
  saveModelProfile,
  deleteModelProfile,
} from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { name } = await params;
  if (!isSafeProfileName(name)) {
    return NextResponse.json({ error: "invalid profile name" }, { status: 400 });
  }
  const md = await loadModelProfile(name);
  return new NextResponse(md, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

export async function PUT(req: Request, { params }: Ctx) {
  const { name } = await params;
  if (!isSafeProfileName(name)) {
    return NextResponse.json({ error: "invalid profile name" }, { status: 400 });
  }
  const body = await req.text();
  try {
    await saveModelProfile(name, body);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, bytes: body.length });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { name } = await params;
  if (!isSafeProfileName(name)) {
    return NextResponse.json({ error: "invalid profile name" }, { status: 400 });
  }
  try {
    await deleteModelProfile(name);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true });
}
