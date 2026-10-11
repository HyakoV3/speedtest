const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));

const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };

// Opens the route page with route.php answered by the test: caps is the answer of ?caps (a status, or a JSON), post is the
// answer of the POST (a function of the request, or a JSON). Every POST is counted in the returned object.
async function openRoute(page, { caps = CAPS, post = fixture("normal"), query = "" } = {}) {
  const seen = { posts: 0, headers: [] };
  await page.route("**/backend/route.php*", route => {
    const request = route.request();
    if (request.method() === "POST") {
      seen.posts += 1;
      seen.headers.push(request.headers()["x-librespeed-route"]);
      if (typeof post === "function") return post(route);
      return route.fulfill({ json: post });
    }
    if (typeof caps === "number") return route.fulfill({ status: caps, json: { v: 1, enabled: false } });
    return route.fulfill({ json: caps });
  });
  await page.goto(`${staticRepositoryUrl}/route-better.html${query}`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  return seen;
}

const start = page => page.locator("#routeStart");
const rows = page => page.locator("#routeTable tbody tr");

async function trace(page) {
  await expect(start(page)).toBeEnabled();
  await start(page).click();
}

test("opening the page only asks what the server can do: no route is traced before the button", async ({ page }) => {
  const seen = await openRoute(page);
  await page.waitForTimeout(1500);
  expect(seen.posts).toBe(0);
  await expect(start(page)).toBeEnabled();
  // The table is there, blank: its heads and no hop
  await expect(page.locator("#routeTable")).toBeVisible();
  await expect(page.locator("#routeTable thead th")).toHaveCount(5);
  await expect(page.locator("#routeTable tbody tr")).toHaveCount(0);
});

test("a server where the route is off says so and the button stays disabled", async ({ page }) => {
  await openRoute(page, { caps: 404 });
  await expect(page.locator("#routeStatus")).toContainText("not available");
  await expect(start(page)).toBeDisabled();
});

test("the hops are drawn: a silent one is told, and the routers of a hop are in its title", async ({ page }) => {
  const data = fixture("normal");
  const seen = await openRoute(page);
  await trace(page);
  await expect(rows(page)).toHaveCount(data.hops.length);
  expect(seen.headers).toEqual(["1"]);
  const silent = page.locator("#routeTable tbody tr.hop-none");
  await expect(silent).toHaveCount(1);
  await expect(silent).toContainText("no reply");
  const ecmp = data.hops.find(hop => hop.alt_ips.length);
  const title = await rows(page)
    .nth(ecmp.ttl - 1)
    .locator("td.route-address")
    .getAttribute("title");
  expect(title).toContain(ecmp.alt_ips[0]);
  // The target is told, and the country is marked as approximate
  // The visitor is the last hop of this route: a span "you" in its address cell
  await expect(page.locator("#routeTable tbody .route-you")).toHaveCount(1);
  await expect(rows(page).last().locator(".route-you")).toHaveCount(1);
  await expect(page.locator("#routeTable tbody tr").last().locator("td.route-country")).toContainText("≈");
});

test("the MTU of the path: where it drops, and a path that does not drop", async ({ page }) => {
  await openRoute(page);
  await trace(page);
  await expect(rows(page).first()).toBeVisible();
  const text = await page.locator("#routeMtu").innerText();
  for (const value of ["1480", "1500", "2", "3"]) expect(text).toContain(value);
  await page.unroute("**/backend/route.php*");

  const second = await page.context().newPage();
  await openRoute(second, { post: fixture("no-drop") });
  await trace(second);
  await expect(rows(second).first()).toBeVisible();
  const plain = await second.locator("#routeMtu").innerText();
  expect(plain).toContain("1500");
  expect(plain).not.toContain("drops");
});

test("an unknown MTU is told as unknown, never as a number", async ({ page }) => {
  const data = { ...fixture("normal"), pmtu: null, pmtu_drops: [] };
  await openRoute(page, { post: data });
  await trace(page);
  await expect(page.locator("#routeMtu")).toContainText("unknown");
});

test("the networks on the way: a hop with no answer inside a network does not split it", async ({ page }) => {
  await openRoute(page);
  await trace(page);
  const items = page.locator("#routeGroups ol li");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("internal network");
  // The hops 11, 12 (no answer) and 13 are the same network
  await expect(items.nth(1)).toContainText("hops 11 to 13");
});

test("the rise of the time is told for the right hops, and a peak that goes away is not chosen", async ({ page }) => {
  await openRoute(page, { post: fixture("jump") });
  await trace(page);
  await expect(page.locator("#routeTable tbody tr.hop-jump")).toHaveCount(1);
  await expect(page.locator("#routeTable tbody tr.hop-jump th")).toHaveText("10");

  // A router that is slow to make its answer shows a peak (here 33 ms at the hop 4) that is gone at the hop 5: not a rise of the path
  const peak = fixture("normal");
  peak.hops[3].rtt_min = 33;
  const second = await page.context().newPage();
  await openRoute(second, { post: peak });
  await trace(second);
  await expect(rows(second).first()).toBeVisible();
  await expect(second.locator("#routeTable tbody tr.hop-jump")).toHaveCount(0);
});

test("a limit: the message says how long to wait, and the button comes back after that time", async ({ page }) => {
  await page.clock.install();
  await openRoute(page, {
    post: route =>
      route.fulfill({ status: 429, json: { error: "rate_client", retry_after: 42 }, headers: { "Retry-After": "42" } })
  });
  await trace(page);
  await expect(page.locator("#routeStatus")).toContainText("42");
  await expect(start(page)).toBeDisabled();
  await page.clock.runFor(43000);
  await expect(start(page)).toBeEnabled();
});

test("a server error and a network failure tell that the route could not be traced, and the button comes back", async ({
  page
}) => {
  await openRoute(page, { post: route => route.fulfill({ status: 500, body: "boom" }) });
  await trace(page);
  await expect(page.locator("#routeStatus")).toContainText("could not be traced");
  await expect(start(page)).toBeEnabled();
  await page.unroute("**/backend/route.php*");

  const second = await page.context().newPage();
  await openRoute(second, { post: route => route.abort() });
  await trace(second);
  await expect(second.locator("#routeStatus")).toContainText("could not be traced");
  await expect(start(second)).toBeEnabled();
});

test("no hops, and an IPv6 visitor, are told in their own messages", async ({ page }) => {
  await openRoute(page, { post: fixture("empty") });
  await trace(page);
  await expect(page.locator("#routeStatus")).toContainText("No router answered");
  await page.unroute("**/backend/route.php*");

  const second = await page.context().newPage();
  await openRoute(second, { post: route => route.fulfill({ status: 422, json: { error: "ipv6" } }) });
  await trace(second);
  await expect(second.locator("#routeStatus")).toContainText("IPv6");
});

test("a network name with HTML in it is shown as text, never run", async ({ page }) => {
  await openRoute(page, { post: fixture("xss") });
  await trace(page);
  await expect(rows(page).first()).toBeVisible();
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
  await expect(page.locator("#routeTable img")).toHaveCount(0);
  await expect(page.locator("#routeTable")).toContainText("<img src=x onerror=window.__x=1>");
});

test("two quick presses make one request", async ({ page }) => {
  const seen = await openRoute(page, {
    post: async route => {
      await new Promise(resolve => setTimeout(resolve, 300));
      await route.fulfill({ json: fixture("normal") });
    }
  });
  await expect(start(page)).toBeEnabled();
  await page.evaluate(() => {
    const button = document.getElementById("routeStart");
    button.click();
    button.click();
  });
  await expect(rows(page).first()).toBeVisible();
  expect(seen.posts).toBe(1);
});

test("every text of the route page is in the four languages, and the page is translated", async ({ page }) => {
  const dir = path.join(__dirname, "..", "..", "frontend", "better", "locales");
  const catalogs = {};
  for (const id of ["en", "pt", "es", "sv"])
    catalogs[id] = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8"));
  const keys = Object.keys(catalogs.en).filter(key => key.startsWith("route.") || key === "privacy.route");
  expect(keys.length).toBeGreaterThan(30);
  for (const id of ["pt", "es", "sv"]) {
    for (const key of keys) {
      expect(catalogs[id][key], `${id} has ${key}`).toBeTruthy();
      // The placeholders are the same in all languages
      expect((catalogs[id][key].match(/\{\w+\}/g) || []).sort(), `${id} ${key}`).toEqual(
        (catalogs.en[key].match(/\{\w+\}/g) || []).sort()
      );
    }
  }
  await openRoute(page, { query: "?lang=pt" });
  await expect(start(page)).toHaveText("Iniciar");
});

test("the dark theme and a narrow screen: nothing runs out of the page", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openRoute(page, { query: "?theme=dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await trace(page);
  await expect(rows(page).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true
  );
});

test("an IPv6 route is drawn like any other: long addresses stay inside the table", async ({ page }) => {
  const data = fixture("v6");
  await page.setViewportSize({ width: 360, height: 740 });
  const seen = await openRoute(page, { caps: { ...CAPS, ipv6: true }, post: data });
  await trace(page);
  await expect(rows(page)).toHaveCount(data.hops.length);
  expect(seen.posts).toBe(1);
  await expect(rows(page).first().locator("td.route-address")).toHaveText("2602:fdb8:131:c001::1");
  // The route of the fixture stops before the target (8 hops asked), so the end says the address did not answer
  // toHaveCount(0) retries and passes by luck: count once, when the table is already there
  expect(await page.locator("#routeTable .route-you").count()).toBe(0);
  await expect(page.locator("#routeEnd")).toContainText("did not answer");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true
  );
});

test("the page asks nothing of other sites and has no script error", async ({ page }) => {
  const errors = [];
  const outside = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (!request.url().startsWith(staticRepositoryUrl) && !request.url().startsWith("data:"))
      outside.push(request.url());
  });
  await openRoute(page);
  await trace(page);
  await expect(rows(page).first()).toBeVisible();
  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});

