import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  refreshRegisteredServiceAfterUpdate,
  type ServiceRefreshResult,
} from "./service-command";
import {
  fetchLatestVersionFromSource,
  isNewerStableVersion,
} from "../lib/app-update";
import { ASSET_MANIFEST } from "./generated/asset-manifest";
import {
  installAssetsFromTarball,
  isCompiledBinary,
  resolveAssetRoot,
  verifyAssetRoot,
} from "./bootstrap-assets";
import { APP_VERSION } from "./version";

// ============================================================================
// pi-web-x 自更新与资产管理子命令：
//   pi-web-x update [--check] [--force]      —— 检测并自动更新到最新版
//   pi-web-x assets status                    —— 查看内置资产状态
//   pi-web-x assets install <包路径>          —— 内网离线安装资产包
//
// 更新模型：下载新二进制 → SHA256SUMS 校验 → 备份旧二进制 → 原子替换。
// 资产不随二进制打包：新二进制内嵌 manifest（版本+文件哈希）在下次启动
// 由 src/bootstrap-assets.ts 自动校验并拉取配套资产包。
// ============================================================================

export interface UpdateCommandDeps {
  /** 当前可执行文件路径；默认 process.execPath。 */
  execPath?: string;
  /** 网络函数（测试注入）。 */
  fetchFn?: typeof fetch;
  /** 编译二进制判定（测试可注入 true 以覆盖更新全链路）。 */
  isBinary?: () => boolean;
  /** 目标平台（测试注入；默认当前进程平台）。 */
  platform?: NodeJS.Platform;
  /** 目标架构（测试注入；默认当前进程架构）。 */
  arch?: string;
  /** 输出函数；默认 stderr。 */
  out?: (message: string) => void;
  /** 更新完成后维护已注册服务的函数；测试可注入。 */
  refreshService?: (
    previousExecPath: string,
    currentExecPath: string,
  ) => ServiceRefreshResult;
}

interface ResolvedDeps {
  execPath: string;
  fetchFn: typeof fetch;
  isBinary: () => boolean;
  platform: NodeJS.Platform;
  arch: string;
  out: (message: string) => void;
}

function resolveDeps(deps: UpdateCommandDeps = {}): ResolvedDeps {
  return {
    execPath: deps.execPath ?? process.execPath,
    fetchFn: deps.fetchFn ?? fetch,
    isBinary: deps.isBinary ?? (() => isCompiledBinary()),
    platform: deps.platform ?? process.platform,
    arch: deps.arch ?? process.arch,
    out: deps.out ?? ((message) => process.stderr.write(message + "\n")),
  };
}

/** 返回更新子命令的帮助文本。 */
export function getUpdateCommandHelp(): string {
  return `Usage: pi-web-x update [options]
       pi-web-x assets <status|install> [path]

Update / asset management for the compiled binary.

Options:
  -c, --check   Only check for a newer version, do not download
  -f, --force   Install even when already on the latest version
  -h, --help    Show this help

Assets:
  pi-web-x assets status                Show built-in asset status
  pi-web-x assets install <path>        Install assets from a tarball (offline)
`;
}

/**
 * 探测当前平台的发布资产名（与 install.sh 的命名规则一致）：
 * pi-web-x-{os}-{arch}[-musl][.exe]
 *
 * @param platform 平台；默认 process.platform
 * @param arch 架构；默认 process.arch
 * @returns 资产名；不支持的平台返回 null
 */
export function getPlatformAssetName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  const osName =
    platform === "darwin"
      ? "darwin"
      : platform === "linux"
        ? "linux"
        : platform === "win32"
          ? "windows"
          : null;
  if (osName === null) return null;
  const archName = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : null;
  if (archName === null) return null;

  let name = `pi-web-x-${osName}-${archName}`;
  if (osName === "linux" && isMuslLinux()) name += "-musl";
  if (osName === "windows") name += ".exe";
  return name;
}

