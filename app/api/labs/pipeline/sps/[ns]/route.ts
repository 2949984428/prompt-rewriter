// prompt-rewriter/app/api/labs/pipeline/sps/[ns]/route.ts
//
// SP namespace 列表与新建。
//   GET  /api/labs/pipeline/sps/<ns>      → 列所有版本(_index.json)
//   POST /api/labs/pipeline/sps/<ns>      → 新建版本(publish)
//
// URL 的 <ns> 直接是 registry namespace（"sp-classification" / "sp-rewrite"）。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  isNamespace,
  list,
  publish,
  type Namespace,
} from "@/lib/strategies/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_SP_NS = [
  "sp-classification",
  "sp-rewrite",
  "sp-creation-planner",
] as const;

function checkSpNs(
  raw: string,
): { ok: true; ns: Namespace } | { ok: false; res: NextResponse } {
  if (!isNamespace(raw) || !ALLOWED_SP_NS.includes(raw as never)) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: `unknown sp namespace: ${raw}` },
        { status: 400 },
      ),
    };
  }
  return { ok: true, ns: raw };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ns: string }> },
) {
  const { ns: rawNs } = await params;
  const check = checkSpNs(rawNs);
  if (!check.ok) return check.res;
  try {
    const idx = await list(check.ns);
    return NextResponse.json(idx);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

const PublishBodySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i),
  label: z.string().min(1),
  notes: z.string().optional(),
  fromId: z.string().optional(),
  author: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ns: string }> },
) {
  const { ns: rawNs } = await params;
  const check = checkSpNs(rawNs);
  if (!check.ok) return check.res;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body 不是合法 JSON" }, { status: 400 });
  }
  const parsed = PublishBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "body 校验失败", detail: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    await publish(check.ns, parsed.data);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
