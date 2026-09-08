import { HttpResponse } from "@/src/server/http";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { generateSessionTitle } from "@/lib/session-title";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import {
  getSessionEntries,
  invalidateSessionListCache,
  resolveSessionPath,
} from "@/lib/session-reader";
import { readSubagentRun } from "@/lib/subagents";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return HttpResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (readSubagentRun(getSessionEntries(filePath), id, filePath)) {
      return HttpResponse.json(
        {
          error: "Subagent sessions are read-only",
          code: "subagent_read_only",
        },
        { status: 403 },
      );
    }

    const existing = getRpcSession(id);
    const { session } = existing?.isAlive()
      ? { session: existing }
      : await startRpcSession(id, filePath, undefined);

    // globalThis keeps wrappers alive across dev hot reloads; older instances
    // may predate waitUntilReady(), but those have already completed startup.
    await session.waitUntilReady?.();
    // SAFETY: session.inner 是 wrapper 持有的原生 AgentSession 实例，
    // wrapper 仅包装了会话外壳，inner 本身即 SDK AgentSession。
    const result = await generateSessionTitle(
      session.inner as unknown as AgentSession,
    );

    if (!session.isAlive()) {
      return HttpResponse.json(
        {
          error:
            "The session was closed while its title was being generated. Please try again.",
        },
        { status: 409 },
      );
    }

    session.inner.setSessionName(result.title);
    invalidateSessionListCache();
    return HttpResponse.json({
      title: result.title,
      usage: result.usage ?? null,
    });
  } catch (error) {
    return HttpResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
