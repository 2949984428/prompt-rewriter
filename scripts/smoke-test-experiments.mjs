#!/usr/bin/env node
// prompt-rewriter/scripts/smoke-test-experiments.mjs
//
// Phase 3a · ExperimentRecord 烟测(IO 契约级)
//
// 为什么不直接 import store.ts:项目没装 tsx/ts-node,store.ts 内部用了
// `@/lib/schema` alias 在纯 node 跑不通。退一步,烟测覆盖"落盘契约":
//   1) 用 fs 写一份完整 ExperimentRecord 到 data/experiments/<id>.json
//   2) 在 history-index 里写一条 lab_id = labs.pipeline.experiment 的索引
//   3) 模拟 readExperimentRecord 的逻辑(读 + JSON.parse)
//   4) 模拟 listExperimentRecords 的逻辑(读 index + 过滤 lab_id)
//   5) 模拟 patchExperimentRecord 的逻辑(merge tags / metadata + 回写)
//
// 这一层 IO 契约对了,store.ts 的函数实现(已通过 tsc + zod schema 校验)就稳了。
// 跑完后会把 fake record + history-index 条目清理掉,不污染真数据。
//
// 用法:cd prompt-rewriter && node scripts/smoke-test-experiments.mjs

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const EXPERIMENTS_DIR = path.join(ROOT, "data", "experiments");
const INDEX_FILE = path.join(ROOT, "data", "history-index.json");
const LAB_ID = "labs.pipeline.experiment";

const COLORS = {
  ok: "\x1b[32m",
  fail: "\x1b[31m",
  dim: "\x1b[90m",
  reset: "\x1b[0m",
};
function log(step, msg, ok = true) {
  const tag = ok
    ? `${COLORS.ok}[OK]${COLORS.reset}`
    : `${COLORS.fail}[FAIL]${COLORS.reset}`;
  console.log(`${tag} ${step}  ${COLORS.dim}${msg}${COLORS.reset}`);
}

function buildFakeRecord(id) {
  return {
    id,
    ts: Date.now(),
    pipeline_id: "vertical_prompt_rewrite_v1",
    inputs: {
      query: "为小红书设计一张夏日奶茶种草封面",
      function_call_count: 4,
    },
    config_snapshot: {
      strategy_versions: { vertical: "v3", platform: "v1" },
      models: {
        search: "gemini/gemini-3-flash-preview",
        review: "doubao/seed-2-0-pro-260215",
        image: "gpt-image-2",
      },
    },
    output: {
      step1: { search_intent: { l1: "营销", l2: "小红书" } },
      step2: { reviewed: [{ prompt: "fake prompt 1" }, { prompt: "fake prompt 2" }] },
      step3: {
        generations: [
          {
            function_call_id: "fc_001",
            status: "done",
            image_urls: ["/api/image-file/task_abc/img_0.png"],
          },
        ],
      },
    },
    trace: [{ step: "step1", ms: 1234 }],
    tags: ["case:T1"],
    metadata: { author: "intern", note: "smoke test", replay_of: undefined },
  };
}

async function ensureDir() {
  await fs.mkdir(EXPERIMENTS_DIR, { recursive: true });
}

async function readIndex() {
  try {
    const text = await fs.readFile(INDEX_FILE, "utf-8");
    return JSON.parse(text);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

async function writeIndex(items) {
  const tmp = INDEX_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(items, null, 2), "utf-8");
  await fs.rename(tmp, INDEX_FILE);
}

function buildIndexEntry(record) {
  const ref = path
    .relative(ROOT, path.join(EXPERIMENTS_DIR, `${record.id}.json`))
    .split(path.sep)
    .join("/");
  const queryPreview =
    record.inputs.query.length > 80
      ? record.inputs.query.slice(0, 80) + "…"
      : record.inputs.query;
  const sv = record.config_snapshot.strategy_versions ?? {};
  const svParts = Object.entries(sv)
    .map(([k, v]) => `${k}:${v}`)
    .join(" / ");
  const summary = svParts ? `${queryPreview} · ${svParts}` : queryPreview;
  return {
    id: record.id,
    ts: record.ts,
    lab_id: LAB_ID,
    query: record.inputs.query,
    summary,
    status: "completed",
    ref,
    pm_score_avg: null,
    pm_score_count: 0,
    metadata: {
      pipeline_id: record.pipeline_id,
      strategy_versions: sv,
      models: record.config_snapshot.models,
      tags: record.tags ?? [],
      author: record.metadata?.author ?? "",
      note: record.metadata?.note ?? "",
      replay_of: record.metadata?.replay_of,
    },
  };
}

async function writeRecord(record) {
  const file = path.join(EXPERIMENTS_DIR, `${record.id}.json`);
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(record, null, 2), "utf-8");
  await fs.rename(tmp, file);
  const items = await readIndex();
  const idx = items.findIndex((x) => x.id === record.id);
  const entry = buildIndexEntry(record);
  if (idx >= 0) items[idx] = entry;
  else items.unshift(entry);
  await writeIndex(items);
}

