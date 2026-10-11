const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));

const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };

const isChartFile = url => ["uPlot.iife.min.js", "colors.js", "route-chart.js"].some(name => url.endsWith(name));

// Opens the route page with route.php answered by the test. The requests for the files of the chart are counted in seen.chart
async function openRoute(page, { post = fixture("normal"), query = "" } = {}) {
  const seen = { posts: 0, chart: [] };
  page.on("request", request => {
    if (isChartFile(request.url())) seen.chart.push(request.url().split("/").pop());
  });
  await page.route("**/backend/route.php*", route => {
    if (route.request().method() === "POST") {
      seen.posts += 1;
      return route.fulfill({ json: post });
    }
    return route.fulfill({ json: CAPS });
  });
  await page.goto(`${staticRepositoryUrl}/route-better.html${query}`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  return seen;
}

const start = page => page.locator("#routeStart");
const rows = page => page.locator("#routeTable tbody tr");
const views = page => page.locator("#routeViews");
const button = (page, view) => page.locator(`#routeViews [data-view="${view}"]`);

async function trace(page) {
  await expect(start(page)).toBeEnabled();
  await start(page).click();
  await expect(views(page)).toBeVisible();
}

const info = page => page.evaluate(() => window.LibreSpeedRouteChart.info());

async function openChart(page) {
  await button(page, "chart").click();
  await expect(page.locator("#routeChartHost canvas")).toBeVisible();
}

test("the table is the default and nothing of the chart is asked before it is chosen", async ({ page }) => {
  const seen = await openRoute(page);
  await page.waitForTimeout(1500);
  // The menu is there before a route, with the table pressed; the chart is not shown and nothing of it is asked
  await expect(views(page)).toBeVisible();
  await expect(button(page, "table")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#routeChart")).toBeHidden();
  await trace(page);
  await expect(button(page, "table")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#routeTableWrap")).toBeVisible();
  await expect(page.locator("#routeChart")).toHaveAttribute("hidden", "");
  await page.waitForTimeout(1500);
  expect(seen.chart).toEqual([]);
});

test("choosing the chart asks for its files once, and switching back and forth asks for nothing more", async ({
  page
}) => {
  const seen = await openRoute(page);
  await trace(page);
  await openChart(page);
  expect(seen.chart.sort()).toEqual(["colors.js", "route-chart.js", "uPlot.iife.min.js"]);
  await expect(page.locator("#routeTableWrap")).toBeHidden();
  await expect(button(page, "chart")).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, "table")).toHaveAttribute("aria-pressed", "false");
  await button(page, "table").click();
  await expect(page.locator("#routeTableWrap")).toBeVisible();
  await expect(page.locator("#routeChart")).toBeHidden();
  await openChart(page);
  expect(seen.chart).toHaveLength(3);
});

test("the keyboard switches the views", async ({ page }) => {
  await openRoute(page);
  await trace(page);
  await button(page, "chart").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#routeChartHost canvas")).toBeVisible();
  await button(page, "table").focus();
  await page.keyboard.press(" ");
  await expect(page.locator("#routeTableWrap")).toBeVisible();
});

test("chartData: the hops with no answer are gaps, a slow router is told, the marks come from the answer", async ({
  page
}) => {
  await openRoute(page);
  const data = name => page.evaluate(d => window.LibreSpeedRouteView.chartData(d), fixture(name));

  const normal = await data("normal");
  expect(normal.y[11]).toBeNull();
  expect(normal.x).toHaveLength(13);
  expect(normal.slow.some(Boolean)).toBe(false);
  expect(normal.jump).toBeNull();
  expect(normal.drops).toEqual([{ x: 2.5, from: 1500, to: 1480 }]);
  expect(normal.target).toBe(13);
  // The first hops are the internal network (grey in the chart), the hop 11 is public
  expect(normal.internal[0]).toBe(true);
  expect(normal.internal[9]).toBe(true);
  expect(normal.internal[10]).toBe(false);
  expect(normal.yMax).toBe(20);

  // A hop with no answer that carries a time in old data: the scope wins
  const jump = await data("jump");
  expect(jump.y[11]).toBeNull();
  expect(jump.jump).toEqual({ from: 9, to: 10, ms: 108 });
  expect(jump.yMax).toBe(150);

  const v6 = await data("v6");
  expect(v6.slow.map((value, i) => (value ? i : -1)).filter(i => i >= 0)).toEqual([3, 6]);
  expect(v6.line[3]).toBe(0.67);
  expect(v6.line[6]).toBe(1.84);
  expect(v6.drops).toEqual([]);
  expect(v6.target).toBeNull();

  const tail = await data("silent-tail");
  expect(tail.y[1]).toBeNull();
  expect(tail.first).toEqual({ ttl: 1, ms: 0.2 });
  expect(tail.last).toEqual({ ttl: 9, ms: 17.5 });

  const empty = await data("empty");
  expect(empty.x).toEqual([]);
  expect(empty.first).toBeNull();
  expect(empty.yMax).toBe(10);
});

test("the choice is kept, the URL wins over it, and a blocked storage does not break the page", async ({ page }) => {
  await openRoute(page);
  await trace(page);
  await openChart(page);
  await page.reload();
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  await trace(page);
  await expect(page.locator("#routeChartHost canvas")).toBeVisible();

  await page.goto(`${staticRepositoryUrl}/route-better.html?routeview=table`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  await trace(page);
  await expect(page.locator("#routeTableWrap")).toBeVisible();
  await expect(page.locator("#routeChart")).toBeHidden();

  const blocked = await page.context().newPage();
  const errors = [];
  blocked.on("pageerror", error => errors.push(error.message));
  await blocked.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      }
    });
  });
  await openRoute(blocked);
  await trace(blocked);
  await openChart(blocked);
  await button(blocked, "table").click();
  await expect(blocked.locator("#routeTableWrap")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the chart is painted again when the theme, the contrast, the text size or the language change", async ({
  page
}) => {
  await openRoute(page, { query: "?theme=light&lang=en" });
  await trace(page);
  await openChart(page);
  const before = await info(page);

  await page.evaluate(() => window.LibreSpeedTheme.set("dark", false));
  await expect.poll(async () => (await info(page)).builds).toBeGreaterThan(before.builds);
  const dark = await info(page);
  expect(dark.primary).not.toBe(before.primary);

  // The accessibility script listens to clicks on these attributes, so a button that is not in the panel is enough
  await page.evaluate(() => {
    const toggle = document.createElement("button");
    toggle.setAttribute("data-contrast-toggle", "");
    document.body.appendChild(toggle);
    toggle.click();
    toggle.remove();
  });
  await expect.poll(async () => (await info(page)).builds).toBeGreaterThan(dark.builds);
  const contrast = await info(page);
  expect(contrast.primary).not.toBe(dark.primary);

  await page.evaluate(() => {
    const larger = document.createElement("button");
    larger.setAttribute("data-text-size", "larger");
    document.body.appendChild(larger);
    larger.click();
    larger.remove();
  });
  await expect.poll(async () => (await info(page)).height).toBeGreaterThan(contrast.height);

  await page.evaluate(() => window.LibreSpeedI18n.set("pt", false));
  await expect.poll(async () => (await info(page)).xLabel).toBe("Salto");
  await expect(button(page, "chart")).toHaveText("Gráfico");
  await expect(page.locator("#routeChartSummary")).toContainText("De ");
});

