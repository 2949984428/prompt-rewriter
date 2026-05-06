// prompt-rewriter/app/page.tsx
//
// 实验台分流入口:左侧 SideTabBar 切换,右侧渲染对应 lab。
// page.tsx 自身不再渲染 Hero — 让每个 lab 自己决定标题/副标,
// 切 tab 时整个右栏(含 header)整体替换,不会出现"标题不匹配"的视觉残留。

"use client";

import { useAtomValue } from "jotai";
import { TopNav } from "@/components/top-nav";
import { SideTabBar } from "@/components/side-tab-bar";
import { RewriteLab } from "@/components/labs/rewrite/lab";
import { FormatLab } from "@/components/labs/format/lab";
import { BatchLab } from "@/components/labs/batch/lab";
import { FusionLabRoot } from "@/components/labs/fusion/lab-root";
import { DrawerShell } from "@/components/drawer/drawer-shell";
import { GlobalHistorySheet } from "@/components/global-history-sheet";
import { currentLabAtom } from "@/lib/atoms-format";

export default function Page() {
  const lab = useAtomValue(currentLabAtom);
  return (
    <main>
      <TopNav />
      {/* 真·左侧固定栏 — 在 flow 之外,直接 fixed 贴 viewport 左边 */}
      <SideTabBar />
      {/* 主区:lg+ 让出 240px 给左 sidebar;pt-16 让出 64px 给顶部 fixed nav。
         max-w 给大屏(1920+)一个上限避免一行过宽,1600 在 1440-1920 屏上几乎充满,
         比之前 1140 多 460px 更不"空"。 */}
      <div className="pt-16 lg:pl-[240px]">
        <div className="mx-auto max-w-[1600px] px-8 pb-24 pt-10">
          {lab === "rewrite" ? (
            <RewriteLab />
          ) : lab === "format" ? (
            <FormatLab />
          ) : lab === "batch" ? (
            <BatchLab />
          ) : (
            <FusionLabRoot />
          )}
        </div>
      </div>
      <DrawerShell />
      {/* 全局历史(跨 lab)抽屉,顶栏「🕘 全局历史」打开 */}
      <GlobalHistorySheet />
    </main>
  );
}
