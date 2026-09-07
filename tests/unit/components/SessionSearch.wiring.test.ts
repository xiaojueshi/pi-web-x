import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

const sidebar = await readFile(
  new URL("../../../components/SessionSidebar.tsx", import.meta.url),
  "utf8",
);
const sessionSearch = await readFile(
  new URL("../../../components/SessionSearch.tsx", import.meta.url),
  "utf8",
);
const appShell = await readFile(
  new URL("../../../components/AppShell.tsx", import.meta.url),
  "utf8",
);
const chatWindow = await readFile(
  new URL("../../../components/ChatWindow.tsx", import.meta.url),
  "utf8",
);
const messageView = await readFile(
  new URL("../../../components/MessageView.tsx", import.meta.url),
  "utf8",
);

test("sidebar toggles a debounced session search over the list", () => {
  assert.match(sidebar, /const \[sessionSearchOpen, setSessionSearchOpen\]/);
  assert.match(sidebar, /<SessionSearch\b/);
  assert.match(sidebar, /refreshKey=\{sessionListVersion\}/);
  // 搜索输入框带 200 字符上限与 Esc 清空
  assert.match(sidebar, /maxLength=\{200\}/);
  assert.match(sidebar, /setSessionSearchQuery\(""\)/);
});

test("sidebar polls the session list version for cross-window sync", () => {
  assert.match(
    sidebar,
    /data\.sessionListVersion !== sessionListVersionRef\.current/,
  );
  assert.match(sidebar, /void loadSessions\(\);/);
  // 会话列表代数快照：慢响应不得覆盖新状态
  assert.match(sidebar, /loadId !== sessionLoadIdRef\.current/);
});

test("session search panel debounces hits over /api/sessions/search", () => {
  assert.match(sessionSearch, /\/api\/sessions\/search\?/);
  assert.match(sessionSearch, /setTimeout\(/);
  // 命中行高亮 match 片段并跳转选中会话
  assert.match(sessionSearch, /<mark\b/);
  assert.match(
    sessionSearch,
    /onSelectSession\(session, entryId, blockIndex\)/,
  );
});

test("app shell routes search hits into the chat window", () => {
  assert.match(appShell, /setSearchTarget\(\s*entryId \? \{/);
  assert.match(appShell, /searchTarget=\{/);
  assert.match(appShell, /onSearchTargetHandled=\{handleSearchTargetHandled\}/);
});

test("chat window locates and highlights the search target", () => {
  // 目标不在已加载窗口时额外拉取一页 200 条查找
  assert.match(chatWindow, /\{ tail: 200, signal: controller\.signal \}/);
  assert.match(chatWindow, /setPendingSearchScroll\(searchTarget\)/);
  // 用户消息定位容器，assistant 定位 data-search-target 文本块并高亮
  assert.match(chatWindow, /data-search-target\]/);
  assert.match(chatWindow, /scrollToMessage\(element\)/);
  assert.match(chatWindow, /element\.animate\(/);
  // 定位目标与阅读位置恢复互斥
  assert.match(chatWindow, /searchTarget \|\|\s*restoreStartedRef\.current/);
  // 未命中时仅打开会话并清除目标
  assert.match(chatWindow, /onSearchTargetHandled\?\.\(searchTarget\)/);
});

test("message view marks the highlighted text block", () => {
  assert.match(
    messageView,
    /data-search-target=\{searchTarget \|\| undefined\}/,
  );
  assert.match(messageView, /searchTarget=\{block === searchBlock\}/);
  assert.match(messageView, /prev\.searchBlock === next\.searchBlock/);
});
