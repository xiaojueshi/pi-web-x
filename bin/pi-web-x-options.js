"use strict";

const { parseArgs } = require("util");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

const CLI_OPTIONS = {
  port: { type: "string", short: "p" },
  hostname: { type: "string", short: "H" },
  "no-open": { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

function isEnabled(value) {
  return (
    typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase())
  );
}

function normalizePort(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("Port must be a non-negative integer.");
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error("Port must be between 0 and 65535.");
  }

  return String(port);
}

function getHelpText() {
  return `Usage: pi-web-x [options]
       pi-web-x service <install|uninstall> [options]

Start the Pi Web X UI server.

Options:
  -p, --port <port>          Server port (default: 30141, or PORT)
  -H, --hostname <host>      Bind hostname (default: 127.0.0.1, or PI_WEB_X_HOSTNAME)
      --no-open              Do not open a browser automatically
  -h, --help                 Show this help message and exit

Service:
  service install            Register as an OS service and enable autostart
  service uninstall          Stop and remove the OS service
  service --help             Show service subcommand help

Environment:
  PORT                       Default port when --port is omitted
  PI_WEB_X_HOSTNAME            Default hostname when --hostname is omitted
  PI_WEB_X_NO_OPEN             Set to 1/true/yes/on to disable browser open
  PI_WEB_X_PASSWORD            Enable HTTP Basic Auth (username is always "pi")
  PI_WEB_X_ALLOWED_HOSTS       Extra exact proxy/custom hostnames, comma-separated
`;
}

function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  // service 子命令由编译二进制处理，wrapper 仅负责透传
  if (args[0] === "service") {
    return { help: false, service: true };
  }
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args,
      options: CLI_OPTIONS,
      strict: true,
      allowPositionals: true,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const err = new Error(`${message}\nUse --help to see available options.`);
    err.code = "ERR_PARSE_ARGS_UNKNOWN_OPTION";
    throw err;
  }

  if (values.help) {
    return { help: true };
  }

  if (positionals.length > 0) {
    throw new Error(
      `Unexpected argument(s): ${positionals.join(" ")}\nUse --help to see available options.`,
    );
  }

  return {
    help: false,
    port: normalizePort(values.port ?? env.PORT ?? "30141"),
    hostname: values.hostname ?? env.PI_WEB_X_HOSTNAME ?? "127.0.0.1",
    openBrowser: !values["no-open"] && !isEnabled(env.PI_WEB_X_NO_OPEN),
  };
}

module.exports = { parseLaunchOptions, getHelpText };
