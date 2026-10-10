const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const SPEED = "librespeed-better-history";
const SPEED_SUMMARY = "librespeed-better-history-summary";
const STABILITY = "librespeed-better-stability-history";

const NOW = new Date("2026-10-09T15:00:00Z");
const DAY = 86400000;

test.use({ timezoneId: "America/Sao_Paulo" });

// The results of the list, the most recent first: one for each day, the download tells which one it is
const entries = count =>
  Array.from({ length: count }, (_, i) => ({
    date: Date.parse("2026-10-09T12:00:00Z") - i * DAY,
    dl: String(100 + i),
    ul: "10",
    ping: "5",
    jitter: "1",
    ip: "",
    testId: null,
    conn: "multi"
  }));

const summaryRows = count =>
  Array.from({ length: count }, (_, i) => ({
    t: Date.parse("2026-10-07T15:00:00Z") - i * 7 * DAY,
    dl: 100 + i,
    ul: 10,
    ping: 5,
    jitter: 1,
    conn: "multi",
    server: "",
    id: null
  }));

async function mockServers(page, names) {
  await page.route("**/server-list.json*", route =>
    route.fulfill({
      json: names.map(name => ({
        name,
        server: "/backend",
        dlURL: "garbage.php",
        ulURL: "empty.php",
        pingURL: "empty.php",
        getIpURL: "getIP.php"
      }))
    })
  );
  await page.route("**/backend/empty.php*", route =>
    route.fulfill({ body: "", headers: { "Access-Control-Allow-Origin": "*" } })
  );
}

async function seed(page, values) {
  await page.addInitScript(
    ([list]) => {
      window.localStorage.setItem("librespeed-better-consent", String(Date.now()));
      for (const [key, value] of list) window.localStorage.setItem(key, JSON.stringify(value));
    },
    [Object.entries(values)]
  );
}

async function openSpeed(page, values, query = "") {
  await page.clock.setFixedTime(NOW);
  await mockServers(page, ["local"]);
  await seed(page, values);
  await page.goto(`${staticRepositoryUrl}/index-better.html${query}`);
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
}

async function openStability(page, values, query = "") {
  await page.clock.setFixedTime(NOW);
  await mockServers(page, []);
  await seed(page, values);
  await page.goto(`${staticRepositoryUrl}/stability-better.html${query}`);
  await expect(page.locator(".panel-button")).toBeVisible();
}

// The downloads of the results that are on the page, as they show in the headers
const downloads = page =>
  page.locator(".history-panel .history-metric:first-child").evaluateAll(nodes => nodes.map(node => node.textContent));

const newer = page => page.locator("#historyNewer");
const older = page => page.locator("#historyOlder");

function periodLines(page) {
  return page
    .locator(".history-table tbody tr")
    .evaluateAll(lines => lines.map(line => line.querySelector("th").textContent));
}

test("the results are in pages of five, with an arrow at each end", async ({ page }) => {
  await openSpeed(page, { [SPEED]: entries(12), [SPEED_SUMMARY]: { v: 1, rows: summaryRows(1) } });
  expect(await downloads(page)).toHaveLength(5);
  expect((await downloads(page))[0]).toContain("100");
  // The first page: the arrow to the newer ones leads nowhere
  await expect(newer(page)).toBeVisible();
  await expect(newer(page)).toHaveAttribute("aria-disabled", "true");
  await expect(older(page)).toHaveAttribute("aria-disabled", "false");
  await older(page).click();
  expect((await downloads(page))[0]).toContain("105");
  await expect(newer(page)).toHaveAttribute("aria-disabled", "false");
  await older(page).click();
  // The last page has what is left: 2 results
  expect(await downloads(page)).toHaveLength(2);
  expect((await downloads(page))[0]).toContain("110");
  await expect(older(page)).toHaveAttribute("aria-disabled", "true");
  // And back
  await newer(page).click();
  expect((await downloads(page))[0]).toContain("105");
});

