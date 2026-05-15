// prompt-rewriter/components/labs/pipeline/drawer/pipeline-strategy-vertical-editor.tsx
//
// vertical 驱动的策略库编辑器(垂类标准 + 平台调性合并视图)。
// 用户先选 vertical,然后看到:
//   1. 该 vertical 的垂类通用标准(line-by-line 编辑)
//   2. parent_vertical = 该 vertical 的 平台列表(可展开编辑 tone[])
//
// Phase 2 后接入版本管理:vertical-standard / platform-tone 两个 namespace 各自带版本切换器,
// 放在对应 section 折叠展开区顶部。数据源走 Registry CRUD(useVersionedNamespace hook),
// 写盘到当前 viewingId(默认 = active)而非旧的兼容层。

"use client";

import { useMemo, useState } from "react";
import { MdPreview, MdViewSwitcher } from "@/components/drawer/md-preview";
import { WysiwygBulletEditor } from "./wysiwyg-bullet-editor";
import { InfoIcon } from "@/components/labs/pipeline/info-icon";
import {
  verticalIndexAtom,
  platformIndexAtom,
} from "@/lib/atoms-pipeline-strategies";
import { useVersionedNamespace } from "./use-versioned-namespace";
import { VersionToolbar } from "./version-toolbar";

const VERTICAL_OPTIONS: { id: string; label: string }[] = [
  { id: "ecommerce", label: "电商" },
  { id: "brand", label: "品牌" },
  { id: "social", label: "社媒" },
  { id: "other", label: "其他" },
];

type VerticalDict = Record<
  string,
  { label?: string; standards?: string[]; [k: string]: unknown }
>;
type PlatformDict = Record<
  string,
  {
    parent_vertical?: string;
    label?: string;
    tone?: string[];
    [k: string]: unknown;
  }
>;

