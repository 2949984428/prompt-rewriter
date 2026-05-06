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

import { useAtom, useAtomValue } from "jotai";
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
  ScoringDimension,
} from "@/lib/schema";
import { LlmModelSwitcher } from "@/components/llm-model-switcher";
import { llmModelAtom } from "@/lib/atoms";

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
];

const DEFAULT_DIMS: ScoringDimension[] = [
  { id: "overall", label: "总体观感", description: "" },
  { id: "intent", label: "意图还原度", description: "prompt 是否抓住了用户原意" },
];

export function BatchCreateForm() {
  const [, setView] = useAtom(batchViewAtom);
  const [summaries, setSummaries] = useAtom(batchSummariesAtom);
  const [prefill, setPrefill] = useAtom(batchCreatePrefillAtom);
  const skills = useAtomValue(formatSkillsAtom);
  const llmModel = useAtomValue(llmModelAtom);

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

  // skill 选择
  const [skillIds, setSkillIds] = useState<string[]>([]);

  // 是否在每条 skill 前注入通用规则(_universal.md)。默认勾上跟历史行为一致;
  // 测试"无通用规则的纯 skill 表现"时勾掉。
  const [includeUniversal, setIncludeUniversal] = useState(true);

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
    setIncludeUniversal(prefill.include_universal);
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
    return [];
  };

  const validate = (): string | null => {
    const queries = computeQueries();
    if (queries.length === 0) return "至少要有 1 条 query";
    if (skillIds.length === 0) return "至少选 1 个 skill";
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
      const queries = computeQueries();
      const r = await fetch("/api/labs/batch/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          query_mode: mode,
          purpose: mode === "derive" ? purpose : "",
          queries,
          skill_ids: skillIds,
          scoring_dimensions: dims,
          rewrite_llm: llmModel || "",
          include_universal: includeUniversal,
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
      // 列表里塞一条新 summary(乐观)
      setSummaries([
        {
          id: record.id,
          created_at: record.created_at,
          name: record.name,
          query_mode: record.query_mode,
          status: "running",
          n_queries: record.queries.length,
          n_skills: record.skill_ids.length,
          done_cells: 0,
          total_cells: record.cells.length,
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
  const totalCells = queries.length * skillIds.length;

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
          <LlmModelSwitcher />
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
      </Section>

      {/* 3. 选 skill */}
      <Section title="参与 Skill" subtitle="复用格式实验台已有的 skill 池">
        {skills.length === 0 ? (
          <p className="text-[13px] text-stone-gray">正在加载 skill…</p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {skills.map((s) => {
              const on = skillIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() =>
                    setSkillIds((ids) =>
                      ids.includes(s.id)
                        ? ids.filter((x) => x !== s.id)
                        : [...ids, s.id]
                    )
                  }
                  className={`flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition ${
                    on
                      ? "border-terracotta bg-coral-soft-bg/40"
                      : "border-border-cream bg-ivory hover:border-border-warm"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
                      on
                        ? "border-terracotta bg-terracotta"
                        : "border-stone-gray"
                    }`}
                  >
                    {on && (
                      <span className="h-2 w-2 rounded-[1px] bg-ivory" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[12.5px] font-medium text-near-black">
                      {s.label}
                    </div>
                    {s.notes && (
                      <div className="mt-0.5 truncate text-[11.5px] text-stone-gray">
                        {s.notes}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* 通用规则可选注入 — 默认勾上跟历史行为一致;关掉验证"纯 skill 无通用规则" 输出表现 */}
        <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-md border border-border-cream bg-parchment/40 px-3 py-2.5 text-[13px] transition hover:border-border-warm">
          <input
            type="checkbox"
            checked={includeUniversal}
            onChange={(e) => setIncludeUniversal(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-terracotta"
          />
          <div className="flex-1">
            <div className="font-medium text-near-black">
              在每条 skill 前注入通用规则 (<code className="font-mono text-[11.5px]">_universal.md</code>)
            </div>
            <div className="mt-0.5 text-[11.5px] leading-[1.5] text-stone-gray">
              默认勾上 (5 条通用纪律 + 输出前自检)。
              想验证"只有 skill 自身规则、不带通用约束" 的输出表现时勾掉。
              对所有 skill 全局生效,不区分单个 skill。
            </div>
          </div>
        </label>
      </Section>

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
            {queries.length} query × {skillIds.length} skill = {totalCells}
          </strong>{" "}
          个 cell · 16 路并发 ·{" "}
          <span className="text-stone-gray">改写模型 {llmModel || "默认"}</span>
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
            disabled={creating || queries.length === 0 || skillIds.length === 0}
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

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border-cream bg-ivory p-5">
      <div className="mb-3">
        <h2 className="text-[15px] font-medium text-near-black">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-[12.5px] text-stone-gray">{subtitle}</p>
        )}
      </div>
      {children}
    </section>
  );
}
