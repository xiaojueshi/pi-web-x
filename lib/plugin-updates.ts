// 插件更新检查：对 npm 与 git 两种来源的已配置包执行只读的远端版本比较。
// 移植自上游 pi-web v0.9.0 的 lib/plugin-updates.ts，并适配本仓库的
// Bun 运行时与导入约定；语义保持一致（PI_OFFLINE、git ref 锁定、本地路径跳过）。
import { execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { gt, maxSatisfying, rcompare, valid, validRange } from "semver";
import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { PluginScope, PluginUpdateResult } from "@/lib/api-types";
import { getProjectTrustStatus } from "@/lib/project-trust";

const execFileAsync = promisify(execFile);

type ConfiguredPackage = {
  source: string;
  scope: "user" | "project";
  installedPath?: string;
};

/** 命令执行器抽象：便于测试注入伪造的 npm/git 输出。 */
type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
) => Promise<string>;

type CheckOptions = {
  packages?: ConfiguredPackage[];
  npmCommand?: string[];
  runCommand?: CommandRunner;
};

type ParsedNpmSource = {
  name: string;
  spec: string;
  version?: string;
};

function toPluginScope(scope: ConfiguredPackage["scope"]): PluginScope {
  return scope === "project" ? "project" : "global";
}

/** 解析 `npm:<name>@<spec>` 形式的插件来源。 */
function parseNpmSource(source: string): ParsedNpmSource | undefined {
  if (!source.startsWith("npm:")) return undefined;
  const spec = source.slice(4).trim();
  const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
  return {
    name: match?.[1] ?? spec,
    spec,
    version: match?.[2],
  };
}

/** 判断 git 来源（含 scp 形式与 URL 形式）是否锁定了 ref。 */
function hasGitRef(source: string): boolean {
  const value = source.startsWith("git:")
    ? source.slice(4).trim()
    : source.trim();
  const scpPath = value.match(/^git@[^:]+:(.+)$/)?.[1];
  if (scpPath) return scpPath.includes("@");
  if (value.includes("://")) {
    try {
      return new URL(value).pathname.replace(/^\/+/, "").includes("@");
    } catch {
      return false;
    }
  }
  const slash = value.indexOf("/");
  return slash >= 0 && value.slice(slash + 1).includes("@");
}

/**
 * 判断插件来源是否支持自动更新检查。
 *
 * @param source 插件来源字符串（npm:/git:/本地路径等）
 * @returns npm 未锁版本或 git 未锁 ref 时可检查；本地路径与锁定来源不可检查
 */
export function isPluginSourceCheckable(source: string): boolean {
  const npm = parseNpmSource(source);
  if (npm) return valid(npm.version ?? "") === null;
  if (source.startsWith("git:") || /^(https?|ssh|git):\/\//i.test(source)) {
    return !hasGitRef(source);
  }
  return false;
}

function result(
  pkg: ConfiguredPackage,
  state: PluginUpdateResult["state"],
  message?: string,
): PluginUpdateResult {
  const npm = parseNpmSource(pkg.source);
  return {
    source: pkg.source,
    scope: toPluginScope(pkg.scope),
    displayName: npm?.name ?? pkg.source,
    type: npm ? "npm" : "git",
    state,
    message,
  };
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    encoding: "utf8",
    timeout: 10_000,
  });
  return stdout;
}

