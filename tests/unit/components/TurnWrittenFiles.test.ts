import assert from "node:assert/strict";
import { test } from "bun:test";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { TurnWrittenFiles } = await import(
  "../../../components/TurnWrittenFiles.tsx",
);
const { I18nProvider } = await import("@/hooks/useI18n");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(TurnWrittenFiles, props),
    ),
  );
}

test("renders a button per file showing the basename and full path", () => {
  const html = render({
    files: [
      { filePath: "/abs/out/report.html" },
      { filePath: "/abs/out/data.json" },
    ],
    onOpenFile() {},
  });
  assert.match(html, /<button/);
  assert.match(html, /report\.html/);
  assert.match(html, /data\.json/);
  assert.match(html, /title="\/abs\/out\/report\.html"/);
  assert.match(html, /title="\/abs\/out\/data\.json"/);
});

test("renders nothing when no files were written", () => {
  assert.equal(render({ files: [], onOpenFile() {} }), "");
});
