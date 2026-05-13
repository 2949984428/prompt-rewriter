// prompt-rewriter/components/labs/experiments/lab.tsx
//
// Phase 3a · Experiments 实验记录中心。
// SPA 视图:selectedExperimentId === null → 列表;非空 → 详情。
// 路由形态故意不用 Next.js 真路由(整个 app 是单页 SPA,SideTabBar 切 lab),
// 这样跳转 / 返回不需要等 Next 客户端导航,瞬时切。

"use client";

import { useAtomValue } from "jotai";
import { selectedExperimentIdAtom } from "@/lib/atoms-experiments";
import { ExperimentsList } from "./list";
import { ExperimentDetail } from "./detail";

export function ExperimentsLab() {
  const selectedId = useAtomValue(selectedExperimentIdAtom);
  return selectedId ? <ExperimentDetail id={selectedId} /> : <ExperimentsList />;
}
