// prompt-rewriter/components/labs/pipeline/drawer/version-toolbar.tsx
//
// 紧凑版本管理条:版本下拉 + ✓激活 + 新建 + 重命名 + 删除 + saveStatus + 元信息。
// 用于 PipelineStrategyVerticalEditor 的两个 section(垂类标准 / 平台调性)各一行。
// 跟 VersionedEditor 顶部的"大块"版本管理头同款逻辑,只是布局压扁。

"use client";

import type { Index } from "@/lib/atoms-pipeline-strategies";
import { useMemo } from "react";

export type SaveStatus = "saved" | "saving" | "error";

export interface VersionToolbarProps {
  /** 标签前缀(例如 "垂类标准版本"),只是 placeholder 字符,实际下拉里已经带版本名 */
  label: string;
  index: Index;
  viewingId: string;
  busy: boolean;
  opError: string | null;
  saveStatus: SaveStatus;
  /** JSON 校验失败时显示更精准的 hint 文案;markdown 类填 false */
  jsonMode?: boolean;

  onChangeViewing: (id: string) => void;
  onActivate: () => void;
  onCreateNew: () => void;
  onRename: () => void;
  onDelete: () => void;
}

export function VersionToolbar({
  label,
  index,
  viewingId,
  busy,
  opError,
  saveStatus,
  jsonMode = false,
  onChangeViewing,
  onActivate,
  onCreateNew,
  onRename,
  onDelete,
}: VersionToolbarProps) {
  const active = index.active;
  const versions = index.versions;
  const isViewingActive = viewingId === active;
  const viewingMeta = useMemo(
    () => versions.find((v) => v.id === viewingId),
    [versions, viewingId],
  );

  return (
    <div className="mb-3 space-y-2 rounded-md border border-border-cream bg-parchment/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-serif text-[12px] text-olive-gray">{label}</span>
        <select
          value={viewingId}
          onChange={(e) => onChangeViewing(e.target.value)}
          disabled={busy || versions.length === 0}
          className="min-w-[180px] flex-1 rounded-md border border-border-cream bg-ivory px-2 py-1 font-mono text-[12px] text-near-black focus:outline-none disabled:opacity-60"
        >
          {versions.length === 0 && <option value="">(加载中…)</option>}
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.id === active ? "✓ " : "  "}
              {v.label} ({v.id})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onActivate}
          disabled={busy || isViewingActive}
          className="rounded-md bg-terracotta px-2.5 py-1 text-[11.5px] font-medium text-ivory transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isViewingActive ? "✓ 当前" : "设为当前"}
        </button>
        <button
          type="button"
          onClick={onCreateNew}
          disabled={busy}
          className="rounded-md border border-border-warm bg-ivory px-2.5 py-1 text-[11.5px] text-charcoal-warm transition hover:bg-warm-tea-deeper disabled:opacity-40"
        >
          + 新建
        </button>
        <button
          type="button"
          onClick={onRename}
          disabled={busy || !viewingMeta}
          className="rounded-md border border-border-warm bg-ivory px-2.5 py-1 text-[11.5px] text-charcoal-warm transition hover:bg-warm-tea-deeper disabled:opacity-40"
        >
          重命名
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy || isViewingActive || versions.length <= 1}
          className="rounded-md border border-border-warm bg-ivory px-2.5 py-1 text-[11.5px] text-charcoal-warm transition hover:bg-warm-tea-deeper disabled:opacity-40"
        >
          删除
        </button>
        <span className="ml-auto text-[11px]">
          {saveStatus === "saving" && (
            <span className="text-stone-gray">保存中…</span>
          )}
          {saveStatus === "saved" && (
            <span className="text-stone-gray">已保存 ✓</span>
          )}
          {saveStatus === "error" && (
            <span className="text-error-crimson">
              {jsonMode ? "JSON 不合法,未保存" : "保存失败"}
            </span>
          )}
        </span>
      </div>
      {(viewingMeta?.notes || !isViewingActive || opError) && (
        <p className="text-[11px] leading-[1.5] text-stone-gray">
          {!isViewingActive && (
            <span className="text-near-black">
              当前查看的不是 active 版本,改动只写回此版本本身。
            </span>
          )}
          {viewingMeta?.notes && (
            <span className="ml-1">· {viewingMeta.notes}</span>
          )}
          {opError && (
            <span className="ml-1 text-error-crimson">· 操作失败:{opError}</span>
          )}
        </p>
      )}
    </div>
  );
}
