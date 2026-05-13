// prompt-rewriter/lib/batch-store.ts
//
// 批量测试台的持久化层。
//
// 2026-05-13 架构改造:存储形态从单文件改成目录:
//
//   旧:data/labs/batch/runs/<id>.json           ← 单文件,meta + cells 全 inline,~3MB
//   新:data/labs/batch/runs/<id>/
//       ├─ meta.json                            ← BatchRunMeta(几 KB)
//       └─ cells/
//           └─ <cellKey>.json                   ← 单 BatchCell(几 KB)
//
// 为什么拆:read 路径之前要把 3MB 单文件全 parse + Zod 校验 才能抠 7 个 summary 字段;
// SSE 跑批 + detail GET 共用 per-record 写锁导致 detail 30s+ 抖动。拆分后:
//   - 列表只读 meta.json(轻量)
//   - 详情按需读 cells(默认仍组装完整 record 兼容前端,但每 cell 几 KB 远快于 3MB 整 parse)
//   - 写锁粒度从 per-record 降到 per-cell,SSE 写 cell A 时 cell B / meta / GET 都不阻塞
//
// 兼容层:`readRunCompat` 同时识别新目录形态和老单文件,迁移期可慢慢迁。
// 数据迁移见 scripts/migrate-batch-runs-to-dir-format.ts。

import { promises as fs } from "fs";
import path from "path";
import {
  BatchRunMetaSchema,
  BatchRunRecordSchema,
  BatchCellSchema,
  type BatchRunMeta,
  type BatchRunRecord,
  type BatchCell,
  type BatchRunSummary,
} from "@/lib/schema";

export const BATCH_DIR = path.join(
  process.cwd(),
  "data",
  "labs",
  "batch",
  "runs"
);

async function ensureDir() {
  await fs.mkdir(BATCH_DIR, { recursive: true });
}

// ── 路径 helper ─────────────────────────────────────────

function safeId(id: string): string {
  // basename 防穿越;调用方传的 id 都是 server 控制的 uuid,这一步只是 belt-and-suspenders
  return path.basename(id);
}

function runDir(id: string): string {
  return path.join(BATCH_DIR, safeId(id));
}

function metaFile(id: string): string {
  return path.join(runDir(id), "meta.json");
}

function cellsDir(id: string): string {
  return path.join(runDir(id), "cells");
}

function cellFile(id: string, cellKey: string): string {
  // cellKey 是 server 内部 derive 的,不含用户输入(query_idx / col_id / image_model)
  // basename 兜底
  return path.join(cellsDir(id), `${path.basename(cellKey)}.json`);
}

// 老单文件:迁移前的 record 落盘位置
function legacyFile(id: string): string {
  return path.join(BATCH_DIR, `${safeId(id)}.json`);
}

/**
 * cellKey:(query_idx, col_id, image_model) 三元组 derive 出的稳定 id,作为 cell 文件名。
 *
 * col_id:
 *   - test_kind=skill    → skill_id
 *   - test_kind=pipeline → pipeline_id
 * image_model:空字符串(单 model 模式)用 "default" 占位,保证文件名非空。
 *
 * 替换非字母数字 / `_` / `-` / `.` 为 `_` —— skill_id 通常是 "F11-direct-api" 这种安全字符,
 * pipeline_id / image_model 也是 server 控制的字符串,但 image_model 含 "vertex/anon-bob" 这种斜杠,
 * 必须替换 否则会被当 path 分隔符。
 */
export function cellKeyOf(
  query_idx: number,
  col_id: string,
  image_model: string,
): string {
  const safeCol = (col_id || "_").replace(/[^a-zA-Z0-9_\-.]/g, "_");
  const safeModel = (image_model || "default").replace(/[^a-zA-Z0-9_\-.]/g, "_");
  return `q${String(query_idx).padStart(3, "0")}_${safeCol}_${safeModel}`;
}

/** 从 BatchCell 算 cellKey(自动按 test_kind 选 col_id) */
function cellKeyOfCell(cell: BatchCell): string {
  const col = cell.pipeline_id || cell.skill_id || "";
  return cellKeyOf(cell.query_idx, col, cell.image_model ?? "");
}

// ── 状态检测 ────────────────────────────────────────────

