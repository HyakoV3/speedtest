const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const SPEED_SUMMARY = "librespeed-better-history-summary";
const STABILITY_SUMMARY = "librespeed-better-stability-history-summary";
const GOOGLE = "https://www.google.com/generate_204";

const NOW = new Date("2026-10-09T15:00:00Z");
const at = iso => Date.parse(iso);

test.use({ timezoneId: "America/Sao_Paulo" });

const speedRow = (iso, dl, extra = {}) => ({
  t: at(iso),
  dl,
  ul: 10,
  ping: 5,
  jitter: 1,
  conn: "multi",
  server: "",
  id: null,
  ...extra
});

const stabilityRow = (iso, avg) => ({
  t: at(iso),
  avg,
  min: 5,
  max: 40,
  jitter: 2,
  loss: 0,
  target: GOOGLE,
  server: ""
});

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
    ([entries]) => {
      window.localStorage.setItem("librespeed-better-consent", String(Date.now()));
      for (const [key, value] of entries) window.localStorage.setItem(key, JSON.stringify(value));
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

function tableLines(page) {
  return page
    .locator(".history-table tbody tr")
    .evaluateAll(lines => lines.map(line => [...line.querySelectorAll("th, td")].map(cell => cell.textContent)));
}

// The three weeks used by most of the tests: 21/09, 28/09 and 05/10
const week = { w41: "2026-10-07T15:00:00Z", w40: "2026-10-01T15:00:00Z", w39: "2026-09-24T15:00:00Z" };

test("speed test: each week shows its change against the week before, the oldest has none", async ({ page }) => {
  await openSpeed(page, {
    [SPEED_SUMMARY]: { v: 1, rows: [speedRow(week.w41, 200), speedRow(week.w40, 100), speedRow(week.w39, 50)] }
  });
  await page.locator("#historyPeriod").selectOption("week");
  await expect(page.locator('.history-table th[scope="col"]').last()).toHaveText("vs. previous");
  expect(await tableLines(page)).toEqual([
    ["05/10 – 11/10/2026", "1", "200", "10.0", "5.00", "+100.0%"],
    ["28/09 – 04/10/2026", "1", "100", "10.0", "5.00", "+100.0%"],
    ["21/09 – 27/09/2026", "1", "50.0", "10.0", "5.00", "--"]
  ]);
});

test("a fall shows a minus sign, and no change shows 0%", async ({ page }) => {
  await openSpeed(page, {
    [SPEED_SUMMARY]: { v: 1, rows: [speedRow(week.w41, 90), speedRow(week.w40, 100), speedRow(week.w39, 100)] }
  });
  await page.locator("#historyPeriod").selectOption("week");
  const trends = (await tableLines(page)).map(line => line[line.length - 1]);
  expect(trends).toEqual(["-10.0%", "0%", "--"]);
});

test("a period without a number to follow, or a base of zero, has no trend", async ({ page }) => {
  await openSpeed(page, {
    [SPEED_SUMMARY]: {
      v: 1,
      rows: [
        speedRow(week.w41, 200),
        speedRow(week.w40, null),
        speedRow(week.w39, 0),
        speedRow("2026-09-17T15:00:00Z", 80)
      ]
    }
  });
  await page.locator("#historyPeriod").selectOption("week");
  const trends = (await tableLines(page)).map(line => line[line.length - 1]);
  // 200 against nothing, nothing against zero, zero against 80 (a fall of 100%), and the oldest one
  expect(trends).toEqual(["--", "--", "-100.0%", "--"]);
});

test("the trend only has a sign: no color and no class", async ({ page }) => {
  await openSpeed(page, { [SPEED_SUMMARY]: { v: 1, rows: [speedRow(week.w41, 200), speedRow(week.w40, 100)] } });
  await page.locator("#historyPeriod").selectOption("week");
  const cell = page.locator(".history-table tbody tr").first().locator("td").last();
  expect(await cell.getAttribute("class")).toBeNull();
  expect(await cell.getAttribute("style")).toBeNull();
  // The same color as the other cells of the line
  const colors = await cell.evaluate(node => [
    getComputedStyle(node).color,
    getComputedStyle(node.previousElementSibling).color
  ]);
  expect(colors[0]).toBe(colors[1]);
});

test("the single and the multiple connections have their own trend", async ({ page }) => {
  await openSpeed(page, {
    [SPEED_SUMMARY]: {
      v: 1,
      rows: [
        speedRow(week.w41, 20, { conn: "single" }),
        speedRow(week.w41, 200, { conn: "multi" }),
        speedRow(week.w40, 100, { conn: "multi" })
      ]
    }
  });
  await page.locator("#historyPeriod").selectOption("week");
  await expect(page.locator("#historyGroup")).toHaveValue("single");
  expect((await tableLines(page)).map(line => line[line.length - 1])).toEqual(["--"]);
  await page.locator("#historyGroup").selectOption("multi");
  expect((await tableLines(page)).map(line => line[line.length - 1])).toEqual(["+100.0%", "--"]);
});

test("stability: the trend follows the average ping", async ({ page }) => {
  await openStability(page, {
    [STABILITY_SUMMARY]: { v: 1, rows: [stabilityRow(week.w41, 30), stabilityRow(week.w40, 20)] }
  });
  await page.locator("#historyPeriod").selectOption("week");
  await expect(page.locator('.history-table th[scope="col"]').last()).toHaveText("vs. previous");
  const trends = (await tableLines(page)).map(line => line[line.length - 1]);
  // A higher ping is worse, but the sign alone is shown
  expect(trends).toEqual(["+50.0%", "--"]);
});

test("the line 24 still has its trend, because the period 25 is there", async ({ page }) => {
  const rows = [];
  for (let i = 0; i < 25; i++) {
    rows.push(speedRow(new Date(at("2026-10-07T15:00:00Z") - i * 7 * 86400000).toISOString(), 300 - i));
  }
  await openSpeed(page, { [SPEED_SUMMARY]: { v: 1, rows } });
  await page.locator("#historyPeriod").selectOption("week");
  // The 24 periods are in pages of 5: the last page has the periods 21 to 24
  for (let step = 0; step < 4; step++) await page.locator("#historyOlder").click();
  const lines = await tableLines(page);
  expect(lines).toHaveLength(4);
  expect(lines[3][lines[3].length - 1]).not.toBe("--");
});

test("the header of the trend follows the language, Swedish included", async ({ page }) => {
  await openSpeed(
    page,
    { [SPEED_SUMMARY]: { v: 1, rows: [speedRow(week.w41, 200), speedRow(week.w40, 100)] } },
    "?lang=pt"
  );
  await page.locator("#historyPeriod").selectOption("week");
  await expect(page.locator('.history-table th[scope="col"]').last()).toHaveText("vs. anterior");
  await page.goto(`${staticRepositoryUrl}/index-better.html?lang=sv`);
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
  await page.locator("#historyPeriod").selectOption("week");
  await expect(page.locator('.history-table th[scope="col"]').last()).toHaveText("mot föregående");
});
