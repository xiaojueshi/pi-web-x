import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";

/** idle 回收启用时允许的最短分钟数。 */
export const IDLE_SESSION_REAPING_MINUTES_MIN = 5;
/** idle 回收启用时允许的最长分钟数。 */
export const IDLE_SESSION_REAPING_MINUTES_MAX = 1_440;
/** 新安装的默认 idle 回收时长。 */
export const DEFAULT_IDLE_SESSION_REAPING_MINUTES = 10;

/** 服务级 idle 回收策略。 */
export interface IdleSessionReapingSettings {
  enabled: boolean;
  timeoutMinutes: number;
}

const DEFAULT_SETTINGS: IdleSessionReapingSettings = {
  enabled: true,
  timeoutMinutes: DEFAULT_IDLE_SESSION_REAPING_MINUTES,
};

let cachedSettings: IdleSessionReapingSettings | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneSettings(
  settings: IdleSessionReapingSettings,
): IdleSessionReapingSettings {
  return { ...settings };
}

function parseSettings(value: unknown): IdleSessionReapingSettings {
  if (!isRecord(value))
    throw new Error("Invalid idle-session settings: expected an object");
  if (typeof value.enabled !== "boolean") {
    throw new Error("Invalid idle-session settings: enabled must be a boolean");
  }
  if (
    typeof value.timeoutMinutes !== "number" ||
    !Number.isInteger(value.timeoutMinutes) ||
    value.timeoutMinutes < IDLE_SESSION_REAPING_MINUTES_MIN ||
    value.timeoutMinutes > IDLE_SESSION_REAPING_MINUTES_MAX
  ) {
    throw new Error(
      `Invalid idle-session settings: timeoutMinutes must be an integer between ${IDLE_SESSION_REAPING_MINUTES_MIN} and ${IDLE_SESSION_REAPING_MINUTES_MAX}`,
    );
  }
  return { enabled: value.enabled, timeoutMinutes: value.timeoutMinutes };
}

/**
 * 返回 Pi Web X 服务级设置文件路径。
 *
 * @param home 用户主目录，测试可注入隔离目录。
 * @returns idle 回收设置文件的绝对路径。
 */
export function getIdleSessionSettingsPath(home = homedir()): string {
  return join(home, ".pi-web-x", "settings.json");
}

/**
 * 验证并规范化来自 API 的 idle 回收设置。
 *
 * @param value 未受信任的输入值。
 * @returns 可安全持久化的设置。
 * @throws 输入不符合设置协议时抛出错误。
 */
export function validateIdleSessionReapingSettings(
  value: unknown,
): IdleSessionReapingSettings {
  return parseSettings(value);
}

function readSettingsFile(path: string): IdleSessionReapingSettings {
  if (!existsSync(path)) return cloneSettings(DEFAULT_SETTINGS);
  try {
    return parseSettings(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new Error(
      `Invalid idle-session settings: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * 读取并缓存服务级 idle 回收设置。
 *
 * @param settingsPath 设置文件路径，测试可注入临时文件。
 * @returns 当前有效设置。
 * @throws 设置文件不可读或内容不合法时抛出错误。
 */
export async function readIdleSessionReapingSettings(
  settingsPath = getIdleSessionSettingsPath(),
): Promise<IdleSessionReapingSettings> {
  const isDefaultPath = settingsPath === getIdleSessionSettingsPath();
  if (!existsSync(settingsPath)) {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    if (isDefaultPath) cachedSettings = settings;
    return settings;
  }
  const release = await lockfile.lock(settingsPath, {
    realpath: false,
    retries: 10,
  });
  try {
    const settings = readSettingsFile(settingsPath);
    if (isDefaultPath) cachedSettings = settings;
    return cloneSettings(settings);
  } finally {
    await release();
  }
}

/**
 * 同步取得当前进程用于调度的 idle 回收设置。
 *
 * 首次访问会从 User Data Root 读取设置；文件不可用时回退到安全默认值，
 * 不会阻止 AgentSession 启动。
 *
 * @returns 当前进程的有效设置副本。
 */
export function getCachedIdleSessionReapingSettings(): IdleSessionReapingSettings {
  if (!cachedSettings) {
    try {
      cachedSettings = readSettingsFile(getIdleSessionSettingsPath());
    } catch (error) {
      console.error(
        "[pi-web-x] failed to load idle-session settings; using defaults:",
        error instanceof Error ? error.message : error,
      );
      cachedSettings = cloneSettings(DEFAULT_SETTINGS);
    }
  }
  return cloneSettings(cachedSettings);
}

/**
 * 写入服务级 idle 回收设置并更新当前进程缓存。
 *
 * @param value 已验证或待验证的设置值。
 * @param settingsPath 设置文件路径，测试可注入临时文件。
 * @returns 已持久化的设置。
 * @throws 设置不合法或无法安全写入时抛出错误。
 */
export async function writeIdleSessionReapingSettings(
  value: unknown,
  settingsPath = getIdleSessionSettingsPath(),
): Promise<IdleSessionReapingSettings> {
  const settings = validateIdleSessionReapingSettings(value);
  mkdirSync(dirname(settingsPath), { recursive: true });
  try {
    writeFileSync(settingsPath, "{}", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const release = await lockfile.lock(settingsPath, {
    realpath: false,
    retries: 10,
  });
  try {
    writePrivateFileAtomicSync(
      settingsPath,
      `${JSON.stringify(settings, null, 2)}\n`,
    );
    if (settingsPath === getIdleSessionSettingsPath()) {
      cachedSettings = cloneSettings(settings);
    }
    return cloneSettings(settings);
  } finally {
    await release();
  }
}
