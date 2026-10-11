const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));

const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };
const KEY = "librespeed-better-route-history";
const SUMMARY = "librespeed-better-route-history-summary";
const VIEW = "librespeed-better-history-view";
const IP = /\b\d{1,3}(\.\d{1,3}){3}\b|[0-9a-f]{1,4}(:[0-9a-f]{0,4}){3,}/i;
const NOW = "2026-10-09T15:00:00Z";

test.use({ timezoneId: "America/Sao_Paulo" });

// A saved route made by the test: the numbers of a route, and the route itself when data is given
const saved = (time, extra = {}, data = null) => ({
  t: typeof time === "number" ? time : Date.parse(time),
  f: 4,
  hops: 13,
  nets: 4,
  ms: 16.9,
  mtu: 1480,
  reached: true,
  as: "AS64500",
  path: "AS3356>AS15169",
  changed: null,
  jump: null,
  ...(data ? { data } : {}),
  ...extra
});

const row = entry => {
  const { jump, data, ...rest } = entry;
  return rest;
};

// Opens the route page with route.php answered by the test (post can be a list: one answer for each route traced)
async function openRoute(page, { post = fixture("normal"), caps = CAPS, seed = {}, query = "", delay = 0 } = {}) {
  const seen = { posts: 0, errors: [], requests: [] };
  page.on("pageerror", error => seen.errors.push(error.message));
  page.on("request", request => seen.requests.push(request.url()));
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(
    values => {
      if (window.sessionStorage.getItem("__seeded")) return;
      window.sessionStorage.setItem("__seeded", "1");
      for (const [key, value] of Object.entries(values)) window.localStorage.setItem(key, value);
    },
    Object.fromEntries(
      Object.entries(seed).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])
    )
  );
  await page.route("**/backend/route.php*", async handler => {
    if (handler.request().method() === "POST") {
      const answers = Array.isArray(post) ? post : [post];
      const answer = answers[Math.min(seen.posts, answers.length - 1)];
      seen.posts += 1;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      return handler.fulfill({ json: answer });
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
const stored = (page, key) => page.evaluate(name => JSON.parse(window.localStorage.getItem(name)), key);

async function trace(page) {
  await expect(start(page)).toBeEnabled();
  await start(page).click();
  await expect(page.locator("#routeSummary")).toBeVisible();
  await expect(start(page)).toBeEnabled();
}

// The time of each route is the clock of the test: it moves between two routes so that they are not the same one
async function later(page, minutes) {
  await page.clock.setFixedTime(new Date(Date.parse(NOW) + minutes * 60000));
}

test("H1 a page with no saved route has no history, and one route makes it appear", async ({ page }) => {
  await openRoute(page);
  await expect(page.locator("#historySection")).toBeHidden();
  await trace(page);
  await expect(page.locator("#historySection")).toBeVisible();
  await expect(page.locator("#historyList .history-panel")).toHaveCount(1);
});

test("H2 a route is saved with its data, and its row of the summary has exactly its fields and no address", async ({
  page
}) => {
  const seen = await openRoute(page);
  await trace(page);
  const list = await stored(page, KEY);
  expect(list).toHaveLength(1);
  expect(Object.keys(list[0]).sort()).toEqual(
    ["as", "changed", "data", "f", "hops", "jump", "mtu", "nets", "ms", "path", "reached", "t"].sort()
  );
  expect(list[0].data.hops).toHaveLength(13);
  expect(list[0]).toMatchObject({ f: 4, hops: 13, as: "AS15169", reached: true, mtu: 1480, changed: null });
  const rows = (await stored(page, SUMMARY)).rows;
  expect(rows).toHaveLength(1);
  expect(Object.keys(rows[0]).sort()).toEqual(
    ["as", "changed", "f", "hops", "mtu", "ms", "nets", "path", "reached", "t"].sort()
  );
  expect(JSON.stringify(rows)).not.toMatch(IP);
  expect(seen.errors).toEqual([]);
});

test("H3 the panel tells the date, the IP version, the hops and the last answer, and its body the numbers", async ({
  page
}) => {
  await openRoute(page);
  await trace(page);
  const header = page.locator("#historyList .history-header").first();
  await expect(header).toContainText("12:00");
  await expect(header).toContainText("IPv4");
  await expect(header).toContainText("13 hops");
  await header.click();
  const body = page.locator("#historyList .history-body").first();
  await expect(body).toContainText("Hops");
  await expect(body).toContainText("13");
  await expect(body).toContainText(await page.locator("#routeStatTime").innerText());
  await expect(body).toContainText("1480");
  await expect(body).toContainText("AS15169");
  // The way to show the route is an icon in the header of the panel, like the share and the download ones in the other pages
  const icon = page.locator("#historyList .history-panel").first().locator(".history-bar > .history-action-btn");
  await expect(icon).toHaveAttribute("title", "Show this route");
  await expect(icon).toHaveAttribute("aria-label", "Show this route");
  await expect(icon.locator("svg")).toHaveCount(1);
  await expect(body.locator("button")).toHaveCount(0);
});

test("H4 a hundred routes are the most: the oldest goes", async ({ page }) => {
  const list = Array.from({ length: 100 }, (_, i) => saved(Date.parse(NOW) - (i + 1) * 3600000));
  await openRoute(page, { seed: { [KEY]: list.map(item => row(item)) } });
  await trace(page);
  const after = await stored(page, KEY);
  expect(after).toHaveLength(100);
  expect(after[0].t).toBe(Date.parse(NOW));
  expect(after[99].t).toBe(list[98].t);
});

test("H5 only the latest 20 keep their hops and addresses", async ({ page }) => {
  const data = fixture("normal");
  const list = Array.from({ length: 20 }, (_, i) => saved(Date.parse(NOW) - (i + 1) * 3600000, {}, data));
  await openRoute(page, { seed: { [KEY]: list } });
  await trace(page);
  const after = await stored(page, KEY);
  expect(after).toHaveLength(21);
  expect(after.slice(0, 20).every(item => !!item.data)).toBe(true);
  expect(after[20].data).toBeUndefined();
  expect(JSON.stringify(after[20])).not.toMatch(IP);
});

test("H6 clearing asks with the text of the routes and deletes only the keys of the routes", async ({ page }) => {
  const others = {
    "librespeed-better-test-history": "[1]",
    "librespeed-better-stability-history": "[2]",
    [VIEW]: "week",
    "librespeed-better-route-view": "chart"
  };
  await openRoute(page, { seed: { ...others, [KEY]: [saved(NOW, {}, fixture("normal"))] } });
  await expect(page.locator("#historySection")).toBeVisible();
  let question = "";
  page.on("dialog", dialog => {
    question = dialog.message();
    dialog.accept();
  });
  await page.locator("#historyClear").click();
  await expect(page.locator("#historySection")).toBeHidden();
  expect(question).toBe("Delete all the route history saved in this browser?");
  expect(await stored(page, KEY)).toEqual([]);
  for (const [key, value] of Object.entries(others)) {
    expect(await page.evaluate(name => window.localStorage.getItem(name), key), key).toBe(value);
  }
});

test("H7 blocked storage: the route is drawn, there is no history and no error", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      }
    });
  });
  const seen = await openRoute(page);
  await trace(page);
  await expect(page.locator("#routeTable tbody tr")).toHaveCount(13);
  await expect(page.locator("#historySection")).toBeHidden();
  expect(seen.errors).toEqual([]);
});

