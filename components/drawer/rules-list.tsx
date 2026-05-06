// prompt-rewriter/components/drawer/rules-list.tsx
"use client";

import { useAtom, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { hardRulesAtom, saveStatusAtom } from "@/lib/atoms";
import type { HardRule } from "@/lib/schema";
import { Switch } from "@/components/ui/switch";

export function RulesList() {
  const [rules, setRules] = useAtom(hardRulesAtom);
  const setStatus = useSetAtom(saveStatusAtom);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);

  // debounce 写盘（跳过启动期，避免空数组覆盖 API 拉来的初值）
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setStatus("saving");
      try {
        const r = await fetch("/api/rules", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rules),
        });
        setStatus(r.ok ? "saved" : "error");
      } catch {
        setStatus("error");
      }
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules]);

  const update = (i: number, patch: Partial<HardRule>) =>
    setRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) =>
    setRules(rules.filter((_, idx) => idx !== i));
  const add = () =>
    setRules([
      ...rules,
      {
        id: `rule_${Date.now()}`,
        title: "新规则",
        enabled: false,
        trigger_keywords: [],
        trigger_hint: "",
        rule: "",
        source_case: "",
      },
    ]);

  return (
    <div className="space-y-3 p-6">
      <p className="mb-1 rounded-md bg-parchment px-3 py-2.5 text-[12.5px] leading-[1.7] text-stone-gray">
        硬约束 = 这一类需求里「一旦满足触发条件,就必须原样写进 prompt」的铁律。
        常用于历史出过问题、运营踩过坑的场景。开关 enabled 控制是否参与改写。
      </p>
      {rules.map((r, i) => (
        <div key={r.id} className="rounded-md border border-border-cream bg-ivory p-4">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <Switch
                checked={r.enabled}
                onCheckedChange={(v) => update(i, { enabled: v })}
                className="data-checked:bg-terracotta data-unchecked:bg-stone-gray"
              />
              <input
                value={r.id}
                onChange={(e) => update(i, { id: e.target.value })}
                className="bg-transparent font-mono text-[14px] font-medium text-near-black focus:outline-none"
              />
            </div>
            <button
              onClick={() => remove(i)}
              className="text-stone-gray hover:text-error-crimson"
            >
              <Trash2 size={14} />
            </button>
          </div>
          <input
            value={r.title}
            onChange={(e) => update(i, { title: e.target.value })}
            className="mb-2 w-full bg-transparent font-sans text-[15px] font-medium text-near-black focus:outline-none"
          />
          <Field label="什么时候触发(给 AI 的判断线索)">
            <textarea
              value={r.trigger_hint}
              onChange={(e) => update(i, { trigger_hint: e.target.value })}
              rows={2}
              className="w-full resize-y rounded bg-parchment p-2 font-sans text-[14px] text-olive-gray focus:outline-none"
            />
          </Field>
          <Field label="命中后要原样写进 prompt 的内容">
            <textarea
              value={r.rule}
              onChange={(e) => update(i, { rule: e.target.value })}
              rows={3}
              className="w-full resize-y rounded bg-parchment p-2 font-sans text-[14px] text-olive-gray focus:outline-none"
            />
          </Field>
          <Field label="这条规则从哪个 case 沉淀来(便于回溯)">
            <input
              value={r.source_case}
              onChange={(e) => update(i, { source_case: e.target.value })}
              className="w-full bg-transparent font-sans text-[13px] text-stone-gray focus:outline-none"
            />
          </Field>
        </div>
      ))}
      <button
        onClick={add}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border-warm py-3 text-[14px] text-olive-gray hover:bg-ivory"
      >
        <Plus size={14} /> 加一条硬约束
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="mb-1 font-mono text-[12px] text-stone-gray">{label}</div>
      {children}
    </div>
  );
}
