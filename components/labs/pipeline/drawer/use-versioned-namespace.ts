// prompt-rewriter/components/labs/pipeline/drawer/use-versioned-namespace.ts
//
// 复用 Hook:接管一个 namespace 的版本管理状态机。
// 返回:全部版本元信息 / 当前 viewingId / 当前 viewingId 的内容(local state)/
//      切版本 / 编辑(debounce 写盘到 viewingId)/ activate / publish / rename / delete。
//
// 把 VersionedEditor 内部的状态机抽出来,这样 PipelineStrategyVerticalEditor(老 master/detail UX)
// 也能用,而不必跟着写一遍 firstLoad 守卫 + bootstrap + debounce PUT 这些样板。

"use client";

import { useAtom } from "jotai";
import type { PrimitiveAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Index,
  type VersionMeta,
} from "@/lib/atoms-pipeline-strategies";

const STRATEGY_NAMESPACES = new Set([
  "vertical-standard",
  "platform-tone",
] as const);

export type NsKind = "strategies" | "sps";
export type SaveStatus = "saved" | "saving" | "error";

function kindOf(ns: string): NsKind {
  return (STRATEGY_NAMESPACES as Set<string>).has(ns) ? "strategies" : "sps";
}
function baseUrl(ns: string): string {
  return `/api/labs/pipeline/${kindOf(ns)}/${encodeURIComponent(ns)}`;
}

export interface UseVersionedNamespaceArgs {
  ns:
    | "vertical-standard"
    | "platform-tone"
    | "sp-classification"
    | "sp-rewrite"
    | "sp-creation-planner";
  indexAtom: PrimitiveAtom<Index>;
  /** json 类的写盘会先做 JSON.parse 客户端预检 */
  versionExt: "json" | "md";
}

export interface UseVersionedNamespaceReturn {
  // ─ 元信息 ─
  index: Index;
  viewingId: string;
  viewingMeta: VersionMeta | undefined;
  /** 拿 active 版本的内容(供 master/detail 视图渲染用,跟随 viewingId 而非 active) */
  content: string;
  loading: boolean;
  busy: boolean;
  opError: string | null;
  saveStatus: SaveStatus;
  /** 切版本(必触发拉新内容) */
  setViewingId: (id: string) => void;
  /** 编辑当前 viewingId 内容(会 debounce 600ms 写盘到 viewingId) */
  setContent: (text: string) => void;
  /** 把当前 viewingId 设为 active */
  activate: () => Promise<void>;
  /** 新建版本(prompt 用户输入 id / label / notes / 是否从当前复制) */
  createNew: () => Promise<void>;
  /** 修改当前 viewingId 的 label / notes */
  rename: () => Promise<void>;
  /** 删除当前 viewingId(active 不能删,至少留 1 版) */
  remove: () => Promise<void>;
}

