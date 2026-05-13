// prompt-rewriter/components/labs/format/input-bar.tsx
//
// Format Lab 的输入区:query textarea + 选中数 + 跑批按钮。
// 点跑后串起整条链路:
//   1. POST /api/labs/format/run → 拿 N 个 final_prompt
//   2. 对每个有 final_prompt 的 run,调 startImageJob(formatJobAtomFamily(id), final_prompt)
//   3. 整体写入 currentFormatRunAtom (含 image_job 占位,等 poller 回填)
//   4. 写一条 history (不含 image 数据,等图回来由 cell writeback)

"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useStore } from "jotai";
import { ImageUploader } from "@/components/image-uploader";
import { ArrowRight, Loader2 } from "lucide-react";
import {
  formatQueryAtom,
  formatSelectedIdsAtom,
  formatRunningAtom,
  currentFormatRunAtom,
  formatJobAtomFamily,
  formatCellKey,
  formatSkillsAtom,
  formatReferenceImagesAtom,
  formatImageModelsAtom,
} from "@/lib/atoms-format";
import {
  historyIndexAtom,
  historyIndexLoadedAtom,
} from "@/lib/atoms-history-index";
import { INITIAL_IMAGE_JOB, targetModelAtom, modelProfileMdAtom, llmModelAtom } from "@/lib/atoms";
import { includeUniversalDefaultAtom } from "@/lib/atoms-shared";
import { startImageJob } from "@/lib/image-job";
import { djb2Hash } from "@/lib/persist-history";
import {
  writeHistoryRun,
  summarizeFormatRecord,
} from "@/lib/history-write";
import {
  type FormatRunRecord,
  type FormatRun,
} from "@/lib/schema-format";
import type { FinalPrompt } from "@/lib/schema";

type ApiRun = {
  format_id: string;
  format_label: string;
  final_prompt: FinalPrompt | null;
  error: string | null;
};

