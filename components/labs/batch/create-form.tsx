// prompt-rewriter/components/labs/batch/create-form.tsx
//
// 创建批量任务表单。三模式 (derive/manual/repeat) + skill 多选 + 评分维度自定义。
//
// 工作流:
//   - derive:写 purpose + N → 点"派生预览"调 derive-queries → 用户可改 → 创建
//   - manual:textarea 一行一条 query
//   - repeat:写 1 个 query + N → 创建时展开成 N 行同 query
//
// 创建后:POST /runs → 拿到 record → 立刻 POST /runs/[id]/start → 跳详情。

"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, Sparkles, Loader2, Trash2, X, Copy } from "lucide-react";
import {
  batchViewAtom,
  batchSummariesAtom,
  batchCreatePrefillAtom,
} from "@/lib/atoms-batch";
import { formatSkillsAtom } from "@/lib/atoms-format";
import type {
  BatchQueryMode,
  BatchRunRecord,
  BatchTestKind,
  ScoringDimension,
} from "@/lib/schema";
import { LlmModelSwitcher } from "@/components/llm-model-switcher";
import { ImageModelSwitcher } from "@/components/image-model-switcher";
import { llmModelAtom } from "@/lib/atoms";
import { includeUniversalDefaultAtom, imageModelAtom } from "@/lib/atoms-shared";
import { SkillSelector } from "@/components/skill-selector";
import { UniversalToggle } from "@/components/universal-toggle";
import { ImageUploader } from "@/components/image-uploader";
import { ImageModelGrid } from "@/components/image-model-grid";
import { writeHistoryRun } from "@/lib/history-write";
import { historyIndexAtom } from "@/lib/atoms-history-index";

const MODES: { id: BatchQueryMode; label: string; hint: string }[] = [
  {
    id: "derive",
    label: "AI 派生",
    hint: "写一段测试目的,LLM 派生 N 条不同 query(测广度 / 覆盖)",
  },
  {
    id: "manual",
    label: "自填",
    hint: "我清楚要测什么,直接粘 N 行 query(测精准目标)",
  },
  {
    id: "repeat",
    label: "重复",
    hint: "1 个 query 跑 N 次(测稳定性 / 方差)",
  },
  {
    id: "set",
    label: "题目集",
    hint: "从题目库挑一个题目集,按 L1 / L2 / tag 筛选导入 query(题面 text 部分)",
  },
];

const DEFAULT_DIMS: ScoringDimension[] = [
  { id: "overall", label: "总体观感", description: "" },
  { id: "intent", label: "意图还原度", description: "prompt 是否抓住了用户原意" },
];

// Phase 2 Pipeline 测试台:平台上的 pipeline 列表(短期 hardcode,后续接 pipeline registry)
//
// "api_direct" 是特殊伪 pipeline,跳过 SP1/Planner/SP2,直接 query + 参考图出图。
// 语义跟 Skill 测试台的 F11-direct-api 一致,但被包成 Pipeline 测试台的一个选项,
// 让用户能在同一个矩阵里把"什么都不改的 baseline" vs "走完整 pipeline"做横评对比。
export const AVAILABLE_PIPELINES: {
  id: string;
  name: string;
  description: string;
}[] = [
  {
    id: "vertical_prompt_rewrite_v1",
    name: "垂类差异化实验",
    description: "SP1 意图分类 → 策略包 → CreationPlanner → SP2 改写 → 生图",
  },
  {
    id: "api_direct",
    name: "API 直出(baseline)",
    description:
      "跳过整条 pipeline,用 query + 参考图直接出图。等价于 Skill 测试台 F11-direct-api,包成一个 pipeline 选项便于矩阵对比",
  },
];

export interface BatchCreateFormProps {
  /**
   * 锁定 test_kind:由父级 lab 传入。
   *   Skill 批量测试台 不传(用户可自由切换 skill/pipeline,默认 skill)
   *   Pipeline 测试台 传 "pipeline"(锁定 pipeline 模式,顶部 toggle 隐藏)
   */
  forceTestKind?: BatchTestKind;
}

