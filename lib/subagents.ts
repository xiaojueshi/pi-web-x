import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { dump as stringifyYaml } from "js-yaml";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from "fs";
import { basename, dirname, join, resolve } from "path";
import { readFrontmatterBlock } from "./frontmatter";
import { getProjectTrustStatus } from "./project-trust";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { isExistingPathWithinRoots } from "./path-security";
import { PRESET_READ_ONLY } from "./tool-presets";
import type { SessionEntry, SubagentSessionStatus } from "./types";

export const SUBAGENT_META_TYPE = "pi-web-x:subagent";
export const SUBAGENT_RESULT_TYPE = "pi-web-x:subagent-result";
export const SUBAGENT_CONTROL_TOOL_NAMES = [
  "Agent",
  "get_subagent_result",
  "steer_subagent",
] as const;

export type SubagentStatus = SubagentSessionStatus;
export type SubagentScope = "builtin" | "global" | "workspace" | "project";
export type SubagentWritableScope = Extract<
  SubagentScope,
  "global" | "project"
>;

export interface SubagentProfile {
  name: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  /** 未解释、未启用的 legacy extension tool selector，仅用于配置写回。 */
  toolSelectors?: string[];
  loadSkills: boolean;
  loadExtensions: boolean;
  model?: string;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  inheritContext: boolean;
  runInBackground: boolean;
  enabled: boolean;
  scope: SubagentScope;
  filePath?: string;
}

export interface SubagentMetadata {
  version: 1;
  parentSessionId: string;
  parentSessionPath: string;
  parentToolCallId: string;
  profile: string;
  description: string;
  task: string;
  runInBackground: boolean;
  createdAt: string;
  resourceSnapshot: SubagentResourceSnapshot;
}

export interface SubagentResourceSnapshot {
  version: 1;
  appendSystemPrompt: string[];
  tools: string[];
  loadSkills: boolean;
  loadExtensions: boolean;
}

export interface SubagentSessionResources {
  appendSystemPrompt: string[];
  tools: string[];
  loadSkills: boolean;
  loadExtensions: boolean;
}

export interface SubagentResultMetadata {
  version: 1;
  status: Exclude<SubagentStatus, "starting" | "running" | "interrupted">;
  completedAt: string;
  result?: string;
  error?: string;
}

export interface SubagentRunInfo {
  sessionId: string;
  sessionPath: string;
  parentSessionId: string;
  parentToolCallId: string;
  profile: string;
  description: string;
  task: string;
  runInBackground: boolean;
  status: SubagentStatus;
  createdAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
  /** 父会话停止级联造成的终止不得再次唤醒父 Agent。 */
  suppressParentNotification?: boolean;
}

