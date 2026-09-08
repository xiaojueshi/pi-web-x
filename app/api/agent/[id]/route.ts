import { HttpResponse } from "@/src/server/http";
import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";
import { readSubagentRun } from "@/lib/subagents";
import {
  startRpcSession,
  getRpcSession,
  setRpcSessionTools,
} from "@/lib/rpc-manager";

const SUBAGENT_READ_COMMANDS = new Set([
  "get_state",
  "get_tools",
  "get_commands",
  "get_last_assistant_text",
  "get_session_stats",
  "navigate_tree",
]);

function isSubagentSession(sessionId: string, sessionFile: string): boolean {
  try {
    return Boolean(
      readSubagentRun(getSessionEntries(sessionFile), sessionId, sessionFile),
    );
  } catch {
    return false;
  }
}

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let commandType: string | undefined;
  let promptAccepted = false;

  try {
    const body = (await req.json()) as { type: string; [key: string]: unknown };
    commandType = typeof body.type === "string" ? body.type : undefined;
    const requestedToolNames = body.toolNames;
    if (
      requestedToolNames !== undefined &&
      (!Array.isArray(requestedToolNames) ||
        requestedToolNames.some((name) => typeof name !== "string"))
    ) {
      throw new Error("toolNames must be an array of strings");
    }
    const toolNames = requestedToolNames as string[] | undefined;

    // 先从持久化元数据识别子会话，避免旧客户端绕过只读 UI 直接写入。
    const existing = getRpcSession(id);
    const filePath = existing?.sessionFile || (await resolveSessionPath(id));
    if (
      filePath &&
      isSubagentSession(id, filePath) &&
      !SUBAGENT_READ_COMMANDS.has(body.type)
    ) {
      return HttpResponse.json(
        {
          error: "Subagent sessions are read-only",
          code: "subagent_read_only",
        },
        { status: 403 },
      );
    }
    if (body.type === "set_tools") {
      if (!existing?.isAlive() && !filePath) {
        return HttpResponse.json(
          { error: "Session not found" },
          { status: 404 },
        );
      }
      const changed = await setRpcSessionTools(
        id,
        filePath || undefined,
        toolNames,
      );
      return HttpResponse.json({
        success: true,
        data: { sessionId: changed.sessionId, recreated: changed.recreated },
      });
    }
    if (existing?.isAlive()) {
      const result = await existing.send(body);
      promptAccepted = body.type === "prompt";
      return HttpResponse.json({ success: true, data: result });
    }

    if (!filePath) {
      return HttpResponse.json(
        {
          error: "Session not found",
          ...(body.type === "prompt"
            ? { code: "prompt_rejected", accepted: false }
            : {}),
        },
        { status: 404 },
      );
    }

    const { session } = await startRpcSession(id, filePath, undefined, {
      ...(toolNames !== undefined ? { toolNames } : {}),
    });
    const result = await session.send(body);
    promptAccepted = body.type === "prompt";

    return HttpResponse.json({ success: true, data: result });
  } catch (error) {
    return HttpResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        ...(commandType === "prompt" && !promptAccepted
          ? { code: "prompt_rejected", accepted: false }
          : {}),
      },
      { status: 500 },
    );
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      return HttpResponse.json({ running: false });
    }

    const state = await session.send({ type: "get_state" });
    return HttpResponse.json({ running: true, state });
  } catch (error) {
    return HttpResponse.json({ error: String(error) }, { status: 500 });
  }
}