test("H8 storage that is full: the route is drawn and the summary keeps it, with no error", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "librespeed-better-route-history" && value.length > 1500) throw new Error("full");
      return original.call(this, key, value);
    };
  });
  const seen = await openRoute(page);
  await trace(page);
  await expect(page.locator("#routeTable tbody tr")).toHaveCount(13);
  expect((await stored(page, SUMMARY)).rows).toHaveLength(1);
  expect(seen.errors).toEqual([]);
});

test("H9 storage that is corrupted: what is not a route is left out, the week view draws, the page works", async ({
  page
}) => {
  const valid = saved("2026-10-08T15:00:00Z", {}, fixture("normal"));
  const seen = await openRoute(page, {
    seed: {
      [KEY]: [null, 5, "x", {}, { t: "a" }, valid],
      [SUMMARY]: { v: 1, rows: [null, { t: "x" }, row(valid)] },
      [VIEW]: "week"
    }
  });
  await expect(page.locator("#historySection")).toBeVisible();
  await expect(page.locator("#historySummary")).toBeVisible();
  await expect(page.locator("#historySummary tbody tr")).toHaveCount(1);
  await trace(page);
  expect(await stored(page, KEY)).toHaveLength(2);
  expect(seen.errors).toEqual([]);

  // A list that is not even JSON is written over by the next route
  const second = await page.context().newPage();
  const errors = (await openRoute(second, { seed: { [KEY]: "{not json" } })).errors;
  await trace(second);
  expect(await stored(second, KEY)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("H10 a name with markup is text in the panels, and nothing is asked from other sites", async ({ page }) => {
  const seen = await openRoute(page, { post: fixture("xss") });
  await trace(page);
  await page.locator("#historyList .history-header").first().click();
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
  await expect(page.locator("#historySection img")).toHaveCount(0);
  seen.requests.forEach(url => expect(url.startsWith(staticRepositoryUrl), url).toBe(true));
  expect(seen.errors).toEqual([]);
});

test("H11 the history fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openRoute(page, { seed: { [KEY]: [saved(NOW, {}, fixture("normal"))], [VIEW]: "week" } });
  await expect(page.locator("#historySection")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true
  );
});

// The page that shows what is on it: the table, the numbers, the networks and the end
const snapshot = page =>
  page.evaluate(() =>
    ["routeStatHops", "routeStatNetworks", "routeStatTime", "routeGroups", "routeMtu", "routeEnd"]
      .map(id => document.getElementById(id).innerHTML)
      .concat(document.querySelector("#routeTable tbody").innerHTML)
  );

for (const name of ["normal", "jump", "no-drop", "silent-tail", "v6", "xss"]) {
  test(`R1 a saved route is drawn again as when it was traced (${name})`, async ({ page }) => {
    await openRoute(page, { post: [fixture(name), fixture(name === "normal" ? "jump" : "normal")] });
    await trace(page);
    const before = await snapshot(page);
    await later(page, 10);
    await trace(page);
    expect(await snapshot(page)).not.toEqual(before);
    await page.locator("#historyList .history-panel").nth(1).locator(".history-action-btn").click();
    await expect(page.locator("#routeShowing")).toBeVisible();
    expect(await snapshot(page)).toEqual(before);
  });
}

test("R2 the strip tells the date and goes back to the route just traced, and a new route takes it away", async ({
  page
}) => {
  await openRoute(page, { post: [fixture("normal"), fixture("jump"), fixture("no-drop")] });
  await trace(page);
  await later(page, 10);
  await trace(page);
  const latest = await snapshot(page);
  await page.locator("#historyList .history-panel").nth(1).locator(".history-action-btn").click();
  await expect(page.locator("#routeShowing")).toContainText("Saved route from 2026-10-09 12:00.");
  await expect(page.locator("#routeShowLatest")).toBeVisible();
  expect(await snapshot(page)).not.toEqual(latest);
  await page.locator("#routeShowLatest").click();
  await expect(page.locator("#routeShowing")).toBeHidden();
  expect(await snapshot(page)).toEqual(latest);

  await page.locator("#historyList .history-panel").nth(1).locator(".history-action-btn").click();
  await expect(page.locator("#routeShowing")).toBeVisible();
  await later(page, 20);
  await trace(page);
  await expect(page.locator("#routeShowing")).toBeHidden();
  await expect(page.locator("#historyList .history-panel")).toHaveCount(3);
});

test("R3 only the routes that kept their hops have the icon", async ({ page }) => {
  const data = fixture("normal");
  await openRoute(page, {
    seed: { [KEY]: [saved("2026-10-08T15:00:00Z", {}, data), saved("2026-10-07T15:00:00Z")] }
  });
  const panels = page.locator("#historyList .history-panel");
  await expect(panels).toHaveCount(2);
  await expect(panels.nth(0).locator(".history-action-btn")).toHaveCount(1);
  await expect(panels.nth(1).locator(".history-action-btn")).toHaveCount(0);
});

test("R4 where the route is not available the history still opens, and the page still says so", async ({ page }) => {
  await openRoute(page, { caps: 404, seed: { [KEY]: [saved("2026-10-08T15:00:00Z", {}, fixture("normal"))] } });
  await expect(page.locator("#routeStatus")).toContainText("not available");
  await page.locator("#historyList .history-action-btn").first().click();
  await expect(page.locator("#routeSummary")).toBeVisible();
  await expect(page.locator("#routeTable tbody tr")).toHaveCount(13);
  await expect(page.locator("#routeStatus")).toContainText("not available");
  await expect(start(page)).toBeDisabled();
});

test("R5 while a route is traced, showing a saved one does nothing", async ({ page }) => {
  await openRoute(page, {
    delay: 1200,
    post: fixture("jump"),
    seed: { [KEY]: [saved("2026-10-08T15:00:00Z", {}, fixture("normal"))] }
  });
  await start(page).click();
  await expect(start(page)).toHaveText("Tracing…");
  await page.locator("#historyList .history-action-btn").first().click();
  // At once, with no waiting: it is the route that is traced that is going to be shown, and the strip would not be a lie only after it
  expect(await page.locator("#routeShowing").isHidden()).toBe(true);
  expect(await page.locator("#routeSummary").isHidden()).toBe(true);
  await expect(page.locator("#routeSummary")).toBeVisible();
  await expect(page.locator("#routeShowing")).toBeHidden();
  await expect(page.locator("#routeTable tbody tr.hop-jump")).toHaveCount(1);
});

test("P1 by week: the routes, the medians, the lowest MTU and the changes of path", async ({ page }) => {
  const rows = [
    row(saved("2026-10-08T15:00:00Z", { hops: 10, nets: 3, ms: 10, mtu: 1500, changed: false })),
    row(saved("2026-10-07T15:00:00Z", { hops: 14, nets: 5, ms: 20, mtu: 1480, changed: true })),
    row(saved("2026-10-06T15:00:00Z", { hops: 12, nets: 4, ms: 30, mtu: 1492, changed: false }))
  ];
  await openRoute(page, { seed: { [SUMMARY]: { v: 1, rows }, [VIEW]: "week" } });
  const cells = await page.locator("#historySummary tbody tr").first().locator("td").allTextContents();
  // routes, hops, networks, last answer, lowest MTU, changes of path
  expect(cells.slice(0, 6)).toEqual(["3", "12", "4", "20.0", "1480", "1"]);
});

test("P2 IPv4 and IPv6 are told apart, and the list shows only with both", async ({ page }) => {
  const four = [row(saved("2026-10-08T15:00:00Z")), row(saved("2026-10-07T15:00:00Z"))];
  await openRoute(page, { seed: { [SUMMARY]: { v: 1, rows: four }, [VIEW]: "week" } });
  await expect(page.locator("#historyGroup")).toBeHidden();
  const second = await page.context().newPage();
  const both = [...four, row(saved("2026-10-06T15:00:00Z", { f: 6 }))];
  await openRoute(second, { seed: { [SUMMARY]: { v: 1, rows: both }, [VIEW]: "week" } });
  await expect(second.locator("#historyGroup")).toBeVisible();
  await expect(second.locator("#historyGroup option")).toContainText(["IPv4", "IPv6"]);
});

test("P3 the list of your network shows with two networks and filters the table", async ({ page }) => {
  const rows = [
    row(saved("2026-10-08T15:00:00Z", { as: "AS64500", ms: 10 })),
    row(saved("2026-10-07T15:00:00Z", { as: "AS64501", ms: 50 }))
  ];
  await openRoute(page, { seed: { [SUMMARY]: { v: 1, rows }, [VIEW]: "week" } });
  await expect(page.locator("#historyServer")).toBeVisible();
  await page.locator("#historyServer").selectOption("AS64501");
  const cells = await page.locator("#historySummary tbody tr").first().locator("td").allTextContents();
  expect(cells[0]).toBe("1");
  expect(cells[3]).toBe("50.0");
});

async function download(page) {
  const [file] = await Promise.all([page.waitForEvent("download"), page.locator("#historyExport").click()]);
  const chunks = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  return { name: file.suggestedFilename(), text: Buffer.concat(chunks).toString("utf8") };
}

test("P4 the latest routes are saved as a CSV with fixed columns, a name of its own and no address", async ({
  page
}) => {
  const rows = [
    row(saved("2026-10-09T15:00:00Z", { changed: true })),
    row(saved("2026-10-08T15:00:00Z", { reached: false, mtu: null, changed: null, as: null }))
  ];
  await openRoute(page, { seed: { [SUMMARY]: { v: 1, rows } } });
  const file = await download(page);
  expect(file.name).toBe("route_history_results_2026-10-09.csv");
  expect(file.text.split("\r\n")).toEqual([
    "date,ip_version,hops,networks,last_answer_ms,mtu,target_answered,your_as,path,path_changed,direction",
    "2026-10-09 12:00,4,13,4,16.9,1480,1,AS64500,AS3356>AS15169,1,there",
    "2026-10-08 12:00,4,13,4,16.9,,0,,AS3356>AS15169,,there",
    ""
  ]);
  expect(file.text).not.toMatch(IP);
});

test("P5 a period is saved as a file with the name of the routes", async ({ page }) => {
  await openRoute(page, { seed: { [SUMMARY]: { v: 1, rows: [row(saved("2026-10-08T15:00:00Z"))] }, [VIEW]: "week" } });
  const file = await download(page);
  expect(file.name).toBe("route_history_week_2026-10-09.csv");
});

test("P6 the period chosen on another page is the one shown here", async ({ page }) => {
  await openRoute(page, { seed: { [SUMMARY]: { v: 1, rows: [row(saved("2026-10-08T15:00:00Z"))] }, [VIEW]: "month" } });
  await expect(page.locator("#historySummary")).toBeVisible();
  await expect(page.locator("#historyPeriod")).toHaveValue("month");
});

test("C1 the path: the networks in order, and nothing that is not a change of network", async ({ page }) => {
  await openRoute(page);
  const result = await page.evaluate(() => {
    const signature = window.LibreSpeedRouteHistory.signature;
    const hop = (ttl, extra) => ({ ttl, scope: "public", asn: "AS1", ...extra });
    return {
      merged: signature({ hops: [hop(1), hop(2), hop(3, { asn: "AS2" })] }),
      withOwn: signature({ hops: [hop(1)], target_as: { asn: "AS9" } }),
      sameOwn: signature({ hops: [hop(1, { asn: "AS9" })], target_as: { asn: "AS9" } }),
      internal: signature({
        hops: [hop(1, { scope: "private", asn: "AS7" }), hop(2, { scope: "cgnat", asn: "AS8" }), hop(3)]
      }),
      silent: signature({ hops: [hop(1, { scope: "none", asn: null }), hop(2)] }),
      noAsn: signature({ hops: [hop(1, { asn: null }), hop(2), hop(3, { asn: "15169" })] }),
      target: signature({ hops: [hop(1), hop(2, { asn: "AS7", is_target: true })] }),
      none: signature({ hops: [] })
    };
  });
  expect(result).toEqual({
    merged: "AS1>AS2",
    withOwn: "AS1>AS9",
    sameOwn: "AS9",
    internal: "AS1",
    silent: "AS1",
    noAsn: "AS1",
    target: "AS1",
    none: ""
  });
});

test("C2 a path is compared with the last one of the same IP version and the same network of yours", async ({
  page
}) => {
  await openRoute(page);
  const result = await page.evaluate(() => {
    const compare = window.LibreSpeedRouteHistory.compare;
    const rows = [
      { f: 6, as: "AS1", path: "AS5" },
      { f: 4, as: "AS2", path: "AS6" },
      { f: 4, as: "AS1", path: "" },
      { f: 4, as: "AS1", path: "AS3>AS4" }
    ];
    return {
      same: compare({ f: 4, as: "AS1", path: "AS3>AS4" }, rows),
      other: compare({ f: 4, as: "AS1", path: "AS3>AS9" }, rows),
      otherVersion: compare({ f: 6, as: "AS1", path: "AS3>AS4" }, rows),
      otherNetwork: compare({ f: 4, as: "AS7", path: "AS3>AS4" }, rows),
      first: compare({ f: 4, as: "AS1", path: "AS3" }, []),
      noPath: compare({ f: 4, as: "AS1", path: "" }, rows)
    };
  });
  expect(result).toEqual({
    same: false,
    other: true,
    otherVersion: true,
    otherNetwork: null,
    first: null,
    noPath: null
  });
});

test("C3 another network on the way is a new path: in the header, in the body and in the table of the period", async ({
  page
}) => {
  const other = fixture("normal");
  other.hops[10].asn = "AS3356";
  other.hops[10].as_name = "Level 3";
  await openRoute(page, { post: [fixture("normal"), other, fixture("normal")], query: "" });
  await trace(page);
  await later(page, 10);
  await trace(page);
  await later(page, 20);
  await trace(page);
  const changed = (await stored(page, KEY)).map(item => item.changed);
  expect(changed).toEqual([true, true, null]);
  await expect(page.locator("#historyList .history-header").first()).toContainText("new path");
  await page.locator("#historyList .history-header").first().click();
  await expect(page.locator("#historyList .history-body").first()).toContainText(
    "Different networks from the previous route"
  );
  await page.locator("#historyPeriod").selectOption("week");
  const cells = await page.locator("#historySummary tbody tr").first().locator("td").allTextContents();
  expect(cells[5]).toBe("2");
});

test("C4 the history is in the four languages, and the policy says what the browser keeps", async () => {
  const keys = [
    "route.history.title",
    "route.history.confirm",
    "route.history.local-note",
    "route.history.hops",
    "route.history.new-path",
    "route.history.open",
    "route.history.showing",
    "route.history.latest",
    "route.history.network",
    "route.history.version",
    "route.history.col-changes"
  ];
  const catalogs = {};
  for (const language of ["en", "pt", "es", "sv"]) {
    catalogs[language] = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "better", "locales", `${language}.json`), "utf8")
    );
    keys.forEach(key => expect(typeof catalogs[language][key], `${language} ${key}`).toBe("string"));
  }
  expect(catalogs.en["privacy.route"]).toContain("not stored on the server");
  expect(catalogs.pt["privacy.route"]).toContain("não é guardado no servidor");
  expect(catalogs.es["privacy.route"]).toContain("no se guarda en el servidor");
  expect(catalogs.sv["privacy.route"]).toContain("sparas inte på servern");
});

