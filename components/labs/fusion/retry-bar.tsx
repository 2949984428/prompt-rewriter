// prompt-rewriter/components/labs/fusion/retry-bar.tsx
//
// 决策 7 的 D + B 组合:
//   - 主要路径 = textarea 写 hint + 重试
//   - 辅助路径 = 下拉选策略(可选)
// 提交后调 POST /api/labs/fusion/runs/[id]/merge,append 一条新 attempt。

"use client";

import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import type { FusionMergeStrategy, FusionRunRecord } from "@/lib/schema";

const STRATEGY_OPTIONS: { value: "" | FusionMergeStrategy; label: string }[] = [
  { value: "", label: "用同策略 / 让 LLM 自选" },
  { value: "append", label: "改用 append" },
  { value: "insert_nearby", label: "改用 insert_nearby" },
  { value: "replace_section", label: "改用 replace_section" },
  { value: "wrap_reference", label: "改用 wrap_reference" },
  { value: "rewrite_embed", label: "改用 rewrite_embed" },
  { value: "few_shot", label: "改用 few_shot" },
];

export function RetryBar({
  runId,
  initialHint,
  onRetried,
}: {
  runId: string;
  initialHint?: string;
  onRetried: (newRecord: FusionRunRecord) => void;
}) {
  const [hint, setHint] = useState(initialHint ?? "");
  const [strategy, setStrategy] = useState<"" | FusionMergeStrategy>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/labs/fusion/runs/${runId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hint: hint.trim(),
          strategy_request: strategy || undefined,
        }),
      });
      const j = (await r.json()) as { ok?: boolean; record?: FusionRunRecord; error?: string };
      if (!r.ok || !j.record) {
        setError(`重试失败:${j.error ?? `HTTP ${r.status}`}`);
        return;
      }
      onRetried(j.record);
      setHint("");
    } catch (e) {
      setError(`请求异常:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-border-cream bg-warm-sand/20 p-4">
      <h3 className="mb-2 text-[13px] font-medium text-near-black">不满意?给 LLM 提示重新融合</h3>
      <textarea
        value={hint}
        onChange={(e) => setHint(e.target.value)}
        placeholder="例:第三段不要用替换,改成追加;或:把整体语气写得更克制"
        className="h-20 w-full resize-y rounded-md border border-border-cream bg-ivory px-3 py-2 text-[12.5px] text-near-black focus:border-terracotta/60 focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <select
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as "" | FusionMergeStrategy)}
          className="h-9 flex-1 rounded-md border border-border-cream bg-ivory px-2 text-[12.5px] text-near-black"
        >
          {STRATEGY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          onClick={onClick}
          disabled={busy}
          className="flex h-9 items-center gap-1.5 rounded-md bg-terracotta px-4 text-[13px] font-medium text-white transition hover:bg-terracotta/90 disabled:cursor-wait disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
          {busy ? "重试中(~20s)" : "重新融合"}
        </button>
      </div>
      {error && (
        <div className="mt-2 text-[12px] text-error-crimson">{error}</div>
      )}
    </div>
  );
}
