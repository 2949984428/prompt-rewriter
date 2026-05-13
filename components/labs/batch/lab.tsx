// prompt-rewriter/components/labs/batch/lab.tsx
//
// 批量测试台容器:list / create / detail 三态切换。
// 启动期顺手把 skills 和 summaries 拉一次。
//
// 2026-05-13 Phase 2:BatchLab 被 Skill 批量测试台 + Pipeline 测试台两个 lab 入口共用。
// 通过 forceTestKind prop 锁定 create-form 默认 test_kind(skill 或 pipeline)。

"use client";

import { useEffect } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { batchViewAtom, batchSummariesLoadedAtom, batchSummariesAtom } from "@/lib/atoms-batch";
import { formatSkillsAtom } from "@/lib/atoms-format";
import { FormatSkillsIndexSchema } from "@/lib/schema-format";
import { BatchListView } from "./list-view";
import { BatchCreateForm } from "./create-form";
import { BatchDetailView } from "./detail-view";
import type { BatchTestKind } from "@/lib/schema";

export function BatchLab({
  forceTestKind,
}: {
  forceTestKind?: BatchTestKind;
} = {}) {
  const view = useAtomValue(batchViewAtom);
  const setView = useSetAtom(batchViewAtom);
  const [skills, setSkills] = useAtom(formatSkillsAtom);
  const [, setSummaries] = useAtom(batchSummariesAtom);
  const [loaded, setLoaded] = useAtom(batchSummariesLoadedAtom);

  // 2026-05-13:Skill / Pipeline 测试台共用 batchViewAtom(全局 atom),切 sidebar
  // 时 view 状态会"继承"(比如在 Skill 测试台进了 detail,切到 Pipeline 测试台
  // 看到的还是同一个 detail)。这里监听 forceTestKind 变化,变了就 reset 到 list,
  // 让两个 lab 视觉上完全独立。首次 mount 时也会跑一次,无副作用(view 已经是 list)。
  //
  // 顺手把 loaded 也置 false —— 防御性修复:若上一次 fetch 失败或 hot reload 时
  // atom 进 stale 态,切 lab 时强制重拉一次保证列表新鲜。无网络成本顾虑(列表很小)。
  useEffect(() => {
    setView({ kind: "list" });
    setLoaded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceTestKind]);

  // 拉 skills(format lab 也用,可能已经拉过)
  useEffect(() => {
    if (skills.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/labs/format/skills");
        if (!r.ok) return;
        const j = FormatSkillsIndexSchema.parse(await r.json());
        if (cancelled) return;
        setSkills(
          j.versions.map((v) => ({ id: v.id, label: v.label, notes: v.notes }))
        );
      } catch (e) {
        console.warn("[batch-lab] skills load failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 拉 summaries 一次
  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/labs/batch/runs");
        if (!r.ok) return;
        const j = (await r.json()) as { runs?: unknown };
        if (cancelled || !Array.isArray(j.runs)) return;
        setSummaries(j.runs as never[]);
        setLoaded(true);
      } catch (e) {
        console.warn("[batch-lab] summaries load failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  return (
    <div className="min-w-0 flex-1 space-y-8 py-2">
      {view.kind === "list" && <BatchListView filterTestKind={forceTestKind} />}
      {view.kind === "create" && <BatchCreateForm forceTestKind={forceTestKind} />}
      {view.kind === "detail" && <BatchDetailView id={view.id} />}
    </div>
  );
}
