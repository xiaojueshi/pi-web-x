import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const targets = [
  "bun-darwin-x64",
  "bun-darwin-arm64",
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-linux-x64-musl",
  "bun-linux-arm64-musl",
  "bun-windows-x64",
  "bun-windows-arm64",
] as const;

/** 构建全部受支持平台的自包含 pi-web-x 二进制。 */
async function buildAll(): Promise<void> {
  await import("./build-css.ts");
  await mkdir("dist", { recursive: true });
  const results = await Promise.all(
    targets.map(async (target) => {
      const extension = target.startsWith("bun-windows-") ? ".exe" : "";
      const output = join(
        "dist",
        `pi-web-x-${target.replace("bun-", "")}${extension}`,
      );
      return Bun.build({
        entrypoints: ["src/cli.ts"],
        compile: { target, outfile: output, assets: ["./public"] },
      });
    }),
  );
  const failures = results
    .flatMap((result) => result.logs)
    .filter((log) => log.level === "error");
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure.message);
    process.exitCode = 1;
  }
}

await buildAll();
