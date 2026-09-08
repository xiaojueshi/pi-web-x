import {
 hasTrustRequiringProjectResources,
 ProjectTrustStore,
} from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProjectTrustStatus } from "./api-types";

/** 仓库 profile 同样是可执行委派提示词，必须计入项目可信度边界。 */
function hasRepositorySubagentProfiles(cwd: string): boolean {
 for (const dir of [
  join(resolve(cwd), ".agents", "agents"),
  join(resolve(cwd), ".pi", "agents"),
 ]) {
  if (!existsSync(dir)) continue;
  try {
   if (
    readdirSync(dir, { withFileTypes: true }).some(
     (entry) => entry.isFile() && entry.name.endsWith(".md"),
    )
   )
    return true;
  } catch {
   // 无法读取的目录不能被视为可信资源。
   return true;
  }
 }
 return false;
}

/**
 * 读取项目受信任状态，并把仓库提供的 subagent profile 纳入受限资源。
 *
 * @param cwd 项目工作目录。
 * @param agentDir Pi agent 数据目录，存放共享的信任决策。
 * @returns 项目是否需要信任及当前是否已受信任。
 */
export function getProjectTrustStatus(
 cwd: string,
 agentDir: string,
): ProjectTrustStatus {
 const requiresTrust =
  Boolean(cwd) &&
  (hasTrustRequiringProjectResources(cwd) ||
   hasRepositorySubagentProfiles(cwd));
 if (!requiresTrust) return { requiresTrust: false, trusted: true };

 const trustStore = new ProjectTrustStore(agentDir);
 return {
  requiresTrust: true,
  trusted: trustStore.get(cwd) === true,
 };
}

/**
 * 将需要信任资源的项目标记为受信任。
 *
 * @param cwd 项目工作目录。
 * @param agentDir Pi agent 数据目录，存放共享的信任决策。
 * @returns 写入后的项目受信任状态；不含受限资源的项目保持默认受信任状态。
 */
export function trustProject(
 cwd: string,
 agentDir: string,
): ProjectTrustStatus {
 const status = getProjectTrustStatus(cwd, agentDir);
 if (!status.requiresTrust) return status;

 new ProjectTrustStore(agentDir).set(cwd, true);
 return { requiresTrust: true, trusted: true };
}

/**
 * Reload options that gate project-local, trust-requiring resources — a
 * repository's `.pi/extensions`, project `.pi/settings.json` extension
 * entries, and `.agents/skills` — behind the SDK's project-trust store.
 *
 * Pi Web X *executes* project extensions when it builds session services: their
 * factory runs on import and their `session_start` handlers run on startup.
 * Without a trust gate, merely opening an untrusted repository in Pi Web X runs
 * repository-controlled code locally (issue #236). The SDK's resource loader
 * only imports project extensions once `resolveProjectTrust` resolves true, so
 * denying trust keeps them dormant.
 *
 * Pi Web X and the `pi` CLI share the same trust store. Projects with gated
 * resources default to untrusted until either client records a trust decision.
 * Returns `undefined` when the project has no trust-requiring resources,
 * leaving ordinary projects on their existing load path.
 */
export function projectTrustReloadOptions(
 cwd: string,
 agentDir: string,
): { resolveProjectTrust: () => Promise<boolean> } | undefined {
 const status = getProjectTrustStatus(cwd, agentDir);
 if (!status.requiresTrust) return undefined;
 const trustStore = new ProjectTrustStore(agentDir);
 return { resolveProjectTrust: async () => trustStore.get(cwd) === true };
}
