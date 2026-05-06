// prompt-rewriter/components/drawer/model-profile-editor.tsx
"use client";

import { useAtom, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import {
  targetModelAtom,
  availableModelsAtom,
  modelProfileMdAtom,
  saveStatusAtom,
} from "@/lib/atoms";
import { MdPreview, MdViewSwitcher } from "./md-preview";

export function ModelProfileEditor() {
  const [target, setTarget] = useAtom(targetModelAtom);
  const [available] = useAtom(availableModelsAtom);
  const [md, setMd] = useAtom(modelProfileMdAtom);
  const setStatus = useSetAtom(saveStatusAtom);
  const [status, setLocalStatus] = useAtom(saveStatusAtom);
  const [view, setView] = useState<"edit" | "preview">("preview");

  // 切换 target_model 的临时状态
  const [switching, setSwitching] = useState(false);
  const [switchErr, setSwitchErr] = useState<string | null>(null);

  // md 防抖写盘
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);
  // 避免"切换 model 触发重写 md" 又反向触发 PUT
  const skipNextWrite = useRef(false);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    if (!target) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setStatus("saving");
      try {
        const r = await fetch(
          `/api/model-profiles/${encodeURIComponent(target)}`,
          { method: "PUT", body: md }
        );
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

  async function switchTarget(next: string) {
    if (next === target || switching) return;
    setSwitching(true);
    setSwitchErr(null);
    setLocalStatus("saving");
    try {
      // 1. 写 meta
      const putMeta = await fetch("/api/meta", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_model: next }),
      });
      if (!putMeta.ok) {
        const data = (await putMeta.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error || `PUT /api/meta failed`);
      }

      // 2. 拉新 profile md
      const getProfile = await fetch(
        `/api/model-profiles/${encodeURIComponent(next)}`
      );
      const newMd = await getProfile.text();

      // 避免新 md 触发自己写回当前文件
      skipNextWrite.current = true;
      setTarget(next);
      setMd(newMd);
      setLocalStatus("saved");
    } catch (e) {
      setSwitchErr(e instanceof Error ? e.message : String(e));
      setLocalStatus("error");
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶部:target_model 选择 + 视图切换 */}
      <div className="border-b border-border-cream px-8 pt-6 pb-5">
        <div className="mb-3 flex items-center gap-4">
          <span className="font-serif text-[13px] text-olive-gray">
            生图用哪个模型
          </span>
          <select
            value={target}
            onChange={(e) => switchTarget(e.target.value)}
            disabled={switching || available.length === 0}
            className="flex-1 rounded-md border border-border-cream bg-ivory px-3 py-2 font-mono text-[13px] text-near-black shadow-ring focus:outline-none disabled:opacity-60"
          >
            {available.length === 0 && <option value="">(无可用 profile)</option>}
            {available.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <MdViewSwitcher view={view} onChange={setView} />
        </div>
        <p className="text-[12.5px] leading-[1.7] text-stone-gray">
          这里选「最终要拿 prompt 去出图的目标模型」。不同模型吃的 prompt 风格不一样
          —— 改写 AI 会按下面这张模型画像来组织最终 prompt。
          切到别的模型会自动加载它的画像,编辑后立刻持久化到{" "}
          <code className="font-mono">data/model_profiles/{target || "<name>"}.md</code>。
        </p>
        {switchErr && (
          <p className="mt-2 text-[12.5px] text-error-crimson">切换失败:{switchErr}</p>
        )}
      </div>

      {/* 下部:编辑 or 预览 */}
      {view === "edit" ? (
        <textarea
          value={md}
          onChange={(e) => setMd(e.target.value)}
          spellCheck={false}
          placeholder={
            target
              ? `${target} 的模型画像还是空的,从这里开始写它的 prompt 规则…`
              : "先在上方选一个目标模型…"
          }
          className="mb-4 flex-1 resize-none border-b border-border-cream bg-ivory px-8 py-6 font-mono text-[14px] leading-[1.7] text-near-black focus:outline-none"
        />
      ) : (
        <div className="mb-4 flex-1 overflow-y-auto border-b border-border-cream bg-ivory px-8 py-6">
          <MdPreview source={md} />
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border-cream px-8 py-4 text-[12px]">
        <span className="text-stone-gray">
          自动写入 <code className="font-mono">data/model_profiles/{target || "<name>"}.md</code>
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
