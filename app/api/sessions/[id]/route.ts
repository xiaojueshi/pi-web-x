import { HttpResponse, requestSearchParams } from "@/src/server/http";
import { existsSync, statSync } from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  attachSessionProjectInfo,
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionListCache,
  buildSessionContext,
} from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { projectTreeForResponse } from "@/lib/project-tree";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import { computeSessionStats } from "@/lib/session-stats";
import type { SessionEntry } from "@/lib/types";
import { readSubagentRun, readSubagentSessionResources } from "@/lib/subagents";
import { deleteSessionWithPreview } from "@/lib/session-deletion";
import { readSessionToolSelection } from "@/lib/session-tool-selection";

function isReadOnlySubagentSession(
  filePath: string,
  sessionId: string,
): boolean {
  try {
    const session = SessionManager.open(filePath);
    return Boolean(
      readSubagentRun(session.getEntries() as never, sessionId, filePath),
    );
  } catch {
    return false;
  }
}

function subagentReadOnlyResponse() {
  return HttpResponse.json(
    { error: "Subagent sessions are read-only", code: "subagent_read_only" },
    { status: 403 },
  );
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const resolvedPath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !resolvedPath) {
      return HttpResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm =
      liveRpc?.inner.sessionManager ?? SessionManager.open(resolvedPath!);
    const filePath =
      liveRpc?.sessionFile || sm.getSessionFile() || resolvedPath || "";
    const entries = sm.getEntries();
    const leafId = sm.getLeafId();
    const tree = projectTreeForResponse(sm.getTree());
    const searchParams = requestSearchParams(req);
    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    const rawTail = Number(searchParams.get("tail"));
    const tail =
      Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 50;
    const context = buildSessionContext(entries as never, leafId, {
      deferThinking,
      deferToolResultImages,
      tail,
      sessionId: id, // local: lazy URLs for historical tool-result images
    });
    const totalActiveMs = computeSessionTotalActiveMs(entries);
    // Cumulative usage over ALL entries, including history compacted away —
    // the same aggregation the SDK's getSessionStats() uses. Lets the client
    // keep monotonic token/cost counters across compaction and page reloads.
    // SAFETY: SDK SessionManager entries use the same persisted JSONL shape as
    // the local SessionEntry contract; only their exported TypeScript types differ.
    const stats = computeSessionStats(entries as unknown as SessionEntry[]);
    const sessionName = sm.getSessionName();
    const firstUserEntry = entries.find(
      (entry) => entry.type === "message" && entry.message.role === "user",
    );
    const firstUserMessage =
      firstUserEntry?.type === "message" ? firstUserEntry.message : undefined;

    const header = sm.getHeader();
    let modified = header?.timestamp ?? new Date().toISOString();
    try {
      modified = statSync(filePath).mtime.toISOString();
    } catch {
      /* use header timestamp */
    }
    const parentSessionId = header?.parentSession
      ? await resolveSessionIdByPath(header.parentSession)
      : undefined;
    const subagent = header
      ? readSubagentRun(entries as never, header.id, filePath)
      : null;
    const toolNames =
      readSubagentSessionResources(entries as never)?.tools ??
      readSessionToolSelection(entries as never);
    const info = header
      ? (
          await attachSessionProjectInfo([
            {
              path: filePath,
              id: header.id,
              cwd: header.cwd ?? "",
              name: sessionName,
              created: header.timestamp,
              modified,
              messageCount: stats.totalMessages,
              firstMessage: firstUserMessage
                ? (() => {
                    const c = (firstUserMessage as { content: unknown })
                      .content;
                    return typeof c === "string"
                      ? c
                      : (Array.isArray(c)
                          ? ((
                              c.find(
                                (b: { type: string }) => b.type === "text",
                              ) as { text: string } | undefined
                            )?.text ?? "")
                          : "") || "(no messages)";
                  })()
                : "(no messages)",
              parentSessionId,
              ...(subagent
                ? {
                    relation: {
                      kind: "subagent" as const,
                      parentSessionId: subagent.parentSessionId,
                      profile: subagent.profile,
                      description: subagent.description,
                      status: liveRpc?.isRunning()
                        ? ("running" as const)
                        : subagent.status,
                    },
                  }
                : header.parentSession
                  ? {
                      relation: {
                        kind: "fork" as const,
                        ...(parentSessionId
                          ? { originSessionId: parentSessionId }
                          : {}),
                      },
                    }
                  : {}),
              transient: !filePath || !existsSync(filePath),
            },
          ])
        )[0]
      : null;

    return HttpResponse.json({
      sessionId: id,
      filePath,
      info,
      leafId,
      tree,
      context,
      stats,
      totalActiveMs,
      ...(toolNames !== undefined ? { toolNames } : {}),
    });
  } catch (error) {
    return HttpResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { name } = (await req.json()) as { name?: string };
    if (typeof name !== "string") {
      return HttpResponse.json({ error: "name is required" }, { status: 400 });
    }
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return HttpResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (isReadOnlySubagentSession(filePath, id))
      return subagentReadOnlyResponse();
    const sm = SessionManager.open(filePath);
    sm.appendSessionInfo(name.trim());
    invalidateSessionListCache();
    return HttpResponse.json({ ok: true });
  } catch (error) {
    return HttpResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id] body: { token: string }
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (filePath && isReadOnlySubagentSession(filePath, id))
      return subagentReadOnlyResponse();
    const body = (await req.json().catch(() => ({}))) as { token?: unknown };
    const result = await deleteSessionWithPreview(id, body.token);
    return HttpResponse.json({
      ok: true,
      deletedSessionIds: result.deletedSessionIds,
      summary: result.summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      (error as Error & { status?: number }).status ??
      (message === "Session not found" ? 404 : 500);
    return HttpResponse.json({ error: message }, { status });
  }
}