/** 读取已安装包的 package.json 版本号，缺失或非法时抛错。 */
function readInstalledVersion(installedPath: string): string {
  let raw: string;
  try {
    raw = readFileSync(join(installedPath, "package.json"), "utf8");
  } catch (error) {
    throw new Error(
      `Installed package version is unavailable. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  let parsed: { version?: unknown };
  try {
    parsed = JSON.parse(raw) as { version?: unknown };
  } catch {
    throw new Error("Installed package version is unavailable.");
  }
  if (typeof parsed.version !== "string" || !valid(parsed.version)) {
    throw new Error("Installed package version is unavailable.");
  }
  return parsed.version;
}

/** 解析 `npm view <spec> version --json` 的输出，兼容字符串与版本数组两种形态。 */
function readLatestVersion(stdout: string, range?: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim()) as unknown;
  } catch {
    throw new Error("Unexpected response from npm view.");
  }
  if (typeof parsed === "string" && valid(parsed)) return parsed;
  if (Array.isArray(parsed)) {
    const versions = parsed.filter(
      (value): value is string =>
        typeof value === "string" && valid(value) !== null,
    );
    const latest = range
      ? maxSatisfying(versions, range)
      : versions.sort(rcompare)[0];
    if (latest) return latest;
  }
  throw new Error("Unexpected response from npm view.");
}

async function checkNpmPackage(
  pkg: ConfiguredPackage,
  cwd: string,
  npmCommand: string[] | undefined,
  runner: CommandRunner,
): Promise<PluginUpdateResult> {
  if (!pkg.installedPath || !existsSync(pkg.installedPath)) {
    return result(pkg, "error", "Package is not installed.");
  }
  const npm = parseNpmSource(pkg.source);
  if (!npm) return result(pkg, "unsupported");
  const [command = "npm", ...commandArgs] = npmCommand ?? [];
  if (!command) return result(pkg, "error", "Invalid npmCommand.");
  const current = readInstalledVersion(pkg.installedPath);
  const stdout = await runner(
    command,
    [...commandArgs, "view", npm.spec, "version", "--json"],
    { cwd },
  );
  const range = npm.version
    ? (validRange(npm.version) ?? undefined)
    : undefined;
  const latest = readLatestVersion(stdout, range);
  return result(pkg, gt(latest, current) ? "update-available" : "up-to-date");
}

async function checkGitPackage(
  pkg: ConfiguredPackage,
  runner: CommandRunner,
): Promise<PluginUpdateResult> {
  if (!pkg.installedPath || !existsSync(pkg.installedPath)) {
    return result(pkg, "error", "Package is not installed.");
  }
  const options = {
    cwd: pkg.installedPath,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  };
  const local = (await runner("git", ["rev-parse", "HEAD"], options)).trim();
  const upstream = await runner(
    "git",
    ["rev-parse", "--abbrev-ref", "@{upstream}"],
    options,
  )
    .then((value) => value.trim())
    .catch(() => "");
  const ref = upstream.startsWith("origin/")
    ? `refs/heads/${upstream.slice("origin/".length)}`
    : "HEAD";
  const remoteOutput = await runner(
    "git",
    ["ls-remote", "origin", ref],
    options,
  );
  const remote = remoteOutput.match(/^([0-9a-f]{40,64})\s+/m)?.[1];
  if (!remote) throw new Error(`Failed to determine remote ${ref}.`);
  return result(pkg, local === remote ? "up-to-date" : "update-available");
}

function isOffline(): boolean {
  return /^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? "");
}

/**
 * 检查已配置插件的远端更新状态（只读，不修改任何文件）。
 *
 * @param cwd 项目工作目录，用于读取项目级插件配置
 * @param filter 可选过滤：只检查某个 source + scope 组合
 * @param options 测试注入项：包列表、npm 命令与命令执行器
 * @returns 每个被检查包一条 PluginUpdateResult（state 为
 *   update-available / up-to-date / unsupported / error）
 */
export async function checkPluginUpdates(
  cwd: string,
  filter?: { source?: string; scope?: PluginScope },
  options: CheckOptions = {},
): Promise<PluginUpdateResult[]> {
  let packages = options.packages;
  let npmCommand = options.npmCommand;
  if (!packages) {
    const agentDir = getAgentDir();
    const projectTrust = getProjectTrustStatus(cwd, agentDir);
    const settingsManager = SettingsManager.create(cwd, agentDir, {
      projectTrusted: projectTrust.trusted,
    });
    packages = new DefaultPackageManager({
      cwd,
      agentDir,
      settingsManager,
    }).listConfiguredPackages();
    npmCommand ??= settingsManager.getNpmCommand();
  }

  const selected = packages.filter((pkg) => {
    if (!filter?.source) return true;
    return (
      pkg.source === filter.source && toPluginScope(pkg.scope) === filter.scope
    );
  });
  const runner = options.runCommand ?? runCommand;

  return Promise.all(
    selected.map(async (pkg) => {
      if (!isPluginSourceCheckable(pkg.source)) {
        return result(
          pkg,
          "unsupported",
          "Pinned or local packages cannot be checked automatically.",
        );
      }
      if (isOffline()) {
        return result(
          pkg,
          "error",
          "Update checks are disabled while PI_OFFLINE=1.",
        );
      }
      try {
        return parseNpmSource(pkg.source)
          ? await checkNpmPackage(pkg, cwd, npmCommand, runner)
          : await checkGitPackage(pkg, runner);
      } catch (error) {
        return result(
          pkg,
          "error",
          error instanceof Error ? error.message : String(error),
        );
      }
    }),
  );
}
