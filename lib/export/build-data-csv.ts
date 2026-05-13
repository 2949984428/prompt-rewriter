// prompt-rewriter/lib/export/build-data-csv.ts
//
// 给"在线盲测平台"用的极简单文件 CSV:
//
//   <run-name>_<date>.csv     ← 4 列(id, query, strategy, image)
//
// image 列是完整 URL(不是相对路径),接收方平台直接 fetch URL 拉图。
// 不打 ZIP / 不带本地图 —— 单文件最方便往平台 import wizard 里塞。
//
// CSV 转义遵循 RFC 4180。BOM 头让 Excel 在 Windows UTF-8 识别中文。
//
// 跳过 failed / excluded cell:没图就没 sample。

import type { BatchRunRecord, BatchCell } from "@/lib/schema";
import {
  resolveLocalImage,
  readImageBytes,
  mimeForExt,
} from "./image-loader";
import { r2EnsureUploaded } from "@/lib/r2";

function csvCell(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// 把 cell.image_urls[0] 拼成本机代理 URL(不上传到任何外部,仅 host + path)
function localProxyUrl(cell: BatchCell, urlBase: string): string | null {
  const local = cell.image_urls?.[0];
  if (!local) return null;
  return `${urlBase.replace(/\/+$/, "")}${local}`;
}

// R2 key 设计:lovart-batch-export/<run_id>/<sample_id>.<ext>
// - 同 run 同 sample 的 key 永远一致 → r2EnsureUploaded 幂等
// - run_id 隔离不同跑批,bucket 内目录清晰
function r2KeyFor(
  runId: string,
  sampleId: string,
  ext: string
): string {
  return `lovart-batch-export/${runId}/${sampleId}.${ext}`;
}

export type CollectedRow = {
  cell: BatchCell;
  sampleId: string;
  query: string;
  imageUrl: string;
};

export type BuildDataCsvOptions = {
  // url 模式:
  //   - "local-proxy":image 列 = urlBase + cell.image_urls[0],只在 urlBase 可达时有效
  //   - "r2":启动时上传图到 Cloudflare R2,image 列 = R2 公网 URL
  mode: "local-proxy" | "r2";
  // local-proxy 模式必填(本机请求 origin)
  urlBase?: string;
};

export type CsvFailure = {
  sample_id: string;
  reason: string;
  // SDK 错误时尽量带上 http status / 错误名,前端能区分"配置错"vs"网络抖动"
  status?: number;
  code?: string;
};

export type BuildDataCsvResult = {
  csv: string;
  rowsTotal: number;
  uploaded: number; // r2 模式才有意义;local-proxy 模式总是 0
  skipped: number;
  failures: CsvFailure[];
};

// 把 SDK 抛的 unknown error 拆成结构化 CsvFailure
function classifyError(sampleId: string, e: unknown): CsvFailure {
  const meta = (e as { $metadata?: { httpStatusCode?: number } }).$metadata;
  const name = (e as { name?: string }).name;
  const message =
    (e as { message?: string }).message ?? String(e ?? "unknown error");
  return {
    sample_id: sampleId,
    reason: message.slice(0, 240),
    status: meta?.httpStatusCode,
    code: name,
  };
}

// 简单 promise pool。worker 顺序拉 cursor,fn 内部自己 try/catch。
async function parallelLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

const R2_UPLOAD_CONCURRENCY = 32;

export async function buildDataCsv(
  record: BatchRunRecord,
  opts: BuildDataCsvOptions
): Promise<BuildDataCsvResult> {
  // 第一遍:同步收集所有"待处理 cell" + 准备元数据,保持原顺序。
  // r2 模式下,真正的上传放第二遍并发处理。
  type Pending = {
    cell: BatchCell;
    sampleId: string;
    query: string;
    // local-proxy 模式直接给最终 url;r2 模式留 hit 走第二遍上传
    proxyUrl: string | null;
    hit: ReturnType<typeof resolveLocalImage>;
  };
  const pending: Pending[] = [];
  let skipped = 0;

  for (const cell of record.cells) {
    // B1 fix:failed / excluded / pending 状态的 cell 计入 skipped,
    // 前端 dialog 才能告诉用户"为什么 csv 行数比预期少"。
    if (cell.status !== "done") {
      skipped++;
      continue;
    }
    const qi = String(cell.query_idx + 1).padStart(2, "0");
    const sampleId = `q${qi}_${cell.skill_id}`;
    const query = record.queries[cell.query_idx] ?? "";

    if (opts.mode === "local-proxy") {
      if (!opts.urlBase) throw new Error("local-proxy 模式必须传 urlBase");
      const url = localProxyUrl(cell, opts.urlBase);
      if (!url) {
        skipped++;
        continue;
      }
      pending.push({ cell, sampleId, query, proxyUrl: url, hit: null });
    } else {
      const hit = resolveLocalImage(cell.image_urls?.[0]);
      if (!hit) {
        skipped++;
        continue;
      }
      pending.push({ cell, sampleId, query, proxyUrl: null, hit });
    }
  }

  // 第二遍(仅 r2 模式):并发 32 路上传。
  // r2EnsureUploaded 内部先 HeadObject 检查,已存在直接跳过 PutObject ——
  // 第二次导出同 run 时绝大多数 cell 都是命中跳过,几乎瞬间完成。
  const finalUrls: (string | null)[] = new Array(pending.length).fill(null);
  const failures: CsvFailure[] = [];
  let uploaded = 0;

  if (opts.mode === "r2") {
    await parallelLimit(pending, R2_UPLOAD_CONCURRENCY, async (p, i) => {
      if (!p.hit) return;
      const buf = await readImageBytes(p.hit);
      if (!buf) {
        finalUrls[i] = null;
        failures.push({
          sample_id: p.sampleId,
          reason: "本地图片文件读取失败(data/images/ 下文件丢失或权限错)",
        });
        return;
      }
      const key = r2KeyFor(record.id, p.sampleId, p.hit.ext);
      try {
        const { url, uploaded: didUpload } = await r2EnsureUploaded(
          key,
          buf,
          mimeForExt(p.hit.ext)
        );
        finalUrls[i] = url;
        if (didUpload) uploaded++;
      } catch (e) {
        finalUrls[i] = null;
        failures.push(classifyError(p.sampleId, e));
        console.warn(
          `[build-data-csv] r2 upload failed for ${p.sampleId}:`,
          e instanceof Error ? e.message : String(e)
        );
      }
    });
  } else {
    // local-proxy:proxyUrl 已在第一遍算好,直接搬过来
    for (let i = 0; i < pending.length; i++) {
      finalUrls[i] = pending[i].proxyUrl;
    }
  }

  // 第三遍:拼 csv 行。某条 url 是 null(r2 上传失败 / 文件不存在)的整条跳过
  const rows: CollectedRow[] = [];
  for (let i = 0; i < pending.length; i++) {
    const url = finalUrls[i];
    if (!url) {
      skipped++;
      continue;
    }
    const p = pending[i];
    rows.push({ cell: p.cell, sampleId: p.sampleId, query: p.query, imageUrl: url });
  }

  const bom = "﻿";
  const header = "id,query,strategy,image";
  const body = rows
    .map((r) =>
      [
        csvCell(r.sampleId),
        csvCell(r.query),
        csvCell(r.cell.skill_id),
        csvCell(r.imageUrl),
      ].join(",")
    )
    .join("\n");

  return {
    csv: bom + header + "\n" + body + "\n",
    rowsTotal: rows.length,
    uploaded,
    skipped,
    failures,
  };
}
