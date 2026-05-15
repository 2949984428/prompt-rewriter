// prompt-rewriter/components/labs/pipeline/lab.tsx
//
// Pipeline 两步流水线 · 端到端测试
// ─────────────────────────────────────────────────────────────────────
// 流程对齐线上工具(2026-05-13 调整 step 编号:CreationPlanner 升为 step2):
//   Step 1 · search_intent_classification → SearchIntentResult
//   Step 2 · creation_planner → 拆 N 个 function_call(prompt + size)
//   ─ strategy_pack(数据加载,跟 Step 2 平行,无独立编号)
//   Step 3 · media_prompt_review → reviewed[] 字段表 prompt
//   Step 4 · generate_media → 每个 reviewed.prompt 一张图

"use client";

import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { llmModelAtom, llmModelOptionsAtom } from "@/lib/atoms";
import {
  imageGeneratorOptionsAtom,
  imageGeneratorDefaultAtom,
  type ImageGeneratorOption,
} from "@/lib/atoms-shared";
import {
  pipelineSearchModelAtom,
  pipelineReviewModelAtom,
  pipelineImageModelAtom,
  pipelineStreamMailboxAtom,
} from "@/lib/atoms-pipeline";
import { selectedExperimentIdAtom } from "@/lib/atoms-experiments";
import { currentLabAtom } from "@/lib/atoms-format";
import { LlmModelSwitcher } from "@/components/llm-model-switcher";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InfoIcon } from "@/components/labs/pipeline/info-icon";
import { MdPreview } from "@/components/drawer/md-preview";
import { HoverCopyButton } from "@/components/ui/hover-copy-button";
import { ImageUploader } from "@/components/image-uploader";
import type {
  Generation,
  PipelineResponse,
  Reviewed,
} from "@/components/labs/pipeline/types";

// 预设 case
const PRESET_CASES = [
  {
    id: "T1",
    label: "T1 · 淘宝详情页",
    query: "做淘宝详情页 5 张图,包装保持一致,要高级感,主图带「夏季新品 20% off」",
    function_call_count: 5,
    note: "电商 / 淘宝 / 多图 / 含文字",
  },
  {
    id: "T2",
    label: "T2 · 小红书封面",
    query: "小红书封面:标题「这家店绝了」,下方写「3 杯不踩雷推荐」",
    function_call_count: 1,
    note: "社媒 / 小红书 / 文字主导",
  },
  {
    id: "T3",
    label: "T3 · 亚马逊主图",
    query: "亚马逊主图,纯白底,产品要够大",
    function_call_count: 1,
    note: "电商 / 亚马逊 / 平台硬规则",
  },
  {
    id: "T4",
    label: "T4 · Logo 探索",
    query: "给我做个 logo,品牌叫'晨光咖啡',要现代极简",
    function_call_count: 1,
    note: "品牌 / logo / 无参考图",
  },
  {
    id: "T5",
    label: "T5 · IG carousel",
    query: "做 7 张 IG carousel,主题是夏季咖啡饮品,要小红书种草感",
    function_call_count: 7,
    note: "社媒 / IG / 跨美学",
  },
];

