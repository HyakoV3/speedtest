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

test("pathNumbers: the number is the place in the list of networks, not the count of the entries of asPath", async ({
  page
}) => {
  await openRoute(page, fixture("normal"));
  // The internal network is the first of the list: the networks that follow are 2 and 3, and the end of the route is left out
  const first = route([internal(1), hop(2, 5), hop(3, 6), hop(4, 7, { is_target: true })]);
  expect(await view(page, "asPath", first)).toEqual(["AS5", "AS6"]);
  expect(await view(page, "pathNumbers", first)).toEqual([2, 3]);
  // The same network on both sides of another one is two entries and two places
  const again = route([hop(1, 1), hop(2, 2), hop(3, 1), hop(4, 9, { is_target: true })]);
  expect(await view(page, "asPath", again)).toEqual(["AS1", "AS2", "AS1"]);
  expect(await view(page, "pathNumbers", again)).toEqual([1, 2, 3]);
  // An internal router or a router with no network in the middle: asPath joins the two, the list has three places
  const joined = route([hop(1, 1), internal(2), hop(3, 1), hop(4, 9, { is_target: true })]);
  expect(await view(page, "asPath", joined)).toEqual(["AS1"]);
  expect(await view(page, "pathNumbers", joined)).toEqual([1]);
  const unknown = route([hop(1, null), hop(2, 1), hop(3, null), hop(4, 1), hop(5, 9, { is_target: true })]);
  expect(await view(page, "asPath", unknown)).toEqual(["AS1"]);
  expect(await view(page, "pathNumbers", unknown)).toEqual([2]);
  // Silent hops belong to the group that is open: they do not move the numbers
  const silent = route([hop(1, 1), hop(2, null, { scope: "none", rtt_min: null, answered: 0 }), hop(3, 2)]);
  expect(await view(page, "pathNumbers", silent)).toEqual([1, 2]);
  expect(await view(page, "pathNumbers", null)).toEqual([]);
});

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

test("the comparison has the numbers of the list of networks, and the same letter for the same network in both directions", async ({
  page
}) => {
  // The way from the server: an internal router, then 12, 13 and 14, then the visitor (15)
  const there = {
    ...fixture("normal"),
    hops: [internal(1), hop(2, 12), hop(3, 13), hop(4, 14), hop(5, 15, { is_target: true })]
  };
  await openRoute(page, there);
  await page.locator("#routeStart").click();
  await expect(page.locator("#routeTable tbody tr")).toHaveCount(5);
  // With one direction there is nothing to tell apart: no letter
  await expect(page.locator(".route-letter")).toHaveCount(0);
  await expect(page.locator("#routeCompareLetters")).toBeHidden();

  await openBackPanel(page);
  await page
    .locator("#routeBackText")
    .fill(
      "traceroute to 9.9.9.9 (9.9.9.9), 30 hops max\n 1  9.9.9.14  1 ms\n 2  9.9.9.99  2 ms\n 3  9.9.9.12  3 ms\n 4  9.9.9.9  4 ms"
    );
  await page.locator("#routeBackShow").click();
  await expect(page.locator("#routeCompare")).toBeVisible();

  // The numbers of each column are the ones of the list "Networks on the way" of that direction (the internal network is the first)
  const columns = page.locator("#routeCompareLists > div");
  const numbers = column => column.locator("li").evaluateAll(items => items.map(item => item.value));
  expect(await numbers(columns.nth(0))).toEqual([2, 3, 4]);
  expect(await numbers(columns.nth(1))).toEqual([1, 2, 3]);

  // The letters: the way from the server gives A (12), B (13), C (14) and D (15); the way back adds 99 (E) and 9 (F)
  const letterOfItem = (column, text) =>
    column.locator("li", { hasText: text }).locator(".route-letter").first().textContent();
  expect(await letterOfItem(columns.nth(0), "AS12")).toBe("A");
  expect(await letterOfItem(columns.nth(1), "AS12")).toBe("A");
  expect(await letterOfItem(columns.nth(0), "AS14")).toBe("C");
  expect(await letterOfItem(columns.nth(1), "AS14")).toBe("C");
  expect(await letterOfItem(columns.nth(1), "AS99")).toBe("E");
  await expect(page.locator("#routeCompareLetters")).toBeVisible();

  // The list "Networks on the way" (both directions are in it) has the same letters; the internal network has none
  const groups = page.locator("#routeGroups li");
  // AS14 is in the two directions, with the same letter in both
  await expect(groups.filter({ hasText: "AS14" }).locator(".route-letter")).toHaveText(["C", "C"]);
  await expect(groups.filter({ hasText: "AS99" }).locator(".route-letter")).toHaveText("E");
  await expect(groups.filter({ hasText: "internal" }).locator(".route-letter")).toHaveCount(0);
});
