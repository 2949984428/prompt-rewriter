// prompt-rewriter/components/labs/batch/score-drawer.tsx
//
// 抽屉:大图 + final_prompt + 多维评分滑杆 + 备注。
// PATCH 是 debounce 写,实时反馈在本地 atom,1s 延迟落盘。

"use client";

import { useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { X, ExternalLink, EyeOff, Eye, ImageDown, Check } from "lucide-react";
import {
  batchActiveCellAtom,
  currentBatchRunAtom,
} from "@/lib/atoms-batch";
import { copyImageToClipboard } from "@/lib/copy-image";
import { ImageLightbox } from "@/components/ui/image-lightbox";

const PATCH_DEBOUNCE_MS = 600;

export function BatchScoreDrawer() {
  const [active, setActive] = useAtom(batchActiveCellAtom);
  const [record, setRecord] = useAtom(currentBatchRunAtom);

  // 本地草稿:用户改 score / note 立刻视觉反馈;防抖后 PATCH 持久化
  const [draftScores, setDraftScores] = useState<Record<string, number>>({});
  const [draftNote, setDraftNote] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle"
  );
  // lightbox 受控:大图 / 参考图点击后弹全屏预览,null = 关
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const cell = useMemo(() => {
    if (!record || !active) return null;
    const targetModel = active.image_model ?? "";
    // Phase 2:pipeline 模式按 pipeline_id 匹配(active.pipeline_id 非空时)
    const targetPipeline = active.pipeline_id ?? "";
    return record.cells.find((c) => {
      if (c.query_idx !== active.query_idx) return false;
      if ((c.image_model ?? "") !== targetModel) return false;
      if (targetPipeline) return (c.pipeline_id ?? "") === targetPipeline;
      return c.skill_id === active.skill_id;
    });
  }, [record, active]);

  // 切换 cell 时同步草稿(也带 image_model 维度,避免同 (q,s) 跨 model 切换不重置)
  useEffect(() => {
    if (!cell) return;
    setDraftScores(cell.scores);
    setDraftNote(cell.note);
    setCopyState("idle");
  }, [active?.query_idx, active?.skill_id, active?.image_model]); // eslint-disable-line react-hooks/exhaustive-deps

  // 防抖 PATCH
  const patchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePatch = (
    runId: string,
    qi: number,
    sid: string,
    mid: string,
    patch: { scores?: Record<string, number>; note?: string }
  ) => {
    if (patchTimer.current) clearTimeout(patchTimer.current);
    patchTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/labs/batch/runs/${runId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cell_patches: [{ query_idx: qi, skill_id: sid, image_model: mid, ...patch }],
          }),
        });
        if (!r.ok) return;
        // 用服务端返回的 fresh 同步 record(避免乐观更新与服务端漂移)
        const fresh = await r.json();
        setRecord(fresh);
      } catch {
        /* ignore */
      }
    }, PATCH_DEBOUNCE_MS);
  };

  // 排除 / 恢复:即时 PATCH(不防抖,这是显式动作)
  const toggleExclude = async () => {
    if (!record || !cell) return;
    const next = cell.status === "excluded" ? "done" : "excluded";
    try {
      const r = await fetch(`/api/labs/batch/runs/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cell_patches: [
            {
              query_idx: cell.query_idx,
              skill_id: cell.skill_id,
              image_model: cell.image_model ?? "",
              status: next,
            },
          ],
        }),
      });
      if (r.ok) {
        const fresh = await r.json();
        setRecord(fresh);
      }
    } catch {
      /* ignore */
    }
  };

  if (!active || !record || !cell) return null;

  // 该 query 的参考图(从题目集 image block 提取的 URL,方案 C per_query_reference_images)
  const refImages = record.per_query_reference_images?.[cell.query_idx] ?? [];

  // 显示 query 时剥掉 [@image:#N:hash] 占位符 —— 参考图已独立渲染,占位符只是噪音
  const queryDisplay = record.queries[cell.query_idx]
    .replace(/\[@image:#\d+:[a-zA-Z0-9_-]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const onScoreChange = (dimId: string, v: number) => {
    const next = { ...draftScores, [dimId]: v };
    setDraftScores(next);
    schedulePatch(record.id, cell.query_idx, cell.skill_id, cell.image_model ?? "", { scores: next });
  };
  const onNoteChange = (v: string) => {
    setDraftNote(v);
    schedulePatch(record.id, cell.query_idx, cell.skill_id, cell.image_model ?? "", { note: v });
  };

  const close = () => setActive(null);
  const url = cell.image_urls?.[0];

  const onCopyImage = async () => {
    if (!url) return;
    try {
      await copyImageToClipboard(url);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 2000);
    }
  };

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 z-40 bg-near-black/30 backdrop-blur-[1px]"
        onClick={close}
      />
      {/* 抽屉:右侧滑入,固定宽 720px */}
      <aside className="fixed inset-y-0 right-0 z-50 flex w-[720px] flex-col bg-ivory shadow-2xl">
        {/* header */}
        <header className="flex items-start justify-between gap-3 border-b border-border-cream bg-parchment/50 px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[12px] text-stone-gray">
              Q{cell.query_idx + 1} · {cell.pipeline_id || cell.skill_id}
            </div>
            <div className="mt-0.5 max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words text-[14px] font-medium leading-[1.5] text-near-black">
              {queryDisplay}
            </div>
          </div>
          <button
            onClick={close}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-stone-gray hover:bg-border-cream hover:text-near-black"
          >
            <X size={16} />
          </button>
        </header>

        {/* body:可滚动 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* 题目参考图(若题目集 query 含 [@image:#N:xxx] 则显示) */}
          {refImages.length > 0 && (
            <section className="mb-4 rounded-md border border-border-cream bg-parchment/30 p-3">
              <div className="mb-2 font-mono text-[10.5px] uppercase tracking-wider text-stone-gray">
                题目参考图 ({refImages.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {refImages.map((u, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setLightboxSrc(u)}
                    className="block cursor-zoom-in"
                    title="点击放大预览"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={u}
                      alt=""
                      className="h-20 w-20 rounded border border-border-cream object-cover transition hover:border-terracotta"
                    />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* 大图 */}
          {url ? (
            <div className="overflow-hidden rounded-md border border-border-cream bg-parchment/30">
              <img
                src={url}
                alt=""
                onClick={() => setLightboxSrc(url)}
                title="点击放大预览"
                className="block max-h-[420px] w-full cursor-zoom-in object-contain"
              />
              <div className="flex items-center justify-end gap-2 border-t border-border-cream bg-ivory/60 px-3 py-2">
                <button
                  onClick={onCopyImage}
                  className={`flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12px] transition ${
                    copyState === "copied"
                      ? "bg-warm-gold-bg text-warm-gold-fg"
                      : copyState === "error"
                      ? "bg-coral-soft-bg text-error-crimson"
                      : "text-stone-gray hover:bg-border-cream hover:text-near-black"
                  }`}
                  title="复制图片到剪贴板"
                >
                  {copyState === "copied" ? (
                    <Check size={12} />
                  ) : (
                    <ImageDown size={12} />
                  )}
                  {copyState === "copied"
                    ? "已复制"
                    : copyState === "error"
                    ? "复制失败"
                    : "复制图片"}
                </button>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12px] text-stone-gray hover:bg-border-cream hover:text-near-black"
                >
                  <ExternalLink size={12} />
                  原图新窗
                </a>
              </div>
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-border-warm text-[12.5px] text-stone-gray">
              {cell.status === "failed"
                ? `失败:${cell.error ?? ""}`
                : "暂无图片"}
            </div>
          )}

          {/* final_prompt */}
          {cell.final_prompt && (
            <details className="mt-4 rounded-md border border-border-cream bg-parchment/30" open>
              <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-near-black">
                final_prompt(模型实际收到的)
              </summary>
              <div className="space-y-2 px-3 pb-3">
                <pre className="max-h-[200px] overflow-y-auto whitespace-pre-wrap rounded-sm bg-ivory p-2 text-[12px] leading-[1.5] text-near-black">
                  {cell.final_prompt.prompt}
                </pre>
                <div className="font-mono text-[11px] text-stone-gray">
                  size={cell.final_prompt.size} · quality=
                  {cell.final_prompt.quality} · n={cell.final_prompt.n} ·{" "}
                  {cell.final_prompt.output_format}
                </div>
              </div>
            </details>
          )}

          {/* 评分 */}
          <section className="mt-5">
            <h3 className="mb-2 text-[13px] font-medium text-near-black">
              评分(0-5,拖滑杆)
            </h3>
            {record.scoring_dimensions.length === 0 ? (
              <p className="text-[12.5px] text-stone-gray">
                这个 record 创建时没有定义评分维度。
              </p>
            ) : (
              <div className="space-y-3">
                {record.scoring_dimensions.map((d) => {
                  const v = draftScores[d.id] ?? 0;
                  return (
                    <div key={d.id}>
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-near-black">
                            {d.label}
                          </div>
                          {d.description && (
                            <div className="text-[11.5px] text-stone-gray">
                              {d.description}
                            </div>
                          )}
                        </div>
                        <span className="ml-3 font-mono text-[13px] tabular-nums text-near-black">
                          {v.toFixed(1)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={5}
                        step={0.5}
                        value={v}
                        onChange={(e) =>
                          onScoreChange(d.id, Number(e.target.value))
                        }
                        className="mt-1 w-full accent-terracotta"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 备注 */}
          <section className="mt-5">
            <h3 className="mb-2 text-[13px] font-medium text-near-black">
              备注
            </h3>
            <textarea
              value={draftNote}
              onChange={(e) => onNoteChange(e.target.value)}
              rows={3}
              placeholder="比如:文字渲染脏 / 主体被截 / 比例错…"
              className="w-full rounded-md border border-border-warm bg-parchment/30 p-2 text-[13px] focus:border-terracotta focus:bg-ivory focus:outline-none"
            />
          </section>
        </div>

        {/* footer:操作区 */}
        <footer className="flex items-center justify-between border-t border-border-cream bg-parchment/50 px-5 py-3">
          <button
            onClick={toggleExclude}
            className={`flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12.5px] transition ${
              cell.status === "excluded"
                ? "border-stone-gray bg-ivory text-stone-gray hover:text-near-black"
                : "border-border-warm bg-ivory text-olive-gray hover:border-stone-gray hover:text-near-black"
            }`}
          >
            {cell.status === "excluded" ? (
              <>
                <Eye size={13} />
                恢复(纳入排行榜)
              </>
            ) : (
              <>
                <EyeOff size={13} />
                从排行榜排除
              </>
            )}
          </button>
          <span className="text-[11.5px] text-stone-gray">
            评分自动保存
          </span>
        </footer>
      </aside>
      {/* Lightbox:大图 / 参考图点击后弹全屏预览(z 比抽屉高) */}
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </>
  );
}
