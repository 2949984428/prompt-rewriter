// prompt-rewriter/lib/fusion-store.ts
//
// 融合台持久化层。模式跟 batch-store.ts 一致:
//   data/labs/fusion/runs/<id>.json     一 run 一文件
//   per-id mutex 串行写盘(防 lost update)
//   原子 rename(写 .tmp + rename)
//
// 跟 batch-store 不同的地方:
// - 没有 patchCell 概念(融合粒度是整 record 级别,attempt 级别 append)
// - 没有"自动收敛 status"(融合是单次 LLM 调用,append 一次就 ready)

import { promises as fs } from "fs";
import path from "path";
import {
  FusionRunRecordSchema,
  type FusionRunRecord,
  type FusionAttempt,
  type FusionRunSummary,
} from "@/lib/schema";

export const FUSION_DIR = path.join(
  process.cwd(),
  "data",
  "labs",
  "fusion",
  "runs"
);

async function ensureDir() {
  await fs.mkdir(FUSION_DIR, { recursive: true });
}

function runFile(id: string): string {
  // basename 防穿越
  const safe = path.basename(id);
  return path.join(FUSION_DIR, `${safe}.json`);
}

// ── per-id mutex ──────────────────────
type Mutex = { tail: Promise<void> };
type GlobalState = { mutexes: Map<string, Mutex> };
function getState(): GlobalState {
  const g = globalThis as unknown as { __fusionStoreState?: GlobalState };
  if (!g.__fusionStoreState) g.__fusionStoreState = { mutexes: new Map() };
  return g.__fusionStoreState;
}

async function withMutex<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const state = getState();
  let m = state.mutexes.get(id);
  if (!m) {
    m = { tail: Promise.resolve() };
    state.mutexes.set(id, m);
  }
  const prev = m.tail;
  let release: () => void = () => {};
  m.tail = new Promise<void>((res) => { release = res; });
  try {
    await prev;
    return await fn();
  } finally {
    release();
  }
}

// ── 读写 ────────────────────────────────────────────────

export async function readRun(id: string): Promise<FusionRunRecord | null> {
  await ensureDir();
  try {
    const text = await fs.readFile(runFile(id), "utf-8");
    return FusionRunRecordSchema.parse(JSON.parse(text));
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw e;
  }
}

export async function writeRun(record: FusionRunRecord): Promise<void> {
  await ensureDir();
  const valid = FusionRunRecordSchema.parse(record);
  await withMutex(record.id, async () => {
    const tmp = runFile(record.id) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(valid, null, 2), "utf-8");
    await fs.rename(tmp, runFile(record.id));
  });
}

// 追加一次 attempt(初始 + 重试都用这个)。
// status 自动转移:有 result → ready,没有(失败)→ 保持原状态。
// 不在 LLM 跑中标 "merging",因为 LLM 调用是同步的,attempt 落盘时已经定型。
export async function appendAttempt(
  id: string,
  attempt: FusionAttempt
): Promise<FusionRunRecord | null> {
  await ensureDir();
  return withMutex(id, async () => {
    const text = await fs
      .readFile(runFile(id), "utf-8")
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
    if (text === null) return null;
    const record = FusionRunRecordSchema.parse(JSON.parse(text));
    record.attempts.push(attempt);
    if (attempt.result) {
      record.status = "ready";
    }
    const valid = FusionRunRecordSchema.parse(record);
    const tmp = runFile(id) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(valid, null, 2), "utf-8");
    await fs.rename(tmp, runFile(id));
    return valid;
  });
}

// 改 status / name(局部更新)
export async function patchRecord(
  id: string,
  patch: Partial<Pick<FusionRunRecord, "name" | "status">>
): Promise<FusionRunRecord | null> {
  await ensureDir();
  return withMutex(id, async () => {
    const text = await fs
      .readFile(runFile(id), "utf-8")
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
    if (text === null) return null;
    const record = FusionRunRecordSchema.parse(JSON.parse(text));
    const merged = { ...record, ...patch };
    const valid = FusionRunRecordSchema.parse(merged);
    const tmp = runFile(id) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(valid, null, 2), "utf-8");
    await fs.rename(tmp, runFile(id));
    return valid;
  });
}

// 列表(扫目录,每个文件抠 summary)。N 大时再加 cache。
export async function listSummaries(): Promise<FusionRunSummary[]> {
  await ensureDir();
  const files = await fs.readdir(FUSION_DIR);
  const out: FusionRunSummary[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const text = await fs.readFile(path.join(FUSION_DIR, f), "utf-8");
      const r = FusionRunRecordSchema.parse(JSON.parse(text));
      const ruleLabel =
        r.rule.kind === "lab"
          ? `${r.rule.skill_id} / ${r.rule.granularity}${r.rule.section_anchor ? ` / ${r.rule.section_anchor}` : ""}`
          : "自定义规则";
      out.push({
        id: r.id,
        created_at: r.created_at,
        name: r.name,
        status: r.status,
        rule_kind: r.rule.kind,
        rule_label: ruleLabel,
        source_prompt_preview: r.source_prompt.slice(0, 60),
        attempt_count: r.attempts.length,
      });
    } catch {
      // 跳过坏文件
    }
  }
  // 倒序:最新的在前
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return out;
}
