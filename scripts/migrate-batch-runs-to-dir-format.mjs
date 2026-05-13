#!/usr/bin/env node
// scripts/migrate-batch-runs-to-dir-format.mjs
//
// 把 data/labs/batch/runs/<id>.json 单文件 record 迁成目录形态:
//   <id>/meta.json + <id>/cells/<cellKey>.json
//
// 可重入 — 已迁过的 record(<id>/ 是目录)跳过。
// 原文件 rename 为 <id>.json.legacy 作 30 天备份(期满人工 rm)。
//
// 用法:
//   node ./node_modules/.bin/tsx scripts/migrate-batch-runs-to-dir-format.mjs --dry-run   # 不写盘,只 log
//   node ./node_modules/.bin/tsx scripts/migrate-batch-runs-to-dir-format.mjs              # 真迁
//
// 单条迁移失败 console.warn + 跳过,不卡整个流程。

import { promises as fs } from "fs";
import path from "path";

const BATCH_DIR = path.join(process.cwd(), "data", "labs", "batch", "runs");
const dryRun = process.argv.includes("--dry-run");

function cellKeyOf(query_idx, col_id, image_model) {
  const safeCol = (col_id || "_").replace(/[^a-zA-Z0-9_\-.]/g, "_");
  const safeModel = (image_model || "default").replace(/[^a-zA-Z0-9_\-.]/g, "_");
  return `q${String(query_idx).padStart(3, "0")}_${safeCol}_${safeModel}`;
}

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function migrateOne(id) {
  const legacyFile = path.join(BATCH_DIR, `${id}.json`);
  const runDir = path.join(BATCH_DIR, id);
  const metaFile = path.join(runDir, "meta.json");
  const cellsDir = path.join(runDir, "cells");

  // 已经是目录形态 → 跳过
  if (await exists(metaFile)) {
    return { id, status: "skip:already-dir" };
  }

  // 读老 record
  let raw;
  try {
    const text = await fs.readFile(legacyFile, "utf-8");
    raw = JSON.parse(text);
  } catch (e) {
    return { id, status: "skip:read-failed", error: String(e).slice(0, 100) };
  }

  if (!raw || typeof raw !== "object" || !Array.isArray(raw.cells)) {
    return { id, status: "skip:invalid-schema" };
  }

  const cells = raw.cells;
  // 算 cell_keys
  const cellKeys = cells.map((c) => {
    const col = c.pipeline_id || c.skill_id || "";
    return cellKeyOf(c.query_idx, col, c.image_model || "");
  });

  // 拆 meta(去 cells,加 cell_keys)
  const meta = { ...raw, cell_keys: cellKeys };
  delete meta.cells;

  if (dryRun) {
    return {
      id,
      status: "dry-run",
      cell_count: cells.length,
      meta_size: JSON.stringify(meta).length,
      avg_cell_size: Math.round(
        cells.reduce((sum, c) => sum + JSON.stringify(c).length, 0) /
          Math.max(1, cells.length),
      ),
    };
  }

  // 实际写
  await fs.mkdir(cellsDir, { recursive: true });
  // 写 meta(tmp + rename)
  const metaTmp = metaFile + ".tmp";
  await fs.writeFile(metaTmp, JSON.stringify(meta, null, 2), "utf-8");
  await fs.rename(metaTmp, metaFile);
  // 写每 cell
  for (let i = 0; i < cells.length; i++) {
    const key = cellKeys[i];
    const file = path.join(cellsDir, `${key}.json`);
    const tmp = file + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(cells[i], null, 2), "utf-8");
    await fs.rename(tmp, file);
  }
  // 老文件 rename 为 .legacy(备份)
  await fs.rename(legacyFile, legacyFile + ".legacy");

  return { id, status: "migrated", cell_count: cells.length };
}

async function main() {
  console.log(
    `[migrate] ${dryRun ? "DRY RUN" : "REAL RUN"}: BATCH_DIR=${BATCH_DIR}`,
  );

  let entries;
  try {
    entries = await fs.readdir(BATCH_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`[migrate] readdir failed: ${e}`);
    process.exit(1);
  }

  // 收集要迁的 id:.json 文件(不含 .legacy / .tmp)
  const ids = entries
    .filter(
      (e) =>
        e.isFile() &&
        e.name.endsWith(".json") &&
        !e.name.endsWith(".legacy") &&
        !e.name.endsWith(".tmp"),
    )
    .map((e) => e.name.slice(0, -".json".length));

  console.log(`[migrate] candidates: ${ids.length}`);

  const stats = { migrated: 0, "skip:already-dir": 0, "skip:read-failed": 0, "skip:invalid-schema": 0, "dry-run": 0 };
  for (const id of ids) {
    try {
      const r = await migrateOne(id);
      stats[r.status] = (stats[r.status] || 0) + 1;
      console.log(`  ${r.status.padEnd(22)}  ${id}${r.cell_count !== undefined ? `  cells=${r.cell_count}` : ""}${r.error ? `  err=${r.error}` : ""}`);
    } catch (e) {
      console.warn(`  failed  ${id}  ${e}`);
    }
  }
  console.log(`\n[migrate] done. stats: ${JSON.stringify(stats)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
