// prompt-rewriter/components/labs/questions/set-list.tsx
//
// 题目集列表 —— 常规题目 tab 的默认入口。
//   - 卡片网格:每个 QuestionSetHead 一卡(name / count / created_at / source_filename)
//   - 点击卡片进详情(set currentSetIdAtom)
//   - 操作:重命名 / 删除(右上角下拉,Hover 才显)
//   - 顶部"+ 新建题目集" = 上传 xlsx
//
// 数据走 GET /api/questions/sets,导入触发 questionsRefreshTickAtom bump → 自动重拉。

"use client";

import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  currentSetIdAtom,
  questionsRefreshTickAtom,
} from "@/lib/atoms-questions";
import type { QuestionSetHead } from "@/lib/questions/schema";

export function SetList() {
  const setCurrentSetId = useSetAtom(currentSetIdAtom);
  const refreshTick = useAtomValue(questionsRefreshTickAtom);
  const bumpRefreshTick = useSetAtom(questionsRefreshTickAtom);
  const [sets, setSets] = useState<QuestionSetHead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchSets() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/questions/sets");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as { sets: QuestionSetHead[] };
      setSets(json.sets);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  if (loading && sets.length === 0) {
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

  if (sets.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border-cream bg-ivory px-6 py-12 text-center">
        <p className="mb-1 font-serif text-[16px] text-near-black">
          还没有题目集
        </p>
        <p className="text-[13px] text-olive-gray">
          点右上 <b className="text-terracotta">+ 新建题目集</b> 上传一份 xlsx,
          会作为一个独立题目集存到 <code className="font-mono">data/labs/questions/sets/</code>。
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 text-[12.5px] text-stone-gray">
        共 {sets.length} 个题目集 · 点击卡片进入查看题目
      </p>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sets.map((s) => (
          <SetCard
            key={s.set_id}
            s={s}
            onOpen={() => setCurrentSetId(s.set_id)}
            onChanged={() => bumpRefreshTick((n: number) => n + 1)}
          />
        ))}
      </ul>
    </div>
  );
}

function SetCard({
  s,
  onOpen,
  onChanged,
}: {
  s: QuestionSetHead;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(s.name);
  const [busy, setBusy] = useState(false);
  const [opErr, setOpErr] = useState<string | null>(null);

  async function doRename() {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === s.name) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    setOpErr(null);
    try {
      const r = await fetch(
        `/api/questions/sets/${encodeURIComponent(s.set_id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        },
      );
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
      setRenaming(false);
      onChanged();
    } catch (e) {
      setOpErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (
      !window.confirm(
        `删除题目集 "${s.name}"?(${s.count} 道题会一起被删除,不可恢复)`,
      )
    )
      return;
    setBusy(true);
    setOpErr(null);
    try {
      const r = await fetch(
        `/api/questions/sets/${encodeURIComponent(s.set_id)}`,
        { method: "DELETE" },
      );
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
      onChanged();
    } catch (e) {
      setOpErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const created = new Date(s.created_at).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });

  return (
    <li className="group relative overflow-hidden rounded-lg border border-border-cream bg-ivory p-4 transition hover:border-warm-sand-dark hover:shadow-ring">
      {renaming ? (
        <div className="mb-2 flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doRename();
              if (e.key === "Escape") {
                setRenaming(false);
                setNewName(s.name);
              }
            }}
            autoFocus
            className="min-w-0 flex-1 rounded-md border border-terracotta bg-parchment/40 px-2 py-1 font-serif text-[16px] focus:outline-none"
          />
          <button
            onClick={doRename}
            disabled={busy}
            className="rounded-md bg-terracotta px-2 py-1 text-[11.5px] text-ivory hover:bg-terracotta/90"
          >
            保存
          </button>
          <button
            onClick={() => {
              setRenaming(false);
              setNewName(s.name);
            }}
            disabled={busy}
            className="rounded-md border border-border-cream bg-ivory px-2 py-1 text-[11.5px] text-olive-gray hover:bg-warm-sand/40"
          >
            取消
          </button>
        </div>
      ) : (
        <button
          onClick={onOpen}
          className="mb-1 block w-full text-left"
        >
          <h3 className="font-serif text-[16px] font-medium leading-tight text-near-black group-hover:text-terracotta">
            {s.name}
          </h3>
        </button>
      )}

      {s.description && (
        <p className="mb-2 line-clamp-2 text-[12.5px] leading-[1.5] text-olive-gray">
          {s.description}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded-md bg-warm-sand/60 px-2 py-0.5 font-mono text-near-black">
          {s.count} 题
        </span>
        {s.source_filename && (
          <span
            className="rounded-md bg-ivory px-2 py-0.5 font-mono text-stone-gray ring-1 ring-border-cream"
            title={s.source_filename}
          >
            {s.source_filename.length > 24
              ? s.source_filename.slice(0, 24) + "…"
              : s.source_filename}
          </span>
        )}
        <span className="font-mono text-stone-gray">{created}</span>
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={onOpen}
          className="rounded-md bg-terracotta/10 px-3 py-1 text-[12px] font-medium text-terracotta hover:bg-terracotta/20"
        >
          进入 →
        </button>
        <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
          {/* 下载 xlsx 备份(方案 A);如果该 set 没备份(404),浏览器会自动显示 JSON 错误 — short term 接受 */}
          <a
            href={`/api/questions/sets/${encodeURIComponent(s.set_id)}/xlsx`}
            download
            onClick={(e) => e.stopPropagation()}
            className="rounded-md border border-border-cream bg-ivory px-2 py-0.5 text-[11px] text-olive-gray hover:border-terracotta hover:text-terracotta"
            title="下载源 xlsx(导入时备份的副本)"
          >
            下载 xlsx
          </a>
          <button
            onClick={() => setRenaming(true)}
            disabled={busy}
            className="rounded-md border border-border-cream bg-ivory px-2 py-0.5 text-[11px] text-olive-gray hover:bg-warm-sand/40"
          >
            重命名
          </button>
          <button
            onClick={doDelete}
            disabled={busy}
            className="rounded-md border border-error-crimson/30 bg-ivory px-2 py-0.5 text-[11px] text-error-crimson hover:bg-error-crimson/10"
          >
            删除
          </button>
        </div>
      </div>

      {opErr && (
        <p className="mt-2 font-mono text-[10.5px] text-error-crimson">
          {opErr}
        </p>
      )}
    </li>
  );
}
