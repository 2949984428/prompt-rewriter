// prompt-rewriter/components/labs/questions/lab.tsx
//
// 题目库 lab shell:顶栏(标题 + 全局 meta + 新建题目集按钮)+ 内容区(按 sidebar subTab 分流)。
// 「新建题目集」按钮只在「常规题目」tab 显示(标签管理 / 分类不接受导入)。

"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import {
  questionsLabTabAtom,
  questionsRefreshTickAtom,
  currentSetIdAtom,
} from "@/lib/atoms-questions";
import { RegularQuestions } from "./regular-questions";
import { TagManagement } from "./tag-management";
import { CategoryManagement } from "./category-management";

type GlobalMeta = {
  sets_count: number;
  total_questions: number;
  last_updated_at: string | null;
};

export function QuestionsLab() {
  const tab = useAtomValue(questionsLabTabAtom);
  const currentSetId = useAtomValue(currentSetIdAtom);
  const refreshTick = useAtomValue(questionsRefreshTickAtom);
  const [meta, setMeta] = useState<GlobalMeta | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/questions");
        if (r.ok) setMeta(await r.json());
      } catch {
        /* 静默 */
      }
    })();
  }, [refreshTick]);

  return (
    <main className="min-h-[calc(100vh-64px)] bg-parchment px-8 py-10">
      <div className="mx-auto max-w-[1280px]">
        {/* 顶栏 */}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border-cream pb-5">
          <div>
            <h1 className="font-serif text-[28px] font-medium leading-[1.2] text-near-black">
              {tab === "regular"
                ? "常规题目"
                : tab === "tags"
                  ? "标签管理"
                  : "分类"}
            </h1>
            <p className="mt-1 text-[13px] text-olive-gray">
              {tab === "regular"
                ? "题目集 → 题目两级管理 · 导入 xlsx 即新建一个题目集。"
                : tab === "tags"
                  ? "PM 自定义 tag(跨所有题目集聚合)· 统计 + 批量重命名 + 删除。"
                  : "xlsx 源数据的 L1 / L2 层级(跨所有题目集聚合)· 只读浏览。"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <MetaChips meta={meta} />
            {/* 仅在「常规题目 / 题目集列表」场景下显示新建题目集按钮。
                进入了具体题目集详情后,顶栏不再 expose 导入入口(避免误导 PM 以为是"往这个集追加题") */}
            {tab === "regular" && !currentSetId && <NewSetButton />}
          </div>
        </header>

        {tab === "regular" ? (
          <RegularQuestions />
        ) : tab === "tags" ? (
          <TagManagement />
        ) : (
          <CategoryManagement />
        )}
      </div>
    </main>
  );
}

// ─────────── 全局 meta chips ───────────

function MetaChips({ meta }: { meta: GlobalMeta | null }) {
  if (!meta || meta.sets_count === 0) {
    return (
      <span className="rounded-md bg-warm-sand/50 px-2.5 py-1 font-mono text-[11.5px] text-olive-gray">
        题库为空
      </span>
    );
  }
  const date = meta.last_updated_at
    ? new Date(meta.last_updated_at).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "—";
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
      <span className="rounded-md bg-warm-sand/60 px-2.5 py-1 font-mono text-near-black">
        {meta.sets_count} 个题目集
      </span>
      <span className="rounded-md bg-warm-sand/60 px-2.5 py-1 font-mono text-near-black">
        {meta.total_questions} 题
      </span>
      <span className="rounded-md bg-ivory px-2.5 py-1 font-mono text-stone-gray ring-1 ring-border-cream">
        更新于 {date}
      </span>
    </div>
  );
}

// ─────────── 新建题目集按钮 ───────────

function NewSetButton() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const bumpRefreshTick = useSetAtom(questionsRefreshTickAtom);
  const setCurrentSetId = useSetAtom(currentSetIdAtom);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setReport(null);

    // 默认 name = 去掉扩展名的 filename;PM 想改可在卡片里重命名
    const form = new FormData();
    form.set("file", file);
    form.set("name", file.name.replace(/\.[^.]+$/, ""));

    try {
      const resp = await fetch("/api/questions/sets/import", {
        method: "POST",
        body: form,
      });
      const json = await resp.json();
      if (!resp.ok || !json.ok) {
        setReport(
          `✗ 失败:${json.error ?? "unknown"}${
            json.result?.errors?.length
              ? ` (前 ${json.result.errors.length} 条错:${json.result.errors[0].reason})`
              : ""
          }`,
        );
      } else {
        setReport(
          `✓ 新题目集「${json.set.name}」· 接受 ${json.parsed.accepted} 题`,
        );
        bumpRefreshTick((n: number) => n + 1);
        // 自动跳进新创建的题目集
        setCurrentSetId(json.set.set_id);
      }
    } catch (err) {
      setReport(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="rounded-md bg-terracotta px-3.5 py-1.5 text-[13px] font-medium text-ivory shadow-ring transition hover:bg-terracotta/90 disabled:opacity-40"
      >
        {busy ? "导入中…" : "+ 新建题目集"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        onChange={onPick}
        className="hidden"
      />
      {report && (
        <span className="font-mono text-[11px] text-olive-gray">{report}</span>
      )}
    </div>
  );
}
