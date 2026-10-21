const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { openBackPanel } = require("./helpers/route-side");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));

const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };

// The networks that the test gives to the routers: by the last number of the address ("9.9.9.<n>" is AS<n>)
const ENRICH = body => ({
  v: 1,
  hops: body.hops.map(hop => ({
    ttl: hop.ttl,
    asn: `AS${hop.ip.split(".").pop()}`,
    as_name: `Net ${hop.ip.split(".").pop()}`,
    country: "BR",
    country_doubt: false
  })),
  target_as: { asn: "AS9", as_name: "Net 9" },
  target_country: "US"
});

const hop = (ttl, asn, extra = {}) => ({
  ttl,
  ip: `9.9.9.${asn || ttl}`,
  alt_ips: [],
  rtt_min: ttl,
  rtt_avg: ttl,
  sent: 3,
  answered: 3,
  flags: [],
  scope: "public",
  asn: asn ? `AS${asn}` : null,
  as_name: asn ? `Net ${asn}` : null,
  country: "BR",
  country_doubt: false,
  is_target: false,
  ...extra
});
const internal = ttl => hop(ttl, null, { scope: "private", ip: `192.168.0.${ttl}` });
const route = (hops, family = 4) => ({ v: 1, family, hops });

async function openRoute(page, post) {
  await page.route("**/backend/route.php*", route => {
    if (route.request().method() === "POST") return route.fulfill({ json: post });
    return route.fulfill({ json: CAPS });
  });
  await page.route("**/backend/route_enrich.php", route =>
    route.fulfill({ json: ENRICH(JSON.parse(route.request().postData())) })
  );
  await page.goto(`${staticRepositoryUrl}/route-better.html`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
}

const view = (page, name, ...args) => page.evaluate(([n, a]) => window.LibreSpeedRouteView[n](...a), [name, args]);

test("networkLetters: the way from the server first, then the networks only of the way back, and the same in both", async ({
  page
}) => {
  await openRoute(page, fixture("normal"));
  const there = route([hop(1, 1), hop(2, 2), hop(3, 3)]);
  const back = route([hop(1, 3), hop(2, 9), hop(3, 1)]);
  expect(await view(page, "networkLetters", there, back)).toEqual({ AS1: "A", AS2: "B", AS3: "C", AS9: "D" });
  // The letters of the way from the server do not depend on the way back
  expect(await view(page, "networkLetters", there, route([hop(1, 7)]))).toEqual({
    AS1: "A",
    AS2: "B",
    AS3: "C",
    AS7: "D"
  });
  // An internal network and a router with no network have no letter; the end of the route is a network like the others
  const mixed = route([internal(1), hop(2, null), hop(3, 4), hop(4, 5, { is_target: true })]);
  expect(await view(page, "networkLetters", mixed, null)).toEqual({ AS4: "A", AS5: "B" });
  // After Z comes AA
  const many = route(Array.from({ length: 28 }, (_, index) => hop(index + 1, 100 + index)));
  const letters = await view(page, "networkLetters", many, null);
  expect(letters.AS125).toBe("Z");
  expect(letters.AS126).toBe("AA");
  expect(letters.AS127).toBe("AB");
});

const there = () => ({
  ...fixture("normal"),
  hops: [internal(1), hop(2, 12), hop(3, 13), hop(4, 14), hop(5, 15, { is_target: true })]
});
const texts = (page, selector) => page.locator(selector).allTextContents();

test("one direction: the networks are told by letters, in the lists, the table and the map, and there are no numbers", async ({
  page
}) => {
  await openRoute(page, there());
  await page.locator("#routeStart").click();
  await expect(page.locator("#routeTable tbody tr")).toHaveCount(5);
  // The list of the networks: a dot for the internal network, then A, B, C and D (the end of the route is a network too)
  expect(await texts(page, "#routeGroups li .route-letter")).toEqual(["\u2022", "A", "B", "C", "D"]);
  await expect(page.locator("#routeGroups li")).toHaveCount(5);
  // No number from the list: the marker of the list is off
  expect(
    await page
      .locator("#routeGroups li")
      .first()
      .evaluate(item => getComputedStyle(item).listStyleType)
  ).toBe("none");
  // The table: the letter in the cell of the network of each hop (the number of the first column is the hop, not a network)
  expect(await texts(page, "#routeTable td.route-network .route-letter")).toEqual(["A", "B", "C", "D"]);
  // The map: the circles say the letter
  await page.locator('#routeViews [data-view="map"]').click();
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  const circles = await texts(page, "#routeMapHost .route-map-node text");
  expect(circles.length).toBeGreaterThan(0);
  circles.forEach(text => expect(text).toMatch(/^[A-Z\u2022?]+$/));
  expect(circles).toContain("A");
  // Nothing to compare with one direction: no note about the letters
  await expect(page.locator("#routeCompareLetters")).toBeHidden();
});

test("two directions: the same network has the same letter in the comparison, the lists, the table and the map", async ({
  page
}) => {
  await openRoute(page, there());
  await page.locator("#routeStart").click();
  await expect(page.locator("#routeTable tbody tr")).toHaveCount(5);
  await openBackPanel(page);
  await page
    .locator("#routeBackText")
    .fill(
      "traceroute to 9.9.9.9 (9.9.9.9), 30 hops max\n 1  9.9.9.14  1 ms\n 2  9.9.9.99  2 ms\n 3  9.9.9.12  3 ms\n 4  9.9.9.9  4 ms"
    );
  await page.locator("#routeBackShow").click();
  await expect(page.locator("#routeCompare")).toBeVisible();

  // The comparison: the letters of the way from the server first (12 is A, 13 B, 14 C, 15 D), then the ones only of the way back (99 is E)
  const columns = page.locator("#routeCompareLists > div");
  const letterOfItem = (column, text) =>
    column.locator("li", { hasText: text }).locator(".route-letter").first().textContent();
  expect(await letterOfItem(columns.nth(0), "AS12")).toBe("A");
  expect(await letterOfItem(columns.nth(1), "AS12")).toBe("A");
  expect(await letterOfItem(columns.nth(0), "AS14")).toBe("C");
  expect(await letterOfItem(columns.nth(1), "AS14")).toBe("C");
  expect(await letterOfItem(columns.nth(1), "AS99")).toBe("E");
  await expect(page.locator("#routeCompareLetters")).toBeVisible();
  expect(
    await columns
      .nth(0)
      .locator("li")
      .first()
      .evaluate(item => getComputedStyle(item).listStyleType)
  ).toBe("none");

  // The lists of the networks of both directions: AS14 is in both, with the same letter
  await expect(page.locator("#routeGroups li").filter({ hasText: "AS14" }).locator(".route-letter")).toHaveText([
    "C",
    "C"
  ]);
  // The table is the one of the way back: its networks have the letters of the two directions
  const tableLetters = await texts(page, "#routeTable td.route-network .route-letter");
  expect(tableLetters).toEqual(["C", "E", "A", "F"]);

  // The map: the circles of the way that is shown, and a hollow point, with its letter, for each network that is only in the other one
  await page.locator('#routeViews [data-view="map"]').click();
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  const circles = await texts(page, "#routeMapHost .route-map-node text");
  expect(circles).toEqual(expect.arrayContaining(["C", "E", "A"]));
  circles.forEach(text => expect(text).toMatch(/^[A-Z\u2022?]+$/));
  const hollow = await texts(page, "#routeMapHost .route-map-dot-group text");
  expect(hollow).toEqual(expect.arrayContaining(["B", "D"]));
});
