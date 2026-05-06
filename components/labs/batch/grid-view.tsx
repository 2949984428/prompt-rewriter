// prompt-rewriter/components/labs/batch/grid-view.tsx
//
// N×M 矩阵视图。
// 行 = query,列 = skill。每格用 BatchCellCard。
//
// 大型矩阵(>5 列)开横向滚动 — 不强折行。

"use client";

import { useAtomValue } from "jotai";
import { currentBatchRunAtom } from "@/lib/atoms-batch";
import { formatSkillsAtom } from "@/lib/atoms-format";
import { BatchCellCard } from "./cell-card";

const COL_W = 280; // 单列宽度;够放方图 + 标题

export function BatchGridView() {
  const record = useAtomValue(currentBatchRunAtom);
  const skills = useAtomValue(formatSkillsAtom);

  if (!record) return null;

  const labelOf = (id: string) => skills.find((s) => s.id === id)?.label ?? id;

  return (
    <section className="overflow-x-auto rounded-md border border-border-cream bg-parchment/30">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `220px repeat(${record.skill_ids.length}, ${COL_W}px)`,
          minWidth: 220 + record.skill_ids.length * COL_W,
        }}
      >
        {/* 表头:左上空格 + skill 列 */}
        <div className="sticky left-0 z-10 border-b border-r border-border-cream bg-parchment/70 px-3 py-2 text-[11.5px] uppercase tracking-wider text-stone-gray">
          query \ skill
        </div>
        {record.skill_ids.map((sid) => (
          <div
            key={sid}
            className="border-b border-border-cream bg-parchment/70 px-3 py-2"
          >
            <div className="font-mono text-[12.5px] font-medium text-near-black">
              {labelOf(sid)}
            </div>
            <div className="mt-0.5 truncate font-mono text-[10.5px] text-stone-gray">
              {sid}
            </div>
          </div>
        ))}

        {/* 内容行 */}
        {record.queries.map((q, qi) => (
          <Row key={qi} qi={qi} q={q} skillIds={record.skill_ids} />
        ))}
      </div>
    </section>
  );
}

function Row({
  qi,
  q,
  skillIds,
}: {
  qi: number;
  q: string;
  skillIds: string[];
}) {
  return (
    <>
      {/* 行首:query 文本(可纵向滚) */}
      <div className="sticky left-0 z-10 max-h-[260px] overflow-y-auto border-b border-r border-border-cream bg-ivory/80 p-3">
        <div className="mb-1 font-mono text-[10.5px] uppercase tracking-wider text-stone-gray">
          Q{qi + 1}
        </div>
        <p className="text-[12.5px] leading-[1.5] text-near-black">{q}</p>
      </div>
      {skillIds.map((sid) => (
        <div
          key={sid}
          className="border-b border-border-cream bg-ivory/30 p-2"
        >
          <BatchCellCard query_idx={qi} skill_id={sid} />
        </div>
      ))}
    </>
  );
}
