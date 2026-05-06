// prompt-rewriter/components/providers.tsx
"use client";

import { Provider, useSetAtom } from "jotai";
import { useEffect } from "react";
import {
  skillMdAtom,
  skillsIndexAtom,
  hardRulesAtom,
  verticalHintsAtom,
  targetModelAtom,
  availableModelsAtom,
  modelProfileMdAtom,
  llmModelOptionsAtom,
  llmModelAtom,
} from "@/lib/atoms";
import {
  HardRuleSchema,
  VerticalHintSchema,
  SkillsIndexSchema,
} from "@/lib/schema";
import { HistoryIndexEntrySchema } from "@/lib/schema-history-index";
import { LLMModelsConfigSchema } from "@/lib/schema-llm-models";
import {
  historyIndexAtom,
  historyIndexLoadedAtom,
} from "@/lib/atoms-history-index";
import { z } from "zod";

function Bootstrapper() {
  const setSkill = useSetAtom(skillMdAtom);
  const setSkillsIndex = useSetAtom(skillsIndexAtom);
  const setRules = useSetAtom(hardRulesAtom);
  const setHints = useSetAtom(verticalHintsAtom);
  const setTargetModel = useSetAtom(targetModelAtom);
  const setAvailableModels = useSetAtom(availableModelsAtom);
  const setModelProfileMd = useSetAtom(modelProfileMdAtom);
  // 跨实验台全局索引:启动拉一次,顶栏「🕘 全局历史」按钮消费,
  // HistorySidebar / format history list 也都从这个 atom 派生。
  const setHistoryIndex = useSetAtom(historyIndexAtom);
  const setHistoryIndexLoaded = useSetAtom(historyIndexLoadedAtom);

  // LLM 改写模型(跨 lab 共享):列表 + 默认值
  const setLlmOptions = useSetAtom(llmModelOptionsAtom);
  const setLlmModel = useSetAtom(llmModelAtom);

  useEffect(() => {
    // 配置类 bootstrap:失败只警告不影响 history
    (async () => {
      const [skillRes, skillsRes, rulesRes, hintsRes, modelsRes] =
        await Promise.all([
          fetch("/api/skill"),
          fetch("/api/skills"),
          fetch("/api/rules"),
          fetch("/api/hints"),
          fetch("/api/model-profiles"),
        ]);
      setSkill(await skillRes.text());
      try {
        setSkillsIndex(SkillsIndexSchema.parse(await skillsRes.json()));
      } catch (e) {
        console.warn("[bootstrap] skills index parse failed:", e);
      }
      setRules(z.array(HardRuleSchema).parse(await rulesRes.json()));
      setHints(z.array(VerticalHintSchema).parse(await hintsRes.json()));

      const modelsJson = (await modelsRes.json()) as {
        available: string[];
        target_model: string;
      };
      setAvailableModels(modelsJson.available);
      setTargetModel(modelsJson.target_model);

      if (modelsJson.target_model) {
        const profileRes = await fetch(
          `/api/model-profiles/${encodeURIComponent(modelsJson.target_model)}`
        );
        setModelProfileMd(await profileRes.text());
      }
    })().catch((e) => {
      console.error("[bootstrap] config failed (history 流程不受影响):", e);
    });

    // LLM 模型列表(可切换 Claude / Kimi / 其他)。
    // 失败时保留默认空 → switcher 隐藏 / 跑改写时不传 llm_model → 后端 fallback env 默认。
    (async () => {
      try {
        const res = await fetch("/api/llm-models");
        if (!res.ok) throw new Error(`GET /api/llm-models -> ${res.status}`);
        const cfg = LLMModelsConfigSchema.parse(await res.json());
        setLlmOptions(cfg.available);
        setLlmModel(cfg.default);
      } catch (e) {
        console.warn("[bootstrap] llm-models 加载失败:", e);
      }
    })();

    // 全局索引 bootstrap:跨实验台共享。这是新历史架构的唯一入口,
    // HistorySidebar / format-history-list / 顶栏全局历史 modal 都从这里派生。
    // 失败:保持 loaded=false → 各处显示"加载中"而不是误显空。
    (async () => {
      try {
        const res = await fetch("/api/history-index");
        if (!res.ok) throw new Error(`GET /api/history-index -> ${res.status}`);
        const items = z.array(HistoryIndexEntrySchema).parse(await res.json());
        setHistoryIndex(items);
        setHistoryIndexLoaded(true);
      } catch (e) {
        console.warn("[bootstrap] history-index 加载失败:", e);
      }
    })();
  }, [
    setSkill,
    setSkillsIndex,
    setRules,
    setHints,
    setTargetModel,
    setAvailableModels,
    setModelProfileMd,
    setHistoryIndex,
    setHistoryIndexLoaded,
    setLlmOptions,
    setLlmModel,
  ]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Provider>
      <Bootstrapper />
      {children}
    </Provider>
  );
}