/** 是否新目录形态(<id>/meta.json 存在) */
async function isDirFormat(id: string): Promise<boolean> {
  try {
    const st = await fs.stat(metaFile(id));
    return st.isFile();
  } catch {
    return false;
  }
}

/** 是否老单文件形态(<id>.json 存在) */
async function isLegacyFormat(id: string): Promise<boolean> {
  try {
    const st = await fs.stat(legacyFile(id));
    return st.isFile();
  } catch {
    return false;
  }
}

// ── per-cell + per-meta mutex ───────────────────────────
// SSE 跑批 N 个 cell 并发写时,只锁各自 cell,不阻塞 meta read / 其它 cell / detail GET。

type Mutex = { tail: Promise<void> };
type RecordLocks = {
  meta: Mutex;
  cells: Map<string, Mutex>;
};
type GlobalState = {
  locks: Map<string, RecordLocks>;
};
function getState(): GlobalState {
  const g = globalThis as unknown as { __batchStoreState?: GlobalState };
  if (!g.__batchStoreState) {
    g.__batchStoreState = { locks: new Map() };
  }
  return g.__batchStoreState;
}

function getRecordLocks(id: string): RecordLocks {
  const state = getState();
  let locks = state.locks.get(id);
  if (!locks) {
    locks = { meta: { tail: Promise.resolve() }, cells: new Map() };
    state.locks.set(id, locks);
  }
  return locks;
}

function getCellMutex(id: string, cellKey: string): Mutex {
  const locks = getRecordLocks(id);
  let m = locks.cells.get(cellKey);
  if (!m) {
    m = { tail: Promise.resolve() };
    locks.cells.set(cellKey, m);
  }
  return m;
}

async function withMutex<T>(m: Mutex, fn: () => Promise<T>): Promise<T> {
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

async function withMetaLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  return withMutex(getRecordLocks(id).meta, fn);
}

async function withCellLock<T>(
  id: string,
  cellKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withMutex(getCellMutex(id, cellKey), fn);
}

// ── 原子写 ──────────────────────────────────────────────

async function atomicWrite(filepath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  const tmp = filepath + ".tmp";
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, filepath);
}

// ── 读 file with retry(应对写盘 race)─────────────────

