// prompt-rewriter/lib/experiments/store.ts
//
// Phase 3a · ExperimentRecord 落盘 + 读取 + 列表 + PATCH(server-side store)
//
// 存储约定:
//   data/experiments/<id>.json              ← 完整 record
//   data/history-index.json                 ← 全局瘦索引,lab_id = "labs.pipeline.experiment"
//
// 为什么直接接 history-index 而不是扫 head:
//   - PUT /api/history-runs/[id] 已有同款基础设施,语义清晰
//   - 列表查询从扫 500 个 head 字段 → 读一个瘦索引,响应时间 1s → 10ms
//   - 边际成本 ~10 行,起步阶段就接,500+ 条再优化反而麻烦
//
// 复用提示:
//   - history-write.ts:writeHistoryRunDebounced 是 client-only(走 fetch + "use client")
//     本 store 在 server 端被调用,所以等价地直接读写 history-index.json 文件,
//     字段使用同一份 HistoryIndexEntrySchema —— 同一份索引文件、同一份契约,只是写入端不同。
//
// 并发约束:
//   - per-id mutex 串行化 record 文件写盘(同 record 的写 / patch 不会 lost update)
//   - 全局 mutex 串行化 history-index.json 读改写(并发跑批时不会丢条目)
//   - 跨请求共享 mutex 用 globalThis,绕开 Next.js dev hot-reload 重置 module 顶层 state

import { promises as fs } from "fs";
import path from "path";
import {
  ExperimentRecordSchema,
  ExperimentRecordHeadSchema,
  type ExperimentRecord,
  type ExperimentRecordHead,
} from "@/lib/schema";
import {
  HistoryIndexEntrySchema,
  type HistoryIndexEntry,
} from "@/lib/schema-history-index";

// ── 路径 ──────────────────────────────────────────────────
const ROOT = process.cwd();
export const EXPERIMENTS_DIR = path.join(ROOT, "data", "experiments");
const INDEX_FILE = path.join(ROOT, "data", "history-index.json");

// 跨 lab 的索引内,Pipeline experiment 单独占一个 lab_id 命名空间
export const EXPERIMENT_LAB_ID = "labs.pipeline.experiment";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function expFile(id: string): string {
  const safe = path.basename(id);
  return path.join(EXPERIMENTS_DIR, `${safe}.json`);
}

async function ensureDir() {
  await fs.mkdir(EXPERIMENTS_DIR, { recursive: true });
}

// ── per-id / 全局 mutex(globalThis 跨 hot-reload 共享) ──
type Mutex = { tail: Promise<void> };
type GlobalState = {
  recordMutexes: Map<string, Mutex>;
  indexMutex: Mutex;
};
function getState(): GlobalState {
  const g = globalThis as unknown as { __experimentStoreState?: GlobalState };
  if (!g.__experimentStoreState) {
    g.__experimentStoreState = {
      recordMutexes: new Map(),
      indexMutex: { tail: Promise.resolve() },
    };
  }
  return g.__experimentStoreState;
}

async function withRecordMutex<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const state = getState();
  let m = state.recordMutexes.get(id);
  if (!m) {
    m = { tail: Promise.resolve() };
    state.recordMutexes.set(id, m);
  }
  const prev = m.tail;
  let release: () => void = () => {};
  m.tail = new Promise<void>((res) => {
    release = res;
  });
  try {
    await prev;
    return await fn();
  } finally {
    release();
  }
}

async function withIndexMutex<T>(fn: () => Promise<T>): Promise<T> {
  const state = getState();
  const m = state.indexMutex;
  const prev = m.tail;
  let release: () => void = () => {};
  m.tail = new Promise<void>((res) => {
    release = res;
  });
  try {
    await prev;
    return await fn();
  } finally {
    release();
  }
}

// ── history-index 读写(safeParse 容忍坏条目,坏文件不要把整个列表炸掉) ──
async function readIndex(): Promise<HistoryIndexEntry[]> {
  try {
    const text = await fs.readFile(INDEX_FILE, "utf-8");
    const json = JSON.parse(text);
    if (!Array.isArray(json)) return [];
    const good: HistoryIndexEntry[] = [];
    for (const item of json) {
      const r = HistoryIndexEntrySchema.safeParse(item);
      if (r.success) good.push(r.data);
      else
        console.warn(
          "[experiments/store] history-index 里发现坏条目,已跳过:",
          (item as { id?: string })?.id ?? "<no-id>"
        );
    }
    return good;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    console.warn("[experiments/store] history-index 读失败:", err.message);
    return [];
  }
}

