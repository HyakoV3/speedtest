const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { openBackPanel, showRoute } = require("./helpers/route-side");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));
const sample = name => fs.readFileSync(path.join(__dirname, "..", "fixtures", "route-back", name), "utf8");

const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };
const BOTH_KEY = "librespeed-better-route-map-both";

// The route from the server (4 hops) and a way back that is pasted (7 hops): the two directions of the page
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

async function openRoute(page, view) {
  await page.route("**/backend/route.php*", route => {
    if (route.request().method() === "POST") return route.fulfill({ json: THERE });
    return route.fulfill({ json: CAPS });
  });
  await page.route("**/backend/route_enrich.php", route =>
    route.fulfill({ json: ENRICH(JSON.parse(route.request().postData())) })
  );
  await page.goto(`${staticRepositoryUrl}/route-better.html?routeview=${view}`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
}

const rowsOf = (page, id) => page.locator(`#${id} tbody tr`);
const chin = (page, id) => page.locator(`#${id}`);
const trace = async page => {
  await expect(page.locator("#routeStart")).toBeEnabled();
  await page.locator("#routeStart").click();
  await expect(rowsOf(page, "routeTable")).toHaveCount(4);
};
const paste = async page => {
  await openBackPanel(page);
  await page.locator("#routeBackText").fill(sample("windows-ptbr-tracert.txt"));
  await page.locator("#routeBackShow").click();
  // The chin of the view that is on the screen
  await expect(page.locator("#routeResults .route-both:visible").first()).toBeVisible();
};
const ways = (page, id) => page.locator(`#${id} .route-both-way`).allTextContents();

test("W1 the three views have the same chin: the button for the two directions and the two directions, and no selector over the results", async ({
  page
}) => {
  await openRoute(page, "table");
  await trace(page);
  // With one route there is nothing to choose: no chin in any view
  await expect(chin(page, "routeTableBoth")).toBeHidden();
  await expect(page.locator("#routeShown")).toHaveCount(0);
  await paste(page);
  // The route pasted is on the screen, so it is the first
  for (const [view, id] of [
    ["table", "routeTableBoth"],
    ["chart", "routeChartBoth"],
    ["map", "routeMapBoth"]
  ]) {
    await page.locator(`#routeViews [data-view="${view}"]`).click();
    await expect(chin(page, id), view).toBeVisible();
    await expect(chin(page, id).locator(".route-both-button"), view).toHaveText("Show both directions");
    await expect(chin(page, id).locator(".route-both-button"), view).toHaveAttribute("aria-pressed", "true");
    expect(await ways(page, id), view).toEqual(["You → server", "Server → you"]);
    await expect(chin(page, id).locator('[data-shown="back"]'), view).toHaveAttribute("aria-pressed", "true");
  }
});

test("W2 pressing the other direction in a chin puts it on the screen, in each of the three views", async ({
  page
}) => {
  await openRoute(page, "table");
  await trace(page);
  await paste(page);
  await expect(page.locator("#routeTable caption")).toHaveText("Hops from you to this server");
  await chin(page, "routeTableBoth").locator('[data-shown="there"]').click();
  await expect(page.locator("#routeTable caption")).toHaveText("Hops from this server to you");
  expect(await ways(page, "routeTableBoth")).toEqual(["Server → you", "You → server"]);
  await page.locator('#routeViews [data-view="chart"]').click();
  await expect(page.locator("#routeChartHost canvas")).toBeVisible();
  await chin(page, "routeChartBoth").locator('[data-shown="back"]').click();
  await expect(page.locator("#routeTable caption")).toHaveText("Hops from you to this server");
  await expect(page.locator('#routeChart li[data-key="you"]')).toContainText("server");
  await page.locator('#routeViews [data-view="map"]').click();
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  await chin(page, "routeMapBoth").locator('[data-shown="there"]').click();
  await expect(page.locator("#routeTable caption")).toHaveText("Hops from this server to you");
});

test("W3 the table of the other direction comes under the first, with its own caption, and goes with the button", async ({
  page
}) => {
  await openRoute(page, "table");
  await trace(page);
  await expect(page.locator("#routeTableOther")).toHaveCount(0);
  await paste(page);
  await expect(page.locator("#routeTableOther")).toBeVisible();
  await expect(page.locator("#routeTableOther caption")).toHaveText("Hops from this server to you");
  await expect(rowsOf(page, "routeTableOther")).toHaveCount(4);
  await expect(rowsOf(page, "routeTable")).toHaveCount(7);
  // The second table is under the first, inside the same box, and the chin is under both
  const tops = await page.evaluate(() =>
    ["routeTable", "routeTableOther", "routeTableBoth"].map(
      id => document.getElementById(id).getBoundingClientRect().top
    )
  );
  expect(tops[0]).toBeLessThan(tops[1]);
  expect(tops[1]).toBeLessThan(tops[2]);
  await chin(page, "routeTableBoth").locator(".route-both-button").click();
  await expect(page.locator("#routeTableOther")).toHaveCount(0);
  await expect(chin(page, "routeTableBoth").locator(".route-both-button")).toHaveAttribute("aria-pressed", "false");
  // The directions are still there to be chosen
  expect(await ways(page, "routeTableBoth")).toEqual(["You → server", "Server → you"]);
  await expect(chin(page, "routeTableBoth").locator("svg")).toHaveCount(0);
  await chin(page, "routeTableBoth").locator(".route-both-button").click();
  await expect(page.locator("#routeTableOther")).toBeVisible();
  // A route that is chosen has its caption in the table of the page, and the other in the second table
  await chin(page, "routeTableBoth").locator('[data-shown="there"]').click();
  await expect(page.locator("#routeTable caption")).toHaveText("Hops from this server to you");
  await expect(page.locator("#routeTableOther caption")).toHaveText("Hops from you to this server");
  await expect(rowsOf(page, "routeTableOther")).toHaveCount(7);
});

test("W4 the chart draws the other direction too, dashed, and the button turns it off for the three views at once", async ({
  page
}) => {
  await openRoute(page, "chart");
  await trace(page);
  await expect(page.locator("#routeChartHost canvas")).toBeVisible();
  expect(await page.evaluate(() => window.LibreSpeedRouteChart.info().other)).toBe(false);
  await paste(page);
  await expect(chin(page, "routeChartBoth")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.LibreSpeedRouteChart.info().other)).toBe(true);
  // The legend of the lines: a sample for each direction, the second one dashed
  await expect(chin(page, "routeChartBoth").locator("svg")).toHaveCount(2);
  await expect(chin(page, "routeChartBoth").locator("svg line.route-map-leg-other")).toHaveCount(1);
  await chin(page, "routeChartBoth").locator(".route-both-button").click();
  await expect.poll(() => page.evaluate(() => window.LibreSpeedRouteChart.info().other)).toBe(false);
  await expect(chin(page, "routeChartBoth").locator("svg")).toHaveCount(0);
  expect(await page.evaluate(key => window.localStorage.getItem(key), BOTH_KEY)).toBe("off");
  // The same choice is in the table and in the map
  await page.locator('#routeViews [data-view="table"]').click();
  await expect(page.locator("#routeTableOther")).toHaveCount(0);
  await expect(chin(page, "routeTableBoth").locator(".route-both-button")).toHaveAttribute("aria-pressed", "false");
  await page.locator('#routeViews [data-view="map"]').click();
  await expect(chin(page, "routeMapBoth").locator(".route-both-button")).toHaveAttribute("aria-pressed", "false");
});

