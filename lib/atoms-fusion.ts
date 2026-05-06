// prompt-rewriter/lib/atoms-fusion.ts
//
// 融合台状态。view 状态机:list / create / detail。
// 不上路由(整 demo 是 SPA),也不污染其他 lab atoms。
// 当前打开的 record 由 atom 持有;创建后立即切到 detail 视图,record 用 POST 返回值预填。

import { atom } from "jotai";
import type { FusionRunRecord, FusionRunSummary } from "./schema";
import type { SkillRuleNode } from "./skill-rule-index";

export type FusionView =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "detail"; id: string };

export const fusionViewAtom = atom<FusionView>({ kind: "list" });

// 列表数据(从 GET /api/labs/fusion/runs 拉)
export const fusionSummariesAtom = atom<FusionRunSummary[]>([]);
export const fusionSummariesLoadedAtom = atom<boolean>(false);

// 当前打开的 run 的完整 record
export const currentFusionRunAtom = atom<FusionRunRecord | null>(null);

// 实验台规则下拉数据(从 /api/labs/fusion/skill-rules 拉,启动时 once)
// 启动后缓存,用户改 skill 文件需要刷新页面才能看到
export const skillRuleIndexAtom = atom<SkillRuleNode[]>([]);
export const skillRuleIndexLoadedAtom = atom<boolean>(false);
