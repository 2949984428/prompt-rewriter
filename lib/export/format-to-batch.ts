// prompt-rewriter/lib/export/format-to-batch.ts
//
// 把 FormatRunRecord(API 测试台:1 query × N skill × M model)转成 BatchRunRecord-like
// 形态,这样可以直接喂给 lib/export/build-html.ts 的 buildHtml,复用同一份矩阵导出 UI。
//
// 关键映射:
//   FormatRunRecord.query          → BatchRunRecord.queries = [query]
//   FormatRun.format_id            → BatchCell.skill_id(+ record.skill_ids 去重)
//   FormatRun.image_model          → BatchCell.image_model(+ record.image_model_ids 去重)
//   FormatRun.final_prompt         → BatchCell.final_prompt
//   FormatRun.image_job.local_paths→ BatchCell.image_urls(优先本地缓存)/ fallback urls
//   FormatRun.pm_score(1-10)       → BatchCell.scores.pm(折半到 0-5)
//   FormatRun.pm_notes             → BatchCell.note
//   FormatRun.image_job.error      → BatchCell.error
//   FormatRun.image_job.latency_ms → BatchCell.ms
//
// 评分维度上,format 是单维 1-10,batch 是多维 0-5。adapter 注入一个虚拟维度:
//   scoring_dimensions = [{ id: "pm", label: "PM 主观", description: "1-10 折半到 0-5" }]
// 让 buildHtml 的 ★ 平均分能算。

import type { FormatRunRecord, FormatRun } from "@/lib/schema-format";
import type { BatchRunRecord, BatchCell } from "@/lib/schema";

export function formatRunRecordToBatchRunRecord(
  fr: FormatRunRecord,
): BatchRunRecord {
  // 去重 skill / model 列表,保持 format_runs 首次出现顺序
  const skillSet = new Set<string>();
  const modelSet = new Set<string>();
  const skillLabelMap = new Map<string, string>();
  for (const run of fr.format_runs) {
    if (run.format_id && !skillSet.has(run.format_id)) {
      skillSet.add(run.format_id);
      if (run.format_label) skillLabelMap.set(run.format_id, run.format_label);
    }
    modelSet.add(run.image_model ?? "");
  }
  const skillIds = Array.from(skillSet);
  const modelIds = Array.from(modelSet);

  // 每个 FormatRun 转一个 BatchCell
  const cells: BatchCell[] = fr.format_runs.map((run): BatchCell => {
    const urls =
      run.image_job?.local_paths && run.image_job.local_paths.length > 0
        ? run.image_job.local_paths
        : (run.image_job?.urls ?? []);
    const hasImg = urls.length > 0;
    const hasErr = !!run.image_job?.error;
    const status: BatchCell["status"] = hasImg
      ? "done"
      : hasErr
        ? "failed"
        : "pending";
    const score = run.pm_score; // 1-10 or null
    return {
      query_idx: 0,
      skill_id: run.format_id || "",
      image_model: run.image_model ?? "",
      status,
      final_prompt: (run.final_prompt as BatchCell["final_prompt"]) ?? null,
      image_urls: urls.length > 0 ? urls : null,
      scores: typeof score === "number" ? { pm: Math.min(5, Math.max(0, score / 2)) } : {},
      note: run.pm_notes ?? "",
      error: run.image_job?.error ?? null,
      raw: "",
      ms: run.image_job?.latency_ms ?? 0,
      pipeline_id: "",
      pipeline_outputs: null,
    };
  });

  return {
    id: fr.id,
    created_at: new Date(fr.ts).toISOString(),
    name: `API 测试台 · ${fr.query.slice(0, 40)}${fr.query.length > 40 ? "…" : ""}`,
    query_mode: "manual",
    purpose: fr.use_case_hint ?? "",
    queries: [fr.query],
    skill_ids: skillIds,
    scoring_dimensions: [
      {
        id: "pm",
        label: "PM 主观",
        description: "1-10 折半到 0-5",
      },
    ],
    cells,
    rewrite_llm: fr.config_snapshot?.rewrite_llm ?? "",
    status: "finished",
    include_universal: true,
    reference_images: [],
    per_query_reference_images: [],
    image_model: fr.config_snapshot?.target_model ?? "",
    image_model_ids: modelIds,
    test_kind: "skill",
    pipeline_ids: [],
    cell_keys: [], // adapter 出的虚拟 record,不落盘,cell_keys 留空即可
  };
}

// 给 export route 用:从 FormatRun 抽 format_id → format_label 映射,
// 传给 buildHtml 的 skillLabels(让 UI 显示中文 label 而不是裸 id)
export function extractSkillLabelsFromFormat(
  fr: FormatRunRecord,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of fr.format_runs) {
    if (r.format_id && r.format_label) map[r.format_id] = r.format_label;
  }
  return map;
}
