import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

const registrationSource = await readFile(
  new URL("../../../components/PwaRegistration.tsx", import.meta.url),
  "utf8",
);
const serviceWorkerSource = await readFile(
  new URL("../../../public/sw.js", import.meta.url),
  "utf8",
);
const appShellSource = await readFile(
  new URL("../../../components/AppShell.tsx", import.meta.url),
  "utf8",
);
const englishMessagesSource = await readFile(
  new URL("../../../lib/i18n/messages/en.ts", import.meta.url),
  "utf8",
);

test("keeps a newly installed worker waiting until the user applies its update", () => {
  assert.match(
    serviceWorkerSource,
    /event\.data\?\.type === "PI_WEB_X_SKIP_WAITING"/,
  );
  assert.doesNotMatch(serviceWorkerSource, /then\(\(\) => self\.skipWaiting\(\)\)/);
  assert.match(registrationSource, /registration\.waiting\.postMessage\(\{ type: "PI_WEB_X_SKIP_WAITING" \}\)/);
  assert.match(registrationSource, /navigator\.serviceWorker\.addEventListener\("controllerchange"/);
});

test("frames the update notice as a finished upgrade needing only a refresh", () => {
  // 描述带当前版本号插值，按钮表达“刷新”而非“下载/安装更新”
  assert.match(
    registrationSource,
    /t\("pwa\.updateReadyDescription", \{ version: appVersion \}\)/,
  );
  assert.match(englishMessagesSource, /refres[h] to use it/);
  assert.doesNotMatch(
    englishMessagesSource,
    /A new version has downloaded\. Apply it/,
  );
  assert.match(englishMessagesSource, /Refresh now/);
});

test("offers notifications after a task without requesting browser permission automatically", () => {
  assert.match(appShellSource, /offerPwaNotifications\(\);/);
  assert.doesNotMatch(appShellSource, /void Notification\.requestPermission\(\)/);
  assert.match(registrationSource, /await Notification\.requestPermission\(\)/);
  assert.match(registrationSource, /onClick=\{\(\) => void enableNotifications\(\)\}/);
});

test("shows a fact-based connection warning and keeps notifications private", () => {
  assert.match(registrationSource, /getPwaConnectionStatus/);
  assert.match(registrationSource, /pwa\.insecureConnection/);
  assert.match(registrationSource, /pwa\.connectionSafetyAdvice/);
  assert.match(
    englishMessagesSource,
    /Notifications only show the session name and status/,
  );
});

test("allows every PWA notice to be dismissed without forcing its primary action", () => {
  for (const notice of ["connection", "notification", "update"]) {
    assert.match(
      registrationSource,
      new RegExp(
        `data-pwa-notice="${notice}"[\\s\\S]*?data-pwa-notice-close="${notice}"`,
      ),
    );
  }
});
