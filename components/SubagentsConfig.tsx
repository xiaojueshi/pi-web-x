"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectTrustStatus } from "@/lib/api-types";
import type {
  SubagentProfile,
  SubagentScope,
  SubagentWritableScope,
} from "@/lib/subagents";
import { useI18n } from "@/hooks/useI18n";
import { ConfigSwitch } from "./SettingsUi";

const SCOPE_PRIORITY: Record<SubagentScope, number> = {
  builtin: 0,
  global: 1,
  workspace: 2,
  project: 3,
};
const TOOL_OPTIONS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const THINKING_OPTIONS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

type EditableProfile = Omit<SubagentProfile, "scope" | "filePath">;

function emptyProfile(): EditableProfile {
  return {
    name: "",
    displayName: "",
    description: "",
    systemPrompt: "",
    tools: ["read"],
    loadSkills: false,
    loadExtensions: false,
    inheritContext: false,
    runInBackground: false,
    enabled: true,
  };
}

function toEditable(profile: SubagentProfile): EditableProfile {
  const { scope: _scope, filePath: _filePath, ...editable } = profile;
  return { ...editable, tools: [...editable.tools] };
}

function isEffective(
  profile: SubagentProfile,
  profiles: readonly SubagentProfile[],
): boolean {
  return !profiles.some(
    (candidate) =>
      candidate.name.toLowerCase() === profile.name.toLowerCase() &&
      SCOPE_PRIORITY[candidate.scope] > SCOPE_PRIORITY[profile.scope],
  );
}

