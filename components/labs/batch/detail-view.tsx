// prompt-rewriter/components/labs/batch/detail-view.tsx
//
// 详情页:首屏 GET 拉一次完整 record → 接 SSE 增量 patch。
//
// SSE 协议:
//   event:cell      → 找对应 cell 应用 patch
//   event:progress  → 写 batchProgressAtom
//   event:finished  → 关 SSE,顺手 PATCH summaries 那条变 finished

"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  Pencil,
  Check,
  X,
  Download,
  ExternalLink,
  AlertTriangle,
  EyeOff,
  Upload,
  Copy,
  CircleStop,
} from "lucide-react";
import {
  batchViewAtom,
  currentBatchRunAtom,
  batchProgressAtom,
  batchSummariesAtom,
  batchCreatePrefillAtom,
} from "@/lib/atoms-batch";
import type { BatchRunRecord, BatchCell } from "@/lib/schema";
import { BatchGridView } from "./grid-view";
import { BatchScoreDrawer } from "./score-drawer";
import { BatchLeaderboard } from "./leaderboard";

const MODE_LABEL: Record<BatchRunRecord["query_mode"], string> = {
  derive: "AI 派生",
  manual: "自填",
  repeat: "重复",
};

export function BatchDetailView({ id }: { id: string }) {
  const [, setView] = useAtom(batchViewAtom);
  const [record, setRecord] = useAtom(currentBatchRunAtom);
  const [progress, setProgress] = useAtom(batchProgressAtom);
  const [, setSummaries] = useAtom(batchSummariesAtom);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 1. 拉首屏 record
  useEffect(() => {
    let cancelled = false;
    setRecord(null);
    setProgress(null);
    setLoadError(null);
    (async () => {
      try {
        const r = await fetch(`/api/labs/batch/runs/${id}`, {
          cache: "no-store",
        });
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        const j = (await r.json()) as BatchRunRecord;
        if (!cancelled) setRecord(j);
      } catch (e) {
        if (!cancelled) setLoadError(String(e));
      }
    })();
    return () => {
      cancelled = true;
      setRecord(null);
      setProgress(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 2. SSE 订阅(record 拿到 + 还在 running 时才订阅;finished / cancelled 已 terminal,不连)
  useEffect(() => {
    if (!record) return;
    if (record.status === "finished" || record.status === "cancelled") return;

    const es = new EventSource(`/api/labs/batch/runs/${id}/stream`);

    es.addEventListener("cell", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          query_idx: number;
          skill_id: string;
          patch: Partial<BatchCell>;
        };
        setRecord((prev) => {
          if (!prev) return prev;
          const idx = prev.cells.findIndex(
            (c) =>
              c.query_idx === data.query_idx && c.skill_id === data.skill_id
          );
          if (idx < 0) return prev;
          const cells = [...prev.cells];
          cells[idx] = { ...cells[idx], ...data.patch };
          return { ...prev, cells };
        });
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("progress", (ev) => {
      try {
        const p = JSON.parse((ev as MessageEvent).data);
        setProgress(p);
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("finished", () => {
      // 标 record.status,关 ES;同步 summaries 那条
      setRecord((prev) => (prev ? { ...prev, status: "finished" } : prev));
      setSummaries((arr) =>
        arr.map((s) =>
          s.id === id
            ? { ...s, status: "finished", done_cells: s.total_cells }
            : s
        )
      );
      es.close();
    });

    es.onerror = () => {
      // 连接断了就关掉,前端回退到"按按钮重新拉 record"
      es.close();
    };

    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id, record?.status]);

  const refresh = async () => {
    try {
      const r = await fetch(`/api/labs/batch/runs/${id}`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const j = (await r.json()) as BatchRunRecord;
      setRecord(j);
    } catch {
      /* ignore */
    }
  };

  if (loadError) {
    return (
      <div className="rounded-md border border-error-crimson bg-coral-soft-bg/30 p-6">
        <p className="text-[14px] text-error-crimson">加载失败:{loadError}</p>
        <button
          onClick={() => setView({ kind: "list" })}
          className="mt-3 text-[13px] underline"
        >
          返回列表
        </button>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="flex h-40 items-center justify-center text-stone-gray">
        <Loader2 size={20} className="animate-spin" />
        <span className="ml-2 text-[13px]">加载中…</span>
      </div>
    );
  }

  const p = progress ?? {
    done: record.cells.filter((c) => c.status === "done").length,
    failed: record.cells.filter((c) => c.status === "failed").length,
    excluded: record.cells.filter((c) => c.status === "excluded").length,
    total: record.cells.length,
  };
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;

  return (
    <>
      <header className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-3">
          <button
            onClick={() => setView({ kind: "list" })}
            className="mt-1 flex h-8 w-8 items-center justify-center rounded-md border border-border-warm bg-ivory text-stone-gray transition hover:text-near-black"
            title="返回列表"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <EditableTitle
              value={record.name}
              onSave={async (next) => {
                const trimmed = next.trim();
                if (trimmed === record.name) return;
                try {
                  const r = await fetch(
                    `/api/labs/batch/runs/${record.id}`,
                    {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: trimmed }),
                    }
                  );
                  if (!r.ok) throw new Error(`HTTP ${r.status}`);
                  const fresh = (await r.json()) as BatchRunRecord;
                  setRecord(fresh);
                  // 同步列表
                  setSummaries((arr) =>
                    arr.map((s) =>
                      s.id === record.id ? { ...s, name: fresh.name } : s
                    )
                  );
                } catch (e) {
                  console.warn("[batch] rename failed", e);
                  throw e;
                }
              }}
            />
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-stone-gray">
              <span>{MODE_LABEL[record.query_mode]}</span>
              <span>·</span>
              <span>{record.queries.length} query × {record.skill_ids.length} skill</span>
              <span>·</span>
              <span>改写模型 {record.rewrite_llm || "默认"}</span>
              <span>·</span>
              <span>{new Date(record.created_at).toLocaleString("zh-CN")}</span>
            </p>
            {record.purpose && (
              <p className="mt-1.5 max-w-[680px] text-[13px] italic text-olive-gray">
                目的:{record.purpose}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          <DuplicateRunButton record={record} />
          <ExportButton runId={record.id} />
          <BlindExportButton runId={record.id} />
          <ImportPicksButton
            runId={record.id}
            onImported={(fresh) => setRecord(fresh)}
          />
          <LarkExportButton runId={record.id} runName={record.name} />
          <button
            onClick={refresh}
            className="flex h-9 items-center gap-2 rounded-md border border-border-warm bg-ivory px-3 text-[13px] text-olive-gray transition hover:text-near-black"
          >
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      </header>

      {/* 进度条 */}
      <div className="rounded-md border border-border-cream bg-ivory px-5 py-3">
        <div className="flex items-center justify-between gap-3 text-[12.5px]">
          <span className="font-medium text-near-black">
            {record.status === "running" && (
              <Loader2
                size={14}
                className="mr-1.5 inline animate-spin text-warm-gold-fg"
              />
            )}
            {p.done}/{p.total} 完成
            {p.failed > 0 && (
              <span className="ml-3 text-error-crimson">{p.failed} 失败</span>
            )}
            {p.excluded > 0 && (
              <span className="ml-3 text-stone-gray">
                {p.excluded} 已排除
              </span>
            )}
          </span>
          <div className="flex items-center gap-3">
            {record.status === "running" && (
              <StopRunButton runId={record.id} pendingCount={p.total - p.done - p.failed - p.excluded} />
            )}
            {p.failed > 0 && <RetryAllFailedButton runId={record.id} failedCount={p.failed} />}
            <span className="text-stone-gray">{pct}%</span>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border-cream">
          <div
            className="h-full bg-terracotta transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* 矩阵 */}
      <BatchGridView />

      {/* 排行榜:跑完 / 已取消才显示(任务还在跑时分数没法算稳;cancelled 也允许看部分排行) */}
      {(record.status === "finished" || record.status === "cancelled") && <BatchLeaderboard />}

      {/* 评分抽屉 */}
      <BatchScoreDrawer />
    </>
  );
}

// ─────────── EditableTitle ───────────
//
// 默认显示 h1,鼠标移上去露一个铅笔提示;点击 / 双击进入编辑态。
// 编辑态:input + 保存 / 取消两个按钮;Enter = 保存,Esc = 取消,blur 也保存。
// 保存中禁用 input,失败回退到原值。

function EditableTitle({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // 防止 blur 与显式保存按钮的双重触发
  const savingRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const enter = () => {
    setDraft(value);
    setEditing(true);
    queueMicrotask(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const commit = async () => {
    if (savingRef.current) return;
    const next = draft.trim();
    if (next === value) {
      setEditing(false);
      return;
    }
    if (next.length === 0) {
      // 空名直接取消(后端虽然允许空字符串,但 UI 上不鼓励)
      cancel();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      // 失败保留编辑态,让用户重试或取消
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={enter}
        className="group flex items-center gap-2 text-left"
        title="点击重命名"
      >
        <h1
          className={`font-serif text-[26px] font-medium leading-[1.2] ${
            value ? "text-near-black" : "text-stone-gray italic"
          }`}
        >
          {value || "(未命名 — 点这里改名)"}
        </h1>
        <Pencil
          size={14}
          className="text-stone-gray opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => void commit()}
        disabled={saving}
        placeholder="给这次测试起个名字…"
        className="h-10 min-w-[320px] flex-1 rounded-md border border-terracotta bg-ivory px-2 font-serif text-[24px] font-medium leading-[1.2] text-near-black focus:outline-none disabled:opacity-60"
      />
      <button
        onMouseDown={(e) => {
          // 阻止 input blur 在 click 之前发生导致重复保存
          e.preventDefault();
        }}
        onClick={() => void commit()}
        disabled={saving}
        className="flex h-9 w-9 items-center justify-center rounded-md bg-terracotta text-ivory transition hover:bg-terracotta/90 disabled:opacity-60"
        title="保存(Enter)"
      >
        {saving ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Check size={14} />
        )}
      </button>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={cancel}
        disabled={saving}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-border-warm bg-ivory text-stone-gray transition hover:text-near-black"
        title="取消(Esc)"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ─────── 导出按钮(HTML / ZIP / 数据包) ───────
// 主按钮:auto 格式,文案带"推荐格式 + 估算大小"。
// 旁边 ▾ 展开:强制 HTML / ZIP / 数据包(给在线平台) / 含已排除 cell。
type CsvFailure = { sample_id: string; reason: string; status?: number; code?: string };
type CsvResult = {
  csv?: string;
  filename?: string;
  stats?: {
    rows_total: number;
    uploaded: number;
    skipped: number;
    failures: CsvFailure[];
  };
  error?: string;
  hint?: string;
};

function ExportButton({ runId }: { runId: string }) {
  const [info, setInfo] = useState<{
    format: "html" | "zip";
    bytes: number;
    cells: number;
  } | null>(null);
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // CSV 失败 dialog(0 失败时不弹)
  const [csvDialog, setCsvDialog] = useState<{
    result: CsvResult;
    mode: "local-proxy" | "r2";
  } | null>(null);
  // CSV 模式下是 r2 上传需要的 loading,跟通用 busy 分开避免混淆 dropdown 状态
  const [csvBusy, setCsvBusy] = useState<"local-proxy" | "r2" | null>(null);

  useEffect(() => {
    const url = `/api/labs/batch/runs/${runId}/export${
      includeExcluded ? "?include_excluded=1" : ""
    }`;
    fetch(url, { method: "HEAD" })
      .then((r) => {
        if (!r.ok) return;
        const fmt = r.headers.get("X-Recommended-Format") as
          | "html"
          | "zip"
          | null;
        const bytes = Number(r.headers.get("X-Estimated-Bytes") ?? 0);
        const cells = Number(r.headers.get("X-Visible-Cells") ?? 0);
        if (fmt) setInfo({ format: fmt, bytes, cells });
      })
      .catch(() => {});
  }, [runId, includeExcluded]);

  const triggerDownload = (path: string) => {
    setBusy(true);
    const link = document.createElement("a");
    link.href = path;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setMenuOpen(false);
    setTimeout(() => setBusy(false), 1000);
  };

  const triggerExport = (force?: "html" | "zip") => {
    const params = new URLSearchParams();
    params.set("format", force ?? "auto");
    if (includeExcluded) params.set("include_excluded", "1");
    triggerDownload(`/api/labs/batch/runs/${runId}/export?${params.toString()}`);
  };

  // CSV 流程:fetch JSON → 0 失败直接 blob 下载;有失败弹 dialog 让用户决策
  const triggerCsvExport = async (mode: "local-proxy" | "r2") => {
    setCsvBusy(mode);
    setMenuOpen(false);
    try {
      const r = await fetch(`/api/labs/batch/runs/${runId}/export-data?mode=${mode}`);
      const result = (await r.json()) as CsvResult;
      if (!r.ok) {
        setCsvDialog({ result, mode });
        return;
      }
      const failureCount = result.stats?.failures?.length ?? 0;
      if (failureCount === 0) {
        // 无失败:直接下载,不弹 dialog
        downloadCsvBlob(result.csv ?? "", result.filename ?? "data.csv");
      } else {
        // 有失败:弹 dialog 让用户决策
        setCsvDialog({ result, mode });
      }
    } catch (e) {
      setCsvDialog({
        result: { error: e instanceof Error ? e.message : String(e) },
        mode,
      });
    } finally {
      setCsvBusy(null);
    }
  };

  const sizeStr = info ? humanBytes(info.bytes) : "…";
  const fmtStr = info?.format ? info.format.toUpperCase() : "auto";

  return (
    <div className="relative">
      <div className="flex items-stretch overflow-hidden rounded-md border border-border-warm bg-ivory">
        <button
          onClick={() => triggerExport()}
          disabled={busy || !info}
          title={
            info
              ? `${info.cells} cell · 推荐 ${fmtStr} · 约 ${sizeStr}`
              : "导出本次跑批"
          }
          className="flex h-9 items-center gap-2 px-3 text-[13px] font-medium text-near-black transition hover:bg-warm-sand/40 disabled:cursor-wait disabled:opacity-50"
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} />
          )}
          导出
          {info && (
            <span className="font-mono text-[11px] text-stone-gray">
              {fmtStr} · {sizeStr}
            </span>
          )}
        </button>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-9 w-7 items-center justify-center border-l border-border-warm text-stone-gray transition hover:bg-warm-sand/40 hover:text-near-black"
          title="更多选项"
        >
          <span className="text-[10px]">▾</span>
        </button>
      </div>
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-0 top-10 z-40 w-60 overflow-hidden rounded-md border border-border-warm bg-ivory shadow-md">
            <button
              onClick={() => triggerExport("html")}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] text-near-black transition hover:bg-warm-sand/40"
            >
              <span>强制单文件 HTML</span>
              <span className="font-mono text-[11px] text-stone-gray">.html</span>
            </button>
            <button
              onClick={() => triggerExport("zip")}
              className="flex w-full items-center justify-between border-t border-border-cream px-3 py-2 text-left text-[13px] text-near-black transition hover:bg-warm-sand/40"
            >
              <span>强制 ZIP 包</span>
              <span className="font-mono text-[11px] text-stone-gray">.zip</span>
            </button>
            <button
              onClick={() => triggerCsvExport("local-proxy")}
              disabled={csvBusy != null}
              className="flex w-full flex-col items-start border-t border-border-cream px-3 py-2 text-left text-[13px] text-near-black transition hover:bg-warm-sand/40 disabled:cursor-wait disabled:opacity-50"
            >
              <div className="flex w-full items-center justify-between">
                <span>
                  {csvBusy === "local-proxy" && (
                    <Loader2 size={12} className="mr-1.5 inline animate-spin" />
                  )}
                  CSV (本机 URL)
                </span>
                <span className="font-mono text-[11px] text-stone-gray">.csv</span>
              </div>
              <span className="text-[11px] text-stone-gray">
                image 列指 localhost,只在本机或同内网可达
              </span>
            </button>
            <button
              onClick={() => triggerCsvExport("r2")}
              disabled={csvBusy != null}
              className="flex w-full flex-col items-start border-t border-border-cream px-3 py-2 text-left text-[13px] text-near-black transition hover:bg-warm-sand/40 disabled:cursor-wait disabled:opacity-50"
            >
              <div className="flex w-full items-center justify-between">
                <span>
                  {csvBusy === "r2" && (
                    <Loader2 size={12} className="mr-1.5 inline animate-spin" />
                  )}
                  CSV (上传 R2 → 公网 URL)
                </span>
                <span className="font-mono text-[11px] text-stone-gray">.csv</span>
              </div>
              <span className="text-[11px] text-stone-gray">
                先把图传到 Cloudflare R2,几十秒;同学外网能 fetch
              </span>
            </button>
            <label className="flex cursor-pointer items-center gap-2 border-t border-border-cream px-3 py-2 text-[12.5px] text-olive-gray transition hover:bg-warm-sand/40">
              <input
                type="checkbox"
                checked={includeExcluded}
                onChange={(e) => setIncludeExcluded(e.target.checked)}
                className="h-3.5 w-3.5 accent-terracotta"
              />
              含已排除的 cell
            </label>
            <p className="border-t border-border-cream bg-parchment/40 px-3 py-2 text-[11px] leading-[1.5] text-stone-gray">
              auto 会按 cell 数自动选 HTML / ZIP。HTML 双击就看,ZIP 解压后双击 index.html。
            </p>
          </div>
        </>
      )}
      {csvDialog && (
        <CsvResultDialog
          mode={csvDialog.mode}
          result={csvDialog.result}
          onRetry={() => {
            setCsvDialog(null);
            void triggerCsvExport(csvDialog.mode);
          }}
          onDownloadAnyway={() => {
            const r = csvDialog.result;
            if (r.csv && r.filename) downloadCsvBlob(r.csv, r.filename);
            setCsvDialog(null);
          }}
          onClose={() => setCsvDialog(null)}
        />
      )}
    </div>
  );
}

// 在浏览器内用 Blob 触发 .csv 下载,不再走 server 的 attachment 头
function downloadCsvBlob(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CsvResultDialog({
  mode,
  result,
  onRetry,
  onDownloadAnyway,
  onClose,
}: {
  mode: "local-proxy" | "r2";
  result: CsvResult;
  onRetry: () => void;
  onDownloadAnyway: () => void;
  onClose: () => void;
}) {
  const failures = result.stats?.failures ?? [];
  const rows = result.stats?.rows_total ?? 0;
  const uploaded = result.stats?.uploaded ?? 0;
  // 区分配置错(永久) vs 网络抖动(临时)
  const permanent = failures.filter(
    (f) => f.status != null && [400, 401, 403, 404, 413].includes(f.status)
  );
  const transient = failures.filter((f) => !permanent.includes(f));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-near-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="w-[480px] max-w-full overflow-hidden rounded-md border border-border-warm bg-ivory shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border-cream bg-parchment/50 px-4 py-3">
          <h3 className="font-serif text-[15px] font-medium text-near-black">
            {result.error
              ? "导出失败"
              : failures.length > 0
                ? `部分失败 (${failures.length} 张缺图)`
                : "导出完成"}
          </h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-stone-gray hover:bg-border-cream hover:text-near-black"
          >
            <X size={14} />
          </button>
        </header>
        <div className="px-4 py-4 text-[13.5px] leading-[1.55] text-near-black">
          {result.error ? (
            <>
              <div className="mb-2 flex items-start gap-2 text-error-crimson">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <pre className="m-0 whitespace-pre-wrap font-mono text-[12.5px]">
                  {result.error}
                </pre>
              </div>
              {result.hint && (
                <p className="mt-3 rounded-md bg-warm-gold-bg/60 p-2 text-[12px] text-charcoal-warm">
                  {result.hint}
                </p>
              )}
            </>
          ) : (
            <>
              <ul className="mb-3 space-y-1 text-[13px] text-olive-gray">
                <li>
                  CSV 行数:
                  <strong className="ml-1 text-near-black">{rows}</strong>
                </li>
                {mode === "r2" && (
                  <li>
                    R2 上传:
                    <strong className="ml-1 text-near-black">
                      {uploaded}
                    </strong>{" "}
                    新传 + 其余幂等命中跳过
                  </li>
                )}
                {permanent.length > 0 && (
                  <li className="text-error-crimson">
                    永久失败 {permanent.length} 张(配置错,见下,需要改 env / 跑批后重试)
                  </li>
                )}
                {transient.length > 0 && (
                  <li className="text-warm-gold-fg">
                    临时失败 {transient.length} 张(网络 / 限流 / 5xx,可重试)
                  </li>
                )}
              </ul>
              {failures.length > 0 && (
                <details className="mt-2 rounded-md border border-border-cream bg-parchment/40 px-3 py-2">
                  <summary className="cursor-pointer text-[12px] text-error-crimson select-none">
                    查看失败详情
                  </summary>
                  <ul className="mt-2 max-h-[180px] space-y-1 overflow-y-auto pl-1 text-[11.5px] leading-[1.5]">
                    {failures.slice(0, 30).map((f, i) => (
                      <li key={i} className="font-mono">
                        <span className="text-near-black">{f.sample_id}</span>{" "}
                        {f.status != null && (
                          <span className="text-stone-gray">[{f.status}]</span>
                        )}{" "}
                        {f.code && (
                          <span className="text-stone-gray">{f.code}</span>
                        )}{" "}
                        <span className="text-error-crimson">{f.reason}</span>
                      </li>
                    ))}
                    {failures.length > 30 && (
                      <li className="text-stone-gray italic">
                        …还有 {failures.length - 30} 条
                      </li>
                    )}
                  </ul>
                </details>
              )}
              <div className="mt-4 flex flex-col gap-2">
                {transient.length > 0 && (
                  <button
                    onClick={onRetry}
                    className="flex h-9 items-center justify-center gap-2 rounded-md bg-terracotta px-4 text-[13px] font-medium text-ivory transition hover:bg-terracotta/90"
                  >
                    <RefreshCw size={14} />
                    再试一次({transient.length} 张失败重传)
                  </button>
                )}
                {result.csv && (
                  <button
                    onClick={onDownloadAnyway}
                    className="flex h-9 items-center justify-center gap-2 rounded-md border border-border-warm bg-ivory text-[13px] text-olive-gray transition hover:text-near-black"
                  >
                    <Download size={14} />
                    {failures.length > 0
                      ? `下载 CSV (含 ${rows} 行,缺 ${failures.length} 张图)`
                      : `下载 CSV (${rows} 行)`}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────── 盲评包导出 ───────
function BlindExportButton({ runId }: { runId: string }) {
  const [busy, setBusy] = useState(false);
  const onClick = () => {
    setBusy(true);
    const link = document.createElement("a");
    link.href = `/api/labs/batch/runs/${runId}/export-blind`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => setBusy(false), 1000);
  };
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title="导出盲评包:接收方看不到策略名,只能为每 query 选一张最佳"
      className="flex h-9 items-center gap-2 rounded-md border border-border-warm bg-ivory px-3 text-[13px] text-olive-gray transition hover:text-near-black disabled:cursor-wait disabled:opacity-50"
    >
      {busy ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <EyeOff size={14} />
      )}
      盲评包
    </button>
  );
}

// ─────── 导入评选结果 ───────
function ImportPicksButton({
  runId,
  onImported,
}: {
  runId: string;
  onImported: (fresh: BatchRunRecord) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok?: boolean;
    imported?: number;
    skipped_count?: number;
    reviewer?: string;
    error?: string;
  } | null>(null);

  const onPick = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const text = await file.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error("文件不是合法 JSON");
      }
      const r = await fetch(`/api/labs/batch/runs/${runId}/import-picks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        imported?: number;
        skipped_count?: number;
        reviewer?: string;
        error?: string;
      };
      if (!r.ok) {
        setResult({ error: j.error ?? `HTTP ${r.status}` });
        return;
      }
      setResult({
        ok: true,
        imported: j.imported,
        skipped_count: j.skipped_count,
        reviewer: j.reviewer,
      });
      const fresh = await fetch(`/api/labs/batch/runs/${runId}`, {
        cache: "no-store",
      });
      if (fresh.ok) onImported((await fresh.json()) as BatchRunRecord);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={onFile}
        className="hidden"
      />
      <button
        onClick={onPick}
        disabled={busy}
        title="导入接收方传回的盲评 .json"
        className="flex h-9 items-center gap-2 rounded-md border border-border-warm bg-ivory px-3 text-[13px] text-olive-gray transition hover:text-near-black disabled:cursor-wait disabled:opacity-50"
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Upload size={14} />
        )}
        导入评选
      </button>
      {result && (
        <ImportResultDialog result={result} onClose={() => setResult(null)} />
      )}
    </>
  );
}

function ImportResultDialog({
  result,
  onClose,
}: {
  result: {
    ok?: boolean;
    imported?: number;
    skipped_count?: number;
    reviewer?: string;
    error?: string;
  };
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-near-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="w-[380px] max-w-full overflow-hidden rounded-md border border-border-warm bg-ivory shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border-cream bg-parchment/50 px-4 py-3">
          <h3 className="font-serif text-[15px] font-medium text-near-black">
            {result.ok ? "评选已导入" : "导入失败"}
          </h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-stone-gray hover:bg-border-cream hover:text-near-black"
          >
            <X size={14} />
          </button>
        </header>
        <div className="px-4 py-4 text-[13.5px] leading-[1.55] text-near-black">
          {result.ok ? (
            <ul className="space-y-1 text-[13px] text-olive-gray">
              <li>
                评审人:
                <strong className="text-near-black">
                  {result.reviewer || "(匿名)"}
                </strong>
              </li>
              <li>
                成功导入:
                <strong className="text-near-black">{result.imported}</strong> 条
              </li>
              {result.skipped_count != null && result.skipped_count > 0 && (
                <li className="text-error-crimson">
                  跳过 {result.skipped_count} 条(anon_id 找不到对应 cell)
                </li>
              )}
              <li className="mt-3 text-[12.5px] text-stone-gray">
                同一人再次导入会覆盖前一次结果。
              </li>
            </ul>
          ) : (
            <div className="flex items-start gap-2 text-error-crimson">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p className="m-0 font-mono text-[12.5px]">{result.error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────── 飞书导出 ───────
type LarkAuthState =
  | { status: "loading" }
  | { status: "ok"; user?: string }
  | { status: "needs_login"; message?: string }
  | { status: "not_installed"; message?: string };

function LarkExportButton({
  runId,
  runName,
}: {
  runId: string;
  runName: string;
}) {
  const [auth, setAuth] = useState<LarkAuthState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [resultDialog, setResultDialog] = useState<{
    docUrl?: string;
    error?: string;
    cellsTotal?: number;
    imgOk?: number;
    imgFail?: number;
    failures?: { query_idx: number; skill_id: string; reason: string }[];
  } | null>(null);

  useEffect(() => {
    fetch("/api/lark/auth-status")
      .then((r) => r.json())
      .then((j) => setAuth(j))
      .catch((e) => setAuth({ status: "needs_login", message: String(e) }));
  }, []);

  const onClick = async () => {
    if (auth.status !== "ok" || busy) return;
    setBusy(true);
    setResultDialog(null);
    try {
      const r = await fetch(`/api/labs/batch/runs/${runId}/export-lark`, {
        method: "POST",
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as {
          error?: string;
          status?: string;
        };
        if (j.status === "needs_login") {
          setAuth({ status: "needs_login", message: j.error });
          setResultDialog({
            error: `飞书登录失效,请运行:\nlark-cli auth login\n登录后重试。`,
          });
        } else {
          setResultDialog({ error: j.error ?? `HTTP ${r.status}` });
        }
        return;
      }
      const j = (await r.json()) as {
        doc_url: string;
        cells_total: number;
        image_uploaded: number;
        image_failed: number;
        failures?: { query_idx: number; skill_id: string; reason: string }[];
      };
      setResultDialog({
        docUrl: j.doc_url,
        cellsTotal: j.cells_total,
        imgOk: j.image_uploaded,
        imgFail: j.image_failed,
        failures: j.failures,
      });
    } catch (e) {
      setResultDialog({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  let dot = "bg-stone-gray";
  let title = "飞书状态加载中…";
  let disabled = true;
  if (auth.status === "ok") {
    dot = "bg-green-500";
    title = `飞书已登录${auth.user ? ` (${auth.user})` : ""}`;
    disabled = false;
  } else if (auth.status === "needs_login") {
    dot = "bg-amber-500";
    title = `飞书登录已过期,请在终端跑:lark-cli auth login`;
  } else if (auth.status === "not_installed") {
    dot = "bg-error-crimson";
    title = `本机未装 lark-cli`;
  }

  return (
    <>
      <button
        onClick={onClick}
        disabled={disabled || busy}
        title={busy ? "导出到飞书中…可能需要 1-2 分钟" : title}
        className="flex h-9 items-center gap-2 rounded-md border border-border-warm bg-ivory px-3 text-[13px] text-olive-gray transition hover:text-near-black disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <span className={`h-2 w-2 rounded-full ${dot}`} />
        )}
        发飞书
      </button>
      {resultDialog && (
        <LarkResultDialog
          {...resultDialog}
          runName={runName}
          onClose={() => setResultDialog(null)}
        />
      )}
    </>
  );
}

function LarkResultDialog({
  docUrl,
  error,
  cellsTotal,
  imgOk,
  imgFail,
  failures,
  runName,
  onClose,
}: {
  docUrl?: string;
  error?: string;
  cellsTotal?: number;
  imgOk?: number;
  imgFail?: number;
  failures?: { query_idx: number; skill_id: string; reason: string }[];
  runName: string;
  onClose: () => void;
}) {
  const hasFailures = !!failures && failures.length > 0;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-near-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="w-[420px] max-w-full overflow-hidden rounded-md border border-border-warm bg-ivory shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border-cream bg-parchment/50 px-4 py-3">
          <h3 className="font-serif text-[15px] font-medium text-near-black">
            {error ? "导出失败" : "飞书文档已生成"}
          </h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-stone-gray hover:bg-border-cream hover:text-near-black"
          >
            <X size={14} />
          </button>
        </header>
        <div className="px-4 py-4 text-[13.5px] leading-[1.55] text-near-black">
          {error ? (
            <>
              <div className="mb-2 flex items-start gap-2 text-error-crimson">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <pre className="m-0 whitespace-pre-wrap font-mono text-[12.5px]">
                  {error}
                </pre>
              </div>
              <p className="mt-3 text-[12.5px] text-stone-gray">
                可以改用左侧"导出"按钮发 HTML / ZIP 给同事。
              </p>
            </>
          ) : (
            <>
              <p className="mb-3 text-near-black">
                <strong>{runName}</strong> 已同步到飞书。
              </p>
              <ul className="mb-4 space-y-1 text-[12.5px] text-olive-gray">
                <li>{cellsTotal} cell 已写入</li>
                <li>
                  图片:{imgOk} 上传成功
                  {imgFail && imgFail > 0 ? (
                    <span className="text-error-crimson">
                      ,{imgFail} 失败
                    </span>
                  ) : null}
                </li>
              </ul>
              {docUrl && (
                <a
                  href={docUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-9 items-center justify-center gap-2 rounded-md bg-terracotta px-4 text-[13px] font-medium text-ivory transition hover:bg-terracotta/90"
                >
                  <ExternalLink size={14} />
                  打开飞书文档
                </a>
              )}
              {docUrl && (
                <button
                  onClick={() => navigator.clipboard.writeText(docUrl)}
                  className="mt-2 flex h-8 w-full items-center justify-center rounded-md border border-border-warm text-[12.5px] text-olive-gray transition hover:text-near-black"
                >
                  复制链接
                </button>
              )}
              {hasFailures && (
                <details className="mt-3 rounded-md border border-border-cream bg-parchment/40 px-3 py-2">
                  <summary className="cursor-pointer text-[12px] text-error-crimson select-none">
                    查看失败详情({failures!.length} 条)
                  </summary>
                  <ul className="mt-2 max-h-[180px] space-y-1 overflow-y-auto pl-1 text-[11.5px] leading-[1.5]">
                    {failures!.slice(0, 30).map((f, i) => (
                      <li key={i} className="font-mono text-stone-gray">
                        <span className="text-near-black">
                          Q{f.query_idx + 1} · {f.skill_id}
                        </span>{" "}
                        <span className="text-error-crimson">
                          {f.reason.slice(0, 240)}
                        </span>
                      </li>
                    ))}
                    {failures!.length > 30 && (
                      <li className="text-stone-gray italic">
                        …还有 {failures!.length - 30} 条未列出
                      </li>
                    )}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────── 复制配置重跑 ───────
function DuplicateRunButton({ record }: { record: BatchRunRecord }) {
  const setView = useSetAtom(batchViewAtom);
  const setPrefill = useSetAtom(batchCreatePrefillAtom);

  const onClick = () => {
    setPrefill({
      name: `${record.name || "(未命名)"} (副本)`,
      queries: [...record.queries],
      skill_ids: [...record.skill_ids],
      scoring_dimensions: record.scoring_dimensions.map((d) => ({
        id: d.id,
        label: d.label,
        description: d.description,
      })),
      rewrite_llm: record.rewrite_llm,
      purpose: record.purpose,
      include_universal: record.include_universal,
      source_run_id: record.id,
      source_run_name: record.name || "(未命名)",
    });
    setView({ kind: "create" });
  };

  return (
    <button
      onClick={onClick}
      title="复制本次跑批的 query / skill / 维度 / 模型,新建一次重跑(产物不复制,会重新打 LLM + 出图)"
      className="flex h-9 items-center gap-2 rounded-md border border-border-warm bg-ivory px-3 text-[13px] text-olive-gray transition hover:text-near-black"
    >
      <Copy size={14} />
      复制重跑
    </button>
  );
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ─────── 停止整 run ───────
// 显式按钮挂在进度条旁,只在 record.status === "running" 时渲染。
// 点击后:confirm → server 把所有 pending/running cells 标 failed("用户已取消") + record.status 改 cancelled
// → SSE 推 finished 关连接 → 用户立刻能新建 / 重试。
// in-flight 的 LLM/生图任务无法中断(没接 AbortController),会跑完;但 patchCell 在 cancelled 状态下 silent no-op,
// 迟到结果不污染。
function StopRunButton({
  runId,
  pendingCount,
}: {
  runId: string;
  pendingCount: number;
}) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const onClick = async () => {
    if (busy) return;
    const ok = window.confirm(
      `确认停止本次跑批吗?\n\n还有 ${pendingCount} 张未完成,会全部标记为已取消。\n已经在跑的 LLM 调用会自动跑完(结果不写回),不会浪费配额。`
    );
    if (!ok) return;
    setBusy(true);
    setToast(null);
    try {
      const r = await fetch(`/api/labs/batch/runs/${runId}/cancel`, {
        method: "POST",
      });
      const j = (await r.json()) as {
        ok?: boolean;
        cancelled_cells?: number;
        error?: string;
      };
      if (!r.ok) {
        setToast(`失败:${j.error ?? `HTTP ${r.status}`}`);
      } else {
        setToast(`已停止 ${j.cancelled_cells ?? 0} 张未完成`);
      }
      setTimeout(() => setToast(null), 3500);
    } catch (e) {
      setToast(`失败:${e instanceof Error ? e.message : String(e)}`);
      setTimeout(() => setToast(null), 4000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={onClick}
        disabled={busy}
        title="停止本次跑批 — 把所有未完成 cell 标为已取消,可立刻新建或重试"
        className="flex h-7 items-center gap-1.5 rounded-md border border-stone-gray/40 bg-warm-sand px-2.5 text-[11.5px] font-medium text-near-black transition hover:bg-warm-sand/70 disabled:cursor-wait disabled:opacity-50"
      >
        {busy ? (
          <Loader2 size={11} className="animate-spin" />
        ) : (
          <CircleStop size={11} />
        )}
        停止任务
      </button>
      {toast && (
        <div className="absolute right-0 top-9 z-30 whitespace-nowrap rounded-md border border-border-warm bg-ivory px-3 py-2 text-[11.5px] text-near-black shadow-md">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─────── 全部重试失败 ───────
// 显式按钮挂在进度条旁,只在 p.failed > 0 时渲染。
// 点击后:server 把所有 failed cells 一次性重新跑(Semaphore 4 限流);record.status
// 拉回 running 让 SSE 重连;前端 cell 状态自动通过 SSE 更新。
function RetryAllFailedButton({
  runId,
  failedCount,
}: {
  runId: string;
  failedCount: number;
}) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setToast(null);
    try {
      const r = await fetch(`/api/labs/batch/runs/${runId}/cells/retry-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concurrency: 4 }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        found?: number;
        queued?: number;
        skipped_locked?: number;
        error?: string;
      };
      if (!r.ok) {
        setToast(`失败:${j.error ?? `HTTP ${r.status}`}`);
      } else if ((j.skipped_locked ?? 0) > 0) {
        setToast(
          `已排队 ${j.queued} 张;${j.skipped_locked} 张被锁(可能正在重试),稍后再试`
        );
      } else {
        setToast(`已排队 ${j.queued} 张重新跑`);
      }
      setTimeout(() => setToast(null), 3500);
    } catch (e) {
      setToast(`失败:${e instanceof Error ? e.message : String(e)}`);
      setTimeout(() => setToast(null), 4000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={onClick}
        disabled={busy}
        title="把所有 status=failed 的 cell 一次性重新跑(并发 4)"
        className="flex h-7 items-center gap-1.5 rounded-md bg-coral-soft-bg px-2.5 text-[11.5px] font-medium text-error-crimson transition hover:bg-coral-deep-bg disabled:cursor-wait disabled:opacity-50"
      >
        {busy ? (
          <Loader2 size={11} className="animate-spin" />
        ) : (
          <RefreshCw size={11} />
        )}
        全部重试 ({failedCount})
      </button>
      {toast && (
        <div className="absolute right-0 top-9 z-30 whitespace-nowrap rounded-md border border-border-warm bg-ivory px-3 py-2 text-[11.5px] text-near-black shadow-md">
          {toast}
        </div>
      )}
    </div>
  );
}
