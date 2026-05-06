// prompt-rewriter/lib/atoms-batch.ts
//
// Batch Lab 状态。
//
// view 状态机:list / create / detail —— 故意不上路由,因为整个 demo 是单 page 内
// 实验台切换风格,加 next/router 反而打破现有的 SideTab 心智。
//
// 详情视图的"当前 record"由 atom 持有;SSE 推来的 patch 直接 merge 到 cell。

import { atom } from "jotai";
import type { BatchRunRecord, BatchRunSummary } from "./schema";

export type BatchView =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "detail"; id: string };

export const batchViewAtom = atom<BatchView>({ kind: "list" });

// 列表数据(从 GET /api/labs/batch/runs 拉)
export const batchSummariesAtom = atom<BatchRunSummary[]>([]);
export const batchSummariesLoadedAtom = atom<boolean>(false);

// 当前打开的 run 的完整 record。SSE 流上来时增量 patch 这个 atom。
export const currentBatchRunAtom = atom<BatchRunRecord | null>(null);

// 实时进度(从 SSE progress 事件来,优先用这个;cell 状态变化时也兜底重算)
export type BatchProgress = {
  done: number;
  failed: number;
  excluded: number;
  total: number;
};
export const batchProgressAtom = atom<BatchProgress | null>(null);

// 评分抽屉:打开时存"哪一格"(query_idx + skill_id),null = 关
export type BatchActiveCell = { query_idx: number; skill_id: string };
export const batchActiveCellAtom = atom<BatchActiveCell | null>(null);

// 新建表单的预填载荷(从 detail-view "复制重跑" 触发):
//   - 进 create 视图前 set,create-form 启动期消费一次后清掉
//   - 不复制 cells / external_picks / status —— 那些是上次跑批的产物
//   - mode 一律落 manual,因为 queries 已确定;原 mode(derive/repeat)无意义复制
//   - name 自带 " (副本)" 后缀,便于辨认
export type BatchCreatePrefill = {
  name: string;
  queries: string[];
  skill_ids: string[];
  scoring_dimensions: { id: string; label: string; description: string }[];
  rewrite_llm: string;
  // 原 purpose 留给用户参考,不强制保留
  purpose: string;
  // 是否注入通用规则(从源 record 继承)
  include_universal: boolean;
  // 来源 run id,只显示用,不写到新 record
  source_run_id: string;
  source_run_name: string;
};
export const batchCreatePrefillAtom = atom<BatchCreatePrefill | null>(null);
