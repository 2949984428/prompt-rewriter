// prompt-rewriter/app/api/meta/route.ts
import { NextResponse } from "next/server";
import { loadMeta, saveMeta } from "@/lib/config";
import { MetaSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const meta = await loadMeta();
  return NextResponse.json(meta);
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = MetaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "schema invalid", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    await saveMeta(parsed.data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, meta: parsed.data });
}
