// prompt-rewriter/components/labs/pipeline/drawer/sp1-editor.tsx
"use client";

import { VersionedEditor } from "./versioned-editor";
import { sp1IndexAtom } from "@/lib/atoms-pipeline-strategies";

export function Sp1Editor() {
  return (
    <VersionedEditor
      ns="sp-classification"
      indexAtom={sp1IndexAtom}
      versionExt="md"
      title="search_intent_classification SP"
      hint={
        <>
          <p className="mb-1.5">
            判定搜索意图(yes/no/search_type)+ 输出 vertical(一级垂类)+ platform(二级场景)。
            返回 JSON,前端 schema 强校验 5 个字段。
          </p>
          <p className="text-[11.5px] opacity-80">
            落盘到 <code className="font-mono">data/labs/pipeline/sps/classification/&lt;vN&gt;.md</code>,
            <b className="ml-1">改完无需重启</b>,下一轮跑批立刻生效。
          </p>
        </>
      }
      pathTemplate="data/labs/pipeline/sps/classification/<vN>.md"
    />
  );
}
