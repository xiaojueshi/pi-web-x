import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

export interface SubagentSettings {
  builtInEnabled: boolean;
}

type StoredSubagentSettings = Record<string, unknown> & {
  version?: unknown;
  builtInEnabled?: unknown;
};

export function getSubagentSettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "agents", "settings.json");
}

function readStoredSettings(settingsPath: string): StoredSubagentSettings {
  if (!existsSync(settingsPath)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (cause) {
    // 保持抛出契约：损坏的设置文件必须显式失败，不能静默回退。
    throw new Error("Invalid subagent settings: not valid JSON", { cause });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid subagent settings: expected an object");
  }
  return parsed as StoredSubagentSettings;
}

export function readSubagentSettings(
  settingsPath = getSubagentSettingsPath(),
): SubagentSettings {
  const stored = readStoredSettings(settingsPath);
  return { builtInEnabled: stored.builtInEnabled === true };
}

/**
 * 判断内置 subagent 是否启用。
 *
 * 读取 agents/settings.json 的 builtInEnabled 字段：默认关闭，写入后生效；
 * 设置文件缺失或损坏时 fail closed（视为未启用）。
 *
 * @param settingsPath 设置文件路径，默认取 agentDir/agents/settings.json。
 * @returns 是否启用内置 subagent。
 */
export function isBuiltInSubagentsEnabled(
  settingsPath = getSubagentSettingsPath(),
): boolean {
  try {
    return readSubagentSettings(settingsPath).builtInEnabled;
  } catch {
    // 设置损坏时 fail closed：不误暴露内置 subagent。
    return false;
  }
}

export function writeBuiltInSubagentsEnabled(
  enabled: boolean,
  settingsPath = getSubagentSettingsPath(),
): SubagentSettings {
  const stored = readStoredSettings(settingsPath);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writePrivateFileAtomicSync(
    settingsPath,
    JSON.stringify(
      {
        ...stored,
        version: 1,
        builtInEnabled: enabled,
      },
      null,
      2,
    ),
  );
  return { builtInEnabled: enabled };
}