export function PipelineLab() {
  const llmModel = useAtomValue(llmModelAtom);
  const [searchModel, setSearchModel] = useAtom(pipelineSearchModelAtom);
  const [reviewModel, setReviewModel] = useAtom(pipelineReviewModelAtom);
  const [imageModel, setImageModel] = useAtom(pipelineImageModelAtom);
  // 生图模型清单 bootstrap(独立于 ImageModelSwitcher,该组件没在 Pipeline lab 头里)
  const [imageOptions, setImageOptions] = useAtom(imageGeneratorOptionsAtom);
  const setImageDefault = useSetAtom(imageGeneratorDefaultAtom);
  useEffect(() => {
    if (imageOptions.length > 0) return;
    let aborted = false;
    (async () => {
      try {
        const r = await fetch("/api/image-generators");
        if (!r.ok) return;
        const json = (await r.json()) as {
          default: string;
          items: ImageGeneratorOption[];
        };
        if (aborted) return;
        setImageOptions(json.items);
        setImageDefault(json.default);
      } catch {
        // 拉不到忽略,picker 直接不渲染
      }
    })();
    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [query, setQuery] = useState("");

  // 接收 GenerationCard 的手动重试事件,转交给同一份 reducer
  const mailbox = useAtomValue(pipelineStreamMailboxAtom);
  useEffect(() => {
    if (!mailbox) return;
    handleStreamPhase({ phase: mailbox.phase, data: mailbox.data });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailbox?._seq]);
  const [fcCount, setFcCount] = useState(1);
  const [doGenerate, setDoGenerate] = useState(true);
  // 2026-05-13:勾选后跑批同时跑一份直出(planner 原始 prompt 跳过 SP2),DirectCompareCard 显示对比
  const [compareDirect, setCompareDirect] = useState(false);
  // 2026-05-13:上传参考图(图生图模式)。空数组 = 文生图,非空 = 透传给 step3 各生图请求
  // useR2Upload 模式下,value 里存 R2 公网 URL 而非 base64
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  // 上传中(R2 put):跑批按钮置灰,避免用户在图还没传完就触发 POST
  const [refUploading, setRefUploading] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Partial<PipelineResponse> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 跳转到 Experiments 详情(P3a):落盘完成后顶栏出"📌 跳到实验记录"按钮
  const setSelectedExperimentId = useSetAtom(selectedExperimentIdAtom);
  const setCurrentLab = useSetAtom(currentLabAtom);
  function jumpToExperiment(id: string) {
    setSelectedExperimentId(id);
    setCurrentLab("experiments");
  }

  async function runPipeline() {
    if (!query.trim()) {
      setError("query 不能为空");
      return;
    }
    setError(null);
    setRunning(true);
    setResult({}); // 进入"等待 stream 阶段事件"状态,各 Card 立刻渲染 pending/running
    try {
      const resp = await fetch("/api/labs/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(),
          llm_model: llmModel,
          llm_model_search: searchModel || undefined,
          llm_model_review: reviewModel || undefined,
          image_model: imageModel || undefined,
          function_call_count: fcCount,
          do_generate: doGenerate,
          also_run_direct: compareDirect,
          uploaded_image_urls: referenceImages.length > 0 ? referenceImages : undefined,
        }),
      });
      if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${text}`);
      }

      // NDJSON 流式消费:一行一条事件,按 phase 分类增量更新 result。
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg: { phase: string; data: unknown };
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          handleStreamPhase(msg);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function handleStreamPhase(msg: { phase: string; data: unknown }) {
    const data = msg.data as Record<string, unknown>;
    if (msg.phase === "fatal") {
      setError(typeof data.error === "string" ? data.error : "pipeline stream fatal");
      return;
    }
    setResult((prev) => {
      const next: Partial<PipelineResponse> = { ...(prev ?? {}) };
      switch (msg.phase) {
        case "start":
          next.query = data.query as string;
          break;
        case "step1":
          next.step1 = data as PipelineResponse["step1"];
          break;
        case "strategy_pack":
          next.strategy_pack = data as PipelineResponse["strategy_pack"];
          break;
        case "creation_planner":
          next.creation_planner = data as PipelineResponse["creation_planner"];
          break;
        case "step2":
          next.step2 = data as PipelineResponse["step2"];
          break;
        case "step3_start":
          next.step3 = {
            generations: [],
            elapsed_ms: 0,
            skipped: false,
            image_model: (data.image_model as string | null) ?? null,
          };
          break;
        case "step3_item_progress": {
          // 重试中:upsert 这条 generation 的"重试态"占位 / 更新
          const prevS3 = next.step3 ?? { generations: [], elapsed_ms: 0, skipped: false };
          const idx = prevS3.generations.findIndex((g) => g.id === (data.id as string));
          const placeholder: Generation = {
            id: data.id as string,
            prompt: (data.prompt as string) ?? prevS3.generations[idx]?.prompt ?? "",
            image_urls: [],
            error: null,
            elapsed_ms: 0,
            status: "retrying",
            attempt: data.attempt as number,
            max_attempts: data.max_attempts as number,
            last_error: (data.last_error as string | null) ?? null,
            manual_retry: (data.manual_retry as boolean) ?? false,
          };
          const nextGens =
            idx >= 0
              ? prevS3.generations.map((g, i) =>
                  i === idx
                    ? { ...g, ...placeholder, prompt: g.prompt || placeholder.prompt }
                    : g,
                )
              : [...prevS3.generations, placeholder];
          next.step3 = { ...prevS3, generations: nextGens };
          break;
        }
        case "step3_item": {
          // 终态(done / failed):upsert,把重试态字段清掉
          const prevS3 = next.step3 ?? { generations: [], elapsed_ms: 0, skipped: false };
          const incoming = data as Generation;
          const idx = prevS3.generations.findIndex((g) => g.id === incoming.id);
          const merged: Generation = {
            ...prevS3.generations[idx],
            ...incoming,
          };
          const nextGens =
            idx >= 0
              ? prevS3.generations.map((g, i) => (i === idx ? merged : g))
              : [...prevS3.generations, incoming];
          next.step3 = { ...prevS3, generations: nextGens };
          break;
        }
        case "step3_done": {
          const prevS3 = next.step3 ?? { generations: [], elapsed_ms: 0, skipped: false };
          next.step3 = {
            ...prevS3,
            elapsed_ms: (data.elapsed_ms as number) ?? 0,
            skipped: (data.skipped as boolean) ?? false,
          };
          break;
        }
        // ─── API 直出对比 phases(逻辑跟 step3_* 对称,写入 step3_direct) ───
        case "direct_start": {
          next.step3_direct = {
            generations: [],
            elapsed_ms: 0,
            image_model: (data.image_model as string | null) ?? null,
          };
          break;
        }
        case "direct_item_progress": {
          const prev = next.step3_direct ?? {
            generations: [],
            elapsed_ms: 0,
            image_model: null,
          };
          const idx = prev.generations.findIndex((g) => g.id === (data.id as string));
          const placeholder: Generation = {
            id: data.id as string,
            prompt: (data.prompt as string) ?? prev.generations[idx]?.prompt ?? "",
            image_urls: [],
            error: null,
            elapsed_ms: 0,
            status: "retrying",
            attempt: data.attempt as number,
            max_attempts: data.max_attempts as number,
            last_error: (data.last_error as string | null) ?? null,
            manual_retry: (data.manual_retry as boolean) ?? false,
          };
          const nextGens =
            idx >= 0
              ? prev.generations.map((g, i) =>
                  i === idx
                    ? { ...g, ...placeholder, prompt: g.prompt || placeholder.prompt }
                    : g,
                )
              : [...prev.generations, placeholder];
          next.step3_direct = { ...prev, generations: nextGens };
          break;
        }
        case "direct_item": {
          const prev = next.step3_direct ?? {
            generations: [],
            elapsed_ms: 0,
            image_model: null,
          };
          const incoming = data as Generation;
          const idx = prev.generations.findIndex((g) => g.id === incoming.id);
          const merged: Generation = {
            ...prev.generations[idx],
            ...incoming,
          };
          const nextGens =
            idx >= 0
              ? prev.generations.map((g, i) => (i === idx ? merged : g))
              : [...prev.generations, incoming];
          next.step3_direct = { ...prev, generations: nextGens };
          break;
        }
        case "direct_done": {
          const prev = next.step3_direct ?? {
            generations: [],
            elapsed_ms: 0,
            image_model: null,
          };
          next.step3_direct = {
            ...prev,
            elapsed_ms: (data.elapsed_ms as number) ?? 0,
          };
          break;
        }
        case "done":
          next.total_elapsed_ms = (data.total_elapsed_ms as number) ?? 0;
          if (Array.isArray(data.trace)) {
            next.trace = data.trace as PipelineResponse["trace"];
          }
          if (
            data.strategy_versions &&
            typeof data.strategy_versions === "object"
          ) {
            next.strategy_versions = data.strategy_versions as Record<
              string,
              string
            >;
          }
          break;
        case "experiment_saved":
          if (typeof data.id === "string") next.experiment_id = data.id;
          break;
        case "experiment_save_failed":
          // 落盘失败不挡前端使用,仅 console 提示(NDJSON 后续 done 仍会到)
          console.warn(
            "[pipeline] experiment_save_failed:",
            typeof data.error === "string" ? data.error : data,
          );
          break;
      }
      return next;
    });
  }

  return (
    <TooltipProvider delay={150}>
    <div className="min-w-0 flex-1 space-y-10">
      {/* Header */}
      <header className="flex items-start justify-between gap-6">
        <div className="flex items-center gap-2">
          <h1 className="font-serif text-[32px] font-medium leading-[1.2] text-near-black">
            Pipeline 两步端到端测试
          </h1>
          <InfoIcon hint="对齐线上工具流:search_intent_classification → CreationPlanner → media_prompt_review → generate_media。可观测分类输出 / 加载策略包 / 改写后字段表 prompt / 生图结果。" />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 pt-2">
          <div className="flex items-center gap-1.5">
            <LlmModelSwitcher />
            <InfoIcon hint="全局默认模型,跨实验台共享。Pipeline 两步可以各自在下方 query 输入区单独指定模型,留空则回退到这个默认值。" />
          </div>
        </div>
      </header>

      {/* 预设 case */}
      <section className="space-y-3">
        <h3 className="font-sans text-[14px] font-semibold uppercase tracking-wider text-stone-gray">
          预设测试 Case
        </h3>
        <div className="flex flex-wrap gap-2">
          {PRESET_CASES.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setQuery(c.query);
                setFcCount(c.function_call_count);
                setResult(null);
                setError(null);
              }}
              className="rounded-md border border-border-cream bg-ivory px-4 py-2 text-left text-[13px] text-near-black transition hover:border-terracotta/40 hover:bg-warm-sand/40"
              title={c.note}
            >
              <div className="font-medium">{c.label}</div>
              <div className="mt-0.5 text-[11px] text-stone-gray">{c.note}</div>
            </button>
          ))}
        </div>
      </section>

      {/* 输入 + 参数 */}
      <section className="space-y-3">
        <label className="font-sans text-[14px] font-semibold uppercase tracking-wider text-stone-gray">
          User Query
        </label>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="贴入用户的 query,或从上方预设 case 选一个"
          rows={3}
          className="w-full rounded-lg border border-border-cream bg-ivory px-4 py-3 font-mono text-[14px] text-near-black placeholder:text-stone-gray focus:border-terracotta focus:outline-none"
        />
        {/* 参考图(图生图模式):空 = 文生图;非空 = 透传给 Step 4 各生图请求 */}
        <ImageUploader
          value={referenceImages}
          onChange={setReferenceImages}
          label="参考图(可选,图生图)"
          hint="上传文件 / Cmd+V 粘贴图片 → R2 拿公网 URL;或直接粘贴外部图片 URL(http/https)。"
          useR2Upload
          onBusyChange={setRefUploading}
          enableUrlInput
          enablePaste
        />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-stone-gray">
            <PerStepModelPicker
              label="SP1 意图分类"
              value={searchModel}
              onChange={setSearchModel}
              fallback={llmModel || "默认"}
              hint="search_intent_classification 用的 LLM,留空回退到右上角全局默认。"
            />
            <PerStepModelPicker
              label="SP2 改写"
              value={reviewModel}
              onChange={setReviewModel}
              fallback={llmModel || "默认"}
              hint="media_prompt_review 用的 LLM,留空回退到右上角全局默认。两步用不同模型可以做「快意图判断 + 强改写」这种成本-质量分层。"
            />
            <PerStepImageModelPicker
              value={imageModel}
              onChange={setImageModel}
              options={imageOptions}
              hint="Step 4 生图模型。内部网关(gpt-image-2)/ Lovart 文生图 / Lovart 图生图都可选,留空走 gpt-image-2。"
            />
            <label className="flex items-center gap-2">
              <span>Function call 数:</span>
              <input
                type="number"
                min={1}
                max={6}
                value={fcCount}
                onChange={(e) => setFcCount(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
                className="w-14 rounded border border-border-cream bg-ivory px-2 py-1 font-mono text-[12px] text-near-black focus:border-terracotta focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={doGenerate}
                onChange={(e) => setDoGenerate(e.target.checked)}
                className="h-4 w-4 accent-terracotta"
              />
              <span>调生图 (Step 4)</span>
            </label>
            <label
              className="flex items-center gap-2"
              title="勾选后,跟 SP2 改写后同时跑一份直出(planner 原始 prompt 跳过 SP2),并排显示扩写前后对比"
            >
              <input
                type="checkbox"
                checked={compareDirect}
                onChange={(e) => setCompareDirect(e.target.checked)}
                disabled={!doGenerate}
                className="h-4 w-4 accent-terracotta disabled:opacity-40"
              />
              <span>对比扩写前后</span>
              <InfoIcon hint="勾选后,跑批同时跑一份直出(planner 原始 prompt 跳过 SP2 改写)。两侧并排显示,直观感受 SP2 改写策略对画面的实际增益。" />
            </label>
          </div>
          <button
            onClick={runPipeline}
            disabled={running || refUploading || !query.trim()}
            title={
              refUploading
                ? "参考图上传中,等上传完成再跑批"
                : !query.trim()
                  ? "先输入 query"
                  : "跑完整 Pipeline"
            }
            className="rounded-md bg-terracotta px-6 py-2.5 text-[14px] font-medium text-white shadow-ring transition hover:bg-terracotta/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running
              ? "Pipeline 跑批中..."
              : refUploading
                ? "参考图上传中..."
                : "跑 Pipeline"}
          </button>
        </div>
        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            ⚠ {error}
          </div>
        )}
      </section>

      {(running || result) && (
        <section className="space-y-6">
          <StrategyVersionBar
            versions={result?.strategy_versions}
            experimentId={result?.experiment_id}
            onJumpExperiment={jumpToExperiment}
          />
          <Step1Card running={running} step1={result?.step1} />
          <CreationPlannerCard
            running={running}
            planner={result?.creation_planner}
          />
          <Step2Card
            running={running}
            step2={result?.step2}
            strategyPack={result?.strategy_pack}
          />
          <Step3Card
            running={running}
            step3={result?.step3}
            expectedCount={result?.step2?.review_result?.reviewed.length}
            referenceImages={referenceImages}
          />
          {(compareDirect || result?.step3_direct) && (
            <DirectCompareCard
              running={running}
              step3={result?.step3}
              step3Direct={result?.step3_direct}
              planner={result?.creation_planner}
              reviewed={result?.step2?.review_result?.reviewed}
              query={query}
            />
          )}
          {result?.total_elapsed_ms !== undefined && (
            <div className="text-right text-[12px] text-stone-gray">
              总耗时 {result.total_elapsed_ms} ms · step1 意图{" "}
              {result.step1?.elapsed_ms ?? 0}ms · step2 CreationPlanner{" "}
              {result.creation_planner?.elapsed_ms ?? 0}ms · 加载策略{" "}
              {result.strategy_pack?.elapsed_ms ?? 0}ms · step3 改写{" "}
              {result.step2?.elapsed_ms ?? 0}ms · step4 生图{" "}
              {result.step3?.elapsed_ms ?? 0}ms
            </div>
          )}
        </section>
      )}
    </div>
    </TooltipProvider>
  );
}

// ─────────── 顶栏:策略版本 chip + 跳实验记录按钮 ───────────
// 跑批结束(done 事件)后:左 chip 行展示当次跑批用的 4 个版本号;
// 落盘成功(experiment_saved 事件)后:右侧按钮亮起,点击跳 Experiments 详情。
function StrategyVersionBar({
  versions,
  experimentId,
  onJumpExperiment,
}: {
  versions?: Record<string, string>;
  experimentId?: string;
  onJumpExperiment: (id: string) => void;
}) {
  // 跑批中 / 还没收到 done,这一行整体不渲染
  if (!versions && !experimentId) return null;
  const chipEntries = versions
    ? (Object.entries(versions) as Array<[string, string]>)
    : [];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-cream bg-parchment/60 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <span className="font-mono uppercase tracking-wider text-stone-gray">
          本次跑批版本
        </span>
        {chipEntries.length === 0 ? (
          <span className="text-stone-gray">—</span>
        ) : (
          chipEntries.map(([ns, ver]) => (
            <span
              key={ns}
              className="rounded-sm bg-ivory px-1.5 py-0.5 font-mono text-near-black shadow-ring"
              title={`${ns} = ${ver}`}
            >
              {ns}: {ver}
            </span>
          ))
        )}
      </div>
      {experimentId ? (
        <button
          onClick={() => onJumpExperiment(experimentId)}
          className="rounded-md bg-terracotta px-3 py-1.5 text-[12px] font-medium text-ivory transition hover:opacity-90"
          title={experimentId}
        >
          📌 跳到实验记录
        </button>
      ) : versions ? (
        <span className="text-[11px] italic text-stone-gray">
          experiment 落盘中…
        </span>
      ) : null}
    </div>
  );
}

// ─────────── Step 1 Card · search_intent_classification ───────────
export function Step1Card({
  running,
  step1,
}: {
  running: boolean;
  step1?: PipelineResponse["step1"];
}) {
  const status = !step1 ? (running ? "running" : "pending") : step1.error ? "error" : "done";
  return (
    <StepShell
      stepNum={1}
      title="search_intent_classification (= pre 1)"
      subtitle="user query → SearchIntentResult (has_search_intent / search_type / intent_confidence / vertical / platform)"
      status={status}
      elapsedMs={step1?.elapsed_ms}
      llmModel={step1?.llm_model}
    >
      {step1?.error && (
        <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          ⚠ {step1.error}
        </div>
      )}
      {step1?.search_intent ? (
        <div className="overflow-x-auto rounded-md border border-border-cream bg-parchment p-4">
          <MdPreview source={asCodeFence(JSON.stringify(step1.search_intent, null, 2), "json")} />
        </div>
      ) : running ? (
        <PendingHint text="调用 LLM 中..." />
      ) : null}
      {step1?.raw && (
        <details className="mt-3 text-[12px]">
          <summary className="cursor-pointer text-terracotta">展开 LLM 原始输出</summary>
          <div className="mt-2 overflow-x-auto rounded-md border border-border-cream bg-parchment p-3">
            <RawOutputViewer source={step1.raw} />
          </div>
        </details>
      )}
    </StepShell>
  );
}

// ─────────── Step 2 Card · CreationPlanner(2026-05-13 从 Agent 链路环节升级为正式 step2) ───────────
export function CreationPlannerCard({
  running,
  planner,
}: {
  running: boolean;
  planner?: PipelineResponse["creation_planner"];
}) {
  const status = !planner
    ? running
      ? "running"
      : "pending"
    : planner.fallback
      ? "error"
      : "done";
  return (
    <StepShell
      stepNum={2}
      title="creation_planner"
      subtitle="Gemini 3 拆 N 个 function_call 草稿(prompt + size 启发式)。失败兜底:fallback mock + size=1024x1024。"
      status={status}
      elapsedMs={planner?.elapsed_ms}
      llmModel={planner?.llm_model}
    >
      {planner?.fallback && (
        <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          ⚠ LLM 推理失败,fallback mock:{planner.fallback}
        </div>
      )}
      {planner ? (
        <div className="space-y-3">
          <div className="text-[12px] text-olive-gray">
            拆出 {planner.function_calls.length} 个 function_call 草稿
          </div>
          <div className="space-y-2">
            {planner.function_calls.map((fc, i) => (
              <div
                key={fc.id}
                className="rounded-md border border-border-cream bg-parchment p-3"
              >
                <div className="mb-1.5 flex items-baseline gap-3">
                  <span className="font-mono text-[11px] text-stone-gray">
                    #{i + 1}
                  </span>
                  <span className="font-mono text-[11px] text-stone-gray">
                    {fc.id}
                  </span>
                  {fc.size && (
                    <span className="rounded-sm bg-warm-sand/60 px-1.5 py-0.5 font-mono text-[10.5px] text-charcoal-warm">
                      {fc.size}
                    </span>
                  )}
                </div>
                <PromptBlock text={fc.prompt} />
              </div>
            ))}
          </div>
          <details className="text-[12px]">
            <summary className="cursor-pointer text-terracotta">展开原始 JSON</summary>
            <div className="mt-2 overflow-x-auto rounded-md border border-border-cream bg-parchment p-3">
              <MdPreview source={asCodeFence(JSON.stringify(planner.function_calls, null, 2), "json")} />
            </div>
          </details>
        </div>
      ) : running ? (
        <PendingHint text="调用 LLM 中..." />
      ) : null}
    </StepShell>
  );
}

// ─────────── Step 3 Card · media_prompt_review(原 step2,2026-05-13 顺延) ───────────
export function Step2Card({
  running,
  step2,
  strategyPack,
}: {
  running: boolean;
  step2?: PipelineResponse["step2"];
  strategyPack?: PipelineResponse["strategy_pack"];
}) {
  const status = !step2
    ? running
      ? "running"
      : "pending"
    : step2.error
      ? "error"
      : "done";
  return (
    <StepShell
      stepNum={3}
      title="media_prompt_review (= pre 2)"
      subtitle="读 search_intent + 加载垂类策略包 → 改写 N 个 function call 的 prompt → reviewed[]"
      status={status}
      elapsedMs={step2?.elapsed_ms}
      llmModel={step2?.llm_model}
    >
      {step2?.error && (
        <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          ⚠ {step2.error}
        </div>
      )}

      {/* 加载的策略包 */}
      {strategyPack && (
        <details className="mb-4 text-[12px]" open={!step2?.review_result}>
          <summary className="cursor-pointer text-terracotta">
            展开本次加载的垂类策略包 (vertical_standard + platform_tone)
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-md border border-border-cream bg-parchment/40 p-3">
              <div className="mb-2 font-semibold text-near-black">
                垂类通用标准 · vertical = {strategyPack.vertical_standard.vertical}
                {strategyPack.vertical_standard.label && (
                  <span className="ml-1 text-stone-gray">
                    ({strategyPack.vertical_standard.label})
                  </span>
                )}
              </div>
              {strategyPack.vertical_standard.standards.length > 0 ? (
                <ul className="list-inside list-disc space-y-1 text-near-black">
                  {strategyPack.vertical_standard.standards.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-stone-gray">(无)</div>
              )}
            </div>
            <div className="rounded-md border border-border-cream bg-parchment/40 p-3">
              <div className="mb-2 font-semibold text-near-black">
                平台调性 · platform = {strategyPack.platform_tone.platform}
                {strategyPack.platform_tone.label && (
                  <span className="ml-1 text-stone-gray">
                    ({strategyPack.platform_tone.label})
                  </span>
                )}
              </div>
              {strategyPack.platform_tone.tone.length > 0 ? (
                <ul className="list-inside list-disc space-y-1 text-near-black">
                  {strategyPack.platform_tone.tone.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-stone-gray">(无)</div>
              )}
            </div>
          </div>
        </details>
      )}

      {/* reviewed 数组 */}
      {step2?.review_result && (
        <div className="space-y-4">
          <div className="text-[12px] text-olive-gray">
            改写完 {step2.review_result.reviewed.length} 个 prompt
          </div>
          {step2.review_result.reviewed.map((r, i) => (
            <div
              key={r.id}
              className="rounded-md border border-border-cream bg-parchment p-4"
            >
              <div className="mb-2 flex items-baseline gap-3">
                <span className="font-mono text-[11px] text-stone-gray">#{i + 1}</span>
                <span className="font-mono text-[11px] text-stone-gray">{r.id}</span>
              </div>
              <PromptBlock text={r.prompt} />
            </div>
          ))}
        </div>
      )}

      {step2?.composed_system && (
        <details className="mt-3 text-[12px]">
          <summary className="cursor-pointer text-terracotta">
            展开本次合成的完整 SP2 system(已注入 vertical/platform bullets)
          </summary>
          <div className="mt-2 max-h-[500px] overflow-auto rounded-md border border-border-cream bg-parchment p-3">
            <MdPreview source={step2.composed_system} />
          </div>
        </details>
      )}
      {step2?.raw && (
        <details className="mt-3 text-[12px]">
          <summary className="cursor-pointer text-terracotta">展开 LLM 原始输出</summary>
          <div className="mt-2 overflow-x-auto rounded-md border border-border-cream bg-parchment p-3">
            <RawOutputViewer source={step2.raw} />
          </div>
        </details>
      )}

      {!step2?.review_result && running && <PendingHint text="加载策略包 + LLM 改写中..." />}
    </StepShell>
  );
}

// ─────────── Step 4 Card · generate_media(原 step3,2026-05-13 顺延) ───────────
export function Step3Card({
  running,
  step3,
  expectedCount,
  readOnly = false,
  referenceImages,
}: {
  running: boolean;
  step3?: PipelineResponse["step3"];
  readOnly?: boolean;
  expectedCount?: number;
  /** 上传的参考图(图生图)。retry 单格时透传给后端,保证手动重试链路跟首跑一致。
   *  experiments replay 时不传(老 record 没存 reference_images)。 */
  referenceImages?: string[];
}) {
  if (step3?.skipped) {
    return (
      <div className="rounded-lg border border-dashed border-border-cream bg-parchment/30 px-6 py-4 text-[13px] text-stone-gray">
        Step 4 · generate_media 已跳过(输入区取消勾选)
      </div>
    );
  }
  // 流式中:step3 已开始但 elapsed_ms 还是 0 + skipped=false → 进行中
  const streamingInProgress =
    !!step3 && step3.elapsed_ms === 0 && !step3.skipped;
  const status =
    !step3
      ? running
        ? "running"
        : "pending"
      : streamingInProgress
        ? "running"
        : step3.generations.length > 0 && step3.generations.every((g) => g.error)
          ? "error"
          : "done";
  const receivedCount = step3?.generations.length ?? 0;
  const total = expectedCount ?? receivedCount;
  return (
    <StepShell
      stepNum={4}
      title="generate_media (端到端验证)"
      subtitle="用每个 reviewed.prompt 调生图(quality=medium, n=1),并发执行。流式渲染:每张图回来就显示。"
      status={status}
      elapsedMs={step3?.elapsed_ms || undefined}
      llmModel={step3?.image_model}
    >
      {streamingInProgress && total > 0 && (
        <div className="mb-3 text-[12px] text-stone-gray">
          已收到 {receivedCount} / {total} 张...
        </div>
      )}
      {step3?.generations && step3.generations.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {step3.generations.map((g, i) => (
            <GenerationCard
              key={g.id}
              g={g}
              idx={i}
              imageModel={step3.image_model ?? null}
              readOnly={readOnly}
              referenceImages={referenceImages}
            />
          ))}
        </div>
      ) : running ? (
        <PendingHint text="调 gpt-image-2 中（~15-40s/张，并发跑）..." />
      ) : (
        <div className="text-[12px] text-stone-gray">无生图结果</div>
      )}
    </StepShell>
  );
}

// ─────────── API 直出对比卡(2026-05-13) ───────────
//
// 用途:PM 直观对比 SP2 改写策略对画面的实际增益。
//
// 两种布局模式(根据 step3_direct.generations 内容自动判断):
//   - "query 直出"(当前默认,id="direct_query"):左侧 1 张大图(原始 query + 参考图直出),
//     右侧 N 张扩写图(SP2 改写)。1 vs N 不对称对比
//   - "planner 直出"(旧方案,保留):按 function_call.id 配对,左右各 N 张
//
// 只在 step3_direct 存在时渲染(由父级条件守卫)。
export function DirectCompareCard({
  running,
  step3,
  step3Direct,
  planner,
  reviewed,
  query,
}: {
  running: boolean;
  step3?: PipelineResponse["step3"];
  step3Direct?: PipelineResponse["step3_direct"];
  planner?: PipelineResponse["creation_planner"];
  reviewed?: Reviewed[];
  /** 用户原始 query(query 直出模式渲染 prompt 用) */
  query?: string;
}) {
  const status =
    !step3Direct || step3Direct.elapsed_ms === 0
      ? running
        ? "running"
        : "pending"
      : step3Direct.generations.length > 0 &&
          step3Direct.generations.every((g) => g.error)
        ? "error"
        : "done";

  // 按 id 索引方便配对
  const directById = new Map(
    (step3Direct?.generations ?? []).map((g) => [g.id, g]),
  );
  const rewrittenById = new Map(
    (step3?.generations ?? []).map((g) => [g.id, g]),
  );
  const reviewedById = new Map((reviewed ?? []).map((r) => [r.id, r]));
  const fcs = planner?.function_calls ?? [];

  // 模式判断:有 id="direct_query" → query 直出模式;否则 fallback 老的 planner 配对
  const queryDirectCell = directById.get("direct_query");
  const isQueryDirectMode = !!queryDirectCell;

  // 手动重试 callback —— direct 那侧 10 次失败时可触发。复用 mailbox 模式,
  // 走 /api/labs/pipeline/retry-image,phase 经过 direct_* 重映射写回 step3_direct
  const postMailbox = useSetAtom(pipelineStreamMailboxAtom);
  const retrySeqRef = useRef(0);
  async function retryDirectCell(cell: Generation, sizeHint: string) {
    const idForUI = cell.id;
    // 乐观更新:推一条 retrying 进入 mailbox(phase remap 成 direct_item_progress)
    retrySeqRef.current += 1;
    postMailbox({
      phase: "direct_item_progress",
      data: {
        id: idForUI,
        attempt: 1,
        max_attempts: 10,
        status: "retrying",
        last_error: null,
        manual_retry: true,
        size: sizeHint,
        prompt: cell.prompt,
      },
      _seq: retrySeqRef.current,
    });
    try {
      const resp = await fetch("/api/labs/pipeline/retry-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: idForUI,
          prompt: cell.prompt,
          size: sizeHint || "1024x1024",
        }),
      });
      if (!resp.ok || !resp.body) {
        retrySeqRef.current += 1;
        postMailbox({
          phase: "direct_item",
          data: {
            id: idForUI,
            prompt: cell.prompt,
            image_urls: [],
            error: `HTTP ${resp.status}`,
            elapsed_ms: 0,
            status: "failed",
          },
          _seq: retrySeqRef.current,
        });
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            // 后端 retry-image emit step3_item_progress / step3_item → 重映射到 direct_*
            const remapped = msg.phase.replace(/^step3_/, "direct_");
            retrySeqRef.current += 1;
            postMailbox({ phase: remapped, data: msg.data, _seq: retrySeqRef.current });
          } catch {
            /* skip */
          }
        }
      }
    } catch {
      retrySeqRef.current += 1;
      postMailbox({
        phase: "direct_item",
        data: {
          id: idForUI,
          prompt: cell.prompt,
          image_urls: [],
          error: "网络错误",
          elapsed_ms: 0,
          status: "failed",
        },
        _seq: retrySeqRef.current,
      });
    }
  }

  return (
    <div className="rounded-xl border border-border-cream bg-ivory p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h3 className="flex items-center gap-1.5 font-serif text-[20px] font-medium text-near-black">
          <span className="mr-1 inline-block rounded-md bg-warm-sand px-2 py-0.5 text-[14px] font-semibold">
            对比
          </span>
          API 直出 vs SP2 扩写
          <InfoIcon hint="用 CreationPlanner 原始 prompt 跳过 SP2 直接生图,跟 Step 4 的扩写后产物按 function_call.id 配对显示,直观感受 SP2 改写策略的画面增益。" />
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          {step3Direct?.image_model && (
            <span className="rounded-full border border-border-cream bg-parchment/60 px-2.5 py-0.5 font-mono text-[10.5px] text-stone-gray">
              {step3Direct.image_model}
            </span>
          )}
          <span className="rounded-full bg-warm-sand/60 px-3 py-1 text-[11px] font-medium">
            {status === "running"
              ? "直出中..."
              : status === "done"
                ? `完成 · ${step3Direct?.elapsed_ms ?? 0}ms`
                : status === "error"
                  ? "全部失败"
                  : "待执行"}
          </span>
        </div>
      </div>

      {fcs.length === 0 ? (
        <PendingHint text="等 CreationPlanner 出结果..." />
      ) : isQueryDirectMode ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* 左:用户 query 直出(1 张) */}
          <div className="space-y-2 rounded-lg border border-border-cream bg-parchment/30 p-4">
            <div className="flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-wider text-stone-gray">
              <span className="rounded-sm bg-warm-sand/60 px-1.5 py-0.5 font-mono text-[10.5px] text-charcoal-warm">
                直出
              </span>
              <span>用户原始 query + 参考图</span>
            </div>
            <DirectImageBlock
              g={queryDirectCell}
              fallback="等直出..."
              onRetry={
                queryDirectCell
                  ? () =>
                      retryDirectCell(
                        queryDirectCell,
                        fcs[0]?.size || "1024x1024",
                      )
                  : undefined
              }
            />
            {query && (
              <details className="text-[12px]" open>
                <summary className="cursor-pointer text-terracotta">
                  query prompt
                </summary>
                <div className="mt-2 rounded-md border border-border-cream bg-ivory p-3">
                  <PromptBlock text={query} />
                </div>
              </details>
            )}
          </div>
          {/* 右:扩写 N 张(网格,跟 Step 4 同源) */}
          <div className="space-y-2 rounded-lg border border-border-cream bg-parchment/30 p-4">
            <div className="flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-wider text-stone-gray">
              <span className="rounded-sm bg-terracotta/15 px-1.5 py-0.5 font-mono text-[10.5px] text-terracotta">
                扩写
              </span>
              <span>SP2 改写 prompt(N 张)</span>
            </div>
            <div className="space-y-3">
              {fcs.map((fc, i) => {
                const rewritten = rewrittenById.get(fc.id);
                const reviewedItem = reviewedById.get(fc.id);
                return (
                  <div
                    key={fc.id}
                    className="overflow-hidden rounded-md border border-border-cream bg-ivory"
                  >
                    <div className="flex items-baseline gap-2 border-b border-border-cream bg-parchment/60 px-3 py-1.5">
                      <span className="font-mono text-[11px] text-stone-gray">
                        #{i + 1}
                      </span>
                      <span className="truncate font-mono text-[11px] text-stone-gray">
                        {fc.id}
                      </span>
                    </div>
                    <div className="p-3">
                      <DirectImageBlock
                        g={rewritten}
                        fallback="主 Pipeline 未跑或未出图"
                      />
                      {reviewedItem && (
                        <details className="mt-2 text-[12px]">
                          <summary className="cursor-pointer text-terracotta">
                            prompt
                          </summary>
                          <div className="mt-2 rounded-md border border-border-cream bg-parchment/30 p-2">
                            <PromptBlock text={reviewedItem.prompt} />
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        // 旧布局:planner 方案,按 fc.id 配对 N vs N。DIRECT_MODE 切回 "planner" 时启用
        <div className="space-y-5">
          {fcs.map((fc, i) => {
            const direct = directById.get(fc.id);
            const rewritten = rewrittenById.get(fc.id);
            const reviewedItem = reviewedById.get(fc.id);
            return (
              <div
                key={fc.id}
                className="overflow-hidden rounded-lg border border-border-cream bg-parchment/30"
              >
                <div className="flex items-baseline gap-3 border-b border-border-cream bg-parchment/60 px-4 py-2">
                  <span className="font-mono text-[11px] text-stone-gray">
                    #{i + 1}
                  </span>
                  <span className="font-mono text-[11px] text-stone-gray">
                    {fc.id}
                  </span>
                  {fc.size && (
                    <span className="rounded-sm bg-warm-sand/60 px-1.5 py-0.5 font-mono text-[10.5px] text-charcoal-warm">
                      {fc.size}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
                  {/* 左:直出 */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-wider text-stone-gray">
                      <span className="rounded-sm bg-warm-sand/60 px-1.5 py-0.5 font-mono text-[10.5px] text-charcoal-warm">
                        直出
                      </span>
                      <span>API 原始 prompt</span>
                    </div>
                    <DirectImageBlock
                      g={direct}
                      fallback="等直出..."
                      onRetry={
                        direct
                          ? () => retryDirectCell(direct, fc.size || "1024x1024")
                          : undefined
                      }
                    />
                    <details className="text-[12px]">
                      <summary className="cursor-pointer text-terracotta">
                        prompt
                      </summary>
                      <div className="mt-2 rounded-md border border-border-cream bg-ivory p-3">
                        <PromptBlock text={fc.prompt} />
                      </div>
                    </details>
                  </div>
                  {/* 右:扩写后 */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-wider text-stone-gray">
                      <span className="rounded-sm bg-terracotta/15 px-1.5 py-0.5 font-mono text-[10.5px] text-terracotta">
                        扩写
                      </span>
                      <span>SP2 改写 prompt</span>
                    </div>
                    <DirectImageBlock
                      g={rewritten}
                      fallback="主 Pipeline 未跑或未出图"
                    />
                    {reviewedItem && (
                      <details className="text-[12px]">
                        <summary className="cursor-pointer text-terracotta">
                          prompt
                        </summary>
                        <div className="mt-2 rounded-md border border-border-cream bg-ivory p-3">
                          <PromptBlock text={reviewedItem.prompt} />
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 直出 / 扩写后通用图块:done → img;retrying → 重试中 + 进度;failed → error;无 → fallback
function DirectImageBlock({
  g,
  fallback,
  onRetry,
}: {
  g?: Generation;
  fallback: string;
  /** 失败态(10 次重试用完)展示手动重试按钮;不传 = 无按钮 */
  onRetry?: () => void | Promise<void>;
}) {
  if (!g) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border-cream bg-parchment/40 text-[12px] text-stone-gray">
        {fallback}
      </div>
    );
  }
  if (g.status === "retrying") {
    return (
      <div className="flex aspect-square items-center justify-center rounded-md border border-terracotta/30 bg-ivory text-[11.5px] text-terracotta">
        重试 {g.attempt}/{g.max_attempts}...
      </div>
    );
  }
  if (g.error || g.image_urls.length === 0) {
    return (
      <div className="flex aspect-square flex-col items-center justify-center gap-3 rounded-md border border-red-300 bg-red-50 px-3 text-center text-[11.5px] text-red-700">
        <div className="line-clamp-4">⚠ {g.error?.slice(0, 120) ?? "无图"}</div>
        {onRetry && (
          <button
            onClick={() => onRetry()}
            className="rounded-md border border-terracotta bg-ivory px-3 py-1.5 text-[12px] font-medium text-terracotta transition hover:bg-warm-sand/40"
            title="重新跑一次 image gateway,10 次 fibonacci 重试"
          >
            🔁 手动重试
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="group relative overflow-hidden rounded-md border border-border-cream bg-ivory">
      <a
        href={g.image_urls[0]}
        target="_blank"
        rel="noreferrer"
        className="block"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={g.image_urls[0]}
          alt=""
          className="block w-full cursor-zoom-in object-contain"
        />
      </a>
      <HoverCopyButton src={g.image_urls[0]} />
    </div>
  );
}

// ─────────── Step Shell ───────────
function StepShell({
  stepNum,
  title,
  subtitle,
  status,
  elapsedMs,
  llmModel,
  children,
}: {
  stepNum: number;
  title: string;
  subtitle: string;
  status: "pending" | "running" | "done" | "error";
  elapsedMs?: number;
  llmModel?: string | null;
  children: React.ReactNode;
}) {
  const statusColors = {
    pending: "border-border-cream bg-ivory text-stone-gray",
    running: "border-terracotta/40 bg-ivory text-terracotta",
    done: "border-border-cream bg-ivory text-near-black",
    error: "border-red-300 bg-ivory text-red-700",
  };
  const statusLabels = {
    pending: "待执行",
    running: "执行中...",
    done: `完成 ${elapsedMs !== undefined ? `· ${elapsedMs}ms` : ""}`,
    error: "失败",
  };
  return (
    <div className={`rounded-xl border p-6 ${statusColors[status]}`}>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h3 className="flex items-center gap-1.5 font-serif text-[20px] font-medium text-near-black">
          <span className="mr-1 inline-block rounded-md bg-warm-sand px-2 py-0.5 text-[14px] font-semibold">
            Step {stepNum}
          </span>
          {title}
          <InfoIcon hint={subtitle} />
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          {llmModel && (
            <span className="rounded-full border border-border-cream bg-parchment/60 px-2.5 py-0.5 font-mono text-[10.5px] text-stone-gray">
              {llmModel}
            </span>
          )}
          <span className="rounded-full bg-warm-sand/60 px-3 py-1 text-[11px] font-medium">
            {statusLabels[status]}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}

function PendingHint({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-border-cream bg-parchment p-4 text-[13px] text-stone-gray">
      {text}
    </div>
  );
}

// 把任意内容包成 ```lang ... ``` fence。如果已经带 fence 直接返回,避免双层 fence。
function asCodeFence(text: string, lang = "json"): string {
  const t = text.trim();
  if (!t) return "_(空)_";
  if (t.startsWith("```")) return t;
  return "```" + lang + "\n" + t + "\n```";
}

// 鲁棒 JSON 提取:对付 LLM 出在 ```json fence 里 / 前后带 prose 的情况。
// 跟 server 端 extractJsonBlock 同思路。
function extractJsonFromText(raw: string): unknown | null {
  const t = raw.trim();
  // 1. 试 fence
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fall through */
    }
  }
  // 2. 试 first { 到 last }
  const firstBrace = t.indexOf("{");
  const lastBrace = t.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(t.slice(firstBrace, lastBrace + 1));
    } catch {
      /* fall through */
    }
  }
  // 3. 直接整段
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// 字段表 / 多行 plain text 的展示器:保留换行 + 等宽 + 自动换行。
// reviewed.prompt 不是 markdown(没有 # / - 标记,只是 Brief + 字段:值 + 缩进),
// 走 markdown 渲染会把单换行压成软断,可读性反而崩。
function PromptBlock({ text }: { text: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.7] text-near-black">
      {text}
    </pre>
  );
}

