// prompt-rewriter/lib/questions/store.ts
//
// 题目库存储层(2026-05-13 改为两级:题目集 → 题目)。
//
// 数据落盘:
//   data/labs/questions/_index.json           ← QuestionSetHead[] 瘦索引
//   data/labs/questions/sets/<set_id>.json    ← 单个 QuestionSet 完整内容(含 Question[])
//
// 并发:
//   - 全局 indexMutex 串行化 _index.json 读改写
//   - per-set mutex 串行化每个 set_id.json 读改写
//   - 跨 hot-reload 共享(参考 lib/batch-store / lib/experiments/store)

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import {
  QuestionSchema,
  QuestionSetSchema,
  QuestionsIndexSchema,
  toHead,
  toSetHead,
  type Question,
  type QuestionHead,
  type QuestionSet,
  type QuestionSetHead,
} from "./schema";

const ROOT = process.cwd();
export const QUESTIONS_DIR = path.join(ROOT, "data", "labs", "questions");
const SETS_DIR = path.join(QUESTIONS_DIR, "sets");
// 2026-05-13 方案 A:上传时把原 xlsx 也存一份做备份(PM 可下载源文件)
// 跟 sets/ 平级独立目录,避免跟 .json 文件混在一起
const SOURCES_DIR = path.join(QUESTIONS_DIR, "sources");
const INDEX_FILE = path.join(QUESTIONS_DIR, "_index.json");

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

// ── globalThis mutex ──
type Mutex = { tail: Promise<void> };
type GlobalState = {
  indexMutex: Mutex;
  setMutexes: Map<string, Mutex>;
};
function getState(): GlobalState {
  const g = globalThis as unknown as { __questionsStoreV2?: GlobalState };
  if (!g.__questionsStoreV2) {
    g.__questionsStoreV2 = {
      indexMutex: { tail: Promise.resolve() },
      setMutexes: new Map(),
    };
  }
  return g.__questionsStoreV2;
}

