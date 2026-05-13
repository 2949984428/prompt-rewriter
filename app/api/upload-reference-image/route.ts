// prompt-rewriter/app/api/upload-reference-image/route.ts
//
// 上传图生图参考图。
// 客户端 POST multipart/form-data 一张图 → 服务端落到 data/uploads/ → 返回 url。
// 之后客户端把这个 url 透传给生图网关（image-edit body 的 image 字段接 URL）。
//
// 落盘命名：<sha1(content)>.<ext>，去重避免同图重复传。
// public 路径：/api/image-file/...（已有的图像文件代理路由）。

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.cwd();
const UPLOAD_DIR = path.join(ROOT, "data", "uploads");

// 5 MB 单图上限，gpt-image-2 image-edit 对单图大小有上限
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "webp"]);

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "empty file" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `file too large: ${file.size} > ${MAX_BYTES}` },
        { status: 413 }
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());

    // 后缀从原 filename 推断；非白名单类型拒绝
    const origName = (file.name || "").toLowerCase();
    const ext = origName.split(".").pop() || "png";
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json(
        { error: `unsupported ext: ${ext}` },
        { status: 415 }
      );
    }

    const hash = crypto.createHash("sha1").update(buf).digest("hex");
    const filename = `${hash}.${ext}`;
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const dest = path.join(UPLOAD_DIR, filename);
    // 已存在直接复用，不重复写
    try {
      await fs.access(dest);
    } catch {
      await fs.writeFile(dest, buf);
    }

    // 返回相对 vault 的路径（前端拼成完整 URL 给生图网关）
    return NextResponse.json({
      ok: true,
      path: `data/uploads/${filename}`,
      url: `/api/image-file?path=${encodeURIComponent(`data/uploads/${filename}`)}`,
      bytes: buf.length,
      ext,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `upload failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }
}
