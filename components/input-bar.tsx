// prompt-rewriter/components/input-bar.tsx
"use client";

import { useAtom, useSetAtom, useAtomValue, useStore } from "jotai";
import { ArrowRight, Loader2 } from "lucide-react";
import {
  queryAtom,
  isRunningAtom,
  rewriteResultAtom,
  lastRawAtom,
  runErrorAtom,
  currentHistoryIdAtom,
  currentRewriteDetailAtom,
  baselineJobAtom,
  optimizedJobAtom,
  skillMdAtom,
  skillsIndexAtom,
  hardRulesAtom,
  verticalHintsAtom,
  modelProfileMdAtom,
  targetModelAtom,
  llmModelAtom,
} from "@/lib/atoms";
import { RewriteResultSchema, type RewriteResult, type HistoryItem } from "@/lib/schema";
import { startImageJob } from "@/lib/image-job";
import { INITIAL_IMAGE_JOB } from "@/lib/atoms";
import { djb2Hash } from "@/lib/persist-history";
import {
  writeHistoryRun,
  summarizeRewriteResult,
} from "@/lib/history-write";
import {
  historyIndexAtom,
  historyIndexLoadedAtom,
} from "@/lib/atoms-history-index";
import { useEffect } from "react";

/** 将累积 buffer 切成 SSE 事件,返回剩余未完整的尾巴。 */
function splitSseEvents(buffer: string): { events: string[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  return { events: parts, rest };
}

function parseDataLine(event: string): unknown | null {
  const line = event.split("\n").find((l) => l.startsWith("data:"));
  if (!line) return null;
  const payload = line.slice(5).trim();
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export function InputBar() {
  const [query, setQuery] = useAtom(queryAtom);
  const [isRunning, setRunning] = useAtom(isRunningAtom);
  const setResult = useSetAtom(rewriteResultAtom);
  const setRaw = useSetAtom(lastRawAtom);
  const setError = useSetAtom(runErrorAtom);
  const setCurrentHistoryId = useSetAtom(currentHistoryIdAtom);
  const setCurrentDetail = useSetAtom(currentRewriteDetailAtom);
  const setHistoryIndex = useSetAtom(historyIndexAtom);
  const error = useAtomValue(runErrorAtom);
  // 新历史架构:不再依赖 historyAtom + ref。
  // finalize 时直接 PUT /api/history-runs/<id>(写 detail + index),
  // 同时 optimistic 在前端 historyIndex 加一条让全局历史立刻可见。
  const store = useStore();

  // 配置快照所需的 atoms(读时刻一刻的值,作为 config_snapshot)
  const skillMd = useAtomValue(skillMdAtom);
  const skillsIndex = useAtomValue(skillsIndexAtom);
  const hardRules = useAtomValue(hardRulesAtom);
  const verticalHints = useAtomValue(verticalHintsAtom);
  const modelProfileMd = useAtomValue(modelProfileMdAtom);
  const targetModel = useAtomValue(targetModelAtom);
  const llmModel = useAtomValue(llmModelAtom);

  // 两路并行生图:这里只负责触发(写 atom),轮询由 image-card 里的 poller hook 承担。
  // 所以这边只拿 setter,不订阅状态,避免重复挂轮询。
  const setBaseline = useSetAtom(baselineJobAtom);
  const setOptimized = useSetAtom(optimizedJobAtom);

  const triggerOptimized = async (result: Partial<RewriteResult>) => {
    const fp = result.final_prompt;
    if (!fp?.prompt?.trim()) return;
    // final_prompt 已经和 gpt-image-2 原生请求体同构
    void startImageJob(setOptimized, {
      prompt: fp.prompt,
      size: fp.size,
      quality: fp.quality,
      n: fp.n,
      output_format: fp.output_format,
    });
  };

  const run = async () => {
    const q = query.trim();
    if (!q || isRunning) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setRaw(null);
    // 摘掉旧轮次的左栏高亮,等 done 事件里落入新 history 再重新点亮
    setCurrentHistoryId(null);
    setBaseline(INITIAL_IMAGE_JOB);
    setOptimized(INITIAL_IMAGE_JOB);

    // 每一次 done 路径(strict / soft / parse fail)最终都要落一条历史。新历史架构:
    //   1. 直接 PUT /api/history-runs/<id> 写 detail 文件 + 同步全局索引(原子)
    //   2. 前端 optimistic 在 historyIndex 加一条 → 顶栏全局历史立刻可见
    //   3. setCurrentRewriteDetail → 让 image-card 完成时 patch image_jobs 字段
    // 三条路径共用一个终结器避免逻辑漂移。
    const finalizeHistory = (result: Partial<RewriteResult>) => {
      const id = crypto.randomUUID();
      const ts = Date.now();
      const newItem = {
        id,
        ts,
        query: q,
        result,
        config_snapshot: {
          skill_id: skillsIndex.active ?? "",
          skill_md_hash: djb2Hash(skillMd),
          hard_rules: hardRules,
          vertical_hints: verticalHints,
          model_profile_hash: djb2Hash(modelProfileMd),
          target_model: targetModel,
          rewrite_llm: llmModel,
        },
        image_jobs: {},
      } satisfies Partial<HistoryItem> & { id: string; ts: number; query: string };

      setCurrentHistoryId(id);
      setCurrentDetail(newItem);

      // 写新历史架构:写 detail + 同步索引。失败不阻塞 UI(已经 atom 里有了)。
      const summary = summarizeRewriteResult(result);
      void writeHistoryRun({
        id,
        lab_id: "rewrite",
        detail: newItem,
        index_patch: {
          query: q,
          summary,
          status: "completed",
        },
      }).then((r) => {
        if (!r.ok) console.warn("[input-bar] history 写入失败:", r.error);
      });

      // optimistic 把这条加进 historyIndex,顶栏全局历史立刻可见。
      const indexLoaded = store.get(historyIndexLoadedAtom);
      if (indexLoaded) {
        const cur = store.get(historyIndexAtom);
        setHistoryIndex([
          {
            id,
            ts,
            lab_id: "rewrite",
            query: q,
            summary,
            status: "completed",
            ref: `data/labs/rewrite/runs/${id}.json`,
            pm_score_avg: null,
            pm_score_count: 0,
            metadata: {},
          },
          ...cur,
        ]);
      }
    };

    // ───── baseline:立刻用原始 query 打 API,和改写流程并行跑
    // 参数刻意不传 —— gateway 会兜底成 auto/medium/1/png,等同于"用户直接 POST"的体验。
    // 两路对比的主要是 prompt 文本差异;如果 optimized 的 final_prompt 选了非默认参数,
    // 那也是"改写流程"附带的提升。
    void startImageJob(setBaseline, { prompt: q });

    try {
      const resp = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, llm_model: llmModel || undefined }),
      });

      if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => "");
        setError(text || `HTTP ${resp.status}`);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const { events, rest } = splitSseEvents(buffer);
        buffer = rest;

        for (const ev of events) {
          type SchemaWarning = { phase: "analysis" | "compose"; message: string };
          const data = parseDataLine(ev) as
            | { type: "started" }
            | { type: "phase"; phase: "analysis" | "compose" }
            | { type: "partial"; result: unknown; schema_warnings?: SchemaWarning[] }
            | {
                type: "done";
                result: unknown;
                raw: string;
                soft?: boolean;
                schema_warnings?: SchemaWarning[];
                schema_error?: string;
              }
            | {
                type: "error";
                error: string;
                raw?: string;
                schema_warnings?: SchemaWarning[];
                schema_error?: string;
                partial?: unknown;
              }
            | null;
          if (!data) continue;

          if (data.type === "partial") {
            setResult(data.result as never);
          } else if (data.type === "phase") {
            // 阶段切换事件留作未来 UI 进度用,目前不渲染
          } else if (data.type === "done") {
            setRaw(data.raw ?? null);
            let finalResult: Partial<RewriteResult> | null = null;
            if (data.soft) {
              // schema 部分字段挂掉但已有可用数据:不报红,只在 console 留下 warnings
              finalResult = data.result as Partial<RewriteResult>;
              setResult(finalResult as never);
              if (data.schema_warnings?.length) {
                console.warn(
                  "[rewrite] soft done with schema warnings:",
                  data.schema_warnings
                );
              }
              finalizeHistory(finalResult);
            } else {
              try {
                const parsed = RewriteResultSchema.parse(data.result);
                finalResult = parsed;
                setResult(parsed);
                finalizeHistory(parsed);
              } catch (e) {
                finalResult = data.result as Partial<RewriteResult>;
                setResult(data.result as never);
                console.warn("[rewrite] strict parse failed, keeping partial:", e);
                finalizeHistory(finalResult);
              }
            }
            // 自动触发 optimized 路(不阻塞 stream 读取)
            if (finalResult?.final_prompt?.prompt) {
              void triggerOptimized(finalResult);
            }
          } else if (data.type === "error") {
            setError(data.error);
            if (data.raw) setRaw(data.raw);
            if (data.partial) setResult(data.partial as never);
            if (data.schema_warnings?.length) {
              console.error("[rewrite] error with warnings:", data.schema_warnings);
            }
          }
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  return (
    <section className="rounded-lg border border-border-cream bg-ivory p-7 shadow-whisper">
      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="贴上用户真实写给你的那句话,不用修饰。例:小红书种草封面,珍珠奶茶,粉色少女风,夏日清凉感,3:4"
        className="block min-h-[160px] w-full resize-y bg-transparent font-sans text-[16px] leading-[1.6] text-near-black placeholder:text-stone-gray focus:outline-none"
      />
      <div className="mt-4 flex items-center justify-between border-t border-border-cream pt-4">
        <div className="font-mono text-[12px] text-stone-gray">
          字符数:{query.length}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setQuery("")}
            disabled={isRunning}
            className="h-9 rounded-sm bg-warm-sand px-3 text-[14px] font-medium text-charcoal-warm shadow-ring transition hover:shadow-ring-prom disabled:opacity-50"
          >
            清空
          </button>
          <button
            onClick={run}
            disabled={isRunning || !query.trim()}
            className="flex h-10 items-center gap-2 rounded-md bg-terracotta px-4 text-[15px] font-medium text-ivory shadow-ring-cta transition hover:opacity-95 disabled:opacity-60"
          >
            {isRunning ? (
              <>
                改写中,7 步实时流出… <Loader2 size={16} className="animate-spin" />
              </>
            ) : (
              <>
                开始改写 <ArrowRight size={16} />
                <span className="ml-1 font-mono text-[12px] opacity-60">⌘↵</span>
              </>
            )}
          </button>
        </div>
      </div>
      {error && (
        <div className="mt-3 rounded-md bg-coral-deep-bg p-3 text-[14px] text-error-crimson">
          {error}
        </div>
      )}
    </section>
  );
}
