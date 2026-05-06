// prompt-rewriter/lib/history-write.ts
//
// 统一写历史的客户端 helper。所有 lab 走同一个 endpoint:
//   PUT /api/history-runs/<id>
//   body: { lab_id, detail, index_patch }
//
// detail 各 lab 自己的 schema(rewrite=HistoryItem,format=FormatRunRecord),
// index_patch 是同步到全局索引的轻量字段(query / summary / pm_score_*)。
//
// 提供两种写入:
//   - writeHistoryRun       立即写
//   - writeHistoryRunDebounced  按 id 维度 debounce(评分/备注高频改用),
//                             不同 id 互不影响。

"use client";

import { HISTORY_WRITE_DEBOUNCE_MS } from "./constants";

import type { LabId } from "./schema-history-index";

export type IndexPatch = {
  query?: string; // 首次创建必填
  summary?: string;
  status?: "completed" | "failed" | "partial";
  pm_score_avg?: number | null;
  pm_score_count?: number;
  metadata?: Record<string, unknown>;
};

export type WriteArgs = {
  id: string;
  lab_id: LabId;
  detail: unknown;
  index_patch: IndexPatch;
};

export async function writeHistoryRun(
  args: WriteArgs
): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch(
      `/api/history-runs/${encodeURIComponent(args.id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lab_id: args.lab_id,
          detail: args.detail,
          index_patch: args.index_patch,
        }),
      }
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, error: `${resp.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// 按 id 维度的 debounce:不同 record 各自独立计时,
// 同一 record 短时间多次写会合并成最后一次。
const timers = new Map<string, ReturnType<typeof setTimeout>>();
export function writeHistoryRunDebounced(
  args: WriteArgs,
  delay = HISTORY_WRITE_DEBOUNCE_MS
) {
  const existing = timers.get(args.id);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    timers.delete(args.id);
    void writeHistoryRun(args).then((r) => {
      if (!r.ok) console.warn("[history-write] failed:", r.error);
    });
  }, delay);
  timers.set(args.id, t);
}

// 计算简短 summary 的辅助(给 rewrite lab)。
export function summarizeRewriteResult(result: unknown): string {
  // result.classify.vertical_path[].label 拼接
  const path =
    (result as {
      classify?: { vertical_path?: { label?: string }[] };
    })?.classify?.vertical_path
      ?.map((lv) => lv?.label)
      .filter(Boolean)
      .join(" → ") || "";
  return path || "rewrite 跑批";
}

// 计算简短 summary 的辅助(给 format lab)。
export function summarizeFormatRecord(record: {
  format_runs?: { format_id: string; format_label?: string; pm_score?: number | null }[];
  winner_format_id?: string | null;
}): {
  summary: string;
  pm_score_avg: number | null;
  pm_score_count: number;
} {
  const runs = record.format_runs ?? [];
  const scored = runs.filter((r) => typeof r.pm_score === "number");
  const avg =
    scored.length > 0
      ? scored.reduce((s, r) => s + (r.pm_score ?? 0), 0) / scored.length
      : null;
  const winnerLabel =
    record.winner_format_id &&
    runs.find((r) => r.format_id === record.winner_format_id)?.format_label;
  const n = runs.length;
  const summary = winnerLabel
    ? `${n} 路 · 🏆 ${winnerLabel}`
    : `${n} 路对照`;
  return { summary, pm_score_avg: avg, pm_score_count: scored.length };
}