test("W5 pointing at a hop of the chart says the hop of each direction", async ({ page }) => {
  await openRoute(page, "chart");
  await trace(page);
  await paste(page);
  await expect.poll(() => page.evaluate(() => window.LibreSpeedRouteChart.info().other)).toBe(true);
  // The chart is under the fold of the window of the test: the pointer can only be over what is in view
  await page.locator("#routeChartHost canvas").scrollIntoViewIfNeeded();
  await page.locator("#routeSideClose").click();
  const box = await page.locator("#routeChartHost canvas").boundingBox();
  // Move in steps, as a mouse does: uPlot works out the rectangle of the chart when the pointer enters it. The first hop is at the left of the
  // line, and both directions have one there
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2, { steps: 8 });
  await expect(page.locator("#routeChartReadout")).toContainText("Hop 1");
  await expect(page.locator("#routeChartReadout")).toContainText("|");
  // Past the end of the shorter route (4 hops of 7) only the longer one has a hop
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height / 2, { steps: 8 });
  await expect(page.locator("#routeChartReadout")).toContainText("Hop 7");
  await expect(page.locator("#routeChartReadout")).not.toContainText("|");
});

test("W6 the choice is kept for the next visit, and 360 px has no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openRoute(page, "table");
  await trace(page);
  await paste(page);
  for (const [view, id] of [
    ["table", "routeTableBoth"],
    ["chart", "routeChartBoth"],
    ["map", "routeMapBoth"]
  ]) {
    await page.locator(`#routeViews [data-view="${view}"]`).click();
    await expect(chin(page, id)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), view).toBeLessThanOrEqual(360);
  }
  await chin(page, "routeMapBoth").locator(".route-both-button").click();
  await page.reload();
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  expect(await page.evaluate(key => window.localStorage.getItem(key), BOTH_KEY)).toBe("off");
});

