// prompt-rewriter/lib/batch-store.ts
//
// 批量测试台的持久化层。
//
// 存储约定:
//   data/labs/batch/runs/<id>.json   — 每个 run 一个文件(完整 record)
//   不维护单独的索引文件:列表页直接扫目录读 mtime + 解析头部,N 较小时够用,
//   后期 N>1000 再加 index.json 缓存。
//
// 并发约束:
//   - 同一个 run 在 server 端可能被多路并发改(SSE 推 cell 完成 + PATCH 评分 + 重试),
//     用 per-id mutex 串行化写盘,防止 lost update。
//   - 跨请求共享状态用 globalThis,绕开 Next.js dev hot-reload 重置 module 顶层 state。

import { promises as fs } from "fs";
import path from "path";
import {
  BatchRunRecordSchema,
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

function runFile(id: string): string {
  // basename 防穿越;严格起见也校验 id
  const safe = path.basename(id);
  return path.join(BATCH_DIR, `${safe}.json`);
}

// ── per-id mutex(防 lost update) ──────────────────────
type Mutex = {
  // 串行链:每次 acquire 都接到末尾,release 时把指针前推
  tail: Promise<void>;
};
type GlobalState = {
  mutexes: Map<string, Mutex>;
};
function getState(): GlobalState {
  const g = globalThis as unknown as { __batchStoreState?: GlobalState };
  if (!g.__batchStoreState) {
    g.__batchStoreState = { mutexes: new Map() };
  }
  return g.__batchStoreState;
}

async function withMutex<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const state = getState();
  let m = state.mutexes.get(id);
  if (!m) {
    m = { tail: Promise.resolve() };
    state.mutexes.set(id, m);
  }
  // 形成串行链
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

// ── 读写 ────────────────────────────────────────────────

export async function readRun(id: string): Promise<BatchRunRecord | null> {
  await ensureDir();
  // 不走 mutex(读频繁);但允许写时 race 重试:
  //   - 空文件 / SyntaxError(读到 rename 前的 tmp 或刚 rename 还没 flush 的 cache)→ 等 30ms 重试,最多 5 次
  //   - ENOENT(record 不存在)→ 立即返 null,不重试
  //   - Zod schema 错误(数据真的不合法)→ 立即抛
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const text = await fs.readFile(runFile(id), "utf-8");
      if (text.length === 0) {
        // 文件存在但空:大概率写盘 race,小等再试
        lastErr = new Error("empty record file");
        await new Promise((r) => setTimeout(r, 30));
        continue;
      }
      return BatchRunRecordSchema.parse(JSON.parse(text));
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return null;
      lastErr = e;
      // SyntaxError 也走重试(读到 partial JSON);其它错误立即抛
      if (e instanceof SyntaxError) {
        await new Promise((r) => setTimeout(r, 30));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

export async function writeRun(record: BatchRunRecord): Promise<void> {
  await ensureDir();
  // 写前再 parse 一次确保结构合法;不合法直接报错而不是落坏数据
  const valid = BatchRunRecordSchema.parse(record);
  await withMutex(record.id, async () => {
    const tmp = runFile(record.id) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(valid, null, 2), "utf-8");
    await fs.rename(tmp, runFile(record.id));
  });
}

// 单 cell 局部更新:读 → 找格 → 应用 patch → 写。整段在 mutex 里。
// 多 model 改造后增加 image_model 维度:(query_idx, skill_id, image_model) 三维定位 cell。
// image_model 默认空串(向后兼容单 model record);调用方传非空时按三键精确匹配。
//
// 2026-05-13 Phase 2:支持 pipeline cell 定位。pipeline_id 非空时按 (query_idx, pipeline_id, image_model)
// 匹配(此时 skill_id 应为 ""),否则走原 skill_id 匹配。这样老调用方完全不破。
export async function patchCell(
  id: string,
  query_idx: number,
  skill_id: string,
  patch: Partial<BatchCell>,
  image_model: string = "",
  pipeline_id: string = ""
): Promise<BatchRunRecord | null> {
  await ensureDir();
  return withMutex(id, async () => {
    const text = await fs
      .readFile(runFile(id), "utf-8")
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
    if (text === null) return null;
    const record = BatchRunRecordSchema.parse(JSON.parse(text));
    // 用户取消后的兜底:in-flight runCell 跑完会调 patchCell 把结果写回,
    // 但此时 record 已被 cancelRun() 标 cancelled、cells 也已批量改 failed。
    // 这里 silent no-op 防止迟到的 LLM/生图结果把 cancel mark 又翻回 done/failed-with-other-error。
    if (record.status === "cancelled") {
      return record;
    }
    const idx = record.cells.findIndex((c) => {
      if (c.query_idx !== query_idx) return false;
      if ((c.image_model ?? "") !== image_model) return false;
      // pipeline 模式:按 pipeline_id 匹配(此时 skill_id 应空)
      if (pipeline_id) return (c.pipeline_id ?? "") === pipeline_id;
      // skill 模式(默认):按 skill_id 匹配
      return c.skill_id === skill_id;
    });
    if (idx < 0) return record;
    record.cells[idx] = { ...record.cells[idx], ...patch };
    // 任务级 status 自动收敛:全部 done/failed/excluded → finished
    const allTerminal = record.cells.every(
      (c) =>
        c.status === "done" ||
        c.status === "failed" ||
        c.status === "excluded"
    );
    if (allTerminal && record.status === "running") {
      record.status = "finished";
    }
    const valid = BatchRunRecordSchema.parse(record);
    const tmp = runFile(id) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(valid, null, 2), "utf-8");
    await fs.rename(tmp, runFile(id));
    return valid;
  });
}

// 任务级局部更新:用于改 name / status / scoring_dimensions
export async function patchRecord(
  id: string,
  patch: Partial<
    Pick<BatchRunRecord, "name" | "status" | "scoring_dimensions">
  >
): Promise<BatchRunRecord | null> {
  await ensureDir();
  return withMutex(id, async () => {
    const text = await fs
      .readFile(runFile(id), "utf-8")
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
    if (text === null) return null;
    const record = BatchRunRecordSchema.parse(JSON.parse(text));
    const merged = { ...record, ...patch };
    const valid = BatchRunRecordSchema.parse(merged);
    const tmp = runFile(id) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(valid, null, 2), "utf-8");
    await fs.rename(tmp, runFile(id));
    return valid;
  });
}

