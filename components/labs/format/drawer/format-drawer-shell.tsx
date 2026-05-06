// prompt-rewriter/components/labs/format/drawer/format-drawer-shell.tsx
//
// Format Lab 独立抽屉壳。3 个 tab:skill 编辑 / 跑批历史 / 累积报告。
// 与 rewrite lab 的 DrawerShell 完全独立 — top-nav 的设置按钮根据 currentLab
// 决定开哪个抽屉。

"use client";

import { useAtom } from "jotai";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  formatDrawerOpenAtom,
  formatDrawerTabAtom,
  type FormatDrawerTab,
} from "@/lib/atoms-format";
import { FormatSkillEditor } from "./format-skill-editor";
import { FormatHistoryList } from "./format-history-list";
import { FormatReport } from "./format-report";

const TABS: { id: FormatDrawerTab; label: string }[] = [
  { id: "skill", label: "格式 skill" },
  { id: "history", label: "跑批历史" },
  { id: "report", label: "累积报告" },
];

export function FormatDrawerShell() {
  const [open, setOpen] = useAtom(formatDrawerOpenAtom);
  const [tab, setTab] = useAtom(formatDrawerTabAtom);

  return (
    <Sheet open={open} onOpenChange={(v) => setOpen(v)}>
      <SheetContent
        side="right"
        className="w-[520px] border-l-border-cream bg-ivory p-0 sm:max-w-none"
      >
        <SheetHeader className="border-b border-border-cream px-6 py-4">
          <SheetTitle className="font-serif text-[20px] font-medium text-near-black">
            格式实验台 · 设置
          </SheetTitle>
        </SheetHeader>

        <div className="flex gap-6 border-b border-border-cream px-6">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 py-3 text-[14px] font-medium transition ${
                  active
                    ? "border-terracotta text-near-black"
                    : "border-transparent text-olive-gray hover:text-near-black"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="h-[calc(100vh-128px)] overflow-y-auto">
          {tab === "skill" && <FormatSkillEditor />}
          {tab === "history" && <FormatHistoryList />}
          {tab === "report" && <FormatReport />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
