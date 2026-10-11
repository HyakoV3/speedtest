const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));

const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };

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

const route = (hops, extra = {}) => ({ ...fixture("normal"), pmtu: null, pmtu_drops: [], hops, ...extra });

async function openRoute(page, { post = fixture("v6"), query = "?routeview=map" } = {}) {
  const outside = [];
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (!request.url().startsWith(staticRepositoryUrl) && !request.url().startsWith("data:"))
      outside.push(request.url());
  });
  await page.route("**/backend/route.php*", handler => {
    if (handler.request().method() === "POST") return handler.fulfill({ json: post });
    return handler.fulfill({ json: CAPS });
  });
  await page.goto(`${staticRepositoryUrl}/route-better.html${query}`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  return { outside, errors };
}

const info = page => page.evaluate(() => window.LibreSpeedRouteMap.info());

// The whole world in the shape of the host: the whole width and the height of the frame of a route, centred on the world
const expectWorld = map => {
  const height = 360 / map.aspect;
  [0, (142 - height) / 2, 360, height].forEach((value, i) => expect(map.frame[i]).toBeCloseTo(value, 1));
};
const zoom = (page, action) => page.locator(`#routeMapZoom [data-zoom="${action}"]`);

async function trace(page) {
  await expect(page.locator("#routeStart")).toBeEnabled();
  await page.locator("#routeStart").click();
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
}

const viewBox = page => page.locator("#routeMapHost svg").getAttribute("viewBox");

test("the buttons: closer, farther, all the world, and back to the frame of the route", async ({ page }) => {
  const seen = await openRoute(page);
  await trace(page);
  const first = await info(page);
  expect(first.user).toBe(false);
  await expect(zoom(page, "fit")).toBeDisabled();
  await expect(zoom(page, "out")).toBeEnabled();

  await zoom(page, "in").click();
  const closer = await info(page);
  expect(closer.user).toBe(true);
  expect(closer.frame[2]).toBeCloseTo(first.frame[2] / 1.5, 1);
  await expect(zoom(page, "fit")).toBeEnabled();

  // Closer and closer: it stops at the smallest frame, and then the button is off
  for (let i = 0; i < 6; i++) if (await zoom(page, "in").isEnabled()) await zoom(page, "in").click();
  const closest = await info(page);
  expect(closest.frame[2]).toBeGreaterThanOrEqual(36 - 0.01);
  expect(closest.frame[2]).toBeLessThan(closer.frame[2]);
  await expect(zoom(page, "in")).toBeDisabled();

  await zoom(page, "out").click();
  expect((await info(page)).frame[2]).toBeGreaterThan(closest.frame[2]);
  await expect(zoom(page, "in")).toBeEnabled();

  await zoom(page, "world").click();
  expectWorld(await info(page));
  await expect(zoom(page, "out")).toBeDisabled();
  await expect(zoom(page, "world")).toBeDisabled();
  // From the whole world, closer works too
  await zoom(page, "in").click();
  expect((await info(page)).frame[2]).toBeLessThan(360);

  await zoom(page, "fit").click();
  const back = await info(page);
  expect(back.user).toBe(false);
  expect(back.frame).toEqual(first.frame);
  expect(seen.errors).toEqual([]);
  expect(seen.outside).toEqual([]);
});

test("the points, the numbers and the lines keep their size in px at every zoom", async ({ page }) => {
  await openRoute(page);
  await trace(page);
  const radius = async () => {
    const map = await info(page);
    const r = await page.locator("#routeMapHost g.route-map-node circle").first().getAttribute("r");
    return Number(r) * (map.width / map.frame[2]);
  };
  expect(await radius()).toBeCloseTo(7, 1);
  await zoom(page, "in").click();
  await zoom(page, "in").click();
  expect(await radius()).toBeCloseTo(7, 1);
  await zoom(page, "world").click();
  expect(await radius()).toBeCloseTo(7, 1);
});