test("W7 the words of the chin are in the four languages", async ({ page }) => {
  await openRoute(page, "table");
  await trace(page);
  await paste(page);
  const texts = {
    en: ["Show both directions", "You → server", "Server → you"],
    pt: ["Mostrar os dois sentidos", "Você → servidor", "Servidor → você"],
    es: ["Mostrar los dos sentidos", "Tú → servidor", "Servidor → tú"],
    sv: ["Visa båda riktningarna", "Du → servern", "Server → dig"]
  };
  const locale = lang =>
    JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "better", "locales", `${lang}.json`), "utf8")
    );
  for (const [lang, [both, back, there]] of Object.entries(texts)) {
    await page.evaluate(code => window.LibreSpeedI18n.set(code, false), lang);
    await expect(chin(page, "routeTableBoth").locator(".route-both-button")).toHaveText(both);
    expect(await ways(page, "routeTableBoth")).toEqual([back, there]);
    // The caption of the second table is in the language too
    await expect(page.locator("#routeTableOther caption")).toHaveText(locale(lang)["route.caption"]);
    await expect(page.locator("#routeTableOther caption")).not.toContainText("route.");
  }
});

test("W8 the networks on the way are of both directions when both are on, each under its own direction, and of one when it is off", async ({
  page
}) => {
  await openRoute(page, "table");
  await trace(page);
  // One route: the list as it was, with no names of directions
  await expect(page.locator("#routeGroups .route-groups-way")).toHaveCount(0);
  await expect(page.locator("#routeGroups li")).toHaveCount(3);
  await paste(page);
  await expect(page.locator("#routeGroups .route-groups-way")).toHaveText(["You → server", "Server → you"]);
  await expect(page.locator("#routeGroups ol")).toHaveCount(2);
  // The networks of the route from the server are there too (Whatbox, Cogent and Seabras), not only the ones of the pasted route
  await expect(page.locator("#routeGroups")).toContainText("Whatbox");
  await expect(page.locator("#routeGroups")).toContainText("Seabras");
  await expect(page.locator("#routeGroups .route-groups-title")).toHaveCount(1);
  // The button turns it back into one list
  await chin(page, "routeTableBoth").locator(".route-both-button").click();
  await expect(page.locator("#routeGroups ol")).toHaveCount(1);
  await expect(page.locator("#routeGroups .route-groups-way")).toHaveCount(0);
  await expect(page.locator("#routeGroups")).not.toContainText("Whatbox");
  await chin(page, "routeTableBoth").locator(".route-both-button").click();
  await expect(page.locator("#routeGroups ol")).toHaveCount(2);
});

test("W9 how the route ended and its MTU are toasts at the bottom left, said once for each route, and not a paragraph on the page", async ({
  page
}) => {
  await openRoute(page, "table");
  await expect(page.locator(".toast")).toHaveCount(0);
  await trace(page);
  const texts = async () => (await page.locator(".toast").allTextContents()).join(" | ");
  await expect.poll(texts).toContain("Path MTU: unknown");
  expect(await texts()).toContain("Your address did not answer");
  // The toasts are at the left, at the bottom of the page
  const box = await page.locator(".toast").last().boundingBox();
  const view = page.viewportSize();
  expect(box.x).toBeLessThan(view.width / 2);
  expect(box.y).toBeGreaterThan(view.height / 2);
  // The paragraphs are not on the page: they are there for a screen reader, in a box of one pixel
  for (const id of ["routeEnd", "routeMtu"]) {
    const size = await page
      .locator(`#${id}`)
      .evaluate(el => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
    expect(size.w, id).toBeLessThanOrEqual(1);
    expect(size.h, id).toBeLessThanOrEqual(1);
  }
  await expect(page.locator("#routeEnd")).toContainText("Your address did not answer");
  // Closing the toasts and redrawing the same route (another view, another language, the button for both) says nothing again
  for (let i = 0; i < 10 && (await page.locator(".toast").count()) > 0; i++) {
    // The toasts fade in and out: they are closed from the page, not with a pointer that waits for them to be still
    await page.evaluate(
      () => document.querySelector(".toast button") && document.querySelector(".toast button").click()
    );
    await page.waitForTimeout(350);
  }
  await page.locator('#routeViews [data-view="chart"]').click();
  await page.evaluate(() => window.LibreSpeedI18n.set("pt", false));
  await page.evaluate(() => window.LibreSpeedI18n.set("en", false));
  await page.waitForTimeout(600);
  await expect(page.locator(".toast")).toHaveCount(0);
  // A route that is pasted says how it ended, and that it was measured by the visitor (the route traced here is not the one that says so)
  await paste(page);
  await expect.poll(texts).toContain("The server answered");
  expect(await texts()).toContain("You measured it on your device");
});
