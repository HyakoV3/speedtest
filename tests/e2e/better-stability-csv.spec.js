const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";
const KEY = "librespeed-better-stability-history";
const PINGS = [
  { t: 0.2, ping: 12.5, lost: false },
  { t: 0.4, ping: 14.25, lost: false },
  { t: 0.6, ping: 0, lost: true }
];

function measurement(extra = {}) {
  return { date: Date.now(), duration: 60, avg: 12.3, min: 8, max: 30, jitter: 1.5, loss: 0.5, pings: PINGS, ...extra };
}

async function openWithHistory(page, entries, query = "") {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, JSON.stringify(value)), [KEY, entries]);
  await page.route("**/server-list.json*", route => route.fulfill({ json: [] }));
  await page.goto(`${staticRepositoryUrl}/stability-better.html${query}`);
}

test("a saved measurement has a download icon after the share icon, as one bar of three parts", async ({ page }) => {
  await openWithHistory(page, [measurement()]);
  const bar = page.locator(".history-bar").first();
  await expect(bar.locator(".history-header")).toBeVisible();
  await expect(bar.locator(".history-share-btn")).toBeVisible();
  const download = bar.locator(".history-download-btn");
  await expect(download).toBeVisible();
  await expect(download.locator("svg")).toHaveCount(1);
  await expect(download).toHaveAttribute("title", "Download CSV");
  await expect(download).toHaveAttribute("aria-label", "Download CSV");
  // The order is the header, the share icon and the download icon, and the two icons are as tall as the bar
  const [header, share, down, whole] = await Promise.all(
    [".history-header", ".history-share-btn", ".history-download-btn", ":scope"].map(selector =>
      (selector === ":scope" ? bar : bar.locator(selector)).boundingBox()
    )
  );
  expect(header.x + header.width).toBeLessThanOrEqual(share.x + 1);
  expect(share.x + share.width).toBeLessThanOrEqual(down.x + 1);
  expect(Math.abs(share.height - whole.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(down.height - whole.height)).toBeLessThanOrEqual(1);
});

test("the download icon saves the CSV of that measurement", async ({ page }) => {
  await openWithHistory(page, [measurement()]);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".history-download-btn").first().click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^stability_test_.+\.csv$/);
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk;
  expect(csv.trim().split("\n")).toEqual([
    "elapsed_s,ping_ms,failed",
    "0.200,12.50,0",
    "0.400,14.25,0",
    "0.600,0.00,1"
  ]);
});

test("each measurement downloads its own pings", async ({ page }) => {
  const older = measurement({ date: Date.now() - 86400000, pings: [{ t: 1, ping: 99, lost: false }] });
  await openWithHistory(page, [measurement(), older]);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".history-download-btn").nth(1).click()
  ]);
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk;
  expect(csv.trim().split("\n")).toEqual(["elapsed_s,ping_ms,failed", "1.000,99.00,0"]);
});

test("a measurement saved without its pings has no download icon, and the share icon stays", async ({ page }) => {
  await openWithHistory(page, [measurement({ pings: [] })]);
  await expect(page.locator(".history-share-btn")).toHaveCount(1);
  await expect(page.locator(".history-download-btn")).toHaveCount(0);
});

test("the text buttons of the CSV are gone from the page and from the open measurement", async ({ page }) => {
  await openWithHistory(page, [measurement()]);
  await expect(page.locator("#downloadCsvBtn")).toHaveCount(0);
  await page.locator(".history-header").first().click();
  await expect(page.locator(".history-details")).toBeVisible();
  await expect(page.locator(".history-csv")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download CSV" })).toHaveCount(1);
});

for (const id of ["material-symbols", "mdi", "tabler", "lucide", "ph"]) {
  test(`${id}: the download icon is drawn`, async ({ page }) => {
    await openWithHistory(page, [measurement()], `?icons=${id}`);
    await expect(page.locator("html")).toHaveAttribute("data-icons", id);
    await expect(page.locator(".history-download-btn svg")).toHaveCount(1);
  });
}
