import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "bun:test";
import {
  TEXT_PREVIEW_CHUNK_BYTES,
  TEXT_PREVIEW_TOTAL_MAX_BYTES,
  TextPreviewError,
  readUtf8TextPreviewChunk,
} from "../../../lib/text-preview.ts";

test("text preview pages at 256 KiB on UTF-8 boundaries and can be reassembled", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-x-preview-"));
  const file = join(root, "unicode.txt");
  try {
    // Place a four-byte scalar directly across the nominal byte limit.
    const prefix = "a".repeat(TEXT_PREVIEW_CHUNK_BYTES - 2);
    const text = `${prefix}😀tail`;
    await writeFile(file, text, "utf8");

    const first = readUtf8TextPreviewChunk(file, Buffer.byteLength(text), 0);
    assert.equal(Buffer.byteLength(first.content), TEXT_PREVIEW_CHUNK_BYTES - 2);
    assert.equal(first.content, prefix);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextOffset < TEXT_PREVIEW_CHUNK_BYTES);

    const second = readUtf8TextPreviewChunk(
      file,
      Buffer.byteLength(text),
      first.nextOffset,
    );
    assert.equal(first.content + second.content, text);
    assert.equal(second.hasMore, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("text preview permits exactly 10 MiB and rejects one byte over", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-x-preview-limit-"));
  const exact = join(root, "exact.txt");
  const over = join(root, "over.txt");
  try {
    await writeFile(exact, Buffer.alloc(TEXT_PREVIEW_TOTAL_MAX_BYTES, 0x61));
    const page = readUtf8TextPreviewChunk(exact, TEXT_PREVIEW_TOTAL_MAX_BYTES, 0);
    assert.equal(page.content.length, TEXT_PREVIEW_CHUNK_BYTES);
    assert.equal(page.hasMore, true);

    await writeFile(over, Buffer.alloc(TEXT_PREVIEW_TOTAL_MAX_BYTES + 1, 0x61));
    assert.throws(
      () => readUtf8TextPreviewChunk(over, TEXT_PREVIEW_TOTAL_MAX_BYTES + 1, 0),
      (error: unknown) =>
        error instanceof TextPreviewError && error.code === "too_large",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("text preview explicitly rejects invalid UTF-8 and stale versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-x-preview-invalid-"));
  const invalid = join(root, "invalid.bin");
  const changed = join(root, "changed.txt");
  try {
    await writeFile(invalid, Buffer.from([0x61, 0xc3, 0x28]));
    assert.throws(
      () => readUtf8TextPreviewChunk(invalid, 3, 0),
      (error: unknown) =>
        error instanceof TextPreviewError && error.code === "invalid_utf8",
    );

    await writeFile(changed, "new");
    assert.throws(
      () => readUtf8TextPreviewChunk(changed, 3, 0, 0),
      (error: unknown) =>
        error instanceof TextPreviewError && error.code === "file_changed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