test("with a single page the arrows are not there", async ({ page }) => {
  await openSpeed(page, { [SPEED]: entries(5), [SPEED_SUMMARY]: { v: 1, rows: summaryRows(1) } });
  expect(await downloads(page)).toHaveLength(5);
  await expect(newer(page)).toBeHidden();
  await expect(older(page)).toBeHidden();
  await expect(page.locator("#historyPeriod")).toBeVisible();
});

test("nothing says how many pages or results there are", async ({ page }) => {
  await openSpeed(page, { [SPEED]: entries(12), [SPEED_SUMMARY]: { v: 1, rows: summaryRows(1) } });
  const toolbar = await page.locator(".history-view").innerText();
  expect(toolbar).not.toMatch(/\d/);
  await expect(page.locator("#historySection")).not.toContainText(/page \d|of \d+/i);
});

test("the arrows are at the two ends of the line, with the controls between them", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await openSpeed(page, { [SPEED]: entries(12), [SPEED_SUMMARY]: { v: 1, rows: summaryRows(1) } });
  const [left, period, exportButton, right] = await Promise.all(
    ["#historyNewer", "#historyPeriod", "#historyExport", "#historyOlder"].map(selector =>
      page.locator(selector).boundingBox()
    )
  );
  expect(left.x).toBeLessThan(period.x);
  expect(period.x).toBeLessThan(exportButton.x);
  expect(exportButton.x + exportButton.width).toBeLessThan(right.x);
  // On the same line
  expect(Math.abs(left.y - right.y)).toBeLessThan(4);
  expect(Math.abs(left.y - period.y)).toBeLessThan(8);
});

test("on a phone the arrows stay at the ends and the lists come down between them", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openSpeed(page, { [SPEED]: entries(12), [SPEED_SUMMARY]: { v: 1, rows: [...summaryRows(1)] } });
  const [left, controls, right] = await Promise.all(
    ["#historyNewer", ".history-controls", "#historyOlder"].map(selector => page.locator(selector).boundingBox())
  );
  expect(left.x).toBeLessThan(controls.x);
  expect(controls.x + controls.width).toBeLessThanOrEqual(right.x + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true
  );
});

test("the table of a period is in pages of five too, and the 24 periods are the most", async ({ page }) => {
  await openSpeed(page, { [SPEED]: entries(1), [SPEED_SUMMARY]: { v: 1, rows: summaryRows(30) } });
  await page.locator("#historyPeriod").selectOption("week");
  let total = 0;
  const pages = [];
  for (;;) {
    const lines = await periodLines(page);
    pages.push(lines.length);
    total += lines.length;
    if ((await older(page).getAttribute("aria-disabled")) === "true") break;
    await older(page).click();
  }
  expect(pages).toEqual([5, 5, 5, 5, 4]);
  expect(total).toBe(24);
});

test("the trend of the last line of a page is told against the first line of the next one", async ({ page }) => {
  await openSpeed(page, { [SPEED]: entries(1), [SPEED_SUMMARY]: { v: 1, rows: summaryRows(8) } });
  await page.locator("#historyPeriod").selectOption("week");
  const lastTrend = () =>
    page.locator(".history-table tbody tr").evaluateAll(lines => lines[lines.length - 1].lastElementChild.textContent);
  // 8 weeks, from 107 down to 100: the fifth is told against the sixth
  expect(await lastTrend()).not.toBe("--");
  await older(page).click();
  // The second page has three weeks, and the oldest one has nothing to be told against
  expect(await lastTrend()).toBe("--");
});

test("a page goes back to the first when the period, the group, or the results change", async ({ page }) => {
  await openSpeed(page, { [SPEED]: entries(12), [SPEED_SUMMARY]: { v: 1, rows: summaryRows(12) } });
  // The period
  await older(page).click();
  await page.locator("#historyPeriod").selectOption("week");
  await expect(page.locator(".history-table")).toBeVisible();
  await older(page).click();
  await page.locator("#historyPeriod").selectOption("detail");
  expect((await downloads(page))[0]).toContain("100");
  // A result that arrives
  await older(page).click();
  await page.evaluate(() => {
    testHistory.add({
      date: Date.now(),
      dl: "999",
      ul: "1",
      ping: "1",
      jitter: "1",
      ip: "",
      testId: null,
      conn: "multi"
    });
  });
  expect((await downloads(page))[0]).toContain("999");
  await expect(newer(page)).toHaveAttribute("aria-disabled", "true");
  // The clear
  await older(page).click();
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#historyClear").click();
  await expect(page.locator("#historySection")).toBeHidden();
});

