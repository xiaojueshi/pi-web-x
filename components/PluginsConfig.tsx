"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import type {
  PluginPackageInfo,
  PluginUpdateResult,
  PluginsResponse,
} from "@/lib/api-types";
import {
  clearPluginUpdateResults,
  getPluginUpdateSnapshot,
  mergePluginUpdateResults,
  removePluginUpdateResult,
  subscribePluginUpdates,
} from "@/lib/plugin-update-store";
import { useI18n } from "@/hooks/useI18n";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
import {
  ConfigButton,
  ConfigDetail,
  ConfigDetailActions,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigEmptyState,
  ConfigField,
  ConfigFooter,
  ConfigListAction,
  ConfigPanelShell,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSectionTitle,
  ConfigSplitView,
  ConfigStatusDot,
  ConfigSwitch,
} from "./SettingsUi";

type PluginScope = PluginPackageInfo["scope"];
type PluginAction = "install" | "remove" | "update" | "disable" | "enable";

/** 更新确认目标：单项更新或批量更新清单，等待用户在对话框中显式确认。 */
type UpdateConfirmTarget =
  | { kind: "single"; pkg: PluginPackageInfo }
  | { kind: "all"; items: PluginUpdateResult[] };

function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function normalizePluginSourceInput(value: string): string {
  const match = value.trim().match(/^\$?\s*pi\s+install\s+(\S+)\s*$/);
  return match?.[1] ?? value;
}

function packageKey(pkg: Pick<PluginPackageInfo, "source" | "scope">): string {
  return `${pkg.scope}\0${pkg.source}`;
}

function resourceSummary(
  pkg: PluginPackageInfo,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (pkg.disabled) return t("i18n.disabled");
  const parts = [
    pkg.counts.extensions
      ? t("i18n.resourceCount", {
          count: pkg.counts.extensions,
          label: t("i18n.extensionShort"),
        })
      : "",
    pkg.counts.skills
      ? t("i18n.resourceCount", {
          count: pkg.counts.skills,
          label: t("i18n.skillShort"),
        })
      : "",
    pkg.counts.prompts
      ? t("i18n.resourceCount", {
          count: pkg.counts.prompts,
          label: t("i18n.promptShort"),
        })
      : "",
    pkg.counts.themes
      ? t("i18n.resourceCount", {
          count: pkg.counts.themes,
          label: t("i18n.themeShort"),
        })
      : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : t("i18n.noResources");
}

function versionSummary(
  pkg: PluginPackageInfo,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const parts = [];
  if (pkg.version)
    parts.push(t("i18n.installedVersion", { version: pkg.version }));
  if (pkg.configuredVersion)
    parts.push(t("i18n.configuredVersion", { version: pkg.configuredVersion }));
  return parts.length ? parts.join(" · ") : t("i18n.unknown");
}

function installLocation(scope: PluginScope, cwd: string): string {
  return scope === "project"
    ? `${shortenPath(cwd)}/.pi/agent/{npm,git}`
    : "~/.pi/agent/{npm,git}";
}

function findInstalledPackage(
  packages: PluginPackageInfo[],
  source: string,
  scope: PluginScope,
): PluginPackageInfo | undefined {
  const trimmed = source.trim();
  const withoutNpmPrefix = trimmed.startsWith("npm:")
    ? trimmed.slice(4)
    : trimmed;
  return (
    packages.find((pkg) => pkg.scope === scope && pkg.source === trimmed) ??
    packages.find(
      (pkg) => pkg.scope === scope && pkg.source === `npm:${withoutNpmPrefix}`,
    ) ??
    packages.find((pkg) => pkg.scope === scope && pkg.source.endsWith(trimmed))
  );
}

function statusColor(status: PluginPackageInfo["status"]): string {
  if (status === "loaded") return "var(--accent)";
  if (status === "installed") return "#f59e0b";
  if (status === "disabled") return "var(--text-dim)";
  return "#ef4444";
}

function ResourceList({ pkg }: { pkg: PluginPackageInfo }) {
  const { t } = useI18n();
  const groups = (
    [
      ["extension", t("i18n.extensions")],
      ["skill", t("i18n.skills")],
      ["prompt", t("i18n.prompts")],
      ["theme", t("i18n.themes")],
    ] as const
  )
    .map(([kind, label]) => ({
      kind,
      label,
      resources: pkg.resources.filter((resource) => resource.kind === kind),
    }))
    .filter((group) => group.resources.length > 0);

  if (groups.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
        {pkg.disabled
          ? t("i18n.packageDisabled")
          : t("i18n.noResolvedResources")}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {groups.map((group, groupIndex) => (
        <div
          key={group.kind}
          style={{
            borderTop: groupIndex === 0 ? "none" : "1px solid var(--border)",
            paddingTop: groupIndex === 0 ? 0 : 12,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--text-dim)",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            {group.label}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {group.resources.map((resource) => (
              <div
                key={`${resource.kind}:${resource.path}`}
                style={{ minWidth: 0 }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={resource.path}
                >
                  {resource.name}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text-dim)",
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginTop: 1,
                  }}
                  title={resource.path}
                >
                  {resource.relativePath}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScopeTag({ scope }: { scope: PluginScope }) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: "1px 5px",
        borderRadius: 3,
        flexShrink: 0,
        background:
          scope === "project"
            ? "rgba(99,102,241,0.12)"
            : "rgba(120,120,120,0.12)",
        color:
          scope === "project" ? "rgba(99,102,241,0.85)" : "var(--text-dim)",
      }}
    >
      {scope}
    </span>
  );
}

function SegmentedScope({
  value,
  projectResourcesLoaded,
  onChange,
}: {
  value: PluginScope;
  projectResourcesLoaded: boolean;
  onChange: (scope: PluginScope) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--border)",
        borderRadius: 7,
        overflow: "hidden",
        height: 30,
      }}
    >
      {(["global", "project"] as PluginScope[]).map((scope) => {
        const active = value === scope;
        const disabled = scope === "project" && !projectResourcesLoaded;
        return (
          <button
            key={scope}
            onClick={() => {
              if (!disabled) onChange(scope);
            }}
            disabled={disabled}
            title={disabled ? t("trust.projectScopeUnavailable") : undefined}
            style={{
              width: 76,
              border: "none",
              borderRight:
                scope === "global" ? "1px solid var(--border)" : "none",
              background: active ? "var(--bg-selected)" : "none",
              color: active ? "var(--text)" : "var(--text-muted)",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.45 : 1,
              fontSize: 12,
            }}
          >
            {scope}
          </button>
        );
      })}
    </div>
  );
}