test("R6 a new route that is on its way takes the strip of a saved one away at once", async ({ page }) => {
  await openRoute(page, {
    delay: 1200,
    post: fixture("jump"),
    seed: { [KEY]: [saved("2026-10-08T15:00:00Z", {}, fixture("normal"))] }
  });
  await page.locator("#historyList .history-action-btn").first().click();
  await expect(page.locator("#routeShowing")).toBeVisible();
  await start(page).click();
  await expect(start(page)).toHaveText("Tracing…");
  expect(await page.locator("#routeShowing").isHidden()).toBe(true);
  await expect(page.locator("#routeSummary")).toBeVisible();
  await expect(page.locator("#routeShowing")).toBeHidden();
});

// A background that is not transparent is what keeps the rows with no stripe from showing the photo behind the page
const opaque = (page, selector) =>
  page.evaluate(sel => {
    const color = getComputedStyle(document.querySelector(sel)).backgroundColor;
    return color !== "rgba(0, 0, 0, 0)" && color !== "transparent";
  }, selector);

for (const theme of ["light", "dark"]) {
  test(`P7 the tables have a background of their own, so the rows with no stripe are not transparent (${theme})`, async ({
    page
  }) => {
    await openRoute(page, {
      query: `?theme=${theme}&bg=packs`,
      seed: { [SUMMARY]: { v: 1, rows: [row(saved("2026-10-08T15:00:00Z"))] }, [VIEW]: "week" }
    });
    expect(await opaque(page, "#historySummary .history-table-wrap")).toBe(true);
    await trace(page);
    expect(await opaque(page, "#routeTableWrap")).toBe(true);
    // The stripe is another color than the table, so the two kinds of row can be told apart
    const colors = await page.evaluate(() => {
      const wrap = getComputedStyle(document.getElementById("routeTableWrap")).backgroundColor;
      const even = getComputedStyle(document.querySelectorAll("#routeTable tbody tr")[1]).backgroundColor;
      return { wrap, even };
    });
    expect(colors.even).not.toBe(colors.wrap);
  });
}

