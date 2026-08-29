import { mkdir } from "node:fs/promises";

/**
 * 把 app/globals.css（含 @import "tailwindcss" 与 @theme）静态化为
 * .build/globals.built.css，仅构建时执行，运行时无 Tailwind 构建链。
 */
async function buildCss(): Promise<void> {
  await mkdir(".build", { recursive: true });
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      "x",
      "@tailwindcss/cli",
      "-i",
      "app/globals.css",
      "-o",
      ".build/globals.built.css",
    ],
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    console.error(`build-css 失败：退出码 ${String(result.exitCode)}`);
    process.exit(result.exitCode ?? 1);
  }
}

await buildCss();
