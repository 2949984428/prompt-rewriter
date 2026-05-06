// prompt-rewriter/app/api/model-profiles/route.ts
import { NextResponse } from "next/server";
import { listModelProfiles, loadMeta } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [profiles, meta] = await Promise.all([listModelProfiles(), loadMeta()]);
  return NextResponse.json({
    available: profiles,
    target_model: meta.target_model,
  });
}
