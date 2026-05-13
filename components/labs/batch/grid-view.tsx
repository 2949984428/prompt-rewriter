// prompt-rewriter/components/labs/batch/grid-view.tsx
//
// 矩阵视图。
// 行始终 = query;列 = skill 或 model(由 axisMode 决定);剩下那一维做 tab 切换。
//
// 自适应规则(axisMode="auto"):
//   - 1 个 skill,多个 model → 列 = model(用户最常见的"对比模型"诉求)
//   - 多个 skill,1 个 model(或 0 model)→ 列 = skill(回退到老行为)
//   - 多 skill × 多 model → 列 = skill(沿用老行为),tab 切 model
//
// 用户可以手动 toggle "横轴 skill | model" 强制走某个方向。

"use client";

import { useEffect, useState } from "react";
import { useAtomValue, useAtom } from "jotai";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import {
  currentBatchRunAtom,
  batchActiveModelAtom,
  batchActiveSkillAtom,
  batchGridAxisAtom,
  type GridAxisMode,
} from "@/lib/atoms-batch";
import { formatSkillsAtom } from "@/lib/atoms-format";
import { imageGeneratorOptionsAtom } from "@/lib/atoms-shared";
import { BatchCellCard } from "./cell-card";

const COL_W = 280;

// Phase 2:Pipeline 测试台用 pipeline_ids 作第二维(X 轴)。短期 hardcode pipeline name 映射,
// 后续 pipeline registry 接入时改成从 registry 查表(跟 Pipeline 管理 lab 同源)。
const PIPELINE_NAMES: Record<string, string> = {
  vertical_prompt_rewrite_v1: "垂类差异化实验",
  api_direct: "API 直出 (baseline)",
};

