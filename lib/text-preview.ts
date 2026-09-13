import fs from "node:fs";

/** 每次文本预览响应的最大字节数。 */
export const TEXT_PREVIEW_CHUNK_BYTES = 256 * 1024;
/** 一个文本预览可读取的最大总文件大小（边界值允许）。 */
export const TEXT_PREVIEW_TOTAL_MAX_BYTES = 10 * 1024 * 1024;

export class TextPreviewError extends Error {
  constructor(
    public readonly code: "file_changed" | "invalid_utf8" | "too_large" | "invalid_offset",
    message: string,
  ) {
    super(message);
  }
}

export interface TextPreviewChunk {
  content: string;
  nextOffset: number;
  hasMore: boolean;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Reads one UTF-8-safe text-preview chunk.
 *
 * The complete eligible file is validated before any content is returned. This
 * prevents a malformed byte after an otherwise valid first page from looking
 * like a successful text preview. Cursors are byte offsets, but are accepted
 * only at UTF-8 code-point boundaries and are returned only at such boundaries.
 */
export function readUtf8TextPreviewChunk(
  filePath: string,
  expectedSize: number,
  offset: number,
  expectedMtimeMs?: number,
): TextPreviewChunk {
  if (expectedSize > TEXT_PREVIEW_TOTAL_MAX_BYTES) {
    throw new TextPreviewError(
      "too_large",
      "File too large for text preview (>10MB)",
    );
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > expectedSize) {
    throw new TextPreviewError("invalid_offset", "Invalid text preview offset");
  }

  const bytes = fs.readFileSync(filePath);
  const currentStat = fs.statSync(filePath);
  if (
    bytes.length !== expectedSize ||
    (expectedMtimeMs !== undefined && currentStat.mtimeMs !== expectedMtimeMs)
  ) {
    throw new TextPreviewError("file_changed", "File changed while reading");
  }

  try {
    // Validate first so invalid UTF-8 is rejected explicitly, even where the
    // invalid sequence is in a later page.
    decodeUtf8(bytes);
  } catch {
    throw new TextPreviewError(
      "invalid_utf8",
      "File is not valid UTF-8; download it instead",
    );
  }
  try {
    // A valid prefix proves that the byte cursor starts at a code-point boundary.
    if (offset > 0) decodeUtf8(bytes.subarray(0, offset));
  } catch {
    throw new TextPreviewError("invalid_offset", "Invalid text preview offset");
  }

  let end = Math.min(offset + TEXT_PREVIEW_CHUNK_BYTES, bytes.length);
  // A chunk limit may fall in a 2–4 byte code point. Back up at most three
  // bytes to return a valid UTF-8 boundary while never exceeding 256 KiB.
  while (end > offset) {
    try {
      const content = decodeUtf8(bytes.subarray(offset, end));
      return { content, nextOffset: end, hasMore: end < bytes.length };
    } catch {
      end -= 1;
    }
  }

  // offset itself is proven to be a boundary above, so this is only reachable
  // for an empty remaining range.
  return { content: "", nextOffset: offset, hasMore: false };
}
