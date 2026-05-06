// prompt-rewriter/components/labs/fusion/diff-renderer.tsx
//
// 单栏渲染融合后 prompt + change / conflict 标记。
// 实现思路:
//   1. 收集所有 markers(changes + conflicts),按 region_start 排序
//   2. 把 merged_prompt 按 marker region 切片渲染
//   3. 切片之间是普通文本(font-mono, whitespace-pre-wrap),切片内是带边框的 span
//   4. conflict 优先级最高(红框 override)
//   5. 点击 marker → 展开详情 panel(reason / original_text / 回退按钮)
//
// 注意:LLM 给的 region offsets 可能越界,做 clamp 兜底。

"use client";

import { useState, useMemo } from "react";
import type { FusionMergeResult, FusionConflict, FusionChangeMarker } from "@/lib/schema";
import { ConflictCard } from "./conflict-card";

type Marker =
  | { kind: "change"; data: FusionChangeMarker }
  | { kind: "conflict"; data: FusionConflict };

const STRATEGY_LABEL: Record<string, string> = {
  append: "追加",
  insert_nearby: "就近插入",
  replace_section: "替换",
  wrap_reference: "包裹引用",
  rewrite_embed: "改写嵌入",
  few_shot: "few-shot",
};

const TYPE_VISUAL: Record<FusionChangeMarker["type"], { border: string; bg: string; symbol: string }> = {
  addition: { border: "border-blue-400/70", bg: "bg-blue-50/40", symbol: "+" },
  modification: { border: "border-warm-gold-fg/70", bg: "bg-warm-gold-bg/30", symbol: "~" },
  replacement: { border: "border-purple-500/70", bg: "bg-purple-50/40", symbol: "⇄" },
};

const CONFLICT_VISUAL = {
  border: "border-error-crimson",
  bg: "bg-coral-soft-bg/40",
  symbol: "⚠",
};

export function DiffRenderer({
  result,
  onRollback,
}: {
  result: FusionMergeResult;
  onRollback: (conflictId: string, originalText: string) => void;
}) {
  // 把所有 markers 合并 + 按 region 排序;conflict 优先(同 region 时盖住 change)
  const markers = useMemo<Marker[]>(() => {
    const conflictRegions = new Set(
      result.conflicts.map((c) => `${c.region_start}-${c.region_end}`)
    );
    const merged: Marker[] = [];
    for (const c of result.conflicts) {
      merged.push({ kind: "conflict", data: c });
    }
    for (const ch of result.changes) {
      const key = `${ch.region_start}-${ch.region_end}`;
      // 如果同 region 已有 conflict,跳过 change(避免重复渲染)
      if (conflictRegions.has(key)) continue;
      merged.push({ kind: "change", data: ch });
    }
    merged.sort(
      (a, b) => a.data.region_start - b.data.region_start
    );
    return merged;
  }, [result]);

  const segments = useMemo(() => {
    return splitByMarkers(result.merged_prompt, markers);
  }, [result.merged_prompt, markers]);

  const [openMarkerId, setOpenMarkerId] = useState<string | null>(null);

  return (
    <div className="rounded-md border border-border-cream bg-ivory p-4">
      <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-near-black">
        {segments.map((seg, i) => {
          if (seg.kind === "plain") {
            return <span key={i}>{seg.text}</span>;
          }
          const isOpen = openMarkerId === seg.marker.data.id;
          if (seg.marker.kind === "conflict") {
            const c = seg.marker.data;
            return (
              <span key={i} className="inline-block align-baseline">
                <button
                  type="button"
                  onClick={() => setOpenMarkerId(isOpen ? null : c.id)}
                  className={`whitespace-pre-wrap rounded-sm border px-1 ${CONFLICT_VISUAL.border} ${CONFLICT_VISUAL.bg} cursor-pointer hover:bg-coral-soft-bg/60`}
                  title={`冲突 #${c.id} - 点击展开`}
                >
                  <span className="mr-1 text-[10px] font-bold text-error-crimson">{CONFLICT_VISUAL.symbol}</span>
                  {seg.text}
                </button>
                {isOpen && (
                  <ConflictCard
                    conflict={c}
                    onRollback={() => {
                      onRollback(c.id, c.original_text);
                      setOpenMarkerId(null);
                    }}
                  />
                )}
              </span>
            );
          } else {
            const ch = seg.marker.data;
            const v = TYPE_VISUAL[ch.type];
            return (
              <span key={i} className="inline-block align-baseline">
                <button
                  type="button"
                  onClick={() => setOpenMarkerId(isOpen ? null : ch.id)}
                  className={`whitespace-pre-wrap rounded-sm border px-1 ${v.border} ${v.bg} cursor-pointer hover:opacity-80`}
                  title={`${STRATEGY_LABEL[ch.strategy] ?? ch.strategy} - 点击展开`}
                >
                  <span className="mr-1 text-[10px] font-bold text-olive-gray">{v.symbol}</span>
                  {seg.text}
                </button>
                {isOpen && (
                  <div className="mt-1 rounded-md border border-border-warm bg-warm-sand/40 p-3 font-sans text-[12.5px] text-near-black shadow-sm">
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-stone-gray">
                      {ch.type} · {STRATEGY_LABEL[ch.strategy] ?? ch.strategy}
                    </div>
                    <div className="mb-1.5 leading-snug">{ch.reason}</div>
                    {ch.original_text && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] text-olive-gray">
                          原文(被替换)
                        </summary>
                        <pre className="mt-1 whitespace-pre-wrap rounded bg-white/60 p-2 font-mono text-[11.5px] text-stone-gray">
                          {ch.original_text}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </span>
            );
          }
        })}
      </pre>
    </div>
  );
}

// 把 text 按 markers 切成段。markers 假定已按 region_start 排序,且不重叠。
type Segment =
  | { kind: "plain"; text: string }
  | { kind: "marker"; text: string; marker: Marker };

function splitByMarkers(text: string, markers: Marker[]): Segment[] {
  const len = text.length;
  const out: Segment[] = [];
  let cursor = 0;
  for (const m of markers) {
    const start = Math.max(0, Math.min(len, m.data.region_start));
    const end = Math.max(start, Math.min(len, m.data.region_end));
    if (start > cursor) {
      out.push({ kind: "plain", text: text.slice(cursor, start) });
    }
    if (end > start) {
      out.push({ kind: "marker", text: text.slice(start, end), marker: m });
    }
    cursor = end;
  }
  if (cursor < len) {
    out.push({ kind: "plain", text: text.slice(cursor) });
  }
  return out;
}
