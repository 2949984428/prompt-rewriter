// prompt-rewriter/lib/export/image-loader.ts
//
// 把 cell.image_urls[0] (形如 "/api/image-file/<task_id>/<filename>")
// 转回本地 data/images/<task_id>/<filename> 文件路径。
//
// 用于导出时读图字节(打 base64 / 写 zip)。
// 安全:basename 防穿越,跟 app/api/image-file/.../route.ts 同等护栏。

import { promises as fs } from "fs";
import path from "path";

const IMAGES_ROOT = path.join(process.cwd(), "data", "images");
const URL_PREFIX = "/api/image-file/";

export type LocalImageHit = {
  absPath: string;
  ext: string; // "png" | "jpg" | "webp" 等(无前导点)
};

// 解析 url 到本地绝对路径。失败返回 null(url 不是本地图、文件不存在等)
export function resolveLocalImage(url: string | undefined | null): LocalImageHit | null {
  if (!url || !url.startsWith(URL_PREFIX)) return null;
  const rest = url.slice(URL_PREFIX.length);
  const parts = rest.split("/");
  if (parts.length < 2) return null;
  const taskId = path.basename(decodeURIComponent(parts[0]));
  const filename = path.basename(decodeURIComponent(parts.slice(1).join("/")));
  if (!taskId || !filename) return null;
  const abs = path.join(IMAGES_ROOT, taskId, filename);
  if (!abs.startsWith(IMAGES_ROOT + path.sep)) return null;
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  return { absPath: abs, ext };
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function mimeForExt(ext: string): string {
  return MIME[ext.toLowerCase()] ?? "application/octet-stream";
}

// 读图字节;失败(文件丢了 / 权限错)返回 null,让上层显示占位
export async function readImageBytes(
  hit: LocalImageHit
): Promise<Buffer | null> {
  try {
    return await fs.readFile(hit.absPath);
  } catch {
    return null;
  }
}

// 拼成 base64 data URL,直接塞 <img src="...">
export async function readImageDataUrl(url: string | null | undefined): Promise<string | null> {
  const hit = resolveLocalImage(url);
  if (!hit) return null;
  const buf = await readImageBytes(hit);
  if (!buf) return null;
  return `data:${mimeForExt(hit.ext)};base64,${buf.toString("base64")}`;
}
