// prompt-rewriter/components/labs/format/drawer/format-skill-editor.tsx
//
// 格式 skill 编辑器:dropdown 选 N 份格式之一 → 拉对应 md → textarea 编辑 / markdown 预览
// → debounce PUT 落盘。改完即时生效,下次跑批自动用新版本。
//
// 与 rewrite lab 的 SkillEditor 共享 MdPreview / MdViewSwitcher,保持两台实验台
// 设置面板的视觉一致(都是默认开预览,需要改字时才切到 edit)。

"use client";

import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { formatSkillsAtom } from "@/lib/atoms-format";
import { MdPreview, MdViewSwitcher } from "@/components/drawer/md-preview";

export function FormatSkillEditor() {
  const skills = useAtomValue(formatSkillsAtom);
  const [activeId, setActiveId] = useState<string>("");
  const [md, setMd] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("idle");
  const [view, setView] = useState<"edit" | "preview">("preview");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstLoad = useRef(true);

  // 默认选第一个
  useEffect(() => {
    if (!activeId && skills.length > 0) setActiveId(skills[0].id);
  }, [skills, activeId]);

  // 切换版本时拉 md
  useEffect(() => {
    if (!activeId) return;
    setStatus("loading");
    firstLoad.current = true;
    fetch(`/api/labs/format/skill/${encodeURIComponent(activeId)}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((text) => {
        setMd(text);
        setStatus("idle");
      })
      .catch((e) => {
        console.warn("[skill-editor] load failed", e);
        setStatus("error");
      });
  }, [activeId]);

  // debounce 写盘 (跳过首次加载,避免覆盖)
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    if (!activeId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setStatus("saving");
      try {
        const r = await fetch(`/api/labs/format/skill/${encodeURIComponent(activeId)}`, {
          method: "PUT",
          body: md,
        });
        setStatus(r.ok ? "saved" : "error");
      } catch {
        setStatus("error");
      }
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [md]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border-cream px-6 py-3">
        <p className="text-[13px] text-stone-gray">
          切换格式查看 / 编辑该格式的元启发。改完即时生效,下次跑批自动加载。
        </p>
        <div className="mt-2 flex items-center gap-2">
          <select
            value={activeId}
            onChange={(e) => setActiveId(e.target.value)}
            className="flex-1 min-w-0 rounded-sm border border-border-cream bg-ivory px-2 py-1.5 font-mono text-[13px] text-near-black focus:outline-none focus:border-coral"
          >
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <MdViewSwitcher view={view} onChange={setView} />
        </div>
      </div>

      {/* 编辑 or 预览。预览用 MdPreview(GFM + frontmatter 高亮 + prose 暖色样式),
          与 rewrite lab 设置面板对齐 */}
      {view === "edit" ? (
        <textarea
          value={md}
          onChange={(e) => setMd(e.target.value)}
          spellCheck={false}
          disabled={status === "loading"}
          placeholder={status === "loading" ? "载入中…" : ""}
          className="m-6 flex-1 resize-none rounded-md bg-ivory p-4 font-mono text-[13px] leading-[1.6] text-near-black shadow-ring focus:outline-none disabled:opacity-50"
        />
      ) : (
        <div className="m-6 flex-1 overflow-y-auto rounded-md bg-ivory px-5 py-4 shadow-ring">
          {status === "loading" ? (
            <p className="text-[13px] italic text-stone-gray">载入中…</p>
          ) : (
            <MdPreview source={md} />
          )}
        </div>
      )}

      <div className="flex items-center justify-end border-t border-border-cream px-6 py-3 text-[12px]">
        {status === "loading" && <span className="text-stone-gray">加载中…</span>}
        {status === "saving" && <span className="text-stone-gray">保存中…</span>}
        {status === "saved" && <span className="text-stone-gray">已保存 ✓</span>}
        {status === "error" && <span className="text-error-crimson">读写失败</span>}
      </div>
    </div>
  );
}
