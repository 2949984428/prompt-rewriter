// prompt-rewriter/components/drawer/skill-editor.tsx
"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  skillMdAtom,
  skillsIndexAtom,
  saveStatusAtom,
} from "@/lib/atoms";
import { SkillsIndexSchema, type SkillVersionMeta } from "@/lib/schema";
import { MdPreview, MdViewSwitcher } from "./md-preview";

/**
 * SkillEditor - skill.md 的版本化编辑器。
 *
 * 数据源:
 *   - skillsIndexAtom : 全部版本 + active 指针(bootstrap 拉,所有操作后刷新)
 *   - skillMdAtom     : 当前 active 版本的内容(rewrite 链路消费这个)
 *
 * 本地状态:
 *   - viewingId : 编辑器正在查看/编辑哪个版本(可以不是 active,用于对照 / 回滚准备)
 *   - md        : viewingId 的当前内容(独立于 skillMdAtom,避免污染 active)
 *
 * 同步规则:
 *   - 编辑 md 时防抖 PUT /api/skills/:viewingId
 *   - 若 viewingId === active,同时更新 skillMdAtom,让下一轮 rewrite 立刻跑新内容
 *   - 切换 viewingId 时重新拉 md
 *   - "设为当前版本"成功后,如果 viewingId 变成 active,把 md 同步到 skillMdAtom
 */
