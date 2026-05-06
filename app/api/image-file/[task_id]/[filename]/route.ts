// prompt-rewriter/app/api/image-file/[task_id]/[filename]/route.ts
//
// 本地静态 serve `data/images/<task_id>/<filename>`。
// data/ 不在 public/ 下不会被 Next.js 自动暴露,所以加这个轻量路由代理。
//
// 安全:
//   - 严禁路径遍历(filename 不能含 / 或 ..),用 path.basename 打掉所有目录前缀
//   - task_id 同样过 basename
//   - 只有真实落在 data/images/ 下的文件能 serve

import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.join(process.cwd(), "data", "images");

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ task_id: string; filename: string }> }
) {
  const { task_id, filename } = await params;
  // 路径硬化:打掉任何目录穿越
  const safeTask = path.basename(task_id ?? "");
  const safeFile = path.basename(filename ?? "");
  if (!safeTask || !safeFile) {
    return new Response("bad path", { status: 400 });
  }
  const full = path.join(ROOT, safeTask, safeFile);
  // 防止 symlink 等绕开:确认真实路径仍在 ROOT 下
  if (!full.startsWith(ROOT + path.sep)) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const buf = await fs.readFile(full);
    const ext = (safeFile.split(".").pop() ?? "").toLowerCase();
    const mime = MIME[ext] ?? "application/octet-stream";
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": mime,
        // 落盘后内容不再变,可以长缓存
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
