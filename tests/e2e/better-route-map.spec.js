const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));

const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };

const isMapFile = url =>
  url.endsWith("world-110m.js") || url.endsWith("route-map.js") || url.endsWith("route-crossings.js");

// A public hop of a route made by the test
const hop = (ttl, country, extra = {}) => ({
  ttl,
  ip: `198.51.100.${ttl}`,
  alt_ips: [],
  rtt_min: ttl * 10,
  rtt_avg: ttl * 10,
  sent: 3,
  answered: 3,
  flags: [],
  scope: "public",
  asn: `AS${64500 + ttl}`,
  as_name: `Test Net ${ttl}`,
  country,
  continent: "NA",
  country_doubt: false,
  is_target: false,
  ...extra
});

const px = (map, a, b) => Math.hypot(a.x - b.x, a.y - b.y) / (map.frame[2] / map.width);
const node = (map, n) => map.nodes.find(item => item.n === n);

const route = (hops, extra = {}) => ({ ...fixture("normal"), pmtu: null, pmtu_drops: [], hops, ...extra });

// Opens the route page with route.php answered by the test. The requests for the files of the map are counted in seen.map and
// the ones for the chart in seen.chart
async function openRoute(page, { post = fixture("normal"), query = "" } = {}) {
  const seen = { map: [], chart: [] };
  page.on("request", request => {
    const url = request.url();
    if (isMapFile(url)) seen.map.push(url.split("/").pop());
    if (url.endsWith("uPlot.iife.min.js")) seen.chart.push("uPlot.iife.min.js");
  });
  await page.route("**/backend/route.php*", handler => {
    if (handler.request().method() === "POST") return handler.fulfill({ json: post });
    return handler.fulfill({ json: CAPS });
  });
  await page.goto(`${staticRepositoryUrl}/route-better.html${query}`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  return seen;
}

const start = page => page.locator("#routeStart");
const views = page => page.locator("#routeViews");
const button = (page, view) => page.locator(`#routeViews [data-view="${view}"]`);
const info = page => page.evaluate(() => window.LibreSpeedRouteMap.info());

// The whole world in the shape of the host: the whole width and the height of the frame of a route, centred on the world
const expectWorld = map => {
  const height = 360 / map.aspect;
  [0, (142 - height) / 2, 360, height].forEach((value, i) => expect(map.frame[i]).toBeCloseTo(value, 1));
};
const legs = page => page.locator("#routeMapHost path.route-map-leg");

async function trace(page) {
  await expect(start(page)).toBeEnabled();
  await start(page).click();
  await expect(views(page)).toBeVisible();
}

async function openMap(page) {
  await button(page, "map").click();
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
}

test("the table is the default and nothing of the map is asked before it is chosen", async ({ page }) => {
  const seen = await openRoute(page);
  await trace(page);
  await expect(button(page, "table")).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, "map")).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(1500);
  expect(seen.map).toEqual([]);
});

test("choosing the map asks for its files once; the chart and the map are loaded apart", async ({ page }) => {
  const seen = await openRoute(page);
  await trace(page);
  await openMap(page);
  expect(seen.map.sort()).toEqual(["route-crossings.js", "route-map.js", "world-110m.js"]);
  await expect(page.locator("#routeTableWrap")).toBeHidden();
  await expect(page.locator("#routeChart")).toBeHidden();
  expect(seen.chart).toEqual([]);

  await button(page, "chart").click();
  await expect(page.locator("#routeChartHost canvas")).toBeVisible();
  expect(seen.chart).toEqual(["uPlot.iife.min.js"]);
  await openMap(page);
  await button(page, "table").click();
  await expect(page.locator("#routeTableWrap")).toBeVisible();
  expect(seen.map).toHaveLength(3);
});

