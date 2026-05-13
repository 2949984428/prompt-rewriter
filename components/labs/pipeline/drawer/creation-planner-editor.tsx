// prompt-rewriter/components/labs/pipeline/drawer/creation-planner-editor.tsx
"use client";

import { VersionedEditor } from "./versioned-editor";
import { plannerIndexAtom } from "@/lib/atoms-pipeline-strategies";

export function CreationPlannerEditor() {
  return (
    <VersionedEditor
      ns="sp-creation-planner"
      indexAtom={plannerIndexAtom}
      versionExt="md"
      title="Creation Planner SP"
      hint={
        <>
          <p className="mb-1.5">
            把用户 query 拆成 N 个 generate_media function_call,**每个含 prompt + size**。
            走 Gemini 3 Flash(跟 SP1 同源),size 启发式继承 F11-direct-api(显式比例 / 用途词 / 内容类型)。
          </p>
          <p className="text-[11.5px] opacity-80">
            落盘到 <code className="font-mono">data/labs/pipeline/sps/creation-planner/&lt;vN&gt;.md</code>。
            LLM 失败时 server 端会 fallback 到 mock(N 份 query + size=1024x1024),保证后续 step 不卡。
            <b className="ml-1">改完无需重启</b>。
          </p>
        </>
      }
      pathTemplate="data/labs/pipeline/sps/creation-planner/<vN>.md"
    />
  );
}
