import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

const globalsSource = await readFile(
  new URL("../../../app/globals.css", import.meta.url),
  "utf8",
);
const clientSource = await readFile(
  new URL("../../../src/client/main.tsx", import.meta.url),
  "utf8",
);

test("builds settings styles through the mandatory global CSS pipeline", () => {
  assert.match(globalsSource, /@import "\.\/settings\.css";/);
  assert.doesNotMatch(clientSource, /import "\.\.\/\.\.\/app\/settings\.css";/);
});
