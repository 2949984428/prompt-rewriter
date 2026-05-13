// prompt-rewriter/components/labs/pipeline/drawer/versioned-editor.tsx
//
// Phase 2 抽屉的通用版本化编辑器(单 namespace,适用 SP1 / SP2 改写 SP 这种"一个文件一个版本"场景)。
// 策略库走 master/detail 的 PipelineStrategyVerticalEditor,不用这个组件;但二者**共用** useVersionedNamespace
// hook + VersionToolbar,版本管理 UX 完全一致。
//
// 布局:
//   [标题 + InfoIcon][编辑/预览切换]
//   [VersionToolbar:版本下拉 + 4 按钮 + saveStatus]
//   ────────────────
//   [textarea(edit)  /  MdPreview(preview)]

"use client";

import type { PrimitiveAtom } from "jotai";
import { useState } from "react";
import {
  type Index,
} from "@/lib/atoms-pipeline-strategies";
import { MdPreview, MdViewSwitcher } from "@/components/drawer/md-preview";
import { InfoIcon } from "@/components/labs/pipeline/info-icon";
import { useVersionedNamespace } from "./use-versioned-namespace";
import { VersionToolbar } from "./version-toolbar";

export interface VersionedEditorProps {
  ns:
    | "vertical-standard"
    | "platform-tone"
    | "sp-classification"
    | "sp-rewrite"
    | "sp-creation-planner";
  indexAtom: PrimitiveAtom<Index>;
  /** json 类落盘前做 JSON.parse 客户端预检 + 编辑器没有 markdown preview */
  versionExt: "json" | "md";
  title: string;
  hint: React.ReactNode;
  /** 编辑器底部帮助文案里的相对路径,例如 "data/labs/pipeline/sps/classification/<vN>.md" */
  pathTemplate: string;
}

export function VersionedEditor({
  ns,
  indexAtom,
  versionExt,
  title,
  hint,
  pathTemplate,
}: VersionedEditorProps) {
  const nsState = useVersionedNamespace({ ns, indexAtom, versionExt });
  const [view, setView] = useState<"edit" | "preview">(
    versionExt === "md" ? "preview" : "edit",
  );

  const resolvedPath = pathTemplate.replace(
    "<vN>",
    nsState.viewingId || "<vN>",
  );
  const versionLabel =
    versionExt === "json"
      ? `${ns} JSON 版本`
      : `${ns} markdown 版本`;

  return (
    <div className="flex h-full flex-col">
      {/* 顶部:标题 + InfoIcon + 编辑/预览切换 */}
      <div className="shrink-0 border-b border-border-cream px-8 pt-6 pb-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <h3 className="font-serif text-[17px] font-medium text-near-black">
              {title}
            </h3>
            <InfoIcon hint={hint} />
          </div>
          {versionExt === "md" && (
            <MdViewSwitcher view={view} onChange={setView} />
          )}
        </div>

        <VersionToolbar
          label={versionLabel}
          index={nsState.index}
          viewingId={nsState.viewingId}
          busy={nsState.busy}
          opError={nsState.opError}
          saveStatus={nsState.saveStatus}
          jsonMode={versionExt === "json"}
          onChangeViewing={nsState.setViewingId}
          onActivate={nsState.activate}
          onCreateNew={nsState.createNew}
          onRename={nsState.rename}
          onDelete={nsState.remove}
        />

        <p className="text-[11.5px] leading-[1.6] text-stone-gray">
          <b className="text-near-black">只有「当前 ✓」真正参与下一轮跑批</b>
          。其他版本是草稿,用来对照与回滚。改完
          <b className="ml-0.5 text-near-black">无需重启</b>,下一轮跑批立刻生效。
          编辑会自动存到 <code className="font-mono">{resolvedPath}</code>。
        </p>
      </div>

      {/* 编辑 / 预览区 */}
      {versionExt === "md" && view === "preview" ? (
        <div className="flex-1 overflow-y-auto bg-ivory px-8 py-6">
          {nsState.loading ? (
            <p className="text-[13px] italic text-stone-gray">载入中…</p>
          ) : (
            <MdPreview source={nsState.content} />
          )}
        </div>
      ) : (
        <textarea
          value={nsState.content}
          onChange={(e) => nsState.setContent(e.target.value)}
          spellCheck={false}
          disabled={nsState.loading || !nsState.viewingId}
          placeholder={
            nsState.viewingId
              ? nsState.loading
                ? "载入中…"
                : versionExt === "json"
                  ? "{}"
                  : "这个版本还是空的,从这里开始写…"
              : "先在上方选一个版本…"
          }
          className="flex-1 resize-none bg-ivory px-8 py-6 font-mono text-[13px] leading-[1.7] text-near-black focus:outline-none disabled:opacity-60"
        />
      )}
    </div>
  );
}
