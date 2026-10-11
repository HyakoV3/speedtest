const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

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
const asn = (ttl, country, rtt, number, name) => hop(ttl, country, rtt, { asn: `AS${number}`, as_name: name });
const internal = (ttl, rtt) => ({ ...hop(ttl, null, rtt), scope: "private", asn: null, as_name: null });
const route = (hops, extra = {}) => ({ ...fixture("normal"), pmtu: null, pmtu_drops: [], hops, ...extra });

// The way from the server (Whatbox in the United States, then Cogent and Seabras in Brazil) and the way back (the same networks)
const there = () =>
  route(
    [
      asn(1, "US", 1, 394151, "Whatbox Inc."),
      asn(2, "US", 3, 394151, "Whatbox Inc."),
      asn(3, "BR", 115, 174, "Cogent"),
      asn(4, "BR", 120, 13786, "Seabras 1 USA, LLC"),
      internal(5, 130)
    ],
    { target_reached: false, target_country: "BR" }
  );
const back = (extra = []) =>
  route(
    [
      internal(1, 1),
      asn(2, "BR", 5, 13786, "Seabras 1 USA, LLC"),
      ...extra,
      asn(3 + extra.length, "BR", 10, 174, "Cogent"),
      asn(4 + extra.length, "US", 120, 394151, "Whatbox Inc.")
    ],
    { direction: "client_to_server", target_reached: false, target_country: "US" }
  );

