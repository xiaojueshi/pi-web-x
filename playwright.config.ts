import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:39152" },
  webServer: {
    command:
      "rm -rf /tmp/pi-web-x-playwright-home && mkdir -p /tmp/pi-web-x-playwright-home && HOME=/tmp/pi-web-x-playwright-home ./dist/pi-web-x --port 39152 --no-open",
    url: "http://127.0.0.1:39152/",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
