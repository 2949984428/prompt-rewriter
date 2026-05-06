// prompt-rewriter/components/side-tab-bar.tsx
//
// 左侧实验台切换栏 — 走 Anthropic Claude Docs 的极简文档侧栏风:
//   - 搜索框置顶(视觉锚点 + 后续可接搜索)
//   - 分组小标题(uppercase, 字号小, Stone Gray)
//   - tab 是纯文字行,无 ring shadow / 无 icon / 无副标题
//   - 激活态:左侧 2px Coral 竖线 + 字色 Near Black + medium 字重
//   - 默认态:Olive Gray;hover 态升到 Near Black

"use client";

import { useAtom } from "jotai";
import { currentLabAtom, type LabId } from "@/lib/atoms-format";

type Tab = { id: LabId; label: string };

// 分组结构 — 沿 Anthropic Docs 风:一组分组标题(中文 semibold)下挂多个纯文字 tab。
// 即使当前只有"实验台"一组,保留 group 抽象方便日后扩"工具/报告/策略库"。
const GROUPS: { title: string; tabs: Tab[] }[] = [
  {
    title: "实验台",
    tabs: [
      { id: "rewrite", label: "垂类实验台" },
      { id: "format", label: "格式实验台" },
      { id: "batch", label: "批量测试台" },
      { id: "fusion", label: "融合台" },
    ],
  },
];

export function SideTabBar() {
  const [current, setCurrent] = useAtom(currentLabAtom);

  return (
    <nav
      className="fixed bottom-0 left-0 top-16 z-10 hidden w-[240px] overflow-y-auto border-r border-border-cream bg-parchment px-4 py-8 lg:block"
    >
      <div className="space-y-8">
        {GROUPS.map((g) => (
          <section key={g.title}>
            {/* 分组标题:中文 semibold Near Black,不 uppercase 不 tracking,
               像文档目录的章节锚 */}
            <h3 className="mb-3 px-3 font-sans text-[15px] font-semibold leading-[1.3] text-near-black">
              {g.title}
            </h3>
            <ul className="space-y-1">
              {g.tabs.map((t) => {
                const active = t.id === current;
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => setCurrent(t.id)}
                      className={`relative flex w-full items-center rounded-sm py-2.5 pl-5 pr-3 text-left text-[14px] leading-[1.4] transition ${
                        active
                          ? "font-medium text-near-black"
                          : "text-olive-gray hover:text-near-black"
                      }`}
                    >
                      {active && (
                        <span
                          aria-hidden
                          className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-terracotta"
                        />
                      )}
                      {t.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}
