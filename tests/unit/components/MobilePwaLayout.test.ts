import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

const layoutSource = await readFile(
  new URL("../../../src/client/index.html", import.meta.url),
  "utf8",
);
const settingsCssSource = await readFile(
  new URL("../../../app/settings.css", import.meta.url),
  "utf8",
);
const cssSource = await readFile(
  new URL("../../../app/globals.css", import.meta.url),
  "utf8",
);
const appShellSource = await readFile(
  new URL("../../../components/AppShell.tsx", import.meta.url),
  "utf8",
);
const chatWindowSource = await readFile(
  new URL("../../../components/ChatWindow.tsx", import.meta.url),
  "utf8",
);
const chatInputSource = await readFile(
  new URL("../../../components/ChatInput.tsx", import.meta.url),
  "utf8",
);
const promptCardSource = await readFile(
  new URL("../../../components/ExtensionPromptCard.tsx", import.meta.url),
  "utf8",
);
const viewportHookSource = await readFile(
  new URL("../../../hooks/useViewportHeight.ts", import.meta.url),
  "utf8",
);

test("configures iOS standalone mode to use the full screen", () => {
  assert.match(layoutSource, /apple-mobile-web-app-status-bar-style/);
  assert.match(layoutSource, /viewport-fit=cover/);
  assert.match(layoutSource, /interactive-widget=resizes-content/);
  assert.match(
    cssSource,
    /@media \(display-mode: standalone\) \{[\s\S]*?--app-viewport-height: 100vh;/,
  );
});

test("tracks the visual viewport while the software keyboard is open", () => {
  assert.match(appShellSource, /useViewportHeight\(\)/);
  assert.match(appShellSource, /paddingTop: "env\(safe-area-inset-top\)"/);
  assert.match(
    appShellSource,
    /paddingBottom: "env\(safe-area-inset-bottom\)"/,
  );
  assert.match(appShellSource, /paddingLeft: "env\(safe-area-inset-left\)"/);
  assert.match(appShellSource, /paddingRight: "env\(safe-area-inset-right\)"/);
  assert.match(
    appShellSource,
    /height: "calc\(36px \+ env\(safe-area-inset-top\)\)"/,
  );
  assert.match(
    appShellSource,
    /\/\* Right panel tab bar \*\/[\s\S]*?height: "calc\(36px \+ env\(safe-area-inset-top\)\)"/,
  );
  assert.match(
    appShellSource,
    /height: "var\(--app-viewport-height, 100dvh\)"/,
  );
  assert.match(
    appShellSource,
    /data-mobile-toolbar-file=\{mobile \? "true" : undefined\}/,
  );
  assert.match(viewportHookSource, /window\.visualViewport/);
  assert.match(viewportHookSource, /window\.requestAnimationFrame\(update\)/);
  assert.match(
    viewportHookSource,
    /window\.addEventListener\("resize", scheduleUpdate\)/,
  );
  assert.match(
    viewportHookSource,
    /window\.addEventListener\("focusout", scheduleUpdate\)/,
  );
  assert.match(viewportHookSource, /--app-viewport-height/);
  assert.match(viewportHookSource, /window\.scrollTo\(0, 0\)/);
  assert.match(cssSource, /height: var\(--app-viewport-height, 100dvh\)/);
  assert.match(cssSource, /left: env\(safe-area-inset-left\)/);
  assert.match(
    chatWindowSource,
    /paddingBottom: "env\(safe-area-inset-bottom\)"/,
  );
});

test("contains chat content and inputs within the mobile viewport", () => {
  assert.match(
    cssSource,
    /\.markdown-body \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: hidden;/,
  );
  assert.match(
    cssSource,
    /\.markdown-code-block \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;/,
  );
  assert.match(chatWindowSource, /overflow-x-hidden overflow-y-auto/);
  // 提问卡片改为消息流内联渲染（取代旧模态对话框），限制最大宽度防止撑破小屏
  assert.match(chatWindowSource, /<ExtensionPromptCard/);
  assert.match(promptCardSource, /maxWidth: 560/);
  assert.match(chatInputSource, /flex: 1,\s*minWidth: 0,\s*width: "100%",/);
});

test("prevents iOS focus zoom from widening the layout", () => {
  assert.match(
    cssSource,
    /@media \(max-width: 640px\)[\s\S]*?textarea,[\s\S]*?input,[\s\S]*?select \{\s*font-size: 16px !important;/,
  );
});

test("keeps modal dialogs clear of the iOS status bar in standalone mode", () => {
  assert.match(
    settingsCssSource,
    /@supports \(-webkit-touch-callout: none\) \{[\s\S]*?@media \(display-mode: standalone\) \{/,
  );
  assert.match(
    settingsCssSource,
    /padding-top: max\(59px, env\(safe-area-inset-top\)\);[\s\S]*?padding-right: max\(8px, env\(safe-area-inset-right\)\);[\s\S]*?padding-bottom: max\(24px, env\(safe-area-inset-bottom\)\);[\s\S]*?padding-left: max\(8px, env\(safe-area-inset-left\)\);/,
  );
  assert.match(
    settingsCssSource,
    /@media \(display-mode: standalone\) and \(orientation: landscape\) \{[\s\S]*?padding-top: max\(8px, env\(safe-area-inset-top\)\);[\s\S]*?padding-right: max\(59px, env\(safe-area-inset-right\)\);[\s\S]*?padding-bottom: max\(8px, env\(safe-area-inset-bottom\)\);[\s\S]*?padding-left: max\(59px, env\(safe-area-inset-left\)\);/,
  );
  assert.match(
    settingsCssSource,
    /\.settings-dialog-surface,[\s\S]*?\.config-panel-root\.is-modal > \.config-panel-surface \{[\s\S]*?max-width: 100%;[\s\S]*?max-height: 100%;/,
  );
});

test("todo 面板由顶部工具栏统一承载（工具按钮右侧、统一下拉）", () => {
  // 工具栏按钮：位于 tools 按钮之后，激活态与工具栏按钮同款
  // （borderTop 2px accent / bg-selected / data-mobile-toolbar-action）
  const toolsBtnIndex = appShellSource.indexOf('handleSystemInfoToggle("tools"');
  const todoBtnIndex = appShellSource.indexOf('toggleTopPanel("todo"');
  assert.ok(toolsBtnIndex > -1, "存在工具按钮");
  assert.ok(todoBtnIndex > toolsBtnIndex, "TODO 按钮位于工具按钮之后");
  assert.match(
    appShellSource,
    /aria-pressed=\{activeTopPanel === "todo"\}/,
  );
  assert.match(appShellSource, /data-mobile-toolbar-action=\{mobile \? "todo" : undefined\}/);
  assert.match(
    appShellSource,
    /borderTop:\s*\n\s*activeTopPanel === "todo"\s*\n\s*\? "2px solid var\(--accent\)"\s*\n\s*: "2px solid transparent",/,
  );
  // 面板：统一下拉容器内渲染，数据来自 ChatWindow 回调上报
  assert.match(appShellSource, /\{activeTopPanel === "todo" && \(/);
  assert.match(appShellSource, /<TodoPanel details=\{todoDetails\} \/>/);
  assert.match(appShellSource, /onTodoChange=\{setTodoDetails\}/);
});
