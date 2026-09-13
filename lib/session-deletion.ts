import { createHash, randomUUID } from "crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import {
  invalidateSessionListCache,
  invalidateSessionPathCache,
  listAllSessions,
  readSessionHeader,
  resolveSessionPath,
} from "./session-reader";
import { getRpcSession } from "./rpc-manager";
import { sessionPathKey } from "./session-path";
import { SUBAGENT_META_TYPE } from "./subagents";
import type { SessionInfo } from "./types";

const DELETE_PREVIEW_TTL_MS = 5 * 60 * 1000;
const MAX_STORED_DELETE_PREVIEWS = 100;

export interface SessionDeleteSummary {
  sessionCount: number;
  subagentDescendantCount: number;
  runningDescendantCount: number;
  forkChildrenReparented: number;
}

export interface SessionDeletePreview {
  token: string;
  deletedSessionIds: string[];
  descendants: Array<{
    id: string;
    profile?: string;
    description?: string;
    running: boolean;
  }>;
  summary: SessionDeleteSummary;
}

interface DeletePlan extends Omit<SessionDeletePreview, "token"> {
  targetId: string;
  targetPath: string;
  deletedPaths: string[];
  retainedChildren: Array<{ id: string; path: string }>;
  /** 所有会被删除或改挂的 JSONL 在预览时的完整内容指纹。 */
  fileFingerprints: Array<{ path: string; sha256: string }>;
  signature: string;
}

interface StoredPreview {
  expiresAt: number;
  plan: DeletePlan;
}

/**
 * 会话删除的文件操作边界。
 *
 * 生产调用使用 Node 文件系统；可替换边界使事务恢复逻辑能够在不依赖宿主权限的
 * 情况下测试部分删除失败与最终写入竞态。
 */
export interface SessionDeletionFileOperations {
  /** 判断目标路径是否存在。 */
  exists(path: string): boolean;
  /** 同步读取完整 JSONL 文本。 */
  read(path: string): string;
  /** 同步写入文本；`exclusive` 用于创建不覆盖的备份。 */
  write(path: string, content: string, options?: { exclusive?: boolean }): void;
  /** 删除会话或备份文件。 */
  unlink(path: string): void;
  /** 在最终版本校验后、删除前调用；仅用于受控测试或宿主协调。 */
  beforeDelete?(path: string): void;
}

const defaultFileOperations: SessionDeletionFileOperations = {
  exists: existsSync,
  read: (path) => readFileSync(path, "utf8"),
  write: (path, content, options) =>
    writeFileSync(
      path,
      content,
      options?.exclusive ? { flag: "wx" } : undefined,
    ),
  unlink: unlinkSync,
};

const previews = new Map<string, StoredPreview>();

function deleteConflict(message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = 409;
  return error;
}

function isRunning(sessionId: string): boolean {
  const rpc = getRpcSession(sessionId);
  return Boolean(rpc?.isAlive() && rpc.isRunning());
}

