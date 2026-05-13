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
import { promises as fs } from "fs";
import path from "path";
import { readRun } from "@/lib/batch-store";
import { buildHtml } from "@/lib/export/build-html";
import { buildZip } from "@/lib/export/build-zip";
import { readImageDataUrl } from "@/lib/export/image-loader";
import { listGenerators } from "@/lib/lovart-agent-client";

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

// 读 skill index.json,给导出的 HTML 把 skill_id 转成 display label(F15 Art Direction (EN) 之类)
async function loadSkillLabels(): Promise<Record<string, string>> {
  const skillsIndexPath = path.join(
    process.cwd(),
    "data",
    "labs",
    "format",
    "skills",
    "index.json",
  );
  try {
    const raw = await fs.readFile(skillsIndexPath, "utf8");
    const parsed = JSON.parse(raw) as {
      versions: Array<{ id: string; label: string }>;
    };
    const map: Record<string, string> = {};
    for (const v of parsed.versions ?? []) {
      if (v.id && v.label) map[v.id] = v.label;
    }
    return map;
  } catch (e) {
    console.warn("[export] loadSkillLabels failed:", e);
    return {};
  }
}

// 读 Lovart 生图模型清单 + 内部 IGW gpt-image-2,把 model name 转 display_name
async function loadModelLabels(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  // 内部 IGW gpt-image-2(硬编码,跟 /api/image-generators 行为对齐)
  const igwModel = process.env.IMAGE_MODEL || "gpt-image-2";
  map[igwModel] = igwModel; // 没有显示名,用 id 本身

  try {
    const lovartList = await listGenerators();
    for (const g of lovartList) {
      // Lovart 的 name 形如 "vertex/anon-bob",display_name 形如 "Nano Banana Pro"
      if (g.name && g.display_name) map[g.name] = g.display_name;
    }
  } catch (e) {
    console.warn("[export] loadModelLabels (Lovart) failed:", e);
  }
  return map;
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

  // 加载 labels 一次,html / zip 都用同一份
  const [skillLabels, modelLabels] = await Promise.all([
    loadSkillLabels(),
    loadModelLabels(),
  ]);

  if (format === "html") {
    const html = await buildHtml(run, {
      includeExcluded,
      skillLabels,
      modelLabels,
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
  const buf = await buildZip(run, {
    includeExcluded,
    includeRaw: true,
    skillLabels,
    modelLabels,
  });
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
