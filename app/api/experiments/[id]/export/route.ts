// prompt-rewriter/app/api/experiments/[id]/export/route.ts
//
// Experiments(pipeline_lab kind 专用)单 record 导出 HTML。
// 其它 source.kind 走各自原 lab 的 export endpoint(详情页前端按 source.kind 路由,
// 这条 endpoint 不主动路由,只处理 pipeline_lab —— 别的 kind 调来会 415)。
//
// 格式:单文件 HTML(base64 内联图)。Pipeline 实验台单 record 一般 4-7 张图,
// 单文件 ≤ 20MB 完全够用,不上 ZIP。

import { promises as fs } from "fs";
import path from "path";
import { ExperimentRecordSchema } from "@/lib/schema";
import { buildExperimentHtml } from "@/lib/export/build-experiment-html";
import { readImageDataUrl } from "@/lib/export/image-loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim() || "experiment-export";
}

async function readExperiment(id: string): Promise<unknown> {
  const filepath = path.join(
    process.cwd(),
    "data",
    "experiments",
    `${id}.json`,
  );
  try {
    const raw = await fs.readFile(filepath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const raw = await readExperiment(id);
  if (!raw) return new Response("not found", { status: 404 });

  const parsed = ExperimentRecordSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[experiment-export] schema parse failed:", parsed.error.issues.slice(0, 3));
    return new Response("invalid record schema", { status: 422 });
  }
  const record = parsed.data;

  // 只服务 pipeline_lab kind;其它 kind 让前端走原 lab 的 export endpoint
  const kind = record.source?.kind ?? "pipeline_lab";
  if (kind !== "pipeline_lab") {
    return new Response(
      `Export not supported for source.kind=${kind}. Use the original lab's export endpoint instead.`,
      { status: 415 },
    );
  }

  // resolveImageSrc 优先 base64 内联(/api/image-file/<sha> 本地路径),
  // 失败 fallback 原 URL —— Pipeline 实验台 record 的 step3.generations[].image_urls
  // 经常是 Lovart CDN 直链(https://assets-persist.lovart.ai/...),不是本地缓存,
  // 这种情况 HTML 用网络图片显示(在线可看,离线显示破图,合理 tradeoff)。
  const html = await buildExperimentHtml(record, {
    resolveImageSrc: async (url) => {
      const local = await readImageDataUrl(url);
      if (local) return local;
      if (url && /^https?:\/\//.test(url)) return url;
      return null;
    },
  });

  const datePart = new Date(record.ts).toISOString().slice(0, 10);
  const baseName = safeFilename(
    `Experiment-${record.id.slice(0, 8)}-${datePart}`,
  );

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(baseName)}.html`,
      "Cache-Control": "no-store",
    },
  });
}
