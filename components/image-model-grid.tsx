// prompt-rewriter/components/image-model-grid.tsx
//
// 像 SkillSelector 那样把全部生图模型摊在页面上的多选组件(format / batch 用)。
// - 分 3 组:内部网关 / Lovart 文生图 / Lovart 图生图
// - 每个 model 一张卡片:复选框 + display_name + 来源 chip(vendor_docs / lovart_api 等)
// - 卡片可点击切换选中态;视觉跟 SkillSelector 对齐(terracotta + Check)
// - 自己拉清单(跟 ImageModelMultiSelect 共享 atom)

"use client";

import { useEffect } from "react";
import { useAtom, useSetAtom } from "jotai";
import { Check } from "lucide-react";
import {
  imageGeneratorOptionsAtom,
  imageGeneratorDefaultAtom,
  type ImageGeneratorOption,
} from "@/lib/atoms-shared";

type ApiResp = {
  default: string;
  items: ImageGeneratorOption[];
};

export interface ImageModelGridProps {
  value: string[];
  onChange: (next: string[]) => void;
}

export function ImageModelGrid({ value, onChange }: ImageModelGridProps) {
  const [options, setOptions] = useAtom(imageGeneratorOptionsAtom);
  const setDefaultName = useSetAtom(imageGeneratorDefaultAtom);

  useEffect(() => {
    if (options.length > 0) return;
    let aborted = false;
    (async () => {
      try {
        const resp = await fetch("/api/image-generators");
        if (!resp.ok) return;
        const json = (await resp.json()) as ApiResp;
        if (aborted) return;
        setOptions(json.items);
        setDefaultName(json.default);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (options.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border-warm bg-ivory p-6 text-center text-[14px] text-stone-gray">
        正在加载生图模型…
      </p>
    );
  }

  const toggle = (name: string) => {
    if (value.includes(name)) {
      onChange(value.filter((v) => v !== name));
    } else {
      onChange([...value, name]);
    }
  };

  const igw = options.filter((o) => o.provider === "igw");
  const lovartImage = options.filter(
    (o) => o.provider === "lovart" && o.type === "image"
  );
  const lovartModify = options.filter(
    (o) => o.provider === "lovart" && o.type === "image-modify"
  );

  return (
    <div className="space-y-4">
      <Group title="内部网关" items={igw} value={value} onToggle={toggle} />
      <Group
        title="Lovart · 文生图"
        items={lovartImage}
        value={value}
        onToggle={toggle}
      />
      <Group
        title="Lovart · 图生图"
        items={lovartModify}
        value={value}
        onToggle={toggle}
      />
    </div>
  );
}

function Group({
  title,
  items,
  value,
  onToggle,
}: {
  title: string;
  items: ImageGeneratorOption[];
  value: string[];
  onToggle: (name: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-stone-gray">
        {title} · {items.length} 个
      </div>
      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
        {items.map((o) => {
          const on = value.includes(o.name);
          return (
            <button
              key={o.name}
              type="button"
              onClick={() => onToggle(o.name)}
              className={`flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition ${
                on
                  ? "border-terracotta bg-coral-soft-bg/40"
                  : "border-border-cream bg-ivory hover:border-border-warm"
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border ${
                  on
                    ? "border-terracotta bg-terracotta text-ivory"
                    : "border-stone-gray bg-transparent"
                }`}
              >
                {on && <Check size={14} strokeWidth={3} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[13px] font-medium text-near-black">
                  {o.display_name}
                </div>
                <div className="mt-0.5 truncate text-[11.5px] leading-[1.4] text-stone-gray">
                  {o.description || o.name}
                </div>
                {o.constraints?.source?.kind && (
                  <SourceBadge kind={o.constraints.source.kind} />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SourceBadge({ kind }: { kind: string }) {
  const label =
    kind === "vendor_docs"
      ? "厂商文档"
      : kind === "lovart_api"
        ? "Lovart"
        : kind === "empirical"
          ? "实测"
          : "未核";
  const tone =
    kind === "vendor_docs"
      ? "bg-warm-gold-bg/60 text-warm-gold-fg"
      : kind === "lovart_api"
        ? "bg-warm-sand/60 text-charcoal-warm"
        : "bg-border-cream text-stone-gray";
  return (
    <span
      className={`mt-1 inline-block rounded-sm px-1.5 py-0.5 font-mono text-[10px] ${tone}`}
    >
      {label}
    </span>
  );
}