// 智能渲染 LLM 原始输出:
//   1. SP2 的 {reviewed:[{id,prompt}]} shape → 拆开,每条 prompt 用 PromptBlock(保换行)
//   2. 其他能 parse 的 JSON → pretty-print + 包 ```json fence,走 MdPreview 代码块
//   3. parse 不出来 → 原样 ```text fence 兜底
function RawOutputViewer({ source }: { source: string }) {
  const parsed = extractJsonFromText(source);

  // 智能识别 SP2 输出
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "reviewed" in parsed &&
    Array.isArray((parsed as { reviewed: unknown }).reviewed)
  ) {
    const reviewed = (parsed as { reviewed: Array<{ id?: string; prompt?: string }> })
      .reviewed;
    return (
      <div className="space-y-3">
        <div className="text-[11px] text-stone-gray">
          ✓ 解析为 {reviewed.length} 个 reviewed item(prompt 字段已展开换行)
        </div>
        {reviewed.map((r, i) => (
          <div
            key={i}
            className="rounded-md border border-border-cream bg-ivory p-3"
          >
            <div className="mb-1.5 flex items-baseline gap-2 font-mono text-[10.5px] text-stone-gray">
              <span>#{i + 1}</span>
              <span>{r.id ?? "(no id)"}</span>
            </div>
            <PromptBlock text={r.prompt ?? "(空 prompt)"} />
          </div>
        ))}
      </div>
    );
  }

  // 其他 JSON 走 pretty + fence
  if (parsed !== null) {
    return (
      <MdPreview
        source={"```json\n" + JSON.stringify(parsed, null, 2) + "\n```"}
      />
    );
  }

  // 解析不了就原样兜底
  return <MdPreview source={asCodeFence(source, "text")} />;
}

