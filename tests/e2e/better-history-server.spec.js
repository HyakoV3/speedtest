const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const SPEED_SUMMARY = "librespeed-better-history-summary";
const STABILITY_SUMMARY = "librespeed-better-stability-history-summary";

const NOW = new Date("2026-10-09T15:00:00Z");
const at = iso => Date.parse(iso);

test.use({ timezoneId: "America/Sao_Paulo" });

const row = (iso, dl, server, conn = "multi") => ({
  t: at(iso),
  dl,
  ul: 10,
  ping: 5,
  jitter: 1,
  conn,
  server,
  id: null
});

// The servers of the list of the page, with the names of one of them in another language
async function mockServers(page, servers) {
  await page.route("**/server-list.json*", route =>
    route.fulfill({
      json: servers.map(server => ({
        ...server,
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

const servers = [{ name: "Alpha, Testland" }, { name: "Beta, Testland" }];

async function openSpeed(page, rows, query = "", list = servers) {
  await page.clock.setFixedTime(NOW);
  await mockServers(page, list);
  await seed(page, { [SPEED_SUMMARY]: { v: 1, rows } });
  await page.goto(`${staticRepositoryUrl}/index-better.html${query}`);
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
}

function tableLines(page) {
  return page
    .locator(".history-table tbody tr")
    .evaluateAll(lines => lines.map(line => [...line.querySelectorAll("th, td")].map(cell => cell.textContent)));
}

const server = page => page.locator("#historyServer");

test("with a single server the list of servers is not there", async ({ page }) => {
  await openSpeed(page, [
    row("2026-10-08T14:00:00Z", 300, "Alpha, Testland"),
    row("2026-10-07T14:00:00Z", 200, "Alpha, Testland")
  ]);
  await page.locator("#historyPeriod").selectOption("day");
  await expect(server(page)).toBeHidden();
  // Nothing is left out by it
  expect(await tableLines(page)).toHaveLength(2);
});

test("with more than one server the list is there, at the server of the most recent result", async ({ page }) => {
  await openSpeed(page, [
    row("2026-10-08T14:00:00Z", 300, "Beta, Testland"),
    row("2026-10-07T14:00:00Z", 200, "Alpha, Testland")
  ]);
  await page.locator("#historyPeriod").selectOption("day");
  await expect(server(page)).toBeVisible();
  expect(await server(page).locator("option").allTextContents()).toEqual(["All", "Beta, Testland", "Alpha, Testland"]);
  await expect(server(page)).toHaveValue("Beta, Testland");
  // The table is of that server only
  expect(await tableLines(page)).toEqual([["08/10/2026", "1", "300", "10.0", "5.00", "--"]]);
});

test("choosing another server filters the table", async ({ page }) => {
  await openSpeed(page, [
    row("2026-10-08T14:00:00Z", 300, "Beta, Testland"),
    row("2026-10-07T14:00:00Z", 200, "Alpha, Testland")
  ]);
  await page.locator("#historyPeriod").selectOption("day");
  await server(page).selectOption("Alpha, Testland");
  expect(await tableLines(page)).toEqual([["07/10/2026", "1", "200", "10.0", "5.00", "--"]]);
});

test("the server and the connection filter together", async ({ page }) => {
  await openSpeed(page, [
    row("2026-10-08T14:00:00Z", 300, "Beta, Testland", "multi"),
    row("2026-10-07T14:00:00Z", 200, "Beta, Testland", "single"),
    row("2026-10-06T14:00:00Z", 100, "Alpha, Testland", "multi")
  ]);
  await page.locator("#historyPeriod").selectOption("day");
  await expect(page.locator("#historyGroup")).toBeVisible();
  await expect(server(page)).toBeVisible();
  // Beta and multiple: only the first one
  expect((await tableLines(page)).map(line => line[2])).toEqual(["300"]);
  await page.locator("#historyGroup").selectOption("single");
  expect((await tableLines(page)).map(line => line[2])).toEqual(["200"]);
  await server(page).selectOption("Alpha, Testland");
  // Alpha has no single connection tests
  expect(await tableLines(page)).toEqual([]);
});

test("results saved without the server are told as unknown", async ({ page }) => {
  await openSpeed(page, [row("2026-10-08T14:00:00Z", 300, "Beta, Testland"), row("2026-10-07T14:00:00Z", 200, "")]);
  await page.locator("#historyPeriod").selectOption("day");
  expect(await server(page).locator("option").allTextContents()).toEqual(["All", "Beta, Testland", "Unknown"]);
  await server(page).selectOption("");
  expect((await tableLines(page)).map(line => line[2])).toEqual(["200"]);
});

test("the server is written in the language of the page when the list has its name", async ({ page }) => {
  await openSpeed(
    page,
    [row("2026-10-08T14:00:00Z", 300, "Beta, Testland"), row("2026-10-07T14:00:00Z", 200, "Alpha, Testland")],
    "?lang=pt",
    [{ name: "Alpha, Testland", names: { pt: "Alfa, Terra de Teste" } }, { name: "Beta, Testland" }]
  );
  await page.locator("#historyPeriod").selectOption("day");
  expect(await server(page).locator("option").allTextContents()).toEqual([
    "Todos",
    "Beta, Testland",
    "Alfa, Terra de Teste"
  ]);
  // What is saved is the name as it is, so the choice does not depend on the language
  await expect(server(page).locator("option").nth(2)).toHaveAttribute("value", "Alpha, Testland");
});

test("the page goes back to the first one when the server changes", async ({ page }) => {
  const rows = [];
  for (let i = 0; i < 8; i++)
    rows.push(row(new Date(at("2026-10-08T14:00:00Z") - i * 86400000).toISOString(), 300 + i, "Beta, Testland"));
  for (let i = 0; i < 8; i++)
    rows.push(row(new Date(at("2026-09-20T14:00:00Z") - i * 86400000).toISOString(), 100 + i, "Alpha, Testland"));
  await openSpeed(page, rows);
  await page.locator("#historyPeriod").selectOption("day");
  await page.locator("#historyOlder").click();
  await expect(page.locator("#historyNewer")).toHaveAttribute("aria-disabled", "false");
  await server(page).selectOption("Alpha, Testland");
  await expect(page.locator("#historyNewer")).toHaveAttribute("aria-disabled", "true");
});

test("the file of a period has only the server chosen", async ({ page }) => {
  await openSpeed(page, [
    row("2026-10-08T14:00:00Z", 300, "Beta, Testland"),
    row("2026-10-07T14:00:00Z", 200, "Alpha, Testland")
  ]);
  await page.locator("#historyPeriod").selectOption("day");
  await server(page).selectOption("Alpha, Testland");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#historyExport").click()]);
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const lines = Buffer.concat(chunks).toString("utf8").split("\r\n");
  expect(lines).toHaveLength(3);
  expect(lines[1]).toContain("2026-10-07");
});

test("the list has a name in each language", async ({ page }) => {
  await openSpeed(page, [
    row("2026-10-08T14:00:00Z", 300, "Beta, Testland"),
    row("2026-10-07T14:00:00Z", 200, "Alpha, Testland")
  ]);
  await expect(server(page)).toHaveAttribute("aria-label", "Server");
  for (const [lang, name] of [
    ["pt", "Servidor"],
    ["es", "Servidor"],
    ["sv", "Server"]
  ]) {
    await page.goto(`${staticRepositoryUrl}/index-better.html?lang=${lang}`);
    await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
    await expect(server(page)).toHaveAttribute("aria-label", name);
  }
});

test("the list of servers is between the arrows, with the other lists, and the page does not scroll sideways", async ({
  page
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openSpeed(page, [
    row("2026-10-08T14:00:00Z", 300, "Beta, Testland", "multi"),
    row("2026-10-07T14:00:00Z", 200, "Alpha, Testland", "single"),
    row("2026-10-06T14:00:00Z", 100, "Alpha, Testland", "multi"),
    row("2026-10-05T14:00:00Z", 100, "Alpha, Testland", "multi"),
    row("2026-10-04T14:00:00Z", 100, "Alpha, Testland", "multi"),
    row("2026-10-03T14:00:00Z", 100, "Alpha, Testland", "multi"),
    row("2026-10-02T14:00:00Z", 100, "Alpha, Testland", "multi")
  ]);
  await page.locator("#historyPeriod").selectOption("day");
  const [controls, selectBox] = await Promise.all([
    page.locator(".history-controls").boundingBox(),
    server(page).boundingBox()
  ]);
  expect(selectBox.x).toBeGreaterThanOrEqual(controls.x - 1);
  expect(selectBox.x + selectBox.width).toBeLessThanOrEqual(controls.x + controls.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true
  );
});

test("the stability page has a list of servers too, besides the target", async ({ page }) => {
  await mockServers(page, []);
  await seed(page, {
    [STABILITY_SUMMARY]: {
      v: 1,
      rows: [
        { t: at("2026-10-03T12:00:00Z"), avg: 20, min: 5, max: 40, jitter: 2, loss: 0, target: "libre", server: "A" },
        {
          t: at("2026-10-02T12:00:00Z"),
          avg: 20,
          min: 5,
          max: 40,
          jitter: 2,
          loss: 0,
          target: "https://www.google.com/generate_204",
          server: ""
        }
      ]
    }
  });
  await page.goto(`${staticRepositoryUrl}/stability-better.html`);
  await expect(page.locator(".panel-button")).toBeVisible();
  await page.locator("#historyPeriod").selectOption("day");
  await expect(page.locator("#historyServer")).toBeVisible();
  await expect(page.locator("#historyGroup")).toBeVisible();
  // The server of the most recent measurement, then All shows both
  expect((await tableLines(page)).length).toBe(1);
  await page.locator("#historyGroup").selectOption({ label: "All" });
  await page.locator("#historyServer").selectOption({ label: "All" });
  expect((await tableLines(page)).length).toBe(2);
});