/** 内置 subagent 的开关与 profile 管理设置页。 */
export function SubagentsConfig({
  cwd,
  projectTrust,
  onTrustProject,
}: {
  cwd: string | null;
  projectTrust: ProjectTrustStatus | null;
  onTrustProject?: () => void;
}) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [profiles, setProfiles] = useState<SubagentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [availableModels, setAvailableModels] = useState<
    { id: string; name: string; provider: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<SubagentWritableScope>("global");
  const [editing, setEditing] = useState<EditableProfile | null>(null);
  const [original, setOriginal] = useState<EditableProfile | null>(null);

  const [selectedProfileKey, setSelectedProfileKey] = useState<string | null>(null);
  const projectWritable = Boolean(
    cwd &&
      projectTrust &&
      (!projectTrust.requiresTrust || projectTrust.trusted),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const suffix = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      const [settingsResponse, profilesResponse] = await Promise.all([
        fetch("/api/subagents/settings"),
        fetch(`/api/subagents/profiles${suffix}`),
      ]);
      const settingsData = (await settingsResponse.json()) as {
        enabled?: boolean;
        error?: string;
      };
      const profilesData = (await profilesResponse.json()) as {
        profiles?: SubagentProfile[];
        error?: string;
      };
      if (!settingsResponse.ok || settingsData.error)
        throw new Error(
          settingsData.error ?? `HTTP ${settingsResponse.status}`,
        );
      if (!profilesResponse.ok || profilesData.error)
        throw new Error(
          profilesData.error ?? `HTTP ${profilesResponse.status}`,
        );
      setEnabled(settingsData.enabled === true);
      setProfiles(profilesData.profiles ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [cwd]);


  useEffect(() => {
    let cancelled = false;
    const suffix = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    void fetch(`/api/models${suffix}`)
      .then(async (response) => {
        const data = (await response.json()) as {
          modelList?: { id: string; name: string; provider: string }[];
        };
        if (!cancelled) setAvailableModels(data.modelList ?? []);
      })
      .catch(() => {
        if (!cancelled) setAvailableModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveEnabled = async (next: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/subagents/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = (await response.json()) as {
        enabled?: boolean;
        error?: string;
      };
      if (!response.ok || data.error)
        throw new Error(data.error ?? `HTTP ${response.status}`);
      setEnabled(data.enabled === true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const submitProfile = async () => {
    if (!editing) return;
    if (
      (editing.inheritContext && !original?.inheritContext) ||
      (editing.loadExtensions && !original?.loadExtensions)
    ) {
      const accepted = window.confirm(t("settings.subagentsSensitiveConfirm"));
      if (!accepted) return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(cwd ? { cwd } : {}),
          scope,
          profile: editing,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok || data.error)
        throw new Error(data.error ?? `HTTP ${response.status}`);
      setEditing(null);
      setOriginal(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const toggleProfile = async (profile: SubagentProfile, next: boolean) => {
    if (profile.scope !== "global" && profile.scope !== "project") return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(cwd ? { cwd } : {}),
          scope: profile.scope,
          name: profile.name,
          enabled: next,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok || data.error)
        throw new Error(data.error ?? `HTTP ${response.status}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const deleteProfile = async (profile: SubagentProfile) => {
    if (
      !window.confirm(
        t("settings.subagentsDeleteConfirm", {
          name: profile.displayName,
          scope: profile.scope,
        }),
      )
    )
      return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(cwd ? { cwd } : {}),
          scope: profile.scope,
          name: profile.name,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok || data.error)
        throw new Error(data.error ?? `HTTP ${response.status}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const sortedProfiles = useMemo(
    () =>
      [...profiles].sort(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          SCOPE_PRIORITY[a.scope] - SCOPE_PRIORITY[b.scope],
      ),
    [profiles],
  );
  const selectedProfile = sortedProfiles.find(
    (profile) => `${profile.scope}:${profile.name}` === selectedProfileKey,
  ) ?? sortedProfiles[0] ?? null;
  const optionDescriptions = {
    enabled: t("settings.subagentsOptionEnabledDescription"),
    loadSkills: t("settings.subagentsOptionSkillsDescription"),
    loadExtensions: t("settings.subagentsOptionExtensionsDescription"),
    inheritContext: t("settings.subagentsOptionContextDescription"),
    runInBackground: t("settings.subagentsOptionBackgroundDescription"),
  };



  return (
    <div className="settings-general settings-subagents-page">
      <h2 className="settings-general-title">{t("settings.subagents")}</h2>
      <section className="settings-general-section">
        <div className="settings-heading-with-info">
          <h3 className="settings-general-heading">
            {t("settings.subagentsHeading")}
          </h3>
          <span
            className="settings-info-tooltip"
            data-tooltip={t("settings.subagentsDisabledDescription")}
            aria-label={t("settings.subagentsDisabledDescription")}
            tabIndex={0}
          />
        </div>
        <div className="settings-shell-option">
          <span>{t("settings.subagentsEnabled")}</span>
          <ConfigSwitch
            checked={enabled}
            loading={saving}
            label={t("settings.subagentsEnabled")}
            onChange={(next) => void saveEnabled(next)}
          />
        </div>
      </section>

      {cwd && projectTrust?.requiresTrust && !projectTrust.trusted && (
        <section className="settings-general-section">
          <h3 className="settings-general-heading">
            {t("settings.subagentsTrustRestricted")}
          </h3>
          <p className="settings-general-description">
            {t("settings.subagentsTrustRestrictedDescription")}
          </p>
          <button
            type="button"
            className="auth-form-submit"
            onClick={onTrustProject}
          >
            {t("settings.trustProject")}
          </button>
        </section>
      )}

      <section className="settings-general-section">
        <div className="settings-shell-option">
          <div className="settings-heading-with-info">
            <h3 className="settings-general-heading">
              {t("settings.subagentsProfiles")}
            </h3>
            <span
              className="settings-info-tooltip"
              data-tooltip={t("settings.subagentsProfilesDescription")}
              aria-label={t("settings.subagentsProfilesDescription")}
              tabIndex={0}
            />
          </div>
          <button
            type="button"
            className="auth-form-submit"
            disabled={saving}
            onClick={() => {
              setScope("global");
              setEditing(emptyProfile());
              setOriginal(null);
            }}
          >
            {t("settings.subagentsNewProfile")}
          </button>
        </div>
        {loading ? (
          <p>{t("settings.subagentsLoading")}</p>
        ) : (
          sortedProfiles.map((profile) => {
            const writable =
              profile.scope === "global" ||
              (profile.scope === "project" && projectWritable);
            const effective = isEffective(profile, profiles);
            return (
              <div
                key={`${profile.scope}:${profile.name}`}
                className={`settings-subagents-profile-row${selectedProfile === profile && !editing ? " is-selected" : ""}`}
                onClick={() => {
                  setSelectedProfileKey(`${profile.scope}:${profile.name}`);
                  setEditing(null);
                  setOriginal(null);
                }}
              >
                <div className="settings-subagents-profile-summary">
                  <strong>{profile.displayName}</strong>{" "}
                  <span className="settings-subagents-profile-meta">
                    {profile.scope} ·{" "}
                    {effective
                      ? t("settings.subagentsEffective")
                      : t("settings.subagentsOverridden")}
                  </span>
                  <div className="settings-subagents-profile-description">
                    {profile.description}
                  </div>
                </div>
                {writable ? (
                  <div className="settings-subagents-profile-actions" onClick={(event) => event.stopPropagation()}>
                    <ConfigSwitch
                      checked={profile.enabled}
                      loading={saving}
                      label={t("settings.subagentsEnabledProfile", {
                        name: profile.displayName,
                      })}
                      onChange={(next) => void toggleProfile(profile, next)}
                    />
                    <button
                      type="button"
                      className="settings-subagents-action"
                      onClick={() => {
                        setScope(profile.scope as SubagentWritableScope);
                        const value = toEditable(profile);
                        setEditing(value);
                        setOriginal(value);
                      }}
                    >
                      {t("settings.subagentsEdit")}
                    </button>
                    <button
                      type="button"
                      className="settings-subagents-action is-danger"
                      disabled={saving}
                      onClick={() => void deleteProfile(profile)}
                    >
                      {t("settings.subagentsDelete")}
                    </button>
                  </div>
                ) : (
                  <span className="settings-subagents-profile-meta">
                    {t("settings.subagentsReadOnly")}
                  </span>
                )}
              </div>
            );
          })
        )}
      </section>

      {!editing && selectedProfile && (
        <section className="settings-subagents-readonly-detail">
          <div className="config-detail-header">
            <div className="config-detail-header-info">
              <strong className="config-detail-title">{selectedProfile.displayName}</strong>
              <span className="config-scope-tag">{selectedProfile.scope}</span>
            </div>
          </div>
          <p className="settings-subagents-detail-description">{selectedProfile.description}</p>
          <dl className="settings-subagents-detail-grid">
            <div><dt>{t("settings.subagentsName")}</dt><dd>{selectedProfile.name}</dd></div>
            <div><dt>{t("settings.subagentsModel")}</dt><dd>{selectedProfile.model || t("settings.subagentsDefault")}</dd></div>
            <div><dt>{t("settings.subagentsThinking")}</dt><dd>{selectedProfile.thinking || t("settings.subagentsDefault")}</dd></div>
            <div><dt>{t("settings.subagentsMaxTurns")}</dt><dd>{selectedProfile.maxTurns || "—"}</dd></div>
            <div className="is-wide"><dt>{t("settings.subagentsTools")}</dt><dd>{selectedProfile.tools.join(", ") || "—"}</dd></div>
            <div className="is-wide"><dt>{t("settings.subagentsSystemPrompt")}</dt><dd className="settings-subagents-prompt-preview">{selectedProfile.systemPrompt || "—"}</dd></div>
          </dl>
          <div className="settings-subagents-detail-actions">
            {selectedProfile.scope === "global" ||
            (selectedProfile.scope === "project" && projectWritable) ? (
              <>
                <ConfigSwitch
                  checked={selectedProfile.enabled}
                  loading={saving}
                  label={t("settings.subagentsEnabledProfile", { name: selectedProfile.displayName })}
                  onChange={(next) => void toggleProfile(selectedProfile, next)}
                />
                <button type="button" className="settings-subagents-action" onClick={() => {
                  setScope(selectedProfile.scope as SubagentWritableScope);
                  const value = toEditable(selectedProfile);
                  setEditing(value);
                  setOriginal(value);
                }}>{t("settings.subagentsEdit")}</button>
                <button type="button" className="settings-subagents-action is-danger" disabled={saving} onClick={() => void deleteProfile(selectedProfile)}>{t("settings.subagentsDelete")}</button>
              </>
            ) : (
              <button type="button" className="settings-subagents-action" onClick={() => {
                setScope("global");
                setEditing(toEditable(selectedProfile));
                setOriginal(null);
              }}>{t("settings.subagentsCustomize")}</button>
            )}
          </div>
        </section>
      )}

      {editing && (
        <section className="settings-general-section">
          <h3 className="settings-general-heading">
            {original
              ? t("settings.subagentsEditProfile")
              : t("settings.subagentsCreateProfile")}
          </h3>
          <div className="settings-subagents-form">
            <label>
              {t("settings.subagentsScope")}
              <select
                value={scope}
                onChange={(event) =>
                  setScope(event.target.value as SubagentWritableScope)
                }
              >
                <option value="global">{t("settings.subagentsGlobal")}</option>
                <option value="project" disabled={!projectWritable}>
                  {t("settings.subagentsProject")}
                </option>
              </select>
            </label>
            <label>
              {t("settings.subagentsName")}
              <input
                value={editing.name}
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
                disabled={Boolean(original)}
              />
            </label>
            <label>
              {t("settings.subagentsDisplayName")}
              <input
                value={editing.displayName}
                onChange={(event) =>
                  setEditing({ ...editing, displayName: event.target.value })
                }
              />
            </label>
            <label>
              {t("settings.subagentsDescriptionLabel")}
              <input
                value={editing.description}
                onChange={(event) =>
                  setEditing({ ...editing, description: event.target.value })
                }
              />
            </label>
            <label className="settings-subagents-field is-wide">
              {t("settings.subagentsSystemPrompt")}
              <textarea
                value={editing.systemPrompt}
                onChange={(event) =>
                  setEditing({ ...editing, systemPrompt: event.target.value })
                }
                rows={6}
              />
            </label>
            <div className="settings-subagents-field is-wide">
              <span>{t("settings.subagentsTools")}</span>
              <div className="settings-subagents-tool-options">
                {TOOL_OPTIONS.map((tool) => (
                  <label key={tool} className="settings-subagents-checkbox">
                    <input
                      type="checkbox"
                      checked={editing.tools.includes(tool)}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          tools: event.target.checked
                            ? [...editing.tools, tool]
                            : editing.tools.filter((item) => item !== tool),
                        })
                      }
                    />
                    <span>{tool}</span>
                  </label>
                ))}
              </div>
            </div>
            <label>
              {t("settings.subagentsModel")}
              <select
                value={editing.model ?? ""}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    model: event.target.value || undefined,
                  })
                }
              >
                <option value="">{t("settings.subagentsDefault")}</option>
                {editing.model &&
                  !availableModels.some(
                    (model) => model.provider + "/" + model.id === editing.model,
                  ) && <option value={editing.model}>{editing.model}</option>}
                {availableModels.map((model) => (
                  <option
                    key={model.provider + "/" + model.id}
                    value={model.provider + "/" + model.id}
                  >
                    {model.provider} · {model.name || model.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("settings.subagentsThinking")}
              <select
                value={editing.thinking ?? ""}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    thinking: (event.target.value ||
                      undefined) as EditableProfile["thinking"],
                  })
                }
              >
                <option value="">{t("settings.subagentsDefault")}</option>
                {THINKING_OPTIONS.map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </label>
            <label>
              {t("settings.subagentsMaxTurns")}
              <input
                type="number"
                min={1}
                value={editing.maxTurns ?? ""}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    maxTurns: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  })
                }
              />
            </label>
            <div className="settings-subagents-switches">
              {(
                [
                  "enabled",
                  "loadSkills",
                  "loadExtensions",
                  "inheritContext",
                  "runInBackground",
                ] as const
              ).map((key) => (
                <label key={key} className="settings-subagents-checkbox">
                  <input
                    type="checkbox"
                    checked={editing[key]}
                    onChange={(event) =>
                      setEditing({ ...editing, [key]: event.target.checked })
                    }
                  />{" "}
                  {key}
                  <span
                    className="settings-info-tooltip"
                    data-tooltip={optionDescriptions[key]}
                    aria-label={optionDescriptions[key]}
                    tabIndex={0}
                    onClick={(event) => event.preventDefault()}
                  />
                </label>
              ))}
            </div>
            <div className="settings-subagents-form-actions">
              <button
                type="button"
                className="auth-form-submit"
                disabled={saving || !editing.name.trim()}
                onClick={() => void submitProfile()}
              >
                {t("settings.subagentsSave")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setOriginal(null);
                }}
              >
                {t("settings.subagentsCancel")}
              </button>
            </div>
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="settings-general-error">
          {error}
        </p>
      )}
    </div>
  );
}