test("dragging moves the map, and never out of the world", async ({ page }) => {
  const seen = await openRoute(page);
  await trace(page);
  await zoom(page, "in").click();
  await zoom(page, "in").click();
  await page.locator("#routeMapHost").scrollIntoViewIfNeeded();
  const box = await page.locator("#routeMapHost svg").boundingBox();
  const before = await info(page);
  const unit = before.frame[2] / before.width;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const moved = await info(page);
  // The map follows the hand: the frame goes the other way, by the distance of the drag
  expect(before.frame[0] - moved.frame[0]).toBeCloseTo(60 * unit, 0);
  expect(moved.frame[1]).toBeCloseTo(before.frame[1], 1);
  expect(await viewBox(page)).toBe(moved.frame.join(" "));

  // Drag after drag, to each side and up and down: the frame stops at the edge of the world, and never goes out of it
  const drag = async (dx, dy) => {
    const from = [box.x + box.width / 2 - dx / 2, box.y + box.height / 2 - dy / 2];
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    await page.mouse.move(from[0] + dx, from[1] + dy, { steps: 6 });
    await page.mouse.up();
  };
  const inside = frame => {
    expect(frame[0]).toBeGreaterThanOrEqual(0);
    expect(frame[1]).toBeGreaterThanOrEqual(0);
    expect(frame[0] + frame[2]).toBeLessThanOrEqual(360 + 0.01);
    expect(frame[1] + frame[3]).toBeLessThanOrEqual(142 + 0.01);
  };
  for (let i = 0; i < 12; i++) await drag(box.width * 0.8, box.height * 0.4);
  const topLeft = (await info(page)).frame;
  inside(topLeft);
  expect(topLeft[0]).toBe(0);
  for (let i = 0; i < 30; i++) await drag(-box.width * 0.8, -box.height * 0.4);
  const bottomRight = (await info(page)).frame;
  inside(bottomRight);
  expect(bottomRight[0] + bottomRight[2]).toBeCloseTo(360, 1);
  expect(bottomRight[1] + bottomRight[3]).toBeCloseTo(142, 1);
  expect(seen.errors).toEqual([]);

  // In the whole world there is nothing to move
  await zoom(page, "world").click();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  expectWorld(await info(page));
});

test("Ctrl + scroll zooms around the pointer, and a plain scroll is left to the page", async ({ page }) => {
  await openRoute(page);
  await trace(page);
  await page.locator("#routeMapHost").scrollIntoViewIfNeeded();
  const point = async (clientX, clientY) =>
    page.evaluate(
      ([x, y]) => {
        const f = window.LibreSpeedRouteMap.info().frame;
        const box = document.querySelector("#routeMapHost svg").getBoundingClientRect();
        return [f[0] + ((x - box.left) / box.width) * f[2], f[1] + ((y - box.top) / box.height) * f[3]];
      },
      [clientX, clientY]
    );
  const wheel = (clientX, clientY, deltaY, ctrlKey) =>
    page.evaluate(
      ([x, y, dy, ctrl]) => {
        const event = new WheelEvent("wheel", {
          clientX: x,
          clientY: y,
          deltaY: dy,
          ctrlKey: ctrl,
          bubbles: true,
          cancelable: true
        });
        document.querySelector("#routeMapHost").dispatchEvent(event);
        return event.defaultPrevented;
      },
      [clientX, clientY, deltaY, ctrlKey]
    );
  const box = await page.locator("#routeMapHost svg").boundingBox();
  const x = box.x + box.width * 0.7;
  const y = box.y + box.height * 0.3;
  const before = await info(page);

  expect(await wheel(x, y, -100, false)).toBe(false);
  expect((await info(page)).frame).toEqual(before.frame);

  const under = await point(x, y);
  expect(await wheel(x, y, -100, true)).toBe(true);
  const after = await info(page);
  expect(after.frame[2]).toBeLessThan(before.frame[2]);
  const still = await point(x, y);
  expect(still[0]).toBeCloseTo(under[0], 0);
  expect(still[1]).toBeCloseTo(under[1], 0);

  // And the other way round
  expect(await wheel(x, y, 100, true)).toBe(true);
  expect((await info(page)).frame[2]).toBeGreaterThan(after.frame[2]);
});

test("two fingers zoom, and one finger moves the map only after a zoom", async ({ page }) => {
  const seen = await openRoute(page);
  await trace(page);
  await page.locator("#routeMapHost").scrollIntoViewIfNeeded();
  const box = await page.locator("#routeMapHost svg").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const fire = (type, id, x, y) =>
    page.evaluate(
      ([t, i, px, py]) => {
        document.querySelector("#routeMapHost").dispatchEvent(
          new PointerEvent(t, {
            pointerId: i,
            pointerType: "touch",
            clientX: px,
            clientY: py,
            bubbles: true,
            isPrimary: i === 1
          })
        );
      },
      [type, id, x, y]
    );

  // One finger, before any zoom: the page scrolls, the map stays
  const start = await info(page);
  await fire("pointerdown", 1, cx, cy);
  await fire("pointermove", 1, cx + 50, cy);
  await fire("pointerup", 1, cx + 50, cy);
  expect((await info(page)).frame).toEqual(start.frame);

  // Two fingers moving apart zoom in
  await fire("pointerdown", 1, cx - 30, cy);
  await fire("pointerdown", 2, cx + 30, cy);
  await fire("pointermove", 2, cx + 90, cy);
  const pinched = await info(page);
  expect(pinched.user).toBe(true);
  expect(pinched.frame[2]).toBeLessThan(start.frame[2]);
  await fire("pointerup", 1, cx - 30, cy);
  await fire("pointerup", 2, cx + 90, cy);

  // Now a finger moves the map, and the host does not leave the scroll to the page (touch-action: none)
  const zoomed = await info(page);
  await fire("pointerdown", 3, cx, cy);
  await fire("pointermove", 3, cx + 40, cy);
  await fire("pointerup", 3, cx + 40, cy);
  expect((await info(page)).frame[0]).not.toBe(zoomed.frame[0]);
  expect(await page.locator("#routeMapHost").evaluate(node => getComputedStyle(node).touchAction)).toBe("none");
  expect(seen.errors).toEqual([]);
});

