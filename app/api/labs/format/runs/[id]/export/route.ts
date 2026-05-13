// prompt-rewriter/app/api/labs/format/runs/[id]/export/route.ts
//
// API 测试台(format)的导出 route,镜像 batch 那一份。
//   - format=html → 单文件 HTML(图 base64 内联)
//   - format=zip  → ZIP(index.html + images/ + raw.json + README.md)
//   - format=auto → 默认。done cell ≤ 8 → html,否则 zip
//
// 内部把 FormatRunRecord → BatchRunRecord-like 后复用 lib/export/build-html.ts,
// 这样矩阵 UI(query × skill × model + 切 tab + 排行榜)三个测试台共用一份。
//
// 文件名:<query 前 30 字>_<YYYY-MM-DD>.{html,zip}

import { promises as fs } from "fs";
import path from "path";
import { buildHtml } from "@/lib/export/build-html";
import { buildZip } from "@/lib/export/build-zip";
import { readImageDataUrl } from "@/lib/export/image-loader";
import { listGenerators } from "@/lib/lovart-agent-client";
import { FormatRunRecordSchema } from "@/lib/schema-format";
import {
  formatRunRecordToBatchRunRecord,
  extractSkillLabelsFromFormat,
} from "@/lib/export/format-to-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTO_THRESHOLD = 8;

function safeFilename(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  return s || "format-export";
}

async function readFormatRun(id: string): Promise<unknown> {
  const filepath = path.join(
    process.cwd(),
    "data",
    "labs",
    "format",
    "runs",
    `${id}.json`,
  );
  try {
    const raw = await fs.readFile(filepath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 内部 IGW gpt-image-2 + Lovart 模型 display_name 映射
async function loadModelLabels(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const igw = process.env.IMAGE_MODEL || "gpt-image-2";
  map[igw] = igw;
  try {
    const lovartList = await listGenerators();
    for (const g of lovartList) {
      if (g.name && g.display_name) map[g.name] = g.display_name;
    }
  } catch (e) {
    console.warn("[format-export] loadModelLabels(Lovart) failed:", e);
  }
  return map;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const raw = await readFormatRun(id);
  if (!raw) return new Response("not found", { status: 404 });

  // 用 safeParse 容错(老 record 可能字段不全)
  const parsed = FormatRunRecordSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[format-export] schema parse failed:", parsed.error.issues.slice(0, 3));
    return new Response("invalid record schema", { status: 422 });
  }
  const fr = parsed.data;

  const { searchParams } = new URL(req.url);
  const includeExcluded = searchParams.get("include_excluded") === "1";
  const requested = (searchParams.get("format") ?? "auto") as
    | "auto"
    | "html"
    | "zip";

  // 把 FormatRunRecord adapter 成 BatchRunRecord-like
  const run = formatRunRecordToBatchRunRecord(fr);

  // adapter 也抽了 skill_id → format_label 映射,直接传给 buildHtml(skillLabels)
  const skillLabels = extractSkillLabelsFromFormat(fr);
  const modelLabels = await loadModelLabels();

  const visibleCount = run.cells.filter(
    (c) => includeExcluded || c.status !== "excluded",
  ).length;
  const format =
    requested === "auto"
      ? visibleCount <= AUTO_THRESHOLD
        ? "html"
        : "zip"
      : requested;

  const datePart = new Date(run.created_at).toISOString().slice(0, 10);
  const baseName = `${safeFilename("API测试台-" + fr.query.slice(0, 30))}_${datePart}`;

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
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(baseName)}.html`,
        "Cache-Control": "no-store",
      },
    });
  }

  const buf = await buildZip(run, {
    includeExcluded,
    includeRaw: true,
    skillLabels,
    modelLabels,
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(baseName)}.zip`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
}