const DEFAULT_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const BUILTIN_TOOLS = new Set(DEFAULT_TOOLS);
const SUBAGENT_CONTROL_TOOLS = new Set<string>(SUBAGENT_CONTROL_TOOL_NAMES);
const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const BUILTIN_PROFILES: SubagentProfile[] = [
  {
    name: "general-purpose",
    displayName: "General purpose",
    description: "Handle a focused implementation or investigation task",
    systemPrompt:
      "Work autonomously on the delegated task. Keep the final answer concise and include important files, decisions, and remaining risks.",
    tools: DEFAULT_TOOLS,
    loadSkills: false,
    loadExtensions: false,
    inheritContext: false,
    runInBackground: false,
    enabled: true,
    scope: "builtin",
  },
  {
    name: "explore",
    displayName: "Explore",
    description: "Quickly inspect a codebase without modifying it",
    systemPrompt:
      "Explore the codebase to answer the delegated question. Do not modify files. Report concrete findings with file paths and relevant symbols.",
    tools: [...PRESET_READ_ONLY],
    loadSkills: false,
    loadExtensions: false,
    inheritContext: false,
    runInBackground: false,
    enabled: true,
    scope: "builtin",
  },
  {
    name: "plan",
    displayName: "Plan",
    description: "Design an implementation plan without modifying files",
    systemPrompt:
      "Produce an implementation-ready plan for the delegated task. Inspect the repository as needed, do not modify files, and call out dependencies, risks, and verification steps.",
    tools: [...PRESET_READ_ONLY],
    loadSkills: false,
    loadExtensions: false,
    inheritContext: false,
    runInBackground: false,
    enabled: true,
    scope: "builtin",
  },
];

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toolValues(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function parseTools(value: unknown, fallback: string[]): string[] {
  const tools = toolValues(value);
  if (tools.includes("none")) return [];
  if (tools.includes("all") || tools.includes("*")) return [...DEFAULT_TOOLS];
  if (tools.length === 0) return [...fallback];
  return [...new Set(tools.filter((tool) => BUILTIN_TOOLS.has(tool)))];
}

/** 保留历史 ext: selector，但绝不把它解释成可执行工具或权限。 */
function parseToolSelectors(value: unknown): string[] {
  return [
    ...new Set(toolValues(value).filter((tool) => tool.startsWith("ext:"))),
  ];
}

function parseProfileFile(
  filePath: string,
  scope: SubagentScope,
): SubagentProfile | null {
  try {
    const source = readFileSync(filePath, "utf8");
    const { data, rest, found, valid } = readFrontmatterBlock(source);
    if (found && !valid) return null;
    const name = basename(filePath, ".md");
    const thinkingValue = stringValue(data?.thinking) as
      | ThinkingLevel
      | undefined;
    const maxTurnsValue =
      typeof data?.max_turns === "number"
        ? Math.floor(data.max_turns)
        : undefined;
    const tools = parseTools(data?.tools, DEFAULT_TOOLS);
    const disallowedTools = new Set(parseTools(data?.disallowed_tools, []));
    return {
      name,
      displayName: stringValue(data?.display_name) ?? name,
      description: stringValue(data?.description) ?? name,
      systemPrompt: rest.trim(),
      tools: tools.filter((tool) => !disallowedTools.has(tool)),
      ...(parseToolSelectors(data?.tools).length > 0
        ? { toolSelectors: parseToolSelectors(data?.tools) }
        : {}),
      loadSkills: booleanValue(data?.load_skills, false),
      loadExtensions: booleanValue(data?.load_extensions, false),
      ...(stringValue(data?.model) ? { model: stringValue(data?.model) } : {}),
      ...(thinkingValue && THINKING_LEVELS.has(thinkingValue)
        ? { thinking: thinkingValue }
        : {}),
      ...(maxTurnsValue && maxTurnsValue > 0
        ? { maxTurns: maxTurnsValue }
        : {}),
      inheritContext: booleanValue(data?.inherit_context, false),
      runInBackground: booleanValue(data?.run_in_background, false),
      enabled: booleanValue(data?.enabled, true),
      scope,
      filePath,
    };
  } catch {
    return null;
  }
}

function isProjectProfilePathAllowed(cwd: string, target: string): boolean {
  return isExistingPathWithinRoots(target, new Set([cwd]));
}

function readProfileDirectory(
  dir: string,
  scope: SubagentScope,
  cwd: string,
): SubagentProfile[] {
  if (!existsSync(dir)) return [];
  if (scope !== "global" && !isProjectProfilePathAllowed(cwd, dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => parseProfileFile(join(dir, entry.name), scope))
    .filter((profile): profile is SubagentProfile => profile !== null);
}

function profileDirectories(
  cwd: string,
): Array<[string, Exclude<SubagentScope, "builtin">]> {
  return [
    [join(getAgentDir(), "agents"), "global"],
    [join(resolve(cwd), ".agents", "agents"), "workspace"],
    [join(resolve(cwd), ".pi", "agents"), "project"],
  ];
}

/** Every configured source, including profiles shadowed by a higher-precedence scope. */
export function listSubagentProfileSources(cwd: string): SubagentProfile[] {
  const profiles = BUILTIN_PROFILES.map((profile) => ({
    ...profile,
    tools: [...profile.tools],
  }));
  for (const [dir, scope] of profileDirectories(cwd)) {
    profiles.push(...readProfileDirectory(dir, scope, cwd));
  }
  return profiles.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function listResolvedSubagentProfiles(
  cwd: string,
  includeRepositoryProfiles: boolean,
): SubagentProfile[] {
  const byName = new Map(
    BUILTIN_PROFILES.map((profile) => [
      profile.name.toLowerCase(),
      { ...profile, tools: [...profile.tools] },
    ]),
  );
  for (const [dir, scope] of profileDirectories(cwd)) {
    if (
      !includeRepositoryProfiles &&
      (scope === "workspace" || scope === "project")
    )
      continue;
    for (const profile of readProfileDirectory(dir, scope, cwd))
      byName.set(profile.name.toLowerCase(), profile);
  }
  return [...byName.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

export function listSubagentProfiles(cwd: string): SubagentProfile[] {
  return listResolvedSubagentProfiles(cwd, true);
}

/** 供运行时注册 Agent 工具使用，未信任项目不贡献仓库 profile。 */
/**
 * 返回当前项目中允许进入内置 Agent 工具的有效 profile。
 *
 * 未信任项目的工作区与项目 profile 不参与解析，但内置和全局 profile 仍可用。
 *
 * @param cwd 项目工作目录。
 * @returns 按来源优先级去重后的可运行 profile。
 */
export function listRunnableSubagentProfiles(cwd: string): SubagentProfile[] {
  return listResolvedSubagentProfiles(
    cwd,
    getProjectTrustStatus(cwd, getAgentDir()).trusted,
  );
}

export function resolveSubagentProfile(
  cwd: string,
  name: string,
): SubagentProfile | undefined {
  return listSubagentProfiles(cwd).find(
    (profile) =>
      profile.name.toLowerCase() === name.trim().toLowerCase() &&
      profile.enabled,
  );
}

/** 运行时解析版本，显式拒绝未信任仓库提供的 profile。 */
/**
 * 按名称解析一个允许执行的 profile。
 *
 * @param cwd 项目工作目录。
 * @param name Agent 工具请求的 profile 名称，不区分大小写。
 * @returns 已启用且满足项目可信边界的 profile；无法解析时返回 `undefined`。
 */
export function resolveRunnableSubagentProfile(
  cwd: string,
  name: string,
): SubagentProfile | undefined {
  return listRunnableSubagentProfiles(cwd).find(
    (profile) =>
      profile.name.toLowerCase() === name.trim().toLowerCase() &&
      profile.enabled,
  );
}

function assertProfileName(name: string): string {
  const normalized = name.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) {
    throw new Error(
      "Agent name may contain only letters, numbers, dots, underscores, and hyphens",
    );
  }
  return normalized;
}

function writableProfileDirectory(
  cwd: string,
  scope: SubagentWritableScope,
): string {
  if (scope === "global") return join(getAgentDir(), "agents");
  if (scope === "project") return join(resolve(cwd), ".pi", "agents");
  throw new Error("Agent scope must be global or project");
}

function assertWritableProfileDirectory(
  cwd: string,
  scope: SubagentWritableScope,
): string {
  const dir = writableProfileDirectory(cwd, scope);
  if (scope === "global") return dir;

  let existingAncestor = dir;
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor)
      throw new Error("Agent profile directory is outside the project root");
    existingAncestor = parent;
  }
  if (!isProjectProfilePathAllowed(cwd, existingAncestor)) {
    throw new Error("Agent profile directory is outside the project root");
  }
  return dir;
}

/** 返回同一作用域内与 profile 名大小写无关匹配的文件路径。 */
function matchingProfilePaths(dir: string, name: string): string[] {
  if (!existsSync(dir)) return [];
  const normalized = name.toLowerCase();
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        basename(entry.name, ".md").toLowerCase() === normalized,
    )
    .map((entry) => join(dir, entry.name));
}

export function saveSubagentProfile(
  cwd: string,
  scope: SubagentWritableScope,
  profile: Omit<SubagentProfile, "scope" | "filePath">,
): SubagentProfile {
  const name = assertProfileName(profile.name);
  const tools = [
    ...new Set(profile.tools.filter((tool) => BUILTIN_TOOLS.has(tool))),
  ];
  // ext: selector 仅作为不可执行的配置数据保留，运行时始终只使用 tools。
  const toolSelectors = parseToolSelectors(profile.toolSelectors);
  if (profile.thinking && !THINKING_LEVELS.has(profile.thinking)) {
    throw new Error(`Invalid thinking level: ${profile.thinking}`);
  }
  if (
    profile.maxTurns !== undefined &&
    (!Number.isFinite(profile.maxTurns) || profile.maxTurns < 0)
  ) {
    throw new Error("Max turns must be a non-negative number");
  }
  const maxTurns =
    profile.maxTurns && profile.maxTurns > 0
      ? Math.floor(profile.maxTurns)
      : undefined;
  const displayName = profile.displayName.trim() || name;
  const description = profile.description.trim() || name;
  const systemPrompt = profile.systemPrompt.trim();
  const model = profile.model?.trim() || undefined;
  const loadSkills = profile.loadSkills === true;
  const loadExtensions = profile.loadExtensions === true;
  const dir = assertWritableProfileDirectory(cwd, scope);
  mkdirSync(dir, { recursive: true });
  if (scope === "project" && !isProjectProfilePathAllowed(cwd, dir)) {
    throw new Error("Agent profile directory is outside the project root");
  }
  const matchingPaths = matchingProfilePaths(dir, name);
  if (matchingPaths.length > 1) {
    throw new Error(
      "Multiple agent profile files differ only by letter case; resolve them before saving",
    );
  }
  // 使用已有文件的大小写，避免在大小写敏感文件系统中创建同名幽灵 profile。
  const filePath = matchingPaths[0] ?? join(dir, `${name}.md`);
  let preserved: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    const source = readFileSync(filePath, "utf8");
    const parsed = readFrontmatterBlock(source);
    if (parsed.found && !parsed.valid) {
      throw new Error(
        "Refusing to overwrite malformed agent profile frontmatter",
      );
    }
    if (parsed.data) preserved = { ...parsed.data };
  }
  const frontmatter: Record<string, unknown> = {
    ...preserved,
    description,
    display_name: displayName,
    tools: [...tools, ...toolSelectors].join(", ") || "none",
    load_skills: loadSkills,
    load_extensions: loadExtensions,
    enabled: profile.enabled,
    inherit_context: profile.inheritContext,
    run_in_background: profile.runInBackground,
  };
  if (model) frontmatter.model = model;
  if (profile.thinking) frontmatter.thinking = profile.thinking;
  if (maxTurns) frontmatter.max_turns = maxTurns;
  const yaml = stringifyYaml(frontmatter, {
    noRefs: true,
    lineWidth: 1000,
  }).trimEnd();
  writePrivateFileAtomicSync(
    filePath,
    `---\n${yaml}\n---\n\n${systemPrompt}\n`,
  );
  return {
    ...profile,
    name,
    displayName,
    description,
    systemPrompt,
    tools,
    ...(toolSelectors.length > 0 ? { toolSelectors } : {}),
    loadSkills,
    loadExtensions,
    ...(model ? { model } : { model: undefined }),
    ...(maxTurns ? { maxTurns } : { maxTurns: undefined }),
    scope,
    filePath,
  };
}

