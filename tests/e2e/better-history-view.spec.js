const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const SPEED = "librespeed-better-history";
const SPEED_SUMMARY = "librespeed-better-history-summary";
const STABILITY = "librespeed-better-stability-history";
const STABILITY_SUMMARY = "librespeed-better-stability-history-summary";
const GOOGLE = "https://www.google.com/generate_204";

// Fixed dates and zone, so nothing depends on the day or on the place the tests run
const NOW = new Date("2026-10-09T15:00:00Z");
const at = iso => Date.parse(iso);

test.use({ timezoneId: "America/Sao_Paulo" });

// A row of the summary of the speed test
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

// A row of the summary of the stability
const stabilityRow = (iso, avg, jitter, loss, target = GOOGLE) => ({
  t: at(iso),
  avg,
  min: 5,
  max: 40,
  jitter,
  loss,
  target,
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

// Values in localStorage before the page starts: the consent, so nothing asks for it, and what the test seeds
async function seed(page, values) {
  await page.addInitScript(
    ([entries]) => {
      window.localStorage.setItem("librespeed-better-consent", String(Date.now()));
      for (const [key, value] of entries) window.localStorage.setItem(key, JSON.stringify(value));
    },
    [Object.entries(values)]
  );
}

async function openSpeed(page, values = {}, query = "", telemetry = null) {
  await page.clock.setFixedTime(NOW);
  await mockServers(page, ["local"]);
  if (telemetry)
    await page.route("**/settings.json*", route => route.fulfill({ json: { telemetry_level: telemetry } }));
  await seed(page, values);
  await page.goto(`${staticRepositoryUrl}/index-better.html${query}`);
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
}

async function openStability(page, values = {}, query = "") {
  await page.clock.setFixedTime(NOW);
  await mockServers(page, []);
  await seed(page, values);
  await page.goto(`${staticRepositoryUrl}/stability-better.html${query}`);
  await expect(page.locator(".panel-button")).toBeVisible();
}

// The lines of the table as lists of texts: the period, then the columns
function tableLines(page) {
  return page
    .locator(".history-table tbody tr")
    .evaluateAll(lines => lines.map(line => [...line.querySelectorAll("th, td")].map(cell => cell.textContent)));
}

const oneResult = { dl: "250", ul: "100", ping: "8", jitter: "1", ip: "", testId: null, conn: "multi" };

test("by default the latest results show, as before", async ({ page }) => {
  await openSpeed(page, {
    [SPEED]: [{ date: at("2026-10-09T12:00:00Z"), ...oneResult }],
    [SPEED_SUMMARY]: { v: 1, rows: [speedRow("2026-10-09T12:00:00Z", 250)] }
  });
  await expect(page.locator("#historyPeriod")).toHaveValue("detail");
  await expect(page.locator(".history-header")).toBeVisible();
  // The attribute is checked, because an empty element is "hidden" for the browser even without it
  await expect(page.locator("#historySummary")).toHaveAttribute("hidden", "");
  await expect(page.locator("#historyList")).not.toHaveAttribute("hidden", "");
});

test("going back to the latest results hides the table and shows the list again", async ({ page }) => {
  await openSpeed(page, {
    [SPEED]: [{ date: at("2026-10-09T12:00:00Z"), ...oneResult }],
    [SPEED_SUMMARY]: { v: 1, rows: [speedRow("2026-10-09T12:00:00Z", 250)] }
  });
  await page.locator("#historyPeriod").selectOption("week");
  await expect(page.locator("#historyList")).toHaveAttribute("hidden", "");
  await expect(page.locator("#historySummary")).not.toHaveAttribute("hidden", "");
  await page.locator("#historyPeriod").selectOption("detail");
  await expect(page.locator("#historySummary")).toHaveAttribute("hidden", "");
  await expect(page.locator("#historyList")).not.toHaveAttribute("hidden", "");
  await expect(page.locator(".history-header")).toBeVisible();
});

test("speed test: by week, the median of each week, the most recent first", async ({ page }) => {
  await openSpeed(page, {
    [SPEED_SUMMARY]: {
      v: 1,
      rows: [
        speedRow("2026-10-08T15:00:00Z", 300),
        speedRow("2026-10-07T15:00:00Z", 200),
        speedRow("2026-10-06T15:00:00Z", 100),
        speedRow("2026-10-01T15:00:00Z", 50)
      ]
    }
  });
  await page.locator("#historyPeriod").selectOption("week");
  await expect(page.locator("#historySummary")).toBeVisible();
  await expect(page.locator("#historyList")).toBeHidden();
  expect(await tableLines(page)).toEqual([
    ["05/10 – 11/10/2026", "3", "200", "10.0", "5.00", "+300.0%"],
    ["28/09 – 04/10/2026", "1", "50.0", "10.0", "5.00", "--"]
  ]);
});

test("speed test: by day, the day follows the time zone of the browser", async ({ page }) => {
  // 23:59 of 9 October in São Paulo, already 10 October in UTC
  await openSpeed(page, { [SPEED_SUMMARY]: { v: 1, rows: [speedRow("2026-10-10T02:59:00Z", 90)] } });
  await page.locator("#historyPeriod").selectOption("day");
  expect((await tableLines(page))[0][0]).toBe("09/10/2026");
});

test("the choice of the period is kept after a reload", async ({ page }) => {
  await openSpeed(page, { [SPEED_SUMMARY]: { v: 1, rows: [speedRow("2026-10-08T15:00:00Z", 300)] } });
  await page.locator("#historyPeriod").selectOption("month");
  await page.reload();
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
  await expect(page.locator("#historyPeriod")).toHaveValue("month");
  await expect(page.locator("#historySummary")).toBeVisible();
  expect((await tableLines(page))[0][0]).toBe("01/10 – 31/10/2026");
});

test("speed test: with single and multiple results the group can be chosen, the most recent first", async ({
  page
}) => {
  await openSpeed(page, {
    [SPEED_SUMMARY]: {
      v: 1,
      rows: [
        speedRow("2026-10-09T14:00:00Z", 20, { conn: "single" }),
        speedRow("2026-10-08T14:00:00Z", 300, { conn: "multi" })
      ]
    }
  });
  await page.locator("#historyPeriod").selectOption("day");
  await expect(page.locator("#historyGroup")).toBeVisible();
  await expect(page.locator("#historyGroup option")).toHaveCount(3);
  await expect(page.locator("#historyGroup")).toHaveValue("single");
  expect(await tableLines(page)).toEqual([["09/10/2026", "1", "20.0", "10.0", "5.00", "--"]]);
  await page.locator("#historyGroup").selectOption("multi");
  expect(await tableLines(page)).toEqual([["08/10/2026", "1", "300", "10.0", "5.00", "--"]]);
});

test("speed test: with only multiple results the group list stays hidden", async ({ page }) => {
  await openSpeed(page, { [SPEED_SUMMARY]: { v: 1, rows: [speedRow("2026-10-08T14:00:00Z", 300)] } });
  await page.locator("#historyPeriod").selectOption("day");
  await expect(page.locator("#historyGroup")).toBeHidden();
});

test("stability: by month, median ping, mean failures and the rating badge", async ({ page }) => {
  await openStability(page, {
    [STABILITY_SUMMARY]: {
      v: 1,
      rows: [
        stabilityRow("2026-10-03T12:00:00Z", 30, 3, 3),
        stabilityRow("2026-10-02T12:00:00Z", 20, 2, 0),
        stabilityRow("2026-10-01T12:00:00Z", 10, 1, 0)
      ]
    }
  });
  await page.locator("#historyPeriod").selectOption("month");
  expect(await tableLines(page)).toEqual([["01/10 – 31/10/2026", "3", "20.0", "2.00", "1.0", "Good", "--"]]);
  await expect(page.locator(".history-table td.history-badge.good")).toHaveCount(1);
});

test("stability: old measurements without a target are grouped as Unknown", async ({ page }) => {
  await openStability(page, {
    [STABILITY_SUMMARY]: {
      v: 1,
      rows: [stabilityRow("2026-10-03T12:00:00Z", 20, 2, 0), stabilityRow("2026-10-02T12:00:00Z", 20, 2, 0, "")]
    }
  });
  await page.locator("#historyPeriod").selectOption("day");
  await expect(page.locator("#historyGroup")).toBeVisible();
  expect(await page.locator("#historyGroup option").allTextContents()).toEqual(["All", "Google", "Unknown"]);
});

test("the section shows when only the summary has results", async ({ page }) => {
  await openSpeed(page, { [SPEED_SUMMARY]: { v: 1, rows: [speedRow("2026-10-08T14:00:00Z", 300)] } });
  await expect(page.locator("#historySection")).toBeVisible();
});

test("collapsing the section hides the period controls and the table", async ({ page }) => {
  await openSpeed(page, { [SPEED_SUMMARY]: { v: 1, rows: [speedRow("2026-10-08T14:00:00Z", 300)] } });
  await page.locator("#historyPeriod").selectOption("week");
  await expect(page.locator(".history-view")).toBeVisible();
  await expect(page.locator("#historySummary")).toBeVisible();
  await page.locator("#historyToggle").click();
  await expect(page.locator(".history-view")).toBeHidden();
  await expect(page.locator("#historySummary")).toBeHidden();
});

test("the period controls and the table follow the language", async ({ page }) => {
  await openSpeed(page, { [SPEED_SUMMARY]: { v: 1, rows: [speedRow("2026-10-08T14:00:00Z", 300)] } }, "?lang=pt");
  await expect(page.locator('#historyPeriod option[value="week"]')).toHaveText("Por semana");
  await page.locator("#historyPeriod").selectOption("week");
  await expect(page.locator('.history-table th[scope="col"]').first()).toHaveText("Período");
});

test("Swedish has the texts of the history by period", async ({ page }) => {
  await openSpeed(
    page,
    {
      [SPEED]: [{ date: at("2026-10-09T12:00:00Z"), ...oneResult }],
      [SPEED_SUMMARY]: { v: 1, rows: [speedRow("2026-10-08T14:00:00Z", 300)] }
    },
    "?lang=sv"
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await expect(page.locator("#historyToggle")).toContainText("Testhistorik");
  await expect(page.locator('#historyPeriod option[value="week"]')).toHaveText("Per vecka");
  await expect(page.locator(".toast")).toContainText("Sparas bara i den här webbläsaren");
  await page.locator("#historyPeriod").selectOption("week");
  await expect(page.locator('.history-table th[scope="col"]').nth(2)).toHaveText("Nedladdning (Mbit/s)");
  await expect(page.locator("#historySummary caption")).toHaveText(/Medianer/);
});

test("every key of the history has a text in each of the four languages", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = lang =>
    JSON.parse(fs.readFileSync(path.join(__dirname, `../../frontend/better/locales/${lang}.json`), "utf8"));
  const english = read("en");
  const keys = Object.keys(english).filter(key => key.startsWith("history."));
  expect(keys.length).toBeGreaterThan(30);
  for (const lang of ["pt", "es", "sv"]) {
    const texts = read(lang);
    const missing = keys.filter(key => typeof texts[key] !== "string" || !texts[key].trim());
    expect(missing, `the keys of the history that ${lang}.json lacks`).toEqual([]);
  }
});

test("the table is a table for screen readers", async ({ page }) => {
  await openSpeed(page, { [SPEED_SUMMARY]: { v: 1, rows: [speedRow("2026-10-08T14:00:00Z", 300)] } });
  await page.locator("#historyPeriod").selectOption("week");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Period" })).toBeVisible();
  await expect(page.getByRole("rowheader")).toHaveText("05/10 – 11/10/2026");
});

test("on a phone the page does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openStability(page, {
    [STABILITY_SUMMARY]: {
      v: 1,
      rows: [stabilityRow("2026-10-03T12:00:00Z", 30, 3, 3), stabilityRow("2026-10-02T12:00:00Z", 20, 2, 0)]
    }
  });
  await page.locator("#historyPeriod").selectOption("week");
  await expect(page.locator("#historySummary")).toBeVisible();
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(sideways).toBe(false);
});