test("mapData: the stops, the path and the visitor of every fixture, and of some routes made by the test", async ({
  page
}) => {
  await openRoute(page);
  const data = value => page.evaluate(d => window.LibreSpeedRouteView.mapData(d), value);
  const codes = list => list.map(item => item.code);

  const normal = await data(fixture("normal"));
  expect(normal.stops.map(s => `${s.code}${s.hops}${s.doubt ? "d" : ""}`)).toEqual(["BR11", "US13d"]);
  expect(normal.line).toEqual([1, 2]);
  expect(normal.you).toBe("US");
  expect(normal.countries.find(c => c.code === "US")).toMatchObject({ doubt: true, you: true });
  expect(normal.tail).toBe(false);
  expect(await data(fixture("jump"))).toMatchObject({ line: [1, 2], you: "US" });

  const noDrop = await data(fixture("no-drop"));
  expect(noDrop.stops.map(s => `${s.code}${s.hops}${s.doubt ? "d" : ""}`)).toEqual(["BR10,11", "AU12d"]);
  expect(noDrop).toMatchObject({ line: [1, 2, 3], you: "AU" });

  const v6 = await data(fixture("v6"));
  expect(v6.line).toEqual([1, 2, 3, 4]);
  expect(codes(v6.countries)).toEqual(["US", "CA"]);
  expect(v6.countries[0].hops).toHaveLength(7);
  expect(v6.you).toBe("US");
  expect((await data({ ...fixture("v6"), target_country: null })).you).toBeNull();

  const tail = fixture("silent-tail");
  expect(await data(tail)).toMatchObject({ stops: [], line: [] });
  expect((await data({ ...tail, target_country: "BR" })).countries).toEqual([
    { code: "BR", hops: [], doubt: false, you: true }
  ]);
  expect((await data({ ...tail, target_country: null })).countries).toEqual([]);

  const empty = await data(fixture("empty"));
  expect(empty).toMatchObject({ stops: [], countries: [], nodes: [], line: [], you: null, tail: false });

  const frigga = [hop(1, "US"), hop(5, "BR"), hop(6, "BR"), hop(7, "BR")];
  expect(await data(route(frigga, { target_reached: false, target_country: "PT" }))).toMatchObject({
    line: [1, 2, 3, 4],
    tail: true
  });
  expect(await data(route(frigga, { target_reached: false, target_country: "BR" }))).toMatchObject({
    line: [1, 2, 3, 4],
    tail: false
  });
  expect((await data(route([hop(1, "DE"), hop(2, "SG", { country_doubt: true }), hop(3, "DE")]))).line).toEqual([1, 3]);

  // What is not two capital letters is not a country
  const junk = [hop(1, "-99"), hop(2, "br"), hop(3, "<img src=x>"), hop(4, null)];
  expect(await data(route(junk, { target_country: '"><svg>' }))).toMatchObject({ stops: [], countries: [], you: null });
});

test("the data of the map: 176 shapes, no Antarctica, the small countries as spots", async ({ page }) => {
  await openRoute(page);
  await trace(page);
  await openMap(page);
  const world = await page.evaluate(() => ({
    shapes: window.LibreSpeedWorld.shapes.length,
    codes: window.LibreSpeedWorld.shapes.map(s => s[0]),
    centers: Object.keys(window.LibreSpeedWorld.centers),
    points: Object.keys(window.LibreSpeedWorld.points),
    badPath: window.LibreSpeedWorld.shapes.filter(s => !/^M[-0-9.Mlz ]+$/.test(s[1])).length,
    height: window.LibreSpeedWorld.height
  }));
  expect(world.shapes).toBe(176);
  expect(world.height).toBe(142);
  expect(world.codes).not.toContain("AQ");
  expect(world.centers).toEqual(expect.arrayContaining(["BR", "US", "FR", "NO", "TW", "XK"]));
  expect(world.points).toEqual(expect.arrayContaining(["SG", "HK", "MT", "BH", "RE", "GF"]));
  expect(world.badPath).toBe(0);
});

test("a route with a country that is unlikely: it is hatched, listed as unlikely, and the line leaves it out", async ({
  page
}) => {
  await openRoute(page, { query: "?routeview=map" });
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  expect((await info(page)).painted).toEqual({ BR: "on", US: "doubt" });
  const unlikely = await info(page);
  expect(unlikely.legs).toEqual([{ from: 1, to: 2, kind: "near", wrap: false }]);
  expect(unlikely.nodes.map(item => item.code)).toEqual(["BR", "BR"]);
  expect(node(unlikely, 1).kind).toBe("borrowed");
  await expect(page.locator('#routeMapHost path[data-code="BR"]')).toHaveClass(/route-map-on/);
  await expect(page.locator('#routeMapHost path[data-code="US"]')).toHaveClass(/route-map-doubt/);
});

