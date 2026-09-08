import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

/**
 * 返回用户级系统提示词文件路径。
 *
 * @param agentDir Pi Agent 用户目录，默认从运行时配置读取。
 * @returns 用户级 `SYSTEM.md` 的绝对路径。
 */
export function getSystemPromptPath(agentDir = getAgentDir()): string {
 return join(agentDir, "SYSTEM.md");
}

export type SystemPromptSource = "system" | "agents" | "claude" | "none";

/**
 * 判断值是否为可持久化的系统提示词来源。
 *
 * @param value 待校验的未知值。
 * @returns 值是否为有效的系统提示词来源。
 */
export function isSystemPromptSource(
 value: unknown,
): value is SystemPromptSource {
 return (
  value === "system" ||
  value === "agents" ||
  value === "claude" ||
  value === "none"
 );
}

export interface SystemPromptSettings {
 prompt: string;
 source: SystemPromptSource;
}

function sourcePath(
 source: Exclude<SystemPromptSource, "none">,
 agentDir: string,
): string {
 if (source === "system") return getSystemPromptPath(agentDir);
 return join(agentDir, source === "agents" ? "AGENTS.md" : "CLAUDE.md");
}

/**
 * 读取全局有效系统提示词设置。
 *
 * 与 Pi 全局资源的发现逻辑保持一致：`SYSTEM.md` 优先；未配置时，读取会被
 * 注入上下文的全局 `AGENTS.md`，最后回退到 `CLAUDE.md`。
 *
 * @param agentDir Pi Agent 用户目录，默认从运行时配置读取。
 * @returns 提示词内容及其来源；没有全局提示词文件时返回空内容。
 */
export function readSystemPromptSettings(
 agentDir = getAgentDir(),
): SystemPromptSettings {
 for (const source of ["system", "agents", "claude"] as const) {
  const path = sourcePath(source, agentDir);
  if (existsSync(path)) {
   return { prompt: readFileSync(path, "utf8"), source };
  }
 }
 return { prompt: "", source: "none" };
}

/**
 * 读取全局有效系统提示词。
 *
 * @param source 可选的固定来源；省略时按 Pi 的全局资源优先级发现。
 * @param agentDir Pi Agent 用户目录，测试可注入临时路径。
 * @returns 全局有效提示词或空字符串。
 */
export function readSystemPrompt(
 source?: Exclude<SystemPromptSource, "none">,
 agentDir = getAgentDir(),
): string {
 if (!source) return readSystemPromptSettings(agentDir).prompt;
 const path = sourcePath(source, agentDir);
 return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/**
 * 写入全局有效系统提示词。
 *
 * 写回当前读取的文件，避免把全局 `AGENTS.md` 内容复制至 `SYSTEM.md` 后被 SDK
 * 重复注入。若目前没有任何提示词文件，则首次保存创建 `SYSTEM.md`。空内容仅
 * 删除 `SYSTEM.md`；上下文文件留空但不删除，以免意外移除用户的全局规则文件。
 *
 * @param content 待保存的系统提示词。
 * @param source 当前提示词来源。
 * @param agentDir Pi Agent 用户目录，测试可注入临时路径。
 * @returns 已持久化的系统提示词。
 * @throws 系统提示词不是字符串，或文件无法安全写入时抛出错误。
 */
export function writeSystemPrompt(
 content: string,
 source: SystemPromptSource = "system",
 agentDir = getAgentDir(),
): string {
 if (typeof content !== "string") {
  throw new Error("System prompt must be a string");
 }
 const targetSource = source === "none" ? "system" : source;
 const promptPath = sourcePath(targetSource, agentDir);
 if (!content.trim() && targetSource === "system") {
  if (existsSync(promptPath)) unlinkSync(promptPath);
  return "";
 }
 mkdirSync(dirname(promptPath), { recursive: true });
 writePrivateFileAtomicSync(promptPath, content);
 return content;
}