test("the arrow of the period list follows the icon set", async ({ page }) => {
  await openStability(
    page,
    { [STABILITY_SUMMARY]: { v: 1, rows: [stabilityRow("2026-10-03T12:00:00Z", 20, 2, 0)] } },
    "?icons=lucide"
  );
  await expect(page.locator("html")).toHaveAttribute("data-icons", "lucide");
  const arrows = await page.evaluate(() => ({
    period: getComputedStyle(document.getElementById("historyPeriod")).backgroundImage,
    duration: getComputedStyle(document.getElementById("durationSelect")).backgroundImage
  }));
  expect(arrows.period).toContain("url(");
  expect(arrows.period).toBe(arrows.duration);
});

test("speed test with telemetry: clearing says the server keeps its results", async ({ page }) => {
  await openSpeed(
    page,
    {
      [SPEED]: [{ date: at("2026-10-09T12:00:00Z"), ...oneResult }],
      [SPEED_SUMMARY]: { v: 1, rows: [speedRow("2026-10-09T12:00:00Z", 250)] }
    },
    "",
    "basic"
  );
  let message = "";
  page.once("dialog", dialog => {
    message = dialog.message();
    dialog.dismiss();
  });
  await page.locator("#historyClear").click();
  expect(message).toContain("The results kept by the server are not deleted");
  await expect(page.locator(".history-header")).toHaveCount(1);
});