function sourceFingerprint(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function signatureFor(plan: Omit<DeletePlan, "signature">): string {
  return JSON.stringify({
    deletedSessionIds: [...plan.deletedSessionIds].sort((a, b) =>
      a.localeCompare(b),
    ),
    deletedPaths: plan.deletedPaths.map((path) => sessionPathKey(path)).sort(),
    retainedChildren: plan.retainedChildren
      .map(({ id, path }) => [id, sessionPathKey(path)])
      .sort(([a], [b]) => a.localeCompare(b)),
    fileFingerprints: plan.fileFingerprints
      .map(({ path, sha256 }) => [sessionPathKey(path), sha256])
      .sort(([a], [b]) => a.localeCompare(b)),
    descendants: plan.descendants
      .map(({ id, running }) => ({ id, running }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

function adjacentSessions(targetPath: string): SessionInfo[] {
  try {
    return readdirSync(dirname(targetPath))
      .filter((name) => name.endsWith(".jsonl"))
      .flatMap((name) => {
        const path = join(dirname(targetPath), name);
        try {
          const source = readFileSync(path, "utf8");
          const [headerLine, ...entryLines] = source.split("\n");
          const header = JSON.parse(headerLine) as {
            type?: unknown;
            id?: unknown;
            cwd?: unknown;
            parentSession?: unknown;
            timestamp?: unknown;
          };
          if (header.type !== "session" || typeof header.id !== "string")
            return [];
          const metadata = entryLines
            .map((line) => {
              try {
                return JSON.parse(line) as {
                  type?: unknown;
                  customType?: unknown;
                  data?: unknown;
                };
              } catch {
                return null;
              }
            })
            .find(
              (entry) =>
                entry?.type === "custom" &&
                entry.customType === SUBAGENT_META_TYPE,
            );
          const data = metadata?.data as Record<string, unknown> | undefined;
          const subagentData =
            data &&
            typeof data.parentSessionId === "string" &&
            typeof data.parentSessionPath === "string"
              ? data
              : undefined;
          return [
            {
              id: header.id,
              path,
              cwd: typeof header.cwd === "string" ? header.cwd : "",
              created:
                typeof header.timestamp === "string" ? header.timestamp : "",
              modified: "",
              messageCount: 0,
              firstMessage: "(no messages)",
              ...(subagentData
                ? {
                    relation: {
                      kind: "subagent" as const,
                      parentSessionId: subagentData.parentSessionId as string,
                      profile:
                        typeof subagentData.profile === "string"
                          ? subagentData.profile
                          : "general-purpose",
                      description:
                        typeof subagentData.description === "string"
                          ? subagentData.description
                          : "Subagent",
                      status: "interrupted" as const,
                    },
                  }
                : typeof header.parentSession === "string"
                  ? { relation: { kind: "fork" as const } }
                  : {}),
            },
          ];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function descendantsOf(
  sessions: readonly SessionInfo[],
  targetId: string,
): SessionInfo[] {
  const descendantIds = new Set<string>([targetId]);
  const descendants: SessionInfo[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const session of sessions) {
      if (
        descendantIds.has(session.id) ||
        session.relation?.kind !== "subagent" ||
        !descendantIds.has(session.relation.parentSessionId)
      )
        continue;
      descendantIds.add(session.id);
      descendants.push(session);
      changed = true;
    }
  }
  return descendants;
}

async function buildDeletePlan(targetId: string): Promise<DeletePlan> {
  const targetPath = await resolveSessionPath(targetId);
  if (!targetPath) throw new Error("Session not found");

  const listedSessions = await listAllSessions({ force: true });
  // The list cache is normally complete, but direct disk discovery also covers
  // a just-created JSONL before the asynchronous catalog has observed it.
  const byId = new Map(listedSessions.map((session) => [session.id, session]));
  for (const session of adjacentSessions(targetPath))
    byId.set(session.id, session);
  const sessions = [...byId.values()];
  const target = sessions.find((session) => session.id === targetId);
  if (target?.relation?.kind === "subagent") {
    throw new Error("Subagent sessions are read-only");
  }

  const descendants = descendantsOf(sessions, targetId);
  const deletedSessionIds = [targetId, ...descendants.map(({ id }) => id)];
  // descendantsOf() 由近及远发现后代；反转后先删最深 child，最后删 parent。
  const deletedPaths = [
    ...descendants.map(({ path }) => path).reverse(),
    targetPath,
  ];
  const deletedPathKeys = new Set(
    deletedPaths.map((path) => sessionPathKey(path)),
  );
  // Ordinary forks below any deleted inline node survive and are reattached to
  // the deleted root's parent. Inline subagents are already in deletedSessionIds.
  const retainedChildren = sessions
    .filter(
      (session) =>
        !deletedSessionIds.includes(session.id) &&
        session.relation?.kind !== "subagent" &&
        deletedPathKeys.has(
          sessionPathKey(readSessionHeader(session.path)?.parentSession ?? ""),
        ),
    )
    .map(({ id, path }) => ({ id, path }));
  const filesAffected = [
    ...deletedPaths,
    ...retainedChildren.map(({ path }) => path),
  ];
  const fileFingerprints = filesAffected.map((path) => {
    if (!existsSync(path))
      throw deleteConflict("Delete preview is stale; request a new preview");
    return { path, sha256: sourceFingerprint(readFileSync(path, "utf8")) };
  });
  const descendantsPreview = descendants.map((session) => ({
    id: session.id,
    ...(session.relation?.kind === "subagent"
      ? {
          profile: session.relation.profile,
          description: session.relation.description,
        }
      : {}),
    running: isRunning(session.id),
  }));
  const planWithoutSignature = {
    targetId,
    targetPath,
    deletedSessionIds,
    deletedPaths,
    retainedChildren,
    fileFingerprints,
    descendants: descendantsPreview,
    summary: {
      sessionCount: deletedSessionIds.length,
      subagentDescendantCount: descendants.length,
      runningDescendantCount: descendantsPreview.filter(
        ({ running }) => running,
      ).length,
      forkChildrenReparented: retainedChildren.length,
    },
  };
  return {
    ...planWithoutSignature,
    signature: signatureFor(planWithoutSignature),
  };
}

/** 创建只读删除预览；token 仅可用于该次确认。 */
export async function previewSessionDelete(
  sessionId: string,
): Promise<SessionDeletePreview> {
  const now = Date.now();
  discardExpiredPreviews(now);
  const plan = await buildDeletePlan(sessionId);
  const token = randomUUID();
  previews.set(token, { plan, expiresAt: now + DELETE_PREVIEW_TTL_MS });
  return {
    token,
    deletedSessionIds: plan.deletedSessionIds,
    descendants: plan.descendants,
    summary: plan.summary,
  };
}

function rewriteForkParent(
  source: string,
  parentSessionPath: string | undefined,
): string {
  const lines = source.split("\n");
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(lines[0]) as Record<string, unknown>;
  } catch {
    throw new Error("Cannot reparent malformed session JSONL");
  }
  if (header.type !== "session")
    throw new Error("Cannot reparent non-session JSONL");
  if (parentSessionPath) header.parentSession = parentSessionPath;
  else delete header.parentSession;
  lines[0] = JSON.stringify(header);
  return lines.join("\n");
}

function restoreFiles(
  backups: ReadonlyMap<string, string>,
  operations: SessionDeletionFileOperations,
): string[] {
  const failed: string[] = [];
  for (const [path, source] of backups) {
    try {
      operations.write(path, source);
    } catch {
      // 不能清除对应磁盘备份：调用者需要可恢复证据，而不是静默丢失数据。
      failed.push(path);
    }
  }
  return failed;
}

function removeBackups(
  backupPaths: ReadonlyMap<string, string>,
  operations: SessionDeletionFileOperations,
): void {
  for (const backupPath of backupPaths.values()) {
    try {
      operations.unlink(backupPath);
    } catch {
      // Cleanup failure must not turn a completed deletion into a false failure.
    }
  }
}

function assertMatchesBackup(
  path: string,
  expectedSource: string,
  operations: SessionDeletionFileOperations,
): void {
  if (!operations.exists(path) || operations.read(path) !== expectedSource) {
    throw deleteConflict(
      "Session changed during deletion; restoration started",
    );
  }
}

function discardExpiredPreviews(now = Date.now()): void {
  for (const [token, preview] of previews) {
    if (preview.expiresAt < now) previews.delete(token);
  }
  while (previews.size >= MAX_STORED_DELETE_PREVIEWS) {
    const oldest = previews.keys().next().value;
    if (!oldest) break;
    previews.delete(oldest);
  }
}

/**
 * 严格消费 preview token 后执行删除。任何磁盘删除或改挂失败均使用完整 JSONL
 * 备份回滚；运行中的 inline 后代在所有写入前以 409 拒绝。
 */
export async function deleteSessionWithPreview(
  sessionId: string,
  token: unknown,
  operations: SessionDeletionFileOperations = defaultFileOperations,
): Promise<SessionDeletePreview> {
  if (typeof token !== "string")
    throw new Error("Delete confirmation token required");
  const stored = previews.get(token);
  if (
    !stored ||
    stored.expiresAt < Date.now() ||
    stored.plan.targetId !== sessionId
  ) {
    previews.delete(token);
    throw deleteConflict("Invalid or expired delete confirmation token");
  }
  previews.delete(token);

  const plan = await buildDeletePlan(sessionId);
  if (plan.signature !== stored.plan.signature) {
    throw deleteConflict("Delete preview is stale; request a new preview");
  }
  if (plan.summary.runningDescendantCount > 0) {
    throw deleteConflict(
      "Cannot delete a session with running subagent descendants",
    );
  }

  const rootParentPath = readSessionHeader(plan.targetPath)?.parentSession;
  const parentSessionPath =
    rootParentPath && existsSync(rootParentPath) ? rootParentPath : undefined;
  const backups = new Map<string, string>();
  const backupPaths = new Map<string, string>();
  const operationId = randomUUID();
  try {
    for (const path of [
      ...plan.deletedPaths,
      ...plan.retainedChildren.map(({ path }) => path),
    ]) {
      if (!operations.exists(path))
        throw deleteConflict("Delete preview is stale; request a new preview");
      const source = operations.read(path);
      const expectedFingerprint = plan.fileFingerprints.find(
        (fingerprint) =>
          sessionPathKey(fingerprint.path) === sessionPathKey(path),
      );
      if (
        !expectedFingerprint ||
        sourceFingerprint(source) !== expectedFingerprint.sha256
      ) {
        throw deleteConflict("Delete preview is stale; request a new preview");
      }
      backups.set(path, source);
      // 使用每次操作唯一的文件名，绝不覆盖先前失败操作遗留的恢复备份。
      const backupPath = `${path}.${operationId}.pi-web-x-delete-backup`;
      operations.write(backupPath, source, { exclusive: true });
      backupPaths.set(path, backupPath);
    }
  } catch (error) {
    removeBackups(backupPaths, operations);
    throw error;
  }

  try {
    for (const child of plan.retainedChildren) {
      const source = backups.get(child.path)!;
      assertMatchesBackup(child.path, source, operations);
      operations.write(
        child.path,
        rewriteForkParent(source, parentSessionPath),
      );
    }

    // 运行中的 descendant 已在所有写入前以 409 拒绝；这里关闭 target 与
    // idle descendant 的 wrapper，避免内存状态继续引用已删除的 JSONL。
    for (const deletedSessionId of plan.deletedSessionIds) {
      await getRpcSession(deletedSessionId)?.shutdown();
    }
    for (const path of plan.deletedPaths) {
      const source = backups.get(path)!;
      assertMatchesBackup(path, source, operations);
      operations.beforeDelete?.(path);
      assertMatchesBackup(path, source, operations);
      operations.unlink(path);
    }
  } catch (error) {
    const failedRestorePaths = restoreFiles(backups, operations);
    if (failedRestorePaths.length === 0) {
      removeBackups(backupPaths, operations);
      throw error;
    }
    // 至少有一份无法写回时，保留每个磁盘备份，避免部分删除变成永久丢失。
    throw new Error(
      `Session deletion failed and restoration is incomplete; recovery backups retained for: ${failedRestorePaths.join(", ")}`,
      { cause: error },
    );
  }

  removeBackups(backupPaths, operations);
  for (const id of plan.deletedSessionIds) invalidateSessionPathCache(id);
  invalidateSessionListCache();
  return {
    token,
    deletedSessionIds: plan.deletedSessionIds,
    descendants: plan.descendants,
    summary: plan.summary,
  };
}
