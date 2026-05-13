// prompt-rewriter/components/labs/pipeline-test/lab.tsx
//
// Pipeline 测试台 - Phase 2 MVP:复用 BatchLab,但 forceTestKind="pipeline"。
// 共享 batch lab 的 list / create / detail 三视图基建,数据也存在同一份 batch runs 目录下。
// 通过 record.test_kind 字段区分(skill / pipeline),后端 batch-runner 内部分流跑哪条 runner。

"use client";

import { BatchLab } from "@/components/labs/batch/lab";

export function PipelineTestLab() {
  return <BatchLab forceTestKind="pipeline" />;
}
