// prompt-rewriter/components/output/image-card.tsx
//
// ⑦ A/B 并排对照:同一次点击,两路并行跑
//   - 对照组 :用户原始 query 直接丢 gpt-image-2(模拟"不做任何改写")
//   - 实验组 :7 步流程产出的 final_prompt(带 size / quality / n / output_format)
// 两路共享同一个 JobColumn 组件,用各自的 atom + useImageJob 驱动。

"use client";

import { useEffect, useRef, useState } from "react";
import { useAtomValue, useStore } from "jotai";
import type { PrimitiveAtom } from "jotai";
import {
  Download,
  Loader2,
  RefreshCw,
  ImageIcon,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  baselineJobAtom,
  optimizedJobAtom,
  queryAtom,
  rewriteResultAtom,
  currentHistoryIdAtom,
  currentRewriteDetailAtom,
  type ImageJobState,
} from "@/lib/atoms";
import { type StartImageJobInput } from "@/lib/image-job";
import { useImageRetry } from "@/lib/use-image-retry";
import type { ImageJobRecord } from "@/lib/schema";
import { writeHistoryRunDebounced } from "@/lib/history-write";
import { CardShell } from "./card-shell";

export function ImageCard() {
  return (
    <CardShell
      title="⑦ A/B 对照:原始 query vs 改写后"
      subtitle="同一次点击,两路并行打 gpt-image-2 —— 直接对比改写带来的提升(和成本)"
      index={6}
      accent="blue"
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <JobColumn
          variant="baseline"
          label="对照组 · 原始 query 直出"
          tagline="用户原句一字未改,直接打 gpt-image-2"
          atom={baselineJobAtom}
        />
        <JobColumn
          variant="optimized"
          label="实验组 · 7 步改写后"
          tagline="前 6 步结论合成的 prompt + 目标模型参数"
          atom={optimizedJobAtom}
        />
      </div>
    </CardShell>
  );
}

// ─────────────────────────────────────────────────────────────
// 单列:一路生图任务的状态 + 图片展示 + 重试
// ─────────────────────────────────────────────────────────────

