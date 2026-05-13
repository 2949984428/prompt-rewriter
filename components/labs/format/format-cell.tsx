// prompt-rewriter/components/labs/format/format-cell.tsx
//
// 单格(一路格式)的展示 + PM 评分 + 备注。
// 流程:
//   1. 自己挂 useImageJobPoller(formatJobAtomFamily(format_id)) 拿轮询状态
//   2. 状态变 completed/failed 时回填 currentFormatRunAtom 对应 entry 的 image_job + history
//   3. PM 点评分圆点 / 输备注 → 调 persistFormatHistory 实时落盘

"use client";

import { useEffect, useRef, useState } from "react";
import { useAtomValue, useStore } from "jotai";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  RotateCw,
  Maximize2,
  ImageDown,
  AlertTriangle,
} from "lucide-react";
import {
  currentFormatRunAtom,
  formatJobAtomFamily,
  formatCellKey,
  formatReferenceImagesAtom,
} from "@/lib/atoms-format";
import {
  imageGeneratorOptionsAtom,
} from "@/lib/atoms-shared";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { copyImageToClipboard } from "@/lib/copy-image";
import {
  historyIndexAtom,
} from "@/lib/atoms-history-index";
import { startImageJob, useImageJobPoller } from "@/lib/image-job";
import { imageModelAtom } from "@/lib/atoms-shared";
import {
  writeHistoryRunDebounced,
  summarizeFormatRecord,
} from "@/lib/history-write";
import type { FormatRun, FormatRunRecord } from "@/lib/schema-format";

