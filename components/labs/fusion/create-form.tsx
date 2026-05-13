// prompt-rewriter/components/labs/fusion/create-form.tsx
//
// 创建融合 run 的表单。提交后立刻 POST,等 LLM 跑完(~20s),拿到 record 后切到 detail view。
// 输入校验:source_prompt 必填、rule 必填、其他可选。
// LLM 模型用 LlmModelSwitcher 选(复用 batch lab 已有组件)。

"use client";

import { useState } from "react";
import { useAtom, useSetAtom } from "jotai";
import { ArrowLeft, Loader2, Wand2 } from "lucide-react";
import {
  fusionViewAtom,
  currentFusionRunAtom,
  fusionSummariesLoadedAtom,
} from "@/lib/atoms-fusion";
import { llmModelAtom } from "@/lib/atoms";
import { LlmModelSwitcher } from "@/components/llm-model-switcher";
import { estimateTokens, tokenWarnLevel, tokenWarnMessage } from "@/lib/token-estimate";
import type {
  FusionRuleSource,
  FusionMergeStrategy,
  FusionRunRecord,
} from "@/lib/schema";
import { RulePicker } from "./rule-picker";
import { writeHistoryRun } from "@/lib/history-write";
import { historyIndexAtom } from "@/lib/atoms-history-index";

const STRATEGY_OPTIONS: { value: "" | FusionMergeStrategy; label: string }[] = [
  { value: "", label: "让 LLM 自己选" },
  { value: "append", label: "追加在末尾 (append)" },
  { value: "insert_nearby", label: "就近插入 (insert_nearby)" },
  { value: "replace_section", label: "替换冲突段 (replace_section)" },
  { value: "wrap_reference", label: "包裹引用 (wrap_reference)" },
  { value: "rewrite_embed", label: "改写嵌入 (rewrite_embed)" },
  { value: "few_shot", label: "加 few-shot (few_shot)" },
];

export function FusionCreateForm() {
  const [, setView] = useAtom(fusionViewAtom);
  const [, setRecord] = useAtom(currentFusionRunAtom);
  const [, setSummariesLoaded] = useAtom(fusionSummariesLoadedAtom);
  const setHistoryIndex = useSetAtom(historyIndexAtom);
  const [llmModel] = useAtom(llmModelAtom);

  const [name, setName] = useState("");
  const [sourcePrompt, setSourcePrompt] = useState("");
  const [rule, setRule] = useState<FusionRuleSource | null>(null);
  const [strategy, setStrategy] = useState<"" | FusionMergeStrategy>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenEst = estimateTokens(sourcePrompt + (rule?.kind === "lab" ? rule.extracted_text : rule?.text ?? ""));
  const warnLevel = tokenWarnLevel(tokenEst);
  const warnMsg = tokenWarnMessage(warnLevel);
  const warnColor =
    warnLevel === "danger" || warnLevel === "red"
      ? "text-error-crimson"
      : warnLevel === "yellow"
      ? "text-warm-gold-fg"
      : "text-stone-gray";

  const canSubmit =
    !busy && sourcePrompt.trim().length > 0 && rule !== null;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/labs/fusion/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          source_prompt: sourcePrompt,
          rule,
          strategy_request: strategy || undefined,
          rewrite_llm: llmModel || "",
        }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        id?: string;
        record?: FusionRunRecord;
        error?: string;
      };
      if (!r.ok || !j.ok || !j.record || !j.id) {
        setError(`融合失败:${j.error ?? `HTTP ${r.status}`}`);
        return;
      }
      // 切到 detail 并预填
      setRecord(j.record);
      setSummariesLoaded(false); // 让列表下次刷新
      setView({ kind: "detail", id: j.id });
      // 写全局历史索引(fusion 是同步出结果,创建即完成 → 直接 completed)
      const rec = j.record;
      const ruleLabel =
        rec.rule.kind === "lab"
          ? `${rec.rule.skill_id} / ${rec.rule.granularity}`
          : "自定义规则";
      void writeHistoryRun({
        id: rec.id,
        lab_id: "fusion",
        detail: rec,
        index_patch: {
          query: rec.source_prompt.slice(0, 200),
          summary: `融合 ${ruleLabel}` + (rec.name ? ` · ${rec.name}` : ""),
          status: "completed",
          metadata: {
            rule_kind: rec.rule.kind,
            attempt_count: rec.attempts.length,
          },
        },
      }).then((res) => {
        if (!res.ok) console.warn("[fusion-create] history write failed:", res.error);
        const ts = Date.now();
        setHistoryIndex((prev) => {
          if (prev.some((p) => p.id === rec.id)) return prev;
          return [
            {
              id: rec.id,
              ts,
              lab_id: "fusion",
              query: rec.source_prompt.slice(0, 200),
              summary: `融合 ${ruleLabel}`,
              status: "completed",
              ref: `data/labs/fusion/runs/${rec.id}.json`,
              pm_score_avg: null,
              pm_score_count: 0,
              metadata: {
                rule_kind: rec.rule.kind,
                attempt_count: rec.attempts.length,
              },
            },
            ...prev,
          ];
        });
      });
    } catch (e) {
      setError(`请求异常:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <button
          onClick={() => setView({ kind: "list" })}
          className="flex h-8 items-center gap-1.5 text-[13px] text-olive-gray transition hover:text-near-black"
        >
          <ArrowLeft size={14} />
          返回列表
        </button>
        <LlmModelSwitcher />
      </header>

      <Section title="名称(可选)">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如:把 F15 Language strategy 融到 Lovart 主 prompt"
          className="h-9 w-full rounded-md border border-border-cream bg-ivory px-3 text-[13px] text-near-black focus:border-terracotta/60 focus:outline-none"
        />
      </Section>

      <Section title="线上 prompt(必填)">
        <textarea
          value={sourcePrompt}
          onChange={(e) => setSourcePrompt(e.target.value)}
          placeholder="把你正在用的线上 production prompt 全文贴到这里…"
          className="h-72 w-full resize-y rounded-md border border-border-cream bg-ivory px-3 py-2 font-mono text-[12.5px] leading-relaxed text-near-black focus:border-terracotta/60 focus:outline-none"
        />
        <div className={`mt-1 flex items-center justify-end gap-2 text-[11px] ${warnColor}`}>
          <span>~ {tokenEst.toLocaleString()} tokens</span>
          {warnMsg && <span>· {warnMsg}</span>}
        </div>
      </Section>

      <Section title="要融合的规则(必选)">
        <RulePicker value={rule} onChange={setRule} />
      </Section>

      <Section title="融合策略(可选)">
        <select
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as "" | FusionMergeStrategy)}
          className="h-9 w-full rounded-md border border-border-cream bg-ivory px-2 text-[12.5px] text-near-black"
        >
          {STRATEGY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Section>

      {error && (
        <div className="rounded-md border border-error-crimson/40 bg-coral-soft-bg/40 px-4 py-2 text-[13px] text-error-crimson">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-border-cream pt-5">
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          className="flex h-10 items-center gap-2 rounded-md bg-terracotta px-5 text-[14px] font-medium text-white transition hover:bg-terracotta/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
          {busy ? "LLM 融合中(~20s)" : "开始融合"}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[13px] font-medium text-near-black">{title}</h3>
      {children}
    </section>
  );
}