test("the group goes back to the first page", async ({ page }) => {
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => ({
      ...summaryRows(1)[0],
      t: Date.parse("2026-10-07T15:00:00Z") - i * 7 * DAY,
      dl: 100 + i,
      conn: "single"
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      ...summaryRows(1)[0],
      t: Date.parse("2026-10-06T15:00:00Z") - i * 7 * DAY,
      dl: 200 + i,
      conn: "multi"
    }))
  ];
  await openSpeed(page, { [SPEED]: entries(1), [SPEED_SUMMARY]: { v: 1, rows } });
  await page.locator("#historyPeriod").selectOption("week");
  await older(page).click();
  await expect(newer(page)).toHaveAttribute("aria-disabled", "false");
  await page.locator("#historyGroup").selectOption("multi");
  await expect(newer(page)).toHaveAttribute("aria-disabled", "true");
});

test("a panel that was open is closed when the page changes", async ({ page }) => {
  await openSpeed(page, { [SPEED]: entries(12), [SPEED_SUMMARY]: { v: 1, rows: summaryRows(1) } });
  await page.locator(".history-header").first().click();
  await expect(page.locator(".history-panel.open")).toHaveCount(1);
  await older(page).click();
  await expect(page.locator(".history-panel.open")).toHaveCount(0);
});

test("the results have no limit of number: thirty are all kept, in six pages", async ({ page }) => {
  await openSpeed(page, { [SPEED]: entries(30), [SPEED_SUMMARY]: { v: 1, rows: summaryRows(1) } });
  await page.evaluate(() => {
    testHistory.add({
      date: Date.now(),
      dl: "999",
      ul: "1",
      ping: "1",
      jitter: "1",
      ip: "",
      testId: null,
      conn: "multi"
    });
  });
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).length, SPEED)).toBe(31);
  let count = 1;
  while ((await older(page).getAttribute("aria-disabled")) !== "true") {
    await older(page).click();
    count++;
  }
  expect(count).toBe(7);
});

test("when the storage is full the oldest results are given up until the list fits", async ({ page }) => {
  await page.addInitScript(key => {
    const setItem = Storage.prototype.setItem;
    // A storage that has room for a list of about 3000 characters
    Storage.prototype.setItem = function (name, value) {
      if (name === key && value.length > 3000) throw new DOMException("full", "QuotaExceededError");
      return setItem.call(this, name, value);
    };
  }, SPEED);
  await openSpeed(page, { [SPEED_SUMMARY]: { v: 1, rows: [] } });
  await page.evaluate(() => {
    for (let i = 0; i < 40; i++) {
      testHistory.add({
        date: 1000000 + i,
        dl: String(100 + i),
        ul: "10",
        ping: "5",
        jitter: "1",
        ip: "203.0.113.5",
        testId: null,
        conn: "multi"
      });
    }
  });
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), SPEED);
  // Some are kept, not all, and the most recent one is the first
  expect(saved.length).toBeGreaterThan(5);
  expect(saved.length).toBeLessThan(40);
  expect(saved[0].dl).toBe("139");
  // The summary is small and keeps all of them
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).rows.length, SPEED_SUMMARY)).toBe(40);
});

test("stability: only the latest 20 measurements keep their pings, the older ones keep their numbers", async ({
  page
}) => {
  await openStability(page, {});
  await page.evaluate(() => {
    for (let i = 0; i < 25; i++) {
      testHistory.add({
        date: 2000000 + i,
        duration: 60,
        avg: 20 + i,
        min: 5,
        max: 40,
        jitter: 2,
        loss: 0,
        pings: [{ t: 0.2, ping: 12.5, lost: false }]
      });
    }
  });
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STABILITY);
  expect(saved).toHaveLength(25);
  expect(saved.slice(0, 20).every(entry => Array.isArray(entry.pings))).toBe(true);
  expect(saved.slice(20).every(entry => entry.pings === undefined)).toBe(true);
  // The numbers of the old ones are there
  expect(saved[24].avg).toBe(20);
  // The icon of the file of the pings is on the first pages and not on the last one
  await expect(page.locator(".history-panel .history-download-btn")).toHaveCount(5);
  for (let step = 0; step < 4; step++) await older(page).click();
  await expect(page.locator(".history-panel")).toHaveCount(5);
  await expect(page.locator(".history-panel .history-download-btn")).toHaveCount(0);
});