export function BatchCreateForm({ forceTestKind }: BatchCreateFormProps = {}) {
  const [, setView] = useAtom(batchViewAtom);
  const [summaries, setSummaries] = useAtom(batchSummariesAtom);
  const [prefill, setPrefill] = useAtom(batchCreatePrefillAtom);
  const skills = useAtomValue(formatSkillsAtom);
  const llmModel = useAtomValue(llmModelAtom);
  const [imageModel, setImageModel] = useAtom(imageModelAtom);
  const setHistoryIndex = useSetAtom(historyIndexAtom);

  const [name, setName] = useState("");
  // 复制重跑场景:queries 已确定,默认走 manual。否则保持 derive 当首选
  const [mode, setMode] = useState<BatchQueryMode>(
    prefill ? "manual" : "derive"
  );

  // 源 run 信息(banner 显示用)。prefill 被消费清掉后,用这个保留可见提示
  const [source, setSource] = useState<{
    runId: string;
    runName: string;
  } | null>(null);

  // derive 模式
  const [purpose, setPurpose] = useState("");
  const [n, setN] = useState(5);
  const [derivedQueries, setDerivedQueries] = useState<string[]>([]);
  const [deriving, setDeriving] = useState(false);
  const [deriveError, setDeriveError] = useState<string | null>(null);
  // 已耗时(秒),让用户感知到"还在跑,只是慢"而不是"卡死"
  const [deriveElapsed, setDeriveElapsed] = useState(0);
  // 自增请求 id:超时 / 用户取消时把它推进,正在跑的 fetch 回来发现 id 不对就被当 stale 丢掉。
  // 不用 AbortController 是因为 Next 16 Turbopack 在 abort fetch 时会把
  // "signal is aborted without reason" 当 console error 显示在 dev overlay 上,
  // 而且 lib/llm.ts 暂未透传 AbortSignal,abort 只能截前端、token 一样花,
  // 收益小、噪音大,改用 stale-flag 模式更干净。
  const deriveReqIdRef = useRef(0);
  // 超时按 N 动态算 — 实测:N=5 ≈ 15s, N=15 ≈ 37s, N=30 ≈ 90-180s
  // 公式:base 60s + 每条预算 8s,封顶 360s(6 分钟)
  const deriveTimeoutMs = (): number =>
    Math.min(60_000 + n * 8_000, 360_000);

  // manual 模式:列表式自填(每条独立 textarea,避免按 \n 拆错含换行的 query)
  // 默认起步 1 条空字符串,用户至少看到一个输入框知道往哪儿填
  const [manualList, setManualList] = useState<string[]>([""]);
  const updateManualItem = (idx: number, v: string) =>
    setManualList((xs) => xs.map((x, i) => (i === idx ? v : x)));
  const addManualItem = () => setManualList((xs) => [...xs, ""]);
  const removeManualItem = (idx: number) =>
    setManualList((xs) => (xs.length <= 1 ? xs : xs.filter((_, i) => i !== idx)));

  // repeat 模式
  const [repeatQuery, setRepeatQuery] = useState("");
  const [repeatN, setRepeatN] = useState(3);

  // set 模式 ─── 从题目库导入 query
  // 流程:mount 拉 sets 列表 → 用户选 setId → 拉该 set 完整内容 → client 过滤 + 预览 + 提交时拼 query[]
  const [setOptions, setSetOptions] = useState<
    { set_id: string; name: string; count: number }[]
  >([]);
  const [selectedSetId, setSelectedSetId] = useState<string>("");
  // 选 set 后拉到的完整题目(client 端做 filter 避免每次切 filter 都打一次 server)
  const [setQuestions, setSetQuestions] = useState<
    {
      qid: string;
      input_content: { content: string; type: "text" | "image" }[];
      categories: string[];
      tags: string[];
    }[]
  >([]);
  const [setLoadingQuestions, setSetLoadingQuestions] = useState(false);
  const [setLoadError, setSetLoadError] = useState<string | null>(null);
  // 4 个筛选条件
  const [setFilterL1, setSetFilterL1] = useState<string>("");
  const [setFilterL2, setSetFilterL2] = useState<string>("");
  const [setFilterTag, setSetFilterTag] = useState<string>("");
  const [setHasImagesFilter, setSetHasImagesFilter] = useState<
    "all" | "yes" | "no"
  >("all");

  // 选 set 时进入 / 切到 set 模式时,拉一次 sets 列表
  useEffect(() => {
    if (mode !== "set") return;
    if (setOptions.length > 0) return;
    (async () => {
      try {
        const r = await fetch("/api/questions/sets");
        if (!r.ok) return;
        const json = (await r.json()) as {
          sets: { set_id: string; name: string; count: number }[];
        };
        setSetOptions(json.sets);
        // 自动选第一个 set(如果只有一个 / 用户还没选)
        if (!selectedSetId && json.sets.length > 0) {
          setSelectedSetId(json.sets[0].set_id);
        }
      } catch {
        /* 静默,UI 会显示无可选 */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // 选了 setId → 拉完整 set 内容(一次 GET 拿全部题目,client 过滤)
  useEffect(() => {
    if (mode !== "set" || !selectedSetId) return;
    setSetLoadingQuestions(true);
    setSetLoadError(null);
    (async () => {
      try {
        const r = await fetch(
          `/api/questions/sets/${encodeURIComponent(selectedSetId)}`,
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const set = (await r.json()) as {
          questions: typeof setQuestions;
        };
        setSetQuestions(set.questions);
      } catch (e) {
        setSetLoadError(e instanceof Error ? e.message : String(e));
        setSetQuestions([]);
      } finally {
        setSetLoadingQuestions(false);
      }
    })();
    // 切 set 时重置筛选
    setSetFilterL1("");
    setSetFilterL2("");
    setSetFilterTag("");
    setSetHasImagesFilter("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedSetId]);

  // 根据筛选过滤当前 set 的题目(client 计算 + 拼 query string)
  const setFilteredQuestions = (() => {
    if (mode !== "set") return [] as typeof setQuestions;
    return setQuestions.filter((q) => {
      if (setFilterL1 && q.categories[0] !== setFilterL1) return false;
      if (setFilterL2 && q.categories[1] !== setFilterL2) return false;
      if (setFilterTag && !q.tags.includes(setFilterTag)) return false;
      const hasImg = q.input_content.some((b) => b.type === "image");
      if (setHasImagesFilter === "yes" && !hasImg) return false;
      if (setHasImagesFilter === "no" && hasImg) return false;
      return true;
    });
  })();

  // 当前 set 的 L1 / L2 / tag 字典(给筛选下拉用,从 setQuestions 算)
  const setCategoriesL1 = (() => {
    const m = new Map<string, number>();
    for (const q of setQuestions) {
      const c1 = q.categories[0];
      if (c1) m.set(c1, (m.get(c1) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  })();
  const setCategoriesL2 = (() => {
    if (!setFilterL1) return [] as { name: string; count: number }[];
    const m = new Map<string, number>();
    for (const q of setQuestions) {
      if (q.categories[0] !== setFilterL1) continue;
      const c2 = q.categories[1];
      if (c2) m.set(c2, (m.get(c2) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  })();
  const setAvailableTags = (() => {
    const m = new Map<string, number>();
    for (const q of setQuestions) {
      for (const t of q.tags) m.set(t, (m.get(t) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  })();

  // 把题目 text 拼成 query string(多个 text block 用 \n\n 分隔,image 暂忽略)
  const questionToQuery = (q: (typeof setQuestions)[number]): string => {
    return q.input_content
      .filter((b) => b.type === "text")
      .map((b) => b.content.trim())
      .filter((s) => s.length > 0)
      .join("\n\n");
  };

  // skill 选择
  const [skillIds, setSkillIds] = useState<string[]>([]);

  // Phase 2:test_kind + pipeline 选择
  //   forceTestKind 非空(来自 Pipeline 测试台 lab)→ 直接锁定,顶部 toggle 隐藏
  //   forceTestKind 空(Skill 测试台)→ 默认 skill,顶部 toggle 可切
  const [testKind, setTestKind] = useState<BatchTestKind>(forceTestKind ?? "skill");
  const [pipelineIds, setPipelineIds] = useState<string[]>(
    forceTestKind === "pipeline" ? [AVAILABLE_PIPELINES[0].id] : [],
  );

  // 是否在每条 skill 前注入通用规则(_universal.md)。
  // 初始值从跨 lab 共享 atom（持久化到 localStorage）读，用户改动同步回去 → format lab 下次也跟着走。
  // per-run 的真实值仍 per-record 落盘，prefill 历史时只动本地 state、不动 global 默认。
  const [globalIncludeUniversal, setGlobalIncludeUniversal] = useAtom(
    includeUniversalDefaultAtom
  );
  const [includeUniversal, setIncludeUniversalLocal] = useState(globalIncludeUniversal);
  const setIncludeUniversal = (v: boolean) => {
    setIncludeUniversalLocal(v);
    setGlobalIncludeUniversal(v);
  };

  // 参考图(record 级别;非空时所有 cell 走 image-edit)
  const [referenceImages, setReferenceImages] = useState<string[]>([]);

  // 多 model 模式:可选多个生图模型,创建时按 (query × skill × model) 三维笛卡尔积展开 cells。
  // 空 → 走单 model 模式(用顶部 ImageModelSwitcher 那一个)。
  const [imageModels, setImageModels] = useState<string[]>([]);

  // 评分维度
  const [dims, setDims] = useState<ScoringDimension[]>(DEFAULT_DIMS);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // 复制重跑:挂载时一次性消费 prefill,填进各个字段,然后清掉 atom 防再次消费。
  // **故意不依赖 prefill** — 只在挂载那一帧读;后续用户编辑时不被反复 reset。
  // 用 ref 守卫确保 React strict mode 双调用 effect 时也只跑一次。
  const prefillConsumedRef = useRef(false);
  useEffect(() => {
    if (prefillConsumedRef.current) return;
    if (!prefill) return;
    prefillConsumedRef.current = true;

    setName(prefill.name);
    setSkillIds(prefill.skill_ids);
    if (prefill.scoring_dimensions.length > 0) {
      setDims(prefill.scoring_dimensions);
    }
    // queries → manualList 数组(每条独立 item,与列表式 UI 对齐)
    if (prefill.queries.length > 0) {
      setManualList(prefill.queries);
    }
    // purpose 留作参考,即使 mode=manual 也保留;切到 derive 时可见
    if (prefill.purpose) setPurpose(prefill.purpose);
    setIncludeUniversalLocal(prefill.include_universal);  // prefill 只动本地，不污染全局默认
    if (Array.isArray(prefill.reference_images)) {
      setReferenceImages(prefill.reference_images);
    }
    // 生图模型是全局 atom(跨 lab 共享),复制重跑时复用源 run 的选择。
    // 写回 atomWithStorage 后 ImageModelSwitcher 显示也会跟着变。
    if (typeof prefill.image_model === "string") {
      setImageModel(prefill.image_model);
    }
    setSource({ runId: prefill.source_run_id, runName: prefill.source_run_name });

    // 清掉 atom,避免下次进 create 时还有残留
    setPrefill(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 操作 ────────────────────────
  // 已耗时计数:派生中每秒 +1,派生结束(成功/失败/取消)归零。
  // 单独 useEffect 而不是塞进 onDerive 内部,因为 setInterval 要在 effect 里清理
  useEffect(() => {
    if (!deriving) {
      setDeriveElapsed(0);
      return;
    }
    const t = setInterval(() => setDeriveElapsed((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [deriving]);

  const onDerive = async () => {
    setDeriveError(null);
    setDeriving(true);
    // 启动一次新请求:把 reqId 推进,旧的现役响应自动被当 stale 丢弃
    const reqId = ++deriveReqIdRef.current;
    const isStale = () => deriveReqIdRef.current !== reqId;
    const timeoutMs = deriveTimeoutMs();
    const timeoutId = setTimeout(() => {
      if (isStale()) return;
      // 超时:推进 reqId 让 fetch 回来时被当 stale,UI 立刻复位
      deriveReqIdRef.current = reqId + 1;
      setDeriving(false);
      setDeriveError(
        `派生超过 ${Math.round(timeoutMs / 1000)}s 未返回。建议:换更快的 LLM,或减小 N(当前 N=${n})。`
      );
    }, timeoutMs);
    try {
      const r = await fetch("/api/labs/batch/derive-queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose,
          n,
          llm_model: llmModel || undefined,
        }),
      });
      const j = (await r.json()) as { queries?: string[]; error?: string };
      if (isStale()) return; // 已超时或被取消,丢
      if (!r.ok || !Array.isArray(j.queries)) {
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setDerivedQueries(j.queries);
    } catch (e) {
      if (isStale()) return; // 被取消/超时的 fetch 抛错也丢
      setDeriveError(String(e));
    } finally {
      clearTimeout(timeoutId);
      // 现役才复位 deriving;stale 路径已经在超时回调里复位过
      if (!isStale()) setDeriving(false);
    }
  };

  const onCancelDerive = () => {
    // 推进 reqId 让现役 fetch 的响应被当 stale 丢弃,立即复位 UI
    deriveReqIdRef.current += 1;
    setDeriving(false);
  };

  const updateDerivedQuery = (idx: number, v: string) => {
    setDerivedQueries((qs) => qs.map((q, i) => (i === idx ? v : q)));
  };

  const addDim = () => {
    const nextId = `dim_${dims.length + 1}`;
    setDims([...dims, { id: nextId, label: "", description: "" }]);
  };
  const updateDim = (idx: number, patch: Partial<ScoringDimension>) => {
    setDims((d) => d.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  };
  const removeDim = (idx: number) => {
    setDims((d) => d.filter((_, i) => i !== idx));
  };

  const computeQueries = (): string[] => {
    if (mode === "derive") return derivedQueries.filter((q) => q.trim());
    if (mode === "manual") {
      // 每个条目自身可能跨多行(复杂 prompt 常含换行),只 trim 首尾、不按 \n 拆
      return manualList.map((s) => s.trim()).filter((s) => s.length > 0);
    }
    if (mode === "repeat") {
      const q = repeatQuery.trim();
      if (!q) return [];
      return Array(Math.max(1, repeatN)).fill(q);
    }
    if (mode === "set") {
      // 把当前 set 过滤后的题目 text 拼成 query
      // image block 此处忽略(batch lab 的 reference_images 走顶部 ImageUploader,不用题面图)
      return setFilteredQuestions
        .map(questionToQuery)
        .filter((s) => s.length > 0);
    }
    return [];
  };

  const validate = (): string | null => {
    const queries = computeQueries();
    if (queries.length === 0) return "至少要有 1 条 query";
    if (testKind === "skill" && skillIds.length === 0)
      return "至少选 1 个 skill";
    if (testKind === "pipeline" && pipelineIds.length === 0)
      return "至少选 1 个 pipeline";
    // 维度 id 校验
    const dimIds = new Set<string>();
    for (const d of dims) {
      if (!d.id || !d.label) return "评分维度的 id / label 不能为空";
      if (dimIds.has(d.id)) return `评分维度 id 重复: ${d.id}`;
      dimIds.add(d.id);
    }
    return null;
  };

  const onCreate = async () => {
    const err = validate();
    if (err) {
      setCreateError(err);
      return;
    }
    setCreateError(null);
    setCreating(true);
    try {
      // 方案 C:set 模式特殊处理,同时抽 query 和 per-query 参考图(顺序严格对齐)
      let queries: string[];
      let perQueryRefImages: string[][] = [];
      if (mode === "set") {
        const pairs = setFilteredQuestions
          .map((q) => ({
            query: questionToQuery(q),
            // 只取真 URL,过滤 [@image:#1:xxx] 占位符(不是合法图)
            images: q.input_content
              .filter(
                (b) =>
                  b.type === "image" &&
                  (b.content.startsWith("http") ||
                    b.content.startsWith("data:")),
              )
              .map((b) => b.content),
          }))
          .filter((p) => p.query.length > 0);
        queries = pairs.map((p) => p.query);
        perQueryRefImages = pairs.map((p) => p.images);
      } else {
        queries = computeQueries();
      }

      const r = await fetch("/api/labs/batch/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          query_mode: mode,
          purpose: mode === "derive" ? purpose : "",
          queries,
          // Phase 2:按 test_kind 决定走哪一组 ids
          test_kind: testKind,
          skill_ids: testKind === "skill" ? skillIds : [],
          pipeline_ids: testKind === "pipeline" ? pipelineIds : [],
          scoring_dimensions: dims,
          // pipeline 模式下,改写模型 / 生图模型由 pipeline 内部默认配置控制(batch 层不再选)
          rewrite_llm: testKind === "pipeline" ? "" : llmModel || "",
          include_universal: includeUniversal,
          // set 模式下顶部 ImageUploader 已隐藏,理论 referenceImages 该是空;
          // 但用户可能先在 manual 模式上传过图再切 set,残留 state 不该被发出去 → 强制 []
          reference_images: mode === "set" ? [] : referenceImages,
          per_query_reference_images: perQueryRefImages,
          image_model: testKind === "pipeline" ? "" : imageModel || "",
          image_model_ids: testKind === "pipeline" ? [] : imageModels,
        }),
      });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const record = (await r.json()) as BatchRunRecord;
      // 立即 start
      void fetch(`/api/labs/batch/runs/${record.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concurrency: 16 }),
      });
      // 写一条 partial 的全局历史索引(占位),detail-view 跑完会更新成 completed
      void writeHistoryRun({
        id: record.id,
        lab_id: "batch",
        detail: record,
        index_patch: {
          query: record.queries.length > 0 ? record.queries[0] : record.name,
          summary:
            `${record.queries.length} queries × ${record.skill_ids.length} skills` +
            (record.name ? ` · ${record.name}` : ""),
          status: "partial",
          metadata: {
            n_queries: record.queries.length,
            n_skills: record.skill_ids.length,
            mode: record.query_mode,
          },
        },
      }).then((res) => {
        if (!res.ok) console.warn("[batch-create] history write failed:", res.error);
        // 同步到 in-memory historyIndexAtom
        const ts = Date.now();
        setHistoryIndex((prev) => {
          if (prev.some((p) => p.id === record.id)) return prev;
          return [
            {
              id: record.id,
              ts,
              lab_id: "batch",
              query: record.queries.length > 0 ? record.queries[0] : record.name,
              summary: `${record.queries.length} queries × ${record.skill_ids.length} skills`,
              status: "partial",
              ref: `data/labs/batch/runs/${record.id}.json`,
              pm_score_avg: null,
              pm_score_count: 0,
              metadata: {
                n_queries: record.queries.length,
                n_skills: record.skill_ids.length,
              },
            },
            ...prev,
          ];
        });
      });
      // 列表里塞一条新 summary(乐观)
      setSummaries([
        {
          id: record.id,
          created_at: record.created_at,
          name: record.name,
          query_mode: record.query_mode,
          status: "running",
          n_queries: record.queries.length,
          n_skills:
            record.test_kind === "pipeline"
              ? record.pipeline_ids.length
              : record.skill_ids.length,
          done_cells: 0,
          total_cells: record.cells.length,
          test_kind: record.test_kind,
        },
        ...summaries,
      ]);
      setView({ kind: "detail", id: record.id });
    } catch (e) {
      setCreateError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const queries = computeQueries();
  // Phase 2:cells 总数按 test_kind 决定第二维(skill 或 pipeline)
  const secondDimLen =
    testKind === "pipeline" ? pipelineIds.length : skillIds.length;
  const totalCells = queries.length * secondDimLen;

  return (
    <>
      <header className="flex items-start justify-between gap-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView({ kind: "list" })}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border-warm bg-ivory text-stone-gray transition hover:text-near-black"
            title="返回列表"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="font-serif text-[28px] font-medium leading-[1.2] text-near-black">
              {source ? "复制重跑" : "新建批量测试"}
            </h1>
            {source ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-[13.5px] text-olive-gray">
                <Copy size={13} className="text-terracotta" />
                来源:
                <span className="font-medium text-near-black">
                  {source.runName}
                </span>
                <span className="text-stone-gray">
                  · queries / skill / 维度已预填,可继续修改后开跑
                </span>
              </p>
            ) : (
              <p className="mt-1.5 text-[13.5px] text-olive-gray">
                三模式选 query 来源,选要参与的 skill,设评分维度,创建后自动开跑。
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0 pt-1">
          {/* Pipeline 模式下隐藏改写模型选择 — pipeline 内部 SP1/SP2 各自带默认模型,
              不让用户在批量层再选(否则会覆盖 pipeline 设计) */}
          {testKind !== "pipeline" && <LlmModelSwitcher />}
        </div>
      </header>

      {/* 1. 任务名 */}
      <Section title="任务名" subtitle="给这次测试起个能让你三个月后认出来的名字">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如:电商主视觉 8-skill 横评"
          className="h-10 w-full rounded-md border border-border-warm bg-ivory px-3 text-[14px] text-near-black placeholder:text-stone-gray focus:border-terracotta focus:outline-none"
        />
      </Section>

      {/* 2. Query 来源 */}
      <Section title="Query 来源" subtitle="决定 N 条 query 怎么来">
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`rounded-md border px-4 py-3 text-left transition ${
                mode === m.id
                  ? "border-terracotta bg-coral-soft-bg/40"
                  : "border-border-cream bg-ivory hover:border-border-warm"
              }`}
            >
              <div className="text-[14px] font-medium text-near-black">
                {m.label}
              </div>
              <div className="mt-1 text-[12px] leading-[1.4] text-stone-gray">
                {m.hint}
              </div>
            </button>
          ))}
        </div>

        {/* derive 模式 */}
        {mode === "derive" && (
          <div className="mt-4 space-y-3">
            <textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="测试目的:例如『看 8 个 skill 在电商主视觉(美妆 / 数码 / 服饰)场景下哪个最稳』"
              rows={3}
              className="w-full rounded-md border border-border-warm bg-ivory p-3 text-[14px] leading-[1.5] text-near-black placeholder:text-stone-gray focus:border-terracotta focus:outline-none"
            />
            <div className="flex items-center gap-3">
              <label className="text-[13px] text-olive-gray">
                派生数量 N:
              </label>
              <input
                type="number"
                value={n}
                onChange={(e) =>
                  setN(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
                }
                min={1}
                max={50}
                className="h-9 w-20 rounded-md border border-border-warm bg-ivory px-2 text-center text-[13px]"
              />
              <button
                onClick={onDerive}
                disabled={!purpose.trim() || deriving}
                className="ml-auto flex h-9 items-center gap-2 rounded-md border border-terracotta bg-coral-soft-bg/40 px-3 text-[13px] font-medium text-terracotta transition hover:bg-coral-soft-bg/60 disabled:opacity-50"
              >
                {deriving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                {deriving ? `派生中 ${deriveElapsed}s…` : "AI 派生预览"}
              </button>
              {deriving && (
                <button
                  onClick={onCancelDerive}
                  type="button"
                  className="flex h-9 items-center gap-1 rounded-md border border-border-warm bg-ivory px-2.5 text-[12.5px] text-stone-gray transition hover:bg-cream-warm"
                  title="取消派生"
                >
                  <X size={13} />
                  取消
                </button>
              )}
            </div>
            {deriving && deriveElapsed >= 20 && (
              <p className="text-[11.5px] text-stone-gray">
                LLM 调用中,N={n} 预计 {Math.round((60 + n * 8) / 6) / 10}-
                {Math.round(((60 + n * 8) * 1.5) / 6) / 10} 分钟。等不及可点
                <span className="mx-0.5 font-medium text-near-black">取消</span>
                ,改小 N 或换更快的 LLM 重试。
              </p>
            )}
            {deriveError && (
              <p className="text-[12.5px] text-error-crimson">{deriveError}</p>
            )}
            {derivedQueries.length > 0 && (
              <div className="space-y-1.5 rounded-md border border-border-cream bg-parchment/40 p-3">
                <p className="mb-1 text-[12px] uppercase tracking-wider text-stone-gray">
                  派生预览(可编辑)
                </p>
                {derivedQueries.map((q, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="mt-2 w-6 shrink-0 text-right font-mono text-[11px] text-stone-gray">
                      {i + 1}
                    </span>
                    <textarea
                      value={q}
                      onChange={(e) => updateDerivedQuery(i, e.target.value)}
                      rows={2}
                      className="min-h-[44px] flex-1 resize-y rounded-md border border-border-warm bg-ivory p-2 text-[13px] leading-[1.5] focus:border-terracotta focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* manual 模式 — 列表式,每条独立 textarea */}
        {mode === "manual" && (
          <div className="mt-4 space-y-2">
            <div className="space-y-1.5 rounded-md border border-border-cream bg-parchment/40 p-3">
              {manualList.map((q, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-2 w-6 shrink-0 text-right font-mono text-[11px] text-stone-gray">
                    {i + 1}
                  </span>
                  <textarea
                    value={q}
                    onChange={(e) => updateManualItem(i, e.target.value)}
                    placeholder={
                      i === 0
                        ? "在这里填一条 query。复杂 prompt 可以含换行,不会被错拆。"
                        : ""
                    }
                    rows={2}
                    className="min-h-[44px] flex-1 resize-y rounded-md border border-border-warm bg-ivory p-2 text-[13px] leading-[1.5] focus:border-terracotta focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeManualItem(i)}
                    disabled={manualList.length <= 1}
                    title="删除这条"
                    className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-stone-gray transition hover:bg-coral-soft-bg/40 hover:text-error-crimson disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone-gray"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={addManualItem}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border-warm bg-ivory px-2.5 text-[12.5px] text-olive-gray transition hover:bg-cream-warm"
              >
                <Plus size={13} />
                添加 query
              </button>
              <p className="text-[12px] text-stone-gray">
                当前:{queries.length} / {manualList.length} 条(空行不计)
              </p>
            </div>
          </div>
        )}

        {/* repeat 模式 */}
        {mode === "repeat" && (
          <div className="mt-4 space-y-3">
            <textarea
              value={repeatQuery}
              onChange={(e) => setRepeatQuery(e.target.value)}
              placeholder="例如:咖啡馆主视觉海报,日系简约,顶部留出文字位置"
              rows={3}
              className="w-full rounded-md border border-border-warm bg-ivory p-3 text-[14px] focus:border-terracotta focus:outline-none"
            />
            <div className="flex items-center gap-3">
              <label className="text-[13px] text-olive-gray">重复次数:</label>
              <input
                type="number"
                value={repeatN}
                onChange={(e) =>
                  setRepeatN(
                    Math.max(1, Math.min(50, Number(e.target.value) || 1))
                  )
                }
                min={1}
                max={50}
                className="h-9 w-20 rounded-md border border-border-warm bg-ivory px-2 text-center text-[13px]"
              />
              <span className="text-[12px] text-stone-gray">
                测稳定性时同 query 跑多次,看每次是否一致
              </span>
            </div>
          </div>
        )}

        {/* set 模式:从题目库选一个题目集导入 query */}
        {mode === "set" && (
          <div className="mt-4 space-y-4">
            {/* 选题目集 */}
            <div>
              <label className="mb-1.5 block text-[12px] text-olive-gray">
                题目集
              </label>
              {setOptions.length === 0 ? (
                <p className="rounded-md border border-dashed border-border-warm bg-parchment/40 px-3 py-2.5 text-[13px] text-olive-gray">
                  题目库还没有题目集。先到「题目」→「常规题目」上传一份 xlsx。
                </p>
              ) : (
                <select
                  value={selectedSetId}
                  onChange={(e) => setSelectedSetId(e.target.value)}
                  className="w-full rounded-md border border-border-warm bg-ivory px-3 py-2 text-[13px] text-near-black focus:border-terracotta focus:outline-none"
                >
                  {setOptions.map((s) => (
                    <option key={s.set_id} value={s.set_id}>
                      {s.name} ({s.count} 题)
                    </option>
                  ))}
                </select>
              )}
            </div>

            {setLoadError && (
              <p className="rounded-md border border-error-crimson/30 bg-error-crimson/5 px-3 py-2 text-[12px] text-error-crimson">
                {setLoadError}
              </p>
            )}

            {/* 筛选条件 */}
            {selectedSetId && setQuestions.length > 0 && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <FilterDropdown
                    label="L1 垂类"
                    value={setFilterL1}
                    options={setCategoriesL1}
                    onChange={(v) => {
                      setSetFilterL1(v);
                      setSetFilterL2("");
                    }}
                  />
                  <FilterDropdown
                    label="L2 子类"
                    value={setFilterL2}
                    options={setCategoriesL2}
                    onChange={setSetFilterL2}
                    disabled={!setFilterL1}
                  />
                  <FilterDropdown
                    label="Tag"
                    value={setFilterTag}
                    options={setAvailableTags}
                    onChange={setSetFilterTag}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] text-olive-gray">
                    图片
                  </label>
                  <div className="flex gap-1.5">
                    {(["all", "yes", "no"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setSetHasImagesFilter(v)}
                        className={`rounded-md border px-3 py-1.5 text-[12px] transition ${
                          setHasImagesFilter === v
                            ? "border-terracotta bg-terracotta/10 text-near-black"
                            : "border-border-warm bg-ivory text-olive-gray hover:bg-warm-sand/40"
                        }`}
                      >
                        {v === "all" ? "全部" : v === "yes" ? "含图" : "纯文"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 命中预览 */}
                <div className="rounded-md border border-border-warm bg-parchment/40 px-3.5 py-3">
                  <p className="mb-2 flex items-center gap-2 text-[12.5px]">
                    <span className="font-mono text-near-black">
                      {setFilteredQuestions.length} 题
                    </span>
                    <span className="text-stone-gray">
                      / 共 {setQuestions.length} 题
                    </span>
                    {setFilteredQuestions.some((q) =>
                      q.input_content.some(
                        (b) =>
                          b.type === "image" &&
                          (b.content.startsWith("http") ||
                            b.content.startsWith("data:")),
                      ),
                    ) && (
                      <span className="ml-auto rounded bg-warm-gold-bg px-1.5 py-0.5 font-mono text-[10px] text-warm-gold-fg">
                        含图题的 image URL 自动作为该题 per-cell 参考图(走图生图)
                      </span>
                    )}
                  </p>
                  {setFilteredQuestions.length === 0 ? (
                    <p className="text-[12px] text-stone-gray">
                      没有匹配的题目,试试清掉过滤条件
                    </p>
                  ) : (
                    <ul className="max-h-[280px] overflow-y-auto space-y-1.5">
                      {setFilteredQuestions.slice(0, 60).map((q) => {
                        const preview = questionToQuery(q);
                        const realImgCount = q.input_content.filter(
                          (b) =>
                            b.type === "image" &&
                            (b.content.startsWith("http") ||
                              b.content.startsWith("data:")),
                        ).length;
                        return (
                          <li
                            key={q.qid}
                            className="rounded bg-ivory px-2.5 py-1.5"
                          >
                            <div className="mb-0.5 flex items-baseline gap-2">
                              <span className="shrink-0 font-mono text-[10.5px] text-stone-gray">
                                {q.qid}
                              </span>
                              {realImgCount > 0 && (
                                <span
                                  className="rounded bg-warm-gold-bg px-1.5 py-0 font-mono text-[10px] text-warm-gold-fg"
                                  title="作为该题的 per-cell 参考图"
                                >
                                  +{realImgCount} 图
                                </span>
                              )}
                              <div className="ml-auto flex flex-wrap gap-1">
                                {q.categories.map((c) => (
                                  <span
                                    key={c}
                                    className="rounded bg-warm-sand/40 px-1.5 py-0 font-mono text-[10px] text-near-black"
                                  >
                                    {c}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <p className="line-clamp-2 text-[12.5px] leading-[1.45] text-near-black">
                              {preview || (
                                <span className="italic text-stone-gray">
                                  (无文本内容,会被跳过)
                                </span>
                              )}
                            </p>
                          </li>
                        );
                      })}
                      {setFilteredQuestions.length > 60 && (
                        <li className="px-2.5 py-1 text-[11px] text-stone-gray">
                          …还有 {setFilteredQuestions.length - 60} 条未显示(创建时全部导入)
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              </>
            )}

            {setLoadingQuestions && (
              <p className="text-[12px] text-stone-gray">载入题目集中…</p>
            )}
          </div>
        )}
      </Section>

      {/* 2.5 参考图(可选) — 上传后所有 cell 走 image-edit;不传走 text-to-image
          set 模式下隐藏:题目集每题自带 image 已自动作为 per-cell 参考图(方案 C),
          再 expose 全局参考图会让"含图题用自己的图 / 纯文题用顶部图"语义混乱 */}
      {mode !== "set" && (
        <Section
          title="参考图"
          subtitle="上传后本次跑批所有 cell 都走 image-edit(图生图);不传走文生图"
        >
          <ImageUploader
            value={referenceImages}
            onChange={setReferenceImages}
            max={3}
            label=""
            hint="所有 query × skill 共用这组图"
          />
        </Section>
      )}

      {/* 3. 选 skill / pipeline — 按 test_kind 分流(forceTestKind 由父级 lab 锁定,
          Skill 测试台 prop="skill" / Pipeline 测试台 prop="pipeline",页面独立) */}
      {testKind === "skill" ? (
        <Section
          title="参与 Skill"
          subtitle="复用格式实验台已有的 skill 池"
          right={<UniversalToggle />}
        >
          <SkillSelector
            skills={skills}
            selectedIds={skillIds}
            onToggle={(id) =>
              setSkillIds((ids) =>
                ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
              )
            }
            layout="grid"
            emptyText="正在加载 skill…"
          />
        </Section>
      ) : (
        <Section
          title="参与 Pipeline"
          subtitle="平台上的 pipeline 列表(在 Pipeline 管理里维护)"
        >
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {AVAILABLE_PIPELINES.map((p) => {
              const selected = pipelineIds.includes(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setPipelineIds((ids) =>
                        ids.includes(p.id)
                          ? ids.filter((x) => x !== p.id)
                          : [...ids, p.id],
                      )
                    }
                    className={`w-full rounded-lg border px-4 py-3 text-left transition ${
                      selected
                        ? "border-terracotta bg-terracotta/10 text-near-black shadow-ring"
                        : "border-border-warm bg-ivory text-olive-gray hover:bg-warm-sand/40"
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-mono text-[10.5px] text-stone-gray">
                        {selected ? "✓" : "○"}
                      </span>
                      <span className="font-serif text-[14.5px] font-medium text-near-black">
                        {p.name}
                      </span>
                    </div>
                    <p className="text-[12px] leading-[1.45]">{p.description}</p>
                    <p className="mt-1 font-mono text-[10.5px] text-stone-gray">
                      {p.id}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* 3.5 选择使用的模型 — 多选;0=后端默认 / 1=单 model / N=笛卡尔积扩 cells
          Pipeline 模式下隐藏 — pipeline 内部已经声明默认生图模型(跟 PipelineLab 一致) */}
      {testKind === "pipeline" ? (
        <Section
          title="模型配置"
          subtitle="Pipeline 模式使用 pipeline 自带的默认模型组合,跟 PipelineLab 单 query 跑批一致"
        >
          <div className="rounded-md border border-border-warm bg-parchment/40 px-4 py-3 text-[12.5px]">
            <p className="mb-1.5 text-near-black">
              <span className="font-mono text-[11px] text-stone-gray">
                vertical_prompt_rewrite_v1
              </span>{" "}
              默认模型组合:
            </p>
            <ul className="space-y-0.5 font-mono text-[11.5px] text-olive-gray">
              <li>· SP1 意图分类 — gemini/gemini-3-flash-preview</li>
              <li>· SP2 改写 — doubao/seed-2-0-pro-260215</li>
              <li>· 生图 — gpt-image-2</li>
            </ul>
            <p className="mt-2 text-[11.5px] text-stone-gray">
              改默认模型组合请去 Pipeline 管理里编辑 pipeline 配置(暂未支持,后续 registry 接入)。
            </p>
          </div>
        </Section>
      ) : (
        <Section
          title="选择使用的模型"
          subtitle={
            imageModels.length === 0
              ? "0 个 → 用后端默认 IMAGE_MODEL 跑;选 N 个 → cells 按 (query × skill × model) 三维笛卡尔积展开"
              : imageModels.length === 1
                ? "单模型 → cells = N query × M skill"
                : `${imageModels.length} 个模型 → cells 数量 ×${imageModels.length}`
          }
        >
          <ImageModelGrid value={imageModels} onChange={setImageModels} />
        </Section>
      )}

      {/* 4. 评分维度 */}
      <Section
        title="评分维度"
        subtitle="跑完后人工打分用。每个维度 0-5 分,排行榜按维度独立聚合。"
      >
        <div className="space-y-2">
          {dims.map((d, i) => (
            <div key={i} className="flex items-start gap-2">
              <input
                value={d.id}
                onChange={(e) => updateDim(i, { id: e.target.value })}
                placeholder="id (slug)"
                className="h-9 w-32 rounded-md border border-border-warm bg-ivory px-2 font-mono text-[12.5px] focus:border-terracotta focus:outline-none"
              />
              <input
                value={d.label}
                onChange={(e) => updateDim(i, { label: e.target.value })}
                placeholder="维度名(显示用)"
                className="h-9 w-48 rounded-md border border-border-warm bg-ivory px-2 text-[13px] focus:border-terracotta focus:outline-none"
              />
              <input
                value={d.description}
                onChange={(e) =>
                  updateDim(i, { description: e.target.value })
                }
                placeholder="描述(打分时提示自己)"
                className="h-9 flex-1 rounded-md border border-border-warm bg-ivory px-2 text-[13px] focus:border-terracotta focus:outline-none"
              />
              <button
                onClick={() => removeDim(i)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-warm bg-ivory text-stone-gray transition hover:border-error-crimson hover:text-error-crimson"
                title="删除"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            onClick={addDim}
            className="flex h-9 items-center gap-2 rounded-md border border-dashed border-border-warm bg-ivory px-3 text-[12.5px] text-olive-gray transition hover:border-terracotta hover:text-terracotta"
          >
            <Plus size={14} />
            添加维度
          </button>
        </div>
      </Section>

      {/* 5. 提交 */}
      <div className="sticky bottom-4 z-10 mt-8 flex items-center justify-between rounded-md border border-border-warm bg-ivory/95 px-5 py-3 shadow-sm backdrop-blur">
        <div className="text-[13px] text-olive-gray">
          将创建{" "}
          <strong className="text-near-black">
            {queries.length} query × {secondDimLen}{" "}
            {testKind === "pipeline" ? "pipeline" : "skill"} = {totalCells}
          </strong>{" "}
          个 cell · 16 路并发 ·{" "}
          <span className="text-stone-gray">
            {testKind === "pipeline"
              ? "改写模型 pipeline 默认"
              : `改写模型 ${llmModel || "默认"}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {createError && (
            <span className="text-[12.5px] text-error-crimson">
              {createError}
            </span>
          )}
          <button
            onClick={() => setView({ kind: "list" })}
            className="h-9 rounded-md border border-border-warm bg-ivory px-4 text-[13px] text-olive-gray transition hover:text-near-black"
          >
            取消
          </button>
          <button
            onClick={onCreate}
            disabled={creating || queries.length === 0 || secondDimLen === 0}
            className="flex h-9 items-center gap-2 rounded-md bg-terracotta px-5 text-[13px] font-medium text-ivory transition hover:bg-terracotta/90 disabled:opacity-50"
          >
            {creating && <Loader2 size={14} className="animate-spin" />}
            创建并开跑
          </button>
        </div>
      </div>
    </>
  );
}

// 给 set 模式筛选 dropdown 用。"全部"对应 value=""。
function FilterDropdown({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { name: string; count: number }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[12px] text-olive-gray">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-border-warm bg-ivory px-2.5 py-1.5 text-[12.5px] text-near-black focus:border-terracotta focus:outline-none disabled:opacity-50"
      >
        <option value="">全部</option>
        {options.map((o) => (
          <option key={o.name} value={o.name}>
            {o.name} ({o.count})
          </option>
        ))}
      </select>
    </div>
  );
}

function Section({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border-cream bg-ivory p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-medium text-near-black">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-[12.5px] text-stone-gray">{subtitle}</p>
          )}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {children}
    </section>
  );
}
