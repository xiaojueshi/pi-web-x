import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
const REFERENCE_LINK_PATTERN =
  /^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))(?:\s+["'(].*)?$/gm;
const EXTERNAL_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;

const markdownFiles = [
  ...new Bun.Glob("*.md").scanSync({
    cwd: REPOSITORY_ROOT,
    absolute: true,
    onlyFiles: true,
  }),
  ...new Bun.Glob("docs/**/*.md").scanSync({
    cwd: REPOSITORY_ROOT,
    absolute: true,
    onlyFiles: true,
  }),
];

/** 提取 inline link 与 reference definition 的原始目标。 */
function markdownLinkTargets(markdown: string): string[] {
  const targets: string[] = [];
  for (let searchFrom = 0; searchFrom < markdown.length; ) {
    const marker = markdown.indexOf("](", searchFrom);
    if (marker === -1) break;

    const start = marker + 2;
    let depth = 1;
    let escaped = false;
    let cursor = start;
    for (; cursor < markdown.length; cursor += 1) {
      const character = markdown[cursor];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
      } else if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    if (depth === 0) targets.push(markdown.slice(start, cursor));
    searchFrom = depth === 0 ? cursor + 1 : start;
  }

  for (const match of markdown.matchAll(REFERENCE_LINK_PATTERN)) {
    targets.push(match[1] ?? match[2] ?? "");
  }
  return targets;
}

/** 将 Markdown 目标规范化为待检查的本地路径。 */
function localLinkTarget(rawTarget: string): string | null {
  const target = rawTarget.trim();
  const pathWithOptionalTitle = target.startsWith("<")
    ? target.match(/^<([^>]+)>/)?.[1]
    : target.match(/^(\S+)(?:\s+["'].*["'])?$/)?.[1];
  if (!pathWithOptionalTitle) return null;

  const path = pathWithOptionalTitle.split("#", 1)[0]?.split("?", 1)[0] ?? "";
  if (!path || EXTERNAL_SCHEME_PATTERN.test(path)) return null;

  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

describe("公开 Markdown 文档", () => {
  test("所有相对链接目标均存在", () => {
    const missingLinks: string[] = [];

    for (const file of markdownFiles) {
      const markdown = readFileSync(file, "utf8");
      for (const rawTarget of markdownLinkTargets(markdown)) {
        const target = localLinkTarget(rawTarget);
        if (!target) continue;

        const absoluteTarget = resolve(dirname(file), target);
        if (!existsSync(absoluteTarget)) {
          missingLinks.push(
            `${file.slice(REPOSITORY_ROOT.length + 1)} -> ${target}`,
          );
        }
      }
    }

    expect(missingLinks).toEqual([]);
  });

  test("所有 README 翻译提供相同语言入口", () => {
    const readmes = [
      "README.md",
      "README.zh-CN.md",
      "README.ja.md",
      "README.ru.md",
    ];
    const languageTargets = readmes.map((file) => `./${file}`);

    for (const file of readmes) {
      const markdown = readFileSync(resolve(REPOSITORY_ROOT, file), "utf8");
      for (const target of languageTargets) {
        expect(markdown, `${file} 缺少语言入口 ${target}`).toContain(
          `(${target})`,
        );
      }
    }
  });
});
