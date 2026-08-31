import { expect, test, type Page } from "@playwright/test";

const E2E_PASSWORD = "pi-web-x-playwright-password";

/**
 * 为 Playwright 浏览器上下文创建 Web session Cookie。
 *
 * @param page 当前测试页面；其 request context 与浏览器共享 Cookie。
 * @returns 登录完成后的 Promise。
 * @throws 认证 fixture 初始化失败或登录接口拒绝时抛出。
 */
async function loginE2eBrowser(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { password: E2E_PASSWORD },
  });
  if (!response.ok()) {
    throw new Error(`E2E browser login failed with HTTP ${response.status()}`);
  }
}

test("compiled binary serves the React UI, API, and PWA manifest", async ({
  page,
  request,
}) => {
  const api = await request.get("/api/home");
  expect(api.ok()).toBeTruthy();
  expect(await api.json()).toHaveProperty("home");

  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  expect(await manifest.json()).toMatchObject({
    name: "Pi Web X",
    display: "standalone",
  });

  await loginE2eBrowser(page);
  await page.goto("/");
  await expect(page).toHaveTitle("Pi Web X");
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect
    .poll(() =>
      page.evaluate(() =>
        navigator.serviceWorker.getRegistration().then(Boolean),
      ),
    )
    .toBeTruthy();
});

test("service worker serves the offline fallback after activation", async ({
  page,
  context,
}) => {
  await loginE2eBrowser(page);
  await page.goto("/");
  await expect(page.locator("#root")).not.toBeEmpty();

  // 等待 service worker 完成安装与激活，并接管页面。
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return Boolean(registration.active);
      }),
    )
    .toBeTruthy();

  // 断网后重新导航：应由 service worker 提供离线回退页而非网络错误。
  await context.setOffline(true);
  await page.goto("/");
  await expect(page).toHaveTitle(/Pi Web X|Offline/i);
  await expect(page.locator("body")).toContainText(
    /offline|离线|无法连接|Pi Web X/i,
  );
});