function AddPluginPanel({
  cwd,
  source,
  scope,
  projectResourcesLoaded,
  busy,
  actionError,
  onSourceChange,
  onScopeChange,
  onInstall,
}: {
  cwd: string;
  source: string;
  scope: PluginScope;
  projectResourcesLoaded: boolean;
  busy: boolean;
  actionError: string | null;
  onSourceChange: (value: string) => void;
  onScopeChange: (scope: PluginScope) => void;
  onInstall: () => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const examples = [
    "npm:@scope/pi-plugin",
    "git:https://github.com/user/repo",
    "/absolute/path/to/plugin",
  ];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <ConfigDetailStack className="is-fill">
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <ConfigDetailTitle>{t("i18n.addPlugin")}</ConfigDetailTitle>
          <a
            href="https://pi.dev/packages"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: "var(--accent)",
              fontSize: 12,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 800 800"
              aria-hidden="true"
              focusable="false"
              style={{ flexShrink: 0 }}
            >
              <path
                fill="#000"
                fillRule="evenodd"
                d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
              />
              <path fill="#000" d="M517.36 400H634.72V634.72H517.36Z" />
            </svg>
            pi.dev/packages
          </a>
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {installLocation(scope, cwd)}
        </div>
      </div>

      <ConfigField label="Source">
        <input
          id="plugin-source"
          ref={inputRef}
          value={source}
          onChange={(e) => onSourceChange(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            const normalized = normalizePluginSourceInput(pasted);
            if (normalized === pasted) return;
            e.preventDefault();
            onSourceChange(normalized);
          }}
          onBlur={(e) =>
            onSourceChange(normalizePluginSourceInput(e.currentTarget.value))
          }
          placeholder="npm:@scope/package"
          style={{
            width: "100%",
            height: 36,
            padding: "0 11px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg-panel)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            outline: "none",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && source.trim() && !busy) onInstall();
          }}
        />
      </ConfigField>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <SegmentedScope
          value={scope}
          projectResourcesLoaded={projectResourcesLoaded}
          onChange={onScopeChange}
        />
        <ConfigButton
          variant="primary"
          onClick={onInstall}
          disabled={busy || !source.trim()}
          className="is-pushed-right"
        >
          {busy ? t("i18n.installing") : t("i18n.install")}
        </ConfigButton>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <div
          style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}
        >
          Examples
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onSourceChange(example)}
              style={{
                width: "100%",
                minHeight: 30,
                textAlign: "left",
                padding: "6px 9px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg-panel)",
                color: "var(--text-dim)",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-panel)";
                e.currentTarget.style.color = "var(--text-dim)";
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <div style={{ fontSize: 12, color: "#ef4444", whiteSpace: "pre-wrap" }}>
          {actionError}
        </div>
      )}
    </ConfigDetailStack>
  );
}

