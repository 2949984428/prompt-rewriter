// prompt-rewriter/components/drawer/hints-list.tsx
"use client";

import { useAtom, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { verticalHintsAtom, saveStatusAtom } from "@/lib/atoms";
import type { VerticalHint } from "@/lib/schema";

export function HintsList() {
  const [hints, setHints] = useAtom(verticalHintsAtom);
  const setStatus = useSetAtom(saveStatusAtom);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setStatus("saving");
      try {
        const r = await fetch("/api/hints", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(hints),
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
  }, [hints]);

  const update = (i: number, patch: Partial<VerticalHint>) =>
    setHints(hints.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  const remove = (i: number) =>
    setHints(hints.filter((_, idx) => idx !== i));
  const add = () =>
    setHints([
      ...hints,
      { id: `hint_${Date.now()}`, match: "", hint: "" },
    ]);

  if (hints.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-10 text-center">
        <p className="mb-6 font-serif text-[17px] leading-[1.6] text-olive-gray">
          还没加任何行业小抄 —— AI 自己的训练知识起步就够用。<br />
          等你发现某个行业(比如 NAS、宠物粮、中式珠宝)
          AI 表现不稳,再来这里补几条经验。
        </p>
        <button
          onClick={add}
          className="flex items-center gap-2 rounded-sm bg-warm-sand px-3 py-2 text-[14px] text-charcoal-warm shadow-ring"
        >
          <Plus size={14} /> 加第一条小抄
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-6">
      <p className="mb-1 rounded-md bg-parchment px-3 py-2.5 text-[12.5px] leading-[1.7] text-stone-gray">
        行业小抄 = 在某个垂类场景下,额外塞给 AI 的一段人话。
        当改写识别出这个垂类时,这段 hint 会被拼进 prompt,当作领域经验的补丁。
      </p>
      {hints.map((h, i) => (
        <div key={h.id} className="rounded-md border border-border-cream bg-ivory p-4">
          <div className="mb-2 flex items-start justify-between gap-3">
            <input
              value={h.id}
              onChange={(e) => update(i, { id: e.target.value })}
              className="bg-transparent font-mono text-[14px] font-medium text-near-black focus:outline-none"
            />
            <button onClick={() => remove(i)} className="text-stone-gray hover:text-error-crimson">
              <Trash2 size={14} />
            </button>
          </div>
          <Field label="什么情况下命中(AI 识别出的垂类关键词)">
            <input
              value={h.match}
              onChange={(e) => update(i, { match: e.target.value })}
              className="w-full rounded bg-parchment p-2 font-sans text-[14px] text-olive-gray focus:outline-none"
              placeholder="例:NAS / 家庭存储 / 私有云盘"
            />
          </Field>
          <Field label="命中后喂给 AI 的行业经验(自然语言)">
            <textarea
              value={h.hint}
              onChange={(e) => update(i, { hint: e.target.value })}
              rows={4}
              className="w-full resize-y rounded bg-parchment p-2 font-sans text-[14px] text-olive-gray focus:outline-none"
            />
          </Field>
        </div>
      ))}
      <button
        onClick={add}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border-warm py-3 text-[14px] text-olive-gray hover:bg-ivory"
      >
        <Plus size={14} /> 加一条小抄
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