async function openRoute(page) {
  await page.route("**/backend/route.php*", handler => {
    if (handler.request().method() === "POST") return handler.fulfill({ json: there() });
    return handler.fulfill({ json: CAPS });
  });
  await page.goto(`${staticRepositoryUrl}/route-better.html`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  await expect(page.locator("#routeStart")).toBeEnabled();
  await page.locator("#routeStart").click();
  await expect(page.locator("#routeViews")).toBeVisible();
  await page.locator('#routeViews [data-view="map"]').click();
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
}

// Draws two routes with the map itself (the page only has one at a time yet): the main way and, when it is given, the other
async function render(page, main, other) {
  return page.evaluate(
    ([a, b]) => {
      const view = window.LibreSpeedRouteView;
      const table = window.LibreSpeedRouteCrossings;
      window.LibreSpeedRouteMap.render(
        document.getElementById("routeMapHost"),
        view.mapData(a, table),
        document.getElementById("routeMapZoom"),
        b ? view.mapData(b, table) : undefined
      );
      return window.LibreSpeedRouteMap.info();
    },
    [main, other || null]
  );
}
const info = page => page.evaluate(() => window.LibreSpeedRouteMap.info());
const px = (map, a, b) => Math.hypot(a.x - b.x, a.y - b.y) / (map.frame[2] / map.width);
const zoomIn = page => page.locator('#routeMapZoom [data-zoom="in"]').click();

test("T1 with no other way the map is the one of always, and says nothing about another way", async ({ page }) => {
  await openRoute(page);
  const alone = await render(page, there());
  expect(alone.other).toBeUndefined();
  await expect(page.locator("#routeMapHost .route-map-leg-other")).toHaveCount(0);
  const withNull = await render(page, there(), null);
  expect(withNull.other).toBeUndefined();
});

test("T2 joinNodes: the same ASN in the same country is the same network, and nothing else is", async ({ page }) => {
  await openRoute(page);
  const result = await page.evaluate(
    ([a, b]) => {
      const view = window.LibreSpeedRouteView;
      const main = view.mapData(a, null);
      const other = view.mapData(b, null);
      return {
        main: main.nodes.map(n => `${n.n}:${n.asn}:${n.country}`),
        other: other.nodes.map(n => n.asn),
        join: view.joinNodes(main, other)
      };
    },
    [there(), back()]
  );
  // main: Whatbox 1, Cogent 2, Seabras 3, internal 4; other: internal, Seabras, Cogent, Whatbox
  expect(result.main.slice(0, 3)).toEqual(["1:AS394151:US", "2:AS174:BR", "3:AS13786:BR"]);
  expect(result.join).toEqual([null, 3, 2, 1]);
  // The same ASN in another country is another place: a carrier that leaves a country one way and reaches it the other
  const other = await page.evaluate(
    ([a, b]) => {
      const view = window.LibreSpeedRouteView;
      return view.joinNodes(view.mapData(a, null), view.mapData(b, null));
    },
    [there(), route([asn(1, "DE", 5, 174, "Cogent"), asn(2, "US", 90, 394151, "Whatbox Inc.")])]
  );
  expect(other).toEqual([null, 1]);
  expect(await page.evaluate(() => window.LibreSpeedRouteView.joinNodes(null, null))).toEqual([]);
});

test("T3 the numbers of the first way are where they were, and the other way has its own n", async ({ page }) => {
  await openRoute(page);
  const alone = await render(page, there());
  await zoomIn(page);
  await zoomIn(page);
  const zoomedAlone = await info(page);
  const both = await render(page, there(), back(), undefined);
  expect(both.user).toBe(true);
  expect(both.nodes).toEqual(zoomedAlone.nodes);
  expect(both.legs).toEqual(zoomedAlone.legs);
  // The other way is the legs of its own numbers: the internal network (1, next to Seabras), Seabras (2), Cogent (3), Whatbox (4)
  expect(both.other.legs.map(leg => `${leg.from}-${leg.to}`)).toEqual(["1-2", "2-3", "3-4"]);
  expect(alone.frame).not.toEqual(zoomedAlone.frame);
});

test("T4 a network that is only in the other way is a dot with no number, away from the numbers", async ({ page }) => {
  await openRoute(page);
  const both = await render(page, there(), back([asn(3, "BR", 8, 3356, "Level 3")]));
  // The network of the visitor (internal, never the same as one of the first way) and Level 3
  expect(both.other.dots.map(d => d.n)).toEqual([1, 3]);
  expect(both.other.dots.map(d => d.code)).toEqual(["BR", "BR"]);
  // Not a number: the nodes of the map are only the ones of the first way
  expect(both.nodes.map(n => n.n)).toEqual([1, 2, 3, 4]);
  both.nodes.forEach(n => both.other.dots.forEach(dot => expect(px(both, n, dot)).toBeGreaterThan(11.5)));
  await expect(page.locator("#routeMapHost circle.route-map-dot-other")).toHaveCount(2);
  // Beside the line of the numbers of Brazil, not on it: at least 11 px from the line itself
  const a = both.nodes[1];
  const b = both.nodes[3];
  const unit = both.frame[2] / both.width;
  both.other.dots.forEach(dot => {
    const across =
      Math.abs((b.x - a.x) * (a.y - dot.y) - (a.x - dot.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y);
    expect(across / unit).toBeGreaterThan(11);
  });
  await expect(page.locator("#routeMapHost .route-map-node")).toHaveCount(4);
  // The three that are in both have no dot: only the internal network is left
  const same = await render(page, there(), back());
  expect(same.other.dots.map(d => d.n)).toEqual([1]);
});

test("T5 a carrier in another country the other way gets a dot of its own, not the number of the first way", async ({
  page
}) => {
  await openRoute(page);
  const other = route([asn(1, "DE", 5, 174, "Cogent"), asn(2, "US", 90, 394151, "Whatbox Inc.")], {
    direction: "client_to_server",
    target_country: "US"
  });
  const both = await render(page, there(), other);
  expect(both.other.dots.map(d => d.code)).toEqual(["DE"]);
});

test("T6 the other way is drawn under, in its own class, with arrows, a ring and landings of its own", async ({
  page
}) => {
  await openRoute(page);
  const pacific = route(
    [asn(1, "US", 2, 1, "A"), asn(2, "US", 3, 1, "A"), asn(3, "JP", 110, 2, "B"), asn(4, "JP", 111, 2, "B")],
    { direction: "client_to_server", target_reached: false, target_country: "JP" }
  );
  const both = await render(page, there(), pacific);
  expect(both.other.legs).toEqual([{ from: 1, to: 2, kind: "cross", wrap: true, via: ["us-west", "jp-east"] }]);
  expect(both.other.landings.map(l => l.key)).toEqual(["us-west", "jp-east"]);
  // The Pacific goes round the date line, so the frame is the whole world
  expect(both.frame[2]).toBe(360);
  // Two parts of the sea, each with its arrow, and two diamonds
  await expect(page.locator("#routeMapHost path.route-map-leg-sea.route-map-leg-other")).toHaveCount(2);
  await expect(page.locator("#routeMapHost polygon.route-map-arrow.route-map-leg-other")).toHaveCount(
    await page
      .locator("#routeMapHost path.route-map-leg-other:not(.route-map-leg-land):not(.route-map-leg-near)")
      .count()
  );
  await expect(page.locator("#routeMapHost rect.route-map-landing-other")).toHaveCount(2);
  await expect(page.locator("#routeMapHost circle.route-map-you-other")).toHaveCount(1);
  // The other way is before the first one in the picture (under it)
  const order = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("#routeMapHost g > path.route-map-leg"));
    return all.map(p => (p.classList.contains("route-map-leg-other") ? "o" : "m")).join("");
  });
  expect(order).toMatch(/^o+m+$/);
  // The main way keeps its own marks
  expect(both.landings.map(l => l.key)).toEqual(["us-east", "br-northeast"]);
});

