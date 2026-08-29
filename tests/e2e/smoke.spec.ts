import { expect, test } from "@playwright/test";

test("compiled binary serves the React UI, API, and PWA manifest", async ({
  page,
  request,
}) => {
  const api = await request.get("/api/home");
  expect(api.ok()).toBeTruthy();
  await expect(api.json()).resolves.toHaveProperty("home");

  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  await expect(manifest.json()).resolves.toMatchObject({
    name: "Pi Web X",
    display: "standalone",
  });

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
  await expect(page.locator("body")).toContainText(/offline|离线|无法连接|Pi Web X/i);
});