// ─────────── Step 4 单个生图卡片(含手动重试) ───────────
function GenerationCard({
  g,
  idx,
  imageModel,
  readOnly = false,
  referenceImages,
}: {
  g: Generation;
  idx: number;
  imageModel: string | null;
  readOnly?: boolean;
  /** 上传的参考图(图生图模式),透传给手动重试 endpoint 保证链路跟首跑一致 */
  referenceImages?: string[];
}) {
  // 通过 mailbox atom 把 NDJSON 流的 phase 事件转发到 PipelineLab 顶层 reducer
  // (跟首轮跑批的 step3_item / step3_item_progress 走完全相同的 handleStreamPhase)
  const postMailbox = useSetAtom(pipelineStreamMailboxAtom);
  const [busy, setBusy] = useState(false);

  const seqRef = useRef(0);
  function post(phase: string, data: unknown) {
    seqRef.current += 1;
    postMailbox({ phase, data, _seq: seqRef.current });
  }

  async function retry() {
    if (busy) return;
    setBusy(true);
    try {
      const resp = await fetch("/api/labs/pipeline/retry-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: g.id,
          prompt: g.prompt,
          image_model: imageModel || undefined,
          // 透传 CreationPlanner 推的 size,缺省 fallback 1024x1024(minimax 安全公约)
          size: g.size || "1024x1024",
          // 透传图生图参考图(如果首跑跑了图生图,retry 也得走同一链路)
          reference_images:
            referenceImages && referenceImages.length > 0
              ? referenceImages
              : undefined,
        }),
      });
      if (!resp.ok || !resp.body) {
        post("step3_item", {
          id: g.id,
          prompt: g.prompt,
          image_urls: [],
          error: `HTTP ${resp.status}`,
          elapsed_ms: 0,
          status: "failed",
        });
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            post(msg.phase, msg.data);
          } catch {
            // skip
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const retrying = g.status === "retrying";
  const showRetryBtn =
    !readOnly &&
    !retrying &&
    (g.status === "failed" || (g.error && g.image_urls.length === 0));

  return (
    <div className="overflow-hidden rounded-lg border border-border-cream bg-parchment">
      {g.image_urls[0] ? (
        <div className="group relative">
          <a href={g.image_urls[0]} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={g.image_urls[0]}
              alt={`generation #${idx + 1}`}
              className="aspect-square w-full bg-white object-contain"
            />
          </a>
          <HoverCopyButton src={g.image_urls[0]} />
        </div>
      ) : retrying ? (
        <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-warm-sand/30 p-4 text-center text-[11px] text-terracotta">
          <div className="font-medium">
            {g.manual_retry ? "手动重试" : "自动重试"} {g.attempt ?? 1}/{g.max_attempts ?? 10}
          </div>
          {g.last_error && (
            <div className="line-clamp-3 max-w-full text-stone-gray">
              上次错:{g.last_error}
            </div>
          )}
        </div>
      ) : (
        <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 bg-white p-4 text-center text-[11px] text-red-600">
          <div className="line-clamp-4">⚠ {g.error ?? "无图"}</div>
          {showRetryBtn && (
            <button
              onClick={retry}
              disabled={busy}
              className="rounded-md border border-terracotta bg-ivory px-3 py-1.5 text-[12px] font-medium text-terracotta transition hover:bg-warm-sand/40 disabled:cursor-not-allowed disabled:opacity-50"
              title="重新跑一次 image gateway,10 次 fibonacci 重试"
            >
              {busy ? "重试中..." : "🔁 手动重试"}
            </button>
          )}
        </div>
      )}
      <div className="space-y-1 p-3 text-[11px]">
        <div className="flex items-center justify-between">
          <span className="font-mono text-stone-gray">#{idx + 1}</span>
          <div className="flex items-center gap-2">
            {!retrying && (g.elapsed_ms ?? 0) > 0 && (
              <span className="text-stone-gray">
                {g.elapsed_ms}ms{g.attempts && g.attempts > 1 ? ` · ${g.attempts} 次` : ""}
              </span>
            )}
            {showRetryBtn && (
              <button
                onClick={retry}
                disabled={busy}
                className="rounded-md border border-border-cream bg-ivory px-2 py-0.5 text-[10.5px] text-near-black transition hover:border-terracotta/40 hover:bg-warm-sand/40 disabled:cursor-not-allowed disabled:opacity-50"
                title="重新生成这一张"
              >
                {busy ? "..." : "🔁 重试"}
              </button>
            )}
          </div>
        </div>
        <div className="font-mono text-[10px] text-stone-gray">{g.id}</div>
        <details>
          <summary className="cursor-pointer text-terracotta">prompt</summary>
          <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border-cream bg-ivory p-2">
            <pre className="whitespace-pre-wrap break-words text-[10.5px] leading-[1.6] text-near-black">
              {g.prompt}
            </pre>
          </div>
        </details>
      </div>
    </div>
  );
}