export function PipelineStrategyVerticalEditor() {
  const verticalNs = useVersionedNamespace({
    ns: "vertical-standard",
    indexAtom: verticalIndexAtom,
    versionExt: "json",
  });
  const platformNs = useVersionedNamespace({
    ns: "platform-tone",
    indexAtom: platformIndexAtom,
    versionExt: "json",
  });

  const [selectedVertical, setSelectedVertical] = useState<string>("ecommerce");
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  // 两个 section 默认收纳起来,点 chevron 展开
  const [verticalOpen, setVerticalOpen] = useState<boolean>(false);
  const [platformOpen, setPlatformOpen] = useState<boolean>(false);
  // 编辑 / 预览 全局开关
  const [view, setView] = useState<"edit" | "preview">("preview");

  // 解析(失败兜底成空对象,避免渲染崩;切版本中拿不到内容时也走兜底)
  const vertical = useMemo<VerticalDict>(() => {
    try {
      const parsed = JSON.parse(verticalNs.content || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }, [verticalNs.content]);
  const platform = useMemo<PlatformDict>(() => {
    try {
      const parsed = JSON.parse(platformNs.content || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }, [platformNs.content]);

  // 派生:当前 vertical 下的 平台
  const platformsInVertical = useMemo(
    () =>
      Object.entries(platform)
        .filter(
          ([key, v]) =>
            !key.startsWith("_") && v.parent_vertical === selectedVertical,
        )
        .map(([key, v]) => ({
          key,
          label: v.label,
          tone: v.tone ?? [],
        })),
    [platform, selectedVertical],
  );

  // ─── 写回 hook content(自动 debounce PUT 到 viewingId)───
  function writeVertical(next: VerticalDict) {
    verticalNs.setContent(JSON.stringify(next, null, 2));
  }
  function writePlatform(next: PlatformDict) {
    platformNs.setContent(JSON.stringify(next, null, 2));
  }

  // ─── 垂类标准 mutation ───
  function ensureVerticalEntry(next: VerticalDict) {
    if (!next[selectedVertical]) {
      next[selectedVertical] = {
        label: VERTICAL_OPTIONS.find((o) => o.id === selectedVertical)?.label,
        standards: [],
      };
    }
    if (!Array.isArray(next[selectedVertical].standards)) {
      next[selectedVertical].standards = [];
    }
  }
  function setStandardsText(text: string) {
    const next: VerticalDict = JSON.parse(JSON.stringify(vertical));
    ensureVerticalEntry(next);
    next[selectedVertical].standards = text.split("\n");
    writeVertical(next);
  }

  // ─── 平台调性 mutation ───
  function setToneText(key: string, text: string) {
    const next: PlatformDict = JSON.parse(JSON.stringify(platform));
    if (!next[key]) return;
    next[key].tone = text.split("\n");
    writePlatform(next);
  }
  function addNewPlatform() {
    const rawKey = window.prompt(
      `在 vertical = ${selectedVertical} 下新建一个 平台,输入 key(SP1 也会按这个 key 输出 platform):`,
    );
    if (!rawKey?.trim()) return;
    const key = rawKey.trim();
    if (platform[key]) {
      window.alert(`platform "${key}" 已存在`);
      return;
    }
    const labelRaw = window.prompt("显示名(可选,SP2 注入时用作 label):", key);
    const next: PlatformDict = JSON.parse(JSON.stringify(platform));
    next[key] = {
      parent_vertical: selectedVertical,
      label: labelRaw?.trim() || key,
      tone: [],
    };
    writePlatform(next);
    setExpandedPlatform(key);
  }
  function removePlatform(key: string) {
    if (!window.confirm(`删除平台 "${key}"?该平台所有调性会一起删除。`))
      return;
    const next: PlatformDict = JSON.parse(JSON.stringify(platform));
    delete next[key];
    writePlatform(next);
    if (expandedPlatform === key) setExpandedPlatform(null);
  }

  const currentStandards = vertical[selectedVertical]?.standards ?? [];
  const currentStandardsText = currentStandards.join("\n");
  const currentStandardsCount = currentStandards.filter((s) => s.trim()).length;
  const currentVerticalLabel =
    vertical[selectedVertical]?.label ??
    VERTICAL_OPTIONS.find((o) => o.id === selectedVertical)?.label;

  return (
    <div className="flex h-full flex-col">
      {/* vertical 选择条 */}
      <div className="shrink-0 border-b border-border-cream px-8 py-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <div className="font-serif text-[15px] font-medium text-near-black">
              先选一个垂类 vertical
            </div>
            <InfoIcon hint="垂类标准跟平台调性强相关:SP2 跑批时先按 vertical 拉垂类通用标准,再按 platform 拉该 vertical 下对应的平台调性。展开任一 section 后,顶部的版本切换条决定当前编辑/查看的是哪一版。" />
          </div>
          <MdViewSwitcher view={view} onChange={setView} />
        </div>
        <div className="flex flex-wrap gap-2">
          {VERTICAL_OPTIONS.map((o) => {
            const active = o.id === selectedVertical;
            const count = Object.values(platform).filter(
              (v) => v.parent_vertical === o.id,
            ).length;
            return (
              <button
                key={o.id}
                onClick={() => {
                  setSelectedVertical(o.id);
                  setExpandedPlatform(null);
                }}
                className={`flex items-baseline gap-1.5 rounded-md border px-3 py-1.5 text-[13px] transition ${
                  active
                    ? "border-terracotta bg-warm-sand text-near-black shadow-ring"
                    : "border-border-cream bg-ivory text-olive-gray hover:bg-warm-sand/40"
                }`}
              >
                <span className="font-medium">{o.label}</span>
                <span className="font-mono text-[10.5px] text-stone-gray">
                  {o.id}
                </span>
                <span className="text-[10.5px] text-stone-gray">
                  · {count} 个 platform
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 垂类标准 (可折叠) */}
      <div className="shrink-0 border-b border-border-cream">
        <button
          onClick={() => setVerticalOpen((v) => !v)}
          className="flex w-full items-center justify-between px-8 py-4 text-left transition hover:bg-warm-sand/30"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-[12px] text-stone-gray">
              {verticalOpen ? "▾" : "▸"}
            </span>
            <h3 className="font-serif text-[15px] font-medium text-near-black">
              垂类通用标准
            </h3>
            <span className="font-mono text-[11.5px] text-stone-gray">
              vertical = {selectedVertical}
              {currentVerticalLabel && ` (${currentVerticalLabel})`}
            </span>
            <span className="text-[11.5px] text-stone-gray">
              · {currentStandardsCount} 条
            </span>
            <InfoIcon hint="注入到 SP2 user content 的 ## Vertical Standard 段落,每行会被加上 `- ` 前缀变成 bullet。改这里立刻对下一轮 SP2 改写生效。" />
          </div>
        </button>
        {verticalOpen && (
          <div className="px-8 pb-5">
            <VersionToolbar
              label="vertical_standard.json 版本"
              index={verticalNs.index}
              viewingId={verticalNs.viewingId}
              busy={verticalNs.busy}
              opError={verticalNs.opError}
              saveStatus={verticalNs.saveStatus}
              jsonMode
              onChangeViewing={verticalNs.setViewingId}
              onActivate={verticalNs.activate}
              onCreateNew={verticalNs.createNew}
              onRename={verticalNs.rename}
              onDelete={verticalNs.remove}
            />
            {view === "edit" ? (
              <textarea
                value={currentStandardsText}
                onChange={(e) => setStandardsText(e.target.value)}
                rows={8}
                placeholder="一行一条标准,SP2 注入时按行加 `- ` 前缀。空行会被过滤。"
                className="w-full resize-y rounded-md border border-border-cream bg-ivory px-3 py-2.5 font-mono text-[12.5px] leading-[1.7] text-near-black focus:border-terracotta focus:outline-none"
              />
            ) : (
              <WysiwygBulletEditor
                value={currentStandardsText}
                onChange={setStandardsText}
                placeholder="双击进入编辑,失焦自动保存"
              />
            )}
          </div>
        )}
      </div>

      {/* 平台调性 (可折叠,按 vertical 过滤) */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <button
          onClick={() => setPlatformOpen((v) => !v)}
          className="flex w-full items-center justify-between px-8 py-4 text-left transition hover:bg-warm-sand/30"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-[12px] text-stone-gray">
              {platformOpen ? "▾" : "▸"}
            </span>
            <h3 className="font-serif text-[15px] font-medium text-near-black">
              平台调性
            </h3>
            <span className="font-mono text-[11.5px] text-stone-gray">
              parent_vertical = {selectedVertical}
            </span>
            <span className="text-[11.5px] text-stone-gray">
              · {platformsInVertical.length} 个 platform
            </span>
            <InfoIcon hint="注入到 SP2 user content 的 ## Platform Tone 段落,按 platform 一对一拉取。每个平台可以单独展开编辑 tone[]。" />
          </div>
        </button>
        {platformOpen && (
          <div className="px-8 pb-5">
            <VersionToolbar
              label="platform_tone.json 版本"
              index={platformNs.index}
              viewingId={platformNs.viewingId}
              busy={platformNs.busy}
              opError={platformNs.opError}
              saveStatus={platformNs.saveStatus}
              jsonMode
              onChangeViewing={platformNs.setViewingId}
              onActivate={platformNs.activate}
              onCreateNew={platformNs.createNew}
              onRename={platformNs.rename}
              onDelete={platformNs.remove}
            />
            <div className="mb-3 flex justify-end">
              <button
                onClick={addNewPlatform}
                className="rounded-md border border-border-cream bg-parchment px-2.5 py-1 text-[11.5px] text-charcoal-warm transition hover:bg-warm-sand/40"
              >
                + 新平台
              </button>
            </div>
            <div className="space-y-2">
              {platformsInVertical.length === 0 ? (
                <div className="rounded-md border border-dashed border-border-cream bg-parchment/30 px-3 py-3 text-center text-[12px] text-stone-gray">
                  该垂类下还没有 平台
                </div>
              ) : (
                platformsInVertical.map(({ key, label, tone }) => {
                  const expanded = expandedPlatform === key;
                  return (
                    <div
                      key={key}
                      className="overflow-hidden rounded-md border border-border-cream bg-parchment/40"
                    >
                      <div className="flex items-center justify-between px-3 py-2">
                        <button
                          onClick={() =>
                            setExpandedPlatform(expanded ? null : key)
                          }
                          className="flex flex-1 items-baseline gap-2 text-left"
                        >
                          <span className="text-[12px] text-stone-gray">
                            {expanded ? "▾" : "▸"}
                          </span>
                          <span className="text-[13px] font-medium text-near-black">
                            {label || key}
                          </span>
                          <span className="font-mono text-[10.5px] text-stone-gray">
                            {key}
                          </span>
                          <span className="ml-auto pr-2 text-[11px] text-stone-gray">
                            {tone.filter((t) => t.trim()).length} 条
                          </span>
                        </button>
                        <button
                          onClick={() => removePlatform(key)}
                          className="ml-2 rounded-md px-2 py-1 text-[11px] text-stone-gray transition hover:bg-warm-sand/40 hover:text-error-crimson"
                        >
                          删除
                        </button>
                      </div>
                      {expanded && (
                        <div className="border-t border-border-cream bg-ivory px-3 py-3">
                          {view === "edit" ? (
                            <textarea
                              value={tone.join("\n")}
                              onChange={(e) => setToneText(key, e.target.value)}
                              rows={6}
                              placeholder="一行一条调性,SP2 注入时按行加 `- ` 前缀。空行会被过滤。"
                              className="w-full resize-y rounded-md border border-border-cream bg-ivory px-3 py-2.5 font-mono text-[12.5px] leading-[1.7] text-near-black focus:border-terracotta focus:outline-none"
                            />
                          ) : (
                            <WysiwygBulletEditor
                              value={tone.join("\n")}
                              onChange={(text) => setToneText(key, text)}
                              placeholder="双击进入编辑,失焦自动保存"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────── 把 textarea 文本预渲染成 SP2 注入形态的 markdown bullet list ───────────
// 跟 step-media-review.ts 里 `verticalLines.map(s => `- ${s}`)` 的处理一一对应,
// 用户在预览模式看到的就是 LLM 实际拿到的那行 markdown。
function textToBullets(text: string): string {
  const lines = text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (lines.length === 0) return "_(none for this task)_";
  return lines.map((s) => `- ${s}`).join("\n");
}
