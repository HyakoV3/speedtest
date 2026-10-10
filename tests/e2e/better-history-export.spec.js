const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const SPEED_SUMMARY = "librespeed-better-history-summary";
const STABILITY_SUMMARY = "librespeed-better-stability-history-summary";
const GOOGLE = "https://www.google.com/generate_204";

// 12:00 on 9 October in São Paulo
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

// What the button downloads: the name of the file and its text
async function saved(page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#historyExport").click()]);
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return { name: download.suggestedFilename(), text: Buffer.concat(chunks).toString("utf8") };
}

const lines = text => text.split("\r\n");

const summary = [
  speedRow("2026-10-09T15:00:00Z", 300, { server: "Only, Testland", id: "57" }),
  speedRow("2026-10-08T15:00:00Z", 200, { jitter: null })
];

test("the latest results are saved as a file with one line for each row of the summary", async ({ page }) => {
  await openSpeed(page, { [SPEED_SUMMARY]: { v: 1, rows: summary } });
  await expect(page.locator("#historyExport")).toBeVisible();
  const file = await saved(page);
  expect(file.name).toBe("history_results_2026-10-09.csv");
  expect(lines(file.text)).toEqual([
    "date,download_mbps,upload_mbps,ping_ms,jitter_ms,connection,server,id",
    // The date is the one of the browser; a name with a comma is quoted; an id and a number that are missing are empty
    '2026-10-09 12:00,300,10,5,1,multi,"Only, Testland",57',
    "2026-10-08 12:00,200,10,5,,multi,,",
    ""
  ]);
});

test("a period is saved with the columns of the table, a number without its unit", async ({ page }) => {
  await openSpeed(page, {
    [SPEED_SUMMARY]: {
      v: 1,
      rows: [
        speedRow("2026-10-07T15:00:00Z", 200),
        speedRow("2026-10-06T15:00:00Z", 100),
        speedRow("2026-10-01T15:00:00Z", 50),
        speedRow("2026-09-24T15:00:00Z", null)
      ]
    }
  });
  await page.locator("#historyPeriod").selectOption("week");
  const file = await saved(page);
  expect(file.name).toBe("history_week_2026-10-09.csv");
  expect(lines(file.text)).toEqual([
    "period,start,end,Tests,Download (Mbit/s),Upload (Mbit/s),Ping (ms),vs. previous",
    "2026-W41,2026-10-05,2026-10-11,2,150,10.0,5.00,200",
    "2026-W40,2026-09-28,2026-10-04,1,50.0,10.0,5.00,",
    // Nothing to follow in the older week: the median is empty, not "--"
    "2026-W39,2026-09-21,2026-09-27,1,,10.0,5.00,",
    ""
  ]);
});

test("a period is saved for the group chosen only", async ({ page }) => {
  await openSpeed(page, {
    [SPEED_SUMMARY]: {
      v: 1,
      rows: [
        speedRow("2026-10-07T15:00:00Z", 20, { conn: "single" }),
        speedRow("2026-10-07T14:00:00Z", 200, { conn: "multi" })
      ]
    }
  });
  await page.locator("#historyPeriod").selectOption("month");
  await page.locator("#historyGroup").selectOption("multi");
  const file = await saved(page);
  expect(lines(file.text)[1]).toBe("2026-10,2026-10-01,2026-10-31,1,200,10.0,5.00,");
  // The latest results, on the other hand, are all of them
  await page.locator("#historyPeriod").selectOption("detail");
  expect(lines((await saved(page)).text)).toHaveLength(4);
});

test("stability: the file of the latest measurements and the one of a period", async ({ page }) => {
  const row = (iso, avg, loss) => ({ t: at(iso), avg, min: 5, max: 40, jitter: 2, loss, target: GOOGLE, server: "" });
  await openStability(page, {
    [STABILITY_SUMMARY]: { v: 1, rows: [row("2026-10-09T15:00:00Z", 30, 1.5), row("2026-10-02T15:00:00Z", 20, 0)] }
  });
  const results = await saved(page);
  expect(results.name).toBe("history_results_2026-10-09.csv");
  expect(lines(results.text)).toEqual([
    "date,average_ms,min_ms,max_ms,jitter_ms,failed_percent,target,server",
    `2026-10-09 12:00,30,5,40,2,1.5,${GOOGLE},`,
    `2026-10-02 12:00,20,5,40,2,0,${GOOGLE},`,
    ""
  ]);
  await page.locator("#historyPeriod").selectOption("month");
  const month = await saved(page);
  expect(month.name).toBe("history_month_2026-10-09.csv");
  expect(lines(month.text)[0]).toBe(
    "period,start,end,Measurements,Average (ms),Jitter (ms),Failed (%),Rating,vs. previous"
  );
  expect(lines(month.text)[1]).toBe("2026-10,2026-10-01,2026-10-31,2,25.0,2.00,0.8,Good,");
});

test("the button is there only when there is something to save", async ({ page }) => {
  // The section shows (there is a result in the list), but the summary is one a newer version wrote: no rows to save
  await openSpeed(page, {
    "librespeed-better-history": [
      {
        date: at("2026-10-09T12:00:00Z"),
        dl: "250",
        ul: "100",
        ping: "8",
        jitter: "1",
        ip: "",
        testId: null,
        conn: "multi"
      }
    ],
    [SPEED_SUMMARY]: { v: 2, rows: [{ t: 1 }] }
  });
  await expect(page.locator("#historySection")).toBeVisible();
  await expect(page.locator("#historyExport")).toHaveAttribute("hidden", "");
});

test("the button shows when the summary has rows", async ({ page }) => {
  await openSpeed(page, { [SPEED_SUMMARY]: { v: 1, rows: summary } });
  await expect(page.locator("#historyExport")).toBeVisible();
});

test("saving does not ask anything of a server", async ({ page }) => {
  await openSpeed(page, { [SPEED_SUMMARY]: { v: 1, rows: summary } });
  const requests = [];
  page.on("request", request => requests.push(request.url()));
  await saved(page);
  const outside = requests.filter(
    url => !url.startsWith(staticRepositoryUrl) && !url.startsWith("blob:") && !url.startsWith("data:")
  );
  expect(outside).toEqual([]);
  expect(requests.filter(url => /results\/|telemetry|json\.php/.test(url))).toEqual([]);
});

test("the button has its name in each language and the icon of the set", async ({ page }) => {
  await openSpeed(page, { [SPEED_SUMMARY]: { v: 1, rows: summary } });
  await expect(page.locator("#historyExport")).toHaveAttribute("aria-label", "Download the history as CSV");
  await expect(page.locator("#historyExport svg")).toHaveCount(1);
  for (const [lang, name] of [
    ["pt", "Baixar o histórico em CSV"],
    ["es", "Descargar el historial en CSV"],
    ["sv", "Ladda ner historiken som CSV"]
  ]) {
    await page.goto(`${staticRepositoryUrl}/index-better.html?lang=${lang}`);
    await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
    await expect(page.locator("#historyExport")).toHaveAttribute("aria-label", name);
    await expect(page.locator("#historyExport")).toHaveAttribute("title", name);
  }
  const material = await page.locator("#historyExport svg").innerHTML();
  await page.goto(`${staticRepositoryUrl}/index-better.html?icons=lucide`);
  await expect(page.locator("html")).toHaveAttribute("data-icons", "lucide");
  await expect(page.locator("#historyExport svg")).toHaveCount(1);
  expect(await page.locator("#historyExport svg").innerHTML()).not.toBe(material);
});
