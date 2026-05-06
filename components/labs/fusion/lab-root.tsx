// prompt-rewriter/components/labs/fusion/lab-root.tsx
//
// 融合台入口,根据 view atom 切换 list / create / detail。
// 跟 batch lab 的 BatchLab 角色对等。

"use client";

import { useAtom } from "jotai";
import { fusionViewAtom } from "@/lib/atoms-fusion";
import { FusionListView } from "./list-view";
import { FusionCreateForm } from "./create-form";
import { FusionDetailView } from "./detail-view";

export function FusionLabRoot() {
  const [view] = useAtom(fusionViewAtom);
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-[28px] leading-tight text-near-black">
          融合台
        </h1>
        <p className="text-[14px] text-olive-gray">
          把实验台验证过的规则融合到线上 prompt — LLM 选策略 + 标注改动 + 标红冲突
        </p>
      </header>
      {view.kind === "list" && <FusionListView />}
      {view.kind === "create" && <FusionCreateForm />}
      {view.kind === "detail" && <FusionDetailView id={view.id} />}
    </div>
  );
}
