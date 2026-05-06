// prompt-rewriter/components/drawer/drawer-shell.tsx
"use client";

import { useAtom } from "jotai";
import { drawerOpenAtom, drawerTabAtom, type DrawerTab } from "@/lib/atoms";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SkillEditor } from "./skill-editor";
import { ModelProfileEditor } from "./model-profile-editor";
import { RulesList } from "./rules-list";
import { HintsList } from "./hints-list";

// 历史轮次已独立为左侧常驻 HistorySidebar,不再占据抽屉 tab。
const TABS: { id: DrawerTab; label: string }[] = [
  { id: "skill", label: "总说明书" },
  { id: "model", label: "目标模型画像" },
  { id: "rules", label: "硬约束铁律" },
  { id: "hints", label: "垂类行业小抄" },
];

export function DrawerShell() {
  const [open, setOpen] = useAtom(drawerOpenAtom);
  const [tab, setTab] = useAtom(drawerTabAtom);

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => setOpen(v)}
    >
      <SheetContent
        side="right"
        className="flex flex-col border-l-border-cream bg-ivory p-0 data-[side=right]:w-[min(550px,92vw)] data-[side=right]:sm:max-w-none"
      >
        <SheetHeader className="shrink-0 border-b border-border-cream px-8 py-5">
          <SheetTitle className="font-serif text-[22px] font-medium text-near-black">
            配置
          </SheetTitle>
        </SheetHeader>

        <div className="flex shrink-0 gap-8 border-b border-border-cream px-8">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px whitespace-nowrap border-b-2 py-4 text-[14.5px] font-medium transition ${
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

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "skill" && <SkillEditor />}
          {tab === "model" && <ModelProfileEditor />}
          {tab === "rules" && <RulesList />}
          {tab === "hints" && <HintsList />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
