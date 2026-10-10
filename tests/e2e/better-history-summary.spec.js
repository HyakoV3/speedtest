const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const SPEED = "librespeed-better-history";
const SPEED_SUMMARY = "librespeed-better-history-summary";
const STABILITY = "librespeed-better-stability-history";
const STABILITY_SUMMARY = "librespeed-better-stability-history-summary";

// Fixed dates, so nothing depends on the day the tests run
const T1 = Date.parse("2026-10-08T12:00:00Z");
const T2 = Date.parse("2026-10-09T12:00:00Z");

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

async function openSpeed(page, values = {}, servers = ["local"]) {
  await mockServers(page, servers);
  await seed(page, values);
  await page.goto(`${staticRepositoryUrl}/index-better.html`);
  await expect(page.locator(".panel-button")).toBeVisible();
  // Without a server the page shows nothing but its message
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
}

async function openStability(page, values = {}) {
  await mockServers(page, []);
  await seed(page, values);
  await page.goto(`${staticRepositoryUrl}/stability-better.html`);
  await expect(page.locator(".panel-button")).toBeVisible();
}

function stored(page, key) {
  return page.evaluate(storageKey => JSON.parse(window.localStorage.getItem(storageKey)), key);
}

test("speed test: the first visit copies the saved results into the summary", async ({ page }) => {
  await openSpeed(page, {
    [SPEED]: [
      {
        date: T2,
        dl: "250.12",
        ul: "100.50",
        ping: "8.12",
        jitter: "1.05",
        ip: "203.0.113.5",
        testId: "57",
        conn: "multi"
      },
      { date: T1, dl: "Fail", ul: "", ping: "0.80", jitter: "0", ip: "", testId: null, conn: "single" }
    ]
  });
  expect(await stored(page, SPEED_SUMMARY)).toEqual({
    v: 1,
    rows: [
      { t: T2, dl: 250.12, ul: 100.5, ping: 8.12, jitter: 1.05, conn: "multi", server: "", id: "57" },
      { t: T1, dl: null, ul: null, ping: 0.8, jitter: 0, conn: "single", server: "", id: null }
    ]
  });
  // No IP address goes into the summary
  expect(JSON.stringify(await stored(page, SPEED_SUMMARY))).not.toContain("203.0.113");
});

test("the copy happens once", async ({ page }) => {
  await openSpeed(page, {
    [SPEED]: [
      { date: T2, dl: "250", ul: "100", ping: "8", jitter: "1", ip: "", testId: null, conn: "multi" },
      { date: T1, dl: "90", ul: "10", ping: "12", jitter: "2", ip: "", testId: null, conn: "multi" }
    ]
  });
  expect((await stored(page, SPEED_SUMMARY)).rows).toHaveLength(2);
  await page.reload();
  await expect(page.locator(".panel-button")).toBeVisible();
  expect((await stored(page, SPEED_SUMMARY)).rows).toHaveLength(2);
});

test("speed test: a new result goes to the summary with the server of the test", async ({ page }) => {
  await page.clock.setFixedTime(new Date(T2));
  await openSpeed(page, {}, ["Only, Testland"]);
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
  await page.evaluate(() => {
    uiData = {
      dlStatus: "90.00",
      ulStatus: "10.00",
      pingStatus: "12.00",
      jitterStatus: "1.00",
      clientIp: "",
      testId: null
    };
    recordSpeedtest();
  });
  expect((await stored(page, SPEED_SUMMARY)).rows).toEqual([
    { t: T2, dl: 90, ul: 10, ping: 12, jitter: 1, conn: "multi", server: "Only, Testland", id: null }
  ]);
  expect((await stored(page, SPEED))[0].server).toBe("Only, Testland");
});

test("stability: a finished measurement keeps its target, a stopped one stays out of the summary", async ({ page }) => {
  await page.clock.setFixedTime(new Date(T1));
  await openStability(page);
  await page.locator("#targetSelect").selectOption({ label: "Google" });
  await page.evaluate(() =>
    recordTest({ testState: 4, avgPing: 12.3, minPing: 8, maxPing: 30, jitter: 1.5, packetLoss: 0 })
  );
  await page.clock.setFixedTime(new Date(T2));
  await page.evaluate(() =>
    recordTest({ testState: 5, avgPing: 20, minPing: -1, maxPing: 40, jitter: 2, packetLoss: 0 })
  );
  const detail = await stored(page, STABILITY);
  expect(detail).toHaveLength(2);
  expect(detail[0].complete).toBe(false);
  expect(detail[1].complete).toBe(true);
  expect((await stored(page, STABILITY_SUMMARY)).rows).toEqual([
    {
      t: T1,
      avg: 12.3,
      min: 8,
      max: 30,
      jitter: 1.5,
      loss: 0,
      target: "https://www.google.com/generate_204",
      server: ""
    }
  ]);
});