// ─────────── Pipeline Step 4 生图模型 picker(按 provider/type 分组) ───────────
function PerStepImageModelPicker({
  value,
  onChange,
  options,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ImageGeneratorOption[];
  hint: string;
}) {
  if (options.length === 0) return null;
  const igw = options.filter((o) => o.provider === "igw");
  const lovartImage = options.filter(
    (o) => o.provider === "lovart" && o.type === "image",
  );
  const lovartModify = options.filter(
    (o) => o.provider === "lovart" && o.type === "image-modify",
  );
  return (
    <label className="flex items-center gap-1.5">
      <span>Step 4 生图模型:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[200px] rounded border border-border-cream bg-ivory px-2 py-1 font-sans text-[12px] text-near-black focus:border-terracotta focus:outline-none"
      >
        <option value="">默认 (gpt-image-2)</option>
        {igw.length > 0 && (
          <optgroup label="内部网关">
            {igw.map((o) => (
              <option key={o.name} value={o.name}>
                {o.display_name}
              </option>
            ))}
          </optgroup>
        )}
        {lovartImage.length > 0 && (
          <optgroup label="Lovart · 文生图">
            {lovartImage.map((o) => (
              <option key={o.name} value={o.name}>
                {o.display_name}
              </option>
            ))}
          </optgroup>
        )}
        {lovartModify.length > 0 && (
          <optgroup label="Lovart · 图生图">
            {lovartModify.map((o) => (
              <option key={o.name} value={o.name}>
                {o.display_name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <InfoIcon hint={hint} />
    </label>
  );
}

// ─────────── Pipeline 每步 LLM picker(支持留空 fallback) ───────────
function PerStepModelPicker({
  label,
  value,
  onChange,
  fallback,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  fallback: string;
  hint: string;
}) {
  const options = useAtomValue(llmModelOptionsAtom);
  if (options.length === 0) return null;
  return (
    <label className="flex items-center gap-1.5">
      <span>{label} 模型:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border-cream bg-ivory px-2 py-1 font-sans text-[12px] text-near-black focus:border-terracotta focus:outline-none"
      >
        <option value="">默认 ({fallback})</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <InfoIcon hint={hint} />
    </label>
  );
}
