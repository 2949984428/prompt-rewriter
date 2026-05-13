// prompt-rewriter/components/labs/questions/category-management.tsx
//
// 分类 tab:基于 xlsx 源数据的 L1 / L2 分类做只读统计 + 浏览。
//   - 层级视图:L1 (展开) → L2 (展开) → 题目预览 chip
//   - 不能 rename / delete L1/L2(分类是源数据,只能改 xlsx 后重新导入)
//   - 点 qid chip → 跳到常规题目并打开详情抽屉

"use client";

import { useEffect, useState } from "react";
import { useSetAtom, useAtomValue } from "jotai";
import {
  questionsFilterL1Atom,
  questionsFilterL2Atom,
  questionsSelectedQidAtom,
  questionsLabTabAtom,
  questionsRefreshTickAtom,
  currentSetIdAtom,
} from "@/lib/atoms-questions";

type CategoryNode = { name: string; count: number; qids: string[] };

type CategoryData = {
  l1: CategoryNode[];
  l2_by_l1: Record<string, CategoryNode[]>;
  uncategorized: { qids: string[] };
  total_categorized_questions: number;
};

export function CategoryManagement() {
  const [data, setData] = useState<CategoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedL1, setExpandedL1] = useState<Set<string>>(new Set());
  const [expandedL2, setExpandedL2] = useState<Set<string>>(new Set()); // key = "L1::L2"
  const refreshTick = useAtomValue(questionsRefreshTickAtom);

  async function fetchCategories() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/questions/categories");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as CategoryData;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // 监听 refreshTick:导入后父级 bump tick → 这里重拉
  useEffect(() => {
    fetchCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  function toggleL1(name: string) {
    setExpandedL1((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function toggleL2(l1: string, l2: string) {
    const key = `${l1}::${l2}`;
    setExpandedL2((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  if (loading && !data) {
    return (
      <div className="rounded-md border border-border-cream bg-ivory px-4 py-8 text-center text-[13px] text-stone-gray">
        载入中…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-error-crimson/30 bg-error-crimson/5 px-3 py-2 text-[13px] text-error-crimson">
        {error}
      </div>
    );
  }

  if (!data || data.l1.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border-cream bg-ivory px-6 py-12 text-center">
        <p className="mb-1 font-serif text-[16px] text-near-black">
          题库为空
        </p>
        <p className="text-[13px] text-olive-gray">
          先到 <b>常规题目</b> 导入 xlsx,分类会自动从 categories 字段生成。
        </p>
      </div>
    );
  }

  const total = data.l1.reduce((a, x) => a + x.count, 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3 rounded-lg border border-border-cream bg-ivory px-5 py-4">
        <div className="flex flex-col">
          <span className="font-serif text-[18px] font-medium text-near-black">
            {data.l1.length} 个 L1 垂类
          </span>
          <span className="text-[12px] text-olive-gray">
            {data.total_categorized_questions} / {total + data.uncategorized.qids.length} 题已分类
            {data.uncategorized.qids.length > 0 && (
              <span className="ml-2 text-error-crimson">
                · {data.uncategorized.qids.length} 题无 L1
              </span>
            )}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              const all = new Set(data.l1.map((x) => x.name));
              setExpandedL1(expandedL1.size === all.size ? new Set() : all);
            }}
            className="rounded-md border border-border-cream bg-ivory px-3 py-1.5 text-[12px] text-olive-gray hover:bg-warm-sand/40"
          >
            {expandedL1.size === data.l1.length ? "全部折叠" : "全部展开"}
          </button>
          <button
            onClick={fetchCategories}
            disabled={loading}
            className="rounded-md border border-border-cream bg-ivory px-3 py-1.5 text-[12px] text-olive-gray hover:bg-warm-sand/40"
          >
            刷新
          </button>
        </div>
      </header>

      <p className="px-2 text-[11.5px] text-stone-gray">
        分类来自 xlsx 的 <code className="font-mono">categories</code> 列。
        改名 / 增删需要修改源文件后重新导入(题目库认为分类是只读元数据)。
      </p>

      <ul className="space-y-2">
        {data.l1.map((l1Node) => {
          const expanded = expandedL1.has(l1Node.name);
          const l2List = data.l2_by_l1[l1Node.name] ?? [];
          return (
            <li
              key={l1Node.name}
              className="overflow-hidden rounded-lg border border-border-cream bg-ivory"
            >
              <button
                onClick={() => toggleL1(l1Node.name)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-warm-sand/30"
              >
                <span className="font-mono text-[11px] text-stone-gray">
                  {expanded ? "▾" : "▸"}
                </span>
                <span className="font-serif text-[15.5px] font-medium text-near-black">
                  {l1Node.name}
                </span>
                <span className="rounded-md bg-warm-sand/60 px-2 py-0.5 font-mono text-[11px] text-near-black">
                  {l1Node.count} 题
                </span>
                {l2List.length > 0 && (
                  <span className="font-mono text-[11px] text-stone-gray">
                    · {l2List.length} 个 L2
                  </span>
                )}
              </button>
              {expanded && (
                <div className="border-t border-border-cream bg-parchment/30 px-4 py-3">
                  {l2List.length === 0 ? (
                    <QidsRow qids={l1Node.qids} />
                  ) : (
                    <ul className="space-y-1.5">
                      {l2List.map((l2Node) => {
                        const key = `${l1Node.name}::${l2Node.name}`;
                        const l2Open = expandedL2.has(key);
                        return (
                          <L2Item
                            key={l2Node.name}
                            l1={l1Node.name}
                            l2={l2Node}
                            open={l2Open}
                            onToggle={() => toggleL2(l1Node.name, l2Node.name)}
                          />
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {data.uncategorized.qids.length > 0 && (
        <details className="rounded-lg border border-error-crimson/30 bg-error-crimson/5 px-4 py-3">
          <summary className="cursor-pointer select-none font-mono text-[12px] text-error-crimson">
            无 L1 分类的题目({data.uncategorized.qids.length} 题)
          </summary>
          <div className="mt-2">
            <QidsRow qids={data.uncategorized.qids} />
          </div>
        </details>
      )}
    </div>
  );
}

function L2Item({
  l1,
  l2,
  open,
  onToggle,
}: {
  l1: string;
  l2: CategoryNode;
  open: boolean;
  onToggle: () => void;
}) {
  const setLabTab = useSetAtom(questionsLabTabAtom);
  const setFilterL1 = useSetAtom(questionsFilterL1Atom);
  const setFilterL2 = useSetAtom(questionsFilterL2Atom);

  function jumpToFiltered() {
    // 跨多个 set 的 L1/L2 没法精确"进列表",这里只设筛选条件,
    // 用户回到常规题目后还得自己选哪个题目集才能看到筛选效果。
    // 短期接受这个限制 — 等 PM 提出"按 L1 跨 set 查询"再做全局题目检索 API。
    setFilterL1(l1);
    setFilterL2(l2.name);
    setLabTab("regular");
  }

  return (
    <li>
      <div className="flex flex-wrap items-center gap-2.5 rounded-md px-2 py-1.5">
        <button
          onClick={onToggle}
          className="font-mono text-[10.5px] text-stone-gray hover:text-near-black"
          aria-label="展开"
        >
          {open ? "▾" : "▸"}
        </button>
        <span className="font-mono text-[13px] text-near-black">{l2.name}</span>
        <span className="rounded-md bg-warm-sand/40 px-1.5 py-0.5 font-mono text-[10.5px] text-near-black">
          {l2.count}
        </span>
        <button
          onClick={jumpToFiltered}
          className="ml-auto rounded-md border border-border-cream bg-ivory px-2 py-0.5 font-mono text-[10.5px] text-olive-gray hover:border-terracotta hover:text-terracotta"
          title={`筛选 ${l1} / ${l2.name} 进常规题目`}
        >
          进列表 →
        </button>
      </div>
      {open && (
        <div className="ml-6 mt-1 mb-2">
          <QidsRow qids={l2.qids} />
        </div>
      )}
    </li>
  );
}

function QidsRow({ qids }: { qids: string[] }) {
  const setLabTab = useSetAtom(questionsLabTabAtom);
  const setSelectedQid = useSetAtom(questionsSelectedQidAtom);
  const setCurrentSetId = useSetAtom(currentSetIdAtom);

  return (
    <div className="flex flex-wrap gap-1">
      {qids.map((compositeKey) => {
        // qids 现在是 "set_id::qid" 复合 key,显示用真 qid,跳转 set + qid 一起
        const sep = compositeKey.indexOf("::");
        const setId = sep >= 0 ? compositeKey.slice(0, sep) : "";
        const qid = sep >= 0 ? compositeKey.slice(sep + 2) : compositeKey;
        return (
          <button
            key={compositeKey}
            onClick={() => {
              if (setId) setCurrentSetId(setId);
              setSelectedQid(qid);
              setLabTab("regular");
            }}
            className="rounded-md border border-border-cream bg-ivory px-2 py-0.5 font-mono text-[10.5px] text-near-black hover:border-terracotta hover:text-terracotta"
          >
            {qid}
          </button>
        );
      })}
    </div>
  );
}
