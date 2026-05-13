// prompt-rewriter/components/side-tab-bar.tsx
//
// 2026-05-13 架构重构:三大分组
//   - 测试台:Skill 批量测试台 / API 实验台 / Pipeline 测试台
//   - 业务工具:Pipeline 管理 / Experiments / Langfuse
//   - 题目:常规题目 / 标签管理 / 分类
//
// 隐藏(代码留着但 sidebar 不 expose):rewrite(垂类实验台)/ fusion(融合台)。
// 隐藏的 LabId 不能从 sidebar 切到,但其他组件(比如 Pipeline 管理列表卡片点击)
// 仍可 setCurrentLab("pipeline") 切到现 PipelineLab — 此时通过 isTabActive 的特殊
// mapping 让上级 sidebar 项(Pipeline 管理)保持 active 态。

"use client";

import { useAtom, useSetAtom } from "jotai";
import { currentLabAtom, type LabId } from "@/lib/atoms-format";
import {
  questionsLabTabAtom,
  type QuestionsLabTab,
} from "@/lib/atoms-questions";

type Tab = {
  id: LabId;
  label: string;
  questionsSubTab?: QuestionsLabTab;
};

const GROUPS: { title: string; tabs: Tab[] }[] = [
  {
    title: "测试台",
    tabs: [
      { id: "format", label: "API 测试台" },
      { id: "batch", label: "Skill 批量测试台" },
      { id: "pipeline-test", label: "Pipeline 测试台" },
    ],
  },
  {
    title: "业务工具",
    tabs: [
      { id: "pipeline-mgmt", label: "Pipeline 管理" },
      { id: "experiments", label: "Experiments" },
      { id: "langfuse", label: "Langfuse 查看" },
    ],
  },
  {
    title: "题目",
    tabs: [
      { id: "questions", label: "常规题目", questionsSubTab: "regular" },
      { id: "questions", label: "标签管理", questionsSubTab: "tags" },
      { id: "questions", label: "分类", questionsSubTab: "categories" },
    ],
  },
];

export function SideTabBar() {
  const [current, setCurrent] = useAtom(currentLabAtom);
  const [questionsTab, setQuestionsTab] = useAtom(questionsLabTabAtom);
  const setQuestionsLabTab = useSetAtom(questionsLabTabAtom);

  function isTabActive(t: Tab): boolean {
    // 特殊 mapping:Pipeline 管理卡片进入"垂类差异化实验"(currentLab="pipeline")时,
    // 仍然把"Pipeline 管理"sidebar 项视为 active,保持视觉一致
    if (t.id === "pipeline-mgmt" && current === "pipeline") return true;

    if (t.id !== current) return false;
    if (t.questionsSubTab) return questionsTab === t.questionsSubTab;
    return true;
  }

  function onClickTab(t: Tab) {
    setCurrent(t.id);
    if (t.questionsSubTab) setQuestionsLabTab(t.questionsSubTab);
  }

  // 引用避免 unused 警告
  void setQuestionsTab;

  return (
    <nav
      className="fixed bottom-0 left-0 top-16 z-10 hidden w-[240px] overflow-y-auto border-r border-border-cream bg-parchment px-4 py-8 lg:block"
    >
      <div className="space-y-8">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-3 px-3 font-sans text-[15px] font-semibold leading-[1.3] text-near-black">
              {g.title}
            </h3>
            <ul className="space-y-1">
              {g.tabs.map((t, idx) => {
                const active = isTabActive(t);
                return (
                  <li key={`${t.id}-${t.questionsSubTab ?? "_"}-${idx}`}>
                    <button
                      onClick={() => onClickTab(t)}
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