export function SkillEditor() {
  const [index, setIndex] = useAtom(skillsIndexAtom);
  const setActiveMd = useSetAtom(skillMdAtom);
  const activeMd = useAtomValue(skillMdAtom);
  const [status, setStatus] = useAtom(saveStatusAtom);

  const active = index.active;
  const versions = index.versions;

  // 当前编辑器聚焦的版本。默认等于 active,用户可以切到别的版本对照。
  const [viewingId, setViewingId] = useState<string>("");
  const [md, setMd] = useState<string>("");
  const [loadingMd, setLoadingMd] = useState(false);
  const [view, setView] = useState<"edit" | "preview">("preview");

  // 非 md 编辑的操作状态(创建/删除/激活/重命名)
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  // 首次拿到 index 后把 viewingId 初始化成 active
  useEffect(() => {
    if (!viewingId && active) {
      setViewingId(active);
    }
  }, [active, viewingId]);

  // 切版本时拉这个版本的 md
  const firstLoad = useRef(true);
  useEffect(() => {
    if (!viewingId) return;
    let cancelled = false;
    setLoadingMd(true);
    (async () => {
      try {
        // 如果看的就是 active,直接用 skillMdAtom 的内容(已经预加载过,避免重复请求)
        if (viewingId === active && activeMd) {
          if (!cancelled) setMd(activeMd);
          return;
        }
        const r = await fetch(`/api/skills/${encodeURIComponent(viewingId)}`);
        const text = await r.text();
        if (!cancelled) setMd(text);
      } catch (e) {
        console.warn("[skill-editor] load version failed:", e);
      } finally {
        if (!cancelled) {
          setLoadingMd(false);
          firstLoad.current = false;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // 注意:activeMd 的变化(例如其他地方修改)不触发重拉;只有 viewingId / active 切换时重拉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingId, active]);

  // md 防抖写盘(到 viewingId 对应的版本)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextWrite = useRef(false);

  useEffect(() => {
    if (!viewingId) return;
    // 切版本后首次 setMd(来自 GET 的回填)不应触发写盘
    if (firstLoad.current || loadingMd) return;
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setStatus("saving");
      try {
        const r = await fetch(`/api/skills/${encodeURIComponent(viewingId)}`, {
          method: "PUT",
          body: md,
        });
        setStatus(r.ok ? "saved" : "error");
        // 在编辑的是 active 版本,同步更新 skillMdAtom,让 rewrite 链路立刻用上
        if (r.ok && viewingId === active) {
          setActiveMd(md);
        }
      } catch {
        setStatus("error");
      }
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [md]);

  const viewingMeta: SkillVersionMeta | undefined = useMemo(
    () => versions.find((v) => v.id === viewingId),
    [versions, viewingId]
  );

  async function refreshIndex(): Promise<void> {
    const r = await fetch("/api/skills");
    const json = await r.json();
    setIndex(SkillsIndexSchema.parse(json));
  }

  async function activateViewing() {
    if (!viewingId || viewingId === active || busy) return;
    setBusy(true);
    setOpError(null);
    try {
      const r = await fetch(
        `/api/skills/${encodeURIComponent(viewingId)}/activate`,
        { method: "POST" }
      );
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "activate failed");
      }
      await refreshIndex();
      // active 换了 → 把当前 md 推给 skillMdAtom,让 rewrite 下一轮用上
      setActiveMd(md);
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createNew() {
    if (busy) return;
    const rawId = window.prompt(
      "新版本的 id(字母/数字/._-,会作为文件名):",
      `v${versions.length + 1}-draft`
    );
    if (!rawId) return;
    const id = rawId.trim();
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
      setOpError("id 只能是字母/数字/._-,且首字母非特殊符号");
      return;
    }
    const label = window.prompt(
      "这个版本的显示名(一句话,便于人识别):",
      id
    );
    if (!label) return;
    const notes = window.prompt("备注(可选,说明这版的迭代思路)", "") ?? "";
    const fromMode = window.confirm(
      `要不要从当前版本(${viewingId})复制内容作为起点?\n\n确定 = 复制 ${viewingId},取消 = 从空白开始`
    );

    setBusy(true);
    setOpError(null);
    try {
      const r = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          label: label.trim(),
          notes: notes.trim(),
          fromId: fromMode ? viewingId : undefined,
        }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "create failed");
      }
      await refreshIndex();
      setViewingId(id);
      firstLoad.current = true; // 让下一次 md 回填不触发写盘
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function renameViewing() {
    if (!viewingMeta || busy) return;
    const label = window.prompt("修改显示名:", viewingMeta.label);
    if (label === null) return;
    const notes = window.prompt("修改备注:", viewingMeta.notes);
    if (notes === null) return;

    setBusy(true);
    setOpError(null);
    try {
      const r = await fetch(`/api/skills/${encodeURIComponent(viewingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), notes: notes.trim() }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "rename failed");
      }
      await refreshIndex();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteViewing() {
    if (!viewingMeta || busy) return;
    if (viewingId === active) {
      setOpError("当前版本是 active,不能删。请先切到别的版本。");
      return;
    }
    if (versions.length <= 1) {
      setOpError("至少保留一个版本。");
      return;
    }
    const ok = window.confirm(
      `确定删除版本 "${viewingMeta.label}" (${viewingId})?\n\n内容文件会被连带删掉,无法通过 UI 恢复(磁盘备份请自行处理)。`
    );
    if (!ok) return;
    setBusy(true);
    setOpError(null);
    try {
      const r = await fetch(`/api/skills/${encodeURIComponent(viewingId)}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "delete failed");
      }
      await refreshIndex();
      setViewingId(active); // 删完回到 active
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const isViewingActive = viewingId === active;

  return (
    <div className="flex h-full flex-col">
      {/* 顶部:版本选择 + 操作条 */}
      <div className="border-b border-border-cream px-8 pt-6 pb-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="font-serif text-[13px] text-olive-gray">
            当前查看的版本
          </span>
          <select
            value={viewingId}
            onChange={(e) => setViewingId(e.target.value)}
            disabled={busy || versions.length === 0}
            className="min-w-[240px] flex-1 rounded-md border border-border-cream bg-ivory px-3 py-2 font-mono text-[13px] text-near-black shadow-ring focus:outline-none disabled:opacity-60"
          >
            {versions.length === 0 && <option value="">(加载中…)</option>}
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id === active ? "✓ " : "  "}
                {v.label} ({v.id})
              </option>
            ))}
          </select>
          <MdViewSwitcher view={view} onChange={setView} />
        </div>

        {/* 元信息 + 操作按钮 */}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <p className="flex-1 min-w-[260px] text-[12.5px] leading-[1.7] text-stone-gray">
            {viewingMeta?.notes || (
              <span className="italic opacity-70">(这个版本没写备注)</span>
            )}
            {viewingMeta?.createdAt && (
              <span className="ml-2 font-mono text-[11.5px] opacity-70">
                · 创建于 {formatDate(viewingMeta.createdAt)}
              </span>
            )}
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-[12px]">
            <button
              type="button"
              onClick={activateViewing}
              disabled={busy || isViewingActive}
              className="rounded-md bg-terracotta px-3 py-1.5 font-medium text-ivory transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isViewingActive ? "✓ 已是当前版本" : "设为当前版本"}
            </button>
            <button
              type="button"
              onClick={createNew}
              disabled={busy}
              className="rounded-md border border-border-warm bg-parchment px-3 py-1.5 text-charcoal-warm transition hover:bg-warm-tea-deeper disabled:opacity-40"
            >
              + 新建版本
            </button>
            <button
              type="button"
              onClick={renameViewing}
              disabled={busy || !viewingMeta}
              className="rounded-md border border-border-warm bg-parchment px-3 py-1.5 text-charcoal-warm transition hover:bg-warm-tea-deeper disabled:opacity-40"
            >
              重命名 / 备注
            </button>
            <button
              type="button"
              onClick={deleteViewing}
              disabled={busy || isViewingActive || versions.length <= 1}
              className="rounded-md border border-border-warm bg-parchment px-3 py-1.5 text-charcoal-warm transition hover:bg-warm-tea-deeper disabled:opacity-40"
            >
              删除
            </button>
          </div>
        </div>

        <p className="mt-3 text-[12px] leading-[1.7] text-stone-gray">
          这是给改写 AI 看的「总说明书」—— 定义 7 步流程怎么跑。
          <b className="text-near-black">只有「当前版本 ✓」的内容真正参与改写</b>,其他版本是你留着做对照和回滚的草稿。
          编辑会自动存到 <code className="font-mono">data/skills/{viewingId || "<id>"}.md</code>。
        </p>
        {opError && (
          <p className="mt-2 text-[12.5px] text-error-crimson">操作失败:{opError}</p>
        )}
      </div>

      {/* 下部:编辑 or 预览 */}
      {view === "edit" ? (
        <textarea
          value={md}
          onChange={(e) => setMd(e.target.value)}
          spellCheck={false}
          disabled={loadingMd || !viewingId}
          placeholder={
            viewingId
              ? loadingMd
                ? "载入中…"
                : "这个版本还是空的,从这里开始写…"
              : "先在上方选一个版本…"
          }
          className="mb-4 flex-1 resize-none border-b border-border-cream bg-ivory px-8 py-6 font-mono text-[14px] leading-[1.7] text-near-black focus:outline-none disabled:opacity-60"
        />
      ) : (
        <div className="mb-4 flex-1 overflow-y-auto border-b border-border-cream bg-ivory px-8 py-6">
          {loadingMd ? (
            <p className="text-[13px] italic text-stone-gray">载入中…</p>
          ) : (
            <MdPreview source={md} />
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border-cream px-8 py-4 text-[12px]">
        <span className="text-stone-gray">
          {isViewingActive ? (
            <>
              正在编辑 <b className="text-near-black">当前版本</b>,改动立刻影响下一轮改写
            </>
          ) : (
            <>
              正在编辑 <b className="text-near-black">非当前版本</b>,
              改动不影响现在的改写。想让它生效请点「设为当前版本」。
            </>
          )}
        </span>
        <span>
          {status === "saving" && <span className="text-stone-gray">保存中…</span>}
          {status === "saved" && <span className="text-stone-gray">已保存 ✓</span>}
          {status === "error" && (
            <span className="text-error-crimson">保存失败</span>
          )}
        </span>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch {
    return iso;
  }
}