async function writeIndex(items: HistoryIndexEntry[]) {
  await fs.mkdir(path.dirname(INDEX_FILE), { recursive: true });
  // 原子写:tmp → rename,防 partial 读取
  const tmp = INDEX_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(items, null, 2), "utf-8");
  await fs.rename(tmp, INDEX_FILE);
}

// 把 ExperimentRecord 摘要成 history-index 的瘦字段
function buildIndexEntry(record: ExperimentRecord): HistoryIndexEntry {
  const ref = path
    .relative(ROOT, expFile(record.id))
    .split(path.sep)
    .join("/");
  // summary:query 前 80 字 + strategy_versions 简写
  const queryPreview =
    record.inputs.query.length > 80
      ? record.inputs.query.slice(0, 80) + "…"
      : record.inputs.query;
  const sv = record.config_snapshot.strategy_versions ?? {};
  const svParts = Object.entries(sv)
    .map(([k, v]) => `${k}:${v}`)
    .join(" / ");
  const summary = svParts
    ? `${queryPreview} · ${svParts}`
    : queryPreview;

  return {
    id: record.id,
    ts: record.ts,
    lab_id: EXPERIMENT_LAB_ID,
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
      // 2026-05-13:source.kind 写进索引,给列表 filter + chip 用
      source_kind: record.source?.kind ?? "pipeline_lab",
    },
  };
}

// ── 公共 API ──────────────────────────────────────────────

export async function writeExperimentRecord(
  record: ExperimentRecord
): Promise<void> {
  if (!SAFE_ID.test(record.id)) {
    throw new Error(
      `[experiments/store] 非法 id (只允许 [A-Za-z0-9_-]):${record.id}`
    );
  }
  // 写前 parse 一次确保结构合法;不合法直接报错而非落坏数据
  const valid = ExperimentRecordSchema.parse(record);

  await ensureDir();

  // 大小预警(plan red line:不存 base64,但 generations 里的中间字段还可能膨胀)
  const serialized = JSON.stringify(valid, null, 2);
  const bytes = Buffer.byteLength(serialized, "utf-8");
  if (bytes > 5 * 1024 * 1024) {
    console.warn(
      `[experiments/store] record ${valid.id} 体积 ${(bytes / 1024 / 1024).toFixed(
        2
      )} MB > 5 MB,请确认 image_urls[] 都是 /api/image-file/... 路径而非 base64`
    );
  }

  // 1) 写 record 文件(per-id mutex)
  await withRecordMutex(valid.id, async () => {
    const tmp = expFile(valid.id) + ".tmp";
    await fs.writeFile(tmp, serialized, "utf-8");
    await fs.rename(tmp, expFile(valid.id));
  });

  // 2) 同步 history-index(全局 mutex)
  //    server-side 等价于 client 的 writeHistoryRunDebounced + lab_id = "labs.pipeline.experiment"
  await withIndexMutex(async () => {
    const items = await readIndex();
    const entry = buildIndexEntry(valid);
    const idx = items.findIndex((x) => x.id === valid.id);
    if (idx >= 0) {
      // 保险:防 patch 误改 id / lab_id / ref / ts
      items[idx] = {
        ...items[idx],
        ...entry,
        id: valid.id,
        lab_id: EXPERIMENT_LAB_ID,
        ref: items[idx].ref,
        ts: items[idx].ts,
      };
    } else {
      // 最新一条放最前(跟 PUT /api/history-runs/[id] 的 unshift 行为对齐)
      items.unshift(entry);
    }
    await writeIndex(items);
  });
}

export async function readExperimentRecord(
  id: string
): Promise<ExperimentRecord | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    const text = await fs.readFile(expFile(id), "utf-8");
    const parsed = ExperimentRecordSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      console.warn(
        `[experiments/store] record ${id} schema 不合法,返回 null:`,
        parsed.error.issues.slice(0, 3)
      );
      return null;
    }
    return parsed.data;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    if (e instanceof SyntaxError) {
      console.warn(`[experiments/store] record ${id} JSON 解析失败,返回 null`);
      return null;
    }
    throw e;
  }
}

export interface ListOpts {
  pipeline_id?: string;
  tag?: string;
  q?: string; // substring match on query
  limit?: number; // default 50
  offset?: number; // default 0
}

