import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { ASSET_MANIFEST } from "./generated/asset-manifest";

// ============================================================================
// 内置资产自举：确保单文件二进制旁存在 pi-coding-agent 的目录级资产。
//
// 背景：pi-coding-agent 在 Bun 二进制下把内置主题等解析为
// dirname(process.execPath)/theme 等磁盘目录，单文件发布物里没有这些，
// 直接依赖会导致会话创建 500（已由 lib/theme-init.ts 兜底）。本模块让
// 二进制在启动时自检/自取（scripts/build-assets.ts 生成的发布物）：
//
//   1. 校验本地资产（manifest 文件哈希全部匹配）→ 就绪，跳过
//   2. 缺失/不匹配 → 下载 assets 包（PI_WEB_X_ASSETS_URL 可配镜像）
//      → SHA256 校验 → 解压到二进制旁 → 二次校验 → 完成
//   3. 失败 → 记录冷却时间（默认 24h 内不重试），警告并提供修复指引，
//      服务照常启动（会话创建由 initWebTheme 兜底）
//
// 仅编译二进制生效；dev 模式（bun run dev）资产天然在 node_modules 内。
// ============================================================================

export type AssetBootstrapResult =
  | "ok" // 资产就绪（校验通过或已就位）
  | "downloaded" // 本次下载并安装成功
  | "degraded" // 自举失败（离线/镜像不可达等），服务仍可运行
  | "skipped"; // 非编译二进制（dev 模式）

/** 失败冷却时长（毫秒）——默认 24h，可用 PI_WEB_X_ASSETS_COOLDOWN_MS 覆盖。 */
const DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** 下载超时（毫秒）。 */
const DOWNLOAD_TIMEOUT_MS = 30_000;

/** 资产根目录下的状态文件：记录最近一次安装/失败时间，用于冷却重试。 */
const MARKER_NAME = ".pi-web-x-assets.json";

export interface ExtractResult {
  ok: boolean;
  stderr?: string;
}

export interface AssetBootstrapDeps {
  /** 可执行文件路径；默认 process.execPath（编译二进制旁即资产根）。 */
  execPath?: string;
  /** 资产根目录；默认 dirname(execPath)。 */
  assetRoot?: string;
  /** 下载函数；默认真实 fetch（Bun 的 fetch 也支持 file:// 协议）。 */
  fetchFn?: typeof fetch;
  /** 解压函数；默认调用系统 tar。 */
  extract?: (tarballPath: string, dest: string) => ExtractResult;
  /** 当前时间戳；测试注入。 */
  now?: () => number;
  /** 下载 URL；默认按版本指向 GitHub Releases，可配镜像。 */
  downloadUrl?: string;
  /** 编译二进制判定（测试可注入 true 以覆盖自举完整逻辑）。 */
  isBinary?: () => boolean;
  /** 失败冷却时长；默认 24h。 */
  cooldownMs?: number;
  /** 绕过冷却强制重试。 */
  force?: boolean;
  /** 成功/进度输出；默认 console.error（见 no-console-except-error 约束）。 */
  log?: (message: string) => void;
  /** 失败输出。 */
  error?: (message: string) => void;
}

/** 判断当前是否为编译二进制（与 pi-coding-agent 的 isBunBinary 同源判定）。 */
export function isCompiledBinary(): boolean {
  return (
    import.meta.url.includes("$bunfs") ||
    import.meta.url.includes("~BUN") ||
    import.meta.url.includes("%7EBUN")
  );
}

/** 计算文件 SHA256（小文件直读，资产均为 KB 级）。 */
export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** 资产包下载 URL：PI_WEB_X_ASSETS_URL 优先（可含 {version} 占位）。 */
export function assetsDownloadUrl(
  version: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const custom = env.PI_WEB_X_ASSETS_URL;
  if (custom) return custom.replaceAll("{version}", version);
  const base =
    env.PI_WEB_X_RELEASE_BASE ??
    "https://github.com/xiaojueshi/pi-web-x/releases/download";
  return `${base}/v${version}/pi-web-x-assets-${version}.tar.gz`;
}

/**
 * 校验资产根目录：manifest 中每个文件都存在且 SHA256 匹配。
 *
 * @param root 资产根目录（通常为二进制所在目录）
 * @param files 文件哈希清单；默认使用内嵌 manifest
 * @returns 是否全部就绪
 */
