import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "bun:test";
import { promisify } from "node:util";

// install.sh 的 --dry-run 探测模式测试：
// 脚本须在无网络环境下可靠输出平台对应的资产名，
// 与 release.yml 的产物命名（pi-web-x-{os}-{arch}[-musl]）保持一致。
// Windows 无 POSIX sh，本测试仅限 macOS/Linux 执行。

const execFileAsync = promisify(execFile);
const SCRIPT = new URL("../../install.sh", import.meta.url);
const POWERSHELL_SCRIPT = new URL("../../install.ps1", import.meta.url);

const IS_POSIX = process.platform !== "win32";

/** 运行 install.sh --dry-run，返回资产名。 */
async function probeAssetName(env = {}): Promise<string> {
  const { stdout } = await execFileAsync("sh", [SCRIPT.pathname, "--dry-run"], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return stdout.trim();
}

test("install.sh --dry-run 输出当前平台的合法资产名", async () => {
  if (!IS_POSIX) return;
  const asset = await probeAssetName();
  // 命名格式: pi-web-x-{os}-{arch}（linux 可带 -musl 后缀）
  assert.match(
    asset,
    /^pi-web-x-(darwin|linux)-(x64|arm64)(-musl)?$/,
    `unexpected asset name: ${asset}`,
  );
});

test("探测结果与本机平台一致（uname 交叉验证）", async () => {
  if (!IS_POSIX) return;
  const { stdout: sys } = await execFileAsync("uname", ["-s"], {
    encoding: "utf8",
  });
  const { stdout: mach } = await execFileAsync("uname", ["-m"], {
    encoding: "utf8",
  });
  const asset = await probeAssetName();

  const os = sys.trim().toLowerCase();
  const arch = mach.trim().toLowerCase();
  const expectedOs =
    os === "darwin" ? "darwin" : os === "linux" ? "linux" : null;
  if (expectedOs === null) return; // 非本仓库支持的平台，跳过交叉验证
  const expectedArch =
    arch === "x86_64" || arch === "amd64"
      ? "x64"
      : arch === "aarch64" || arch === "arm64"
        ? "arm64"
        : null;
  if (expectedArch === null) return;

  assert.ok(asset.startsWith(`pi-web-x-${expectedOs}-${expectedArch}`));
});

test("--help 与未知参数行为正确", async () => {
  if (!IS_POSIX) return;
  const help = await execFileAsync("sh", [SCRIPT.pathname, "--help"], {
    encoding: "utf8",
  });
  assert.match(help.stdout, /Usage: sh install\.sh/);
  assert.match(help.stdout, /--dry-run/);
  // 新布局（ADR 0006）：默认真实安装根为 $HOME/.pi-web-x
  assert.match(help.stdout, /default: \$HOME\/\.pi-web-x/);

  await assert.rejects(
    execFileAsync("sh", [SCRIPT.pathname, "--bogus-flag"], {
      encoding: "utf8",
    }),
    (error: NodeJS.ErrnoException & { stderr: string }) => {
      assert.match(error.stderr, /Unknown option: --bogus-flag/);
      return true;
    },
  );
});

test("安装脚本在 checksum 条目缺失时 fail closed", async () => {
  const [posixSource, powershellSource] = await Promise.all([
    Bun.file(SCRIPT).text(),
    Bun.file(POWERSHELL_SCRIPT).text(),
  ]);

  assert.match(
    posixSource,
    /Checksum entry missing[\s\S]*refusing an unverified install[\s\S]*exit 1/,
  );
  assert.match(
    powershellSource,
    /throw "Checksum entry missing for \$Asset; refusing an unverified install\."/,
  );
  assert.doesNotMatch(posixSource, /skipping checksum verification/i);
  assert.doesNotMatch(powershellSource, /skipping checksum verification/i);
});

test("旧安装根迁移发生在新二进制写入之前", async () => {
  const source = await Bun.file(SCRIPT).text();
  const migration = source.indexOf("Migrating legacy install directory");
  const install = source.indexOf(
    'mv "$TMP_DIR/pi-web-x" "$INSTALL_DIR/pi-web-x"',
  );

  assert.notEqual(migration, -1);
  assert.notEqual(install, -1);
  assert.ok(
    migration < install,
    "legacy migration must run before binary install",
  );
});