function JobColumn({
  variant,
  label,
  tagline,
  atom,
}: {
  variant: "baseline" | "optimized";
  label: string;
  tagline: string;
  atom: PrimitiveAtom<ImageJobState>;
}) {
  const query = useAtomValue(queryAtom);
  const rewrite = useAtomValue(rewriteResultAtom);

  // 重试要回溯"本路应该打什么":baseline 用当前 query,optimized 用当前 final_prompt
  const buildRetryInput = (): StartImageJobInput | null => {
    if (variant === "baseline") {
      const q = query.trim();
      if (!q) return null;
      return { prompt: q };
    }
    const fp = rewrite?.final_prompt;
    if (!fp?.prompt?.trim()) return null;
    return {
      prompt: fp.prompt,
      size: fp.size,
      quality: fp.quality,
      n: fp.n,
      output_format: fp.output_format,
    };
  };

  // 订阅 atom + 挂轮询 + retry(整棵树只在这里挂一份,避免重复轮询)
  const { state, setState, canRetry, onRetry: handleRetry } = useImageRetry(
    atom,
    buildRetryInput
  );

  // 完成/失败时把这一路的结果回填到当前 history 那条的 image_jobs.<variant>。 (rewrite lab)
  // 用 jotai store API(不订阅)读 history + currentHistoryId,避免 JobColumn 跟 history
  // 重 render 形成循环。finishedAt 从 null 变非 null = 这一路刚结束 → 触发一次 writeback。
  const store = useStore();
  const lastFinishedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!state.finishedAt) return;
    if (state.finishedAt === lastFinishedRef.current) return;
    lastFinishedRef.current = state.finishedAt;

    const id = store.get(currentHistoryIdAtom);
    if (!id) return;
    const detail = store.get(currentRewriteDetailAtom);
    if (!detail) return;

    // image-job poller 在 completed 时已把 state.urls 替换为本地落盘路径(若有)。
    const isLocal = (state.urls ?? []).every((u) => u.startsWith("/api/image-file/"));
    const record: ImageJobRecord = {
      variant,
      status: state.status,
      prompt: state.prompt ?? "",
      params: state.params ?? {},
      task_id: state.taskId,
      urls: state.urls ?? [],
      local_paths: isLocal ? state.urls ?? [] : [],
      cost: state.cost,
      started_at: state.startedAt,
      finished_at: state.finishedAt,
      latency_ms:
        state.startedAt != null
          ? state.finishedAt - state.startedAt
          : null,
      error: state.error,
    };
    const updated = {
      ...detail,
      image_jobs: { ...(detail.image_jobs ?? {}), [variant]: record },
    };
    store.set(currentRewriteDetailAtom, updated);

    // 写新历史接口(debounce 防 baseline + optimized 同时完成时双写互踩)
    writeHistoryRunDebounced({
      id,
      lab_id: "rewrite",
      detail: updated,
      index_patch: {}, // image_jobs 不影响 index 字段
    });
  }, [state.finishedAt, state, variant, store]);

  // 实时计时 —— 只在进行中时每秒 tick
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.status !== "creating" && state.status !== "polling") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  const elapsed = state.startedAt
    ? Math.round(
        ((state.finishedAt ?? now) - state.startedAt) / 1000
      )
    : 0;

  const accentClass =
    variant === "baseline" ? "border-stone-gray/40" : "border-terracotta/60";
  const badgeClass =
    variant === "baseline"
      ? "bg-warm-sand text-charcoal-warm"
      : "bg-coral-soft-bg text-terracotta";

  return (
    <div
      className={`flex min-h-[420px] flex-col rounded-md border ${accentClass} bg-ivory/60`}
    >
      {/* 列头:A/B 标签 + 简介 */}
      <div className="border-b border-border-cream px-4 py-3">
        <div className="mb-1 flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-medium tracking-[0.08em] ${badgeClass}`}
          >
            {variant === "baseline" ? "A · 对照" : "B · 实验"}
          </span>
          <span className="font-sans text-[14px] font-medium text-near-black">
            {label}
          </span>
        </div>
        <p className="font-sans text-[12.5px] leading-[1.5] text-stone-gray">
          {tagline}
        </p>
      </div>

      {/* 状态条 */}
      <div className="flex items-center justify-between border-b border-border-cream px-4 py-2.5">
        <StatusLine state={state} elapsed={elapsed} />
        {canRetry &&
          (state.status === "idle" ||
            state.status === "completed" ||
            state.status === "failed") && (
            <button
              onClick={handleRetry}
              className="flex h-7 items-center gap-1 rounded-sm bg-warm-sand px-2 text-[12px] font-medium text-charcoal-warm shadow-ring hover:shadow-ring-prom"
            >
              <RefreshCw size={12} />
              {state.status === "completed"
                ? "再生一张"
                : state.status === "failed"
                ? "重试"
                : "生成"}
            </button>
          )}
      </div>

      {/* 本路真实发出去的 payload:展开可看 prompt 原文 */}
      {state.prompt && <PayloadPanel state={state} />}

      {/* 错误详情 */}
      {state.status === "failed" && state.error && (
        <div className="mx-4 mt-3 rounded-md bg-coral-deep-bg p-3 font-mono text-[12px] leading-[1.5] text-error-crimson">
          {state.error}
        </div>
      )}

      {/* 图片结果 / 骨架 */}
      <div className="flex-1 p-4">
        {state.urls.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {state.urls.map((u, i) => (
              <figure
                key={i}
                className="group relative overflow-hidden rounded-md border border-border-cream bg-ivory"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={u}
                  alt={`${variant} output ${i + 1}`}
                  className="block h-auto w-full"
                  loading="lazy"
                />
                <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-near-black/70 px-3 py-2 text-[12px] text-ivory opacity-0 transition group-hover:opacity-100">
                  <span className="font-mono">#{i + 1}</span>
                  <a
                    href={u}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 hover:underline"
                    download
                  >
                    <Download size={12} />
                    打开原图
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : state.status === "failed" ? null : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="aspect-square animate-pulse rounded-md bg-warm-sand/60" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 子组件:状态行、payload 展开、参数 chip
// ─────────────────────────────────────────────────────────────

function StatusLine({
  state,
  elapsed,
}: {
  state: ImageJobState;
  elapsed: number;
}) {
  const { status, taskId, cost } = state;
  return (
    <div className="flex items-center gap-2 text-[13px] text-near-black">
      {status === "idle" && (
        <>
          <ImageIcon size={14} className="text-stone-gray" />
          <span className="text-stone-gray">等待启动…</span>
        </>
      )}
      {status === "creating" && (
        <>
          <Loader2 size={14} className="animate-spin text-coral" />
          <span>提交到 gpt-image-2…</span>
        </>
      )}
      {status === "polling" && (
        <>
          <Loader2 size={14} className="animate-spin text-coral" />
          <span>
            出图中 · 已等 <span className="font-mono">{elapsed}s</span>
            {taskId && (
              <span className="ml-1.5 font-mono text-[11px] text-stone-gray">
                {taskId.slice(0, 6)}…
              </span>
            )}
          </span>
        </>
      )}
      {status === "completed" && (
        <>
          <span className="text-coral">✅</span>
          <span>
            成功 · <span className="font-mono">{elapsed}s</span>
            {cost != null && (
              <span className="ml-1.5 font-mono text-[11px] text-stone-gray">
                ${cost.toFixed(3)}
              </span>
            )}
          </span>
        </>
      )}
      {status === "failed" && (
        <>
          <span className="text-error-crimson">❌</span>
          <span className="text-error-crimson">失败,见下方原因</span>
        </>
      )}
    </div>
  );
}

function PayloadPanel({ state }: { state: ImageJobState }) {
  const [open, setOpen] = useState(false);
  const p = state.params ?? {};
  return (
    <div className="mx-4 mt-3 rounded-md border border-border-cream bg-parchment">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-stone-gray">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          本次发给 gpt-image-2 的请求
        </span>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[11px]">
          <ParamChip label="size" value={p.size ?? "auto"} />
          <ParamChip label="quality" value={p.quality ?? "auto"} />
          <ParamChip label="n" value={String(p.n ?? 1)} />
          <ParamChip label="fmt" value={p.output_format ?? "png"} />
        </div>
      </button>
      {open && (
        <div className="border-t border-border-cream bg-ivory px-3 py-3">
          <p className="mb-1 font-mono text-[10.5px] uppercase tracking-wider text-stone-gray">
            prompt
          </p>
          <p className="whitespace-pre-wrap font-sans text-[12.5px] leading-[1.55] text-near-black">
            {state.prompt}
          </p>
        </div>
      )}
    </div>
  );
}

function ParamChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-stone-gray">{label}:</span>
      <span className="rounded bg-ivory px-1.5 py-0.5 text-near-black">
        {value}
      </span>
    </span>
  );
}