export function deleteSubagentProfile(
  cwd: string,
  scope: SubagentWritableScope,
  name: string,
): void {
  const safeName = assertProfileName(name);
  const dir = assertWritableProfileDirectory(cwd, scope);
  const matchingPaths = matchingProfilePaths(dir, safeName);
  if (matchingPaths.length > 1) {
    throw new Error(
      "Multiple agent profile files differ only by letter case; resolve them before deleting",
    );
  }
  if (matchingPaths[0]) unlinkSync(matchingPaths[0]);
}

export function saveProjectSubagentProfile(
  cwd: string,
  profile: Omit<SubagentProfile, "scope" | "filePath">,
): SubagentProfile {
  return saveSubagentProfile(cwd, "project", profile);
}

export function deleteProjectSubagentProfile(cwd: string, name: string): void {
  deleteSubagentProfile(cwd, "project", name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ValidSubagentMetadataData = Record<string, unknown> & {
  version: 1;
  parentSessionId: string;
  parentSessionPath: string;
};

function subagentMetadataData(
  entries: readonly SessionEntry[],
): ValidSubagentMetadataData | null {
  const metaEntry = entries.find(
    (entry) =>
      entry.type === "custom" && entry.customType === SUBAGENT_META_TYPE,
  );
  if (!metaEntry || metaEntry.type !== "custom" || !isRecord(metaEntry.data))
    return null;
  const data = metaEntry.data;
  if (
    data.version !== 1 ||
    typeof data.parentSessionId !== "string" ||
    typeof data.parentSessionPath !== "string"
  )
    return null;
  return data as ValidSubagentMetadataData;
}

/** Restore the isolated prompt and tool scope used by a persisted subagent session. */
export function readSubagentSessionResources(
  entries: readonly SessionEntry[],
): SubagentSessionResources | null {
  const data = subagentMetadataData(entries);
  if (!data) return null;
  const snapshot = data.resourceSnapshot;
  const loadSkills = isRecord(snapshot) && snapshot.loadSkills === true;
  const loadExtensions = isRecord(snapshot) && snapshot.loadExtensions === true;
  if (
    isRecord(snapshot) &&
    snapshot.version === 1 &&
    Array.isArray(snapshot.appendSystemPrompt) &&
    snapshot.appendSystemPrompt.every((item) => typeof item === "string") &&
    Array.isArray(snapshot.tools) &&
    snapshot.tools.every(
      (item) =>
        typeof item === "string" &&
        item.length > 0 &&
        !SUBAGENT_CONTROL_TOOLS.has(item) &&
        (BUILTIN_TOOLS.has(item) || loadExtensions),
    )
  ) {
    return {
      appendSystemPrompt: [...snapshot.appendSystemPrompt],
      tools: [...new Set(snapshot.tools)],
      loadSkills,
      loadExtensions,
    };
  }
  return null;
}

export function withSubagentExtensionTools(
  profileTools: readonly string[],
  extensionToolNames: Iterable<string>,
): string[] {
  return [
    ...new Set([
      ...profileTools,
      ...[...extensionToolNames].filter(
        (name) => !SUBAGENT_CONTROL_TOOLS.has(name),
      ),
    ]),
  ];
}

export function readSubagentRun(
  entries: readonly SessionEntry[],
  sessionId: string,
  sessionPath: string,
): SubagentRunInfo | null {
  const data = subagentMetadataData(entries);
  if (!data) return null;
  const resultEntry = [...entries]
    .reverse()
    .find(
      (entry) =>
        entry.type === "custom" && entry.customType === SUBAGENT_RESULT_TYPE,
    );
  const result =
    resultEntry?.type === "custom" && isRecord(resultEntry.data)
      ? resultEntry.data
      : undefined;
  const persistedStatus =
    result &&
    (result.status === "completed" ||
      result.status === "failed" ||
      result.status === "aborted")
      ? result.status
      : "interrupted";
  return {
    sessionId,
    sessionPath,
    parentSessionId: data.parentSessionId,
    parentToolCallId:
      typeof data.parentToolCallId === "string" ? data.parentToolCallId : "",
    profile:
      typeof data.profile === "string" ? data.profile : "general-purpose",
    description:
      typeof data.description === "string" ? data.description : "Subagent",
    task: typeof data.task === "string" ? data.task : "",
    runInBackground: data.runInBackground === true,
    status: persistedStatus,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
    ...(result && typeof result.completedAt === "string"
      ? { completedAt: result.completedAt }
      : {}),
    ...(result && typeof result.result === "string"
      ? { result: result.result }
      : {}),
    ...(result && typeof result.error === "string"
      ? { error: result.error }
      : {}),
  };
}