async function readFileWithRetry(filepath: string): Promise<string | null> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const text = await fs.readFile(filepath, "utf-8");
      if (text.length === 0) {
        lastErr = new Error("empty file");
        await new Promise((r) => setTimeout(r, 30));
        continue;
      }
      return text;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return null;
      lastErr = e;
      if (e instanceof SyntaxError) {
        await new Promise((r) => setTimeout(r, 30));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

// ────────────────────────────────────────────────────────
// 新 API · 目录形态
// ────────────────────────────────────────────────────────

/** 读 meta.json(只走 JSON.parse,不 Zod;调用方需要 typed 时自己 parse) */
export async function readMetaRaw(id: string): Promise<unknown | null> {
  await ensureDir();
  const text = await readFileWithRetry(metaFile(id));
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 读 meta.json + Zod 校验(给 write path 用) */
export async function readMeta(id: string): Promise<BatchRunMeta | null> {
  const raw = await readMetaRaw(id);
  if (raw === null) return null;
  return BatchRunMetaSchema.parse(raw);
}

/** 写 meta.json(锁 meta mutex) */
export async function writeMeta(meta: BatchRunMeta): Promise<void> {
  await ensureDir();
  const valid = BatchRunMetaSchema.parse(meta);
  await withMetaLock(meta.id, async () => {
    await atomicWrite(metaFile(meta.id), JSON.stringify(valid, null, 2));
  });
}

/** 局部更新 meta(merge + 写,锁 meta) */
export async function patchMeta(
  id: string,
  patch: Partial<
    Pick<
      BatchRunMeta,
      "name" | "status" | "scoring_dimensions" | "cell_keys" | "external_picks"
    >
  >,
): Promise<BatchRunMeta | null> {
  return withMetaLock(id, async () => {
    const text = await readFileWithRetry(metaFile(id));
    if (text === null) return null;
    const current = BatchRunMetaSchema.parse(JSON.parse(text));
    const merged = { ...current, ...patch };
    const valid = BatchRunMetaSchema.parse(merged);
    await atomicWrite(metaFile(id), JSON.stringify(valid, null, 2));
    return valid;
  });
}

/** 读单 cell,跳 Zod(快) */
async function readCellRaw(
  id: string,
  cellKey: string,
): Promise<unknown | null> {
  const text = await readFileWithRetry(cellFile(id, cellKey));
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 读单 cell + Zod 校验(给 write path 用) */
export async function readCell(
  id: string,
  cellKey: string,
): Promise<BatchCell | null> {
  const raw = await readCellRaw(id, cellKey);
  if (raw === null) return null;
  return BatchCellSchema.parse(raw);
}

/** 列所有 cell_keys(从 meta.cell_keys 读;**不**扫目录,因为 meta 是真相源) */
export async function listCellKeys(id: string): Promise<string[]> {
  const meta = await readMetaRaw(id);
  if (!meta || typeof meta !== "object") return [];
  const keys = (meta as { cell_keys?: unknown }).cell_keys;
  return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : [];
}

/**
 * 批量读所有 cells(并发),跳 Zod。
 * 大 record(几百 cell)调用时会一瞬间 N 文件并发 fs.readFile,内存峰值高但很快。
 */
export async function readCellsRaw(id: string): Promise<unknown[]> {
  const keys = await listCellKeys(id);
  const out = await Promise.all(keys.map((k) => readCellRaw(id, k)));
  return out.filter((c): c is unknown => c !== null);
}

/**
 * 写单 cell(锁 cell mutex,不阻塞别的 cell / meta / GET)。
 * 如果是新 cellKey(meta.cell_keys 里没),会同步更新 meta.cell_keys(锁 meta)。
 */
export async function writeCell(
  id: string,
  cell: BatchCell,
): Promise<BatchCell> {
  const valid = BatchCellSchema.parse(cell);
  const cellKey = cellKeyOfCell(valid);
  await withCellLock(id, cellKey, async () => {
    await atomicWrite(cellFile(id, cellKey), JSON.stringify(valid, null, 2));
  });
  // 检查 meta.cell_keys 是否已含此 key,没有则补
  const meta = await readMetaRaw(id);
  if (meta && typeof meta === "object") {
    const keys = (meta as { cell_keys?: unknown }).cell_keys;
    const known = Array.isArray(keys) ? keys : [];
    if (!known.includes(cellKey)) {
      await patchMeta(id, { cell_keys: [...known.filter((k): k is string => typeof k === "string"), cellKey] });
    }
  }
  return valid;
}

// ────────────────────────────────────────────────────────
// 兼容层:同时识别新目录形态 + 老单文件形态
// ────────────────────────────────────────────────────────

/**
 * 兼容读:
 *   - 新形态(<id>/meta.json 存在)→ 读 meta + 并发读 cells → 组装 BatchRunRecord
 *   - 老形态(<id>.json 存在)→ 直接 JSON.parse
 *   - 都不存在 → null
 *
 * 给 export / SSE 启动快照 / 老调用方用。read path 不做 Zod 校验(快)。
 * 调用方负责 cast 成 BatchRunRecord;如果需要严格校验,调用方自己 BatchRunRecordSchema.parse 一次。
 */
export async function readRunCompat(id: string): Promise<BatchRunRecord | null> {
  if (await isDirFormat(id)) {
    const metaRaw = await readMetaRaw(id);
    if (metaRaw === null || typeof metaRaw !== "object") return null;
    const cellsRaw = await readCellsRaw(id);
    return { ...(metaRaw as object), cells: cellsRaw } as BatchRunRecord;
  }
  if (await isLegacyFormat(id)) {
    const text = await readFileWithRetry(legacyFile(id));
    if (text === null) return null;
    try {
      return JSON.parse(text) as BatchRunRecord;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 兼容读 + 返磁盘 JSON 文本(零序列化)。
 * - 老形态:直接 fs.readFile <id>.json 返 text
 * - 新形态:readRunCompat 组装后 JSON.stringify(慢一点但仍快,无 Zod)
 */
export async function readRunRawText(id: string): Promise<string | null> {
  if (await isLegacyFormat(id)) {
    return readFileWithRetry(legacyFile(id));
  }
  if (await isDirFormat(id)) {
    const record = await readRunCompat(id);
    if (record === null) return null;
    return JSON.stringify(record);
  }
  return null;
}

// ── 老 export 兼容 wrapper(给 17 处调用方用)──────────

/**
 * 兼容老 readRun:走 readRunCompat 后做 Zod 校验。
 * **慎用** —— 全量 Zod 校验深嵌套 record CPU heavy,只在写盘前 sanity check 用。
 * GET 路径用 readRunRawText / readRunCompat。
 */
export async function readRun(id: string): Promise<BatchRunRecord | null> {
  const record = await readRunCompat(id);
  if (record === null) return null;
  return BatchRunRecordSchema.parse(record);
}

/** 兼容老 readRunRaw:返 unknown,不 Zod */
export async function readRunRaw(id: string): Promise<unknown | null> {
  return readRunCompat(id);
}

/**
 * 兼容老 writeRun:写整个 record。
 * 落新形态:拆 meta + 每 cell 一个文件。
 * 不写老 <id>.json(避免双份冗余)。
 */
export async function writeRun(record: BatchRunRecord): Promise<void> {
  const valid = BatchRunRecordSchema.parse(record);
  // 拆 meta(去掉 cells + cell_keys 重算)
  const cellKeys = valid.cells.map((c) => cellKeyOfCell(c));
  const meta: BatchRunMeta = {
    ...valid,
    cell_keys: cellKeys,
  };
  // delete cells from meta(structural,因为 BatchRunRecord 是 BatchRunMeta.extend({ cells }))
  // 不能 delete 字段(typed),手工剔掉
  const { cells, ...metaWithoutCells } = meta as BatchRunMeta & {
    cells: BatchCell[];
  };
  void cells;
  await writeMeta({ ...(metaWithoutCells as BatchRunMeta), cell_keys: cellKeys });
  // 并发写所有 cell
  await Promise.all(valid.cells.map((c) => writeCell(valid.id, c)));
}

/**
 * 兼容老 patchCell(签名不变):
 * 找到 (query_idx, skill_id|pipeline_id, image_model) 对应 cell,merge patch,写盘。
 * 内部锁 per-cell mutex(不阻塞别的 cell)。
 * status 自动收敛逻辑(全 terminal → record.status=finished)走 patchMeta。
 */
export async function patchCell(
  id: string,
  query_idx: number,
  skill_id: string,
  patch: Partial<BatchCell>,
  image_model: string = "",
  pipeline_id: string = "",
): Promise<BatchRunRecord | null> {
  // 先读 meta 看 status(cancelled silent no-op)
  const metaRaw = await readMetaRaw(id);
  if (!metaRaw || typeof metaRaw !== "object") {
    // 可能是老单文件,fall back 老路径
    if (await isLegacyFormat(id)) {
      return patchCellLegacy(id, query_idx, skill_id, patch, image_model, pipeline_id);
    }
    return null;
  }
  const meta = metaRaw as BatchRunMeta;
  if (meta.status === "cancelled") {
    return readRunCompat(id);
  }

  const colId = pipeline_id || skill_id;
  const cellKey = cellKeyOf(query_idx, colId, image_model);

  await withCellLock(id, cellKey, async () => {
    const current = await readCellRaw(id, cellKey);
    if (current === null) {
      // cell 不存在,跳过(老逻辑也是 idx<0 直接返)
      return;
    }
    const merged = { ...(current as object), ...patch } as BatchCell;
    const valid = BatchCellSchema.parse(merged);
    await atomicWrite(cellFile(id, cellKey), JSON.stringify(valid, null, 2));
  });

  // status 收敛:全 terminal → finished
  // 注意这里读 meta 之外还要读所有 cells 看 status,不能避免
  const allCells = await readCellsRaw(id);
  const allTerminal = allCells.every((c) => {
    const s = (c as { status?: string }).status;
    return s === "done" || s === "failed" || s === "excluded";
  });
  if (allTerminal && meta.status === "running") {
    await patchMeta(id, { status: "finished" });
  }

  return readRunCompat(id);
}

/** 老 patchCell 在 legacy format 上的实现(只在 record 还是单文件时用) */
async function patchCellLegacy(
  id: string,
  query_idx: number,
  skill_id: string,
  patch: Partial<BatchCell>,
  image_model: string,
  pipeline_id: string,
): Promise<BatchRunRecord | null> {
  return withMetaLock(id, async () => {
    const text = await readFileWithRetry(legacyFile(id));
    if (text === null) return null;
    const record = BatchRunRecordSchema.parse(JSON.parse(text));
    if (record.status === "cancelled") return record;
    const idx = record.cells.findIndex((c) => {
      if (c.query_idx !== query_idx) return false;
      if ((c.image_model ?? "") !== image_model) return false;
      if (pipeline_id) return (c.pipeline_id ?? "") === pipeline_id;
      return c.skill_id === skill_id;
    });
    if (idx < 0) return record;
    record.cells[idx] = { ...record.cells[idx], ...patch };
    const allTerminal = record.cells.every(
      (c) =>
        c.status === "done" || c.status === "failed" || c.status === "excluded",
    );
    if (allTerminal && record.status === "running") {
      record.status = "finished";
    }
    const valid = BatchRunRecordSchema.parse(record);
    await atomicWrite(legacyFile(id), JSON.stringify(valid, null, 2));
    return valid;
  });
}

/**
 * 兼容老 patchRecord:改 record 级字段(name / status / scoring_dimensions)。
 * 新形态:走 patchMeta。
 * 老形态:走 legacy 路径,改单文件。
 */
export async function patchRecord(
  id: string,
  patch: Partial<
    Pick<BatchRunRecord, "name" | "status" | "scoring_dimensions">
  >,
): Promise<BatchRunRecord | null> {
  if (await isDirFormat(id)) {
    const updatedMeta = await patchMeta(id, patch);
    if (updatedMeta === null) return null;
    return readRunCompat(id);
  }
  if (await isLegacyFormat(id)) {
    return withMetaLock(id, async () => {
      const text = await readFileWithRetry(legacyFile(id));
      if (text === null) return null;
      const record = BatchRunRecordSchema.parse(JSON.parse(text));
      const merged = { ...record, ...patch };
      const valid = BatchRunRecordSchema.parse(merged);
      await atomicWrite(legacyFile(id), JSON.stringify(valid, null, 2));
      return valid;
    });
  }
  return null;
}

/**
 * 兼容老 cancelRun:原子把 record.status=cancelled + 所有 pending/running cell → failed("用户已取消")。
 */
export async function cancelRun(id: string): Promise<{
  record: BatchRunRecord | null;
  cancelled_cells: number;
} | null> {
  if (await isDirFormat(id)) {
    const meta = await readMeta(id);
    if (!meta) return null;
    if (meta.status === "cancelled" || meta.status === "finished") {
      return { record: await readRunCompat(id), cancelled_cells: 0 };
    }
    // 1. 改 status
    await patchMeta(id, { status: "cancelled" });
    // 2. 扫所有 cells 改 pending/running → failed
    const cells = (await readCellsRaw(id)) as BatchCell[];
    let cancelledCount = 0;
    await Promise.all(
      cells.map(async (c) => {
        if (c.status === "pending" || c.status === "running") {
          const next: BatchCell = {
            ...c,
            status: "failed",
            error: "用户已取消",
          };
          await writeCell(id, next);
          cancelledCount++;
        }
      }),
    );
    return { record: await readRunCompat(id), cancelled_cells: cancelledCount };
  }
  if (await isLegacyFormat(id)) {
    return withMetaLock(id, async () => {
      const text = await readFileWithRetry(legacyFile(id));
      if (text === null) return null;
      const record = BatchRunRecordSchema.parse(JSON.parse(text));
      if (record.status === "cancelled" || record.status === "finished") {
        return { record, cancelled_cells: 0 };
      }
      let cancelledCount = 0;
      for (const c of record.cells) {
        if (c.status === "pending" || c.status === "running") {
          c.status = "failed";
          c.error = "用户已取消";
          cancelledCount++;
        }
      }
      record.status = "cancelled";
      const valid = BatchRunRecordSchema.parse(record);
      await atomicWrite(legacyFile(id), JSON.stringify(valid, null, 2));
      return { record: valid, cancelled_cells: cancelledCount };
    });
  }
  return null;
}

/**
 * 列表 summaries:扫所有 record(新目录形态 + 老单文件混合),组装瘦字段。
 * 跳 Zod,手工字段 access,~30 ms / 47 record。
 */
export async function listSummaries(): Promise<BatchRunSummary[]> {
  await ensureDir();
  const entries = await fs.readdir(BATCH_DIR, { withFileTypes: true });
  const ids: Array<{ id: string; legacy: boolean }> = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      ids.push({ id: e.name, legacy: false });
    } else if (e.isFile() && e.name.endsWith(".json") && !e.name.endsWith(".legacy") && !e.name.endsWith(".tmp")) {
      ids.push({ id: e.name.slice(0, -".json".length), legacy: true });
    }
  }

  // 去重(同 id 既有目录又有 legacy 文件 → 优先目录,跳过 legacy)
  const dirIds = new Set(ids.filter((x) => !x.legacy).map((x) => x.id));
  const effective = ids.filter((x) => !x.legacy || !dirIds.has(x.id));

  const out: BatchRunSummary[] = [];
  for (const { id, legacy } of effective) {
    try {
      const raw = legacy
        ? await readFileWithRetry(legacyFile(id))
        : await readFileWithRetry(metaFile(id));
      if (raw === null) continue;
      const r = JSON.parse(raw) as Record<string, unknown>;
      if (!r || typeof r !== "object" || !r.id) continue;

      // 字段 access(跳 Zod):缺啥兜底啥
      const queries = Array.isArray(r.queries) ? r.queries : [];
      const skill_ids = Array.isArray(r.skill_ids) ? r.skill_ids : [];
      const pipeline_ids = Array.isArray(r.pipeline_ids) ? r.pipeline_ids : [];
      const test_kind = (r.test_kind as string) ?? "skill";

      // done / total:legacy 形态直接看 cells;dir 形态从 cell_keys 长度算 total,done 需要扫 cells 文件(贵)
      let done = 0;
      let total = 0;
      if (legacy) {
        const cells = Array.isArray(r.cells) ? (r.cells as Array<{ status?: string }>) : [];
        total = cells.length;
        done = cells.filter((c) => c.status === "done" || c.status === "excluded").length;
      } else {
        const cellKeys = Array.isArray(r.cell_keys) ? r.cell_keys : [];
        total = cellKeys.length;
        // done count 走 readCells —— 但每次扫整个 batch 列表都这样会变 N+N IO。
        // 折中:列表只显示 total,done 用 meta.status 推断:
        //   finished/cancelled → done = total
        //   draft → done = 0
        //   running → done = ?(不准,UI 可以 fallback "进行中")
        // 这跟旧行为有小差异,但列表页本来就是"看个大概",细数走详情。
        const status = (r.status as string) ?? "draft";
        if (status === "finished") done = total;
        else if (status === "cancelled") done = 0; // 已被批量改 failed,实际 done 为 0
        else done = 0;
      }

      out.push({
        id: String(r.id),
        created_at: String(r.created_at ?? ""),
        name: String(r.name ?? ""),
        query_mode: (r.query_mode as BatchRunSummary["query_mode"]) ?? "manual",
        status: (r.status as BatchRunSummary["status"]) ?? "draft",
        n_queries: queries.length,
        n_skills: test_kind === "pipeline" ? pipeline_ids.length : skill_ids.length,
        done_cells: done,
        total_cells: total,
        test_kind: (test_kind as BatchRunSummary["test_kind"]) ?? "skill",
      });
    } catch {
      // 单条坏 record 跳过
    }
  }
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return out;
}

/** rm -rf <id>/ + <id>.json(谨慎使用,目前没 route 调用 — 留作扩展) */
export async function deleteRun(id: string): Promise<void> {
  await withMetaLock(id, async () => {
    try {
      await fs.rm(runDir(id), { recursive: true, force: true });
    } catch {}
    try {
      await fs.unlink(legacyFile(id));
    } catch {}
  });
}

// ── 并发限流 semaphore(保持不变) ──────────────────────

export class Semaphore {
  private capacity: number;
  private inflight = 0;
  private waiters: Array<() => void> = [];

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  async acquire(): Promise<void> {
    if (this.inflight < this.capacity) {
      this.inflight++;
      return;
    }
    await new Promise<void>((res) => this.waiters.push(res));
    this.inflight++;
  }

  release(): void {
    this.inflight--;
    const next = this.waiters.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
