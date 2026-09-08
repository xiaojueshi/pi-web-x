import { HttpResponse, requestSearchParams } from "@/src/server/http";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  attachSessionProjectInfo,
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionPathCache,
  invalidateSessionListCache,
  buildSessionContext,
  readSessionHeader,
} from "@/lib/session-reader";
import { sessionPathKey } from "@/lib/session-path";
import { getRpcSession } from "@/lib/rpc-manager";
import { projectTreeForResponse } from "@/lib/project-tree";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import { computeSessionStats } from "@/lib/session-stats";
import type { SessionEntry } from "@/lib/types";
import {
  readSubagentRun,
  readSubagentSessionResources,
  SUBAGENT_META_TYPE,
} from "@/lib/subagents";
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

// DELETE /api/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return HttpResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (isReadOnlySubagentSession(filePath, id))
      return subagentReadOnlyResponse();

    // Read only the bounded header before deleting.
    const parentSessionPath = readSessionHeader(filePath)?.parentSession;
    let parentSessionId: string | undefined;
    if (parentSessionPath) {
      try {
        parentSessionId = readSessionHeader(parentSessionPath)?.id;
      } catch {
        // 父 JSONL 已被手动删除时仍应允许删除当前会话并去父化子会话。
        parentSessionId = undefined;
      }
    }

    // Re-attach all direct children to this session's parent (cascade re-parent)
    // Scan sibling files in the same directory
    const targetPathKey = sessionPathKey(filePath);
    const dir = dirname(filePath);
    try {
      const files = readdirSync(dir).filter(
        (file) =>
          file.endsWith(".jsonl") &&
          sessionPathKey(join(dir, file)) !== targetPathKey,
      );
      for (const file of files) {
        const childPath = join(dir, file);
        try {
          const content = readFileSync(childPath, "utf8");
          const lines = content.split("\n");
          const header = JSON.parse(lines[0]) as {
            type?: string;
            parentSession?: string;
          };
          if (
            header.type === "session" &&
            header.parentSession &&
            sessionPathKey(header.parentSession) === targetPathKey
          ) {
            // 父会话仍存在时重挂；否则子会话必须去父化，不能留下悬挂路径。
            if (parentSessionPath && parentSessionId) {
              header.parentSession = parentSessionPath;
            } else {
              delete header.parentSession;
            }
            lines[0] = JSON.stringify(header);
            for (let index = 1; index < lines.length; index += 1) {
              let entry: {
                type?: string;
                customType?: string;
                data?: unknown;
              };
              try {
                entry = JSON.parse(lines[index]);
              } catch {
                continue;
              }
              if (
                entry.type !== "custom" ||
                entry.customType !== SUBAGENT_META_TYPE ||
                typeof entry.data !== "object" ||
                entry.data === null ||
                Array.isArray(entry.data)
              )
                continue;
              const metadata = { ...entry.data } as Record<string, unknown>;
              if (parentSessionPath && parentSessionId) {
                metadata.parentSessionId = parentSessionId;
                metadata.parentSessionPath = parentSessionPath;
              } else {
                delete metadata.parentSessionId;
                delete metadata.parentSessionPath;
              }
              entry.data = metadata;
              lines[index] = JSON.stringify(entry);
              break;
            }
            writeFileSync(childPath, lines.join("\n"));
          }
        } catch {
          /* skip malformed */
        }
      }
    } catch {
      /* skip if dir unreadable */
    }

    await getRpcSession(id)?.shutdown();
    unlinkSync(filePath);
    invalidateSessionPathCache(id);
    invalidateSessionListCache();
    return HttpResponse.json({ ok: true });
  } catch (error) {
    return HttpResponse.json({ error: String(error) }, { status: 500 });
  }
}
