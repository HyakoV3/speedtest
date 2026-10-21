const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { openBackPanel, showRoute } = require("./helpers/route-side");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));
const sample = name => fs.readFileSync(path.join(__dirname, "..", "fixtures", "route-back", name), "utf8");

const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };
const BOTH_KEY = "librespeed-better-route-map-both";

// The route from the server: Whatbox (US) then Cogent and Seabras (BR)
const hop = (ttl, country, rtt, number, name) => ({
  ttl,
  ip: `198.51.100.${ttl}`,
  alt_ips: [],
  rtt_min: rtt,
  rtt_avg: rtt,
  sent: 3,
  answered: 3,
  flags: [],
  scope: "public",
  asn: `AS${number}`,
  as_name: name,
  country,
  continent: "NA",
  country_doubt: false,
  is_target: false
});
const THERE = {
  ...fixture("normal"),
  pmtu: null,
  pmtu_drops: [],
  target_reached: false,
  target_country: "BR",
  hops: [
    hop(1, "US", 1, 394151, "Whatbox"),
    hop(2, "US", 3, 394151, "Whatbox"),
    hop(3, "BR", 115, 174, "Cogent"),
    hop(4, "BR", 120, 13786, "Seabras")
  ]
};

// The networks of the pasted route: by the last number of the address ("x.x.x.<n>" is AS<n>), in Brazil, the server in the United States
const ENRICH = body => ({
  v: 1,
  hops: body.hops.map(h => ({
    ttl: h.ttl,
    asn: `AS${h.ip.split(".").pop()}`,
    as_name: `Net ${h.ip.split(".").pop()}`,
    country: "BR",
    country_doubt: false
  })),
  target_as: { asn: "AS15169", as_name: "Google LLC" },
  target_country: "US"
});

async function openRoute(page, { enrich = ENRICH, gate = null, query = "?routeview=map" } = {}) {
  await page.route("**/backend/route.php*", route => {
    if (route.request().method() === "POST") return route.fulfill({ json: THERE });
    return route.fulfill({ json: CAPS });
  });
  await page.route("**/backend/route_enrich.php", async route => {
    if (gate) await gate;
    return route.fulfill({ json: enrich(JSON.parse(route.request().postData())) });
  });
  await page.goto(`${staticRepositoryUrl}/route-better.html${query}`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
}

const trace = async page => {
  await expect(page.locator("#routeStart")).toBeEnabled();
  await page.locator("#routeStart").click();
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
};
const direction = (page, way) => showRoute(page, way);
const paste = async page => {
  await openBackPanel(page);
  await page.locator("#routeBackText").fill(sample("windows-ptbr-tracert.txt"));
  await page.locator("#routeBackShow").click();
};
const info = page => page.evaluate(() => window.LibreSpeedRouteMap.info());
const legend = page => page.locator("#routeMapLegend li").allTextContents();
const bothButton = page => page.locator("#routeMapBothButton");

test("U1 the button is only there when the other direction is, and the legend names the two lines", async ({
  page
}) => {
  await openRoute(page);
  await trace(page);
  await expect(page.locator("#routeMapBoth")).toBeHidden();
  expect((await info(page)).other).toBeUndefined();
  await paste(page);
  await expect(page.locator("#routeMapBoth")).toBeVisible();
  await expect(bothButton(page)).toHaveText("Show both directions");
  await expect(bothButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await info(page)).other !== undefined).toBe(true);
  // The first line is the one of the direction on the screen, the second one is the other
  expect(await legend(page)).toEqual(["You → server", "Server → you"]);
  await direction(page, "there");
  await expect.poll(async () => legend(page)).toEqual(["Server → you", "You → server"]);
  expect((await info(page)).other).toBeTruthy();
});

test("U2 the button turns the other direction off and on, and the choice is kept", async ({ page }) => {
  await openRoute(page);
  await trace(page);
  await paste(page);
  await expect.poll(async () => (await info(page)).other !== undefined).toBe(true);
  const frame = (await info(page)).frame;
  await bothButton(page).click();
  await expect(bothButton(page)).toHaveAttribute("aria-pressed", "false");
  // The directions stay (they are how one is chosen), but there are no lines to name
  await expect(page.locator("#routeMapLegend li")).toHaveCount(2);
  await expect(page.locator("#routeMapLegend svg")).toHaveCount(0);
  expect((await info(page)).other).toBeUndefined();
  await expect(page.locator("#routeMapHost .route-map-leg-other")).toHaveCount(0);
  expect(await page.evaluate(key => window.localStorage.getItem(key), BOTH_KEY)).toBe("off");
  // The zoom is not reset by it
  await page.locator('#routeMapZoom [data-zoom="in"]').click();
  const zoomed = (await info(page)).frame;
  await bothButton(page).click();
  await expect(bothButton(page)).toHaveAttribute("aria-pressed", "true");
  expect((await info(page)).user).toBe(true);
  expect((await info(page)).other).toBeTruthy();
  expect(zoomed).not.toEqual(frame);
  // The choice comes back on the next visit
  await bothButton(page).click();
  await page.reload();
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await expect(bothButton(page)).toHaveAttribute("aria-pressed", "false");
  // The panel of the way back is as it was left, and no route is there yet
  await expect(page.locator("#routeSideToggle")).toBeVisible();
  await trace(page);
  await paste(page);
  await expect(page.locator("#routeMapBoth")).toBeVisible();
  await expect(bothButton(page)).toHaveAttribute("aria-pressed", "false");
  // The directions stay (they are how one is chosen), but there are no lines to name
  await expect(page.locator("#routeMapLegend li")).toHaveCount(2);
  await expect(page.locator("#routeMapLegend svg")).toHaveCount(0);
  expect((await info(page)).other).toBeUndefined();
});

