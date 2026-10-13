const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";
const root = path.join(__dirname, "..", "..");

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));

const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };

// Opens the route page with route.php answered by the test; delay holds the answer of the POST for that many ms
async function openRoute(page, { post = fixture("normal"), caps = CAPS, delay = 0, query = "" } = {}) {
  const seen = { posts: 0, errors: [] };
  page.on("pageerror", error => seen.errors.push(error.message));
  await page.route("**/backend/route.php*", async handler => {
    if (handler.request().method() === "POST") {
      seen.posts += 1;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      return handler.fulfill({ json: post });
    }
    if (typeof caps === "number") return handler.fulfill({ status: caps, json: { v: 1, enabled: false } });
    return handler.fulfill({ json: caps });
  });
  await page.goto(`${staticRepositoryUrl}/route-better.html${query}`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  return seen;
}

const start = page => page.locator("#routeStart");

test("the first screen has the action, and the table, the chart and the map blank and ready: only what a route tells is not shown", async ({
  page
}) => {
  const seen = await openRoute(page);
  await expect(start(page)).toBeEnabled();
  await expect(page.locator(".route-intro, .route-consent")).toHaveCount(0);
  // What is told about a route is not there before it
  for (const id of ["routeSummary", "routeShowing", "routeGroups", "routeEnd", "routeMtu"]) {
    await expect(page.locator(`#${id}`), id).toBeHidden();
  }
  // The menu and the view that is chosen (the table by default) are there, with no data
  await expect(page.locator("#routeViews")).toBeVisible();
  await expect(page.locator("#routeViews [data-view]")).toHaveCount(3);
  await expect(page.locator('#routeViews [data-view="table"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#routeTableWrap")).toBeVisible();
  await expect(page.locator("#routeTable tbody tr")).toHaveCount(0);

  // The chart and the map are blank boxes with their chin, with no files asked and no drawing
  await page.locator('#routeViews [data-view="chart"]').click();
  await expect(page.locator("#routeChart")).toBeVisible();
  await expect(page.locator("#routeChartHost")).toBeVisible();
  await expect(page.locator("#routeChartHost canvas")).toHaveCount(0);
  expect((await page.locator("#routeChartHost").boundingBox()).height).toBeGreaterThan(200);
  await expect(page.locator("#routeChart .route-chart-key")).toBeVisible();
  await page.locator('#routeViews [data-view="map"]').click();
  await expect(page.locator("#routeMap")).toBeVisible();
  await expect(page.locator("#routeMapHost")).toBeVisible();
  await expect(page.locator("#routeMapHost svg")).toHaveCount(0);
  expect((await page.locator("#routeMapHost").boundingBox()).height).toBeGreaterThan(150);
  await expect(page.locator("#routeMapZoom .route-chin, #routeMapZoom.route-chin")).toBeVisible();
  for (const action of ["in", "out", "world", "fit"]) {
    await expect(page.locator(`#routeMapZoom [data-zoom="${action}"]`)).toBeDisabled();
  }
  await page.waitForTimeout(800);
  expect(seen.errors).toEqual([]);
  await page.locator('#routeViews [data-view="table"]').click();
});

test("the button is in the middle of the page, at every width, before and after a route", async ({ page }) => {
  await openRoute(page);
  for (const width of [1280, 768, 360]) {
    await page.setViewportSize({ width, height: 800 });
    const box = await start(page).boundingBox();
    expect(Math.abs(box.x + box.width / 2 - width / 2), `before, ${width}px`).toBeLessThanOrEqual(1);
  }
  await expect(start(page)).toBeEnabled();
  await start(page).click();
  await expect(page.locator("#routeSummary")).toBeVisible();
  for (const width of [1280, 768, 360]) {
    await page.setViewportSize({ width, height: 800 });
    const box = await start(page).boundingBox();
    expect(Math.abs(box.x + box.width / 2 - width / 2), `after, ${width}px`).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `no scroll, ${width}px`
    ).toBe(true);
  }
});

test("what to keep in mind is a toast after the route, once in each session, in the language of the page", async ({
  page
}) => {
  await openRoute(page, { query: "?lang=pt" });
  // Before the route: no toast, and no box with the text on the page
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(page.locator(".route-about")).toHaveCount(0);
  await expect(start(page)).toBeEnabled();
  await start(page).click();
  await expect(page.locator("#routeSummary")).toBeVisible();
  // The toasts of a route: how to read it and where the history keeps the addresses (once in each session), and how it ended and its MTU (each
  // time). Up to three are on the page at once, the others wait: each is closed to see the next
  const collect = async () => {
    const seen = [];
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(250);
      const texts = await page.locator(".toast").allTextContents();
      if (!texts.length) break;
      texts.forEach(text => seen.includes(text) || seen.push(text));
      await page.locator(".toast button").first().click();
    }
    return seen.join(" | ");
  };
  const first = await collect();
  expect(first).toContain("Este é o caminho do servidor até você");
  expect(first).toContain("só neste navegador");
  expect(first).toContain("MTU");
  // It stays long enough to be read
  const time = await page.evaluate(() => window.LibreSpeedToast.readTime(window.LibreSpeedI18n.t("route.notice", "")));
  expect(time).toBeGreaterThanOrEqual(10000);

  // A second route in the same session does not repeat the two that are said once, and says its own end and MTU
  await expect(start(page)).toBeEnabled();
  await start(page).click();
  await expect(start(page)).toBeEnabled();
  const second = await collect();
  expect(second).not.toContain("Este é o caminho do servidor até você");
  expect(second).not.toContain("só neste navegador");
  expect(second).toContain("MTU");
});

test("what a route tells stays out of the page even when the style sheet of the browser is an old one", async ({
  page
}) => {
  // The old style sheet had rules with a display and no rule for the hidden attribute: they showed before the route
  const css = fs.readFileSync(path.join(root, "frontend", "better", "styling", "route.css"), "utf8");
  const old = css.replace(/#routeArea \[hidden\],\n#routeSide \[hidden\] \{[^}]*\}/, "");
  expect(old.length).toBeLessThan(css.length);
  await page.route("**/styling/route.css*", handler => handler.fulfill({ body: old, contentType: "text/css" }));
  await openRoute(page);
  for (const id of ["routeSummary", "routeShowing", "routeGroups", "routeEnd", "routeMtu", "routeChart", "routeMap"]) {
    await expect(page.locator(`#${id}`), id).toBeHidden();
  }
  await expect(page.locator("#routeViews")).toBeVisible();
});

test("while the route is traced the button says so, it cannot be pressed twice, and it comes back", async ({
  page
}) => {
  const seen = await openRoute(page, { delay: 1200 });
  await expect(start(page)).toHaveText("Start");
  await start(page).click();
  await expect(start(page)).toHaveText("Tracing…");
  await expect(start(page)).toBeDisabled();
  await expect(start(page)).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#routeStatus .route-spinner")).toHaveCount(1);
  await start(page).click({ force: true });
  await expect(page.locator("#routeSummary")).toBeVisible();
  await expect(start(page)).toHaveText("Start");
  await expect(start(page)).not.toHaveAttribute("aria-busy", "true");
  await expect(start(page)).toBeEnabled();
  expect(seen.posts).toBe(1);
  expect(seen.errors).toEqual([]);
});

test("the summary has the numbers of the route, and the result is read from the top: summary, networks, views", async ({
  page
}) => {
  const data = fixture("normal");
  await openRoute(page, { post: data });
  await start(page).click();
  await expect(page.locator("#routeSummary")).toBeVisible();
  await expect(page.locator("#routeStatHops")).toHaveText(String(data.hops.length));
  const networks = await page.evaluate(d => window.LibreSpeedRouteView.groups(d.hops).length, data);
  await expect(page.locator("#routeStatNetworks")).toHaveText(String(networks));
  const last = [...data.hops].reverse().find(hop => hop.scope !== "none" && typeof hop.rtt_min === "number");
  await expect(page.locator("#routeStatTime")).toHaveText(`${last.rtt_min.toFixed(1)} ms`);
  await expect(page.locator("#routeEnd")).toBeVisible();
  await expect(page.locator("#routeMtu")).toBeVisible();

  const top = id => page.locator(id).evaluate(node => node.getBoundingClientRect().top);
  // The networks on the way are inside the card of the summary, under the numbers, the end and the MTU
  await expect(page.locator("#routeSummary #routeGroups")).toBeVisible();
  expect(await top("#routeSummary")).toBeLessThan(await top("#routeGroups"));
  expect(await top("#routeMtu")).toBeLessThan(await top("#routeGroups"));
  expect(
    await page.evaluate(() => {
      const card = document.getElementById("routeSummary").getBoundingClientRect();
      const groups = document.getElementById("routeGroups").getBoundingClientRect();
      return groups.bottom <= card.bottom && groups.top >= card.top;
    })
  ).toBe(true);
  expect(await top("#routeGroups")).toBeLessThan(await top("#routeViews"));
  expect(await top("#routeViews")).toBeLessThan(await top("#routeTableWrap"));
  // The summary is in the language of the page
  await page.evaluate(() => window.LibreSpeedI18n.set("pt", false));
  await expect(page.locator("#routeSummaryTitle")).toHaveText("Resumo da rota");
  await expect(start(page)).toHaveText("Iniciar");
});

test("the states that are not a route are told with the button back: not available, a limit, an error", async ({
  page
}) => {
  await openRoute(page, { caps: 404 });
  await expect(page.locator("#routeStatus")).toContainText("not available");
  await expect(start(page)).toBeDisabled();
  await expect(page.locator("#routeSummary")).toBeHidden();

  const second = await page.context().newPage();
  await second.route("**/backend/route.php*", handler => {
    if (handler.request().method() === "POST") return handler.fulfill({ status: 500, body: "boom" });
    return handler.fulfill({ json: CAPS });
  });
  await second.goto(`${staticRepositoryUrl}/route-better.html`);
  await second.waitForFunction(() => !!window.LibreSpeedI18n);
  await second.evaluate(() => window.LibreSpeedI18n.ready);
  await expect(second.locator("#routeStart")).toBeEnabled();
  await second.locator("#routeStart").click();
  await expect(second.locator("#routeStatus")).toContainText("could not be traced");
  await expect(second.locator("#routeStart")).toBeEnabled();
  await expect(second.locator("#routeStart")).toHaveText("Start");
  await expect(second.locator("#routeSummary")).toBeHidden();
});

test("the link of the menus is named like the other ones, in the four languages", async () => {
  const names = { en: "Trace Route", pt: "Traçar rota", es: "Trazar ruta", sv: "Spåra väg" };
  for (const [language, name] of Object.entries(names)) {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(root, "frontend", "better", "locales", `${language}.json`), "utf8")
    );
    expect(catalog["route.link"], language).toBe(name);
  }
  for (const page of ["index-better.html", "stability-better.html"]) {
    const html = fs.readFileSync(path.join(root, page), "utf8");
    expect(html, page).toMatch(/<a id="routeLink" hidden [^>]*data-i18n="route\.link"[^>]*>Trace Route<\/a>/);
  }
});

