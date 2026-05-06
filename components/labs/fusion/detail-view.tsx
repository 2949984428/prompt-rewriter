// prompt-rewriter/components/labs/fusion/detail-view.tsx
//
// 融合 run 的详情页:
//   - 顶部:返回 / 元信息(规则、LLM、时间)/ 复制 / 下载 / 丢弃
//   - LLM 选的策略 + 总结(取 attempts.at(-1).result)
//   - DiffRenderer 单栏融合 + 改动 / 冲突标记
//   - 底部 RetryBar (hint + 换策略)
//   - 折叠 attempts 历史

"use client";

import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import {
  ArrowLeft,
  Copy as CopyIcon,
  Download,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  fusionViewAtom,
  currentFusionRunAtom,
  fusionSummariesLoadedAtom,
} from "@/lib/atoms-fusion";
import type { FusionRunRecord } from "@/lib/schema";
import { DiffRenderer } from "./diff-renderer";
import { RetryBar } from "./retry-bar";

const STRATEGY_LABEL: Record<string, string> = {
  append: "追加 (append)",
  insert_nearby: "就近插入 (insert_nearby)",
  replace_section: "替换冲突段 (replace_section)",
  wrap_reference: "包裹引用 (wrap_reference)",
  rewrite_embed: "改写嵌入 (rewrite_embed)",
  few_shot: "加 few-shot",
};

