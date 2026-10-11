const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";
const root = path.join(__dirname, "..", "..");

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));

const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };

const hop = (ttl, country, rtt, extra = {}) => ({
  ttl,
  ip: `198.51.100.${ttl}`,
  alt_ips: [],
  rtt_min: rtt,
  rtt_avg: rtt,
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

const internal = (ttl, rtt) => ({ ...hop(ttl, null, rtt), scope: "private", asn: null, as_name: null });

// The route of the user: Whatbox (US), Cogent and Seabras (BR), then the internal network of the visitor (BR)
const asn = (ttl, country, rtt, number, name) => hop(ttl, country, rtt, { asn: `AS${number}`, as_name: name });
const example = (a = "US", b = "BR") => [
  asn(1, a, 1, 394151, "Whatbox Inc."),
  asn(2, a, 1.5, 394151, "Whatbox Inc."),
  asn(3, a, 2, 394151, "Whatbox Inc."),
  asn(4, a, 3, 394151, "Whatbox Inc."),
  asn(5, b, 115, 174, "Cogent Communications, LLC"),
  asn(6, b, 116, 174, "Cogent Communications, LLC"),
  asn(7, b, 120, 13786, "Seabras 1 USA, LLC"),
  asn(8, b, 140, 13786, "Seabras 1 USA, LLC"),
  internal(9, 141),
  internal(10, 145),
  internal(11, 148),
  internal(12, 150)
];

const route = (hops, extra = {}) => ({ ...fixture("normal"), pmtu: null, pmtu_drops: [], hops, ...extra });

async function openRoute(page, { post = fixture("normal"), query = "?routeview=map", lang = "" } = {}) {
  const seen = { requests: [], errors: [] };
  page.on("request", request => seen.requests.push(request.url()));
  page.on("pageerror", error => seen.errors.push(error.message));
  await page.route("**/backend/route.php*", handler => {
    if (handler.request().method() === "POST") return handler.fulfill({ json: post });
    return handler.fulfill({ json: CAPS });
  });
  await page.goto(`${staticRepositoryUrl}/route-better.html${query}${lang}`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  return seen;
}

async function trace(page) {
  await expect(page.locator("#routeStart")).toBeEnabled();
  await page.locator("#routeStart").click();
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
}

const info = page => page.evaluate(() => window.LibreSpeedRouteMap.info());

// The pure function, in the page (the scripts of the map are loaded with the map)
async function crossingsFor(page, hops, table = "default") {
  await page.goto(`${staticRepositoryUrl}/route-better.html`);
  await page.waitForFunction(() => !!window.LibreSpeedRouteView);
  await page.addScriptTag({ url: "/frontend/better/javascript/route-crossings.js" });
  return page.evaluate(
    ({ hops, table }) => {
      const data = { hops, target_country: "BR", target_reached: false };
      const given = table === "default" ? window.LibreSpeedRouteCrossings : table;
      return window.LibreSpeedRouteView.mapData(data, given);
    },
    { hops, table }
  );
}

test("T1 the route of the example crosses once, between the first and the second network", async ({ page }) => {
  const md = await crossingsFor(page, example());
  expect(md.nodes.map(node => `${node.n}:${node.country}`)).toEqual(["1:US", "2:BR", "3:BR", "4:BR"]);
  expect(md.crossings).toEqual([{ from: 1, to: 2, key: "BR-US", start: "us-east", end: "br-northeast", ms: 149 }]);
});

test("T2 the other way round (Brazil to the United States) puts the ends the other way", async ({ page }) => {
  const md = await crossingsFor(page, example("BR", "US"));
  expect(md.crossings).toHaveLength(1);
  expect(md.crossings[0]).toMatchObject({ key: "BR-US", start: "br-northeast", end: "us-east" });
});

test("T3 a rise that light in fiber could not make is not a crossing: the database is wrong about a country", async ({
  page
}) => {
  const hops = example().map(item => ({ ...item, rtt_min: Math.min(item.rtt_min, 20), rtt_avg: 20 }));
  expect((await crossingsFor(page, hops)).crossings).toEqual([]);
});

test("T4 a crossing inside a network that the database puts in the first country is counted from the start of the run", async ({
  page
}) => {
  const hops = [
    asn(1, "US", 2, 394151, "Whatbox Inc."),
    asn(2, "US", 115, 174, "Cogent Communications, LLC"),
    asn(3, "BR", 120, 13786, "Seabras 1 USA, LLC")
  ];
  const md = await crossingsFor(page, hops);
  expect(md.crossings).toHaveLength(1);
  expect(md.crossings[0]).toMatchObject({ from: 2, to: 3, ms: 118 });
});

test("T5 no table, no corridor or strange data: no crossing and nothing else changes", async ({ page }) => {
  const hops = example();
  const withTable = await crossingsFor(page, hops);
  const without = await crossingsFor(page, hops, null);
  expect(without.crossings).toEqual([]);
  const { crossings, ...rest } = withTable;
  const { crossings: none, ...bare } = without;
  expect(bare).toEqual(rest);
  // Two countries of the table but no corridor between them
  expect((await crossingsFor(page, example("DE", "NL"))).crossings).toEqual([]);
  // A table that cannot be used, and a route with nothing in it
  const strange = [{ pair: ["US"] }, null, { pair: ["US", "BR"], ends: ["a", "b"] }];
  expect((await crossingsFor(page, hops, { regions: {}, corridors: strange })).crossings).toEqual([]);
  expect((await crossingsFor(page, [])).crossings).toEqual([]);
  // A corridor whose ends are more than half the world apart would go round the date line: it is not used
  const far = {
    regions: { "us-east": { country: "US", lon: -76, lat: 36 }, "jp-east": { country: "JP", lon: 140, lat: 36 } },
    corridors: [{ pair: ["JP", "US"], ends: ["jp-east", "us-east"] }]
  };
  const pacific = [asn(1, "US", 2, 394151, "Whatbox Inc."), asn(2, "JP", 150, 2914, "NTT America")];
  expect((await crossingsFor(page, pacific, far)).crossings).toEqual([]);
  // A network in doubt in the middle: the crossing is between its firm neighbours
  const doubt = [
    asn(1, "US", 2, 394151, "Whatbox Inc."),
    { ...asn(2, "SG", 5, 4657, "Doubtful Net"), country_doubt: true },
    asn(3, "BR", 120, 13786, "Seabras 1 USA, LLC")
  ];
  const md = await crossingsFor(page, doubt);
  expect(md.crossings).toHaveLength(1);
  expect(md.crossings[0]).toMatchObject({ from: 1, to: 3 });
});

test("T6 the map draws land, sea and land, with two marks that have no number, in the right regions", async ({
  page
}) => {
  await openRoute(page, { post: route(example(), { target_reached: false, target_country: "BR" }) });
  await trace(page);
  const map = await info(page);
  expect(map.legs[0]).toEqual({ from: 1, to: 2, kind: "cross", wrap: false, via: ["us-east", "br-northeast"] });
  expect(map.landings).toEqual([
    { key: "us-east", x: 104, y: 48 },
    { key: "br-northeast", x: 141, y: 89 }
  ]);
  await expect(page.locator("#routeMapHost rect.route-map-landing")).toHaveCount(2);
  await expect(page.locator("#routeMapHost path.route-map-leg-sea")).toHaveCount(1);
  await expect(page.locator("#routeMapHost path.route-map-leg-land")).toHaveCount(2);
  expect(await page.locator("#routeMapHost text").allTextContents()).toEqual(["1", "2", "3", "4"]);
});

test("T7 at 360 px the whole crossing fits in the frame and the numbers keep their distance", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openRoute(page, { post: route(example(), { target_reached: false, target_country: "BR" }) });
  await trace(page);
  const map = await info(page);
  const [x0, y0, w, h] = map.frame;
  map.landings.forEach(landing => {
    expect(landing.x).toBeGreaterThanOrEqual(x0);
    expect(landing.x).toBeLessThanOrEqual(x0 + w);
    expect(landing.y).toBeGreaterThanOrEqual(y0);
    expect(landing.y).toBeLessThanOrEqual(y0 + h);
  });
  const unit = w / map.width;
  for (let i = 0; i < map.nodes.length; i++)
    for (let j = i + 1; j < map.nodes.length; j++)
      expect(
        Math.hypot(map.nodes[i].x - map.nodes[j].x, map.nodes[i].y - map.nodes[j].y) / unit,
        `${i + 1} and ${j + 1}`
      ).toBeGreaterThanOrEqual(16.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true
  );
});

test("T8 the zoom keeps the marks where they are", async ({ page }) => {
  await openRoute(page, { post: route(example(), { target_reached: false, target_country: "BR" }) });
  await trace(page);
  const before = (await info(page)).landings;
  await page.locator('#routeMapZoom [data-zoom="in"]').click();
  expect((await info(page)).landings).toEqual(before);
  await page.locator('#routeMapZoom [data-zoom="fit"]').click();
  expect((await info(page)).landings).toEqual(before);
});

test("T9 the table is valid: whole degrees, the right country, sorted pairs, in all the languages, with a source", async () => {
  const source = fs.readFileSync(path.join(root, "frontend", "better", "javascript", "route-crossings.js"), "utf8");
  const table = new Function(`${source}; return LibreSpeedRouteCrossings;`)();
  const world = new Function(
    `${fs.readFileSync(path.join(root, "frontend", "better", "vendor", "world-110m.js"), "utf8")}; return LibreSpeedWorld;`
  )();
  const readme = fs.readFileSync(path.join(root, "frontend", "better", "map", "README.md"), "utf8");
  const catalogs = ["en", "pt", "es", "sv"].map(language =>
    JSON.parse(fs.readFileSync(path.join(root, "frontend", "better", "locales", `${language}.json`), "utf8"))
  );
  Object.entries(table.regions).forEach(([key, region]) => {
    expect(Number.isInteger(region.lon) && Number.isInteger(region.lat), key).toBe(true);
    expect(region.lon).toBeGreaterThanOrEqual(-180);
    expect(region.lon).toBeLessThanOrEqual(180);
    expect(region.lat).toBeGreaterThanOrEqual(-60);
    expect(region.lat).toBeLessThanOrEqual(84);
    expect(world.centers[region.country] || world.points[region.country], key).toBeTruthy();
  });
  const seen = {};
  table.corridors.forEach(corridor => {
    const [a, b] = corridor.pair;
    expect(a < b, corridor.pair.join("-")).toBe(true);
    expect(seen[`${a}-${b}`]).toBeUndefined();
    seen[`${a}-${b}`] = true;
    const ends = corridor.ends.map(key => table.regions[key]);
    expect(ends[0].country).toBe(a);
    expect(ends[1].country).toBe(b);
    expect(Math.abs(ends[0].lon - ends[1].lon)).toBeLessThanOrEqual(180);
    expect(readme, `${a}-${b} has a source`).toMatch(new RegExp(`${a}.${b}[^\\n]*https://`));
  });
});

test("T10 the map has only the map and its buttons: no list, no key, no notes, no sentence of the rise", async ({
  page
}) => {
  await openRoute(page, { post: route(example(), { target_reached: false, target_country: "BR" }), lang: "&lang=pt" });
  await trace(page);
  await expect(page.locator("#routeMapZoom button")).toHaveCount(4);
  for (const selector of [".route-map-key", "#routeMapList", "#routeMapHint", ".route-map-note", "#routeJump"]) {
    await expect(page.locator(selector), selector).toHaveCount(0);
  }
  // The section has a name for the screen readers, and nothing else is written on the map
  await expect(page.locator("#routeMap")).toHaveAttribute("aria-labelledby", "routeMapTitle");
  await expect(page.locator("#routeMapTitle")).toHaveText("Redes e países no caminho");
  await expect(page.locator("#routeMapTitle")).not.toBeInViewport();

  const second = await page.context().newPage();
  await openRoute(second, { post: route(example("DE", "NL"), { target_reached: false, target_country: "NL" }) });
  await trace(second);
  await expect(second.locator("#routeMapHost rect.route-map-landing")).toHaveCount(0);
});

test("T11 a name with markup is text on the list and on the map, and nothing is asked from other sites", async ({
  page
}) => {
  const hops = example().map(item =>
    item.ttl === 7 ? { ...item, as_name: "<img src=x onerror=window.__x=1>" } : item
  );
  const seen = await openRoute(page, { post: route(hops, { target_reached: false, target_country: "BR" }) });
  await trace(page);
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
  await expect(page.locator("#routeMap img")).toHaveCount(0);
  expect(seen.errors).toEqual([]);
  seen.requests.forEach(url => expect(url.startsWith(staticRepositoryUrl), url).toBe(true));
});

// The networks of a country follow the way of the route in any angle: from where the route came in to where it goes on
test("T12 the numbers of a country follow the way of the route, from the coast where it came in, in any angle", async ({
  page
}) => {
  const place = async (hops, country) => {
    const second = await page.context().newPage();
    await openRoute(second, { post: route(hops, { target_reached: true, target_country: country }) });
    await trace(second);
    const map = await info(second);
    await second.close();
    return map.nodes;
  };
  // The example: it comes in by the north east coast of Brazil and ends inland, so right to left and down
  const exampleNodes = await place(example(), "BR");
  expect(exampleNodes[1].x).toBeGreaterThan(exampleNodes[2].x);
  expect(exampleNodes[2].x).toBeGreaterThan(exampleNodes[3].x);
  expect(exampleNodes[1].y).toBeLessThan(exampleNodes[3].y);
  // From the south west to the north east (Chile to Brazil, no sea in between): left to right and up
  const up = await place([hop(1, "CL", 5), hop(2, "BR", 10), hop(3, "BR", 11), hop(4, "BR", 12)], "BR");
  expect(up[1].x).toBeLessThan(up[3].x);
  expect(up[1].y).toBeGreaterThan(up[3].y);
  // From the south east to the north west (Brazil to Canada): right to left and up
  const left = await place([hop(1, "BR", 5), hop(2, "CA", 10), hop(3, "CA", 11), hop(4, "CA", 12)], "CA");
  expect(left[1].x).toBeGreaterThan(left[3].x);
  expect(left[1].y).toBeGreaterThan(left[3].y);
  // From the north west to the south east (Canada to Brazil): left to right and down
  const down = await place([hop(1, "CA", 5), hop(2, "BR", 10), hop(3, "BR", 11), hop(4, "BR", 12)], "BR");
  expect(down[1].x).toBeLessThan(down[3].x);
  expect(down[1].y).toBeLessThan(down[3].y);
});