function PackageDetail({
  pkg,
  cwd,
  busyKey,
  actionError,
  actionMessage,
  sessionId,
  updateStatus,
  checkingUpdate,
  updateError,
  onAction,
  onCheckUpdate,
  onUpdateRequest,
  onReloadSession,
}: {
  pkg: PluginPackageInfo;
  cwd: string;
  busyKey: string | null;
  actionError: string | null;
  actionMessage: string | null;
  sessionId: string | null;
  updateStatus?: PluginUpdateResult;
  checkingUpdate: boolean;
  updateError: string | null;
  onAction: (action: PluginAction, pkg: PluginPackageInfo) => void;
  onCheckUpdate: () => void;
  onUpdateRequest: (pkg: PluginPackageInfo) => void;
  onReloadSession: () => void;
}) {
  const { t } = useI18n();
  const key = packageKey(pkg);
  const busy = busyKey?.endsWith(key) ?? false;
  const reloadBusy = busyKey === "reload";
  const enabled = !pkg.disabled;
  const canCheckForUpdates = pkg.canCheckForUpdates;
  const updateAvailable = updateStatus?.state === "update-available";

  return (
    <ConfigDetailStack>
      <ConfigDetailHeader className="is-top-aligned">
        <ConfigDetailHeaderInfo>
          <ScopeTag scope={pkg.scope} />
          {pkg.disabled ? (
            <span
              style={{
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 3,
                background: "rgba(120,120,120,0.12)",
                color: "var(--text-dim)",
              }}
            >
              {t("i18n.disabled")}
            </span>
          ) : (
            pkg.filtered && (
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "rgba(245,158,11,0.12)",
                  color: "#d97706",
                }}
              >
                {t("i18n.filtered")}
              </span>
            )
          )}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {pkg.source}
          </span>
        </ConfigDetailHeaderInfo>

        <ConfigDetailActions>
          <ConfigButton
            size="small"
            variant={updateAvailable ? "primary" : undefined}
            onClick={
              updateAvailable || !canCheckForUpdates
                ? () => onUpdateRequest(pkg)
                : onCheckUpdate
            }
            disabled={busy || reloadBusy || checkingUpdate}
            title={updateAvailable ? t("i18n.updateAvailable") : undefined}
          >
            {busyKey === `update:${key}`
              ? t("i18n.updating")
              : checkingUpdate
                ? t("i18n.checking")
                : updateAvailable || !canCheckForUpdates
                  ? t("i18n.update")
                  : t("i18n.check")}
          </ConfigButton>
          <ConfigButton
            size="small"
            onClick={onReloadSession}
            disabled={!sessionId || reloadBusy || busy}
            title={
              sessionId
                ? t("i18n.reloadSession")
                : t("i18n.openSessionToReload")
            }
          >
            {reloadBusy ? t("i18n.reloading") : t("i18n.reloadSession")}
          </ConfigButton>
          <ConfigButton
            variant="danger"
            size="small"
            onClick={() => onAction("remove", pkg)}
            disabled={busy || reloadBusy}
          >
            {busyKey === `remove:${key}`
              ? t("i18n.removing")
              : t("i18n.remove")}
          </ConfigButton>
          <ConfigSwitch
            checked={enabled}
            loading={busy || reloadBusy}
            onChange={() => onAction(pkg.disabled ? "enable" : "disable", pkg)}
            label={
              pkg.disabled ? t("i18n.enablePackage") : t("i18n.disablePackage")
            }
          />
        </ConfigDetailActions>
      </ConfigDetailHeader>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(96px, 130px) minmax(0, 1fr)",
          gap: "9px 14px",
          fontSize: 12,
          lineHeight: 1.45,
        }}
      >
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.status")}</div>
        <div
          style={{
            color: statusColor(pkg.status),
            textTransform: "capitalize",
          }}
        >
          {pkg.status}
        </div>
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.version")}</div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            minWidth: 0,
          }}
        >
          <div className="skill-version-row">
            <span className="skill-version-value">
              {versionSummary(pkg, t)}
            </span>
            {updateAvailable && (
              <span
                className="skill-version-value is-update"
                title={updateStatus?.displayName}
              >
                {t("i18n.updateAvailable")}
              </span>
            )}
            {canCheckForUpdates &&
              (checkingUpdate || (updateStatus && !updateAvailable)) && (
                <span
                  className={`skill-update-status ${
                    checkingUpdate
                      ? "is-checking"
                      : updateStatus?.state === "up-to-date"
                        ? "is-success"
                        : updateStatus?.state === "error"
                          ? "is-error"
                          : "is-muted"
                  }`}
                >
                  {checkingUpdate
                    ? t("i18n.checking")
                    : updateStatus?.state === "up-to-date"
                      ? t("i18n.upToDate")
                      : updateStatus?.state === "unsupported"
                        ? t("i18n.automaticChecksUnavailable")
                        : updateStatus?.message || t("i18n.checkFailed")}
                </span>
              )}
          </div>
          {updateError && (
            <span style={{ fontSize: 12, color: "#ef4444" }}>
              {updateError}
            </span>
          )}
        </div>
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.package")}</div>
        <div
          style={{
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            overflowWrap: "anywhere",
          }}
        >
          {pkg.packageName ?? t("i18n.unknown")}
        </div>
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.resources")}</div>
        <div style={{ color: "var(--text-muted)" }}>
          {resourceSummary(pkg, t)}
        </div>
        <div style={{ color: "var(--text-dim)" }}>
          {t("i18n.installedPath")}
        </div>
        <div
          style={{
            color: pkg.installedPath ? "var(--text-muted)" : "#ef4444",
            fontFamily: "var(--font-mono)",
            overflowWrap: "anywhere",
          }}
        >
          {pkg.installedPath
            ? shortenPath(pkg.installedPath)
            : t("i18n.notFound")}
        </div>
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.cwd")}</div>
        <div
          style={{
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            overflowWrap: "anywhere",
          }}
        >
          {shortenPath(cwd)}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <ConfigSectionTitle>{t("i18n.resolvedResources")}</ConfigSectionTitle>
        <ResourceList pkg={pkg} />
      </div>

      {actionMessage && (
        <div style={{ fontSize: 12, color: "#16a34a" }}>{actionMessage}</div>
      )}
      {actionError && (
        <div style={{ fontSize: 12, color: "#ef4444", whiteSpace: "pre-wrap" }}>
          {actionError}
        </div>
      )}
    </ConfigDetailStack>
  );
}

