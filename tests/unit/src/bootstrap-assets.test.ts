import { beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  assetsDownloadUrl,
  ensureAssets,
  installAssetsFromTarball,
  isCompiledBinary,
  verifyAssetRoot,
} from "../../../src/bootstrap-assets";
import { ASSET_MANIFEST } from "../../../src/generated/asset-manifest";

// 与 scripts/build-assets.ts 保持一致的资产源路径映射，用于把真实资产
// 物化到临时目录（这样 verifyAssetRoot 的哈希比对能命中真实发布物）。
const SOURCE_MAP: Record<string, string> = {
  theme: "modes/interactive/theme",
  assets: "modes/interactive/assets",
  "export-html": "core/export-html",
};

/** 项目 node_modules 根（测试在仓库内运行，依赖已安装）。 */
const NODE_MODULES = resolve(
  import.meta.dir,
  "../../../node_modules/@earendil-works/pi-coding-agent/dist",
);

/** 把 manifest 内全部资产文件复制到 root（内容与发布物一致）。 */
function materializeAssets(root: string): boolean {
  for (const rel of Object.keys(ASSET_MANIFEST.files)) {
    const [topDir, ...rest] = rel.split("/");
    const sourceRel = join(SOURCE_MAP[topDir] ?? topDir, ...rest);
    const source = join(NODE_MODULES, sourceRel);
    const dest = join(root, rel);
    if (!existsSync(source)) return false;
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, readFileSync(source));
  }
  return true;
}

/** 空白临时资产根。 */
function makeRoot(): string {
  const root = join(
    // SAFETY: 测试隔离目录，加随机后缀避免并发跑同名目录冲突。
    resolve(import.meta.dir, "../../.tmp"),
    `assets-${Math.random().toString(36).slice(2)}`,
  );
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "nested"), { recursive: true });
  return root;
}

beforeEach(() => {
  rmSync(resolve(import.meta.dir, "../../.tmp"), {
    recursive: true,
    force: true,
  });
});

test("测试环境（非编译二进制）isCompiledBinary 为 false", () => {
  expect(isCompiledBinary()).toBe(false);
});

test("verifyAssetRoot：空目录不通过，物化后通过，篡改后不通过", () => {
  const root = makeRoot();
  expect(verifyAssetRoot(root)).toBe(false);

  expect(materializeAssets(root)).toBe(true);
  expect(verifyAssetRoot(root)).toBe(true);

  // 篡改任意一个文件（写脏字节），哈希应立即不匹配
  const firstFile = Object.keys(ASSET_MANIFEST.files)[0];
  // SAFETY: 测试专用，覆盖 manifest 中第一个文件的真实内容以模拟损坏。
  writeFileSync(join(root, firstFile), "tampered");
  expect(verifyAssetRoot(root)).toBe(false);
});

test("assetsDownloadUrl：默认按版本指向 GitHub，且支持镜像 URL 覆盖", () => {
  expect(assetsDownloadUrl("0.8.11", {})).toBe(
    "https://github.com/xiaojueshi/pi-web-x/releases/download/v0.8.11/pi-web-x-assets-0.8.11.tar.gz",
  );
  expect(
    assetsDownloadUrl("0.9.0", {
      PI_WEB_X_ASSETS_URL:
        "https://mirror.example/pi-web-x-assets-{version}.tar.gz",
    }),
  ).toBe("https://mirror.example/pi-web-x-assets-0.9.0.tar.gz");
});

test("ensureAssets：开发模式直接跳过", async () => {
  const result = await ensureAssets({ assetRoot: makeRoot() });
  expect(result).toBe("skipped");
});

test("ensureAssets：资产就绪时返回 ok", async () => {
  const root = makeRoot();
  expect(materializeAssets(root)).toBe(true);
  const result = await ensureAssets({ assetRoot: root, isBinary: () => true });
  expect(result).toBe("ok");
});

test("ensureAssets：下载失败降级为 degraded 并写入冷却标记", async () => {
  const root = makeRoot();
  const downloads: string[] = [];
  const result = await ensureAssets({
    assetRoot: root,
    isBinary: () => true,
    // 注入失败的网络：任何下载调用都会抛错
    fetchFn: (() => {
      downloads.push("x");
      return Promise.reject(new Error("network unreachable"));
    }) as unknown as typeof fetch,
    cooldownMs: 60_000,
    now: () => 1_000,
  });
  expect(result).toBe("degraded");
  expect(downloads.length).toBe(1);

  // 冷却期内再次调用：不再触发下载
  const second = await ensureAssets({
    assetRoot: root,
    isBinary: () => true,
    fetchFn: (() => {
      downloads.push("x");
      return Promise.reject(new Error("network unreachable"));
    }) as unknown as typeof fetch,
    cooldownMs: 60_000,
    now: () => 30_000,
  });
  expect(second).toBe("degraded");
  expect(downloads.length).toBe(1);
});

test("ensureAssets：force 绕过冷却再次尝试下载", async () => {
  const root = makeRoot();
  const downloads: string[] = [];
  const doomedFetch = (() => {
    downloads.push("x");
    return Promise.reject(new Error("network unreachable"));
  }) as unknown as typeof fetch;
  await ensureAssets({
    assetRoot: root,
    isBinary: () => true,
    fetchFn: doomedFetch,
    cooldownMs: 60_000,
    now: () => 1_000,
  });
  await ensureAssets({
    assetRoot: root,
    isBinary: () => true,
    fetchFn: doomedFetch,
    cooldownMs: 60_000,
    now: () => 30_000,
    force: true,
  });
  expect(downloads.length).toBe(2);
});

test("installAssetsFromTarball：哈希不匹配给出明确错误", async () => {
  const root = makeRoot();
  const fakePkg = join(root, "fake.tar.gz");
  writeFileSync(fakePkg, "not a real assets tarball");
  const result = await installAssetsFromTarball(fakePkg, root);
  expect(result.ok).toBe(false);
  expect(result.reason).toContain("SHA256 不匹配");
});

test("installAssetsFromTarball：file:// 前缀与不存在文件均友好失败", async () => {
  const root = makeRoot();
  const missing = await installAssetsFromTarball(
    "file:///nonexistent/pi-web-x-assets.tar.gz",
    root,
  );
  expect(missing.ok).toBe(false);
  expect(missing.reason).toContain("不存在");
});

test("manifest 内嵌清单与产物一致的冒烟断言", () => {
  // 至少包含主题与导出模板这两个关键资产（守护 build-assets 收集范围）
  expect(ASSET_MANIFEST.files["theme/dark.json"]).toBeTruthy();
  expect(ASSET_MANIFEST.files["theme/light.json"]).toBeTruthy();
  expect(ASSET_MANIFEST.files["export-html/template.html"]).toBeTruthy();
  // tarball 自身哈希必须存在
  expect(ASSET_MANIFEST.tarballSha256.length).toBe(64);
});

test("verifyAssetRoot 的哈希算法与发布物一致", () => {
  const root = makeRoot();
  if (!materializeAssets(root)) return; // node_modules 缺失时跳过
  // 直接复算任意文件的哈希，确认与清单一致（杜绝算法/路径错误）
  const sample = "theme/dark.json";
  const actual = createHash("sha256")
    .update(readFileSync(join(root, sample)))
    .digest("hex");
  expect(actual).toBe(ASSET_MANIFEST.files[sample]);
});
