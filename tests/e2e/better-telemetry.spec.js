const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

// A speed test page whose server has (or has not) telemetry. The posts to telemetry.php are answered here and counted:
// nothing reaches a server
async function openSpeedtest(page, level) {
  const posts = [];
  await page.route("**/settings.json*", route => route.fulfill({ json: { telemetry_level: level } }));
  await page.route("**/server-list.json*", route =>
    route.fulfill({
      json: [
        {
          name: "local",
          server: "/backend",
          dlURL: "garbage.php",
          ulURL: "empty.php",
          pingURL: "empty.php",
          getIpURL: "getIP.php"
        }
      ]
    })
  );
  await page.route("**/backend/empty.php*", route =>
    route.fulfill({ body: "", headers: { "Access-Control-Allow-Origin": "*" } })
  );
  await page.route("**/backend/getIP.php*", route => route.fulfill({ body: "203.0.113.9" }));
  await page.route("**/results/**", route => {
    posts.push(route.request().method());
    return route.fulfill({ body: "id 777" });
  });
  await page.goto(`${staticRepositoryUrl}/index-better.html`);
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
  await page.evaluate(() => LibreSpeedConsent.ready);
  // Only the IP and the ping: a short test
  await page.evaluate(() => {
    s.setParameter("test_order", "IP");
    s.setParameter("count_ping", 3);
  });
  return posts;
}

async function savedResults(page) {
  return page.evaluate(() => JSON.parse(window.localStorage.getItem("librespeed-better-history") || "[]"));
}

test("without telemetry the result stays in the browser and is not sent", async ({ page }) => {
  const posts = await openSpeedtest(page, "off");
  await page.locator("#startStopBtn").click();
  await expect.poll(() => savedResults(page)).toHaveLength(1);
  expect(posts).toEqual([]);
  expect((await savedResults(page))[0].testId).toBeNull();
  await expect(page.locator("#consentDialog")).toHaveCount(0);
  await expect(page.locator(".history-share-btn")).toHaveCount(0);
});

test("with telemetry the result is sent once after the policy is accepted and gets its id", async ({ page }) => {
  const posts = await openSpeedtest(page, "basic");
  await page.locator("#startStopBtn").click();
  await page.locator("#consentDialog .consent-accept").click();
  await expect.poll(() => savedResults(page)).toHaveLength(1);
  expect(posts).toEqual(["POST"]);
  expect((await savedResults(page))[0].testId).toBe("777");
  await expect(page.locator(".history-share-btn")).toHaveCount(1);
});

test("with telemetry, cancelling the policy sends nothing", async ({ page }) => {
  const posts = await openSpeedtest(page, "basic");
  await page.locator("#startStopBtn").click();
  await page.locator("#consentDialog .consent-cancel").click();
  await page.waitForTimeout(1500);
  expect(posts).toEqual([]);
  expect(await savedResults(page)).toEqual([]);
});
