import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { SessionInfo } from "@/lib/types";

const MAX_FILES = 500;
const MAX_RESULTS = 30;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_LINE_CHARS = 1024 * 1024;
const TIME_BUDGET_MS = 3000;

export interface SessionSearchResult {
  session: SessionInfo;
  entryId?: string;
  blockIndex: number;
  before: string;
  match: string;
  after: string;
}

export interface SessionSearchResponse {
  results: SessionSearchResult[];
  truncated: boolean;
}

/**
 * 在最近会话的 JSONL 中做无索引的全文搜索（ponytail：延迟达标前不加索引）。
 *
 * 扫描按修改时间排序的会话文件，仅匹配 user/assistant 文本块；命中每个
 * 会话文件的第一处即停止（与侧边栏一行一结果的交互一致）。
 *
 * @param sessions 候选会话（来自与侧边栏相同的会话目录扫描）。
 * @param query 用户输入的字面搜索词。
 * @param requestSignal 客户端断开时终止扫描。
 * @returns 命中结果与 truncated 标志（达到任一上限即视为结果不完整）。
 * @throws RangeError 搜索词超过 200 字符时抛出。
 */
export async function searchSessionContents(
  sessions: readonly SessionInfo[],
  query: string,
  requestSignal?: AbortSignal,
): Promise<SessionSearchResponse> {
  const response: SessionSearchResponse = { results: [], truncated: false };
  const needle = query.trim();
  if (!needle) return response;
  if (needle.length > 200)
    throw new RangeError("Search query exceeds 200 characters");
  // 转义全部正则操作符：这是字面搜索，偏移量基于原始文本。
  const matcher = new RegExp(
    needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "i",
  );
  const deadline = Date.now() + TIME_BUDGET_MS;
  const timeout = AbortSignal.timeout(TIME_BUDGET_MS);
  const signal = requestSignal
    ? AbortSignal.any([requestSignal, timeout])
    : timeout;
  const candidates = sessions
    .filter((session) => !session.transient && session.path)
    .sort((a, b) => b.modified.localeCompare(a.modified));

  for (const [index, session] of candidates.entries()) {
    if (
      index >= MAX_FILES ||
      response.results.length >= MAX_RESULTS ||
      signal.aborted ||
      Date.now() >= deadline
    ) {
      response.truncated = true;
      break;
    }
    const stream = createReadStream(session.path, {
      encoding: "utf8",
      end: MAX_FILE_BYTES - 1,
      signal,
    });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let found = false;
    try {
      for await (const line of lines) {
        if (signal.aborted || Date.now() >= deadline) {
          response.truncated = true;
          break;
        }
        if (line.length > MAX_LINE_CHARS) {
          response.truncated = true;
          continue;
        }
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (
          entry?.type !== "message" ||
          !["user", "assistant"].includes(entry.message?.role)
        )
          continue;
        const content: unknown = entry.message.content;
        const blocks =
          typeof content === "string"
            ? [{ type: "text", text: content }]
            : Array.isArray(content)
              ? content
              : [];
        const textBlocks = blocks.flatMap((block, blockIndex) =>
          block?.type === "text" && typeof block.text === "string"
            ? [{ text: block.text as string, blockIndex }]
            : [],
        );
        const text = textBlocks.map((block) => block.text).join("\n");
        const match = matcher.exec(text);
        if (!match) continue;
        const start = match.index;
        const end = start + match[0].length;
        let blockOffset = 0;
        const matchedBlock = textBlocks.find((block) => {
          const blockEnd = blockOffset + block.text.length;
          blockOffset = blockEnd + 1;
          return start <= blockEnd;
        });
        response.results.push({
          session,
          ...(typeof entry.id === "string" ? { entryId: entry.id } : {}),
          blockIndex: matchedBlock!.blockIndex,
          before:
            (start > 80 ? "..." : "") +
            text
              .slice(Math.max(0, start - 80), start)
              .replace(/\s+/g, " ")
              .trimStart(),
          match: match[0].replace(/\s+/g, " "),
          after:
            text
              .slice(end, end + 80)
              .replace(/\s+/g, " ")
              .trimEnd() + (end + 80 < text.length ? "..." : ""),
        });
        found = true;
        break;
      }
    } catch {
      // 缺失/不可读文件与中断读取都不能吞掉其他结果。
      response.truncated = true;
    } finally {
      lines.close();
      stream.destroy();
    }
    if (!found && stream.bytesRead >= MAX_FILE_BYTES) response.truncated = true;
  }
  return response;
}