/**
 * 插件更新确认对话框：单项更新展示单个插件，批量更新展示完整清单；
 * 用户必须在此显式确认后才会真正执行更新。
 */
function UpdateConfirmDialog({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: UpdateConfirmTarget;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const items =
    target.kind === "single"
      ? [
          {
            key: packageKey(target.pkg),
            name: target.pkg.source,
            scope: target.pkg.scope,
          },
        ]
      : target.items.map((item) => ({
          key: packageKey(item),
          name: item.displayName,
          scope: item.scope,
        }));

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.4)",
      }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-update-confirm-title"
        style={{
          width: 460,
          maxWidth: "100%",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg-panel)",
          boxShadow: "0 12px 36px rgba(0,0,0,0.24)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "18px 18px 14px" }}>
          <div
            id="plugin-update-confirm-title"
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "var(--text)",
            }}
          >
            {target.kind === "single"
              ? t("i18n.confirmUpdateTitle")
              : t("i18n.confirmUpdateAllTitle")}
          </div>
          <div
            style={{
              marginTop: 7,
              fontSize: 12,
              lineHeight: 1.6,
              color: "var(--text-muted)",
            }}
          >
            {target.kind === "single"
              ? t("i18n.confirmUpdateBody")
              : t("i18n.confirmUpdateAllBody")}
          </div>
          <ul
            style={{
              marginTop: 10,
              maxHeight: 220,
              overflowY: "auto",
              margin: "10px 0 0",
              padding: "8px 10px",
              border: "1px solid var(--border)",
              borderRadius: 5,
              background: "var(--bg)",
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {items.map((item) => (
              <li
                key={item.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--text)",
                  minWidth: 0,
                }}
              >
                <ScopeTag scope={item.scope} />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    overflowWrap: "anywhere",
                  }}
                >
                  {item.name}
                </span>
              </li>
            ))}
          </ul>
          {target.kind === "all" && (
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                lineHeight: 1.5,
                color: "var(--text-muted)",
              }}
            >
              {t("i18n.confirmUpdateAllNote")}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              height: 32,
              padding: "0 12px",
              border: "1px solid var(--border)",
              borderRadius: 5,
              background: "transparent",
              color: "var(--text-muted)",
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: 12,
            }}
          >
            {t("i18n.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              height: 32,
              padding: "0 12px",
              border: "1px solid var(--accent)",
              borderRadius: 5,
              background: "var(--accent)",
              color: "white",
              cursor: busy ? "wait" : "pointer",
              opacity: busy ? 0.7 : 1,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {busy ? t("i18n.updating") : t("i18n.update")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PluginsConfig({
  cwd,
  sessionId,
  onClose,
  onReloaded,
  embedded = false,
}: {
  cwd: string;
  sessionId: string | null;
  onClose: () => void;
  onReloaded?: () => void;
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() =>
    getLastSettingsSelection("plugins", cwd),
  );
  const [addMode, setAddMode] = useState(false);
  const [installSource, setInstallSource] = useState("");
  const [installScope, setInstallScope] = useState<PluginScope>("global");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [updateStatuses, setUpdateStatuses] = useState<
    Record<string, PluginUpdateResult>
  >({});
  const [checkingUpdates, setCheckingUpdates] = useState<Set<string>>(
    () => new Set(),
  );
  const [checkingAll, setCheckingAll] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  const pluginUpdateSnapshot = useSyncExternalStore(
    subscribePluginUpdates,
    getPluginUpdateSnapshot,
  );
  const [confirmTarget, setConfirmTarget] =
    useState<UpdateConfirmTarget | null>(null);

  const packages = useMemo(() => data?.packages ?? [], [data?.packages]);
  // 展示状态 = 全局 store（页面加载时的后台检查）与面板本地状态的合并，
  // 面板内更“新”的本地结果优先
  const effectiveStatuses = useMemo(() => {
    const stored =
      pluginUpdateSnapshot.cwd === cwd
        ? pluginUpdateSnapshot.statuses
        : undefined;
    if (!stored) return updateStatuses;
    return { ...stored, ...updateStatuses };
  }, [cwd, pluginUpdateSnapshot, updateStatuses]);
  const selectedPackage =
    packages.find((pkg) => packageKey(pkg) === selected) ?? null;
  const projectResourcesLoaded = data?.projectResourcesLoaded ?? true;

  const groupedPackages = useMemo(() => {
    return (["project", "global"] as PluginScope[])
      .map((scope) => ({
        scope,
        packages: packages.filter((pkg) => pkg.scope === scope),
      }))
      .filter((group) => group.packages.length > 0);
  }, [packages]);

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/plugins?cwd=${encodeURIComponent(cwd)}`);
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error)
        throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      setAddMode((current) => next.packages.length === 0 || current);
      setSelected((current) => {
        if (current && next.packages.some((pkg) => packageKey(pkg) === current))
          return current;
        return next.packages[0] ? packageKey(next.packages[0]) : null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setUpdateStatuses({});
    setCheckingUpdates(new Set());
    setCheckingAll(false);
    setUpdateError(null);
    setConfirmTarget(null);
    void loadPlugins();
  }, [loadPlugins]);

  useEffect(() => {
    if (selected) setLastSettingsSelection("plugins", selected, cwd);
  }, [cwd, selected]);

  const checkForUpdates = useCallback(
    async (
      pkg?: PluginPackageInfo,
      targetList?: PluginPackageInfo[],
      options: { silent?: boolean } = {},
    ) => {
      const targets = pkg
        ? [pkg]
        : (targetList ?? packages.filter((item) => item.canCheckForUpdates));
      const keys = targets.map(packageKey);
      if (keys.length === 0) return;

      if (!options.silent) setUpdateError(null);
      setCheckingUpdates((current) => new Set([...current, ...keys]));
      if (!pkg) setCheckingAll(true);
      try {
        const res = await fetch("/api/plugins/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd,
            source: pkg?.source,
            scope: pkg?.scope,
          }),
        });
        const next = (await res.json()) as {
          updates?: PluginUpdateResult[];
          error?: string;
        };
        if (!res.ok || next.error)
          throw new Error(next.error ?? `HTTP ${res.status}`);
        // 静默（自动）检查不采纳 error 状态，避免页面加载时的网络失败信息
        const accepted = options.silent
          ? (next.updates ?? []).filter((update) => update.state !== "error")
          : (next.updates ?? []);
        setUpdateStatuses((current) => {
          const merged = { ...current };
          for (const update of accepted) {
            merged[packageKey(update)] = update;
          }
          return merged;
        });
        // 结果写回全局 store，供其他面板实例与下一次页面加载复用
        mergePluginUpdateResults(cwd, accepted);
      } catch (err) {
        if (!options.silent)
          setUpdateError(err instanceof Error ? err.message : String(err));
      } finally {
        setCheckingUpdates((current) => {
          const remaining = new Set(current);
          for (const item of keys) remaining.delete(item);
          return remaining;
        });
        if (!pkg) setCheckingAll(false);
      }
    },
    [cwd, packages],
  );

  // 每次面板数据加载完成（打开或刷新）后，自动检查一次可检查插件；
  // 自动检查为静默模式，网络失败不打扰用户，手动检查仍会展示错误
  useEffect(() => {
    if (loading || !data) return;
    const checkable = packages.filter((item) => item.canCheckForUpdates);
    if (checkable.length === 0) return;
    void checkForUpdates(undefined, checkable, { silent: true });
  }, [data, packages, loading, checkForUpdates]);

  // 批量更新：仅在确认对话框中展示完整清单并二次确认后才会执行
  const updateAllPlugins = useCallback(async () => {
    setConfirmTarget(null);
    setUpdatingAll(true);
    setActionError(null);
    setActionMessage(null);
    setUpdateError(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", cwd }),
      });
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error)
        throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      setUpdateStatuses({});
      // 批量更新已生效，全局 store 中的过期检查结果同步清空
      clearPluginUpdateResults(cwd);
      setActionMessage(
        sessionId
          ? `${t("i18n.updateAllPlugins")} · ${t("agents.reloadRequired")}`
          : t("i18n.updateAllPlugins"),
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdatingAll(false);
    }
  }, [cwd, sessionId, t]);

  const runAction = useCallback(
    async (action: PluginAction, pkg: PluginPackageInfo) => {
      const key = packageKey(pkg);
      setBusyKey(`${action}:${key}`);
      setActionError(null);
      setActionMessage(null);
      try {
        const res = await fetch("/api/plugins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            source: pkg.source,
            scope: pkg.scope,
            cwd,
          }),
        });
        const next = (await res.json()) as PluginsResponse & { error?: string };
        if (!res.ok || next.error)
          throw new Error(next.error ?? `HTTP ${res.status}`);
        setData(next);
        if (action === "remove" || action === "update") {
          setUpdateStatuses((current) => {
            const remaining = { ...current };
            delete remaining[key];
            return remaining;
          });
          // 全局 store 中该插件的过期检查结果同步移除
          removePluginUpdateResult(cwd, key);
        }
        if (action === "remove") {
          setSelected(next.packages[0] ? packageKey(next.packages[0]) : null);
          if (next.packages.length === 0) setAddMode(true);
          setActionMessage("Package removed.");
        } else {
          const messages: Record<Exclude<PluginAction, "remove">, string> = {
            install: "Package installed.",
            update: "Package updated.",
            disable: "Package disabled.",
            enable: "Package enabled.",
          };
          setActionMessage(messages[action]);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyKey(null);
      }
    },
    [cwd],
  );

  const installPlugin = useCallback(async () => {
    const source = normalizePluginSourceInput(installSource).trim();
    if (!source) return;
    setInstallSource(source);
    const key = `${installScope}\0${source}`;
    setBusyKey(`install:${key}`);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "install",
          source,
          scope: installScope,
          cwd,
        }),
      });
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error)
        throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      const installed = findInstalledPackage(
        next.packages,
        source,
        installScope,
      );
      setSelected(installed ? packageKey(installed) : key);
      setAddMode(false);
      setInstallSource("");
      setActionMessage("Package installed.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [cwd, installScope, installSource]);

  const reloadSession = useCallback(async () => {
    if (!sessionId) return;
    setBusyKey("reload");
    setActionError(null);
    setActionMessage(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      onReloaded?.();
      await loadPlugins();
      setActionMessage("Session reloaded.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [loadPlugins, onReloaded, sessionId]);

  const addBusy = busyKey?.startsWith("install:") ?? false;
  const availableUpdateCount = Object.values(effectiveStatuses).filter(
    (status) => status.state === "update-available",
  ).length;
  const hasCheckablePackages = packages.some((pkg) => pkg.canCheckForUpdates);
  const footerBusy =
    loading || busyKey !== null || checkingUpdates.size > 0 || updatingAll;
  const dialogBusy = updatingAll || busyKey !== null;

  return (
    <ConfigPanelShell
      embedded={embedded}
      title={t("common.plugins")}
      subtitle={shortenPath(cwd)}
      closeLabel={t("i18n.close")}
      onClose={onClose}
    >
      {!projectResourcesLoaded && (
        <div role="status" className="config-trust-notice">
          {t("trust.pluginsNotLoaded")}
        </div>
      )}

      <ConfigSplitView>
        <ConfigSidebar>
          <ConfigSidebarList>
            {loading ? (
              <div className="config-sidebar-message">Loading...</div>
            ) : error ? (
              <div className="config-sidebar-message is-error">{error}</div>
            ) : packages.length === 0 ? (
              <div className="config-sidebar-message is-empty">
                No plugins configured
              </div>
            ) : (
              groupedPackages.map((group) => (
                <div key={group.scope} className="config-sidebar-group">
                  <ConfigSidebarGroupLabel>
                    {group.scope}
                  </ConfigSidebarGroupLabel>
                  {group.packages.map((pkg) => {
                    const key = packageKey(pkg);
                    const isSelected = !addMode && selected === key;
                    return (
                      <ConfigSidebarItem
                        key={key}
                        active={isSelected}
                        onClick={() => {
                          setSelected(key);
                          setAddMode(false);
                          setActionError(null);
                          setActionMessage(null);
                        }}
                      >
                        <ConfigStatusDot
                          active={!pkg.disabled}
                          color={statusColor(pkg.status)}
                        />
                        <ConfigSidebarText
                          className={`is-grow${pkg.disabled ? " is-muted" : ""}`}
                        >
                          {pkg.source}
                        </ConfigSidebarText>
                        {effectiveStatuses[packageKey(pkg)]?.state ===
                          "update-available" && (
                          <span
                            title={t("i18n.updateAvailable")}
                            className="skill-update-indicator"
                          >
                            ↑
                          </span>
                        )}
                      </ConfigSidebarItem>
                    );
                  })}
                </div>
              ))
            )}
          </ConfigSidebarList>
          <ConfigListAction
            active={addMode}
            onClick={() => {
              setAddMode(true);
              setActionError(null);
              setActionMessage(null);
            }}
          >
            {t("i18n.addPlugin")}
          </ConfigListAction>
        </ConfigSidebar>

        <ConfigDetail>
          <ConfigDetailStack className="is-fill">
            {addMode ? (
              <AddPluginPanel
                cwd={cwd}
                source={installSource}
                scope={installScope}
                projectResourcesLoaded={projectResourcesLoaded}
                busy={addBusy}
                actionError={actionError}
                onSourceChange={setInstallSource}
                onScopeChange={setInstallScope}
                onInstall={installPlugin}
              />
            ) : loading ? null : selectedPackage ? (
              <PackageDetail
                key={packageKey(selectedPackage)}
                pkg={selectedPackage}
                cwd={cwd}
                busyKey={busyKey}
                actionError={actionError}
                actionMessage={actionMessage}
                sessionId={sessionId}
                updateStatus={effectiveStatuses[packageKey(selectedPackage)]}
                checkingUpdate={checkingUpdates.has(
                  packageKey(selectedPackage),
                )}
                updateError={updateError}
                onAction={runAction}
                onCheckUpdate={() => void checkForUpdates(selectedPackage)}
                onUpdateRequest={(target) =>
                  setConfirmTarget({ kind: "single", pkg: target })
                }
                onReloadSession={reloadSession}
              />
            ) : (
              <ConfigEmptyState>{t("i18n.selectPackage")}</ConfigEmptyState>
            )}
          </ConfigDetailStack>
        </ConfigDetail>
      </ConfigSplitView>

      <ConfigFooter
        status={
          availableUpdateCount > 0 ? (
            <span style={{ fontSize: 12, color: "var(--accent)" }}>
              {availableUpdateCount}{" "}
              {availableUpdateCount === 1
                ? t("i18n.update")
                : t("i18n.updates")}
            </span>
          ) : data?.diagnostics.length ? (
            <span
              title={data.diagnostics
                .map(
                  (d) =>
                    `${d.type}: ${d.source ? `${d.source}: ` : ""}${d.message}`,
                )
                .join("\n")}
              style={{
                color: data.diagnostics.some((d) => d.type === "error")
                  ? "#ef4444"
                  : "#d97706",
              }}
            >
              {data.diagnostics.length} diagnostic
              {data.diagnostics.length === 1 ? "" : "s"}
            </span>
          ) : (
            <span>
              {data
                ? `${data.totals.extensions} ext · ${data.totals.skills} skills · ${data.totals.prompts} prompts · ${data.totals.themes} themes`
                : ""}
            </span>
          )
        }
      >
        {!embedded && (
          <ConfigButton onClick={onClose}>{t("i18n.close")}</ConfigButton>
        )}
        {hasCheckablePackages && (
          <ConfigButton
            variant={availableUpdateCount > 0 ? "primary" : "secondary"}
            onClick={() =>
              void (availableUpdateCount > 0
                ? setConfirmTarget({
                    kind: "all",
                    items: Object.values(effectiveStatuses).filter(
                      (status) => status.state === "update-available",
                    ),
                  })
                : checkForUpdates())
            }
            disabled={footerBusy}
            title={
              availableUpdateCount > 0
                ? t("i18n.updateAllPluginsHint")
                : undefined
            }
          >
            {checkingAll
              ? t("i18n.checking")
              : availableUpdateCount > 0
                ? `${t("i18n.updateAllPlugins")} (${availableUpdateCount})`
                : t("i18n.checkUpdates")}
          </ConfigButton>
        )}
        <ConfigButton
          variant="secondary"
          onClick={() => void loadPlugins()}
          disabled={footerBusy}
        >
          {t("i18n.refresh")}
        </ConfigButton>
      </ConfigFooter>

      {confirmTarget && (
        <UpdateConfirmDialog
          target={confirmTarget}
          busy={dialogBusy}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={() =>
            void (confirmTarget.kind === "single"
              ? (async () => {
                  const target = confirmTarget;
                  setConfirmTarget(null);
                  await runAction("update", target.pkg);
                })()
              : updateAllPlugins())
          }
        />
      )}
    </ConfigPanelShell>
  );
}