export function verifyAssetRoot(
  root: string,
  files: Record<string, string> = ASSET_MANIFEST.files,
): boolean {
  for (const [rel, expected] of Object.entries(files)) {
    const path = join(root, rel);
    if (!existsSync(path)) return false;
    try {
      if (sha256File(path) !== expected) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** 读取状态文件（不存在时返回空对象）。 */
function readMarker(root: string): { failedAt?: number; version?: string } {
  try {
    return JSON.parse(readFileSync(join(root, MARKER_NAME), "utf-8")) as {
      failedAt?: number;
      version?: string;
    };
  } catch {
    return {};
  }
}

/** 写入状态文件。 */
function writeMarker(
  root: string,
  state: { failedAt?: number; version?: string },
): void {
  try {
    writeFileSync(
      join(root, MARKER_NAME),
      JSON.stringify(state, null, 2) + "\n",
      { mode: 0o600 },
    );
  } catch {
    // 状态文件写失败不阻断主流程（仅影响冷却重试）。
  }
}

/** 默认解压实现：调用系统 tar（POSIX 与 Win10+ 均内置）。 */
function defaultExtract(tarballPath: string, dest: string): ExtractResult {
  try {
    const proc = Bun.spawnSync({
      cmd: ["tar", "-xzf", tarballPath, "-C", dest],
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = proc.stderr?.toString() ?? "";
    if (proc.exitCode !== 0) {
      return {
        ok: false,
        stderr: stderr.trim() || `tar exit ${String(proc.exitCode)}`,
      };
    }
    return { ok: true, stderr: "" };
  } catch (error) {
    return {
      ok: false,
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

const defaultDeps = (): Pick<
  AssetBootstrapDeps,
  "fetchFn" | "extract" | "now" | "log" | "error"
> => ({
  fetchFn: fetch,
  extract: defaultExtract,
  now: () => Date.now(),
  // 默认输出走 stderr（提示/告警均为辅助信息，不混入 stdout 以免影响
  // 管道消费）；调用方（cli.ts）可注入自定义输出实现。
  log: (message) => process.stderr.write(message + "\n"),
  error: (message) => process.stderr.write(message + "\n"),
});

/**
 * 下载并安装资产包到指定根目录（含校验与解压）。
 *
 * @param root 安装根目录（会自动创建）
 * @param deps 依赖注入
 * @returns ok=true 表示校验通过可对外宣称就绪；否则附带失败原因
 */
export async function downloadAndInstallAssets(
  root: string,
  deps: AssetBootstrapDeps = {},
): Promise<{ ok: boolean; reason?: string }> {
  const merged = { ...defaultDeps(), ...deps };
  const version = ASSET_MANIFEST.version;
  const url =
    deps.downloadUrl ??
    assetsDownloadUrl(version, {
      ...process.env,
      ...(process.env.PI_WEB_X_ASSETS_URL
        ? { PI_WEB_X_ASSETS_URL: process.env.PI_WEB_X_ASSETS_URL }
        : {}),
    });
  const log = merged.log!;

  let tmpPath = "";
  try {
    mkdirSync(root, { recursive: true });
    const response = await merged.fetchFn!(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}` };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const actual = createHash("sha256").update(buffer).digest("hex");
    if (actual !== ASSET_MANIFEST.tarballSha256) {
      return {
        ok: false,
        reason: `SHA256 不匹配（期望 ${ASSET_MANIFEST.tarballSha256.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…）`,
      };
    }

    tmpPath = join(tmpdir(), `pi-web-x-assets-${randomUUID()}.tar.gz`);
    writeFileSync(tmpPath, buffer);
    const extracted = merged.extract!(tmpPath, root);
    if (!extracted.ok) {
      return {
        ok: false,
        reason: `解压失败: ${extracted.stderr ?? "未知错误"}`,
      };
    }

    if (!verifyAssetRoot(root)) {
      return { ok: false, reason: "解压后校验失败（资产包内容与清单不符）" };
    }
    writeMarker(root, { version, failedAt: undefined });
    log(
      `[pi-web-x] 内置资产已就绪（${Object.keys(ASSET_MANIFEST.files).length} 个文件，version ${version}）。`,
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (tmpPath) {
      try {
        rmSync(tmpPath, { force: true });
      } catch {
        // 临时文件清理失败可忽略。
      }
    }
  }
}

/**
 * 从本地 tar.gz 包安装资产（`pi-web-x assets install <包>` 用）：
 * 校验 tarball SHA256 后解压到资产根。
 *
 * @param tarballPath 本地资产包路径（若为 file:// 前缀则先转换）
 * @param root 安装根目录
 * @param deps 依赖注入
 * @returns ok=true 表示安装成功
 */
export async function installAssetsFromTarball(
  tarballPath: string,
  root: string,
  deps: AssetBootstrapDeps = {},
): Promise<{ ok: boolean; reason?: string }> {
  const merged = { ...defaultDeps(), ...deps };
  const localPath = (() => {
    if (!tarballPath.startsWith("file://")) return tarballPath;
    try {
      return new URL(tarballPath).pathname;
    } catch {
      // SAFETY: file:// 前缀但解析失败时原样使用（existsSync 会判定失败）。
      return tarballPath;
    }
  })();
  if (!existsSync(localPath)) {
    return { ok: false, reason: `资产包不存在: ${localPath}` };
  }
  const actual = sha256File(localPath);
  if (actual !== ASSET_MANIFEST.tarballSha256) {
    return {
      ok: false,
      reason: `SHA256 不匹配（实际 ${actual.slice(0, 12)}…，期望 ${ASSET_MANIFEST.tarballSha256.slice(0, 12)}…；请使用与当前版本匹配的资产包）`,
    };
  }
  try {
    mkdirSync(root, { recursive: true });
    const extracted = merged.extract!(localPath, root);
    if (!extracted.ok) {
      return {
        ok: false,
        reason: `解压失败: ${extracted.stderr ?? "未知错误"}`,
      };
    }
    if (!verifyAssetRoot(root)) {
      return { ok: false, reason: "解压后校验失败" };
    }
    writeMarker(root, { version: ASSET_MANIFEST.version, failedAt: undefined });
    merged.log!(`[pi-web-x] 内置资产已从 ${localPath} 安装并校验通过。`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 确保资产就绪（编译二进制启动入口调用）。
 *
 * 幂等且具备冷却：校验通过直接返回；失败后 24h（可配）内不重复下载。
 *
 * @param deps 依赖注入（测试用）
 * @returns 自举结果
 */
export async function ensureAssets(
  deps: AssetBootstrapDeps = {},
): Promise<AssetBootstrapResult> {
  const isBinary = deps.isBinary ?? (() => isCompiledBinary());
  if (!isBinary()) return "skipped";

  const merged = { ...defaultDeps(), ...deps };
  const root = deps.assetRoot ?? dirname(deps.execPath ?? process.execPath);
  const now = merged.now!;
  const error = merged.error!;

  if (!verifyAssetRoot(root)) {
    const marker = readMarker(root);
    const cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    const force = deps.force || process.env.PI_WEB_X_ASSETS_FORCE === "1";
    if (
      !force &&
      marker.failedAt !== undefined &&
      now() - marker.failedAt < cooldownMs
    ) {
      const hours = Math.ceil(
        (cooldownMs - (now() - marker.failedAt)) / 3_600_000,
      );
      error(
        `[pi-web-x] 内置资产缺失且上次获取失败未满冷却期，${hours} 小时内不再自动重试。`,
      );
      return "degraded";
    }

    const result = await downloadAndInstallAssets(root, deps);
    if (!result.ok) {
      writeMarker(root, { failedAt: now(), version: ASSET_MANIFEST.version });
      error(
        `[pi-web-x] 内置资产获取失败：${result.reason ?? "未知原因"}。\n` +
          `  服务仍可正常启动，仅终端主题色等离线能力不可用。修复方式：\n` +
          `    - 网络可达：下次启动自动重试，或立即重试（PI_WEB_X_ASSETS_FORCE=1）\n` +
          `    - 内网离线：下载发布物的 pi-web-x-assets-${ASSET_MANIFEST.version}.tar.gz 后执行:\n` +
          `        pi-web-x assets install <包路径>`,
      );
      return "degraded";
    }
    return "downloaded";
  }

  writeMarker(root, { version: ASSET_MANIFEST.version, failedAt: undefined });
  return "ok";
}

/** 获取资产根目录（二进制所在目录）。 */
export function resolveAssetRoot(execPath = process.execPath): string {
  return dirname(execPath);
}