test("a route that goes and comes back: two curves, and a frame that fits the countries", async ({ page }) => {
  await openRoute(page, { post: fixture("v6"), query: "?routeview=map" });
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  const map = await info(page);
  expect(map.legs).toEqual([
    { from: 1, to: 2, kind: "path", wrap: false },
    { from: 2, to: 3, kind: "path", wrap: false },
    { from: 3, to: 4, kind: "near", wrap: false }
  ]);
  await expect(legs(page)).toHaveCount(3);
  expect(map.frame[2]).toBeLessThan(360);
});

test("a route across the date line: the line leaves by one side and comes in by the other, on the whole world", async ({
  page
}) => {
  await openRoute(page, {
    post: route([hop(1, "JP"), hop(2, "JP"), hop(3, "US"), hop(4, "US")]),
    query: "?routeview=map"
  });
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  const map = await info(page);
  expect(map.legs).toEqual([
    { from: 1, to: 2, kind: "near", wrap: false },
    { from: 2, to: 3, kind: "path", wrap: true },
    { from: 3, to: 4, kind: "near", wrap: false }
  ]);
  // Two straight pieces inside the countries, and the curve that goes round the date line in two parts
  await expect(legs(page)).toHaveCount(4);
  expectWorld(map);
});

test("a route that did not reach the visitor: a dotted line goes on to the country of the visitor", async ({
  page
}) => {
  const post = route([hop(1, "US"), hop(5, "BR"), hop(6, "BR"), hop(7, "BR")], {
    target_reached: false,
    target_country: "PT"
  });
  await openRoute(page, { post, query: "?routeview=map" });
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  const map = await info(page);
  expect(map.legs[map.legs.length - 1]).toEqual({ from: 4, to: "you", kind: "tail", wrap: false });
  await expect(page.locator("#routeMapHost path.route-map-leg-tail")).toHaveCount(1);
});

test("a country with no shape is a spot, and one that is not on the map is told, without an error", async ({
  page
}) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await openRoute(page, {
    post: route([hop(1, "SG")], { target_country: "SG", target_reached: true }),
    query: "?routeview=map"
  });
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  expect((await info(page)).unplaced).toEqual([]);
  await expect(page.locator("#routeMapHost circle.route-map-spot")).toHaveCount(1);

  const second = await page.context().newPage();
  second.on("pageerror", error => errors.push(error.message));
  await openRoute(second, {
    post: route([hop(1, "AC")], { target_country: "AC", target_reached: true }),
    query: "?routeview=map"
  });
  await trace(second);
  await expect(second.locator("#routeMapHost svg")).toBeVisible();
  expect((await info(second)).unplaced).toEqual(["AC"]);
  expect(errors).toEqual([]);
});

test("a route with no country says so, and the visitor alone is a ring on its country", async ({ page }) => {
  await openRoute(page, { post: { ...fixture("silent-tail"), target_country: null }, query: "?routeview=map" });
  await trace(page);
  await expect(page.locator("#routeMapNone")).toBeVisible();
  await expect(page.locator("#routeMapHost")).toBeHidden();

  const second = await page.context().newPage();
  await openRoute(second, { post: { ...fixture("silent-tail"), target_country: "BR" }, query: "?routeview=map" });
  await trace(second);
  await expect(second.locator("#routeMapHost svg")).toBeVisible();
  await expect(second.locator('#routeMapHost path[data-code="BR"]')).toHaveClass(/route-map-on/);
  await expect(second.locator("#routeMapHost circle.route-map-you")).toHaveCount(1);
});

test("the theme and the contrast change the colors with no redrawing: the CSS does it", async ({ page }) => {
  await openRoute(page, { query: "?routeview=map&theme=light" });
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  const fill = () => page.locator('#routeMapHost path[data-code="BR"]').evaluate(node => getComputedStyle(node).fill);
  const before = { builds: (await info(page)).builds, fill: await fill() };

  await page.evaluate(() => window.LibreSpeedTheme.set("dark", false));
  await expect.poll(fill).not.toBe(before.fill);
  const dark = await fill();
  expect((await info(page)).builds).toBe(before.builds);

  await page.evaluate(() => {
    const toggle = document.createElement("button");
    toggle.setAttribute("data-contrast-toggle", "");
    document.body.appendChild(toggle);
    toggle.click();
    toggle.remove();
  });
  await expect.poll(fill).not.toBe(dark);
  expect((await info(page)).builds).toBe(before.builds);
});

test("the language: the button changes with it", async ({ page }) => {
  await openRoute(page, { query: "?routeview=map" });
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  await page.evaluate(() => window.LibreSpeedI18n.set("pt", false));
  await expect(button(page, "map")).toHaveText("Mapa");
});