export function FusionDetailView({ id }: { id: string }) {
  const [, setView] = useAtom(fusionViewAtom);
  const [record, setRecord] = useAtom(currentFusionRunAtom);
  const [, setSummariesLoaded] = useAtom(fusionSummariesLoadedAtom);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 进入页面时如果 currentFusionRunAtom 没有 record(从列表点进来)就拉一次
  useEffect(() => {
    if (record?.id === id) return;
    setLoadError(null);
    fetch(`/api/labs/fusion/runs/${id}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          setLoadError(`HTTP ${r.status}`);
          return;
        }
        const j = (await r.json()) as { record?: FusionRunRecord };
        if (j.record) setRecord(j.record);
      })
      .catch((e) => setLoadError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const latest = record?.attempts.at(-1) ?? null;

  const onCopy = async () => {
    if (!latest?.result) return;
    await navigator.clipboard.writeText(latest.result.merged_prompt);
  };

  const onDownload = () => {
    if (!latest?.result) return;
    const blob = new Blob([latest.result.merged_prompt], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fusion-${id.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onDiscard = async () => {
    if (!confirm("确认丢弃这次融合?(已存历史可恢复,不真删)")) return;
    await fetch(`/api/labs/fusion/runs/${id}`, { method: "DELETE" });
    setSummariesLoaded(false);
    setView({ kind: "list" });
  };

  const onRollbackConflict = async (conflictId: string, originalText: string) => {
    if (!record) return;
    const hint = `第 ${conflictId} 处冲突按原文保留:"${originalText.slice(0, 80)}${originalText.length > 80 ? "…" : ""}"`;
    const r = await fetch(`/api/labs/fusion/runs/${id}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hint }),
    });
    if (r.ok) {
      const j = (await r.json()) as { record?: FusionRunRecord };
      if (j.record) setRecord(j.record);
    }
  };

  if (!record) {
    return (
      <div className="rounded-md border border-border-cream bg-ivory p-8 text-center text-[13px] text-stone-gray">
        {loadError ? `加载失败: ${loadError}` : "加载中…"}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => setView({ kind: "list" })}
          className="flex h-8 items-center gap-1.5 text-[13px] text-olive-gray transition hover:text-near-black"
        >
          <ArrowLeft size={14} />
          返回列表
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onCopy}
            disabled={!latest?.result}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border-cream bg-ivory px-3 text-[13px] text-near-black transition hover:bg-warm-sand/40 disabled:cursor-not-allowed disabled:opacity-50"
            title="复制融合后 prompt 到剪贴板"
          >
            <CopyIcon size={13} />
            复制
          </button>
          <button
            onClick={onDownload}
            disabled={!latest?.result}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border-cream bg-ivory px-3 text-[13px] text-near-black transition hover:bg-warm-sand/40 disabled:cursor-not-allowed disabled:opacity-50"
            title="下载融合后 prompt 为 .md"
          >
            <Download size={13} />
            下载
          </button>
          <button
            onClick={onDiscard}
            className="flex h-8 items-center gap-1.5 rounded-md border border-error-crimson/40 bg-coral-soft-bg/40 px-3 text-[13px] text-error-crimson transition hover:bg-coral-soft-bg/70"
            title="标记为已丢弃(不真删)"
          >
            <Trash2 size={13} />
            丢弃
          </button>
        </div>
      </header>

      <div className="rounded-md border border-border-cream bg-warm-sand/20 p-4 text-[13px] leading-relaxed text-near-black">
        <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
          <Field label="名称">{record.name || `融合 ${record.id.slice(0, 8)}`}</Field>
          <Field label="规则">
            {record.rule.kind === "lab"
              ? `${record.rule.skill_id} / ${record.rule.granularity}${record.rule.section_anchor ? ` / ${record.rule.section_anchor}` : ""}`
              : "自定义规则"}
          </Field>
          <Field label="LLM">{record.rewrite_llm || "(env 默认)"}</Field>
          <Field label="创建时间">{new Date(record.created_at).toLocaleString("zh-CN")}</Field>
        </div>
      </div>

      {!latest?.result ? (
        <div className="rounded-md border border-error-crimson/40 bg-coral-soft-bg/30 p-4 text-[13px] text-error-crimson">
          融合失败: {latest?.error ?? "unknown"}
        </div>
      ) : (
        <>
          <div className="rounded-md border border-border-cream bg-ivory p-4">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-stone-gray">
              LLM 选的策略
            </div>
            <div className="text-[14px] font-medium text-near-black">
              {STRATEGY_LABEL[latest.result.strategy] ?? latest.result.strategy}
            </div>
            <div className="mt-2 text-[12.5px] leading-snug text-olive-gray">
              {latest.result.llm_explanation}
            </div>
            <div className="mt-2 flex items-center gap-3 text-[11px] text-stone-gray">
              <span>{latest.result.changes.length} 处改动</span>
              <span>{latest.result.conflicts.length} 处冲突</span>
              <span>耗时 {(latest.result.ms / 1000).toFixed(1)}s</span>
            </div>
          </div>

          <DiffRenderer result={latest.result} onRollback={onRollbackConflict} />
        </>
      )}

      {/* attempts 历史折叠 */}
      {record.attempts.length > 1 && (
        <div className="rounded-md border border-border-cream bg-ivory">
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-[13px] text-near-black"
          >
            <span className="font-medium">
              历次 attempts ({record.attempts.length})
            </span>
            {historyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {historyOpen && (
            <ul className="space-y-1 border-t border-border-cream p-3 text-[12px]">
              {record.attempts.map((a, i) => (
                <li key={i} className="rounded bg-warm-sand/20 px-3 py-2">
                  <div className="flex items-center justify-between text-stone-gray">
                    <span>
                      #{i + 1} · {new Date(a.timestamp).toLocaleString("zh-CN")}
                    </span>
                    <span>
                      {a.result
                        ? `${STRATEGY_LABEL[a.result.strategy] ?? a.result.strategy} · ${a.result.changes.length} 改动 · ${a.result.conflicts.length} 冲突`
                        : `失败: ${a.error}`}
                    </span>
                  </div>
                  {a.hint && (
                    <div className="mt-1 text-[11.5px] text-olive-gray">
                      hint: {a.hint}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <RetryBar
        runId={id}
        onRetried={(newRecord) => {
          setRecord(newRecord);
          setSummariesLoaded(false);
        }}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-stone-gray">{label}: </span>
      <span className="text-near-black">{children}</span>
    </div>
  );
}