test("a narrow screen, dark theme: the chart fits, and follows the window", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openRoute(page, { query: "?theme=dark&routeview=chart" });
  await trace(page);
  await expect(page.locator("#routeChartHost canvas")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true
  );
  const narrow = await info(page);
  const hostWidth = await page.locator("#routeChartHost").evaluate(element => element.clientWidth);
  expect(narrow.width).toBeLessThanOrEqual(hostWidth);

  await page.setViewportSize({ width: 1000, height: 740 });
  await expect.poll(async () => (await info(page)).width).toBeGreaterThan(narrow.width);
});

test("a chart that cannot be loaded is told, the table stays, and choosing it again tries again", async ({ page }) => {
  await openRoute(page);
  await page.route("**/uPlot.iife.min.js", route => route.abort());
  await trace(page);
  await button(page, "chart").click();
  await expect(page.locator("#routeStatus")).toContainText("could not be loaded");
  await expect(button(page, "table")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#routeTableWrap")).toBeVisible();

  await page.unroute("**/uPlot.iife.min.js");
  await openChart(page);
  await expect(page.locator("#routeStatus")).toHaveText("");
});

test("the marks come from the answer: where the MTU drops, the largest rise, a slow router", async ({ page }) => {
  await openRoute(page);
  await trace(page);
  await openChart(page);
  expect((await info(page)).drops).toBe(1);
  await expect(page.locator('#routeChart .route-chart-key li[data-key="mtu"]')).toBeVisible();
  await expect(page.locator('#routeChart .route-chart-key li[data-key="silent"]')).toBeVisible();
  await expect(page.locator('#routeChart .route-chart-key li[data-key="you"]')).toBeVisible();
  await expect(page.locator('#routeChart .route-chart-key li[data-key="jump"]')).toHaveAttribute("hidden", "");

  // The route of the Frigga demo: the MTU is unknown, so there is no mark for it
  const unknown = { ...fixture("normal"), pmtu: null, pmtu_drops: [] };
  const second = await page.context().newPage();
  await openRoute(second, { post: unknown, query: "?routeview=chart" });
  await trace(second);
  await expect(second.locator("#routeChartHost canvas")).toBeVisible();
  expect((await info(second)).drops).toBe(0);
  await expect(second.locator('#routeChart .route-chart-key li[data-key="mtu"]')).toHaveAttribute("hidden", "");

  const third = await page.context().newPage();
  await openRoute(third, { post: fixture("jump"), query: "?routeview=chart" });
  await trace(third);
  await expect(third.locator('#routeChart .route-chart-key li[data-key="jump"]')).toBeVisible();

  const fourth = await page.context().newPage();
  await openRoute(fourth, { post: fixture("v6"), query: "?routeview=chart" });
  await trace(fourth);
  await expect(fourth.locator('#routeChart .route-chart-key li[data-key="slow"]')).toBeVisible();
});

test("pointing at the chart reads the hop as text, and a name with HTML in it is never run", async ({ page }) => {
  await openRoute(page, { post: fixture("xss"), query: "?routeview=chart" });
  await trace(page);
  await expect(page.locator("#routeChartHost canvas")).toBeVisible();
  const over = page.locator("#routeChartHost .u-over");
  // The chart is below the fold: a pointer outside the window sends no events
  await over.scrollIntoViewIfNeeded();
  const box = await over.boundingBox();
  // Move in steps, as a mouse does: uPlot works out the rectangle of the chart when the pointer enters it
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width * 0.97, box.y + box.height / 2, { steps: 6 });
  await expect(page.locator("#routeChartReadout")).toContainText("Hop 13");
  await expect(page.locator("#routeChartReadout")).toContainText("ms");

  // The first public hop of the fixture has the name with HTML: its hop is read as text
  const hop = fixture("xss").hops.find(item => item.scope === "public");
  const x = box.x + (box.width * (hop.ttl - 0.5)) / 13.0;
  await page.mouse.move(x, box.y + box.height / 2, { steps: 6 });
  await expect(page.locator("#routeChartReadout")).toContainText(`Hop ${hop.ttl}`);
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
  await expect(page.locator("#routeChartReadout img")).toHaveCount(0);
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
  await openChart(page);
  await page.evaluate(() => window.LibreSpeedTheme.set("dark", false));
  await expect.poll(async () => (await info(page)).builds).toBeGreaterThan(1);
  await button(page, "table").click();
  await expect(rows(page).first()).toBeVisible();
  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});
