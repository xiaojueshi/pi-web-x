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

export function isBuiltInSubagentsEnabled(): boolean {
  return false;
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