// The table of a period is never wider than its box: a narrow screen draws each period as a card, a wide one breaks the dates
for (const width of [360, 768, 1280]) {
  test(`P8 the table of a period has no horizontal scroll at ${width}px, for the longest dates`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const rows = Array.from({ length: 8 }, (_, i) =>
      row(saved(Date.parse("2026-10-09T15:00:00Z") - i * 70 * 86400000, { f: i % 2 ? 6 : 4 }))
    );
    await openRoute(page, { seed: { [SUMMARY]: { v: 1, rows }, [VIEW]: "semester" } });
    for (const view of ["semester", "quarter", "bimester", "fortnight", "week", "day"]) {
      await page.locator("#historyPeriod").selectOption(view);
      const wrap = page.locator("#historySummary .history-table-wrap");
      await expect(wrap).toBeVisible();
      expect(await wrap.evaluate(node => node.scrollWidth <= node.clientWidth), `${view} at ${width}px`).toBe(true);
    }
    // The dates of a period are two parts, and the text of the cell is still the whole date
    await page.locator("#historyPeriod").selectOption("semester");
    const title = page.locator("#historySummary tbody th").first();
    await expect(title.locator("span")).toHaveCount(2);
    await expect(title).toHaveText(/^\d\d\/\d\d( \d{4})? – \d\d\/\d\d\/\d{4}$|^\d\d\/\d\d\/\d{4} – \d\d\/\d\d\/\d{4}$/);
  });
}

