// prompt-rewriter/components/labs/pipeline/drawer/pipeline-sp-editor.tsx
//
// SP markdown 编辑器 · debounce 自动保存。
// 守卫:firstRender ref 跳过启动期 atom 回填触发的写盘(否则会用空字符串覆盖文件)。

"use client";

import { useAtom, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import {
  pipelineSpClassificationAtom,
  pipelineSpRewriteAtom,
  pipelineSaveStatusAtom,
} from "@/lib/atoms-pipeline";
import { MdPreview, MdViewSwitcher } from "@/components/drawer/md-preview";
import { InfoIcon } from "@/components/labs/pipeline/info-icon";

type SpAtomKey = "sp-classification" | "sp-rewrite";

export function PipelineSpEditor({
  name,
  atomKey,
  title,
  hint,
}: {
  name: "classification" | "rewrite";
  atomKey: SpAtomKey;
  title: string;
  hint: string;
}) {
  const [classMd, setClassMd] = useAtom(pipelineSpClassificationAtom);
  const [rewriteMd, setRewriteMd] = useAtom(pipelineSpRewriteAtom);
  const setStatus = useSetAtom(pipelineSaveStatusAtom);

  const md = atomKey === "sp-classification" ? classMd : rewriteMd;
  const setMd = atomKey === "sp-classification" ? setClassMd : setRewriteMd;

  // 编辑 / 预览(默认预览,跟 SkillEditor 保持一致体感)
  const [view, setView] = useState<"edit" | "preview">("preview");

  // 切 tab 时,把"上一个 tab 的 firstRender 守卫"重置成 true,
  // 这样下面那个 useEffect 第一次 md 变化(切到新 tab 的回填)不会触发保存。
  const firstRender = useRef(true);
  useEffect(() => {
    firstRender.current = true;
    // 当 atomKey 变(切 tab)
  }, [atomKey]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setStatus("saving");
      try {
        const r = await fetch("/api/labs/pipeline", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "sp", name, content: md }),
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
      <div className="border-b border-border-cream px-8 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <h3 className="font-serif text-[17px] font-medium text-near-black">{title}</h3>
            <InfoIcon
              hint={
                <>
                  <p className="mb-1.5">{hint}</p>
                  <p className="text-[11.5px] opacity-80">
                    落盘到 <code className="font-mono">data/labs/pipeline/sps/{name}.md</code>,
                    <b className="ml-1">改完无需重启</b>。
                  </p>
                </>
              }
            />
          </div>
          <MdViewSwitcher view={view} onChange={setView} />
        </div>
      </div>
      {view === "edit" ? (
        <textarea
          value={md}
          onChange={(e) => setMd(e.target.value)}
          spellCheck={false}
          placeholder="(空)"
          className="flex-1 resize-none bg-ivory px-8 py-6 font-mono text-[13px] leading-[1.7] text-near-black focus:outline-none"
        />
      ) : (
        <div className="flex-1 overflow-y-auto bg-ivory px-8 py-6">
          <MdPreview source={md} />
        </div>
      )}
    </div>
  );
}
