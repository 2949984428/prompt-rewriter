#!/usr/bin/env node
// prompt-rewriter/scripts/migrate-history-to-index.mjs
//
// 一次性把老的两份 history 文件拆成"集中索引 + 分散详情":
//   data/history.json                  → labs/rewrite/runs/<id>.json + index 条目
//   data/labs/format/history.json      → labs/format/runs/<id>.json   + index 条目
//
// 老文件**不删**,改名为 .bak 保留作为回滚备份。
// 幂等:同一 id 已在 index → 跳过(不重复写)。

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const INDEX_FILE = path.join(DATA, "history-index.json");

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return null;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

function relRef(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

async function migrateOne(lab_id, sourceFile, summarize) {
  const list = await readJson(sourceFile);
  if (!Array.isArray(list)) {
    console.log(`  ${lab_id}: 源文件不存在或非数组,跳过`);
    return [];
  }
  console.log(`  ${lab_id}: ${list.length} 条待迁移`);
  const entries = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || !item.id) continue;
    const detailFile = path.join(DATA, "labs", lab_id, "runs", `${item.id}.json`);
    await writeJson(detailFile, item);
    entries.push({
      id: item.id,
      ts: typeof item.ts === "number" ? item.ts : Date.now(),
      lab_id,
      query: typeof item.query === "string" ? item.query : "",
      summary: summarize(item),
      status: "completed",
      ref: relRef(detailFile),
      pm_score_avg: scoreAvg(item),
      pm_score_count: scoreCount(item),
      metadata: {},
    });
  }
  return entries;
}

function scoreAvg(item) {
  // FormatRunRecord 的字段
  const runs = item?.format_runs;
  if (!Array.isArray(runs)) return null;
  const scored = runs.filter((r) => typeof r?.pm_score === "number");
  if (scored.length === 0) return null;
  return scored.reduce((s, r) => s + r.pm_score, 0) / scored.length;
}

function scoreCount(item) {
  const runs = item?.format_runs;
  if (!Array.isArray(runs)) return 0;
  return runs.filter((r) => typeof r?.pm_score === "number").length;
}

function summarizeRewrite(item) {
  const path = item?.result?.classify?.vertical_path
    ?.map((lv) => lv.label)
    .filter(Boolean)
    .join(" → ");
  return path || "rewrite 跑批";
}

function summarizeFormat(item) {
  const n = Array.isArray(item?.format_runs) ? item.format_runs.length : 0;
  const winner =
    item?.winner_format_id &&
    item.format_runs?.find((r) => r.format_id === item.winner_format_id)?.format_label;
  return winner ? `${n} 路 · 🏆 ${winner}` : `${n} 路对照`;
}

async function main() {
  console.log("[migrate] 开始迁移到 history-index 架构…");

  // 已有索引(支持幂等)
  const existing = (await readJson(INDEX_FILE)) ?? [];
  const seen = new Set(existing.map((x) => x.id));

  const rewriteEntries = await migrateOne(
    "rewrite",
    path.join(DATA, "history.json"),
    summarizeRewrite
  );
  const formatEntries = await migrateOne(
    "format",
    path.join(DATA, "labs", "format", "history.json"),
    summarizeFormat
  );

  const merged = [...existing];
  let added = 0;
  for (const e of [...rewriteEntries, ...formatEntries]) {
    if (seen.has(e.id)) continue;
    merged.unshift(e);
    seen.add(e.id);
    added++;
  }
  merged.sort((a, b) => b.ts - a.ts);
  await writeJson(INDEX_FILE, merged);
  console.log(`[migrate] index 写入完成,新增 ${added} 条,合计 ${merged.length} 条`);

  // 老文件改名为 .bak
  for (const old of [
    path.join(DATA, "history.json"),
    path.join(DATA, "labs", "format", "history.json"),
  ]) {
    try {
      await fs.access(old);
      const bak = old + ".bak";
      await fs.rename(old, bak);
      console.log(`[migrate] 老文件备份: ${path.relative(ROOT, old)} → ${path.relative(ROOT, bak)}`);
    } catch {
      // 不存在就跳过
    }
  }

  console.log("[migrate] 完成 ✓");
}

main().catch((e) => {
  console.error("[migrate] 失败:", e);
  process.exit(1);
});
