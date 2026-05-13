// prompt-rewriter/app/api/labs/pipeline/sps/[ns]/[id]/activate/route.ts
//
// 把某 SP 版本设为 active。
//   POST /api/labs/pipeline/sps/<ns>/<id>/activate

import { NextRequest, NextResponse } from "next/server";
import { activate, isNamespace, type Namespace } from "@/lib/strategies/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_SP_NS = [
  "sp-classification",
  "sp-rewrite",
  "sp-creation-planner",
] as const;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/i;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ ns: string; id: string }> },
) {
  const { ns: rawNs, id: rawId } = await params;
  if (!isNamespace(rawNs) || !ALLOWED_SP_NS.includes(rawNs as never)) {
    return NextResponse.json(
      { error: `unknown sp namespace: ${rawNs}` },
      { status: 400 },
    );
  }
  if (!SAFE_ID.test(rawId)) {
    return NextResponse.json({ error: `非法 version id: ${rawId}` }, { status: 400 });
  }
  try {
    await activate(rawNs as Namespace, rawId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