export function useVersionedNamespace(
  args: UseVersionedNamespaceArgs,
): UseVersionedNamespaceReturn {
  const { ns, indexAtom, versionExt } = args;
  const [index, setIndex] = useAtom(indexAtom);
  const [viewingId, setViewingIdState] = useState<string>("");
  const [content, setContentState] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");

  // bootstrap index(只有 atom 空时拉一次)
  const bootRef = useRef(false);
  useEffect(() => {
    if (bootRef.current) return;
    if (index.versions.length > 0) {
      bootRef.current = true;
      return;
    }
    bootRef.current = true;
    (async () => {
      try {
        const r = await fetch(baseUrl(ns));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as Index;
        setIndex(json);
      } catch (e) {
        console.warn(`[use-versioned-namespace:${ns}] bootstrap failed:`, e);
        bootRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ns]);

  // 首次拿到 index 后把 viewingId 初始化成 active
  useEffect(() => {
    if (!viewingId && index.active) setViewingIdState(index.active);
  }, [index.active, viewingId]);

  // 切版本时拉内容
  const firstLoad = useRef(true);
  useEffect(() => {
    if (!viewingId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await fetch(
          `${baseUrl(ns)}/${encodeURIComponent(viewingId)}`,
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        if (!cancelled) setContentState(text);
      } catch (e) {
        console.warn(`[use-versioned-namespace:${ns}] load failed:`, e);
      } finally {
        if (!cancelled) {
          setLoading(false);
          firstLoad.current = false;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ns, viewingId]);

  // 防抖 PUT
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!viewingId) return;
    if (firstLoad.current || loading) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (versionExt === "json") {
        try {
          JSON.parse(content);
        } catch {
          setSaveStatus("error");
          return;
        }
      }
      setSaveStatus("saving");
      try {
        const r = await fetch(
          `${baseUrl(ns)}/${encodeURIComponent(viewingId)}`,
          { method: "PUT", body: content },
        );
        setSaveStatus(r.ok ? "saved" : "error");
      } catch {
        setSaveStatus("error");
      }
    }, 600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  const viewingMeta = useMemo(
    () => index.versions.find((v) => v.id === viewingId),
    [index.versions, viewingId],
  );

  const setViewingId = useCallback((id: string) => {
    firstLoad.current = true; // 切换前 reset,让回填不触发写盘
    setViewingIdState(id);
  }, []);

  const setContent = useCallback((text: string) => {
    setContentState(text);
  }, []);

  const refreshIndex = useCallback(async (): Promise<Index | null> => {
    try {
      const r = await fetch(baseUrl(ns));
      if (!r.ok) return null;
      const json = (await r.json()) as Index;
      setIndex(json);
      return json;
    } catch {
      return null;
    }
  }, [ns, setIndex]);

  const activate = useCallback(async () => {
    if (!viewingId || viewingId === index.active || busy) return;
    setBusy(true);
    setOpError(null);
    try {
      const r = await fetch(
        `${baseUrl(ns)}/${encodeURIComponent(viewingId)}/activate`,
        { method: "POST" },
      );
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "activate failed");
      }
      await refreshIndex();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [ns, viewingId, index.active, busy, refreshIndex]);

  const createNew = useCallback(async () => {
    if (busy) return;
    const rawId = window.prompt(
      "新版本的 id(字母/数字/._-,会作为文件名):",
      `v${index.versions.length + 1}-draft`,
    );
    if (!rawId) return;
    const id = rawId.trim();
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
      setOpError("id 只能是字母/数字/._-,且首字母非特殊符号");
      return;
    }
    const label = window.prompt("这个版本的显示名(一句话,便于人识别):", id);
    if (!label) return;
    const notes = window.prompt("备注(可选,说明这版的迭代思路)", "") ?? "";
    const fromMode =
      index.versions.length > 0 &&
      window.confirm(
        `要不要从当前查看版本(${viewingId})复制内容作为起点?\n\n确定 = 复制 ${viewingId},取消 = 从空白开始`,
      );
    setBusy(true);
    setOpError(null);
    try {
      const r = await fetch(baseUrl(ns), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          label: label.trim(),
          notes: notes.trim(),
          fromId: fromMode ? viewingId : undefined,
        }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "create failed");
      }
      await refreshIndex();
      firstLoad.current = true;
      setViewingIdState(id);
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [ns, busy, viewingId, index.versions.length, refreshIndex]);

  const rename = useCallback(async () => {
    if (!viewingMeta || busy) return;
    const label = window.prompt("修改显示名:", viewingMeta.label);
    if (label === null) return;
    const notes = window.prompt("修改备注:", viewingMeta.notes);
    if (notes === null) return;
    setBusy(true);
    setOpError(null);
    try {
      const r = await fetch(`${baseUrl(ns)}/${encodeURIComponent(viewingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), notes: notes.trim() }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "rename failed");
      }
      await refreshIndex();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [ns, viewingMeta, viewingId, busy, refreshIndex]);

  const remove = useCallback(async () => {
    if (!viewingMeta || busy) return;
    if (viewingId === index.active) {
      setOpError("active 版本不能删");
      return;
    }
    if (index.versions.length <= 1) {
      setOpError("至少保留一个版本");
      return;
    }
    const ok = window.confirm(
      `确定删除版本 "${viewingMeta.label}" (${viewingId})?\n\n内容文件会被连带删掉,无法通过 UI 恢复。`,
    );
    if (!ok) return;
    setBusy(true);
    setOpError(null);
    try {
      const r = await fetch(`${baseUrl(ns)}/${encodeURIComponent(viewingId)}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "delete failed");
      }
      const next = await refreshIndex();
      firstLoad.current = true;
      setViewingIdState(next?.active ?? "");
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [ns, viewingMeta, viewingId, busy, index.active, index.versions.length, refreshIndex]);

  return {
    index,
    viewingId,
    viewingMeta,
    content,
    loading,
    busy,
    opError,
    saveStatus,
    setViewingId,
    setContent,
    activate,
    createNew,
    rename,
    remove,
  };
}
