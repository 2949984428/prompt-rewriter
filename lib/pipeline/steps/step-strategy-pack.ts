// prompt-rewriter/lib/pipeline/steps/step-strategy-pack.ts
//
// Step 2 · strategy_pack
//   按 SP1 输出的 vertical/platform,从 JSON 字典里拉对应的 standards + tone bullets。
//   纯 fs 读 + 字典查表,几乎不可能失败,不配 retry。

import { defineStep } from "@/lib/pipeline/types";
import { resolve as resolveStrategy } from "@/lib/strategies/registry";
import type { PipelineCtx } from "./types";

type VerticalStandard = Record<string, { label?: string; standards?: string[] }>;
type PlatformTone = Record<
  string,
  { parent_vertical?: string; label?: string; tone?: string[] }
>;

export const stepStrategyPack = defineStep<PipelineCtx>({
  id: "strategy_pack",
  description: "按 SP1 的 vertical/platform 从 Registry active 版本拉策略 bullets",
  async run(ctx, emit): Promise<Partial<PipelineCtx>> {
    const t = Date.now();
    // Phase 2 · 走 Registry 拿 active 版本(每次跑批 readFile,改完立刻生效)
    const [vRes, pRes] = await Promise.all([
      resolveStrategy("vertical-standard"),
      resolveStrategy("platform-tone"),
    ]);
    const verticalDict: VerticalStandard = JSON.parse(vRes.content);
    const platformDict: PlatformTone = JSON.parse(pRes.content);

    const intent = ctx.step1?.intent ?? null;
    const vertical = intent?.vertical ?? "other";
    const platform = intent?.platform ?? "other";

    const v = verticalDict[vertical] ?? verticalDict["other"] ?? {
      label: "其他",
      standards: [],
    };
    const p = platformDict[platform] ?? platformDict["other"] ?? {
      label: "其他",
      tone: [],
    };

    const pack = {
      vertical_standard: {
        vertical,
        label: v.label,
        standards: v.standards ?? [],
      },
      platform_tone: {
        platform,
        label: p.label,
        tone: p.tone ?? [],
      },
    };

    emit({
      phase: "strategy_pack",
      data: {
        ...pack,
        elapsed_ms: Date.now() - t,
        versions: { vertical: vRes.id, platform: pRes.id },
      },
    });

    return {
      strategyPack: pack,
      strategyVersions: {
        ...(ctx.strategyVersions ?? {}),
        vertical: vRes.id,
        platform: pRes.id,
      },
    };
  },
});
