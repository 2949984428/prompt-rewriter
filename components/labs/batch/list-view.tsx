// prompt-rewriter/components/labs/batch/list-view.tsx
//
// 批量测试台首页:header + 新建按钮 + 历史卡片列表。
// 卡片显示:name / mode / 进度条 / created_at,点卡进详情。

"use client";

import { useState } from "react";
import { useAtom } from "jotai";
import { Plus, ListChecks, RefreshCw, CircleStop, Loader2 } from "lucide-react";
import { batchSummariesAtom, batchViewAtom } from "@/lib/atoms-batch";
import type { BatchRunSummary, BatchTestKind } from "@/lib/schema";

const MODE_LABEL: Record<BatchRunSummary["query_mode"], string> = {
  derive: "AI 派生",
  manual: "自填",
  repeat: "重复",
  set: "题目集",
};

const STATUS_LABEL: Record<BatchRunSummary["status"], string> = {
  draft: "未启动",
  running: "进行中",
  finished: "已完成",
  cancelled: "已取消",
};

const STATUS_BADGE: Record<BatchRunSummary["status"], string> = {
  draft: "border-stone-gray text-stone-gray",
  running: "border-warm-gold-fg bg-warm-gold-bg text-warm-gold-fg",
  finished: "border-terracotta bg-coral-soft-bg/40 text-terracotta",
  cancelled: "border-stone-gray bg-warm-sand/40 text-stone-gray",
};

export function BatchListView({
  filterTestKind,
}: {
  /** 按 test_kind 过滤 list(Pipeline 测试台传 "pipeline" / Skill 测试台传 "skill")。
   *  不传 = 不过滤(展示所有 records)。两个 sub-lab 共用同一份 batch runs 数据,
   *  list 层 filter 后看起来像独立两个页面。 */
  filterTestKind?: BatchTestKind;
} = {}) {
  const [summaries, setSummaries] = useAtom(batchSummariesAtom);
  const [, setView] = useAtom(batchViewAtom);

  const refresh = async () => {
    try {
      const r = await fetch("/api/labs/batch/runs", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { runs?: BatchRunSummary[] };
      if (Array.isArray(j.runs)) setSummaries(j.runs);
    } catch {
      /* ignore */
    }
  };

  // 按 test_kind 过滤(老 record 没 test_kind 字段 → schema default "skill",
  // 所以 Pipeline 测试台不会误显示老 skill records)
  const filtered = filterTestKind
    ? summaries.filter((s) => s.test_kind === filterTestKind)
    : summaries;

  // 标题 / 副标随 filterTestKind 切换
  const heading =
    filterTestKind === "pipeline"
      ? "Pipeline 测试台"
      : filterTestKind === "skill"
        ? "Skill 批量测试台"
        : "批量测试台";
  const subheading =
    filterTestKind === "pipeline"
      ? "一次跑 N 个 query × M 个 pipeline 的矩阵,横评完整链路(SP1 → 策略 → CreationPlanner → SP2 → 生图)的效果差异。"
      : "一次跑 N 个 query × M 个 skill 的矩阵,自动汇总成可对比 + 可打分的结果集。适合\"我要批量看看哪个 skill 在某个场景下最稳\"。";

  return (
    <>
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="font-serif text-[32px] font-medium leading-[1.2] text-near-black">
            {heading}
          </h1>
          <p className="mt-3 max-w-[680px] text-[16px] leading-[1.6] text-olive-gray">
            {subheading}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-2">
          <button
            onClick={refresh}
            className="flex h-9 items-center gap-2 rounded-md border border-border-warm bg-ivory px-3 text-[13px] text-olive-gray transition hover:border-stone-gray hover:text-near-black"
            title="刷新列表"
          >
            <RefreshCw size={14} />
            刷新
          </button>
          <button
            onClick={() => setView({ kind: "create" })}
            className="flex h-9 items-center gap-2 rounded-md bg-terracotta px-4 text-[13px] font-medium text-ivory transition hover:bg-terracotta/90"
          >
            <Plus size={16} strokeWidth={2.4} />
            新建批量测试
          </button>
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border-warm bg-ivory p-16 text-center">
          <ListChecks size={28} className="mx-auto text-stone-gray" />
          <p className="mt-3 text-[14px] text-stone-gray">
            {filterTestKind === "pipeline"
              ? "还没有 Pipeline 跑批。点右上角『新建批量测试』开始第一次。"
              : filterTestKind === "skill"
                ? "还没有 Skill 跑批。点右上角『新建批量测试』开始第一次。"
                : "还没有任务。点右上角『新建批量测试』开始第一次。"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => {
            const pct =
              s.total_cells > 0
                ? Math.round((s.done_cells / s.total_cells) * 100)
                : 0;
            return (
              <button
                key={s.id}
                onClick={() => setView({ kind: "detail", id: s.id })}
                className="flex w-full items-center gap-4 rounded-md border border-border-cream bg-ivory px-5 py-4 text-left transition hover:border-border-warm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <div className="truncate text-[15px] font-medium text-near-black">
                      {s.name || "(未命名)"}
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${STATUS_BADGE[s.status]}`}
                    >
                      {STATUS_LABEL[s.status]}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-4 text-[12.5px] text-stone-gray">
                    {s.test_kind === "pipeline" && (
                      <span className="rounded bg-terracotta/15 px-1.5 py-0 font-mono text-[10px] text-terracotta">
                        PIPELINE
                      </span>
                    )}
                    <span>{MODE_LABEL[s.query_mode]}</span>
                    <span>·</span>
                    <span>{s.n_queries} query × {s.n_skills} skill</span>
                    <span>·</span>
                    <span>{new Date(s.created_at).toLocaleString("zh-CN")}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[12.5px] text-stone-gray">
                    {s.done_cells}/{s.total_cells}
                  </div>
                  <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-border-cream">
                    <div
                      className="h-full bg-terracotta transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                {/* running 状态:直接挂中断按钮,无需进 detail 才能停 */}
                {s.status === "running" && (
                  <ListStopButton
                    runId={s.id}
                    pendingCount={s.total_cells - s.done_cells}
                    onStopped={refresh}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// 列表页的中断按钮 — 跟 detail-view StopRunButton 行为一致,但视觉收敛(列表行紧凑)
function ListStopButton({
  runId,
  pendingCount,
  onStopped,
}: {
  runId: string;
  pendingCount: number;
  onStopped: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const onClick = async (e: React.MouseEvent) => {
    // 阻止冒泡 — 不然会触发外层 button 的进入 detail 跳转
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    const ok = window.confirm(
      `确认停止本次跑批吗?\n\n还有 ${pendingCount} 张未完成,会全部标记为已取消。\n已经在跑的 LLM 调用会自动跑完(结果不写回),不会浪费配额。`
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/labs/batch/runs/${runId}/cancel`, {
        method: "POST",
      });
      if (r.ok) onStopped();
    } catch {
      /* swallow:用户可重试 */
    } finally {
      setBusy(false);
    }
  };

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent);
        }
      }}
      title="停止本次跑批"
      className="ml-2 flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-stone-gray/40 bg-warm-sand px-2 text-[11px] font-medium text-near-black transition hover:bg-warm-sand/70"
    >
      {busy ? (
        <Loader2 size={11} className="animate-spin" />
      ) : (
        <CircleStop size={11} />
      )}
      停止
    </span>
  );
}
