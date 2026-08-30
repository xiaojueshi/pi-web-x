import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "bun:test";
import { promisify } from "node:util";

// install.sh 的 --dry-run 探测模式测试：
// 脚本须在无网络环境下可靠输出平台对应的资产名，
// 与 release.yml 的产物命名（pi-web-x-{os}-{arch}[-musl]）保持一致。

const execFileAsync = promisify(execFile);
const SCRIPT = new URL("../../install.sh", import.meta.url);

/** 运行 install.sh --dry-run，返回资产名。 */
async function probeAssetName(env = {}): Promise<string> {
  const { stdout } = await execFileAsync("sh", [SCRIPT.pathname, "--dry-run"], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return stdout.trim();
}

test("install.sh --dry-run 输出当前平台的合法资产名", async () => {
  const asset = await probeAssetName();
  // 命名格式: pi-web-x-{os}-{arch}（linux 可带 -musl 后缀）
  assert.match(
    asset,
    /^pi-web-x-(darwin|linux)-(x64|arm64)(-musl)?$/,
    `unexpected asset name: ${asset}`,
  );
});

test("探测结果与本机平台一致（uname 交叉验证）", async () => {
  const { stdout: sys } = await execFileAsync("uname", ["-s"], {
    encoding: "utf8",
  });
  const { stdout: mach } = await execFileAsync("uname", ["-m"], {
    encoding: "utf8",
  });
  const asset = await probeAssetName();

  const os = sys.trim().toLowerCase();
  const arch = mach.trim().toLowerCase();
  const expectedOs = os === "darwin" ? "darwin" : os === "linux" ? "linux" : null;
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
  const help = await execFileAsync("sh", [SCRIPT.pathname, "--help"], {
    encoding: "utf8",
  });
  assert.match(help.stdout, /Usage: sh install\.sh/);
  assert.match(help.stdout, /--dry-run/);

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