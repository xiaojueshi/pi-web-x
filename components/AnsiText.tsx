"use client";

import { createElement, useMemo, type ReactNode } from "react";
import { AnsiUp } from "ansi_up";

/**
 * Renders ANSI SGR escape sequences (as emitted by pi extension widgets such
 * as pi-lens / nano-context / rpiv-todo) as colored/styled HTML.
 *
 * Uses the battle-tested `ansi_up` library, which supports the full SGR
 * set (16/256/24-bit colors, bold/italic/underline/strikethrough, links,
 * reset codes) so any extension's widget output renders faithfully.
 * `ansi_up` escapes HTML entities by default, so widget text cannot inject
 * markup.
 */

export function AnsiText({ text }: { text: string }) {
  const html = useMemo(() => new AnsiUp().ansi_to_html(text), [text]);
  return <span>{renderAnsiHtml(html)}</span>;
}

/** 将 ansi_up 生成的受限 HTML 转为 React 节点，避免将字符串注入 DOM。 */
function renderAnsiHtml(html: string): ReactNode[] {
  const root: AnsiElement = { tag: "root", children: [] };
  const stack = [root];
  let key = 0;

  for (const token of html.split(/(<[^>]+>)/)) {
    if (!token) continue;
    if (token === "</span>" || token === "</a>") {
      const element = stack.pop();
      if (!element || element.tag === "root") continue;
      stack
        .at(-1)
        ?.children.push(
          createElement(
            element.tag,
            { ...element.props, key: key++ },
            element.children,
          ),
        );
      continue;
    }
    if (token === "<br>") {
      stack.at(-1)?.children.push(createElement("br", { key: key++ }));
      continue;
    }

    const span = token.match(/^<span style="([^"]*)">$/);
    if (span) {
      stack.push({
        tag: "span",
        props: { style: parseStyle(span[1]) },
        children: [],
      });
      continue;
    }

    const link = token.match(/^<a href="([^"]*)">$/);
    if (link) {
      const href = decodeHtml(link[1]);
      stack.push({
        tag: "a",
        props: /^https?:\/\//i.test(href) ? { href, rel: "noreferrer" } : {},
        children: [],
      });
      continue;
    }

    if (!token.startsWith("<")) stack.at(-1)?.children.push(decodeHtml(token));
  }

  while (stack.length > 1) {
    const element = stack.pop();
    if (!element) break;
    stack
      .at(-1)
      ?.children.push(
        createElement(
          element.tag,
          { ...element.props, key: key++ },
          element.children,
        ),
      );
  }
  return root.children;
}

type AnsiElement = {
  tag: "root" | "span" | "a";
  props?: Record<string, unknown>;
  children: ReactNode[];
};

/** 将 ansi_up 的内联 CSS 转为 React 接受的驼峰样式对象。 */
function parseStyle(style: string): Record<string, string> {
  return Object.fromEntries(
    style
      .split(";")
      .filter(Boolean)
      .map((declaration) => {
        const [property, ...value] = declaration.split(":");
        return [
          property.replace(/-([a-z])/g, (_, letter: string) =>
            letter.toUpperCase(),
          ),
          value.join(":"),
        ];
      }),
  );
}

/** 解码 ansi_up 为安全 HTML 文本转义的实体，交由 React 重新转义。 */
function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