test("the arrows have a name in each language and an icon of the set", async ({ page }) => {
  await openSpeed(page, { [SPEED]: entries(12), [SPEED_SUMMARY]: { v: 1, rows: summaryRows(1) } });
  await expect(newer(page)).toHaveAttribute("aria-label", "Newer results");
  await expect(older(page)).toHaveAttribute("aria-label", "Older results");
  await expect(newer(page).locator("svg")).toHaveCount(1);
  await expect(older(page).locator("svg")).toHaveCount(1);
  for (const [lang, newerName, olderName] of [
    ["pt", "Resultados mais novos", "Resultados mais antigos"],
    ["es", "Resultados más recientes", "Resultados más antiguos"],
    ["sv", "Nyare resultat", "Äldre resultat"]
  ]) {
    await page.goto(`${staticRepositoryUrl}/index-better.html?lang=${lang}`);
    await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
    await expect(newer(page)).toHaveAttribute("aria-label", newerName);
    await expect(older(page)).toHaveAttribute("title", olderName);
  }
});

test("the keyboard moves through the pages, and the arrow that leads nowhere keeps the focus", async ({ page }) => {
  await openSpeed(page, { [SPEED]: entries(7), [SPEED_SUMMARY]: { v: 1, rows: summaryRows(1) } });
  await older(page).focus();
  await page.keyboard.press("Enter");
  expect(await downloads(page)).toHaveLength(2);
  // At the last page the arrow is dimmed, and still has the focus
  await expect(older(page)).toHaveAttribute("aria-disabled", "true");
  await expect(older(page)).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await downloads(page)).toHaveLength(2);
});

test("the arrows follow the high contrast and the icon set", async ({ page }) => {
  await openSpeed(page, { [SPEED]: entries(12), [SPEED_SUMMARY]: { v: 1, rows: summaryRows(1) } }, "?icons=lucide");
  await expect(page.locator("html")).toHaveAttribute("data-icons", "lucide");
  const lucide = await older(page).locator("svg").innerHTML();
  await page.goto(`${staticRepositoryUrl}/index-better.html?icons=mdi`);
  await expect(page.locator("html")).toHaveAttribute("data-icons", "mdi");
  expect(await older(page).locator("svg").innerHTML()).not.toBe(lucide);
});

test("a list saved before this change, with the limit of 20, is read as it is", async ({ page }) => {
  await openSpeed(page, { [SPEED]: entries(20), [SPEED_SUMMARY]: { v: 1, rows: summaryRows(1) } });
  let pages = 1;
  while ((await older(page).getAttribute("aria-disabled")) !== "true") {
    await older(page).click();
    pages++;
  }
  expect(pages).toBe(4);
});

test("when the list gets shorter in another tab, the page goes back inside the pages that are left", async ({
  page,
  context
}) => {
  await openSpeed(page, { [SPEED]: entries(12), [SPEED_SUMMARY]: { v: 1, rows: summaryRows(1) } });
  await older(page).click();
  await older(page).click();
  expect(await downloads(page)).toHaveLength(2);
  // Another tab of the same site leaves only three results
  const other = await context.newPage();
  await other.goto(`${staticRepositoryUrl}/index-better.html`);
  await other.evaluate(([key, list]) => window.localStorage.setItem(key, JSON.stringify(list)), [SPEED, entries(3)]);
  // The first tab is on a page that does not exist any more: it shows the results that are there, and no arrows
  await expect(page.locator(".history-panel")).toHaveCount(3);
  await expect(older(page)).toBeHidden();
  await expect(newer(page)).toBeHidden();
});