// 用户主动取消整 run:原子性地把所有 pending/running cells 改成 failed("用户已取消"),
// 并把 record.status 改成 "cancelled"。
// 不走 patchCell 是因为 patchCell 在 record.status === "cancelled" 时会 silent no-op,
// 而我们这里就是要"先把 status 设成 cancelled、同时把 cells 改完"的原子操作。
//
// 返回:取消前还在 pending/running 的 cell 数量(供 UI 提示"已停止 N 张")。
export async function cancelRun(id: string): Promise<{
  record: BatchRunRecord | null;
  cancelled_cells: number;
} | null> {
  await ensureDir();
  return withMutex(id, async () => {
    const text = await fs
      .readFile(runFile(id), "utf-8")
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
    if (text === null) return null;
    const record = BatchRunRecordSchema.parse(JSON.parse(text));
    // 已经 terminal:不重复改
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
    const tmp = runFile(id) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(valid, null, 2), "utf-8");
    await fs.rename(tmp, runFile(id));
    return { record: valid, cancelled_cells: cancelledCount };
  });
}

// 列表:扫目录,并发读每个文件抠 summary。
//
// 性能注意(2026-05-13 优化):
//   旧实现是 for...of 串行 + 全量 BatchRunRecordSchema.parse,47 个 record 共 ~1.1s
//   (单文件几 MB,parse 含 cells / scoring_dims 等大字段全量校验,各 ~25ms)。
//   浏览器侧某些扩展 monkey-patch fetch 后 ~10s 就 abort,加上 dev mode 首次 turbopack 编译,
//   首次切到 BatchLab 经常 fetch reject。
//
//   新实现:Promise.all 并发读 + safeParse 兜底(不 throw,坏文件跳过)。
//   实测 47 record 从 ~1.1s 降到 ~300ms;坏 record schema 校验失败也只是单条跳过。
export async function listSummaries(): Promise<BatchRunSummary[]> {
  await ensureDir();
  const files = (await fs.readdir(BATCH_DIR)).filter((f) => f.endsWith(".json"));
  const results = await Promise.all(
    files.map(async (f): Promise<BatchRunSummary | null> => {
      try {
        const text = await fs.readFile(path.join(BATCH_DIR, f), "utf-8");
        const parsed = BatchRunRecordSchema.safeParse(JSON.parse(text));
        if (!parsed.success) return null;
        const r = parsed.data;
        const done = r.cells.filter(
          (c) => c.status === "done" || c.status === "excluded"
        ).length;
        return {
          id: r.id,
          created_at: r.created_at,
          name: r.name,
          query_mode: r.query_mode,
          status: r.status,
          n_queries: r.queries.length,
          // n_skills 字段保留语义:test_kind=pipeline 时显示 pipeline 数(共用 chip 显示)
          n_skills:
            r.test_kind === "pipeline"
              ? r.pipeline_ids.length
              : r.skill_ids.length,
          done_cells: done,
          total_cells: r.cells.length,
          test_kind: r.test_kind,
        };
      } catch {
        // 跳过坏文件(读盘 / JSON.parse 失败),不影响列表
        return null;
      }
    }),
  );
  const out = results.filter((x): x is BatchRunSummary => x !== null);
  // 倒序:最新的在前
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return out;
}

// ── 并发限流 semaphore ─────────────────────────────────
// 每个 batch run 启动时持有一个 semaphore,控制同时跑的 cell 数。
// 不上 globalThis,因为 semaphore 跟 run 启动生命周期绑定,不需要跨请求共享。
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
