// prompt-rewriter/app/page.tsx
//
// 实验台分流入口:左侧 SideTabBar 切换,右侧渲染对应 lab。
// page.tsx 自身不再渲染 Hero — 让每个 lab 自己决定标题/副标,
// 切 tab 时整个右栏(含 header)整体替换,不会出现"标题不匹配"的视觉残留。
//
// 2026-05-13 架构重构后:sidebar 三分组(测试台 / 业务工具 / 题目)。
// rewrite / fusion 隐藏(sidebar 不 expose,但 currentLabAtom 切到这些 LabId 仍能渲染)。

"use client";

import { useAtomValue } from "jotai";
import { TopNav } from "@/components/top-nav";
import { SideTabBar } from "@/components/side-tab-bar";
import { RewriteLab } from "@/components/labs/rewrite/lab";
import { FormatLab } from "@/components/labs/format/lab";
import { BatchLab } from "@/components/labs/batch/lab";
import { FusionLabRoot } from "@/components/labs/fusion/lab-root";
import { PipelineLab } from "@/components/labs/pipeline/lab";
import { ExperimentsLab } from "@/components/labs/experiments/lab";
import { LangfuseLab } from "@/components/labs/langfuse/lab";
import { QuestionsLab } from "@/components/labs/questions/lab";
import { PipelineMgmtLab } from "@/components/labs/pipeline-mgmt/lab";
import { PipelineTestLab } from "@/components/labs/pipeline-test/lab";
import { DrawerShell } from "@/components/drawer/drawer-shell";
import { FormatDrawerShell } from "@/components/labs/format/drawer/format-drawer-shell";
import { PipelineDrawer } from "@/components/labs/pipeline/drawer/pipeline-drawer";
import { GlobalHistorySheet } from "@/components/global-history-sheet";
import { currentLabAtom } from "@/lib/atoms-format";

export default function Page() {
  const lab = useAtomValue(currentLabAtom);
  return (
    <main>
      <TopNav />
      <SideTabBar />
      <div className="pt-16 lg:pl-[240px]">
        <div className="mx-auto max-w-[1600px] px-8 pb-24 pt-10">
          {lab === "batch" ? (
            // Skill 批量测试台 - 显式锁定 test_kind=skill,list 只显示 skill records
            <BatchLab forceTestKind="skill" />
          ) : lab === "format" ? (
            <FormatLab />
          ) : lab === "pipeline-test" ? (
            <PipelineTestLab />
          ) : lab === "pipeline-mgmt" ? (
            <PipelineMgmtLab />
          ) : lab === "pipeline" ? (
            <PipelineLab />
          ) : lab === "experiments" ? (
            <ExperimentsLab />
          ) : lab === "langfuse" ? (
            <LangfuseLab />
          ) : lab === "questions" ? (
            <QuestionsLab />
          ) : lab === "rewrite" ? (
            // 隐藏:sidebar 不再 expose,仅 currentLabAtom 强切时渲染
            <RewriteLab />
          ) : lab === "fusion" ? (
            // 隐藏:同上
            <FusionLabRoot />
          ) : (
            // 兜底:不应到这里,LabId 已穷举
            <BatchLab />
          )}
        </div>
      </div>
      {/* 抽屉按 lab 分流挂载 */}
      {lab === "rewrite" && <DrawerShell />}
      {(lab === "format" || lab === "batch") && <FormatDrawerShell />}
      {lab === "pipeline" && <PipelineDrawer />}
      <GlobalHistorySheet />
    </main>
  );
}
