"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { SessionInfo } from "@/lib/types";
import type { SessionSearchResponse } from "@/lib/session-search";

interface SessionSearchProps {
  /** 搜索模式是否开启（由工具栏按钮切换）。 */
  open: boolean;
  /** 当前搜索词；为空时直接渲染子列表。 */
  query: string;
  /** 会话列表代数：变化时重新触发搜索。 */
  refreshKey: number | null;
  /** 搜索未激活/无输入时透传的会话列表。 */
  children: ReactNode;
  selectedSessionId: string | null;
  /** 点击命中结果：跳转会话并定位到匹配 entry/block。 */
  onSelectSession: (
    session: SessionInfo,
    entryId?: string,
    blockIndex?: number,
  ) => void;
}

/**
 * 侧边栏会话搜索面板：替换会话列表为命中结果（每会话一条），300ms 防抖
 * 请求 /api/sessions/search；搜索关闭或无输入时透传原列表。
 *
 * @param props 开关状态、搜索词、列表版本号与选择回调。
 * @returns 搜索结果面板或透传的子列表。
 */
export function SessionSearch({
  open,
  query,
  refreshKey,
  children,
  selectedSessionId,
  onSelectSession,
}: SessionSearchProps) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<{
    query: string;
    response?: SessionSearchResponse;
    failed?: boolean;
  }>({ query: "" });
  const search = query.trim();
  const response = state.query === search ? state.response : undefined;
  const failed = state.query === search && state.failed;

  useEffect(() => {
    if (!open || !search) return;
    const controller = new AbortController();
    setState({ query: search });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/sessions/search?${new URLSearchParams({ q: search })}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SessionSearchResponse;
        if (!controller.signal.aborted)
          setState({ query: search, response: data });
      } catch {
        if (!controller.signal.aborted)
          setState({ query: search, failed: true });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, search, refreshKey]);

  if (!open || !search) return <>{children}</>;

  return (
    <div
      style={{ flex: "1 1 auto", overflowY: "auto", minHeight: 80 }}
      aria-busy={!response && !failed}
    >
      <div
        role="status"
        style={{
          padding: "8px 14px",
          fontSize: 11,
          color: "var(--text-muted)",
        }}
      >
        {failed
          ? t("sidebar.sessionSearchFailed")
          : !response
            ? t("sidebar.sessionSearching")
            : response.results.length === 0
              ? t("sidebar.sessionSearchEmpty")
              : t("sidebar.sessionSearchCount", {
                  count: response.results.length,
                })}
      </div>
      {response?.truncated && (
        <div
          role="status"
          style={{
            padding: "0 14px 8px",
            fontSize: 11,
            color: "var(--text-muted)",
          }}
        >
          {t("sidebar.sessionSearchPartial")}
        </div>
      )}
      {response?.results.map(
        ({ session, entryId, blockIndex, before, match, after }) => (
          <button
            key={session.id}
            type="button"
            onClick={() => onSelectSession(session, entryId, blockIndex)}
            aria-current={session.id === selectedSessionId ? "true" : undefined}
            style={{
              display: "block",
              width: "100%",
              cursor: "pointer",
              textAlign: "left",
              padding: "8px 14px",
              border: 0,
              borderBottom: "1px solid var(--border)",
              background:
                session.id === selectedSessionId
                  ? "var(--bg-selected)"
                  : "transparent",
              color: "inherit",
              font: "inherit",
            }}
            onMouseEnter={(e) => {
              if (session.id === selectedSessionId) return;
              e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background =
                session.id === selectedSessionId
                  ? "var(--bg-selected)"
                  : "transparent";
            }}
          >
            <span
              style={{
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 12,
                fontWeight: 500,
                color: "var(--text)",
              }}
            >
              {session.name || session.firstMessage}
            </span>
            <span
              style={{
                marginTop: 4,
                display: "flex",
                gap: 8,
                minWidth: 0,
                fontSize: 10,
                color: "var(--text-dim)",
              }}
            >
              <span
                style={{
                  minWidth: 0,
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={session.cwd}
              >
                {session.cwd}
              </span>
              <span style={{ flexShrink: 0 }}>
                {formatRelativeTime(session.modified, locale)}
              </span>
            </span>
            <span
              style={{
                marginTop: 4,
                display: "block",
                fontSize: 12,
                lineHeight: 1.6,
                overflowWrap: "anywhere",
                color: "var(--text-muted)",
              }}
            >
              {before}
              <mark
                style={{
                  borderRadius: 2,
                  background:
                    "color-mix(in srgb, var(--accent) 20%, transparent)",
                  color: "var(--text)",
                }}
              >
                {match}
              </mark>
              {after}
            </span>
          </button>
        ),
      )}
    </div>
  );
}
