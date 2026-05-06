// prompt-rewriter/lib/image-store.ts
//
// 把 image-gateway 返回的临时 url 下载并落盘到 data/images/<task_id>/<n>.<ext>。
// 防 gateway expire 后历史图片 404、事后无法复盘。
//
// 设计:
//   - 幂等:同一 task_id 同一 index 已存在就跳过下载,直接返回 local 路径
//   - 扩展名优先级:url 后缀 → response Content-Type → 默认 png
//   - 失败不抛:某张下载失败只 console.warn,其他张照常返回。让 history 至少留下能拿到的部分。

import { promises as fs } from "fs";
import path from "path";

const DIR = path.join(process.cwd(), "data", "images");

function extFromUrl(u: string): string | null {
  const m = u.match(/\.(png|jpe?g|webp)(?:\?|$)/i);
  if (!m) return null;
  const e = m[1].toLowerCase();
  return e === "jpeg" ? "jpg" : e;
}

function extFromContentType(ct: string): string {
  const c = ct.toLowerCase();
  if (c.includes("png")) return "png";
  if (c.includes("jpeg") || c.includes("jpg")) return "jpg";
  if (c.includes("webp")) return "webp";
  return "png";
}

/**
 * 把一组 url 全部下载到 data/images/<taskId>/。
 * 返回前端可访问的相对路径列表(指向 /api/image-file/...),与 urls 一一对应。
 * 某张失败时该位用空串占位,前端可 fallback 回原 url。
 */
export async function saveImageBytes(
  taskId: string,
  urls: string[]
): Promise<string[]> {
  if (!taskId || !urls.length) return [];
  const dir = path.join(DIR, taskId);
  await fs.mkdir(dir, { recursive: true });

  const out: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    if (!u) {
      out.push("");
      continue;
    }
    try {
      // 文件名预生成,优先用 url 后缀(命中率高 + 不要先发 HEAD)
      const guessExt = extFromUrl(u);
      const tentative = `${i}.${guessExt ?? "png"}`;
      const tentativePath = path.join(dir, tentative);

      // 已存在直接跳过(常见:轮询多次 / 重新挂载)
      try {
        await fs.access(tentativePath);
        out.push(`/api/image-file/${encodeURIComponent(taskId)}/${tentative}`);
        continue;
      } catch {
        // 不存在,继续下载
      }

      const resp = await fetch(u);
      if (!resp.ok) {
        console.warn(`[image-store] download failed ${u} status ${resp.status}`);
        out.push("");
        continue;
      }
      // 若 url 没后缀,用 Content-Type 修正扩展名
      const ext = guessExt ?? extFromContentType(resp.headers.get("content-type") ?? "");
      const filename = `${i}.${ext}`;
      const filepath = path.join(dir, filename);

      const buf = Buffer.from(await resp.arrayBuffer());
      await fs.writeFile(filepath, buf);
      out.push(`/api/image-file/${encodeURIComponent(taskId)}/${filename}`);
    } catch (e) {
      console.warn(`[image-store] save failed for ${u}:`, e);
      out.push("");
    }
  }
  return out;
}
