// prompt-rewriter/components/labs/batch/lab.tsx
//
// 批量测试台容器:list / create / detail 三态切换。
// 启动期顺手把 skills 和 summaries 拉一次。

"use client";

import { useEffect } from "react";
import { useAtom, useAtomValue } from "jotai";
import { batchViewAtom, batchSummariesLoadedAtom, batchSummariesAtom } from "@/lib/atoms-batch";
import { formatSkillsAtom } from "@/lib/atoms-format";
import { FormatSkillsIndexSchema } from "@/lib/schema-format";
import { BatchListView } from "./list-view";
import { BatchCreateForm } from "./create-form";
import { BatchDetailView } from "./detail-view";

export function BatchLab() {
  const view = useAtomValue(batchViewAtom);
  const [skills, setSkills] = useAtom(formatSkillsAtom);
  const [, setSummaries] = useAtom(batchSummariesAtom);
  const [loaded, setLoaded] = useAtom(batchSummariesLoadedAtom);

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
      {view.kind === "list" && <BatchListView />}
      {view.kind === "create" && <BatchCreateForm />}
      {view.kind === "detail" && <BatchDetailView id={view.id} />}
    </div>
  );
}
