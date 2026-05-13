// prompt-rewriter/lib/atoms-experiments.ts
//
// Experiments lab(Phase 3a UI)的本地态。SPA 内部跨视图传"我要看哪条 record"。

import { atom } from "jotai";
import type { ExperimentRecordHead } from "@/lib/schema";

// null = 列表视图;string = 详情视图(对应 record.id)
export const selectedExperimentIdAtom = atom<string | null>(null);

// 列表筛选条件(可选,Phase 3a 起步阶段只用一个 query 模糊搜)
export const experimentListQueryAtom = atom<string>("");
export const experimentListTagAtom = atom<string>("");
export const experimentListPipelineIdAtom = atom<string>("");

// 列表 cache(可空 → 表示还没拉过;空数组 → 拉过但 0 条)
export const experimentListCacheAtom = atom<ExperimentRecordHead[] | null>(null);