export async function listExperimentRecords(opts: ListOpts = {}): Promise<{
  items: ExperimentRecordHead[];
  total: number;
}> {
  const { pipeline_id, tag, q, limit = 50, offset = 0 } = opts;

  const indexAll = await readIndex();
  const ours = indexAll.filter((e) => e.lab_id === EXPERIMENT_LAB_ID);

  // 把 history-index 条目映射为 ExperimentRecordHead;字段直接从 metadata 拿
  const heads: ExperimentRecordHead[] = [];
  for (const e of ours) {
    const md = (e.metadata ?? {}) as {
      pipeline_id?: string;
      strategy_versions?: Record<string, string>;
      models?: { search?: string; review?: string; image?: string };
      tags?: string[];
      author?: string;
      replay_of?: string;
      note?: string;
      source_kind?: string;
    };
    const candidate = {
      id: e.id,
      ts: e.ts,
      pipeline_id: md.pipeline_id ?? "",
      query: e.query,
      strategy_versions: md.strategy_versions ?? {},
      models: {
        search: md.models?.search ?? "",
        review: md.models?.review ?? "",
        image: md.models?.image ?? "",
      },
      tags: md.tags ?? [],
      metadata: {
        author: md.author ?? "",
        replay_of: md.replay_of,
        note: md.note ?? "",
      },
      source_kind: md.source_kind ?? "pipeline_lab",
    };
    const parsed = ExperimentRecordHeadSchema.safeParse(candidate);
    if (!parsed.success) {
      console.warn(
        `[experiments/store] head 构造失败,跳过 ${e.id}:`,
        parsed.error.issues.slice(0, 2)
      );
      continue;
    }
    heads.push(parsed.data);
  }

  // 过滤
  let filtered = heads;
  if (pipeline_id) {
    filtered = filtered.filter((h) => h.pipeline_id === pipeline_id);
  }
  if (tag) {
    filtered = filtered.filter((h) => h.tags.includes(tag));
  }
  if (q) {
    const needle = q.toLowerCase();
    filtered = filtered.filter((h) => h.query.toLowerCase().includes(needle));
  }

  // 按 ts 降序(最新在前)
  filtered.sort((a, b) => b.ts - a.ts);

  const total = filtered.length;
  const items = filtered.slice(offset, offset + Math.max(0, limit));

  // 注:若某条索引指向的 record 文件实际不存在,本列表仍会展示该条 head
  //     —— 详情接口 readExperimentRecord 会返回 null,前端可优雅降级
  //     这里不做主动校验(每条 stat 一次会让列表 IO 爆炸,违背接索引的初衷)
  return { items, total };
}

export interface PatchInput {
  tags?: string[];
  metadata?: Partial<ExperimentRecord["metadata"]>;
}

export async function patchExperimentRecord(
  id: string,
  patch: PatchInput
): Promise<ExperimentRecord> {
  if (!SAFE_ID.test(id)) {
    throw new Error(`[experiments/store] 非法 id:${id}`);
  }
  // 严格白名单:只允许 tags / metadata,其他字段视为 immutable(防误 patch)
  const allowedKeys = ["tags", "metadata"] as const;
  for (const k of Object.keys(patch)) {
    if (!allowedKeys.includes(k as (typeof allowedKeys)[number])) {
      throw new Error(
        `[experiments/store] PATCH 只允许 tags / metadata 字段,收到非法字段:${k}`
      );
    }
  }

  return await withRecordMutex(id, async () => {
    // 在 mutex 内重新读,防与写盘 race
    const current = await readExperimentRecord(id);
    if (!current) {
      throw new Error(`[experiments/store] record 不存在:${id}`);
    }
    const merged: ExperimentRecord = {
      ...current,
      tags: patch.tags !== undefined ? patch.tags : current.tags,
      metadata: {
        ...current.metadata,
        ...(patch.metadata ?? {}),
      },
    };
    // 校验合并后仍合法
    const valid = ExperimentRecordSchema.parse(merged);
    const serialized = JSON.stringify(valid, null, 2);
    const tmp = expFile(valid.id) + ".tmp";
    await fs.writeFile(tmp, serialized, "utf-8");
    await fs.rename(tmp, expFile(valid.id));
    // 同步索引(tags / metadata 也存到 index.metadata 里供列表筛选)
    await withIndexMutex(async () => {
      const items = await readIndex();
      const idx = items.findIndex((x) => x.id === valid.id);
      if (idx >= 0) {
        const entry = buildIndexEntry(valid);
        items[idx] = {
          ...items[idx],
          summary: entry.summary,
          metadata: entry.metadata,
        };
        await writeIndex(items);
      }
    });
    return valid;
  });
}
