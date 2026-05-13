// prompt-rewriter/components/labs/format/format-selector.tsx
//
// 多选格式 checkbox 列表（format lab 的薄包装）。
// 真正的 UI 在共用组件 `<SkillSelector>` 里，本文件只负责接 atom（formatSkillsAtom / formatSelectedIdsAtom）。

"use client";

import { useAtom, useAtomValue } from "jotai";
import { formatSkillsAtom, formatSelectedIdsAtom } from "@/lib/atoms-format";
import { SkillSelector } from "@/components/skill-selector";

export function FormatSelector() {
  const skills = useAtomValue(formatSkillsAtom);
  const [selected, setSelected] = useAtom(formatSelectedIdsAtom);

  const toggle = (id: string) =>
    setSelected(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id]
    );

  return (
    <SkillSelector
      skills={skills}
      selectedIds={selected}
      onToggle={toggle}
      layout="single"
      emptyText="正在加载格式池…"
    />
  );
}
