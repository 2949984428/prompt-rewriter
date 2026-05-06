// prompt-rewriter/app/api/labs/fusion/skill-rules/route.ts
//
// GET → 实验台规则索引(三级:skill / section / principle)
//       前端启动融合台时拉一次,缓存到 skillRuleIndexAtom。
//       skill 文件改了刷新页面就更新(没做 watch)。

import { NextResponse } from "next/server";
import { buildSkillRuleIndex } from "@/lib/skill-rule-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const index = await buildSkillRuleIndex();
    return NextResponse.json({ index });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `skill index build failed: ${msg}` }, { status: 500 });
  }
}