test("a new route goes back to its own frame, and the language does not undo the zoom", async ({ page }) => {
  await openRoute(page);
  await trace(page);
  const first = await info(page);
  await zoom(page, "in").click();
  const zoomed = await info(page);
  expect(await page.locator("#routeMapHost").evaluate(node => getComputedStyle(node).touchAction)).toBe("none");

  await page.evaluate(() => window.LibreSpeedI18n.set("pt", false));
  await expect(zoom(page, "world")).toHaveText("Mundo");
  const portuguese = await info(page);
  expect(portuguese.user).toBe(true);
  expect(portuguese.frame).toEqual(zoomed.frame);

  await page.locator("#routeStart").click();
  await expect.poll(async () => (await info(page)).user).toBe(false);
  expect((await info(page)).frame).toEqual(first.frame);
  expect(await page.locator("#routeMapHost").evaluate(node => getComputedStyle(node).touchAction)).toBe("pan-x pan-y");
});

test("a window of another width keeps the zoom of the person", async ({ page }) => {
  await openRoute(page);
  await trace(page);
  await zoom(page, "in").click();
  const wide = await info(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await expect.poll(async () => (await info(page)).width).toBeLessThan(wide.width);
  const narrow = await info(page);
  expect(narrow.user).toBe(true);
  expect(narrow.frame[2]).toBeCloseTo(wide.frame[2], 1);
  // The same middle of the map, in the shape of the narrow host
  expect(narrow.frame[0] + narrow.frame[2] / 2).toBeCloseTo(wide.frame[0] + wide.frame[2] / 2, 0);
});

test("the controls have names in the language of the page, and a size for a finger", async ({ page }) => {
  await openRoute(page, { query: "?routeview=map&lang=pt" });
  await trace(page);
  await expect(page.locator("#routeMapZoom")).toHaveAttribute("role", "group");
  await expect(page.locator("#routeMapZoom")).toHaveAttribute("aria-label", "Zoom");
  await expect(zoom(page, "in")).toHaveAttribute("aria-label", "Aproximar");
  await expect(zoom(page, "out")).toHaveAttribute("aria-label", "Afastar");
  await expect(zoom(page, "world")).toHaveText("Mundo");
  await expect(zoom(page, "fit")).toHaveText("Rota");
  for (const action of ["in", "out", "world", "fit"]) {
    const box = await zoom(page, action).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(39);
    expect(box.width).toBeGreaterThanOrEqual(39);
  }
});

test("a route that goes round the date line is the whole world, and it can be zoomed and brought back", async ({
  page
}) => {
  const post = route([hop(1, "JP"), hop(2, "JP"), hop(3, "US"), hop(4, "US")]);
  const seen = await openRoute(page, { post });
  await trace(page);
  expectWorld(await info(page));
  await zoom(page, "in").click();
  const closer = await info(page);
  expect(closer.frame[2]).toBeLessThan(360);
  expect(closer.frame[0]).toBeGreaterThanOrEqual(0);
  await zoom(page, "fit").click();
  expectWorld(await info(page));
  expect(seen.errors).toEqual([]);
});

test("the map has the same shape in the whole world and in the frame of the route", async ({ page }) => {
  for (const width of [360, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    await openRoute(page, { query: "?routeview=map" });
    await trace(page);
    await expect(page.locator("#routeMapHost svg")).toBeVisible();
    const height = () =>
      page.locator("#routeMapHost").evaluate(node => Math.round(node.getBoundingClientRect().height));
    const route = await height();
    await zoom(page, "world").click();
    expect(await height(), `world at ${width}px`).toBe(route);
    await zoom(page, "fit").click();
    expect(await height(), `route at ${width}px`).toBe(route);
    // The sea fills the frame of the world, over and under the land
    await zoom(page, "world").click();
    const sea = await page.locator("#routeMapHost .route-map-sea").evaluate(node => {
      const box = node.getBBox();
      const view = node.ownerSVGElement.viewBox.baseVal;
      return box.y <= view.y + 0.01 && box.y + box.height >= view.y + view.height - 0.01;
    });
    expect(sea).toBe(true);
  }
});