export function FormatInputBar() {
  const [query, setQuery] = useAtom(formatQueryAtom);
  const selected = useAtomValue(formatSelectedIdsAtom);
  const skills = useAtomValue(formatSkillsAtom);
  const [running, setRunning] = useAtom(formatRunningAtom);
  const setCurrentRun = useSetAtom(currentFormatRunAtom);
  const setHistoryIndex = useSetAtom(historyIndexAtom);
  const targetModel = useAtomValue(targetModelAtom);
  const modelProfileMd = useAtomValue(modelProfileMdAtom);
  const llmModel = useAtomValue(llmModelAtom);
  // 多 model atom = format lab 唯一的"生图模型"数据源(顶部 multi-select 写入)。
  // 空 → 跑 1 路用后端默认 IMAGE_MODEL;非空 → 笛卡尔积,跑 N 路。
  const selectedModels = useAtomValue(formatImageModelsAtom);
  // 跨 lab 共享：勾选状态在 batch lab 也跟着走（UI 移到 lab.tsx 的"选要测的格式"标题旁）
  const includeUniversal = useAtomValue(includeUniversalDefaultAtom);
  // 参考图：lab 级 atom 共享（input-bar + cell-retry 都读它），demo 阶段不持久化
  const [referenceImages, setReferenceImages] = useAtom(formatReferenceImagesAtom);
  const store = useStore();

  const labelOf = (id: string): string =>
    skills.find((s) => s.id === id)?.label ?? id;

  const run = async () => {
    const q = query.trim();
    if (!q || selected.length === 0 || running) return;
    setRunning(true);

    // 决定要跑的 model 集合:非空 → 按多选笛卡尔积;空 → 单 1 路用后端默认("")
    const effModels = selectedModels.length > 0 ? selectedModels : [""];

    // 清空所有 image job atoms (本次选中 skills × models 的笛卡尔积)
    selected.forEach((id) =>
      effModels.forEach((m) =>
        store.set(formatJobAtomFamily(formatCellKey(id, m)), INITIAL_IMAGE_JOB)
      )
    );

    try {
      const resp = await fetch("/api/labs/format/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          skill_ids: selected,
          llm_model: llmModel || undefined,
          include_universal: includeUniversal,
        }),
      });
      const data = (await resp.json()) as { runs?: ApiRun[]; error?: string };
      if (!resp.ok || !data.runs) {
        console.warn("[format-lab] run failed:", data.error);
        return;
      }

      // 组装 FormatRunRecord:(skill × model) 笛卡尔积每对一条 FormatRun
      const id = crypto.randomUUID();
      const ts = Date.now();
      const formatRuns: FormatRun[] = data.runs.flatMap((r) =>
        effModels.map((m) => ({
          format_id: r.format_id,
          format_label: r.format_label || labelOf(r.format_id),
          image_model: m,
          final_prompt: (r.final_prompt ?? {}) as FormatRun["final_prompt"],
          image_job: {
            task_id: null,
            urls: [],
            local_paths: [],
            cost: null,
            latency_ms: null,
            error: r.error ?? null,
          },
          pm_score: null,
          pm_notes: "",
          rated_at: null,
        }))
      );

      const record: FormatRunRecord = {
        id,
        ts,
        query: q,
        use_case_hint: "",
        format_runs: formatRuns,
        winner_format_id: null,
        config_snapshot: {
          target_model: targetModel,
          model_profile_hash: djb2Hash(modelProfileMd),
          rewrite_llm: llmModel,
        },
      };
      setCurrentRun(record);

      // 起 image jobs:每个 (skill × model) 笛卡尔积一路。
      // 同 skill 不同 model 共享同一份 final_prompt(LLM 只跑 1 次),但生图各自独立。
      data.runs.forEach((r) => {
        if (!r.final_prompt?.prompt) return;
        effModels.forEach((m) => {
          const key = formatCellKey(r.format_id, m);
          const setJob = (
            update: ImageJobStateOrUpdater
          ) => store.set(
            formatJobAtomFamily(key),
            typeof update === "function"
              ? update(store.get(formatJobAtomFamily(key)))
              : update
          );
          void startImageJob(setJob, {
            prompt: r.final_prompt!.prompt!,
            size: r.final_prompt!.size,
            quality: r.final_prompt!.quality,
            n: r.final_prompt!.n,
            output_format: r.final_prompt!.output_format,
            reference_images: referenceImages,
            model: m || undefined, // 空 → 后端默认
          });
        });
      });

      // 新历史架构:写 detail + 同步索引(原子)。失败不阻塞 UI。
      const { summary, pm_score_avg, pm_score_count } =
        summarizeFormatRecord(record);
      void writeHistoryRun({
        id,
        lab_id: "format",
        detail: record,
        index_patch: {
          query: q,
          summary,
          status: "completed",
          pm_score_avg,
          pm_score_count,
        },
      }).then((r) => {
        if (!r.ok) console.warn("[format-input-bar] history 写入失败:", r.error);
      });

      // optimistic 更新全局 historyIndex 让顶栏可见
      const indexLoaded = store.get(historyIndexLoadedAtom);
      if (indexLoaded) {
        const cur = store.get(historyIndexAtom);
        setHistoryIndex([
          {
            id,
            ts,
            lab_id: "format",
            query: q,
            summary,
            status: "completed",
            ref: `data/labs/format/runs/${id}.json`,
            pm_score_avg,
            pm_score_count,
            metadata: {},
          },
          ...cur,
        ]);
      }
    } catch (e) {
      console.warn("[format-lab] error", e);
    } finally {
      setRunning(false);
    }
  };

  // 多 model 模式下,实际跑的路数 = skills × models 笛卡尔积
  const modelMultiplier = selectedModels.length > 0 ? selectedModels.length : 1;
  const totalRoutes = selected.length * modelMultiplier;
  const cost = (totalRoutes * 0.04).toFixed(2);
  const time = totalRoutes * 8; // 粗估每路 8s

  return (
    <section className="rounded-lg border border-border-cream bg-ivory p-6 shadow-whisper">
      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="贴上你要测的图像 query。例:一只在便利店霓虹灯下的橘猫,仰拍"
        className="block min-h-[100px] w-full resize-y bg-transparent font-sans text-[15px] leading-[1.6] text-near-black placeholder:text-stone-gray focus:outline-none"
      />
      <div className="mt-3 border-t border-border-cream pt-3">
        <ImageUploader
          value={referenceImages}
          onChange={setReferenceImages}
          max={3}
          hint="非空 → 所有 skill 都走图生图"
        />
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border-cream pt-3">
        <div className="font-mono text-[12px] text-stone-gray">
          {query.length} 字 · 已选 {selected.length} 个格式
          {modelMultiplier > 1 && ` × ${modelMultiplier} 个模型`}
          {totalRoutes > 0 && ` · ~$${cost} · ~${time}s`}
        </div>
        <button
          onClick={run}
          disabled={running || !query.trim() || selected.length === 0}
          className="flex h-9 items-center gap-2 rounded-md bg-terracotta px-3 text-[14px] font-medium text-ivory shadow-ring-cta transition hover:opacity-95 disabled:opacity-60"
        >
          {running ? (
            <>
              改写中… <Loader2 size={14} className="animate-spin" />
            </>
          ) : (
            <>
              跑 {totalRoutes || "N"} 路 <ArrowRight size={14} />
            </>
          )}
        </button>
      </div>
    </section>
  );
}

// 局部辅助类型(SetStateAction 替代,避免引入新 import)
type ImageJobStateOrUpdater =
  | import("@/lib/atoms").ImageJobState
  | ((prev: import("@/lib/atoms").ImageJobState) => import("@/lib/atoms").ImageJobState);
type ImageJobState = import("@/lib/atoms").ImageJobState;