test("the chart and the map have a chin attached below them: the legend of the chart, the controls of the map", async ({
  page
}) => {
  const geometry = (selectors, view) =>
    page.evaluate(
      ([ids, name]) => {
        const box = id => document.querySelector(id).getBoundingClientRect();
        return { view: name, boxes: ids.map(id => ({ id, top: box(id).top, bottom: box(id).bottom })) };
      },
      [selectors, view]
    );
  await openRoute(page, { query: "?routeview=chart" });
  await start(page).click();
  await expect(page.locator("#routeChartHost canvas")).toBeVisible();
  // The legend is inside the box of the chart, under the drawing with no gap, and the texts are under the box
  await expect(page.locator("#routeChart .route-figure > #routeChartHost")).toHaveCount(1);
  await expect(page.locator("#routeChart .route-figure > .route-chart-key.route-chin")).toBeVisible();
  const chart = (
    await geometry(
      ["#routeChartHost", ".route-chart-key", ".route-figure", "#routeChartTitle", "#routeChartSummary"],
      "chart"
    )
  ).boxes;
  const at = id => chart.find(item => item.id === id);
  expect(Math.abs(at("#routeChartHost").bottom - at(".route-chart-key").top)).toBeLessThanOrEqual(1);
  expect(at(".route-chart-key").bottom).toBeLessThanOrEqual(at(".route-figure").bottom + 1);
  expect(at("#routeChartTitle").top).toBeGreaterThanOrEqual(at(".route-figure").bottom);
  expect(at("#routeChartSummary").top).toBeGreaterThanOrEqual(at("#routeChartTitle").bottom);

  await page.locator('#routeViews [data-view="map"]').click();
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  await expect(page.locator("#routeMap .route-figure > #routeMapHost")).toHaveCount(1);
  await expect(page.locator("#routeMap .route-figure > #routeMapZoom.route-chin")).toBeVisible();
  const map = (await geometry(["#routeMapHost", "#routeMapZoom", ".route-map .route-figure"], "map")).boxes;
  const inMap = id => map.find(item => item.id === id);
  expect(Math.abs(inMap("#routeMapHost").bottom - inMap("#routeMapZoom").top)).toBeLessThanOrEqual(1);
  expect(inMap("#routeMapZoom").bottom).toBeLessThanOrEqual(inMap(".route-map .route-figure").bottom + 1);
  // The chin is of another color than the drawing, so it is told apart from it
  const colors = await page.evaluate(() => ({
    chin: getComputedStyle(document.getElementById("routeMapZoom")).backgroundColor,
    figure: getComputedStyle(document.querySelector(".route-map .route-figure")).backgroundColor
  }));
  expect(colors.chin).not.toBe(colors.figure);
});

test("the table of the hops stays a table on a narrow screen, with its heads: only the history of periods has cards", async ({
  page
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openRoute(page);
  await start(page).click();
  await expect(page.locator("#routeTable tbody tr").first()).toBeVisible();
  const state = await page.evaluate(() => {
    const table = document.getElementById("routeTable");
    const head = table.querySelector("thead th").getBoundingClientRect();
    return {
      table: getComputedStyle(table).display,
      row: getComputedStyle(table.querySelector("tbody tr")).display,
      cell: getComputedStyle(table.querySelector("tbody td")).display,
      headDrawn: head.width > 8 && head.height > 8
    };
  });
  expect(state).toEqual({ table: "table", row: "table-row", cell: "table-cell", headDrawn: true });
});
