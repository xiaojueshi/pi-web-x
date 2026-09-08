import { HttpResponse } from "@/src/server/http";
import {
  hasJsonContentType,
  isApiRequestAllowed,
} from "@/lib/request-security";
import {
  isSystemPromptSource,
  readSystemPromptSettings,
  writeSystemPrompt,
} from "@/lib/system-prompt-settings";

/**
 * 读取用户级系统提示词。
 *
 * @returns 包含当前提示词或错误信息的 HTTP 响应。
 */
export async function GET(): Promise<Response> {
  try {
    return HttpResponse.json(readSystemPromptSettings());
  } catch (error) {
    return HttpResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * 保存用户级系统提示词。
 *
 * @param req 包含 `prompt` 字符串的 JSON 请求。
 * @returns 包含已保存提示词或错误信息的 HTTP 响应。
 */
export async function PUT(req: Request): Promise<Response> {
  if (!isApiRequestAllowed(req)) {
    return HttpResponse.json(
      { error: "Untrusted API request" },
      { status: 403 },
    );
  }
  if (!hasJsonContentType(req)) {
    return HttpResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }
  try {
    const { prompt, source } = (await req.json()) as {
      prompt?: unknown;
      source?: unknown;
    };
    if (typeof prompt !== "string") {
      return HttpResponse.json(
        { error: "prompt must be a string" },
        { status: 400 },
      );
    }
    if (!isSystemPromptSource(source)) {
      return HttpResponse.json(
        { error: "source must be a valid system prompt source" },
        { status: 400 },
      );
    }
    writeSystemPrompt(prompt, source);
    return HttpResponse.json(readSystemPromptSettings());
  } catch (error) {
    return HttpResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
