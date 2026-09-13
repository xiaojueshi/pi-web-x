import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

const route = await readFile(
  new URL("../../../../../app/api/files/[...path]/route.ts", import.meta.url),
  "utf8",
);
const viewer = await readFile(
  new URL("../../../../../components/FileViewer.tsx", import.meta.url),
  "utf8",
);

test("text read route keeps existing authorization and serves bounded UTF-8 pages", () => {
  // Authorization happens before all type-specific read handling, so paging
  // cannot bypass the existing allowed-root/session-reference policy.
  const authorization = route.indexOf("const allowedByRoot");
  const textRead = route.indexOf('if (type === "read")');
  assert.ok(authorization >= 0 && authorization < textRead);
  assert.match(route, /TEXT_PREVIEW_TOTAL_MAX_BYTES/);
  assert.match(route, /readUtf8TextPreviewChunk\(/);
  assert.match(route, /rawOffset/);
  assert.match(route, /rawMtimeMs/);
  assert.match(route, /downloadAvailable: true/);
  assert.match(route, /error\.code === "invalid_utf8"\s*\? 422/);
});

test("text viewer loads additional pages only manually and requires refresh after changes", () => {
  const textViewer = viewer.slice(viewer.indexOf("function TextFileViewer("));
  assert.match(textViewer, /fetchContent\(\s*filePath,\s*data\.nextOffset/);
  assert.match(textViewer, /Load more/);
  assert.match(textViewer, /setStale\(true\)/);
  assert.match(textViewer, /File changed — Refresh/);
  assert.match(textViewer, /hasMore && !stale/);
  // change events must not trigger a fetch; snapshots remain visible until the
  // explicit refresh action.
  const change = textViewer.indexOf('es.addEventListener("change"');
  const following = textViewer.slice(change, change + 220);
  assert.doesNotMatch(following, /fetchContent\(/);
});