export function FormatCell({
  formatId,
  imageModel = "",
  isWinner,
}: {
  formatId: string;
  // 该 cell 绑定的生图模型("" = 单 model 模式/后端默认)。多 model 模式下同 formatId 会有多个 cell。
  imageModel?: string;
  isWinner: boolean;
}) {
  const cellKey = formatCellKey(formatId, imageModel);
  const { state, setState } = useImageJobPoller(formatJobAtomFamily(cellKey));
  const currentRun = useAtomValue(currentFormatRunAtom);
  const referenceImages = useAtomValue(formatReferenceImagesAtom);
  const fallbackModel = useAtomValue(imageModelAtom);
  const generatorOptions = useAtomValue(imageGeneratorOptionsAtom);
  const store = useStore();

  // 把 (format_id, image_model) 双键找 FormatRun 的 helper
  const findRun = (runs: FormatRun[] | undefined) =>
    runs?.find(
      (r) => r.format_id === formatId && (r.image_model ?? "") === imageModel
    );

  // 把 currentFormatRun 的最新形态 patch 后,同时:
  //   1. set 回 atom(UI 立刻反映)
  //   2. 同步全局 historyIndex 的 pm_score_avg / summary 字段
  //   3. debounce PUT /api/history-runs/<id>(写 detail + index 联动)
  const persistRecord = (updated: FormatRunRecord) => {
    store.set(currentFormatRunAtom, updated);
    const { summary, pm_score_avg, pm_score_count } =
      summarizeFormatRecord(updated);

    // 同步 historyIndex 那条(乐观,失败由 PUT 兜底)
    const index = store.get(historyIndexAtom);
    const idx = index.findIndex((x) => x.id === updated.id);
    if (idx >= 0) {
      const next = [...index];
      next[idx] = { ...next[idx], summary, pm_score_avg, pm_score_count };
      store.set(historyIndexAtom, next);
    }

    writeHistoryRunDebounced({
      id: updated.id,
      lab_id: "format",
      detail: updated,
      index_patch: { summary, pm_score_avg, pm_score_count },
    });
  };

  // 重试:重新调 startImageJob,用本路当前 final_prompt + 当前 cell 的 model
  const onRetry = () => {
    const r = findRun(currentRun?.format_runs);
    const fp = r?.final_prompt;
    if (!fp?.prompt) return;
    void startImageJob(setState, {
      prompt: fp.prompt,
      size: fp.size,
      quality: fp.quality,
      n: fp.n,
      output_format: fp.output_format,
      reference_images: referenceImages,
      // cell 绑定 model > 全局 fallback > 后端默认
      model: imageModel || fallbackModel || undefined,
    });
  };
  const canRetry =
    !!findRun(currentRun?.format_runs)?.final_prompt?.prompt &&
    state.status !== "creating" &&
    state.status !== "polling";

  // 找到本格对应的 FormatRun(双键定位)
  const run = findRun(currentRun?.format_runs);
  const modelDisplay =
    generatorOptions.find((o) => o.name === imageModel)?.display_name ??
    imageModel;

  // ─── 完成时回填 image_job 到 currentFormatRun + 写新历史接口 ───
  const lastFinishedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!state.finishedAt) return;
    if (state.finishedAt === lastFinishedRef.current) return;
    lastFinishedRef.current = state.finishedAt;

    const cur = store.get(currentFormatRunAtom);
    if (!cur) return;
    const isLocal = (state.urls ?? []).every((u) => u.startsWith("/api/image-file/"));
    const updatedRuns = cur.format_runs.map((r) =>
      r.format_id === formatId && (r.image_model ?? "") === imageModel
        ? {
            ...r,
            image_job: {
              task_id: state.taskId,
              urls: state.urls ?? [],
              local_paths: isLocal ? state.urls ?? [] : [],
              cost: state.cost,
              latency_ms:
                state.startedAt != null && state.finishedAt != null
                  ? state.finishedAt - state.startedAt
                  : null,
              error: state.error,
            },
          }
        : r
    );
    persistRecord({ ...cur, format_runs: updatedRuns });
  }, [state.finishedAt, state, formatId, imageModel, store]);

  if (!run) {
    return (
      <div className="rounded-md border border-border-cream bg-ivory p-4">
        <p className="text-[13px] text-stone-gray">未找到本路结果</p>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col rounded-md border bg-ivory ${
        isWinner ? "border-terracotta shadow-ring-cta" : "border-border-cream"
      }`}
    >
      <CellHeader
        run={run}
        isWinner={isWinner}
        onRetry={onRetry}
        canRetry={canRetry}
        imageUrl={state.urls[0]}
        modelLabel={modelDisplay}
      />
      <CellImage state={state} sizeStr={run.final_prompt.size} />
      <CellPrompt run={run} />
      <CellRating
        formatId={formatId}
        imageModel={imageModel}
        run={run}
        persistRecord={persistRecord}
      />
    </div>
  );
}

// ─── 列头 ────────────────────────────────────────────────
// imageUrl 非空时显示"复制图"按钮(把产物像素写入系统剪贴板,可直接粘贴到
// Finder / 微信 / Slack 等)。状态机:idle → copying → copied / error → idle。
function CellHeader({
  run,
  isWinner,
  onRetry,
  canRetry,
  imageUrl,
  modelLabel,
}: {
  run: FormatRun;
  isWinner: boolean;
  onRetry: () => void;
  canRetry: boolean;
  imageUrl: string | undefined;
  modelLabel?: string;
}) {
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "error"
  >("idle");
  const [copyError, setCopyError] = useState<string | null>(null);

  const onCopyImage = async () => {
    if (!imageUrl || copyState === "copying") return;
    setCopyState("copying");
    setCopyError(null);
    try {
      await copyImageToClipboard(imageUrl);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1600);
    } catch (e) {
      setCopyState("error");
      setCopyError(e instanceof Error ? e.message : String(e));
      setTimeout(() => setCopyState("idle"), 2400);
    }
  };

  return (
    <div className="border-b border-border-cream px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[13px] font-medium text-near-black">
          {run.format_label}
        </span>
        {modelLabel && (
          <span
            title={`生图模型:${modelLabel}`}
            className="rounded-sm bg-warm-sand/70 px-1.5 py-0.5 font-mono text-[10px] text-charcoal-warm"
          >
            {modelLabel}
          </span>
        )}
        {isWinner && (
          <span className="rounded-full bg-coral-soft-bg px-2 py-0.5 font-mono text-[10px] font-medium text-terracotta">
            🏆 胜出
          </span>
        )}
        {run.image_job.error && (
          <span className="text-[11px] text-error-crimson">⚠ 错</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {imageUrl && (
            <button
              onClick={onCopyImage}
              disabled={copyState === "copying"}
              title={copyError ?? "复制图片到剪贴板"}
              className={`flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10px] shadow-ring transition hover:shadow-ring-prom disabled:cursor-wait ${
                copyState === "copied"
                  ? "bg-warm-gold-bg text-warm-gold-fg"
                  : copyState === "error"
                    ? "bg-coral-soft-bg text-error-crimson"
                    : "bg-warm-sand text-charcoal-warm"
              }`}
            >
              {copyState === "copied" ? (
                <>
                  <Check size={10} /> 已复制
                </>
              ) : copyState === "error" ? (
                <>
                  <AlertTriangle size={10} /> 失败
                </>
              ) : copyState === "copying" ? (
                <>
                  <ImageDown size={10} /> 复制中…
                </>
              ) : (
                <>
                  <ImageDown size={10} /> 复制图
                </>
              )}
            </button>
          )}
          {canRetry && (
            <button
              onClick={onRetry}
              title="重新生成本路图"
              className="flex items-center gap-1 rounded-sm bg-warm-sand px-1.5 py-0.5 font-mono text-[10px] text-charcoal-warm shadow-ring hover:shadow-ring-prom"
            >
              <RotateCw size={10} /> 重试
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// 把 final_prompt.size("1024x1024" / "1792x1008" / "auto" / 旧值)解析成数值
// 比例。"auto" 或拿不到时 fallback 到 1:1。容器据此设 aspectRatio,图用
// object-contain 完整呈现,不裁切。
function parseAspectRatio(sizeStr: string | undefined): number {
  if (!sizeStr) return 1;
  const m = sizeStr.match(/^(\d+)x(\d+)$/);
  if (!m) return 1;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return 1;
  return w / h;
}

// ─── 图区 ────────────────────────────────────────────────
// 关键设计:
// - 容器 aspectRatio 由 final_prompt.size 推导(横图卡片自然矮、竖图自然高),
//   不再硬卡 aspect-square。
// - 图 object-contain 完整展示,不裁切;若与容器比例略有偏差(例如 "auto"),
//   两侧用 parchment 底色留白,而不是裁掉内容。
// - 点图 → 弹 lightbox 大图预览(不跳转新标签;原图入口移到 lightbox 内)
function CellImage({
  state,
  sizeStr,
}: {
  state: ReturnType<typeof useImageJobPoller>["state"];
  sizeStr: string | undefined;
}) {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const url = state.urls[0];
  const aspect = parseAspectRatio(sizeStr);

  return (
    <div
      className="relative w-full overflow-hidden border-b border-border-cream bg-parchment"
      style={{ aspectRatio: aspect }}
    >
      {url ? (
        <button
          type="button"
          onClick={() => setPreviewSrc(url)}
          title="点击查看大图"
          className="group absolute inset-0 flex h-full w-full cursor-zoom-in items-center justify-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            className="block h-full w-full object-contain transition group-hover:opacity-95"
            loading="lazy"
          />
          {/* 右上 hover 提示 */}
          <span className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-sm bg-near-black/65 px-1.5 py-0.5 font-mono text-[10px] text-ivory opacity-0 transition group-hover:opacity-100">
            <Maximize2 size={10} /> 预览
          </span>
        </button>
      ) : state.status === "failed" ? (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <p className="font-mono text-[11px] text-error-crimson">
            {state.error?.slice(0, 80) ?? "失败"}
          </p>
        </div>
      ) : (
        <div className="absolute inset-0 flex animate-pulse items-center justify-center bg-warm-sand/40">
          <p className="font-mono text-[11px] text-stone-gray">
            {state.status === "creating"
              ? "提交中…"
              : state.status === "polling"
              ? "出图中…"
              : "等待启动"}
          </p>
        </div>
      )}
      <ImageLightbox src={previewSrc} onClose={() => setPreviewSrc(null)} />
    </div>
  );
}

// ─── prompt 折叠 ─────────────────────────────────────────
function CellPrompt({ run }: { run: FormatRun }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const prompt = run.final_prompt.prompt ?? "";
  const preview = prompt.slice(0, 60).replace(/\s+/g, " ");
  const params = run.final_prompt;

  const copy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="border-b border-border-cream">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left transition hover:bg-parchment/50"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-mono text-[10px] uppercase tracking-wider text-stone-gray">
          prompt
        </span>
        {!open && (
          <span className="ml-1 truncate font-sans text-[12px] text-olive-gray">
            {preview}
            {prompt.length > 60 ? "…" : ""}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-stone-gray">
          {params.size ?? "auto"} · {params.quality ?? "auto"}
        </span>
      </button>
      {open && (
        <div className="border-t border-border-cream bg-parchment/40 px-4 py-3">
          <p className="whitespace-pre-wrap font-sans text-[12.5px] leading-[1.55] text-near-black">
            {prompt || "(空 prompt)"}
          </p>
          <button
            onClick={copy}
            className="mt-2 flex items-center gap-1 rounded-sm bg-warm-sand px-2 py-1 font-mono text-[11px] text-charcoal-warm shadow-ring transition hover:shadow-ring-prom"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 评分 + 备注 ─────────────────────────────────────────
function CellRating({
  formatId,
  imageModel,
  run,
  persistRecord,
}: {
  formatId: string;
  imageModel: string;
  run: FormatRun;
  persistRecord: (r: FormatRunRecord) => void;
}) {
  const currentRun = useAtomValue(currentFormatRunAtom);
  const match = (r: FormatRun) =>
    r.format_id === formatId && (r.image_model ?? "") === imageModel;

  const setScore = (score: number | null) => {
    if (!currentRun) return;
    const updatedRuns = currentRun.format_runs.map((r) =>
      match(r)
        ? { ...r, pm_score: score, rated_at: score != null ? Date.now() : null }
        : r
    );
    // 算 winner(全维度评比,不限同 model;winner 仍是 format_id 维度)
    const scored = updatedRuns.filter((r) => typeof r.pm_score === "number");
    const winner =
      scored.length > 0
        ? scored.reduce((a, b) => ((a.pm_score ?? 0) >= (b.pm_score ?? 0) ? a : b))
            .format_id
        : null;
    persistRecord({ ...currentRun, format_runs: updatedRuns, winner_format_id: winner });
  };

  const setNotes = (notes: string) => {
    if (!currentRun) return;
    const updatedRuns = currentRun.format_runs.map((r) =>
      match(r) ? { ...r, pm_notes: notes } : r
    );
    persistRecord({ ...currentRun, format_runs: updatedRuns });
  };

  return (
    <div className="space-y-2 px-4 py-3">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-stone-gray">
            评分 1-10
          </span>
          {run.pm_score != null && (
            <button
              onClick={() => setScore(null)}
              className="text-[10px] text-stone-gray hover:text-error-crimson"
            >
              清除
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
            const filled = run.pm_score != null && n <= run.pm_score;
            return (
              <button
                key={n}
                onClick={() => setScore(n)}
                title={`${n} 分`}
                className={`h-3.5 w-3.5 rounded-full border transition ${
                  filled
                    ? "border-terracotta bg-terracotta"
                    : "border-stone-gray bg-transparent hover:border-coral"
                }`}
              />
            );
          })}
          <span className="ml-2 font-mono text-[12px] text-near-black">
            {run.pm_score ?? "—"}
          </span>
        </div>
      </div>
      <input
        value={run.pm_notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="一句备注…"
        className="w-full rounded-sm border border-border-cream bg-parchment/60 px-2 py-1 font-sans text-[12px] text-near-black placeholder:text-stone-gray focus:outline-none focus:border-coral"
      />
    </div>
  );
}