export function BatchGridView() {
  const record = useAtomValue(currentBatchRunAtom);
  const skills = useAtomValue(formatSkillsAtom);
  const generators = useAtomValue(imageGeneratorOptionsAtom);
  const [activeModel, setActiveModel] = useAtom(batchActiveModelAtom);
  const [activeSkill, setActiveSkill] = useAtom(batchActiveSkillAtom);
  const [axisMode, setAxisMode] = useAtom(batchGridAxisAtom);
  // 参考图缩略图点击放大预览(产物图点击仍走 score-drawer,不变)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Phase 2:test_kind="pipeline" → 第二维用 pipeline_ids;"skill"(默认)→ skill_ids。
  // 下面所有 record.skill_ids 改用 secondaryIds。
  const isPipeline = record?.test_kind === "pipeline";
  const secondaryIds = isPipeline
    ? record?.pipeline_ids ?? []
    : record?.skill_ids ?? [];

  // model 集合:优先 record.image_model_ids,fallback 从 cells 提取去重
  const modelList = (() => {
    if (!record) return [] as string[];
    if (record.image_model_ids && record.image_model_ids.length > 0) {
      return record.image_model_ids;
    }
    const set = new Set<string>();
    record.cells.forEach((c) => set.add(c.image_model ?? ""));
    return Array.from(set);
  })();

  // 自适应横轴:1 secondary 多 model → model;否则 secondary(skill 或 pipeline)
  const effAxis: "skill" | "model" =
    axisMode === "auto"
      ? record && secondaryIds.length === 1 && modelList.length > 1
        ? "model"
        : "skill"
      : axisMode;

  // 切 run / 切 axis 时重置 active(防 active 指向旧 run 的 id)
  useEffect(() => {
    if (!record) return;
    if (effAxis === "skill") {
      // 列是 skill,tab 是 model
      if (!modelList.includes(activeModel)) {
        setActiveModel(modelList[0] ?? "");
      }
    } else {
      // 列是 model,tab 是 secondary(skill 或 pipeline)
      if (!secondaryIds.includes(activeSkill)) {
        setActiveSkill(secondaryIds[0] ?? "");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id, effAxis, modelList.join("|"), secondaryIds.join("|")]);

  if (!record) return null;

  // secondary 维度的 label:skill 模式从 skills 取,pipeline 模式从 PIPELINE_NAMES 取
  const labelOfSecondary = (id: string) =>
    isPipeline
      ? PIPELINE_NAMES[id] ?? id
      : skills.find((s) => s.id === id)?.label ?? id;
  const labelOfModel = (m: string) =>
    m === ""
      ? "默认"
      : generators.find((g) => g.name === m)?.display_name ?? m;

  // tab 列表(另一维度);单值时不渲染 tab 行
  const tabItems = effAxis === "skill" ? modelList : secondaryIds;
  const activeTab = effAxis === "skill" ? activeModel : activeSkill;
  const setActiveTab = effAxis === "skill" ? setActiveModel : setActiveSkill;
  const tabLabelOf = effAxis === "skill" ? labelOfModel : labelOfSecondary;

  // 横轴 items
  const xItems = effAxis === "skill" ? secondaryIds : modelList;
  const xLabelOf = effAxis === "skill" ? labelOfSecondary : labelOfModel;
  const xHeaderName = effAxis === "skill" ? (isPipeline ? "pipeline" : "skill") : "model";

  // 是否两个维度都 >1(决定要不要显示轴向切换器)
  const bothDimsMulti = secondaryIds.length > 1 && modelList.length > 1;

  return (
    <section className="space-y-3">
      {/* 轴向 toggle:只有两边都 >1 时才需要(否则方向已自动决定,没必要让用户切) */}
      {bothDimsMulti && (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wide text-stone-gray">
            横轴
          </span>
          <AxisToggle value={axisMode} onChange={setAxisMode} />
        </div>
      )}

      {/* tab 行:另一维度 > 1 才有意义 */}
      {tabItems.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border-cream bg-parchment/30 p-1.5">
          <span className="px-2 font-mono text-[11px] uppercase tracking-wide text-stone-gray">
            {effAxis === "skill" ? "生图模型" : "Skill"}
          </span>
          {tabItems.map((t) => {
            const active = t === activeTab;
            // 该 tab 下的进度统计
            const cellsOfTab = record.cells.filter((c) =>
              effAxis === "skill"
                ? (c.image_model ?? "") === t
                : isPipeline
                  ? (c.pipeline_id ?? "") === t
                  : c.skill_id === t,
            );
            const doneOf = cellsOfTab.filter((c) => c.status === "done").length;
            return (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 font-mono text-[12px] transition ${
                  active
                    ? "bg-terracotta text-ivory shadow-ring-cta"
                    : "bg-ivory text-charcoal-warm hover:bg-warm-sand/60"
                }`}
              >
                <span>{tabLabelOf(t)}</span>
                <span
                  className={`font-mono text-[10px] ${
                    active ? "text-ivory/70" : "text-stone-gray"
                  }`}
                >
                  {doneOf}/{cellsOfTab.length}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border-cream bg-parchment/30">
        <div
          className="grid"
          style={{
            // Q 列 360 — 给长 prompt 跟参考图缩略图留出可读宽度
            gridTemplateColumns: `360px repeat(${xItems.length}, ${COL_W}px)`,
            minWidth: 360 + xItems.length * COL_W,
          }}
        >
          <div className="sticky left-0 z-10 border-b border-r border-border-cream bg-parchment/70 px-3 py-2 text-[11.5px] uppercase tracking-wider text-stone-gray">
            query \ {xHeaderName}
          </div>
          {xItems.map((x) => (
            <div
              key={x || "__default__"}
              className="border-b border-border-cream bg-parchment/70 px-3 py-2"
            >
              <div className="font-mono text-[12.5px] font-medium text-near-black">
                {xLabelOf(x)}
              </div>
              <div className="mt-0.5 truncate font-mono text-[10.5px] text-stone-gray">
                {x || "default"}
              </div>
            </div>
          ))}

          {record.queries.map((q, qi) => (
            <Row
              key={qi}
              qi={qi}
              q={q}
              xItems={xItems}
              axis={effAxis}
              activeTab={activeTab}
              isPipeline={isPipeline}
              refImages={record.per_query_reference_images?.[qi] ?? []}
              onPreview={setLightboxSrc}
            />
          ))}
        </div>
      </div>
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </section>
  );
}

function Row({
  qi,
  q,
  xItems,
  axis,
  activeTab,
  isPipeline,
  refImages,
  onPreview,
}: {
  qi: number;
  q: string;
  xItems: string[];
  axis: "skill" | "model";
  activeTab: string;
  isPipeline: boolean;
  /** 该 query 的参考图(来自题目集 image block 的 URL,方案 C per_query_reference_images) */
  refImages: string[];
  /** 点击参考图缩略图触发的预览回调 */
  onPreview: (src: string) => void;
}) {
  // 剥掉 [@image:#N:hash] 占位符 —— 参考图缩略图已独立渲染在下方
  const qDisplay = q
    .replace(/\[@image:#\d+:[a-zA-Z0-9_-]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (
    <>
      <div className="sticky left-0 z-10 max-h-[380px] overflow-y-auto border-b border-r border-border-cream bg-ivory/80 p-3">
        <div className="mb-1 font-mono text-[10.5px] uppercase tracking-wider text-stone-gray">
          Q{qi + 1}
        </div>
        <p className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.5] text-near-black">
          {qDisplay}
        </p>
        {refImages.length > 0 && (
          <div className="mt-2.5 border-t border-border-cream pt-2">
            <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wider text-stone-gray">
              参考图 ({refImages.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {refImages.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onPreview(url)}
                  className="block cursor-zoom-in"
                  title="点击放大预览"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    className="h-16 w-16 rounded border border-border-cream object-cover transition hover:border-terracotta"
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {xItems.map((x) => {
        // X 轴是 secondary(skill 或 pipeline)时,按 isPipeline 决定塞 skill_id 还是 pipeline_id
        // X 轴是 model 时,activeTab 是 secondary 维度(同理分流)
        const secondaryVal = axis === "skill" ? x : activeTab;
        const imageModelVal = axis === "skill" ? activeTab : x;
        return (
          <div
            key={x || "__default__"}
            className="border-b border-border-cream bg-ivory/30 p-2"
          >
            <BatchCellCard
              query_idx={qi}
              skill_id={isPipeline ? "" : secondaryVal}
              pipeline_id={isPipeline ? secondaryVal : ""}
              image_model={imageModelVal}
            />
          </div>
        );
      })}
    </>
  );
}

function AxisToggle({
  value,
  onChange,
}: {
  value: GridAxisMode;
  onChange: (v: GridAxisMode) => void;
}) {
  const opts: { id: GridAxisMode; label: string }[] = [
    { id: "auto", label: "自动" },
    { id: "skill", label: "Skill" },
    { id: "model", label: "Model" },
  ];
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border-cream bg-ivory p-0.5">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-sm px-2.5 py-1 font-mono text-[11.5px] transition ${
            value === o.id
              ? "bg-terracotta text-ivory"
              : "text-charcoal-warm hover:bg-warm-sand/60"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
