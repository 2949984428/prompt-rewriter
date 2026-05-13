#!/usr/bin/env node
// scripts/import-questions.mjs
//
// CLI 题目导入工具(2026-05-13 改两级框架 + 方案 A xlsx 备份)。
//
// 跑法(在 prompt-rewriter 目录下):
//   node ./scripts/import-questions.mjs <path-to-xlsx> [set-name]
//
// - 每次跑 = 创建一个新题目集(set_id 自动生成 UUID)
// - set-name 可选,默认用 filename(去扩展名)
// - 原 xlsx 同时备份到 data/labs/questions/sources/<set_id>.xlsx
// - 行为跟 UI 上传完全一致(走同样的 store 落盘逻辑)
//
// 不再支持旧 replace/merge 模式。如果你想"合并多份 xlsx"概念,
// 多次跑这个脚本得到多个题目集,UI 上各自独立;tag/category 跨 set 聚合。

import path from "path";
import fs from "fs/promises";
import url from "url";
import crypto from "crypto";

import ExcelJS from "exceljs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const QUESTIONS_DIR = path.join(ROOT, "data", "labs", "questions");
const SETS_DIR = path.join(QUESTIONS_DIR, "sets");
const SOURCES_DIR = path.join(QUESTIONS_DIR, "sources");
const INDEX_FILE = path.join(QUESTIONS_DIR, "_index.json");

function safeJSON(s, fallback) {
  if (s === null || s === undefined) return fallback;
  const text = String(s).trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function atomicWrite(target, content) {
  const tmp = target + ".tmp";
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, target);
}

async function readJsonSafe(p, fallback) {
  try {
    return JSON.parse(await fs.readFile(p, "utf-8"));
  } catch {
    return fallback;
  }
}

async function parseXlsx(file) {
  const buf = await fs.readFile(file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("xlsx 没有 worksheet");

  const header = ws.getRow(1);
  const colIdx = {};
  header.eachCell((cell, col) => {
    const name = String(cell.value ?? "").trim();
    if (name) colIdx[name] = col;
  });
  const need = ["qid", "input_content", "categories", "input_data"];
  const missing = need.filter((k) => !(k in colIdx));
  if (missing.length > 0) {
    throw new Error(
      `header 缺少必需列:${missing.join(", ")} (找到 ${Object.keys(colIdx).join(", ")})`,
    );
  }

  const byId = new Map();
  let totalRows = 0,
    skipped = 0,
    duplicates = 0;
  for (let rowNum = 2; rowNum <= ws.rowCount; rowNum++) {
    const row = ws.getRow(rowNum);
    const qidRaw = row.getCell(colIdx["qid"]).value;
    const qid = qidRaw == null ? "" : String(qidRaw).trim();
    if (!qid) {
      const allEmpty = need.every((k) => {
        const v = row.getCell(colIdx[k]).value;
        return v == null || String(v).trim() === "";
      });
      if (!allEmpty) skipped++;
      continue;
    }
    totalRows++;
    const inputContent = safeJSON(row.getCell(colIdx["input_content"]).value, []);
    const categories = safeJSON(row.getCell(colIdx["categories"]).value, []);
    const inputData = safeJSON(row.getCell(colIdx["input_data"]).value, {});
    if (byId.has(qid)) duplicates++;
    byId.set(qid, {
      qid,
      input_content: Array.isArray(inputContent) ? inputContent : [],
      categories: Array.isArray(categories) ? categories : [],
      input_data:
        typeof inputData === "object" && inputData !== null ? inputData : {},
      tags: [],
      note: "",
    });
  }
  return {
    questions: Array.from(byId.values()),
    totalRows,
    skipped,
    duplicates,
    buf,
  };
}

async function main() {
  const [, , filePath, ...rest] = process.argv;
  if (!filePath) {
    console.error(
      "usage: node scripts/import-questions.mjs <path-to-xlsx> [set-name]",
    );
    process.exit(1);
  }

  // 老用法兼容警告:如果第二个 arg 是 replace/merge,提示新用法
  let setName = rest.join(" ").trim();
  if (setName === "replace" || setName === "merge") {
    console.warn(
      `⚠ "${setName}" 模式在两级框架下已废弃 — 每次跑都创建一个新题目集。set name 用默认 (filename)。`,
    );
    setName = "";
  }

  // 解析路径
  let resolved = filePath;
  if (filePath.startsWith("~/")) {
    resolved = path.join(process.env.HOME ?? "", filePath.slice(2));
  } else if (!path.isAbsolute(filePath)) {
    resolved = path.resolve(process.cwd(), filePath);
  }

  try {
    await fs.stat(resolved);
  } catch {
    console.error(`✗ 文件不存在: ${resolved}`);
    process.exit(2);
  }

  const filename = path.basename(resolved);
  if (!setName) setName = filename.replace(/\.[^.]+$/, "") || "新题目集";

  console.log(`▷ 解析 ${resolved}`);
  const parsed = await parseXlsx(resolved);
  console.log(
    `  - total_rows=${parsed.totalRows}  skipped=${parsed.skipped}  duplicates=${parsed.duplicates}  accepted=${parsed.questions.length}`,
  );

  if (parsed.questions.length === 0) {
    console.error("✗ 解析后没有有效题目,放弃");
    process.exit(3);
  }

  await fs.mkdir(SETS_DIR, { recursive: true });
  await fs.mkdir(SOURCES_DIR, { recursive: true });

  // 生成 set_id(跟 server 端 store.ts 同款)
  const setId = `set_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();
  const fullSet = {
    set_id: setId,
    name: setName,
    description: "",
    source_filename: filename,
    created_at: now,
    updated_at: now,
    questions: parsed.questions,
  };

  // 写 set JSON
  await atomicWrite(
    path.join(SETS_DIR, `${setId}.json`),
    JSON.stringify(fullSet, null, 2),
  );

  // 备份原 xlsx
  try {
    await fs.writeFile(path.join(SOURCES_DIR, `${setId}.xlsx`), parsed.buf);
  } catch (e) {
    console.warn(`⚠ xlsx 备份失败(JSON 已落盘,不影响数据):${e.message}`);
  }

  // 更新索引
  const idx = (await readJsonSafe(INDEX_FILE, { sets: [] })) ?? { sets: [] };
  if (!Array.isArray(idx.sets)) idx.sets = [];
  idx.sets.push({
    set_id: setId,
    name: setName,
    description: "",
    source_filename: filename,
    created_at: now,
    updated_at: now,
    count: parsed.questions.length,
  });
  await atomicWrite(INDEX_FILE, JSON.stringify(idx, null, 2));

  console.log(
    `✓ 新题目集「${setName}」· ${parsed.questions.length} 题 · set_id=${setId}`,
  );
  console.log(`  → ${path.join(SETS_DIR, setId + ".json")}`);
  console.log(`  → ${path.join(SOURCES_DIR, setId + ".xlsx")} (xlsx 备份)`);
}

main().catch((e) => {
  console.error("✗", e?.stack ?? e?.message ?? e);
  process.exit(1);
});