test("a narrow screen, dark theme: the map fits, and follows the window", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openRoute(page, { query: "?theme=dark&routeview=map" });
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true
  );
  const narrow = await info(page);
  const hostWidth = await page.locator("#routeMapHost").evaluate(element => element.clientWidth);
  expect(narrow.width).toBeLessThanOrEqual(hostWidth);

  await page.setViewportSize({ width: 1000, height: 740 });
  await expect.poll(async () => (await info(page)).width).toBeGreaterThan(narrow.width);
  expect((await info(page)).builds).toBeGreaterThan(narrow.builds);
});

test("a map that cannot be loaded is told, the table stays, and choosing it again tries again", async ({ page }) => {
  await openRoute(page);
  await page.route("**/world-110m.js", handler => handler.abort());
  await trace(page);
  await button(page, "map").click();
  await expect(page.locator("#routeStatus")).toContainText("could not be loaded");
  await expect(button(page, "table")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#routeTableWrap")).toBeVisible();

  await page.unroute("**/world-110m.js");
  await openMap(page);
});

test("the choice is kept, and the address wins over it", async ({ page }) => {
  await openRoute(page);
  await trace(page);
  await openMap(page);
  await page.reload();
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();

  await page.goto(`${staticRepositoryUrl}/route-better.html?routeview=table`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  await trace(page);
  await expect(page.locator("#routeTableWrap")).toBeVisible();
  await expect(page.locator("#routeMap")).toBeHidden();
});

test("a country that is not a country is never run: no HTML gets into the map", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const hostile = route(
    [hop(1, "<img src=x onerror=window.__x=1>", { as_name: "<img src=x onerror=window.__x=1>" }), hop(2, "BR")],
    {
      target_country: '"><svg onload=window.__x=1>',
      target_reached: false
    }
  );
  await openRoute(page, { post: hostile, query: "?routeview=map" });
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  await expect(page.locator("#routeMapHost [data-code]")).toHaveCount(1);
  await expect(page.locator('#routeMapHost [data-code="BR"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
  await expect(page.locator("#routeMap img")).toHaveCount(0);
  // What is written on the map is only the letters of the networks; the first hop has a junk country, so it is drawn with the BR of the second
  const texts = await page.locator("#routeMapHost text").allTextContents();
  expect(texts.length).toBeGreaterThan(0);
  texts.forEach(text => expect(text).toMatch(/^[A-Z\u2022?]+$/));
  expect(node(await info(page), 1).kind).toBe("borrowed");
  await button(page, "table").click();
  await expect(page.locator("#routeTable")).toContainText("<img src=x onerror=window.__x=1>");
  await expect(page.locator("#routeTable img")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the route of the example: four networks, two countries, the visitor ringed on the last network", async ({
  page
}) => {
  const asn = (ttl, country, number, name, extra = {}) =>
    hop(ttl, country, { asn: `AS${number}`, as_name: name, ...extra });
  const hops = [
    asn(1, "US", 394151, "Whatbox Inc."),
    asn(2, "US", 394151, "Whatbox Inc."),
    asn(3, "US", 394151, "Whatbox Inc."),
    asn(4, "US", 394151, "Whatbox Inc."),
    asn(5, "BR", 174, "Cogent Communications, LLC"),
    asn(6, "BR", 174, "Cogent Communications, LLC"),
    asn(7, "BR", 13786, "Seabras 1 USA, LLC"),
    asn(8, "BR", 13786, "Seabras 1 USA, LLC"),
    { ...hop(9, null), scope: "private", asn: null, as_name: null },
    { ...hop(10, null), scope: "private", asn: null, as_name: null },
    { ...hop(11, null), scope: "private", asn: null, as_name: null },
    { ...hop(12, null), scope: "private", asn: null, as_name: null }
  ];
  await openRoute(page, {
    post: route(hops, { target_reached: false, target_country: "BR" }),
    query: "?routeview=map"
  });
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  await expect(page.locator("#routeGroups ol li")).toHaveCount(4);
  expect(await page.locator("#routeMapHost text").allTextContents()).toEqual(["A", "B", "C", "\u2022"]);
  const map = await info(page);
  expect(map.nodes.map(item => `${item.n}:${item.code}:${item.kind}`)).toEqual([
    "1:US:firm",
    "2:BR:firm",
    "3:BR:firm",
    "4:BR:borrowed"
  ]);
  await expect(page.locator("#routeMapHost g.route-map-node-borrowed")).toHaveCount(1);
  expect(map.legs).toEqual([
    { from: 1, to: 2, kind: "cross", wrap: false, via: ["us-east", "br-northeast"] },
    { from: 2, to: 3, kind: "near", wrap: false },
    { from: 3, to: 4, kind: "near", wrap: false }
  ]);
  expect(map.ring).toBe(4);
  // The line of Brazil goes the way of the route, from the United States to the south east
  expect(node(map, 2).y).toBeLessThan(node(map, 3).y);
  expect(node(map, 3).y).toBeLessThan(node(map, 4).y);

  // The visitor in another country than the last network: a dotted piece goes to the middle of its country
  const second = await page.context().newPage();
  await openRoute(second, {
    post: route(hops, { target_reached: false, target_country: "PT" }),
    query: "?routeview=map"
  });
  await trace(second);
  await expect(second.locator("#routeMapHost svg")).toBeVisible();
  const far = await info(second);
  expect(far.legs[far.legs.length - 1]).toMatchObject({ from: 4, to: "you", kind: "tail" });
  expect(far.ring).toBe("center");
});

test("the points are never nearer than the circles at 360 px, and the same route is drawn the same way", async ({
  page
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const europe = ["DE", "NL", "BE", "LU", "FR", "CH"].map((country, i) => hop(i + 1, country));
  await openRoute(page, {
    post: route(europe, { target_country: "CH", target_reached: true }),
    query: "?routeview=map"
  });
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  const narrow = await info(page);
  expect(narrow.frame[2]).toBeLessThan(45);
  for (let i = 0; i < narrow.nodes.length; i++)
    for (let j = i + 1; j < narrow.nodes.length; j++)
      expect(px(narrow, narrow.nodes[i], narrow.nodes[j])).toBeGreaterThanOrEqual(19.5);

  await page.setViewportSize({ width: 1000, height: 740 });
  await expect.poll(async () => (await info(page)).width).toBeGreaterThan(narrow.width);
  await page.setViewportSize({ width: 360, height: 740 });
  await expect.poll(async () => (await info(page)).width).toBe(narrow.width);
  expect((await info(page)).nodes).toEqual(narrow.nodes);

  // Three networks in a country with no shape (a spot): they keep apart too, with no script error
  const errors = [];
  const second = await page.context().newPage();
  second.on("pageerror", error => errors.push(error.message));
  await second.setViewportSize({ width: 360, height: 740 });
  await openRoute(second, {
    post: route([hop(1, "SG"), hop(2, "SG"), hop(3, "SG")], { target_country: "SG", target_reached: true }),
    query: "?routeview=map"
  });
  await trace(second);
  await expect(second.locator("#routeMapHost svg")).toBeVisible();
  const spot = await info(second);
  for (let i = 0; i < spot.nodes.length; i++)
    for (let j = i + 1; j < spot.nodes.length; j++)
      expect(px(spot, spot.nodes[i], spot.nodes[j])).toBeGreaterThanOrEqual(19.5);
  expect(errors).toEqual([]);
});

test("a country that comes back: its networks are on one line, in order, and the pieces between countries are curves", async ({
  page
}) => {
  const hops = ["US", "US", "CA", "CA", "US", "US"].map((country, i) => hop(i + 1, country));
  await openRoute(page, { post: route(hops, { target_country: "US", target_reached: true }), query: "?routeview=map" });
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  const map = await info(page);
  const [n1, n2, n5, n6] = [1, 2, 5, 6].map(n => node(map, n));
  expect(n1.x).toBeLessThan(n2.x);
  expect(n2.x).toBeLessThan(n5.x);
  expect(n5.x).toBeLessThan(n6.x);
  [n2, n5, n6].forEach(item => expect(Math.abs(item.y - n1.y)).toBeLessThan(0.01));
  expect(px(map, n2, n5)).toBeGreaterThan(19.5);
  expect(px(map, n2, n5)).toBeLessThan(20.5);
  expect(map.legs.map(leg => `${leg.from}>${leg.to}:${leg.kind}`)).toEqual([
    "1>2:near",
    "2>3:path",
    "3>4:near",
    "4>5:path",
    "5>6:near"
  ]);
});

test("a country that is unlikely in the middle: its network has a mark of its own and the line goes past it", async ({
  page
}) => {
  const hops = [hop(1, "DE"), hop(2, "SG", { country_doubt: true }), hop(3, "NL")];
  await openRoute(page, { post: route(hops, { target_country: "NL", target_reached: true }), query: "?routeview=map" });
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  const map = await info(page);
  expect(map.legs).toEqual([{ from: 1, to: 3, kind: "path", wrap: false }]);
  await expect(page.locator("#routeMapHost g.route-map-node-doubt")).toHaveCount(1);
  await expect(page.locator('#routeMapHost path[data-code="SG"]')).toHaveCount(0);
  await expect(page.locator("#routeMapHost circle.route-map-spot-doubt")).toHaveCount(1);
});

test("mapData of the networks with no country: they borrow from the firm network before them, never from a doubtful one or from the visitor", async ({
  page
}) => {
  await openRoute(page);
  const data = value => page.evaluate(d => window.LibreSpeedRouteView.mapData(d), value);
  const nodes = result =>
    result.nodes.map(
      item => `${item.n}:${item.kind}:${item.country}${item.borrowed ? "b" : ""}${item.doubt ? "d" : ""}`
    );
  const same = (ttl, country, extra = {}) => hop(ttl, country, { asn: "AS1", as_name: "One", ...extra });
  const inside = ttl => ({ ...hop(ttl, null), scope: "private", asn: null, as_name: null });
  const silent = ttl => ({
    ...hop(ttl, null),
    scope: "none",
    ip: null,
    rtt_min: null,
    answered: 0,
    asn: null,
    as_name: null
  });

  const doubtful = await data(route([hop(1, "DE"), hop(2, "SG", { country_doubt: true }), hop(3, "NL")]));
  expect(nodes(doubtful)).toEqual(["1:as:DE", "2:as:SGd", "3:as:NL"]);
  expect(doubtful.line).toEqual([1, 3]);

  // The firm country wins over a doubtful one that has more hops
  const mixed = await data(
    route([same(1, "DE"), same(2, "SG", { country_doubt: true }), same(3, "SG", { country_doubt: true })])
  );
  expect(nodes(mixed)).toEqual(["1:as:DE"]);

  // A network with no country does not borrow from a doubtful network
  const afterDoubt = await data(route([hop(1, "DE"), hop(2, "SG", { asn: "AS2", country_doubt: true }), inside(3)]));
  expect(nodes(afterDoubt)).toEqual(["1:as:DE", "2:as:SGd", "3:internal:DEb"]);
  expect(afterDoubt.line).toEqual([1, 3]);

  // Nothing firm to borrow from, and the visitor is not a lender
  const alone = await data(route([inside(1), inside(2), silent(3)], { target_country: "BR" }));
  expect(nodes(alone)).toEqual(["1:internal:null"]);
  expect(alone.line).toEqual([]);

  // A network that goes through two countries has its number where it hands the route on (the last one), however many hops each has
  expect(nodes(await data(route([same(1, "US"), same(2, "US"), same(3, "BR"), same(4, "BR")])))).toEqual(["1:as:BR"]);
  expect(nodes(await data(route([same(1, "US"), same(2, "BR"), same(3, "BR"), same(4, "BR")])))).toEqual(["1:as:BR"]);
  expect((await data(route([same(1, "US"), same(2, "US"), same(3, "BR")]))).nodes[0].via).toEqual(["US", "BR"]);

  // Public hops with no AS and no country, then a network: the first borrows from the one after it
  const unknown = await data(route([{ ...hop(1, null), asn: null, as_name: null }, hop(2, "BR")]));
  expect(nodes(unknown)).toEqual(["1:unknown:BRb", "2:as:BR"]);

  // The internal network in the middle is drawn with the one before it
  const middle = await data(route([hop(1, "US"), inside(2), inside(3), hop(4, "BR")]));
  expect(nodes(middle)).toEqual(["1:as:US", "2:internal:USb", "3:as:BR"]);
});

test("the whole flow asks nothing of other sites and has no script error", async ({ page }) => {
  const errors = [];
  const outside = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (!request.url().startsWith(staticRepositoryUrl) && !request.url().startsWith("data:"))
      outside.push(request.url());
  });
  await openRoute(page);
  await trace(page);
  await openMap(page);
  await button(page, "chart").click();
  await expect(page.locator("#routeChartHost canvas")).toBeVisible();
  await openMap(page);
  await page.evaluate(() => window.LibreSpeedTheme.set("dark", false));
  await button(page, "table").click();
  await expect(page.locator("#routeTableWrap")).toBeVisible();
  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});

// The route of the Heimdall demo: Hetzner goes through Finland and then Germany, and the line must too (n countries, n - 1 pieces)
const heimdall = (germanyFirst = false) => {
  const net = (ttl, country, number, name) => hop(ttl, country, { asn: `AS${number}`, as_name: name });
  const silent = ttl => ({
    ...hop(ttl, null),
    scope: "none",
    ip: null,
    rtt_min: null,
    answered: 0,
    asn: null,
    as_name: null
  });
  const internal = ttl => ({ ...hop(ttl, null), scope: "private", asn: null, as_name: null });
  const first = germanyFirst ? "DE" : "FI";
  const second = germanyFirst ? "FI" : "DE";
  return [
    internal(1),
    internal(2),
    net(3, first, 24940, "Hetzner Online GmbH"),
    silent(4),
    silent(5),
    net(6, first, 24940, "Hetzner Online GmbH"),
    net(7, first, 24940, "Hetzner Online GmbH"),
    net(8, second, 24940, "Hetzner Online GmbH"),
    net(9, second, 24940, "Hetzner Online GmbH"),
    net(10, "BR", 22356, "Durand do Brasil Ltda"),
    net(11, "BR", 22356, "Durand do Brasil Ltda"),
    net(12, "BR", 22356, "Durand do Brasil Ltda"),
    net(13, "BR", 13786, "Seabras 1 USA, LLC"),
    net(14, "BR", 13786, "Seabras 1 USA, LLC")
  ];
};

test("a network that goes through two countries: the line goes through both, in order, to the next network", async ({
  page
}) => {
  await openRoute(page, {
    post: route(heimdall(), { target_reached: false, target_country: "BR" }),
    query: "?routeview=map"
  });
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  const map = await info(page);
  // The network of the number 2 is Hetzner: its number is in Germany, where it hands the route on to the next network, and a dot
  // with no number is in Finland, where it takes the route in. The internal network at the start is drawn where Hetzner takes it in.
  expect(map.nodes.map(item => `${item.n}:${item.code}`)).toEqual(["1:FI", "2:DE", "3:BR", "4:BR"]);
  expect(map.waypoints).toEqual([{ n: 2, code: "FI" }]);
  await expect(page.locator("#routeMapHost circle.route-map-via")).toHaveCount(1);
  // Finland, Germany, Brazil: two curves, and a short piece inside each country that has two networks
  expect(map.legs.filter(leg => leg.kind === "path")).toEqual([
    { from: 2, to: 2, kind: "path", wrap: false },
    { from: 2, to: 3, kind: "path", wrap: false }
  ]);
  expect(map.legs.filter(leg => leg.kind === "near").map(leg => `${leg.from}-${leg.to}`)).toEqual(["1-2", "3-4"]);
  // Germany is painted too, and the dot is on it
  expect(map.painted).toMatchObject({ FI: "on", DE: "on", BR: "on" });
});

test("a network that goes through two countries the other way round: the number is in the last one and the dot in the first", async ({
  page
}) => {
  const hops = heimdall(true);
  // The same route with the countries swapped: Germany first, Finland last, so the number is in Finland and the dot in Germany
  await openRoute(page, {
    post: route(hops, { target_reached: false, target_country: "BR" }),
    query: "?routeview=map"
  });
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  const map = await info(page);
  expect(map.nodes[1]).toMatchObject({ n: 2, code: "FI" });
  expect(map.nodes[0]).toMatchObject({ n: 1, code: "DE" });
  expect(map.waypoints).toEqual([{ n: 2, code: "DE" }]);
  expect(map.legs.filter(leg => leg.kind === "path")).toHaveLength(2);
});

test("a network that stays in one country has no dot, and the visitor ring follows the last country of the line", async ({
  page
}) => {
  await openRoute(page, {
    post: route(
      heimdall().map(item => (item.country === "DE" ? { ...item, country: "FI" } : item)),
      {
        target_reached: false,
        target_country: "BR"
      }
    ),
    query: "?routeview=map"
  });
  await trace(page);
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  const map = await info(page);
  expect(map.waypoints).toEqual([]);
  expect(map.legs.filter(leg => leg.kind === "path")).toHaveLength(1);
});