test("U3 the button is not in the table or the chart, and goes away with the way back", async ({ page }) => {
  await openRoute(page);
  await trace(page);
  await paste(page);
  await expect(page.locator("#routeMapBoth")).toBeVisible();
  await page.locator('#routeViews [data-view="table"]').click();
  await expect(page.locator("#routeMapBoth")).toBeHidden();
  await page.locator('#routeViews [data-view="map"]').click();
  await expect(page.locator("#routeMapBoth")).toBeVisible();
  // Clearing the pasted route, on the way back: nothing is drawn. On the way from the server: the other one is not drawn any more
  await direction(page, "there");
  await expect(page.locator("#routeMapBoth")).toBeVisible();
  await direction(page, "back");
  await page.locator("#routeBackClear").click();
  // The way back is gone, and the screen goes back to the way from the server, with nothing to pair it with
  await expect(page.locator("#routeTableBoth")).toBeHidden();
  await expect(page.locator("#routeMapBoth")).toBeHidden();
  expect((await info(page)).other).toBeUndefined();
});

test("U4 the networks of the way back that arrive while the way from the server is on the screen are drawn when they do", async ({
  page
}) => {
  let release;
  const gate = new Promise(resolve => (release = resolve));
  await openRoute(page, { gate });
  await trace(page);
  await paste(page);
  // Not enriched yet: the person goes back to the way from the server
  await direction(page, "there");
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  expect((await info(page)).other).toBeUndefined();
  release();
  await expect.poll(async () => (await info(page)).other !== undefined).toBe(true);
  await expect(page.locator("#routeMapBoth")).toBeVisible();
});

test("U5 the texts are in the four languages and 360 px has no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openRoute(page);
  await trace(page);
  await paste(page);
  await expect(page.locator("#routeMapBoth")).toBeVisible();
  const texts = {
    en: ["Show both directions", "You → server", "Server → you"],
    pt: ["Mostrar os dois sentidos", "Você → servidor", "Servidor → você"],
    es: ["Mostrar los dos sentidos", "Tú → servidor", "Servidor → tú"],
    sv: ["Visa båda riktningarna", "Du → servern", "Server → dig"]
  };
  for (const [language, [button, first, second]] of Object.entries(texts)) {
    await page.evaluate(code => window.LibreSpeedI18n.set(code, false), language);
    await expect(bothButton(page)).toHaveText(button);
    await expect.poll(async () => legend(page)).toEqual([first, second]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    ).toBe(true);
    await expect
      .poll(async () => (await bothButton(page).boundingBox()).height, { message: language })
      .toBeGreaterThanOrEqual(39);
  }
});

test("U6 a saved way back that is reopened is drawn with the way from the server that is on the page", async ({
  page
}) => {
  await openRoute(page);
  await trace(page);
  await paste(page);
  await expect(page.locator("#routeBackSave")).toHaveAttribute("aria-disabled", "false");
  await page.locator("#routeBackSave").click();
  await expect(page.locator("#routeBackSave")).toHaveText("Saved to history");
  // Clear the pasted route: only the way from the server is left, with nothing to pair it with
  await page.locator("#routeBackClear").click();
  await expect(page.locator("#routeMapBoth")).toBeHidden();
  await expect(page.locator("#historyList .history-panel").first()).toBeVisible();
  await page.locator("#historyList .history-panel").first().locator(".history-action-btn").click();
  await expect(page.locator('[data-shown="back"]:visible').first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#routeMapBoth")).toBeVisible();
  await expect.poll(async () => (await info(page)).other !== undefined).toBe(true);
  expect(await legend(page)).toEqual(["You → server", "Server → you"]);
});

test("U7 in high contrast the two lines are not the same colour", async ({ page }) => {
  await openRoute(page);
  await trace(page);
  await paste(page);
  await expect.poll(async () => (await info(page)).other !== undefined).toBe(true);
  const colours = () =>
    page.evaluate(() => {
      const stroke = selector => getComputedStyle(document.querySelector(selector)).stroke;
      return {
        first: stroke("#routeMapHost path.route-map-leg:not(.route-map-leg-other)"),
        other: stroke("#routeMapHost path.route-map-leg-other"),
        // A waypoint of the other direction is filled with its colour; a network that is only in it is a hollow point with that colour as stroke
        dot: (element => {
          const style = getComputedStyle(element);
          return element.matches(".route-map-dot-other") ? style.stroke : style.fill;
        })(document.querySelector("#routeMapHost .route-map-via-other, #routeMapHost .route-map-dot-other")),
        text: getComputedStyle(document.querySelector("#routeMapHost .route-map-node circle")).fill
      };
    });
  await page.evaluate(() => document.documentElement.classList.add("high-contrast"));
  const contrast = await colours();
  expect(contrast.other).not.toBe(contrast.first);
  expect(contrast.dot).not.toBe(contrast.text);
  await page.evaluate(() => document.documentElement.classList.remove("high-contrast"));
  const normal = await colours();
  expect(normal.other).not.toBe(normal.first);
});
