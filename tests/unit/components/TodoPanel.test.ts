import assert from "node:assert/strict";
import { test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TodoPanel } from "../../../components/TodoPanel.tsx";
import { I18nProvider } from "@/hooks/useI18n";

function renderPanel(details: unknown) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(TodoPanel, {
        details: details as never,
      }),
    ),
  );
}

const details = {
  action: "toggle",
  todos: [
    { id: 1, text: "搭建框架", done: true },
    { id: 2, text: "编写测试", done: false },
  ],
  nextId: 3,
};

test("下拉面板展示进度与完整列表", () => {
  const html = renderPanel(details);
  assert.match(html, /1\/2/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /搭建框架/);
  assert.match(html, /编写测试/);
  // 面板形态透明背景、无绿色分隔线，与工具栏 --bg-panel 灰底统一
  assert.doesNotMatch(html, /background:var\(--bg\)/);
  assert.doesNotMatch(html, /border-top:1px solid rgba\(34,197,94/);
});

test("无待办（null details）显示空态提示", () => {
  const html = renderPanel(null);
  assert.match(html, /暂无待办|No todos/);
  assert.doesNotMatch(html, /role="progressbar"/);
});

test("清空后的空列表显示清空提示", () => {
  const html = renderPanel({ action: "clear", todos: [], nextId: 1 });
  assert.match(html, /已清空全部待办|Cleared all todos/);
});
