const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { openBackPanel, chooseMethod } = require("./helpers/route-side");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));
const locale = lang =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "better", "locales", `${lang}.json`), "utf8")
  );
const DOWNLOAD = "https://github.com/HyakoV3/librespeed-route/releases";
const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60, cli_url: DOWNLOAD };
const TOOL_KEY = "librespeed-better-route-back-tool";

async function openRoute(page, caps = CAPS) {
  await page.route("**/backend/route.php*", route => {
    if (route.request().method() === "POST") return route.fulfill({ json: fixture("normal") });
    return route.fulfill({ json: caps });
  });
  await page.goto(`${staticRepositoryUrl}/route-better.html`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  await expect(page.locator("#routeSideToggle")).toBeVisible();
}
const link = page => page.locator("#routeBackCliLink");
const steps = page => page.locator("#routeBackTraceHint");

test("L1 the card has no choice of tool: the way to run a command is the one of the system, whatever the server offers", async ({
  page
}) => {
  await openRoute(page);
  await openBackPanel(page);
  await expect(page.locator("#routeBackTool")).toHaveCount(0);
  await expect(page.locator("#routeBackCli")).toHaveCount(0);
  await expect(page.locator("#routeBackCliRun")).toHaveCount(0);
  await expect(page.locator("#routeBackCommand")).toHaveText(/^traceroute|^tracert/);
  await expect(page.locator("#routeBackCommand")).not.toContainText("librespeed-route");
  // The way of the old choice, kept by a visit before, is taken away
  await page.evaluate(key => window.localStorage.setItem(key, "cli"), TOOL_KEY);
  await page.reload();
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await openBackPanel(page);
  expect(await page.evaluate(key => window.localStorage.getItem(key), TOOL_KEY)).toBeNull();
  await expect(page.locator("#routeBackCommand")).toHaveText(/^traceroute|^tracert/);
});

test("L2 the extension says what to install before its button: two steps, with the link from the server, and nothing else once it is here", async ({
  page
}) => {
  await openRoute(page);
  await chooseMethod(page, "extension");
  await expect(steps(page)).toBeVisible();
  await expect(steps(page).locator(".route-label")).toHaveText("To trace from here you need:");
  await expect(steps(page).locator("li")).toHaveCount(2);
  await expect(steps(page).locator("li").nth(0)).toContainText(
    "Install the librespeed-route program and its browser extension."
  );
  await expect(steps(page).locator("li").nth(1)).toContainText("Allow this site");
  // The link is the one that the server gives, opened in another tab, with no way back to this page
  await expect(link(page)).toBeVisible();
  await expect(link(page)).toHaveText("Download for Windows, macOS and Linux");
  await expect(link(page)).toHaveAttribute("href", DOWNLOAD);
  await expect(link(page)).toHaveAttribute("target", "_blank");
  await expect(link(page)).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.locator("#routeBackTraceButton")).toBeDisabled();
  // Once the extension answers there is only the button
  await page.evaluate(() =>
    window.postMessage(
      { source: "librespeed-route-extension", v: 1, type: "state", id: "", state: "ready" },
      window.location.origin
    )
  );
  await expect(page.locator("#routeBackTraceButton")).toBeEnabled();
  await expect(steps(page)).toBeHidden();
  await expect(link(page)).toBeHidden();
  await expect(page.locator("#routeBackExtensionArea p:visible, #routeBackExtensionArea li:visible")).toHaveCount(0);
});

test("L3 without an address from the server, or with one that is not a plain https address, there are the steps and no link", async ({
  page
}) => {
  const bad = [
    undefined,
    null,
    "",
    "http://example.org/x",
    "javascript:alert(1)",
    "https://user@example.org/",
    "https://example.org/?a=b",
    'https://example.org/x"y',
    "https://example.org/x y",
    42,
    ["https://example.org"],
    `https://example.org/${"a".repeat(200)}`
  ];
  for (const value of bad) {
    const context = await page.context().browser().newContext();
    const other = await context.newPage();
    await openRoute(other, { ...CAPS, cli_url: value });
    await chooseMethod(other, "extension");
    await expect(other.locator("#routeBackTraceHint li"), String(value)).toHaveCount(2);
    await expect(other.locator("#routeBackCliLink"), String(value)).toBeHidden();
    await context.close();
  }
  // The page only checks the address: what it keeps is the one it was given, and a plain one is taken
  await openRoute(page);
  const kept = await page.evaluate(() => [
    window.LibreSpeedRouteBack.cliUrl("https://example.org"),
    window.LibreSpeedRouteBack.cliUrl("https://example.org:8443/a/b-c_d.e~f%20g+h"),
    window.LibreSpeedRouteBack.cliUrl("https://example.org/x\n")
  ]);
  expect(kept).toEqual(["https://example.org", "https://example.org:8443/a/b-c_d.e~f%20g+h", null]);
});

test("L4 the steps are in the four languages, and at 360 px they fit", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openRoute(page);
  await chooseMethod(page, "extension");
  for (const lang of ["en", "pt", "es", "sv"]) {
    const texts = locale(lang);
    for (const key of [
      "route.back.setup-title",
      "route.back.setup-install",
      "route.back.setup-allow",
      "route.back.cli-download"
    ])
      expect(texts[key], `${lang} ${key}`).toBeTruthy();
    await page.evaluate(code => window.LibreSpeedI18n.set(code, false), lang);
    await expect(steps(page).locator(".route-label")).toHaveText(texts["route.back.setup-title"]);
    await expect(steps(page).locator("li").nth(0)).toContainText(texts["route.back.setup-install"]);
    await expect(steps(page).locator("li").nth(1)).toContainText(texts["route.back.setup-allow"]);
    await expect(link(page)).toHaveText(texts["route.back.cli-download"]);
    await expect(page.locator("#routeSide")).not.toContainText("route.back.");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      lang
    ).toBe(true);
    const box = await steps(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
  }
  // The words that the extension itself has on its button are the ones that the step says
  expect(locale("pt")["route.back.setup-allow"]).toContain("Permitir este site");
  expect(locale("es")["route.back.setup-allow"]).toContain("Permitir este sitio");
  expect(locale("sv")["route.back.setup-allow"]).toContain("Tillåt den här webbplatsen");
});

test("L5 the pasted line of librespeed-route is read by the page: the internal hops are told as internal, the others have their networks", async ({
  page
}) => {
  await page.route("**/backend/route_enrich.php", route =>
    route.fulfill({
      json: {
        v: 1,
        hops: JSON.parse(route.request().postData()).hops.map(h => ({
          ttl: h.ttl,
          asn: "AS15169",
          as_name: "Google LLC",
          country: "US",
          country_doubt: false
        })),
        target_as: { asn: "AS15169", as_name: "Google LLC" },
        target_country: "US"
      }
    })
  );
  await openRoute(page);
  await openBackPanel(page);
  const line =
    "LSR1!n=0123456789abcdef!f=4!t=8.8.8.8!s=1790000000!a=0.1.0+traceroute!h=1,-p,1.85,3,3;2,-c,5.35,3,3;3,72.14.208.80,18.19,3,3;4,*,0,3,0;5,8.8.8.8,16.36,3,3";
  await page.locator("#routeBackText").fill(line);
  await page.locator("#routeBackShow").click();
  const rows = page.locator("#routeTable tbody tr");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText("internal network");
  await expect(rows.nth(1)).toContainText("internal network");
  await expect(rows.nth(2)).toContainText("72.14.208.80");
  await expect(rows.nth(3)).toContainText("no reply");
  await expect(rows.nth(4)).toContainText("8.8.8.8");
});
