import { defineConfig } from "@playwright/test";

const E2E_HOME = "/tmp/pi-web-x-playwright-home";
const E2E_PASSWORD = "pi-web-x-playwright-password";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:39152",
    httpCredentials: {
      username: "pi",
      password: E2E_PASSWORD,
      send: "always",
    },
  },
  webServer: {
    command:
      `rm -rf ${E2E_HOME} && mkdir -p ${E2E_HOME} && ` +
      `HOME=${E2E_HOME} PI_WEB_X_PASSWORD=${E2E_PASSWORD} bun tests/e2e/prepare-auth.ts && ` +
      `HOME=${E2E_HOME} ./dist/pi-web-x --port 39152 --no-open`,
    url: "http://127.0.0.1:39152/",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
