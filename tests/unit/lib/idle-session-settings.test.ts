import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";

const {
  DEFAULT_IDLE_SESSION_REAPING_MINUTES,
  getIdleSessionSettingsPath,
  readIdleSessionReapingSettings,
  validateIdleSessionReapingSettings,
  writeIdleSessionReapingSettings,
} = await import("../../../lib/idle-session-settings.ts");

test("idle session reaping defaults to ten enabled minutes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-x-idle-settings-"));
  const settingsPath = join(root, "settings.json");

  assert.deepEqual(await readIdleSessionReapingSettings(settingsPath), {
    enabled: true,
    timeoutMinutes: DEFAULT_IDLE_SESSION_REAPING_MINUTES,
  });
  // 期望路径与实现同用 node:path.join 构造，兼容 Windows 反斜杠分隔符
  assert.equal(
    getIdleSessionSettingsPath("/home/test"),
    join("/home/test", ".pi-web-x", "settings.json"),
  );
});

test("idle session reaping persists validated global settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-x-idle-settings-"));
  const settingsPath = join(root, "settings.json");

  await writeIdleSessionReapingSettings(
    { enabled: false, timeoutMinutes: 60 },
    settingsPath,
  );

  assert.deepEqual(await readIdleSessionReapingSettings(settingsPath), {
    enabled: false,
    timeoutMinutes: 60,
  });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    enabled: false,
    timeoutMinutes: 60,
  });
});

test("idle session reaping rejects invalid timeout values", () => {
  for (const timeoutMinutes of [4, 1_441, 10.5, "10"]) {
    assert.throws(
      () =>
        validateIdleSessionReapingSettings({ enabled: true, timeoutMinutes }),
      /timeoutMinutes/,
    );
  }
  assert.throws(
    () =>
      validateIdleSessionReapingSettings({
        enabled: "true",
        timeoutMinutes: 10,
      }),
    /enabled/,
  );
});