test("the summary is kept when the storage refuses the list of results", async ({ page }) => {
  await page.addInitScript(key => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("full", "QuotaExceededError");
      return setItem.call(this, name, value);
    };
  }, STABILITY);
  await openStability(page);
  await page.evaluate(date => {
    testHistory.add({ date, duration: 60, avg: 10, min: 5, max: 20, jitter: 1, loss: 0, pings: [] });
  }, T2);
  expect((await stored(page, STABILITY_SUMMARY)).rows).toHaveLength(1);
  expect(await stored(page, STABILITY)).toBeNull();
});

test("the oldest rows go beyond 2000", async ({ page }) => {
  const rows = Array.from({ length: 2000 }, (_, i) => ({
    t: T2 - i * 60000,
    dl: 100,
    ul: 10,
    ping: 10,
    jitter: 1,
    conn: "multi",
    server: "",
    id: null
  }));
  await openSpeed(page, { [SPEED_SUMMARY]: { v: 1, rows } });
  await page.evaluate(date => {
    testHistory.add({ date, dl: "90", ul: "10", ping: "12", jitter: "1", ip: "", testId: null, conn: "multi" });
  }, T2 + 60000);
  const saved = (await stored(page, SPEED_SUMMARY)).rows;
  expect(saved).toHaveLength(2000);
  expect(saved[0].t).toBe(T2 + 60000);
  expect(saved[1999].t).toBe(T2 - 1998 * 60000);
});

test("a summary written by a newer version is left alone", async ({ page }) => {
  await openSpeed(page, { [SPEED_SUMMARY]: { v: 2, rows: [{ t: 1 }] } });
  const before = await page.evaluate(key => window.localStorage.getItem(key), SPEED_SUMMARY);
  await page.evaluate(date => {
    testHistory.add({ date, dl: "90", ul: "10", ping: "12", jitter: "1", ip: "", testId: null, conn: "multi" });
  }, T2);
  expect(await page.evaluate(key => window.localStorage.getItem(key), SPEED_SUMMARY)).toBe(before);
});

test("clearing deletes the results and the summary, and nothing comes back", async ({ page }) => {
  // The result is put in the storage once, and not by the script that runs at every load: after the reload it must not be
  // put back
  await openSpeed(page, {});
  // The first load made an empty summary, and the copy of the saved results happens only once: the summary is put too
  await page.evaluate(
    ([key, entry, summaryKey, row]) => {
      window.localStorage.setItem(key, JSON.stringify([entry]));
      window.localStorage.setItem(summaryKey, JSON.stringify({ v: 1, rows: [row] }));
    },
    [
      SPEED,
      { date: T2, dl: "250", ul: "100", ping: "8", jitter: "1", ip: "", testId: null, conn: "multi" },
      SPEED_SUMMARY,
      { t: T2, dl: 250, ul: 100, ping: 8, jitter: 1, conn: "multi", server: "", id: null }
    ]
  );
  await page.reload();
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
  expect((await stored(page, SPEED_SUMMARY)).rows).toHaveLength(1);
  await expect(page.locator("#historySection")).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#historyClear").click();
  expect(await stored(page, SPEED)).toEqual([]);
  expect(await stored(page, SPEED_SUMMARY)).toEqual({ v: 1, rows: [] });
  await page.reload();
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
  expect(await stored(page, SPEED_SUMMARY)).toEqual({ v: 1, rows: [] });
  await expect(page.locator("#historySection")).toBeHidden();
});

test("a result saved in another tab shows up", async ({ page, context }) => {
  await openSpeed(page);
  await expect(page.locator(".history-header")).toHaveCount(0);
  const other = await context.newPage();
  await mockServers(other, ["local"]);
  await other.goto(`${staticRepositoryUrl}/index-better.html`);
  await expect(other.locator(".panel-button")).toBeVisible();
  await other.evaluate(date => {
    testHistory.add({ date, dl: "90", ul: "10", ping: "12", jitter: "1", ip: "", testId: null, conn: "multi" });
  }, T2);
  await expect(page.locator(".history-header")).toHaveCount(1);
});

test("an obfuscated id is kept as text", async ({ page }) => {
  await openSpeed(page, {
    [SPEED]: [
      { date: T2, dl: "250", ul: "100", ping: "8", jitter: "1", ip: "", testId: "0b3x9k2", conn: "multi" },
      { date: T1, dl: "90", ul: "10", ping: "12", jitter: "1", ip: "", testId: 42, conn: "multi" }
    ]
  });
  const rows = (await stored(page, SPEED_SUMMARY)).rows;
  expect(rows[0].id).toBe("0b3x9k2");
  expect(rows[1].id).toBe("42");
  expect(typeof rows[1].id).toBe("string");
});