async function withIndexMutex<T>(fn: () => Promise<T>): Promise<T> {
  const m = getState().indexMutex;
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

async function withSetMutex<T>(
  setId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const state = getState();
  let m = state.setMutexes.get(setId);
  if (!m) {
    m = { tail: Promise.resolve() };
    state.setMutexes.set(setId, m);
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

async function ensureDirs() {
  await fs.mkdir(SETS_DIR, { recursive: true });
  await fs.mkdir(SOURCES_DIR, { recursive: true });
}

async function atomicWrite(target: string, content: string) {
  const tmp = target + ".tmp";
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, target);
}

function setFile(setId: string): string {
  const safe = path.basename(setId);
  return path.join(SETS_DIR, `${safe}.json`);
}

function sourceXlsxFile(setId: string): string {
  const safe = path.basename(setId);
  return path.join(SOURCES_DIR, `${safe}.xlsx`);
}

// ── 索引读写 ──

async function readIndex(): Promise<QuestionSetHead[]> {
  try {
    const text = await fs.readFile(INDEX_FILE, "utf-8");
    const json = JSON.parse(text);
    const parsed = QuestionsIndexSchema.safeParse(json);
    return parsed.success ? parsed.data.sets : [];
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    console.warn("[questions/store] _index.json 读失败:", err.message);
    return [];
  }
}

async function writeIndex(sets: QuestionSetHead[]): Promise<void> {
  await ensureDirs();
  await atomicWrite(INDEX_FILE, JSON.stringify({ sets }, null, 2));
}

// ── 题目集 CRUD ──

export async function listSets(): Promise<QuestionSetHead[]> {
  const idx = await readIndex();
  // 按 updated_at 降序
  return [...idx].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function readSet(setId: string): Promise<QuestionSet | null> {
  if (!SAFE_ID.test(setId)) return null;
  try {
    const text = await fs.readFile(setFile(setId), "utf-8");
    const parsed = QuestionSetSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw e;
  }
}

/** 创建新题目集(导入 xlsx 用)。返回新 set head。
 *  传 source_xlsx 时会同时把原 xlsx Buffer 备份到 SOURCES_DIR(方案 A) */
export async function createSet(args: {
  name: string;
  description?: string;
  source_filename?: string;
  questions: Question[];
  source_xlsx?: Buffer;
}): Promise<QuestionSetHead> {
  const setId = `set_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();
  const fullSet: QuestionSet = {
    set_id: setId,
    name: args.name.trim() || "未命名题目集",
    description: args.description ?? "",
    source_filename: args.source_filename ?? "",
    created_at: now,
    updated_at: now,
    questions: args.questions,
  };
  const valid = QuestionSetSchema.parse(fullSet);

  await ensureDirs();
  await withSetMutex(setId, async () => {
    await atomicWrite(setFile(setId), JSON.stringify(valid, null, 2));
    // 方案 A:同步备份原 xlsx(用 buffer 直接写,不必 tmp+rename,失败不影响 JSON 落盘)
    if (args.source_xlsx) {
      try {
        await fs.writeFile(sourceXlsxFile(setId), args.source_xlsx);
      } catch (e) {
        // xlsx 备份失败仅 warn,不让整个导入失败(JSON 已经写好,数据完整)
        console.warn(
          `[questions/store] source xlsx 备份失败(set=${setId}):`,
          e,
        );
      }
    }
  });

  // 更新索引
  await withIndexMutex(async () => {
    const idx = await readIndex();
    idx.push(toSetHead(valid));
    await writeIndex(idx);
  });

  return toSetHead(valid);
}

/** 读取原 xlsx 备份文件(给下载接口用)。没有备份返回 null。 */
export async function readSourceXlsx(setId: string): Promise<Buffer | null> {
  if (!SAFE_ID.test(setId)) return null;
  try {
    return await fs.readFile(sourceXlsxFile(setId));
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw e;
  }
}

/** 判断 set 是否有 xlsx 备份(给 UI 决定显示 / 隐藏下载按钮) */
export async function hasSourceXlsx(setId: string): Promise<boolean> {
  if (!SAFE_ID.test(setId)) return false;
  try {
    await fs.stat(sourceXlsxFile(setId));
    return true;
  } catch {
    return false;
  }
}

/** 改题目集元数据(name / description 白名单) */
export async function patchSet(
  setId: string,
  patch: { name?: string; description?: string },
): Promise<QuestionSetHead> {
  return await withSetMutex(setId, async () => {
    const cur = await readSet(setId);
    if (!cur) throw new Error(`题目集不存在: ${setId}`);
    const merged: QuestionSet = {
      ...cur,
      name: patch.name !== undefined ? patch.name.trim() || cur.name : cur.name,
      description:
        patch.description !== undefined ? patch.description : cur.description,
      updated_at: new Date().toISOString(),
    };
    const valid = QuestionSetSchema.parse(merged);
    await atomicWrite(setFile(setId), JSON.stringify(valid, null, 2));
    // 同步索引
    await withIndexMutex(async () => {
      const idx = await readIndex();
      const i = idx.findIndex((s) => s.set_id === setId);
      if (i >= 0) idx[i] = toSetHead(valid);
      await writeIndex(idx);
    });
    return toSetHead(valid);
  });
}

/** 删题目集(JSON + 源 xlsx 备份 + 索引项,一起清掉) */
export async function deleteSet(setId: string): Promise<{ deleted: boolean }> {
  return await withSetMutex(setId, async () => {
    try {
      await fs.unlink(setFile(setId));
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw e;
    }
    // 顺手清 xlsx 备份(不存在也无所谓)
    try {
      await fs.unlink(sourceXlsxFile(setId));
    } catch {
      /* ignore */
    }
    await withIndexMutex(async () => {
      const idx = await readIndex();
      const filtered = idx.filter((s) => s.set_id !== setId);
      await writeIndex(filtered);
    });
    return { deleted: true };
  });
}

// ── set 内题目 CRUD ──

export interface ListQuestionsOpts {
  l1?: string;
  l2?: string;
  q?: string;
  tag?: string;
  has_images?: boolean;
  limit?: number;
  offset?: number;
}

export async function listQuestionsInSet(
  setId: string,
  opts: ListQuestionsOpts = {},
): Promise<{
  items: QuestionHead[];
  total: number;
  set_head: QuestionSetHead | null;
}> {
  const set = await readSet(setId);
  if (!set) return { items: [], total: 0, set_head: null };

  const { l1, l2, q, tag, has_images, limit = 50, offset = 0 } = opts;
  let heads = set.questions.map(toHead);

  if (l1) heads = heads.filter((h) => h.categories[0] === l1);
  if (l2) heads = heads.filter((h) => h.categories[1] === l2);
  if (tag) heads = heads.filter((h) => h.tags.includes(tag));
  if (has_images !== undefined)
    heads = heads.filter((h) => h.has_images === has_images);
  if (q) {
    const needle = q.toLowerCase();
    heads = heads.filter(
      (h) =>
        h.qid.toLowerCase().includes(needle) ||
        h.text_preview.toLowerCase().includes(needle),
    );
  }
  heads.sort((a, b) => a.qid.localeCompare(b.qid));

  return {
    items: heads.slice(offset, offset + Math.max(0, limit)),
    total: heads.length,
    set_head: toSetHead(set),
  };
}

export async function readQuestionInSet(
  setId: string,
  qid: string,
): Promise<Question | null> {
  const set = await readSet(setId);
  if (!set) return null;
  return set.questions.find((q) => q.qid === qid) ?? null;
}

/** 改单题 tags / note(白名单,其他字段 immutable) */
export async function patchQuestionInSet(
  setId: string,
  qid: string,
  patch: { tags?: string[]; note?: string },
): Promise<Question> {
  return await withSetMutex(setId, async () => {
    const set = await readSet(setId);
    if (!set) throw new Error(`题目集不存在: ${setId}`);
    const idx = set.questions.findIndex((q) => q.qid === qid);
    if (idx < 0) throw new Error(`题目不存在: ${qid}`);
    const cur = set.questions[idx];
    const merged: Question = {
      ...cur,
      tags: patch.tags ?? cur.tags,
      note: patch.note ?? cur.note,
    };
    const valid = QuestionSchema.parse(merged);
    set.questions[idx] = valid;
    set.updated_at = new Date().toISOString();
    await atomicWrite(setFile(setId), JSON.stringify(set, null, 2));
    // 同步索引 updated_at
    await withIndexMutex(async () => {
      const idx2 = await readIndex();
      const i = idx2.findIndex((s) => s.set_id === setId);
      if (i >= 0) idx2[i] = toSetHead(set);
      await writeIndex(idx2);
    });
    return valid;
  });
}

// ── 跨题目集的聚合(给 tag / category 管理 tab 用) ──

async function readAllSets(): Promise<QuestionSet[]> {
  const idx = await readIndex();
  const sets: QuestionSet[] = [];
  for (const head of idx) {
    const s = await readSet(head.set_id);
    if (s) sets.push(s);
  }
  return sets;
}

export interface TagStat {
  name: string;
  count: number;
  qids: string[];                         // 用 "set_id::qid" 复合 key,避免跨 set qid 冲突
}

export async function listTags(): Promise<{
  tags: TagStat[];
  total_tagged_questions: number;
}> {
  const sets = await readAllSets();
  const byTag = new Map<string, string[]>();
  let tagged = 0;
  for (const s of sets) {
    for (const q of s.questions) {
      if (q.tags.length > 0) tagged++;
      for (const t of q.tags) {
        if (!byTag.has(t)) byTag.set(t, []);
        byTag.get(t)!.push(`${s.set_id}::${q.qid}`);
      }
    }
  }
  const tags: TagStat[] = Array.from(byTag.entries())
    .map(([name, qids]) => ({ name, count: qids.length, qids }))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
  return { tags, total_tagged_questions: tagged };
}

/** 全局重命名 tag(across all sets) */
export async function renameTag(
  oldName: string,
  newName: string,
): Promise<{ affected: number }> {
  if (!oldName.trim() || !newName.trim()) throw new Error("tag 不能为空");
  if (oldName === newName) return { affected: 0 };

  let affected = 0;
  const idx = await readIndex();
  for (const head of idx) {
    await withSetMutex(head.set_id, async () => {
      const set = await readSet(head.set_id);
      if (!set) return;
      let localAffected = 0;
      for (const q of set.questions) {
        if (!q.tags.includes(oldName)) continue;
        localAffected++;
        const s = new Set(q.tags.map((t) => (t === oldName ? newName : t)));
        q.tags = Array.from(s);
      }
      if (localAffected > 0) {
        set.updated_at = new Date().toISOString();
        await atomicWrite(setFile(head.set_id), JSON.stringify(set, null, 2));
        affected += localAffected;
      }
    });
  }
  // 索引 updated_at 不强同步(下次 PATCH/导入会刷)
  return { affected };
}

export async function deleteTag(name: string): Promise<{ affected: number }> {
  if (!name.trim()) throw new Error("tag 不能为空");
  let affected = 0;
  const idx = await readIndex();
  for (const head of idx) {
    await withSetMutex(head.set_id, async () => {
      const set = await readSet(head.set_id);
      if (!set) return;
      let localAffected = 0;
      for (const q of set.questions) {
        const before = q.tags.length;
        q.tags = q.tags.filter((t) => t !== name);
        if (q.tags.length < before) localAffected++;
      }
      if (localAffected > 0) {
        set.updated_at = new Date().toISOString();
        await atomicWrite(setFile(head.set_id), JSON.stringify(set, null, 2));
        affected += localAffected;
      }
    });
  }
  return { affected };
}

// ── 分类聚合 ──

export interface CategoryNode {
  name: string;
  count: number;
  qids: string[];                         // "set_id::qid" 复合 key
}

export async function listCategoriesDetail(): Promise<{
  l1: CategoryNode[];
  l2_by_l1: Record<string, CategoryNode[]>;
  uncategorized: { qids: string[] };
  total_categorized_questions: number;
}> {
  const sets = await readAllSets();
  const l1Map = new Map<string, string[]>();
  const l2Map = new Map<string, Map<string, string[]>>();
  const uncategorized: string[] = [];

  for (const s of sets) {
    for (const q of s.questions) {
      const key = `${s.set_id}::${q.qid}`;
      const c1 = q.categories[0];
      const c2 = q.categories[1];
      if (!c1) {
        uncategorized.push(key);
        continue;
      }
      if (!l1Map.has(c1)) l1Map.set(c1, []);
      l1Map.get(c1)!.push(key);
      if (c2) {
        if (!l2Map.has(c1)) l2Map.set(c1, new Map());
        const m = l2Map.get(c1)!;
        if (!m.has(c2)) m.set(c2, []);
        m.get(c2)!.push(key);
      }
    }
  }

  const l1: CategoryNode[] = Array.from(l1Map.entries())
    .map(([name, qids]) => ({ name, count: qids.length, qids }))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
  const l2_by_l1: Record<string, CategoryNode[]> = {};
  for (const [c1, m] of l2Map.entries()) {
    l2_by_l1[c1] = Array.from(m.entries())
      .map(([name, qids]) => ({ name, count: qids.length, qids }))
      .sort((a, b) => {
        if (a.count !== b.count) return b.count - a.count;
        return a.name.localeCompare(b.name);
      });
  }
  const totalCategorized = sets.reduce(
    (acc, s) =>
      acc + s.questions.filter((q) => q.categories.length > 0).length,
    0,
  );
  return {
    l1,
    l2_by_l1,
    uncategorized: { qids: uncategorized },
    total_categorized_questions: totalCategorized,
  };
}

/** 给筛选下拉用的轻量版(无 qids) */
export async function listCategories(): Promise<{
  l1: { name: string; count: number }[];
  l2_by_l1: Record<string, { name: string; count: number }[]>;
}> {
  const detail = await listCategoriesDetail();
  return {
    l1: detail.l1.map(({ name, count }) => ({ name, count })),
    l2_by_l1: Object.fromEntries(
      Object.entries(detail.l2_by_l1).map(([k, arr]) => [
        k,
        arr.map(({ name, count }) => ({ name, count })),
      ]),
    ),
  };
}