test("hops with no answer in a row are one line with a vertical ellipsis, and a single one is as it was", async ({
  page
}) => {
  const answered = (ttl, ms) => ({ ...fixture("normal").hops[10], ttl, rtt_min: ms, is_target: false });
  const silent = ttl => ({
    ttl,
    ip: null,
    alt_ips: [],
    rtt_min: null,
    rtt_avg: null,
    sent: 3,
    answered: 0,
    flags: [],
    scope: "none",
    asn: null,
    as_name: null,
    country: null,
    continent: null,
    country_doubt: false,
    is_target: false
  });
  const hops = [
    answered(1, 1),
    silent(2),
    silent(3),
    silent(4),
    answered(5, 9),
    silent(6),
    answered(7, 12),
    silent(8),
    silent(9)
  ];
  await openRoute(page, { post: { ...fixture("normal"), hops, pmtu: null, pmtu_drops: [] } });
  await trace(page);
  // 9 hops are 6 lines: the two runs are one line each, the single hop 6 is still its own line
  await expect(rows(page)).toHaveCount(6);
  const gaps = page.locator("#routeTable tbody tr.hop-gap");
  await expect(gaps).toHaveCount(2);
  // The vertical ellipsis is where the number of the hop is, and the address is still the "*"; the numbers are for the screen readers
  await expect(gaps.nth(0).locator("th .route-gap-mark")).toHaveText("⋮");
  await expect(gaps.nth(0).locator("th .route-visually-hidden")).toHaveText("2–4");
  await expect(gaps.nth(1).locator("th .route-visually-hidden")).toHaveText("8–9");
  await expect(gaps.nth(0).locator("th")).toHaveAttribute("title", "3 hops with no reply");
  await expect(gaps.nth(0).locator(".route-address")).toHaveText("*");
  await expect(gaps.nth(0)).toContainText("no reply");
  const single = page.locator("#routeTable tbody tr.hop-none:not(.hop-gap)");
  await expect(single).toHaveCount(1);
  await expect(single.locator("th")).toHaveText("6");
  await expect(single.locator(".route-address")).toHaveText("*");
  await expect(single.locator(".route-gap-mark")).toHaveCount(0);

  // In the language of the page
  await page.evaluate(() => window.LibreSpeedI18n.set("pt", false));
  await expect(gaps.nth(0).locator("th")).toHaveAttribute("title", "3 saltos sem resposta");
});