test("speed test without telemetry: clearing asks the plain question", async ({ page }) => {
  await openSpeed(
    page,
    {
      [SPEED]: [{ date: at("2026-10-09T12:00:00Z"), ...oneResult }],
      [SPEED_SUMMARY]: { v: 1, rows: [speedRow("2026-10-09T12:00:00Z", 250)] }
    },
    "",
    "off"
  );
  let message = "";
  page.once("dialog", dialog => {
    message = dialog.message();
    dialog.dismiss();
  });
  await page.locator("#historyClear").click();
  expect(message).toBe("Delete all the test history saved in this browser?");
});

test("speed test: the All option of the group list shows the single and the multiple results together", async ({
  page
}) => {
  await openSpeed(page, {
    [SPEED_SUMMARY]: {
      v: 1,
      rows: [
        speedRow("2026-10-09T14:00:00Z", 20, { conn: "single" }),
        speedRow("2026-10-08T14:00:00Z", 300, { conn: "multi" })
      ]
    }
  });
  await page.locator("#historyPeriod").selectOption("day");
  await page.locator("#historyGroup").selectOption({ label: "All" });
  expect((await tableLines(page)).map(line => line[2])).toEqual(["20.0", "300"]);
});

test("stability: targets that are not in the list are one Unknown option, not several", async ({ page }) => {
  await openStability(page, {
    [STABILITY_SUMMARY]: {
      v: 1,
      rows: [
        stabilityRow("2026-10-04T12:00:00Z", 20, 2, 0, "1.1.1.1"),
        stabilityRow("2026-10-03T12:00:00Z", 20, 2, 0, "8.8.8.8"),
        stabilityRow("2026-10-02T12:00:00Z", 20, 2, 0, "")
      ]
    }
  });
  await page.locator("#historyPeriod").selectOption("day");
  expect(await page.locator("#historyGroup option").allTextContents()).toEqual(["Unknown"]);
  await expect(page.locator("#historyGroup")).toBeHidden();
  expect(await tableLines(page)).toHaveLength(3);
});
