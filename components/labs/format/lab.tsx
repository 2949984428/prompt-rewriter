// prompt-rewriter/components/labs/format/lab.tsx
//
// 格式实验台主区。集成 input + selector + grid。
// 启动时如果 atoms 未初始化(formatSkillsAtom 为空),自己拉一次 /api/labs/format/skills。

"use client";

import { useEffect } from "react";
import { useAtom } from "jotai";
import { formatSkillsAtom } from "@/lib/atoms-format";
import { FormatSkillsIndexSchema } from "@/lib/schema-format";
import { FormatInputBar } from "./input-bar";
import { FormatSelector } from "./format-selector";
import { FormatResultGrid } from "./result-grid";
import { FormatDrawerShell } from "./drawer/format-drawer-shell";
import { FormatLabLightbox } from "./format-lightbox";
import { LlmModelSwitcher } from "@/components/llm-model-switcher";

export function FormatLab() {
  const [skills, setSkills] = useAtom(formatSkillsAtom);

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
        <div className="shrink-0 pt-2">
          <LlmModelSwitcher />
        </div>
      </header>

      <FormatInputBar />

      <section>
        <h2 className="mb-3 font-sans text-[14px] font-medium text-olive-gray">
          选要测的格式
        </h2>
        <FormatSelector />
      </section>

      <FormatResultGrid />

      {/* 格式实验台独立抽屉(3 tab:skill 编辑 / 历史 / 累积报告)。
         挂在 lab 内,只在 format lab 激活时存在,与 rewrite drawer 互不污染。 */}
      <FormatDrawerShell />

      {/* 全屏图预览(单例,接管所有 cell 的点图动作 + 方向键切图) */}
      <FormatLabLightbox />
    </div>
  );
}
