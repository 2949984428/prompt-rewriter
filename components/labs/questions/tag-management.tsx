// prompt-rewriter/components/labs/questions/tag-management.tsx
//
// 标签管理 tab:
//   - 顶部:总览(N 个 tag · M 题打了 tag)
//   - 列表:每个 tag 一行(name / count / 关联 qids 折叠 / 重命名 / 删除)
//   - 操作:
//     · 重命名 → 调 PATCH /api/questions/tags/<old> body { rename_to }
//     · 删除   → 调 DELETE /api/questions/tags/<old>(从所有题目移除)
//     · 行可展开看用到这个 tag 的 qid 列表(点击跳到常规题目筛选)

"use client";

import { useEffect, useState } from "react";
import { useSetAtom, useAtomValue } from "jotai";
import {
  questionsFilterQAtom,
  questionsSelectedQidAtom,
  questionsLabTabAtom,
  questionsRefreshTickAtom,
  currentSetIdAtom,
} from "@/lib/atoms-questions";

type TagStat = { name: string; count: number; qids: string[] };

export function TagManagement() {
  const [tags, setTags] = useState<TagStat[]>([]);
  const [taggedCount, setTaggedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const refreshTick = useAtomValue(questionsRefreshTickAtom);

  async function fetchTags() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/questions/tags");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as {
        tags: TagStat[];
        total_tagged_questions: number;
      };
      setTags(json.tags);
      setTaggedCount(json.total_tagged_questions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // 监听 refreshTick:导入 / tag rename / tag delete 后,父级 ImportButton 或本组件的操作会 bump tick,触发重拉
  useEffect(() => {
    fetchTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  const visible = filter
    ? tags.filter((t) =>
        t.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : tags;

  return (
    <div className="space-y-5">
      {/* 顶部总览 */}
      <header className="flex flex-wrap items-center gap-3 rounded-lg border border-border-cream bg-ivory px-5 py-4">
        <div className="flex flex-col">
          <span className="font-serif text-[18px] font-medium text-near-black">
            {tags.length} 个标签
          </span>
          <span className="text-[12px] text-olive-gray">
            {taggedCount} 题已打标签
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="过滤标签…"
            className="w-[200px] rounded-md border border-border-cream bg-parchment/40 px-3 py-1.5 text-[12.5px] focus:border-terracotta focus:outline-none"
          />
          <button
            onClick={fetchTags}
            disabled={loading}
            className="rounded-md border border-border-cream bg-ivory px-3 py-1.5 text-[12px] text-olive-gray hover:bg-warm-sand/40"
          >
            {loading ? "..." : "刷新"}
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-error-crimson/30 bg-error-crimson/5 px-3 py-2 text-[13px] text-error-crimson">
          {error}
        </div>
      )}

      {!loading && visible.length === 0 ? (
        <EmptyTagState />
      ) : (
        <ul className="space-y-2">
          {visible.map((t) => (
            <TagRow key={t.name} tag={t} onChanged={fetchTags} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TagRow({
  tag,
  onChanged,
}: {
  tag: TagStat;
  onChanged: () => void;
}) {
  const setLabTab = useSetAtom(questionsLabTabAtom);
  const setFilterQ = useSetAtom(questionsFilterQAtom);
  const setSelectedQid = useSetAtom(questionsSelectedQidAtom);
  const setCurrentSetId = useSetAtom(currentSetIdAtom);
  // rename / delete 后通知所有 tab 重拉(常规题目卡片上的 #tag chip 也会变)
  const bumpRefreshTick = useSetAtom(questionsRefreshTickAtom);

  const [expand, setExpand] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(tag.name);
  const [busy, setBusy] = useState(false);
  const [opErr, setOpErr] = useState<string | null>(null);

  async function doRename() {
    setOpErr(null);
    const trimmed = newName.trim();
    if (!trimmed || trimmed === tag.name) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(
        `/api/questions/tags/${encodeURIComponent(tag.name)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rename_to: trimmed }),
        },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setRenaming(false);
      onChanged();
      bumpRefreshTick((n) => n + 1);
    } catch (e) {
      setOpErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (
      !window.confirm(
        `从所有题目里移除标签 "${tag.name}"?(${tag.count} 题受影响)`,
      )
    )
      return;
    setBusy(true);
    setOpErr(null);
    try {
      const r = await fetch(
        `/api/questions/tags/${encodeURIComponent(tag.name)}`,
        { method: "DELETE" },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      onChanged();
      bumpRefreshTick((n) => n + 1);
    } catch (e) {
      setOpErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function jumpToQuestion(compositeKey: string) {
    // qids 字段 = "set_id::qid" 复合 key,split 出来分别 set
    const sep = compositeKey.indexOf("::");
    if (sep < 0) {
      // 旧数据兼容(没 set_id),只 setSelectedQid
      setSelectedQid(compositeKey);
    } else {
      const setId = compositeKey.slice(0, sep);
      const qid = compositeKey.slice(sep + 2);
      setCurrentSetId(setId);
      setSelectedQid(qid);
    }
    setLabTab("regular");
  }

  function jumpToSearch() {
    // 用关键词 = tag 名跳过去(粗略筛选,反正常规题目 row 上会显示 #tag)
    setFilterQ(tag.name);
    setLabTab("regular");
  }

  return (
    <li className="overflow-hidden rounded-lg border border-border-cream bg-ivory">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpand((v) => !v)}
          className="font-mono text-[10.5px] text-stone-gray hover:text-near-black"
          aria-label="展开"
        >
          {expand ? "▾" : "▸"}
        </button>
        {renaming ? (
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doRename();
              if (e.key === "Escape") {
                setRenaming(false);
                setNewName(tag.name);
              }
            }}
            autoFocus
            className="rounded-md border border-terracotta bg-parchment/40 px-2 py-1 font-mono text-[13px] text-terracotta focus:outline-none"
          />
        ) : (
          <span className="font-mono text-[13.5px] font-medium text-terracotta">
            #{tag.name}
          </span>
        )}
        <span className="rounded-md bg-warm-sand/50 px-2 py-0.5 font-mono text-[10.5px] text-near-black">
          {tag.count} 题
        </span>
        <div className="ml-auto flex items-center gap-1.5 text-[12px]">
          {renaming ? (
            <>
              <button
                onClick={doRename}
                disabled={busy}
                className="rounded-md bg-terracotta px-2.5 py-1 text-ivory hover:bg-terracotta/90 disabled:opacity-40"
              >
                保存
              </button>
              <button
                onClick={() => {
                  setRenaming(false);
                  setNewName(tag.name);
                  setOpErr(null);
                }}
                disabled={busy}
                className="rounded-md border border-border-cream bg-ivory px-2.5 py-1 text-olive-gray hover:bg-warm-sand/40"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <button
                onClick={jumpToSearch}
                className="rounded-md border border-border-cream bg-ivory px-2.5 py-1 text-olive-gray hover:bg-warm-sand/40"
                title="跳到常规题目用此 tag 作关键词筛选"
              >
                筛选
              </button>
              <button
                onClick={() => setRenaming(true)}
                disabled={busy}
                className="rounded-md border border-border-cream bg-ivory px-2.5 py-1 text-olive-gray hover:bg-warm-sand/40"
              >
                重命名
              </button>
              <button
                onClick={doDelete}
                disabled={busy}
                className="rounded-md border border-error-crimson/30 bg-ivory px-2.5 py-1 text-error-crimson hover:bg-error-crimson/10 disabled:opacity-40"
              >
                删除
              </button>
            </>
          )}
        </div>
      </div>
      {opErr && (
        <div className="border-t border-border-cream bg-error-crimson/5 px-4 py-2 text-[11.5px] text-error-crimson">
          {opErr}
        </div>
      )}
      {expand && (
        <div className="border-t border-border-cream bg-parchment/30 px-4 py-3">
          <p className="mb-2 font-sans text-[11.5px] uppercase tracking-wide text-stone-gray">
            用到此标签的 {tag.qids.length} 题(点击进入详情)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {tag.qids.map((qid) => (
              <button
                key={qid}
                onClick={() => jumpToQuestion(qid)}
                className="rounded-md border border-border-cream bg-ivory px-2 py-0.5 font-mono text-[11px] text-near-black hover:border-terracotta hover:text-terracotta"
              >
                {qid}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

function EmptyTagState() {
  return (
    <div className="rounded-md border border-dashed border-border-cream bg-ivory px-6 py-12 text-center">
      <p className="mb-1 font-serif text-[16px] text-near-black">
        还没有标签
      </p>
      <p className="text-[13px] text-olive-gray">
        在 <b>常规题目</b> 标签页点击题目卡片,在右侧抽屉给题目加 tags(逗号分隔)。
      </p>
    </div>
  );
}
