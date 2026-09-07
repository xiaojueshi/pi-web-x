import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

const chatWindow = await readFile(
  new URL("../../../components/ChatWindow.tsx", import.meta.url),
  "utf8",
);
const useAgentSession = await readFile(
  new URL("../../../hooks/useAgentSession.ts", import.meta.url),
  "utf8",
);
const appShell = await readFile(
  new URL("../../../components/AppShell.tsx", import.meta.url),
  "utf8",
);

test("chat window tags message wrappers with their entryId", () => {
  assert.match(chatWindow, /data-entry-id=\{entryIds\[idx\]\}/);
});

test("chat window defers initial scroll while restoring a reading position", () => {
  assert.match(
    chatWindow,
    /deferInitialScroll: Boolean\(pendingScrollRestore\)/,
  );
  // 恢复期间隐藏滚动容器与小地图，避免中间状态闪烁
  assert.match(
    chatWindow,
    /visibility: pendingScrollRestore \? "hidden" : undefined/,
  );
  assert.match(chatWindow, /isMobile \|\| pendingScrollRestore \? null : \(/);
});

test("chat window saves reading positions when unmounting", () => {
  assert.match(chatWindow, /findChatScrollAnchor\(candidates, viewportTop\)/);
  assert.match(chatWindow, /isScrollAtTail\(/);
  assert.match(
    chatWindow,
    /onScrollPositionChange\(sessionId, \{ atBottom: true \}\)/,
  );
  // 锚点记录已加载的最旧 entryId，供恢复流程判断是否继续向前翻页
  assert.match(
    chatWindow,
    /oldestEntryId: searchHistoryRef\.current\.historyCursor/,
  );
});

test("chat window restores the anchor by paging through history", () => {
  // 向前翻页查找锚点，直到 entry 命中或翻到记录时的最旧位置
  assert.match(
    chatWindow,
    /loadContext\(sessionId, activeLeafId, before, \{\s*signal: controller\.signal,\s*\}\)/,
  );
  assert.match(
    chatWindow,
    /scrollToMessage\(element, position\.anchorOffset\)/,
  );
  // 恢复流程会临时挂起自动滚动到底部
  assert.match(
    useAgentSession,
    /initialScrollDoneRef = useRef\(Boolean\(opts\.deferInitialScroll\)\)/,
  );
});

test("app shell caches per-session reading positions", () => {
  assert.match(
    appShell,
    /import type \{ ChatScrollPosition \} from "@\/lib\/chat-scroll-position";/,
  );
  assert.match(appShell, /sessionScrollPositionsRef = useRef\(/);
  assert.match(
    appShell,
    /sessionScrollPositionsRef\.current\.set\(sessionId, position\)/,
  );
  // 会话切换时按 id 取回阅读位置并传入 ChatWindow
  assert.match(appShell, /initialScrollPosition=\{/);
  assert.match(
    appShell,
    /onScrollPositionChange=\{handleSessionScrollPositionChange\}/,
  );
});
