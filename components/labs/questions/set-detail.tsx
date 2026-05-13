// prompt-rewriter/components/labs/questions/set-detail.tsx
//
// 单个题目集详情页:返回按钮 + 题集元信息 + 列表 + 筛选 + 详情抽屉。
// 数据走 /api/questions/sets/<set_id>/questions(list)+ /questions/<qid>(详情/PATCH)。

"use client";

import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  questionsFilterL1Atom,
  questionsFilterL2Atom,
  questionsFilterQAtom,
  questionsFilterHasImagesAtom,
  questionsLimitAtom,
  questionsOffsetAtom,
  questionsSelectedQidAtom,
  questionsRefreshTickAtom,
  currentSetIdAtom,
} from "@/lib/atoms-questions";
import type {
  Question,
  QuestionHead,
  QuestionSetHead,
} from "@/lib/questions/schema";
import { copyImageToClipboard } from "@/lib/copy-image";

type CategoriesMeta = {
  l1: { name: string; count: number }[];
  l2_by_l1: Record<string, { name: string; count: number }[]>;
};

export function SetDetail({ setId }: { setId: string }) {
  const [l1, setL1] = useAtom(questionsFilterL1Atom);
  const [l2, setL2] = useAtom(questionsFilterL2Atom);
  const [q, setQ] = useAtom(questionsFilterQAtom);
  const [hasImages, setHasImages] = useAtom(questionsFilterHasImagesAtom);
  const [limit] = useAtom(questionsLimitAtom);
  const [offset, setOffset] = useAtom(questionsOffsetAtom);
  const [selectedQid, setSelectedQid] = useAtom(questionsSelectedQidAtom);
  const setCurrentSetId = useSetAtom(currentSetIdAtom);
  const refreshTick = useAtomValue(questionsRefreshTickAtom);

  const [items, setItems] = useState<QuestionHead[]>([]);
  const [total, setTotal] = useState(0);
  const [setHead, setSetHead] = useState<QuestionSetHead | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 本 set 内的 L1 / L2 字典(从所有题目算,只算一次)
  const [cats, setCats] = useState<CategoriesMeta>({ l1: [], l2_by_l1: {} });

  async function fetchList() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (l1) params.set("l1", l1);
      if (l2) params.set("l2", l2);
      if (q) params.set("q", q);
      if (hasImages !== "all")
        params.set("has_images", hasImages === "yes" ? "1" : "0");
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      const r = await fetch(
        `/api/questions/sets/${encodeURIComponent(setId)}/questions?${params}`,
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as {
        items: QuestionHead[];
        total: number;
        set_head: QuestionSetHead;
      };
      setItems(json.items);
      setTotal(json.total);
      setSetHead(json.set_head);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // 本 set 的 L1/L2 字典:再单独 GET 完整 set 算一次(数据本身已经在 server,简化:全量拿)
  // 为节省一次请求,可以在 list 接口里返回,但短期单 GET 也 OK
  async function fetchCats() {
    try {
      const r = await fetch(
        `/api/questions/sets/${encodeURIComponent(setId)}`,
      );
      if (!r.ok) return;
      const set = (await r.json()) as {
        questions: { categories: string[] }[];
      };
      const l1Count = new Map<string, number>();
      const l2Count = new Map<string, Map<string, number>>();
      for (const qq of set.questions) {
        const c1 = qq.categories[0];
        const c2 = qq.categories[1];
        if (c1) l1Count.set(c1, (l1Count.get(c1) ?? 0) + 1);
        if (c1 && c2) {
          if (!l2Count.has(c1)) l2Count.set(c1, new Map());
          const m = l2Count.get(c1)!;
          m.set(c2, (m.get(c2) ?? 0) + 1);
        }
      }
      const l1Arr = Array.from(l1Count.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
      const l2_by_l1: Record<string, { name: string; count: number }[]> = {};
      for (const [c1, m] of l2Count.entries()) {
        l2_by_l1[c1] = Array.from(m.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count);
      }
      setCats({ l1: l1Arr, l2_by_l1 });
    } catch {
      /* 静默,反正只是给筛选下拉用 */
    }
  }

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId, l1, l2, q, hasImages, limit, offset, refreshTick]);

  useEffect(() => {
    fetchCats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId, refreshTick]);

  useEffect(() => {
    // 进 set 时重置筛选,避免上一个 set 的 L1 在新 set 没有
    setL1("");
    setL2("");
    setQ("");
    setHasImages("all");
    setOffset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId]);

  useEffect(() => {
    if (l1 && l2 && !(cats.l2_by_l1[l1] ?? []).some((x) => x.name === l2)) {
      setL2("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l1, cats.l2_by_l1]);

  return (
    <div className="space-y-5">
      {/* 题集 breadcrumb + 元信息 */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-cream bg-ivory px-4 py-3">
        <button
          onClick={() => setCurrentSetId(null)}
          className="rounded-md border border-border-cream bg-ivory px-2.5 py-1 text-[12px] text-olive-gray hover:border-terracotta hover:text-terracotta"
        >
          ← 题目集列表
        </button>
        {setHead && (
          <>
            <span className="font-serif text-[15px] font-medium text-near-black">
              {setHead.name}
            </span>
            <span className="rounded-md bg-warm-sand/60 px-2 py-0.5 font-mono text-[11px] text-near-black">
              {setHead.count} 题
            </span>
            {setHead.source_filename && (
              <span
                className="rounded-md bg-ivory px-2 py-0.5 font-mono text-[10.5px] text-stone-gray ring-1 ring-border-cream"
                title={setHead.source_filename}
              >
                {setHead.source_filename.length > 30
                  ? setHead.source_filename.slice(0, 30) + "…"
                  : setHead.source_filename}
              </span>
            )}
            {/* 下载源 xlsx(方案 A 备份);没备份时点击会拿到 404 JSON,接受这个降级 */}
            <a
              href={`/api/questions/sets/${encodeURIComponent(setId)}/xlsx`}
              download
              className="ml-auto rounded-md border border-border-cream bg-ivory px-2.5 py-1 text-[11.5px] text-olive-gray hover:border-terracotta hover:text-terracotta"
              title="下载导入时的源 xlsx 备份"
            >
              ↓ 下载 xlsx
            </a>
          </>
        )}
      </div>

      <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-6">
        <aside className="space-y-6">
          <section>
            <h3 className="mb-2 px-1 font-sans text-[12px] font-semibold uppercase tracking-wide text-stone-gray">
              关键词
            </h3>
            <input
              type="text"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOffset(0);
              }}
              placeholder="qid 或题面…"
              className="w-full rounded-md border border-border-cream bg-ivory px-3 py-2 text-[13px] text-near-black placeholder:text-stone-gray focus:border-terracotta focus:outline-none"
            />
          </section>

          <section>
            <h3 className="mb-2 px-1 font-sans text-[12px] font-semibold uppercase tracking-wide text-stone-gray">
              L1 垂类
            </h3>
            <FilterChips
              options={[
                { name: "全部", count: setHead?.count ?? 0 },
                ...cats.l1,
              ]}
              value={l1 || "全部"}
              onChange={(v) => {
                setL1(v === "全部" ? "" : v);
                setOffset(0);
              }}
            />
          </section>

          {l1 && (cats.l2_by_l1[l1] ?? []).length > 0 && (
            <section>
              <h3 className="mb-2 px-1 font-sans text-[12px] font-semibold uppercase tracking-wide text-stone-gray">
                L2 子类
              </h3>
              <FilterChips
                options={[
                  { name: "全部", count: 0 },
                  ...(cats.l2_by_l1[l1] ?? []),
                ]}
                value={l2 || "全部"}
                onChange={(v) => {
                  setL2(v === "全部" ? "" : v);
                  setOffset(0);
                }}
              />
            </section>
          )}

          <section>
            <h3 className="mb-2 px-1 font-sans text-[12px] font-semibold uppercase tracking-wide text-stone-gray">
              图片
            </h3>
            <div className="flex gap-1.5">
              {(["all", "yes", "no"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setHasImages(v);
                    setOffset(0);
                  }}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-[12px] transition ${
                    hasImages === v
                      ? "border-terracotta bg-terracotta/10 text-near-black"
                      : "border-border-cream bg-ivory text-olive-gray hover:bg-warm-sand/40"
                  }`}
                >
                  {v === "all" ? "全部" : v === "yes" ? "含图" : "纯文"}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section>
          {error && (
            <div className="mb-3 rounded-md border border-error-crimson/30 bg-error-crimson/5 px-3 py-2 text-[13px] text-error-crimson">
              {error}
            </div>
          )}
          {loading && items.length === 0 ? (
            <div className="rounded-md border border-border-cream bg-ivory px-4 py-8 text-center text-[13px] text-stone-gray">
              载入中…
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-md border border-dashed border-border-cream bg-ivory px-6 py-12 text-center">
              <p className="text-[13px] text-olive-gray">
                没有匹配的题目,清掉过滤条件试试。
              </p>
            </div>
          ) : (
            <>
              <p className="mb-3 text-[12.5px] text-stone-gray">
                共 {total} 条匹配,显示 {offset + 1}–
                {Math.min(offset + items.length, total)}
              </p>
              <ul className="space-y-2.5">
                {items.map((h) => (
                  <QuestionRow
                    key={h.qid}
                    h={h}
                    onOpen={() => setSelectedQid(h.qid)}
                  />
                ))}
              </ul>
              <div className="mt-5 flex items-center justify-between text-[12.5px]">
                <button
                  disabled={offset <= 0}
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  className="rounded-md border border-border-cream bg-ivory px-3 py-1.5 text-olive-gray hover:bg-warm-sand/40 disabled:opacity-40"
                >
                  ← 上一页
                </button>
                <span className="text-stone-gray">
                  {Math.floor(offset / limit) + 1} /{" "}
                  {Math.max(1, Math.ceil(total / limit))}
                </span>
                <button
                  disabled={offset + limit >= total}
                  onClick={() => setOffset(offset + limit)}
                  className="rounded-md border border-border-cream bg-ivory px-3 py-1.5 text-olive-gray hover:bg-warm-sand/40 disabled:opacity-40"
                >
                  下一页 →
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      {selectedQid && (
        <QuestionDetailPanel
          setId={setId}
          qid={selectedQid}
          onClose={() => setSelectedQid(null)}
          onAfterPatch={fetchList}
        />
      )}
    </div>
  );
}

// ─────────── L1 / L2 chip 列表 ───────────

function FilterChips({
  options,
  value,
  onChange,
}: {
  options: { name: string; count: number }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {options.map((o) => {
        const active = o.name === value;
        return (
          <li key={o.name}>
            <button
              onClick={() => onChange(o.name)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-[13px] transition ${
                active
                  ? "bg-warm-sand font-medium text-near-black shadow-ring"
                  : "text-olive-gray hover:bg-warm-sand/40 hover:text-near-black"
              }`}
            >
              <span className="truncate">{o.name}</span>
              {o.count > 0 && (
                <span className="ml-2 font-mono text-[10.5px] text-stone-gray">
                  {o.count}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ─────────── 列表行 ───────────

function QuestionRow({
  h,
  onOpen,
}: {
  h: QuestionHead;
  onOpen: () => void;
}) {
  return (
    <li
      onClick={onOpen}
      className="cursor-pointer rounded-lg border border-border-cream bg-ivory px-4 py-3 transition hover:border-warm-sand-dark hover:shadow-ring"
    >
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="shrink-0 font-mono text-[11px] text-stone-gray">
          {h.qid}
        </span>
        {h.has_images && (
          <span className="rounded bg-warm-gold-bg px-1.5 py-0.5 font-mono text-[10px] text-warm-gold-fg">
            +{h.image_count} 图
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-1">
          {h.categories.map((c) => (
            <span
              key={c}
              className="rounded-md bg-warm-sand/50 px-2 py-0.5 font-mono text-[10.5px] text-near-black"
            >
              {c}
            </span>
          ))}
        </div>
      </div>
      <p className="line-clamp-2 text-[13.5px] leading-[1.5] text-near-black">
        {h.text_preview || (
          <span className="italic text-stone-gray">(无文本)</span>
        )}
      </p>
      {h.tags.length > 0 && (
        <div className="mt-1.5 flex gap-1">
          {h.tags.map((t) => (
            <span key={t} className="font-mono text-[10.5px] text-terracotta">
              #{t}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

// ─────────── 详情抽屉 ───────────

function QuestionDetailPanel({
  setId,
  qid,
  onClose,
  onAfterPatch,
}: {
  setId: string;
  qid: string;
  onClose: () => void;
  onAfterPatch: () => void;
}) {
  const [q, setQ] = useState<Question | null>(null);
  const [tagsInput, setTagsInput] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedTip, setSavedTip] = useState("");
  const bumpRefreshTick = useSetAtom(questionsRefreshTickAtom);

  useEffect(() => {
    (async () => {
      const r = await fetch(
        `/api/questions/sets/${encodeURIComponent(setId)}/questions/${encodeURIComponent(qid)}`,
      );
      if (r.ok) {
        const data = (await r.json()) as Question;
        setQ(data);
        setTagsInput(data.tags.join(", "));
        setNote(data.note);
      }
    })();
  }, [setId, qid]);

  async function save() {
    if (!q) return;
    setSaving(true);
    setSavedTip("");
    try {
      const tags = tagsInput
        .split(/[,,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const r = await fetch(
        `/api/questions/sets/${encodeURIComponent(setId)}/questions/${encodeURIComponent(qid)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags, note }),
        },
      );
      if (!r.ok) throw new Error((await r.json()).error);
      setSavedTip("✓ 已保存");
      onAfterPatch();
      bumpRefreshTick((n: number) => n + 1);
      setTimeout(() => setSavedTip(""), 2000);
    } catch (e) {
      setSavedTip("✗ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  async function copyAllText() {
    if (!q) return;
    const text = q.input_content
      .filter((b) => b.type === "text")
      .map((b) => b.content)
      .join("\n\n");
    await navigator.clipboard.writeText(text);
    setSavedTip("✓ 已复制全部文本到剪贴板");
    setTimeout(() => setSavedTip(""), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-near-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <aside
        className="absolute right-0 top-0 flex h-full w-[min(720px,96vw)] flex-col overflow-y-auto border-l border-border-cream bg-ivory"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-border-cream px-7 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="mb-0.5 font-mono text-[11.5px] text-stone-gray">
                {qid}
              </p>
              <h2 className="font-serif text-[18px] font-medium text-near-black">
                题目详情
              </h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-stone-gray hover:bg-warm-sand/40 hover:text-near-black"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
          {q?.categories.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {q.categories.map((c) => (
                <span
                  key={c}
                  className="rounded-md bg-warm-sand/50 px-2 py-0.5 font-mono text-[11px] text-near-black"
                >
                  {c}
                </span>
              ))}
            </div>
          ) : null}
        </header>

        <div className="flex-1 space-y-6 px-7 py-5">
          {!q ? (
            <p className="text-[13px] text-stone-gray">载入中…</p>
          ) : (
            <>
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-sans text-[12px] font-semibold uppercase tracking-wide text-stone-gray">
                    input_content ({q.input_content.length} 段)
                  </h3>
                  <button
                    onClick={copyAllText}
                    className="rounded-md border border-border-cream bg-ivory px-2.5 py-1 text-[11.5px] text-olive-gray hover:bg-warm-sand/40"
                  >
                    复制全部文本
                  </button>
                </div>
                <ul className="space-y-2.5">
                  {q.input_content.map((b, i) => (
                    <li
                      key={i}
                      className="rounded-md border border-border-cream bg-parchment/50 px-3 py-2.5"
                    >
                      <span className="mb-1 inline-block font-mono text-[10.5px] uppercase tracking-wide text-stone-gray">
                        #{i + 1} · {b.type}
                      </span>
                      {b.type === "text" ? (
                        <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] leading-[1.55] text-near-black">
                          {b.content}
                        </pre>
                      ) : (
                        <ImageBlock url={b.content} />
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="mb-2 font-sans text-[12px] font-semibold uppercase tracking-wide text-stone-gray">
                  备注
                </h3>
                <label className="mb-1.5 block text-[12px] text-olive-gray">
                  Tags(逗号分隔)
                </label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="golden, baseline, demo-T1…"
                  className="mb-3 w-full rounded-md border border-border-cream bg-parchment/50 px-3 py-1.5 font-mono text-[12.5px] focus:border-terracotta focus:outline-none"
                />
                <label className="mb-1.5 block text-[12px] text-olive-gray">
                  Note
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="(可选)这条题目的备注..."
                  className="w-full rounded-md border border-border-cream bg-parchment/50 px-3 py-2 text-[13px] focus:border-terracotta focus:outline-none"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={save}
                    disabled={saving}
                    className="rounded-md bg-terracotta px-3.5 py-1.5 text-[12.5px] font-medium text-ivory hover:bg-terracotta/90 disabled:opacity-40"
                  >
                    {saving ? "保存中…" : "保存"}
                  </button>
                  {savedTip && (
                    <span className="font-mono text-[11.5px] text-olive-gray">
                      {savedTip}
                    </span>
                  )}
                </div>
              </section>

              <details className="rounded-md border border-border-cream bg-parchment/30 px-3 py-2">
                <summary className="cursor-pointer select-none font-mono text-[11.5px] uppercase tracking-wide text-stone-gray">
                  raw JSON
                </summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.5] text-olive-gray">
                  {JSON.stringify(q, null, 2)}
                </pre>
              </details>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function ImageBlock({ url }: { url: string }) {
  const isHttpUrl = /^https?:\/\//.test(url);
  const isDataUrl = /^data:image\//.test(url);
  const isImagePlaceholder = /^\[@image:/.test(url);
  if (isImagePlaceholder) {
    return (
      <code className="block break-all rounded bg-warm-sand/30 px-2 py-1 font-mono text-[12px] text-olive-gray">
        {url}
      </code>
    );
  }
  if (isHttpUrl || isDataUrl) {
    return (
      <div className="space-y-2">
        <a href={url} target="_blank" rel="noreferrer" className="inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            className="max-h-[200px] max-w-full rounded border border-border-cream"
          />
        </a>
        <ImageActions url={url} />
      </div>
    );
  }
  return (
    <code className="block break-all font-mono text-[12px] text-olive-gray">
      {url}
    </code>
  );
}

// 复制图片像素 + 复制 URL 两个动作。data URL 也支持复制 URL(粘贴出来就是 base64 数据)
function ImageActions({ url }: { url: string }) {
  const [imgState, setImgState] = useState<"idle" | "copied" | "error">("idle");
  const [urlState, setUrlState] = useState<"idle" | "copied" | "error">("idle");
  const onCopyImage = async () => {
    try {
      await copyImageToClipboard(url);
      setImgState("copied");
      setTimeout(() => setImgState("idle"), 1500);
    } catch {
      setImgState("error");
      setTimeout(() => setImgState("idle"), 2000);
    }
  };
  const onCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setUrlState("copied");
      setTimeout(() => setUrlState("idle"), 1500);
    } catch {
      setUrlState("error");
      setTimeout(() => setUrlState("idle"), 2000);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={onCopyImage}
        className={`rounded-md border border-border-cream px-2 py-0.5 text-[11px] transition ${
          imgState === "copied"
            ? "bg-warm-gold-bg text-warm-gold-fg"
            : imgState === "error"
              ? "bg-coral-soft-bg text-error-crimson"
              : "bg-ivory text-olive-gray hover:bg-warm-sand/40"
        }`}
      >
        {imgState === "copied" ? "✓ 已复制图片" : imgState === "error" ? "复制失败" : "📋 复制图片"}
      </button>
      <button
        type="button"
        onClick={onCopyUrl}
        className={`rounded-md border border-border-cream px-2 py-0.5 text-[11px] transition ${
          urlState === "copied"
            ? "bg-warm-gold-bg text-warm-gold-fg"
            : urlState === "error"
              ? "bg-coral-soft-bg text-error-crimson"
              : "bg-ivory text-olive-gray hover:bg-warm-sand/40"
        }`}
      >
        {urlState === "copied" ? "✓ 已复制 URL" : urlState === "error" ? "复制失败" : "🔗 复制 URL"}
      </button>
    </div>
  );
}
