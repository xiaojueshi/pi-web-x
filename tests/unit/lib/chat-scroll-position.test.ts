import assert from "node:assert/strict";
import { test } from "bun:test";

const { findChatScrollAnchor } = await import(
  "../../../lib/chat-scroll-position.ts"
);

test("findChatScrollAnchor selects the nearest message above the viewport top", () => {
  // 候选按文档顺序排列：视口顶部穿过第二条消息时，锚点应为第一条可见消息
  const anchor = findChatScrollAnchor(
    [
      { entryId: "a", top: -400, bottom: -100 },
      { entryId: "b", top: -80, bottom: 50 },
      { entryId: "c", top: 60, bottom: 200 },
    ],
    0,
  );

  assert.deepEqual(anchor, { anchorEntryId: "b", anchorOffset: -80 });
});

test("findChatScrollAnchor falls back to the first candidate when everything is below", () => {
  const anchor = findChatScrollAnchor(
    [
      { entryId: "a", top: 10, bottom: 100 },
      { entryId: "b", top: 110, bottom: 200 },
    ],
    0,
  );

  assert.deepEqual(anchor, { anchorEntryId: "a", anchorOffset: 10 });
});

test("findChatScrollAnchor returns null without candidates", () => {
  assert.equal(findChatScrollAnchor([], 0), null);
});
