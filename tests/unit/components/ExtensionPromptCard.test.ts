import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

const source = await readFile(
  new URL("../../../components/ExtensionPromptCard.tsx", import.meta.url),
  "utf8",
);

test("批量 ask_user 使用逐题 Tab 与可跳过的补充页", () => {
  assert.match(source, /function BatchAskUserPromptCard/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /method: "ask_user"/);
  assert.match(source, /t\("chat\.promptCardAdditionalTitle"\)/);
  assert.match(source, /t\("chat\.promptCardAdditionalPlaceholder"\)/);
  assert.match(source, /answers: resolvedAnswers/);
});

test("批量 ask_user 优先显示模型提供的 tab 名称", () => {
  assert.match(
    source,
    /question\.tab\?\.trim\(\) \|\|\s*t\("chat\.promptCardQuestionTab", \{ number: index \+ 1 \}\)/,
  );
});

test("批量 ask_user 单选后自动进入下一题", () => {
  assert.match(
    source,
    /setAnswer\(activeTab, label\);[\s\S]*?requestAnimationFrame\(\(\) =>\s*setActiveTab/,
  );
});
