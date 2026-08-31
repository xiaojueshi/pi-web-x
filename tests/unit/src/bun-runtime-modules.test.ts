import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const TEMP_ROOT = resolve(import.meta.dir, "../../.tmp");

const PROBE_SOURCE = String.raw`
import { registerBunRuntimeModules } from "../../../src/bun-runtime-modules";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { radiusProvider } from "@earendil-works/pi-ai/providers/radius";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import { bedrockConverseStreamApi } from "@earendil-works/pi-ai/compat";

registerBunRuntimeModules();

const credential = {
  type: "oauth",
  access: "probe-access-token",
  refresh: "probe-refresh-token",
  expires: Date.now() + 60_000,
};
const providers = [
  anthropicProvider(),
  openaiCodexProvider(),
  githubCopilotProvider(),
  openrouterProvider(),
  kimiCodingProvider(),
  xaiProvider(),
  radiusProvider(),
];
for (const provider of providers) {
  const oauth = provider.auth.oauth;
  if (!oauth) throw new Error(provider.id + " 未声明 OAuth");
  await oauth.toAuth(credential);
}

const model = {
  id: "probe",
  name: "probe",
  api: "bedrock-converse-stream",
  provider: "amazon-bedrock",
  baseUrl: "http://127.0.0.1:9",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1,
  maxTokens: 1,
};
const result = await bedrockConverseStreamApi()
  .stream(
    model,
    { messages: [null] },
    { env: { AWS_BEDROCK_SKIP_AUTH: "1" } },
  )
  .result();
if (result.errorMessage?.includes("Cannot find module")) {
  throw new Error(result.errorMessage);
}
if (result.stopReason !== "error") {
  throw new Error(
    "Bedrock 探针应在无网络请求前因畸形消息失败，实际为 " + result.stopReason,
  );
}

console.log("compiled runtime modules ok");
`;

test("编译二进制可加载全部内置 OAuth flow 与 Bedrock 实现", async () => {
  await mkdir(TEMP_ROOT, { recursive: true });
  const tempDir = await mkdtemp(join(TEMP_ROOT, "bun-runtime-"));
  const probePath = join(tempDir, "probe.ts");
  const binaryPath = join(
    tempDir,
    process.platform === "win32" ? "probe.exe" : "probe",
  );

  try {
    await writeFile(probePath, PROBE_SOURCE, "utf8");
    const build = await Bun.build({
      entrypoints: [probePath],
      compile: { outfile: binaryPath },
    });
    expect(build.success, build.logs.map((log) => log.message).join("\n")).toBe(
      true,
    );

    const execution = Bun.spawnSync({
      cmd: [binaryPath],
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = execution.stdout.toString();
    const stderr = execution.stderr.toString();
    expect(execution.exitCode, stderr).toBe(0);
    expect(stdout).toContain("compiled runtime modules ok");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
