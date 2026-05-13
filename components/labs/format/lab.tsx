// prompt-rewriter/components/labs/format/lab.tsx
//
// 格式实验台主区。集成 input + selector + grid。
// 启动时如果 atoms 未初始化(formatSkillsAtom 为空),自己拉一次 /api/labs/format/skills。

"use client";

import { useEffect } from "react";
import { useAtom, useAtomValue } from "jotai";
import {
  formatSkillsAtom,
  formatImageModelsAtom,
  currentFormatRunAtom,
  formatRunningAtom,
} from "@/lib/atoms-format";
import { UniversalToggle } from "@/components/universal-toggle";
import { FormatSkillsIndexSchema } from "@/lib/schema-format";
import { FormatInputBar } from "./input-bar";
import { FormatSelector } from "./format-selector";
import { FormatResultGrid } from "./result-grid";
import { FormatLabLightbox } from "./format-lightbox";
import { LlmModelSwitcher } from "@/components/llm-model-switcher";
import { ImageModelGrid } from "@/components/image-model-grid";

export function FormatLab() {
  const [skills, setSkills] = useAtom(formatSkillsAtom);
  const [imageModels, setImageModels] = useAtom(formatImageModelsAtom);
  const currentRun = useAtomValue(currentFormatRunAtom);
  const running = useAtomValue(formatRunningAtom);
  // 至少有一个跑出图(image_urls 非空)才让导出按钮亮 — 防止 PM 在空跑批时点导出拿空报告
  const canExport =
    !running &&
    !!currentRun &&
    currentRun.format_runs.some(
      (r) =>
        (r.image_job?.local_paths?.length ?? 0) > 0 ||
        (r.image_job?.urls?.length ?? 0) > 0,
    );
  const exportUrl = currentRun
    ? `/api/labs/format/runs/${encodeURIComponent(currentRun.id)}/export`
    : "";

  // 启动期只需拉格式池(skills)。历史由全局 Bootstrap 统一拉 historyIndex,
  // FormatHistoryList / FormatReport 各自从 historyIndex 派生。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (skills.length === 0) {
          const r = await fetch("/api/labs/format/skills");
          if (r.ok) {
            const j = FormatSkillsIndexSchema.parse(await r.json());
            if (!cancelled) {
              setSkills(
                j.versions.map((v) => ({ id: v.id, label: v.label, notes: v.notes }))
              );
            }
          }
        }
      } catch (e) {
        console.warn("[format-lab] init failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-w-0 flex-1 space-y-8 py-2">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="font-serif text-[32px] font-medium leading-[1.2] text-near-black">
            格式实验台
          </h1>
          <p className="mt-3 max-w-[680px] text-[16px] leading-[1.6] text-olive-gray">
            测同一个 query 在 8 种社区流行的 prompt 格式下,gpt-image-2 的出图差异。
            PM 给每张图打分 + 备注 → 累积成"哪类 use_case 对哪种格式最敏感"的硬数据。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-2">
          <a
            href={canExport ? exportUrl : undefined}
            onClick={(e) => {
              if (!canExport) e.preventDefault();
            }}
            aria-disabled={!canExport}
            title={
              canExport
                ? "导出当前跑批为 HTML / ZIP(自动按 cell 数选)"
                : "先跑一次出图才能导出"
            }
            className={`inline-flex items-center gap-1 rounded-md border border-border-cream px-3 py-1.5 text-[13px] transition ${
              canExport
                ? "bg-ivory text-near-black hover:bg-warm-sand/40"
                : "cursor-not-allowed bg-ivory/50 text-stone-gray"
            }`}
          >
            ↓ 导出
          </a>
          <LlmModelSwitcher />
        </div>
      </header>

      <FormatInputBar />

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-sans text-[14px] font-medium text-olive-gray">
            选要测的格式
          </h2>
          <UniversalToggle />
        </div>
        <FormatSelector />
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="font-sans text-[14px] font-medium text-olive-gray">
            选择使用的模型
          </h2>
          <p className="font-mono text-[11px] text-stone-gray">
            {imageModels.length === 0
              ? "0 个 → 用后端默认 IMAGE_MODEL 跑 1 路"
              : imageModels.length === 1
                ? "单模型 → 每个 skill 各跑 1 路"
                : `${imageModels.length} 个模型 → skill × model 笛卡尔积,共 N×${imageModels.length} 路`}
          </p>
        </div>
        <ImageModelGrid value={imageModels} onChange={setImageModels} />
      </section>

      <FormatResultGrid />

      {/* 抽屉(FormatDrawerShell)已上移到 page.tsx 顶层,与 batch lab 共享同一个实例,
         避免切到 batch 时 drawer 不在 DOM 里 → atom 设 open=true 无效。 */}

      {/* 全屏图预览(单例,接管所有 cell 的点图动作 + 方向键切图) */}
      <FormatLabLightbox />
    </div>
  );
}

