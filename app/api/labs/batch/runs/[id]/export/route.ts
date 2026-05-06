// prompt-rewriter/app/api/labs/batch/runs/[id]/export/route.ts
//
// GET ?format=auto|html|zip&include_excluded=1
//
//   - format=html  → 返回单文件 .html(图片 base64 内联)
//   - format=zip   → 返回 .zip(index.html + images/ + raw.json + README.md)
//   - format=auto  → 默认。done cell 数 ≤ 32 → html,否则 zip
//
// 文件名约定:<run-name>_<YYYY-MM-DD>.{html,zip}。前端用响应头里的
// Content-Disposition 触发下载。

import { NextResponse } from "next/server";
import { readRun } from "@/lib/batch-store";
import { buildHtml } from "@/lib/export/build-html";
import { buildZip } from "@/lib/export/build-zip";
import { readImageDataUrl } from "@/lib/export/image-loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// auto 模式的"内联 HTML 还能扛"阈值。
// gpt-image-2 1024² PNG ~2MB,base64 inflation 33% → 单 HTML ≈ cell × 2.7MB。
// 8 → ~22MB 单 HTML,IM 能发,浏览器秒开。超过这个数自动走 ZIP。
const AUTO_THRESHOLD = 8;

function safeFilename(name: string): string {
  // 去掉路径符 + 控制字符;保留中文便于人辨认
  const s = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  return s || "batch-export";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await readRun(id);
  if (!run) {
    return new Response("not found", { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const includeExcluded = searchParams.get("include_excluded") === "1";
  const requested = (searchParams.get("format") ?? "auto") as
    | "auto"
    | "html"
    | "zip";

  const visibleCount = run.cells.filter(
    (c) => includeExcluded || c.status !== "excluded"
  ).length;
  const format =
    requested === "auto"
      ? visibleCount <= AUTO_THRESHOLD
        ? "html"
        : "zip"
      : requested;

  const datePart = new Date(run.created_at)
    .toISOString()
    .slice(0, 10); // YYYY-MM-DD
  const baseName = `${safeFilename(run.name || "batch")}_${datePart}`;

  if (format === "html") {
    const html = await buildHtml(run, {
      includeExcluded,
      resolveImageSrc: (cell) => readImageDataUrl(cell.image_urls?.[0]),
    });
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          baseName
        )}.html`,
        "Cache-Control": "no-store",
      },
    });
  }

  // zip
  const buf = await buildZip(run, { includeExcluded, includeRaw: true });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        baseName
      )}.zip`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
}

// 也支持 HEAD 让前端预估大小(粗略 = visible cells × 每图 ~1MB)
// 不真打包,只算元数据。前端可选用,不用也行。
export async function HEAD(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await readRun(id);
  if (!run) return new Response(null, { status: 404 });
  const { searchParams } = new URL(req.url);
  const includeExcluded = searchParams.get("include_excluded") === "1";
  const visibleCount = run.cells.filter(
    (c) => includeExcluded || c.status !== "excluded"
  ).length;
  // 经验:gpt-image-2 1024² PNG ~2MB/张;HTML 内联 base64 多 33%
  const willHtml = visibleCount <= AUTO_THRESHOLD;
  const estBytes = willHtml
    ? visibleCount * 2_700_000
    : visibleCount * 2_000_000;
  return new Response(null, {
    headers: {
      "X-Visible-Cells": String(visibleCount),
      "X-Recommended-Format":
        visibleCount <= AUTO_THRESHOLD ? "html" : "zip",
      "X-Estimated-Bytes": String(estBytes),
    },
  });
}
