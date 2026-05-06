// prompt-rewriter/app/api/labs/format/skill/[id]/route.ts
//
// GET 单个格式 skill 的 markdown 内容。供未来抽屉编辑器使用(P5+)。
// 路径硬化防穿越:用 path.basename 打掉所有目录前缀。

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.join(process.cwd(), "data", "labs", "format", "skills");

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const safe = path.basename(id ?? "");
  if (!safe) {
    return new Response("bad id", { status: 400 });
  }
  const filepath = path.join(ROOT, `${safe}.md`);
  if (!filepath.startsWith(ROOT + path.sep)) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const text = await fs.readFile(filepath, "utf-8");
    return new NextResponse(text, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

// PUT 覆写整份 skill md (供抽屉编辑器实时持久化)。
// 路径硬化同 GET;只允许覆盖已有版本文件,不接受新建(避免误创空文件)。
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const safe = path.basename(id ?? "");
  if (!safe) return new Response("bad id", { status: 400 });

  const body = await req.text();
  if (!body || body.length > 200_000) {
    return new Response("empty or too large", { status: 400 });
  }

  const filepath = path.join(ROOT, `${safe}.md`);
  if (!filepath.startsWith(ROOT + path.sep)) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    // 只允许覆盖已存在文件(防 PUT 创建未注册的随机 id)
    await fs.access(filepath);
  } catch {
    return new Response("不存在的 skill 版本", { status: 404 });
  }
  await fs.writeFile(filepath, body, "utf-8");
  return Response.json({ ok: true, bytes: body.length });
}
