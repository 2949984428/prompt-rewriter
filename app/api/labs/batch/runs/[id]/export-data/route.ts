// prompt-rewriter/app/api/labs/batch/runs/[id]/export-data/route.ts
//
// GET → JSON 包: { csv, filename, stats: {rows_total, uploaded, skipped, failures} }
//   前端 fetch 后:
//     - failures 空 → 直接 Blob 触发下载
//     - failures 非空 → 弹 dialog 列出失败 + 给"继续下载缺图版" / "再试一次"按钮
//
// 为什么不直接 attachment 下载:那样浏览器拿不到失败统计,
//   用户只看到 csv 文件,不知道有图缺;同学拉到的 csv 行少了几条还莫名其妙。
//   走 JSON 包让前端有机会先决策再触发下载。
//
// query 参数:
//   ?mode=local-proxy  (默认) image 列 = http://<本机>/api/image-file/...
//   ?mode=r2                  上传图到 R2,image 列 = R2 公网 URL
//   ?url_base=https://...     local-proxy 下覆盖默认 origin

import { NextResponse } from "next/server";
import { readRun } from "@/lib/batch-store";
import { buildDataCsv } from "@/lib/export/build-data-csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeFilename(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  return s || "batch-data";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await readRun(id);
  if (!run) return new Response("not found", { status: 404 });

  const url = new URL(req.url);
  const mode = (url.searchParams.get("mode") ?? "local-proxy") as
    | "local-proxy"
    | "r2";
  const urlBase = url.searchParams.get("url_base") || url.origin;

  try {
    const result = await buildDataCsv(run, { mode, urlBase });
    const datePart = new Date(run.created_at).toISOString().slice(0, 10);
    const filename = `${safeFilename(run.name || "batch")}_${datePart}_data.csv`;

    return NextResponse.json({
      csv: result.csv,
      filename,
      stats: {
        rows_total: result.rowsTotal,
        uploaded: result.uploaded,
        skipped: result.skipped,
        failures: result.failures,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : String(e),
        hint:
          mode === "r2"
            ? "r2 模式需要 .env.local 配 R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET。重启 dev server 后再试。"
            : undefined,
      },
      { status: 500 }
    );
  }
}
