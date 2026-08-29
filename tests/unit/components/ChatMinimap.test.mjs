import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Bun 原生转译器直接支持 .tsx 与 CSS module import，无需 registerHooks 拦截。
const { AssistantOutline } = await import("../../../components/ChatMinimap.tsx");

test("renders math in headings without disabling heading navigation", () => {
  const html = renderToStaticMarkup(
    React.createElement(AssistantOutline, {
      markdown: String.raw`# Inline $f_{k,t+1}$

## Parentheses \(x^2 + y^2\)`,
      onHeadingClick() {},
    }),
  );

  assert.match(html, /class="katex"/);
  assert.match(html, /data-preview-heading-index="0"/);
  assert.match(html, /data-preview-heading-index="1"/);
  assert.doesNotMatch(html, /disabled=""/);
});
