// prompt-rewriter/app/api/labs/batch/runs/[id]/export-blind/route.ts
//
// GET → 下载盲评 ZIP(index.html + images/ + README.md,匿名)。
// 接收方解压后双击 index.html 评分,完成后导出 .json 给作者反向导入。

import { readRun } from "@/lib/batch-store";
import { buildBlindZip } from "@/lib/export/build-blind-zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFilename(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  return s || "batch-blind";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await readRun(id);
  if (!run) {
    return new Response("not found", { status: 404 });
  }
  const buf = await buildBlindZip(run);
  const datePart = new Date(run.created_at).toISOString().slice(0, 10);
  const baseName = `${safeFilename(run.name || "batch")}_${datePart}_blind`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(baseName)}.zip`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
}
