// prompt-rewriter/components/labs/batch/leaderboard.tsx
//
// 排行榜:每个评分维度独立排一份(按 skill 平均分降序)。
// 排除态 cell 不参与统计。

"use client";

import { useAtomValue } from "jotai";
import { Trophy, EyeOff } from "lucide-react";
import { currentBatchRunAtom } from "@/lib/atoms-batch";
import { formatSkillsAtom } from "@/lib/atoms-format";
import type { BatchCell, BatchRunRecord, ScoringDimension } from "@/lib/schema";

type Row = {
  skill_id: string;
  label: string;
  count: number;
  avg: number;
};

function aggregate(
  cells: BatchCell[],
  skill_ids: string[],
  dim: ScoringDimension,
  labelOf: (id: string) => string
): Row[] {
  const rows: Row[] = skill_ids.map((sid) => {
    const involved = cells.filter(
      (c) => c.skill_id === sid && c.status === "done"
    );
    const scored = involved.filter(
      (c) =>
        typeof c.scores[dim.id] === "number" && c.scores[dim.id] > 0
    );
    const sum = scored.reduce((acc, c) => acc + c.scores[dim.id], 0);
    return {
      skill_id: sid,
      label: labelOf(sid),
      count: scored.length,
      avg: scored.length > 0 ? sum / scored.length : 0,
    };
  });
  rows.sort((a, b) => {
    if (a.count === 0 && b.count > 0) return 1;
    if (b.count === 0 && a.count > 0) return -1;
    return b.avg - a.avg;
  });
  return rows;
}

export function BatchLeaderboard() {
  const record = useAtomValue(currentBatchRunAtom);
  const skills = useAtomValue(formatSkillsAtom);
  if (!record) return null;

  const hasDimRanking = record.scoring_dimensions.length > 0;
  const hasBlindPicks =
    !!record.external_picks &&
    Object.keys(record.external_picks.picks ?? {}).length > 0;
  if (!hasDimRanking && !hasBlindPicks) return null;

  return (
    <div className="space-y-8">
      {hasDimRanking && (
        <DimensionLeaderboard record={record} skills={skills} />
      )}
      {hasBlindPicks && (
        <BlindPickLeaderboard record={record} skills={skills} />
      )}
    </div>
  );
}

function DimensionLeaderboard({
  record,
  skills,
}: {
  record: BatchRunRecord;
  skills: { id: string; label: string }[];
}) {
  const labelOf = (id: string) => skills.find((s) => s.id === id)?.label ?? id;
  const totalScored = record.cells.filter(
    (c) => c.status === "done" && Object.values(c.scores).some((v) => v > 0)
  ).length;
  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <Trophy size={16} className="text-warm-gold-fg" />
        <h2 className="text-[15px] font-medium text-near-black">排行榜</h2>
        <span className="text-[12px] text-stone-gray">
          已评分 cell:{totalScored} · 排除态不计入
        </span>
      </header>
      <div className="grid grid-cols-2 gap-4">
        {record.scoring_dimensions.map((d) => {
          const rows = aggregate(record.cells, record.skill_ids, d, labelOf);
          return (
            <div
              key={d.id}
              className="rounded-md border border-border-cream bg-ivory p-4"
            >
              <div className="mb-2.5">
                <div className="text-[13px] font-medium text-near-black">
                  {d.label}
                </div>
                {d.description && (
                  <div className="text-[11.5px] text-stone-gray">
                    {d.description}
                  </div>
                )}
              </div>
              <table className="w-full">
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.skill_id}
                      className="border-t border-border-cream first:border-t-0"
                    >
                      <td className="w-8 py-1.5 text-center font-mono text-[12px] text-stone-gray">
                        {i + 1}
                      </td>
                      <td className="py-1.5">
                        <div className="font-mono text-[12.5px] text-near-black">
                          {r.label}
                        </div>
                        <div className="font-mono text-[10.5px] text-stone-gray">
                          {r.skill_id}
                        </div>
                      </td>
                      <td className="w-24 py-1.5 text-right">
                        {r.count > 0 ? (
                          <>
                            <div className="font-mono text-[14px] font-medium text-near-black">
                              {r.avg.toFixed(2)}
                            </div>
                            <div className="font-mono text-[10.5px] text-stone-gray">
                              n={r.count}
                            </div>
                          </>
                        ) : (
                          <span className="text-[11.5px] text-stone-gray">
                            未评分
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─────── 盲评榜 ───────
// 不分维度,只看"被选为该 query winner 的次数"。external_picks.picks 形如
// { "0": "F4-block-formula", "1": "F11-direct-api", ... }(server 已反映射过)
function BlindPickLeaderboard({
  record,
  skills,
}: {
  record: BatchRunRecord;
  skills: { id: string; label: string }[];
}) {
  const labelOf = (id: string) => skills.find((s) => s.id === id)?.label ?? id;
  const picks = record.external_picks!.picks;
  const reviewer = record.external_picks!.reviewer;

  const wins = new Map<string, number>();
  for (const sid of Object.values(picks)) {
    wins.set(sid, (wins.get(sid) ?? 0) + 1);
  }
  const rows = record.skill_ids
    .map((sid) => ({
      skill_id: sid,
      label: labelOf(sid),
      count: wins.get(sid) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
  const totalPicks = Object.keys(picks).length;
  const totalQueries = record.queries.length;

  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <EyeOff size={16} className="text-terracotta" />
        <h2 className="text-[15px] font-medium text-near-black">盲评结果</h2>
        <span className="text-[12px] text-stone-gray">
          评审人:
          <span className="ml-1 text-near-black">
            {reviewer || "(匿名)"}
          </span>
          {" · "}
          每 query 选 1 张 · {totalPicks} / {totalQueries} 已评
        </span>
      </header>
      <div className="rounded-md border border-border-cream bg-ivory p-4">
        <table className="w-full">
          <tbody>
            {rows.map((r, i) => {
              const pct =
                totalPicks > 0 ? Math.round((r.count / totalPicks) * 100) : 0;
              return (
                <tr
                  key={r.skill_id}
                  className="border-t border-border-cream first:border-t-0"
                >
                  <td className="w-8 py-1.5 text-center font-mono text-[12px] text-stone-gray">
                    {i + 1}
                  </td>
                  <td className="py-1.5">
                    <div className="font-mono text-[12.5px] text-near-black">
                      {r.label}
                    </div>
                    <div className="font-mono text-[10.5px] text-stone-gray">
                      {r.skill_id}
                    </div>
                  </td>
                  <td className="w-32 py-1.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-border-cream">
                      <div
                        className="h-full bg-terracotta transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </td>
                  <td className="w-20 py-1.5 text-right">
                    <div className="font-mono text-[14px] font-medium text-near-black">
                      {r.count}
                    </div>
                    <div className="font-mono text-[10.5px] text-stone-gray">
                      {pct}%
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
