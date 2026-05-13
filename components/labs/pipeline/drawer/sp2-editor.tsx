// prompt-rewriter/components/labs/pipeline/drawer/sp2-editor.tsx
"use client";

import { VersionedEditor } from "./versioned-editor";
import { sp2IndexAtom } from "@/lib/atoms-pipeline-strategies";

export function Sp2Editor() {
  return (
    <VersionedEditor
      ns="sp-rewrite"
      indexAtom={sp2IndexAtom}
      versionExt="md"
      title="media_prompt_review SP"
      hint={
        <>
          <p className="mb-1.5">
            对 CreationPlanner 拆出的 N 个 generate_media function call 做减法 +
            注入 vertical_standard / platform_tone 平台硬规则。返回{" "}
            <code className="font-mono">{`{ reviewed: [{id, prompt}] }`}</code>。
          </p>
          <p className="text-[11.5px] opacity-80">
            6 个占位符 <code className="font-mono">{`{{LOVART_ACTIVE_*}}`}</code> 由 SP2 step 在跑批时注入,
            模板里别手填。<b className="ml-1">改完无需重启</b>。
          </p>
        </>
      }
      pathTemplate="data/labs/pipeline/sps/rewrite/<vN>.md"
    />
  );
}
