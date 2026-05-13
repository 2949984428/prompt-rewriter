// prompt-rewriter/components/image-model-multi-select.tsx
//
// 跨 lab 复用的"多选生图模型"组件。给 format/batch 实验台跑 N×M / N×M×K 矩阵用。
//
// 用法:
//   <ImageModelMultiSelect value={selected} onChange={setSelected} />
//   selected: string[]  // model name 数组("gpt-image-2" / "vertex/anon-bob" 等)
//
// 视觉:暖色 button + popover 弹层,弹层里按"内部网关 / Lovart 文生图 / Lovart 图生图"分组列 checkbox。
// 顶部按钮显示"已选 N 个 · <第一个 display_name>...";空选时显示占位。

"use client";

import { useEffect } from "react";
import { useAtom, useSetAtom } from "jotai";
import { Image as ImageIcon, Check, ChevronDown } from "lucide-react";
import {
  imageGeneratorOptionsAtom,
  imageGeneratorDefaultAtom,
  type ImageGeneratorOption,
} from "@/lib/atoms-shared";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

type ApiResp = {
  default: string;
  items: ImageGeneratorOption[];
};

export interface ImageModelMultiSelectProps {
  value: string[];
  onChange: (next: string[]) => void;
  // 是否允许 0 选(默认 false,至少留一个);format/batch 都希望至少 1 个
  allowEmpty?: boolean;
  className?: string;
}

export function ImageModelMultiSelect({
  value,
  onChange,
  allowEmpty = false,
  className = "",
}: ImageModelMultiSelectProps) {
  const [options, setOptions] = useAtom(imageGeneratorOptionsAtom);
  const setDefaultName = useSetAtom(imageGeneratorDefaultAtom);

  // 跟 ImageModelSwitcher 共享同一份清单 atom;若空则首次加载
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

  const toggle = (name: string) => {
    if (value.includes(name)) {
      if (!allowEmpty && value.length <= 1) return; // 不让取消最后一个
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

  // 顶部 button label
  const label = (() => {
    if (value.length === 0) return "选生图模型";
    if (value.length === 1) {
      const o = options.find((x) => x.name === value[0]);
      return o?.display_name ?? value[0];
    }
    const first = options.find((x) => x.name === value[0]);
    return `${first?.display_name ?? value[0]} +${value.length - 1}`;
  })();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <ImageIcon size={14} className="text-stone-gray" />
      <span className="font-mono text-[12px] text-stone-gray">生图模型</span>
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="inline-flex items-center justify-between gap-2 rounded-sm border border-border-cream bg-ivory px-2 py-1 font-sans text-[13px] text-near-black outline-none transition-colors hover:bg-warm-sand/40 focus:border-coral data-popup-open:border-coral min-w-[180px] max-w-[260px]"
            >
              <span className="truncate">{label}</span>
              <ChevronDown size={14} className="shrink-0 text-stone-gray" />
            </button>
          }
        />
        <PopoverContent
          align="start"
          className="w-72 max-h-[60vh] overflow-y-auto p-1"
        >
          <SelectGroup
            title="内部网关"
            items={igw}
            value={value}
            onToggle={toggle}
          />
          <SelectGroup
            title="Lovart · 文生图"
            items={lovartImage}
            value={value}
            onToggle={toggle}
          />
          <SelectGroup
            title="Lovart · 图生图"
            items={lovartModify}
            value={value}
            onToggle={toggle}
          />
          {value.length > 0 && (
            <div className="mt-1 flex items-center justify-between border-t border-border-cream pt-1.5 px-2 py-1 font-mono text-[11px] text-stone-gray">
              <span>已选 {value.length} 个</span>
              {(allowEmpty || value.length > 1) && (
                <button
                  type="button"
                  onClick={() => onChange(allowEmpty ? [] : value.slice(0, 1))}
                  className="text-coral hover:text-terracotta"
                >
                  {allowEmpty ? "清空" : "只留第一个"}
                </button>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SelectGroup({
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
    <div className="mb-1">
      <div className="px-2 pb-1 pt-2 font-mono text-[11px] uppercase tracking-wide text-stone-gray">
        {title}
      </div>
      {items.map((o) => {
        const checked = value.includes(o.name);
        return (
          <button
            key={o.name}
            type="button"
            onClick={() => onToggle(o.name)}
            className={`flex w-full cursor-pointer select-none items-center gap-2 rounded-sm py-1.5 pl-2 pr-2 text-left text-[13px] outline-none transition-colors hover:bg-warm-sand/60 ${
              checked
                ? "bg-coral-soft-bg text-near-black"
                : "text-near-black"
            }`}
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
                checked
                  ? "border-terracotta bg-terracotta text-ivory"
                  : "border-border-warm bg-ivory"
              }`}
            >
              {checked && <Check size={11} />}
            </span>
            <span className="truncate">{o.display_name}</span>
          </button>
        );
      })}
    </div>
  );
}
