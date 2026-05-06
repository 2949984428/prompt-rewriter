// prompt-rewriter/components/labs/format/drawer/format-report.tsx
//
// 累积报告:对所有历史 PM 评分做聚合分析。
//   - 每个格式: 平均分 / 跑过 case 数 / 胜出次数
//   - 按平均分降序排序,Top1 高亮
//   - 跑得越多越有统计意义,n < 3 标灰提示"样本太少"

"use client";

import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { formatSkillsAtom } from "@/lib/atoms-format";
import { historyIndexAtom } from "@/lib/atoms-history-index";
import type { FormatRunRecord } from "@/lib/schema-format";

type FormatStats = {
  format_id: string;
  format_label: string;
  scores: number[];     // 所有 PM 打过的分
  win_count: number;    // 在跑批中作为 winner 出现的次数
  total_runs: number;   // 跑过总次数(无论是否打分)
};

function aggregate(
  history: FormatRunRecord[],
  skills: ReturnType<typeof useAtomValue<typeof formatSkillsAtom>>
): FormatStats[] {
  const map = new Map<string, FormatStats>();
  for (const s of skills) {
    map.set(s.id, {
      format_id: s.id,
      format_label: s.label,
      scores: [],
      win_count: 0,
      total_runs: 0,
    });
  }
  for (const h of history) {
    for (const r of h.format_runs) {
      if (!map.has(r.format_id)) {
        map.set(r.format_id, {
          format_id: r.format_id,
          format_label: r.format_label || r.format_id,
          scores: [],
          win_count: 0,
          total_runs: 0,
        });
      }
      const s = map.get(r.format_id)!;
      s.total_runs += 1;
      if (typeof r.pm_score === "number") s.scores.push(r.pm_score);
    }
    if (h.winner_format_id) {
      const w = map.get(h.winner_format_id);
      if (w) w.win_count += 1;
    }
  }
  return [...map.values()].sort((a, b) => avg(b.scores) - avg(a.scores));
}

function avg(arr: number[]): number {
  if (arr.length === 0) return -1; // 让无数据的排到末尾
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

export function FormatReport() {
  // 累积报告基于详情数据(每条 record 含 format_runs[].pm_score),
  // 抽屉打开时按需 fetch 所有 format lab 的 detail(从 historyIndex 拿 id 列表)。
  const index = useAtomValue(historyIndexAtom);
  const skills = useAtomValue(formatSkillsAtom);
  const formatIds = index.filter((x) => x.lab_id === "format");
  const [history, setHistory] = useState<FormatRunRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (formatIds.length === 0) {
        setHistory([]);
        return;
      }
      setLoading(true);
      try {
        // 并发拉所有 detail。失败的跳过(soft mode)
        const results = await Promise.all(
          formatIds.map((e) =>
            fetch(`/api/history-runs/${encodeURIComponent(e.id)}`)
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null)
          )
        );
        if (!cancelled) {
          setHistory(results.filter((x): x is FormatRunRecord => !!x && Array.isArray(x.format_runs)));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // 用 stringify 避免每次 index 引用变化都重拉(只在 id 列表实际变化时拉)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatIds.map((e) => e.id).join(",")]);

  const stats = aggregate(history, skills);

  const totalRecords = history.length;
  const totalScored = history.reduce(
    (s, h) => s + h.format_runs.filter((r) => typeof r.pm_score === "number").length,
    0
  );

  if (loading) {
    return (
      <p className="px-10 pt-12 text-center font-mono text-[12px] text-stone-gray">
        正在拉取详情聚合…
      </p>
    );
  }

  if (totalRecords === 0) {
    return (
      <p className="px-10 pt-12 text-center font-serif text-[15px] text-olive-gray">
        累积报告需要先有跑批数据。
        <br />
        先在主区跑几个 query → 打分 → 这里就有横评。
      </p>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h3 className="font-serif text-[18px] font-medium text-near-black">
          累积报告
        </h3>
        <p className="mt-1 text-[12.5px] leading-[1.5] text-stone-gray">
          基于 {totalRecords} 个跑批 / {totalScored} 个评分聚合。
          按 PM 平均分降序排;n &lt; 3 标灰(样本不足,仅供参考)。
        </p>
      </div>

      <div className="space-y-2">
        {stats.map((s, i) => {
          const a = avg(s.scores);
          const hasData = s.scores.length > 0;
          const tooFew = s.scores.length > 0 && s.scores.length < 3;
          const winner = i === 0 && hasData;
          return (
            <div
              key={s.format_id}
              className={`rounded-md border p-3 ${
                winner
                  ? "border-terracotta bg-coral-soft-bg/30"
                  : "border-border-cream bg-ivory"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span
                  className={`font-mono text-[13px] ${
                    hasData ? "font-medium text-near-black" : "text-stone-gray"
                  }`}
                >
                  {winner && "🏆 "}
                  {s.format_label}
                </span>
                <span
                  className={`font-mono text-[13px] ${
                    hasData ? "text-near-black" : "text-stone-gray"
                  }`}
                >
                  {hasData ? a.toFixed(2) : "—"}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-stone-gray">
                <span>
                  跑过 {s.total_runs} · 评分 {s.scores.length}
                  {tooFew && <span className="ml-1 text-warm-gold-fg">·样本不足</span>}
                </span>
                <span>胜出 {s.win_count} 次</span>
              </div>
              {hasData && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border-cream">
                  <div
                    className={`h-full ${winner ? "bg-terracotta" : "bg-coral"}`}
                    style={{ width: `${Math.round((a / 10) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
