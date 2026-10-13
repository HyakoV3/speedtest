const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { openBackPanel } = require("./helpers/route-side");

const staticRepositoryUrl = "http://127.0.0.1:18184";
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));
const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };

// A router of the route: "9.9.9.<ttl>", with the network and the country that the test gives it
const hop = (ttl, country, rtt, asn, extra = {}) => ({
  ttl,
  ip: `9.9.9.${ttl}`,
  alt_ips: [],
  rtt_min: rtt,
  rtt_avg: rtt,
  sent: 3,
  answered: 3,
  flags: [],
  scope: "public",
  asn: `AS${asn}`,
  as_name: `Net ${asn}`,
  country,
  continent: "NA",
  country_doubt: false,
  is_target: false,
  ...extra
});
const route = (hops, extra = {}) => ({ ...fixture("normal"), pmtu: null, pmtu_drops: [], hops, ...extra });

// Two routes that cross the sea between Brazil and the United States, and one that crosses the one between Great Britain and the United
// States (all are more than the light in fiber needs for that sea)
const brUs = () => route([hop(1, "US", 1, 11), hop(2, "US", 3, 11), hop(3, "BR", 115, 12), hop(4, "BR", 120, 13)]);
const usBr = () => route([hop(1, "BR", 2, 13), hop(2, "BR", 8, 12), hop(3, "US", 118, 11), hop(4, "US", 120, 11)]);
const gbUs = () => route([hop(1, "GB", 1, 21), hop(2, "GB", 3, 21), hop(3, "US", 95, 22), hop(4, "US", 98, 23)]);
const lan = () => route([hop(1, "DE", 1, 31), hop(2, "DE", 3, 31), hop(3, "NL", 9, 32)]);

async function seas(page, a, b) {
  await page.goto(`${staticRepositoryUrl}/route-better.html`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  // The table of the corridors is loaded by the page when it is needed: here, as the test of the crossings does
  await page.addScriptTag({ url: "/frontend/better/javascript/route-crossings.js" });
  return page.evaluate(
    ([x, y]) => window.LibreSpeedRouteView.compareSeas(x, y, window.LibreSpeedRouteCrossings),
    [a, b]
  );
}

test("compareSeas: the same sea in both directions, whatever the way the route goes", async ({ page }) => {
  expect(await seas(page, brUs(), usBr())).toMatchObject({
    state: "same",
    there: ["BR-US"],
    back: ["BR-US"],
    onlyThere: [],
    onlyBack: []
  });
});

test("compareSeas: a sea that is in only one direction is told, with the one it is in", async ({ page }) => {
  expect(await seas(page, brUs(), gbUs())).toMatchObject({
    state: "different",
    there: ["BR-US"],
    back: ["GB-US"],
    onlyThere: ["BR-US"],
    onlyBack: ["GB-US"]
  });
  // One direction crosses a sea and the other crosses none: that is different too
  expect(await seas(page, brUs(), lan())).toMatchObject({ state: "different", onlyThere: ["BR-US"], onlyBack: [] });
});

test("compareSeas: no sea in either, or one direction missing, is nothing to say", async ({ page }) => {
  expect((await seas(page, lan(), lan())).state).toBe("none");
  expect((await seas(page, brUs(), null)).state).toBe("none");
  expect((await seas(page, null, brUs())).state).toBe("none");
});

// The page: the way from the server is traced, the way back is pasted, and the networks of the pasted one get the countries that the
// test says (the router with the number of a network that is in the United States, 20 and more, is there; the others are in Brazil)
async function openWith(page, there, countryOf) {
  await page.route("**/backend/route.php*", handler => {
    if (handler.request().method() === "POST") return handler.fulfill({ json: there });
    return handler.fulfill({ json: CAPS });
  });
  await page.route("**/backend/route_enrich.php", handler => {
    const body = JSON.parse(handler.request().postData());
    return handler.fulfill({
      json: {
        v: 1,
        hops: body.hops.map(h => {
          const n = Number(h.ip.split(".").pop());
          return {
            ttl: h.ttl,
            asn: `AS${n}`,
            as_name: `Net ${n}`,
            country: countryOf(n),
            country_doubt: false
          };
        }),
        target_as: { asn: "AS15169", as_name: "Google LLC" },
        target_country: "US"
      }
    });
  });
  await page.goto(`${staticRepositoryUrl}/route-better.html`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  await page.locator("#routeStart").click();
  await expect(page.locator("#routeTable tbody tr")).toHaveCount(there.hops.length);
}

test("the comparison on the page says which seas the two directions cross, and that the cable is not known", async ({
  page
}) => {
  await openWith(page, brUs(), n => (n >= 4 ? "US" : "BR"));
  // Nothing about seas while there is only one direction
  await expect(page.locator("#routeCompareSeas")).toBeHidden();
  await openBackPanel(page);
  await page
    .locator("#routeBackText")
    .fill(
      "traceroute to 9.9.9.9 (9.9.9.9), 30 hops max\n 1  9.9.9.1  1 ms\n 2  9.9.9.2  5 ms\n 3  9.9.9.4  118 ms\n 4  9.9.9.9  120 ms"
    );
  await page.locator("#routeBackShow").click();
  await expect(page.locator("#routeCompare")).toBeVisible();
  await expect(page.locator("#routeCompareSeasTitle")).toBeVisible();
  const text = page.locator("#routeCompareSeas");
  await expect(text).toContainText("Both directions cross the same seas: Brazil – United States");
  await expect(text).toContainText("not which cable");
});

test("the seas of the comparison are in the four languages", async ({ page }) => {
  await page.goto(`${staticRepositoryUrl}/route-better.html`);
  const keys = ["title", "same", "diff", "note"].map(k => `route.compare.seas.${k}`);
  for (const language of ["en", "pt", "es", "sv"]) {
    const messages = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "better", "locales", `${language}.json`), "utf8")
    );
    for (const key of keys) expect(messages[key], `${language} ${key}`).toBeTruthy();
    expect(messages["route.compare.seas.same"]).toContain("{list}");
  }
});