test("P9 each number of a period has the name of its column, for the card of a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await openRoute(page, {
    seed: { [SUMMARY]: { v: 1, rows: [row(saved("2026-10-08T15:00:00Z"))] }, [VIEW]: "week" }
  });
  const labels = await page
    .locator("#historySummary tbody tr")
    .first()
    .locator("td")
    .evaluateAll(cells => cells.map(cell => cell.getAttribute("data-label")));
  expect(labels).toEqual([
    "Routes",
    "Hops",
    "Networks",
    "Last answer (ms)",
    "Lowest MTU",
    "Path changes",
    "vs. previous"
  ]);
  // The heads are not drawn in a card but stay for the screen readers, and the table keeps its roles
  await expect(page.locator("#historySummary thead th").first()).toHaveAttribute("role", "columnheader");
  await expect(page.locator("#historySummary table")).toHaveAttribute("role", "table");
  expect(await page.locator("#historySummary thead").evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(
    2
  );
});

test("P10 at 360px a number of the header and its unit stay on one line, and a whole metric goes to the next line", async ({
  page
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openRoute(page, { seed: { [KEY]: [saved("2026-10-08T15:00:00Z", { changed: true }, fixture("normal"))] } });
  // The height of a metric is one line (a bit more than the size of its letters), never two
  const oneLine = await page
    .locator("#historyList .history-metric")
    .evaluateAll(nodes =>
      nodes.map(node => node.getBoundingClientRect().height < parseFloat(getComputedStyle(node).fontSize) * 1.9)
    );
  expect(oneLine).toEqual([true, true, true]);
  // And nothing goes out of the header: the metrics take the next line instead of pushing the icons off the box
  const fits = await page.evaluate(() => {
    const header = document.querySelector("#historyList .history-header");
    const icon = document.querySelector("#historyList .history-action-btn").getBoundingClientRect();
    const box = document.querySelector("#historySection").getBoundingClientRect();
    return header.scrollWidth <= header.clientWidth && icon.right <= box.right + 1;
  });
  expect(fits).toBe(true);
});

test("P11 the lists of the history are at All until one is chosen, and the table is of everything", async ({
  page
}) => {
  const rows = [
    row(saved("2026-10-08T15:00:00Z", { f: 4, as: "AS64500", ms: 10 })),
    row(saved("2026-10-07T15:00:00Z", { f: 6, as: "AS64501", ms: 50 }))
  ];
  await openRoute(page, { seed: { [SUMMARY]: { v: 1, rows }, [VIEW]: "week" } });
  await expect(page.locator("#historyGroup")).toBeVisible();
  await expect(page.locator("#historyServer")).toBeVisible();
  await expect(page.locator("#historyGroup option:checked")).toHaveText("All");
  await expect(page.locator("#historyServer option:checked")).toHaveText("All");
  // Both routes are in the table, in a week
  const cells = await page.locator("#historySummary tbody tr").first().locator("td").allTextContents();
  expect(cells[0]).toBe("2");
  await page.locator("#historyGroup").selectOption("6");
  expect((await page.locator("#historySummary tbody tr").first().locator("td").allTextContents())[0]).toBe("1");
});
