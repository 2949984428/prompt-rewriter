// prompt-rewriter/app/api/labs/pipeline/strategies/[ns]/[id]/route.ts
//
// 单个版本的读 / 写 / 改元 / 删。
//   GET    → 返回版本内容文本(JSON 字符串原文)
//   PUT    → body 是版本完整内容(text/plain 或 JSON 文本均可)
//   PATCH  → body { label?, notes? } 改元信息
//   DELETE → 删该版本

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  isNamespace,
  patchMeta,
  read,
  remove,
  write,
  type Namespace,
} from "@/lib/strategies/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STRATEGY_NS = ["vertical-standard", "platform-tone"] as const;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/i;

function checkParams(
  rawNs: string,
  rawId: string,
):
  | { ok: true; ns: Namespace; id: string }
  | { ok: false; res: NextResponse } {
  if (!isNamespace(rawNs) || !ALLOWED_STRATEGY_NS.includes(rawNs as never)) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: `unknown strategy namespace: ${rawNs}` },
        { status: 400 },
      ),
    };
  }
  if (!SAFE_ID.test(rawId)) {
    return {
      ok: false,
      res: NextResponse.json({ error: `非法 version id: ${rawId}` }, { status: 400 }),
    };
  }
  return { ok: true, ns: rawNs, id: rawId };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ns: string; id: string }> },
) {
  const { ns: rawNs, id: rawId } = await params;
  const check = checkParams(rawNs, rawId);
  if (!check.ok) return check.res;
  try {
    const content = await read(check.ns, check.id);
    // 返回 JSON 文本(策略类是 .json) —— Content-Type 用 application/json 让浏览器格式化
    return new NextResponse(content, {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 404 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ ns: string; id: string }> },
) {
  const { ns: rawNs, id: rawId } = await params;
  const check = checkParams(rawNs, rawId);
  if (!check.ok) return check.res;
  const body = await req.text();
  try {
    await write(check.ns, check.id, body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

const PatchBodySchema = z.object({
  label: z.string().min(1).optional(),
  notes: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ ns: string; id: string }> },
) {
  const { ns: rawNs, id: rawId } = await params;
  const check = checkParams(rawNs, rawId);
  if (!check.ok) return check.res;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body 不是合法 JSON" }, { status: 400 });
  }
  const parsed = PatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "body 校验失败", detail: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    await patchMeta(check.ns, check.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ ns: string; id: string }> },
) {
  const { ns: rawNs, id: rawId } = await params;
  const check = checkParams(rawNs, rawId);
  if (!check.ok) return check.res;
  try {
    await remove(check.ns, check.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
