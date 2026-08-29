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
