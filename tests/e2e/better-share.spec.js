const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
const SETS = ["material-symbols", "mdi", "tabler", "lucide", "ph"];

// A speed test page whose history has a result with an id, as a server with telemetry gives it
async function openShare(page, query = "") {
  await page.addInitScript(() => {
    window.localStorage.setItem("librespeed-better-consent", String(Date.now()));
    window.localStorage.setItem(
      "librespeed-better-history",
      JSON.stringify([
        { date: Date.now(), dl: 250, ul: 100, ping: 8, jitter: 1, ip: "203.0.113.5", conn: "multi", testId: "abc123" }
      ])
    );
  });
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
  await page.route("**/settings.json*", route => route.fulfill({ json: { telemetry_level: "basic" } }));
  await page.route("**/results/**", route => route.fulfill({ contentType: "image/png", body: PNG }));
  await page.goto(`${staticRepositoryUrl}/index-better.html${query}`);
  await page.locator(".history-share-btn").first().click();
  await expect(page.locator("#shareDialog")).toBeVisible();
}

for (const id of SETS) {
  test(`${id}: the copy buttons are one pill with an icon each, in the line of the close button`, async ({ page }) => {
    await openShare(page, `?icons=${id}`);
    await expect(page.locator("#shareCopy svg")).toHaveCount(1);
    await expect(page.locator("#shareCopyImage svg")).toHaveCount(1);
    const pill = await page.locator("#sharePill").boundingBox();
    const close = await page.locator(".share-bar .privacy-close").boundingBox();
    const link = await page.locator("#shareCopy").boundingBox();
    const image = await page.locator("#shareCopyImage").boundingBox();
    // One pill: the two buttons side by side, the link first, and as tall as the close button
    expect(link.x + link.width).toBeLessThanOrEqual(image.x + 1);
    expect(Math.abs(pill.y - close.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(pill.height - close.height)).toBeLessThanOrEqual(1);
    expect(pill.x + pill.width).toBeLessThan(close.x);
  });
}

test("the buttons have a name for the screen readers, in the language of the page", async ({ page }) => {
  await openShare(page, "?lang=pt");
  await expect(page.getByRole("button", { name: "Copiar link" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copiar imagem" })).toBeVisible();
  await expect(page.locator("#shareCopy")).toHaveAttribute("title", "Copiar link");
});

test("copying the link shows a check mark and tells the result", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: staticRepositoryUrl });
  await openShare(page);
  const before = await page.locator("#shareCopy").innerHTML();
  await page.locator("#shareCopy").click();
  await expect(page.locator("#shareCopy")).toHaveAttribute("title", "Copied!");
  await expect(page.locator("#shareStatus")).toHaveText("Copied!");
  expect(await page.locator("#shareCopy").innerHTML()).not.toBe(before);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("/results/?id=abc123");
});

test("copying the picture puts a PNG on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: staticRepositoryUrl });
  await openShare(page);
  await page.locator("#shareCopyImage").click();
  await expect(page.locator("#shareStatus")).toHaveText("Copied!");
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).map(item => item.types.join(",")));
  expect(types).toEqual(["image/png"]);
});

test("without the icons the buttons keep their text", async ({ page }) => {
  await page.route("**/icons/subset.json", route => route.abort());
  await openShare(page);
  await expect(page.locator("#shareCopy")).toHaveText("Copy link");
  await expect(page.locator("#shareCopyImage")).toHaveText("Copy image");
});

test("a browser without a clipboard shows no pill", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: undefined }));
  await openShare(page);
  await expect(page.locator("#sharePill")).toBeHidden();
  await expect(page.locator(".share-bar .privacy-close")).toBeVisible();
});
