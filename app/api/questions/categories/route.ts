// prompt-rewriter/app/api/questions/categories/route.ts
//
// GET /api/questions/categories
//   → { l1: CategoryNode[], l2_by_l1: Record<string, CategoryNode[]>,
//       uncategorized: { qids: string[] }, total_categorized_questions }
//
// 跟 GET /api/questions 里的 categories 字段不同 —— 这里每个节点带 qids,给「分类」tab 折叠展开用。

import { NextResponse } from "next/server";
import { listCategoriesDetail } from "@/lib/questions/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await listCategoriesDetail();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