test("T7 the countries of both ways are painted, once, and a country is in doubt only when it is in doubt in both", async ({
  page
}) => {
  await openRoute(page);
  const doubtful = route(
    [asn(1, "BR", 5, 13786, "S"), { ...asn(2, "AU", 30, 9, "X"), country_doubt: true }, asn(3, "SG", 60, 10, "Y")],
    { direction: "client_to_server", target_country: "SG" }
  );
  const both = await render(page, there(), doubtful);
  expect(both.painted.US).toBe("on");
  expect(both.painted.BR).toBe("on");
  expect(both.painted.AU).toBe("doubt");
  // SG has only a point (no shape): one spot, not two
  const twice = route([asn(1, "SG", 5, 11, "Z"), asn(2, "US", 90, 394151, "Whatbox Inc.")], {
    direction: "client_to_server",
    target_country: "US"
  });
  const mainSg = route([asn(1, "US", 1, 394151, "Whatbox Inc."), asn(2, "SG", 200, 12, "W")], { target_country: "SG" });
  await render(page, mainSg, twice);
  await expect(page.locator("#routeMapHost circle.route-map-spot")).toHaveCount(1);
});

test("T8 the other way stays when the zoom or the size of the map change", async ({ page }) => {
  await openRoute(page);
  const both = await render(page, there(), back([asn(3, "BR", 8, 3356, "Level 3")]));
  const dots = both.other.dots.length;
  expect(dots).toBe(2);
  await zoomIn(page);
  expect((await info(page)).other.dots).toHaveLength(dots);
  await page.setViewportSize({ width: 360, height: 740 });
  await expect.poll(async () => (await info(page)).width).toBeLessThan(400);
  expect((await info(page)).other).toBeTruthy();
  await page.locator('#routeMapZoom [data-zoom="fit"]').click();
  expect((await info(page)).other).toBeTruthy();
  // A new render without another way forgets it
  expect((await render(page, there())).other).toBeUndefined();
});

test("T9 no ring for the other way when it does not know where it ends", async ({ page }) => {
  await openRoute(page);
  const none = route([asn(1, "BR", 5, 13786, "S"), asn(2, "US", 120, 394151, "Whatbox Inc.")], {
    direction: "client_to_server",
    target_reached: false,
    target_country: null
  });
  const both = await render(page, there(), { ...none, hops: none.hops.map(h => ({ ...h, is_target: false })) });
  expect(both.other.ring).toBe(null);
  await expect(page.locator("#routeMapHost circle.route-map-you-other")).toHaveCount(0);
});

test("T10 doubt in the other way does not make a country of the first way doubtful, and a spot of the other way is drawn", async ({
  page
}) => {
  await openRoute(page);
  const unsure = route([{ ...asn(1, "BR", 5, 13786, "S"), country_doubt: true }, asn(2, "SG", 90, 12, "Z")], {
    direction: "client_to_server",
    target_country: "SG"
  });
  const both = await render(page, there(), unsure);
  expect(both.painted.BR).toBe("on");
  // SG is only in the other way and has only a point on the map
  await expect(page.locator("#routeMapHost circle.route-map-spot")).toHaveCount(1);
});

test("T11 the dots go around the numbers: the numbers do not move and nothing is nearer than 12 px", async ({
  page
}) => {
  await openRoute(page);
  // The other way comes into Brazil from the south and leaves it to the north: its line in Brazil is not the one of the numbers
  const crowded = route(
    [
      asn(1, "AR", 5, 7000, "AR net"),
      asn(2, "BR", 8, 7001, "Net 1"),
      asn(3, "BR", 9, 7002, "Net 2"),
      asn(4, "BR", 10, 7003, "Net 3"),
      asn(5, "BR", 11, 7004, "Net 4"),
      asn(6, "BR", 12, 7005, "Net 5"),
      asn(7, "US", 120, 394151, "Whatbox Inc.")
    ],
    { direction: "client_to_server", target_country: "US" }
  );
  await render(page, there());
  await zoomIn(page);
  await zoomIn(page);
  const alone = await info(page);
  const both = await render(page, there(), crowded);
  expect(both.user).toBe(true);
  expect(both.nodes).toEqual(alone.nodes);
  expect(both.other.dots.length).toBeGreaterThanOrEqual(5);
  const near = [];
  both.other.dots.forEach(dot => {
    both.nodes.forEach(n => near.push(px(both, n, dot)));
    both.other.dots.forEach(o => o !== dot && near.push(px(both, o, dot)));
  });
  expect(Math.min(...near)).toBeGreaterThan(11.5);
});
