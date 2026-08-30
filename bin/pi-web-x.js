#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");
const { getHelpText, parseLaunchOptions } = require("./pi-web-x-options.js");

try {
  const options = parseLaunchOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(getHelpText());
    process.exit(0);
  }
  if (options.version) {
    process.stdout.write(`${require("../package.json").version}\n`);
    process.exit(0);
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

const binary = process.platform === "win32" ? "pi-web-x.exe" : "pi-web-x";
const executable = resolve(__dirname, "..", "dist", binary);
const result = spawnSync(executable, process.argv.slice(2), {
  stdio: "inherit",
});
if (result.error) {
  console.error(
    `pi-web-x binary is unavailable at ${executable}. Download a platform binary release instead.`,
  );
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
