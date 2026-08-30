import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// ============================================================================
// 构建期资产收集：把 pi-coding-agent 的「目录级资产」收集成一份独立发布物。
//
// 背景：pi-web-x 以单文件二进制发布，而 pi-coding-agent 的内置主题、
// 交互资产、HTML 导出模板都是磁盘目录（Bun 二进制下解析为
// dirname(execPath)/theme 等）。这些目录无法打进单文件，因此本项目
// 把需要的子集打成 pi-web-x-assets-<version>.tar.gz 随 Release 发布，
// 由二进制启动时的自举逻辑（src/bootstrap-assets.ts）下载并放置到
// 二进制旁。
//
// 本脚本负责：
//   1. 从 node_modules/@earendil-works/pi-coding-agent 收集资产目录；
//   2. 计算每个文件的 SHA256，生成 src/generated/asset-manifest.ts
//      （编译进二进制，供运行期校验）；
//   3. 生成 dist/pi-web-x-assets-<version>.tar.gz 发布物，并回写
//      tarball 自身的 SHA256 到 manifest。
//
// 可直接运行（bun run scripts/build-assets.ts），也可被
// scripts/build-all.ts import 后调用（发布构建统一入口）。
// ============================================================================

const CODING_AGENT_PKG = "@earendil-works/pi-coding-agent";

/**
 * 需要收集的资产：包内目标布局（顶层 theme/assets/export-html，对应底层
 * Bun 二进制下的 getThemesDir/getInteractiveAssetsDir/getExportTemplateDir）
 * → pi-coding-agent npm 包内真实源码目录。
 * 文件口径对齐官方 copy-binary-assets：theme 只收 json、assets 只收 png。
 */
const ASSET_SOURCES: Record<string, { src: string; extensions?: string[] }> = {
  "theme": { src: "modes/interactive/theme", extensions: [".json"] },
  "assets": { src: "modes/interactive/assets", extensions: [".png"] },
  "export-html": { src: "core/export-html" },
} as const;

/** SHA256 字节流。 */
function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** 递归收集目录下所有文件（相对路径）。 */
function collectFiles(root: string): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        results.push(relative(root, full));
      }
    }
  };
  walk(root);
  return results.sort();
}

/** 向上寻找含 package.json 的包根目录（从 startDir 开始）。 */
function findPackageRoot(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

interface BuiltAssets {
  version: string;
  files: Record<string, string>;
  tarballPath: string;
  tarballSha256: string;
}

/**
 * 收集 pi-coding-agent 的目录级资产，写入内嵌 manifest 并打包发布物。
 *
 * 幂等：重复执行会覆盖同名产物；产物内容由 pi-coding-agent 版本决定，
 * 版本未变时哈希不变，tar 包内容稳定。
 *
 * @returns 生成的资产清单与发布物路径
 */
export function buildAssetsAndManifest(): BuiltAssets {
  const projectRoot =
    findPackageRoot(dirname(fileURLToPath(import.meta.url))) ??
    findPackageRoot(process.cwd());
  if (!projectRoot) {
    throw new Error("找不到项目根（无 package.json），无法构建资产。");
  }
  let packageJson: { version: string };
  try {
    packageJson = JSON.parse(
      readFileSync(join(projectRoot, "package.json"), "utf-8"),
    ) as { version: string };
  } catch (error) {
    throw new Error(
      `项目 package.json 解析失败: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const version = packageJson.version;

  // 定位 pi-coding-agent 包根（pkg/dist/modes/interactive/theme 等）
  const agentRoot = findPackageRoot(
    join(projectRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist"),
  );
  if (!agentRoot) {
    throw new Error(
      `找不到 ${CODING_AGENT_PKG} 包根，请先执行 bun install。`,
    );
  }
  const agentDist = join(agentRoot, "dist");

  // 1. 收集文件 + 计算哈希
  const files: Record<string, string> = {};
  const stageRoot = join(projectRoot, "dist", "assets-stage", version);
  rmSync(stageRoot, { recursive: true, force: true });
  for (const [targetDir, sourceInfo] of Object.entries(ASSET_SOURCES)) {
    const srcDir = join(agentDist, sourceInfo.src);
    if (!existsSync(srcDir)) {
      throw new Error(
        `pi-coding-agent 缺少资产目录: ${srcDir}（请检查依赖版本）`,
      );
    }
    for (const rel of collectFiles(srcDir)) {
      if (
        sourceInfo.extensions &&
        !sourceInfo.extensions.some((ext) => rel.toLowerCase().endsWith(ext))
      )
        continue;
      const abs = join(srcDir, rel);
      const targetRel = join(targetDir, rel);
      files[targetRel.replaceAll("\\", "/")] = sha256(readFileSync(abs));
      const dest = join(stageRoot, targetDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(abs));
    }
  }

  // 2. 打包 tar.gz（用系统 tar：构建机为 POSIX，tar 必存在）
  const tarballPath = join(
    projectRoot,
    "dist",
    `pi-web-x-assets-${version}.tar.gz`,
  );
  rmSync(tarballPath, { force: true });
  const tar = spawnSync(
    "tar",
    ["-czf", tarballPath, "-C", stageRoot, ...Object.keys(ASSET_SOURCES)],
    { encoding: "utf-8" },
  );
  if (tar.status !== 0) {
    throw new Error(
      `打包资产失败: ${tar.stderr?.trim() || tar.stdout?.trim() || `exit ${String(tar.status)}`}`,
    );
  }
  const tarballSha256 = sha256(readFileSync(tarballPath));

  // 3. 写内嵌 manifest（编译进二进制，运行期校验用）
  const manifestPath = join(projectRoot, "src", "generated", "asset-manifest.ts");
  mkdirSync(dirname(manifestPath), { recursive: true });
  const manifestBody = `// 由 scripts/build-assets.ts 自动生成，请勿手改。
// 记录 pi-web-x-assets-<version> 发布物的文件哈希，供
// src/bootstrap-assets.ts 在启动时校验/自举目录级资产。
export const ASSET_MANIFEST = {
  version: ${JSON.stringify(version)},
  tarballSha256: ${JSON.stringify(tarballSha256)},
  files: ${JSON.stringify(files, null, 2)} as Record<string, string>,
} as const;
`;
  writeFileSync(manifestPath, manifestBody);

  rmSync(stageRoot, { recursive: true, force: true });

  console.error(
    `[build-assets] ${Object.keys(files).length} 个资产文件 → ${tarballPath}`,
  );
  console.error(
    `[build-assets] manifest 已写入 ${manifestPath}（version=${version}）`,
  );
  return { version, files, tarballPath, tarballSha256 };
}

// 独立运行入口
if (import.meta.main) {
  buildAssetsAndManifest();
}