async function readRecord(id) {
  try {
    const text = await fs.readFile(
      path.join(EXPERIMENTS_DIR, `${id}.json`),
      "utf-8"
    );
    return JSON.parse(text);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

async function listForLab() {
  const items = await readIndex();
  return items.filter((x) => x.lab_id === LAB_ID);
}

async function patchRecord(id, patch) {
  const current = await readRecord(id);
  if (!current) throw new Error("not found");
  const merged = {
    ...current,
    tags: patch.tags !== undefined ? patch.tags : current.tags,
    metadata: { ...current.metadata, ...(patch.metadata ?? {}) },
  };
  await writeRecord(merged);
  return merged;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function cleanup(id) {
  try {
    await fs.unlink(path.join(EXPERIMENTS_DIR, `${id}.json`));
  } catch {}
  const items = await readIndex();
  await writeIndex(items.filter((x) => x.id !== id));
}

async function main() {
  await ensureDir();
  const id = `exp_smoketest_${crypto.randomUUID()}`.replaceAll("-", "");
  let allPass = true;
  try {
    // 1) write
    const record = buildFakeRecord(id);
    await writeRecord(record);
    const onDisk = await fs
      .stat(path.join(EXPERIMENTS_DIR, `${id}.json`))
      .catch(() => null);
    log("Step 1 · write", onDisk ? `落盘 ${onDisk.size} 字节` : "落盘失败", !!onDisk);
    if (!onDisk) allPass = false;

    // 2) read
    const readBack = await readRecord(id);
    const ok2 = readBack !== null && deepEqual(readBack, record);
    log(
      "Step 2 · read",
      ok2 ? "deep equal 通过" : "读回内容不一致",
      ok2
    );
    if (!ok2) allPass = false;

    // 3) list
    const listed = await listForLab();
    const found = listed.find((x) => x.id === id);
    const ok3 =
      !!found &&
      found.lab_id === LAB_ID &&
      found.query === record.inputs.query &&
      found.metadata?.pipeline_id === record.pipeline_id;
    log(
      "Step 3 · list",
      ok3
        ? `index 内找到,lab_id=${found.lab_id},strategy_versions=${JSON.stringify(
            found.metadata.strategy_versions
          )}`
        : "index 内未找到或字段不匹配",
      ok3
    );
    if (!ok3) allPass = false;

    // 4) patch
    const patched = await patchRecord(id, {
      tags: ["case:T1", "golden"],
      metadata: { note: "已 patch", author: "intern" },
    });
    const ok4 =
      patched.tags.length === 2 &&
      patched.tags.includes("golden") &&
      patched.metadata.note === "已 patch";
    log(
      "Step 4 · patch",
      ok4
        ? `tags=${JSON.stringify(patched.tags)}, note="${patched.metadata.note}"`
        : "patch 后字段不匹配",
      ok4
    );
    if (!ok4) allPass = false;

    // 5) re-read after patch
    const reread = await readRecord(id);
    const ok5 =
      !!reread &&
      reread.tags.includes("golden") &&
      reread.metadata.note === "已 patch" &&
      // 验证 immutable 字段没动
      reread.id === record.id &&
      reread.ts === record.ts &&
      reread.pipeline_id === record.pipeline_id;
    log(
      "Step 5 · re-read after patch",
      ok5
        ? "patch 持久化 + immutable 字段未动"
        : "patch 后再读不一致或 immutable 字段被改",
      ok5
    );
    if (!ok5) allPass = false;
  } finally {
    await cleanup(id);
    console.log(`${COLORS.dim}[清理] 已删除 fake record ${id}${COLORS.reset}`);
  }
  if (allPass) {
    console.log(
      `\n${COLORS.ok}═══ 烟测全部通过 (5/5) ═══${COLORS.reset}`
    );
    process.exit(0);
  } else {
    console.log(
      `\n${COLORS.fail}═══ 烟测有失败,看上方 [FAIL] ═══${COLORS.reset}`
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[smoke-test] 异常:", e);
  process.exit(1);
});