/** 探测 Linux 是否为 musl（/etc/alpine-release 或 ldd 输出）。 */
export function isMuslLinux(): boolean {
  if (existsSync("/etc/alpine-release")) return true;
  try {
    const proc = Bun.spawnSync({
      cmd: ["ldd", "--version"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const output =
      `${String(proc.stdout ?? "")} ${String(proc.stderr ?? "")}`.toLowerCase();
    return output.includes("musl");
  } catch {
    return false;
  }
}

/** 组装 release 下载 URL（PI_WEB_X_RELEASE_BASE 可覆盖为镜像/内网）。 */
export function releaseDownloadUrl(
  version: string,
  fileName: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base =
    env.PI_WEB_X_RELEASE_BASE ??
    "https://github.com/xiaojueshi/pi-web-x/releases/download";
  return `${base}/v${version}/${fileName}`;
}

/**
 * 下载并校验目标版本二进制，返回本地临时文件路径。
 *
 * @param version 目标版本（无 v 前缀）
 * @param assetName 平台资产名（含扩展名）
 * @param deps 依赖注入
 * @returns 校验通过的临时文件路径；失败抛错
 */
export async function downloadVersionedBinary(
  version: string,
  assetName: string,
  deps: UpdateCommandDeps = {},
): Promise<string> {
  const { fetchFn } = resolveDeps(deps);
  const binaryUrl = releaseDownloadUrl(version, assetName);
  const sumsUrl = releaseDownloadUrl(version, "SHA256SUMS");

  const [binaryResponse, sumsResponse] = await Promise.all([
    fetchFn(binaryUrl, { signal: AbortSignal.timeout(120_000) }),
    fetchFn(sumsUrl, { signal: AbortSignal.timeout(30_000) }),
  ]);
  if (!binaryResponse.ok) {
    throw new Error(`下载二进制失败: HTTP ${binaryResponse.status}`);
  }
  if (!sumsResponse.ok) {
    throw new Error(`下载 SHA256SUMS 失败: HTTP ${sumsResponse.status}`);
  }

  const bytes = Buffer.from(await binaryResponse.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  const sumsText = await sumsResponse.text();
  const expected = sumsText
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts.length >= 2 && parts[1] === assetName)?.[0];
  if (!expected) {
    throw new Error(`SHA256SUMS 中未找到 ${assetName} 条目，已中止`);
  }
  if (actual !== expected) {
    throw new Error(
      `校验失败：SHA256 不匹配（期望 ${expected.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…）`,
    );
  }
  // SAFETY: 校验通过后写入临时目录；文件名由 randomUUID 生成不冲突。
  const dir = mkdtempSync(join(tmpdir(), "pi-web-x-update-"));
  const tmpPath = join(dir, "pi-web-x");
  // SAFETY: 磁盘字节 Buffer 直接写入，无编码转换。
  await Bun.write(tmpPath, bytes);
  chmodSync(tmpPath, 0o755);
  return tmpPath;
}

/**
 * 用下载好的新二进制替换当前二进制（备份旧版，失败可回退）。
 *
 * @param newBinaryPath 校验后的新二进制临时路径
 * @param targetVersion 目标版本（用于备份命名）
 * @param deps 依赖注入
 * @returns 备份文件路径（用于提示）
 */
export function replaceCurrentBinary(
  newBinaryPath: string,
  targetVersion: string,
  deps: UpdateCommandDeps = {},
): string {
  const { execPath } = resolveDeps(deps);
  const backupPath = `${execPath}.bak.${targetVersion}`;

  // 1) 复制到安装目录旁（跨设备 tmp 目录不能直接 rename）
  const stagedPath = `${execPath}.new`;
  copyFileSync(newBinaryPath, stagedPath);
  chmodSync(stagedPath, 0o755);

  // 2) 备份当前二进制（Windows 运行中 exe 可能被锁定，失败时给出指引）
  try {
    renameSync(execPath, backupPath);
    renameSync(stagedPath, execPath);
  } catch (error) {
    rmSync(stagedPath, { force: true });
    throw new Error(
      `替换二进制失败（当前进程可能被占用）：${error instanceof Error ? error.message : String(error)}。\n` +
        `已下载的新版本位于 ${stagedPath}，可手动替换 ${execPath}。`,
    );
  }
  return backupPath;
}

/**
 * 迁移旧安装根（ADR 0006）：二进制从 ~/pi-web-x 迁到 ~/.pi-web-x。
 *
 * 仅在当前二进制位于旧根（默认布局）且新根为空时执行整目录搬移，
 * 并重建 ~/.local/bin 符号链接。搬移成功后返回新 execPath；
 * 无迁移或用户自定义 --dir 时返回原 execPath。
 *
 * 运行中的进程不动自身：本函数只负责「目录位移 + 链接重建」，
 * 实际二进制替换（写文件）由调用方在返回的新路径上进行。
 *
 * @param execPath 当前可执行文件路径
 * @param out 输出函数
 * @returns 迁移后的可执行文件路径（未迁移时不变）
 */
export function migrateLegacyInstallRoot(
  execPath: string,
  out: (message: string) => void,
): string {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return execPath;
  const legacyRoot = join(home, "pi-web-x");
  const newRoot = join(home, ".pi-web-x");
  const isLegacyExec = execPath.startsWith(legacyRoot + sep);
  if (!isLegacyExec) return execPath;
  if (existsSync(newRoot) && readdirSync(newRoot).length > 0) {
    out(
      `提示：检测到旧安装根 ${legacyRoot} 与已有新根 ${newRoot}，跳过自动迁移。`,
    );
    return execPath;
  }
  if (!existsSync(legacyRoot)) return execPath;

  out(`迁移安装根：${legacyRoot} → ${newRoot}`);
  mkdirSync(dirname(newRoot), { recursive: true });
  renameSync(legacyRoot, newRoot);
  out(`迁移完成：数据已移至 ${newRoot}。`);

  // 重建 ~/.local/bin 符号链接（若之前存在指向旧根 span 内二进制的链接）。
  // 注意：迁移先 rename，链接此时已是悬空状态，existsSync 会误判为不存在，
  // 因此用 lstatSync（对符号链接本身判存）而不是 existsSync。
  const binDir = join(home, ".local", "bin");
  const binEntry = join(binDir, "pi-web-x");
  let hadBinEntry = false;
  try {
    hadBinEntry = lstatSync(binEntry).isSymbolicLink();
  } catch {
    // 不存在或无法 stat：无需重建
  }
  if (hadBinEntry) {
    rmSync(binEntry, { force: true });
    try {
      mkdirSync(binDir, { recursive: true });
      symlinkSync(execPath.replace(legacyRoot, newRoot), binEntry);
    } catch {
      out(
        `提示：无法重建命令入口 ${binEntry}，请手动执行：ln -s ${execPath.replace(legacyRoot, newRoot)} ${binEntry}`,
      );
    }
  }

  return execPath.replace(legacyRoot, newRoot);
}

/**
 * 执行 `pi-web-x update` 子命令。
 *
 * @param args 子命令参数
 * @param deps 依赖注入
 * @returns 进程退出码（0 成功 / 1 失败）
 */
export async function runUpdateCommand(
  args: string[],
  deps: UpdateCommandDeps = {},
): Promise<number> {
  const resolved = resolveDeps(deps);
  const { out, isBinary, fetchFn } = resolved;
  if (args.includes("--help") || args.includes("-h")) {
    out(getUpdateCommandHelp());
    return 0;
  }
  const checkOnly = args.includes("--check") || args.includes("-c");
  const force = args.includes("--force") || args.includes("-f");

  if (!isBinary()) {
    out(
      "pi-web-x 正以开发模式（bun src/cli.ts）运行，不支持自更新。\n" +
        "请使用包管理器或从源码构建的方式更新。",
    );
    return 1;
  }

  let latest: { latestVersion: string; releaseUrl: string };
  try {
    latest = await fetchLatestVersionFromSource(process.env, fetchFn, 5_000);
  } catch (error) {
    out(
      `检查更新失败：${error instanceof Error ? error.message : String(error)}。\n` +
        "请确认网络可达，或设置 PI_WEB_X_UPDATE_URL 指向内网镜像。",
    );
    return 1;
  }

  const hasUpdate = isNewerStableVersion(latest.latestVersion, APP_VERSION);
  if (!hasUpdate && !force) {
    out(`当前已是最新版本（${APP_VERSION}）。`);
    return 0;
  }
  if (!hasUpdate) {
    out(`已是最新（${APP_VERSION}），按 --force 强制重装。`);
  } else {
    out(
      `发现新版本：${APP_VERSION} → ${latest.latestVersion}\n` +
        `详情：${latest.releaseUrl}`,
    );
  }
  if (checkOnly) return 0;

  const assetName = getPlatformAssetName(resolved.platform, resolved.arch);
  if (assetName === null) {
    out("当前平台不受支持，无法自动更新。请手动从 Release 下载。");
    return 1;
  }

  try {
    const newBinary = await downloadVersionedBinary(
      latest.latestVersion,
      assetName,
      deps,
    );
    const previousExec = resolved.execPath;
    // ADR 0006：二进制位于旧 ~/pi-web-x 时先迁移到 ~/.pi-web-x 再替换。
    // migrateLegacyInstallRoot 会整体搬移目录并重建符号链接，
    // 返回迁移后的可执行文件路径；未迁移时原样返回。
    const migratedExec = migrateLegacyInstallRoot(previousExec, out);
    const backupPath = replaceCurrentBinary(
      newBinary,
      latest.latestVersion,
      migratedExec === previousExec ? deps : { ...deps, execPath: migratedExec },
    );

    try {
      const service = (deps.refreshService ?? refreshRegisteredServiceAfterUpdate)(
        previousExec,
        migratedExec,
      );
      out(
        `更新完成：${APP_VERSION} → ${latest.latestVersion}\n` +
          `旧版本备份在 ${backupPath}\n` +
          (service.registered
            ? `已自动修复并重启 ${service.kind} 用户服务。\n`
            : "未检测到已注册的系统服务，无需重启。\n") +
          "资产将随下次启动自动同步。",
      );
      return 0;
    } catch (serviceError) {
      out(
        `二进制已更新至 ${latest.latestVersion}，但自动恢复系统服务失败：` +
          `${serviceError instanceof Error ? serviceError.message : String(serviceError)}。\n` +
          `旧版本备份在 ${backupPath}\n` +
          "请检查服务日志并手动重启服务；无需重新下载二进制。",
      );
      return 1;
    }
  } catch (error) {
    out(
      `更新失败：${error instanceof Error ? error.message : String(error)}。\n` +
        "可稍后重试，或手动下载产物后替换。",
    );
    return 1;
  }
}

/**
 * 执行 `pi-web-x assets` 子命令。
 *
 * @param args 子命令参数（status | install <path>）
 * @param deps 依赖注入
 * @returns 进程退出码（0 成功 / 1 失败）
 */
export async function runAssetsCommand(
  args: string[],
  deps: UpdateCommandDeps = {},
): Promise<number> {
  const { out } = resolveDeps(deps);
  const action = args[0];
  const root = resolveAssetRoot(deps.execPath ?? process.execPath);

  if (action === "status" || action === undefined) {
    const ready = verifyAssetRoot(root);
    out(
      `内置资产根目录：${root}\n` +
        `当前版本：${APP_VERSION}（资产清单 version ${ASSET_MANIFEST.version}，${Object.keys(ASSET_MANIFEST.files).length} 个文件）\n` +
        (ready
          ? "资产状态：就绪 ✓"
          : "资产状态：缺失或校验不通过 ✗\n  修复：网络环境启动一次自动获取；内网离线可执行:\n    pi-web-x assets install <pi-web-x-assets-<version>.tar.gz 路径>"),
    );
    return ready ? 0 : 1;
  }

  if (action === "install") {
    const pkgPath = args[1];
    if (!pkgPath) {
      out(
        "用法：pi-web-x assets install <资产包路径>\n可用 --help 查看完整帮助。",
      );
      return 1;
    }
    const result = await installAssetsFromTarball(pkgPath, root, deps);
    if (!result.ok) {
      out(`资产安装失败：${result.reason ?? "未知原因"}`);
      return 1;
    }
    out("资产安装完成 ✓");
    return 0;
  }

  out(getUpdateCommandHelp());
  return 1;
}
