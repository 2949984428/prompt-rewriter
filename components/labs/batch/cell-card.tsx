// prompt-rewriter/components/labs/batch/cell-card.tsx
//
// 单格:状态机 + 缩略图 + 已评分指示。
// 点击整格打开 BatchScoreDrawer。
// 状态:pending / running / done / failed / excluded
// 重试按钮:failed / done 都可以重试(done 是用户对结果不满意时再跑一次)。

"use client";

import { useAtom } from "jotai";
import { Loader2, AlertTriangle, RotateCw, Star, EyeOff } from "lucide-react";
import {
  batchActiveCellAtom,
  currentBatchRunAtom,
} from "@/lib/atoms-batch";
import type { FinalPrompt } from "@/lib/schema";

function aspectRatio(size?: FinalPrompt["size"]): number {
  if (!size || size === "auto") return 1;
  const m = size.match(/^(\d+)x(\d+)$/);
  if (!m) return 1;
  return Number(m[1]) / Number(m[2]);
}

export function BatchCellCard({
  query_idx,
  skill_id,
  pipeline_id = "",
  image_model = "",
}: {
  query_idx: number;
  skill_id: string;
  // Phase 2:Pipeline 测试台 cell 用 pipeline_id 定位(skill_id 此时为空)
  pipeline_id?: string;
  // 多 model 改造后的精确定位字段;空 = 单 model 模式(老 record 兼容)
  image_model?: string;
}) {
  const [record, setRecord] = useAtom(currentBatchRunAtom);
  const [, setActive] = useAtom(batchActiveCellAtom);

  if (!record) return null;
  // Pipeline 模式按 pipeline_id 匹配;Skill 模式按 skill_id 匹配
  const matchCell = (c: typeof record.cells[number]) => {
    if (c.query_idx !== query_idx) return false;
    if ((c.image_model ?? "") !== image_model) return false;
    if (pipeline_id) return (c.pipeline_id ?? "") === pipeline_id;
    return c.skill_id === skill_id;
  };
  const cell = record.cells.find(matchCell);
  if (!cell) return null;

  const onRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // 乐观更新:这一格立刻回到 pending、清掉旧产物;若整 record 已 finished,
    // 拉回 running —— 这是触发 detail-view SSE useEffect 重新订阅的关键。
    setRecord((prev) => {
      if (!prev) return prev;
      const idx = prev.cells.findIndex(matchCell);
      if (idx < 0) return prev;
      const cells = [...prev.cells];
      cells[idx] = {
        ...cells[idx],
        status: "pending",
        final_prompt: null,
        image_urls: null,
        error: null,
        raw: "",
        ms: 0,
      };
      return {
        ...prev,
        cells,
        status:
          prev.status === "finished" || prev.status === "cancelled"
            ? "running"
            : prev.status,
      };
    });
    try {
      const r = await fetch(
        `/api/labs/batch/runs/${record.id}/cells/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query_idx, skill_id, pipeline_id, image_model }),
        }
      );
      if (!r.ok) {
        // 后端拒绝:回退乐观更新(保留原 cell 状态)。
        // 简单做法 —— 触发一次 GET 拉服务端真值。
        const fresh = await fetch(`/api/labs/batch/runs/${record.id}`).then(
          (resp) => (resp.ok ? resp.json() : null)
        );
        if (fresh) setRecord(fresh);
      }
    } catch {
      /* 网络错误就保留乐观态,用户可再点 */
    }
  };

  const dimsCount = record.scoring_dimensions.length;
  const scoredCount = Object.keys(cell.scores).filter(
    (k) => typeof cell.scores[k] === "number" && cell.scores[k] > 0
  ).length;
  const allScored = dimsCount > 0 && scoredCount >= dimsCount;
  const ar = aspectRatio(cell.final_prompt?.size);

  // ─────────── 状态化外观 ───────────
  const baseFrame =
    "group relative flex flex-col overflow-hidden rounded-md border transition";
  let frameClass = "";
  if (cell.status === "excluded") {
    frameClass =
      "border-border-cream bg-parchment/30 opacity-60 hover:opacity-90";
  } else if (cell.status === "failed") {
    frameClass = "border-error-crimson/40 bg-coral-soft-bg/20";
  } else if (cell.status === "done" && allScored) {
    frameClass =
      "border-warm-gold-fg/60 bg-warm-gold-bg/30 hover:border-warm-gold-fg";
  } else if (cell.status === "done") {
    frameClass = "border-border-warm bg-ivory hover:border-stone-gray";
  } else {
    frameClass = "border-dashed border-border-warm bg-ivory";
  }

  return (
    <button
      onClick={() => setActive({ query_idx, skill_id, image_model, pipeline_id })}
      className={`${baseFrame} ${frameClass} w-full text-left`}
      disabled={cell.status === "pending" || cell.status === "running"}
    >
      {/* 图区 */}
      <div
        className="relative w-full overflow-hidden bg-parchment/40"
        style={{ aspectRatio: ar }}
      >
        {cell.status === "pending" && (
          <Centered>
            <span className="text-[11.5px] text-stone-gray">等待中…</span>
          </Centered>
        )}
        {cell.status === "running" && (
          <Centered>
            <Loader2
              size={20}
              className="animate-spin text-warm-gold-fg"
            />
            <span className="mt-1.5 text-[11px] text-stone-gray">跑中…</span>
          </Centered>
        )}
        {cell.status === "failed" && (
          <Centered>
            <AlertTriangle size={20} className="text-error-crimson" />
            <span className="mt-1 text-[11px] text-error-crimson">失败</span>
          </Centered>
        )}
        {cell.status === "excluded" && (
          <Centered>
            <EyeOff size={20} className="text-stone-gray" />
            <span className="mt-1 text-[11px] text-stone-gray">已排除</span>
          </Centered>
        )}
        {(cell.status === "done" || cell.status === "excluded") &&
          cell.image_urls?.[0] && (
            <img
              src={cell.image_urls[0]}
              alt=""
              className="absolute inset-0 h-full w-full object-contain"
            />
          )}
        {/* 多图 chip:Pipeline N>1 时 cell.image_urls 包含 N 张,主图只是第一张,
           显示 "+N" 提示用户点开抽屉看全部 */}
        {(cell.status === "done" || cell.status === "excluded") &&
          (cell.image_urls?.length ?? 0) > 1 && (
            <span
              title={`共 ${cell.image_urls!.length} 张,点击查看全部`}
              className="absolute bottom-1 left-1 z-[1] rounded-sm bg-near-black/70 px-1.5 py-0.5 font-mono text-[10px] font-medium text-ivory"
            >
              +{cell.image_urls!.length - 1}
            </span>
          )}
        {/* 路由 chip:从 image_urls[0] 前缀推真实 provider,跟 cell.image_model 对账。
           历史 mismatch (老 batch-runner 全走 IGW) 在这里会显眼地暴露 */}
        {(cell.status === "done" || cell.status === "excluded") &&
          cell.image_urls?.[0] && (() => {
            const url = cell.image_urls[0];
            const isLovart = url.includes("lovart%3A") || url.includes("lovart:");
            const isIgw = url.includes("igw%3A") || url.includes("igw:");
            const provider = isLovart ? "lovart" : isIgw ? "igw" : null;
            if (!provider) return null;
            const expectedProvider = cell.image_model.includes("/") ? "lovart" : "igw";
            const mismatch = provider !== expectedProvider;
            const label = provider === "lovart" ? "Lovart" : "IGW";
            const tone = mismatch
              ? "bg-error-crimson/90 text-ivory"
              : provider === "lovart"
                ? "bg-coral-soft-bg/95 text-terracotta"
                : "bg-warm-sand/95 text-charcoal-warm";
            return (
              <span
                title={
                  mismatch
                    ? `路由错位!cell.image_model=${cell.image_model || "(空)"},但实际跑了 ${label}`
                    : `生图由 ${label} 出图`
                }
                className={`absolute right-1 top-1 z-[1] rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-medium ${tone}`}
              >
                {mismatch ? "⚠ " : ""}
                {label}
              </span>
            );
          })()}
      </div>

      {/* 底栏:scores 摘要 + 操作 */}
      <div className="flex items-center justify-between border-t border-border-cream bg-ivory/60 px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 text-[11px]">
          {cell.status === "done" && (
            <ScoreSummary
              scoredCount={scoredCount}
              dimsCount={dimsCount}
              avg={avgScore(cell.scores)}
            />
          )}
          {cell.status === "failed" && cell.error && (
            <span className="truncate text-[11px] text-error-crimson">
              {cell.error.slice(0, 36)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(cell.status === "failed" || cell.status === "done") && (
            <span
              role="button"
              tabIndex={0}
              onClick={onRetry}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRetry(e as unknown as React.MouseEvent);
              }}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm text-stone-gray hover:bg-border-cream hover:text-near-black"
              title="重试这一格"
            >
              <RotateCw size={12} />
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center">
      {children}
    </div>
  );
}

function avgScore(scores: Record<string, number>): number {
  const vals = Object.values(scores).filter((v) => v > 0);
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function ScoreSummary({
  scoredCount,
  dimsCount,
  avg,
}: {
  scoredCount: number;
  dimsCount: number;
  avg: number;
}) {
  if (dimsCount === 0) {
    return <span className="text-stone-gray">未配评分维度</span>;
  }
  if (scoredCount === 0) {
    return <span className="text-stone-gray">未评分</span>;
  }
  return (
    <span className="flex items-center gap-1 text-near-black">
      <Star size={11} className="text-warm-gold-fg" />
      <strong className="font-mono">{avg.toFixed(1)}</strong>
      <span className="text-stone-gray">
        ({scoredCount}/{dimsCount})
      </span>
    </span>
  );
}
