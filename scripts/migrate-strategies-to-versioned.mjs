#!/usr/bin/env node
// prompt-rewriter/scripts/migrate-strategies-to-versioned.mjs
//
// 一次性脚本，把 vertical-standard.json / platform-tone.json / classification.md / rewrite.md
// 从"单文件全量"迁成"目录化 + _index.json + vN.{json|md}"。
//
// 跑法（路径含冒号场景）：
//   cd prompt-rewriter && node ./scripts/migrate-strategies-to-versioned.mjs
//
// 幂等：目录里已经有 _index.json 就跳过该 namespace。
// Safety net：迁完旧的单文件移到 data/labs/pipeline/_legacy/。

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PIPELINE_BASE = path.join(ROOT, "data", "labs", "pipeline");
const STRATEGY_BASE = path.join(PIPELINE_BASE, "strategies");
const SP_BASE = path.join(PIPELINE_BASE, "sps");
const LEGACY_BASE = path.join(PIPELINE_BASE, "_legacy");

// [来源文件绝对路径, 目标目录绝对路径, 版本文件后缀, 在 _legacy 下的保存子路径]
const TARGETS = [
  {
    single: path.join(STRATEGY_BASE, "vertical-standard.json"),
    dir: path.join(STRATEGY_BASE, "vertical-standard"),
    ext: ".json",
    legacy: path.join(LEGACY_BASE, "strategies", "vertical-standard.json"),
  },
  {
    single: path.join(STRATEGY_BASE, "platform-tone.json"),
    dir: path.join(STRATEGY_BASE, "platform-tone"),
    ext: ".json",
    legacy: path.join(LEGACY_BASE, "strategies", "platform-tone.json"),
  },
  {
    single: path.join(SP_BASE, "classification.md"),
    dir: path.join(SP_BASE, "classification"),
    ext: ".md",
    legacy: path.join(LEGACY_BASE, "sps", "classification.md"),
  },
  {
    single: path.join(SP_BASE, "rewrite.md"),
    dir: path.join(SP_BASE, "rewrite"),
    ext: ".md",
    legacy: path.join(LEGACY_BASE, "sps", "rewrite.md"),
  },
];

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function migrate() {
  for (const t of TARGETS) {
    const dirIndex = path.join(t.dir, "_index.json");
    const name = path.basename(t.dir);

    // 已经迁过就跳过
    if (await exists(dirIndex)) {
      console.log(`[skip] ${name} 已存在 _index.json，跳过`);
      continue;
    }

    // 源单文件必须存在
    if (!(await exists(t.single))) {
      console.log(`[warn] ${name} 源文件不存在: ${t.single}，跳过`);
      continue;
    }

    const content = await fs.readFile(t.single, "utf8");
    await fs.mkdir(t.dir, { recursive: true });
    const versionFile = path.join(t.dir, "v1" + t.ext);
    await fs.writeFile(versionFile, content, "utf8");
    await fs.writeFile(
      dirIndex,
      JSON.stringify(
        {
          active: "v1",
          versions: [
            {
              id: "v1",
              label: "初版(迁移自单文件)",
              notes: "Phase 2 迁移基线",
              createdAt: new Date().toISOString(),
              author: "system-migration",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`[done] ${name} 已迁成 v1${t.ext}`);

    // 把旧单文件移到 _legacy/(保留 3 个月观察期)
    await fs.mkdir(path.dirname(t.legacy), { recursive: true });
    await fs.rename(t.single, t.legacy);
    console.log(
      `[legacy] ${path.relative(ROOT, t.single)} → ${path.relative(ROOT, t.legacy)}`,
    );
  }
  console.log("[migrate] 全部完成 ✓");
}

migrate().catch((e) => {
  console.error("[migrate] 失败:", e);
  process.exit(1);
});
