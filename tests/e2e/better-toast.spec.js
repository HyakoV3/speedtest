const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const SPEED_SUMMARY = "librespeed-better-history-summary";
const STABILITY_SUMMARY = "librespeed-better-stability-history-summary";

const at = iso => Date.parse(iso);

test.use({ timezoneId: "America/Sao_Paulo" });

const speedRow = iso => ({ t: at(iso), dl: 300, ul: 10, ping: 5, jitter: 1, conn: "multi", server: "", id: null });
const stabilityRow = iso => ({
  t: at(iso),
  avg: 20,
  min: 5,
  max: 40,
  jitter: 2,
  loss: 0,
  target: "https://www.google.com/generate_204",
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

const withHistory = { [SPEED_SUMMARY]: { v: 1, rows: [speedRow("2026-10-08T14:00:00Z")] } };

async function openSpeed(page, values = withHistory, query = "", telemetry = null) {
  await mockServers(page, ["local"]);
  if (telemetry)
    await page.route("**/settings.json*", route => route.fulfill({ json: { telemetry_level: telemetry } }));
  await seed(page, values);
  await page.goto(`${staticRepositoryUrl}/index-better.html${query}`);
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
}

async function openStability(page, values, query = "") {
  await mockServers(page, []);
  await seed(page, values);
  await page.goto(`${staticRepositoryUrl}/stability-better.html${query}`);
  await expect(page.locator(".panel-button")).toBeVisible();
}

const LOCAL = "Saved only in this browser, on this device.";

test("the toast says the history is kept only in this browser, once in each session", async ({ page, context }) => {
  await openSpeed(page);
  await expect(page.locator(".toast")).toHaveText(`${LOCAL}×`);
  // The same tab, after a reload: nothing
  await page.reload();
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
  await expect(page.locator("#historySection")).toBeVisible();
  // The toast of a first visit takes a moment (the translations are read first): the absence is only told after that
  await page.evaluate(() => LibreSpeedI18n.ready);
  await page.waitForTimeout(1500);
  expect(await page.locator(".toast").count()).toBe(0);
  // Another tab is another session
  const other = await context.newPage();
  await mockServers(other, ["local"]);
  await other.goto(`${staticRepositoryUrl}/index-better.html`);
  await expect(other.locator(".toast")).toHaveText(`${LOCAL}×`);
});

test("the notes are not under the table any more", async ({ page }) => {
  await openSpeed(page);
  await page.locator("#historyPeriod").selectOption("week");
  await expect(page.locator(".history-note")).toHaveCount(0);
  await expect(page.locator("#historyServerNote")).toHaveCount(0);
});

test("the toast goes away by itself", async ({ page }) => {
  await openSpeed(page);
  await expect(page.locator(".toast")).toBeVisible();
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 9000 });
});

test("the close button takes the toast away", async ({ page }) => {
  await openSpeed(page);
  await page.locator(".toast-close").click();
  await expect(page.locator(".toast")).toHaveCount(0);
});

test("the toast stays while the close button has the focus", async ({ page }) => {
  await openSpeed(page);
  await expect(page.locator(".toast")).toBeVisible();
  await page.locator(".toast-close").focus();
  await page.waitForTimeout(7500);
  await expect(page.locator(".toast")).toHaveCount(1);
  await page.locator(".toast-close").blur();
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 9000 });
});

test("the messages go in a polite live region that is there before the first one", async ({ page }) => {
  await mockServers(page, ["local"]);
  await seed(page, {});
  await page.goto(`${staticRepositoryUrl}/index-better.html`);
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
  const region = page.locator("#toastRegion");
  await expect(region).toHaveCount(1);
  await expect(region).toHaveAttribute("role", "status");
  await expect(region).toHaveAttribute("aria-live", "polite");
  await expect(region.locator(".toast")).toHaveCount(0);
});

test("the toast lets the mouse go through, only the close button is clickable", async ({ page }) => {
  await openSpeed(page);
  const events = await page.evaluate(() => ({
    region: getComputedStyle(document.getElementById("toastRegion")).pointerEvents,
    toast: getComputedStyle(document.querySelector(".toast")).pointerEvents,
    close: getComputedStyle(document.querySelector(".toast-close")).pointerEvents
  }));
  expect(events).toEqual({ region: "none", toast: "none", close: "auto" });
});

test("with telemetry the two notices are piled up, the newest at the bottom, and each one has its own close button", async ({
  page
}) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await openSpeed(page, withHistory, "", "basic");
  await expect(page.locator(".toast.visible")).toHaveCount(2);
  const first = page.locator(".toast").nth(0);
  const second = page.locator(".toast").nth(1);
  await expect(first).toContainText("Saved only in this browser");
  await expect(second).toContainText("This server also keeps every speed test it receives");
  const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  // The first one above the second, in the same column, and the newest one close to the corner
  expect(a.y + a.height).toBeLessThanOrEqual(b.y + 1);
  expect(Math.abs(a.x - b.x)).toBeLessThan(2);
  expect(800 - (b.y + b.height)).toBeLessThan(40);
  // The close button of the first one closes the first one, and not the last one that was made
  await first.locator(".toast-close").click();
  await expect(page.locator(".toast")).toHaveCount(1);
  await expect(page.locator(".toast")).toContainText("This server also keeps every speed test it receives");
});

test("speed test without telemetry: only the first toast", async ({ page }) => {
  await openSpeed(page, withHistory, "", "off");
  await expect(page.locator(".toast")).toContainText("Saved only in this browser");
  await page.locator(".toast-close").click();
  await page.waitForTimeout(600);
  expect(await page.locator(".toast").count()).toBe(0);
});

test("stability: only the first toast", async ({ page }) => {
  await openStability(page, { [STABILITY_SUMMARY]: { v: 1, rows: [stabilityRow("2026-10-03T12:00:00Z")] } });
  await expect(page.locator(".toast")).toContainText("Saved only in this browser");
  await page.locator(".toast-close").click();
  await page.waitForTimeout(600);
  expect(await page.locator(".toast").count()).toBe(0);
});

test("the toast is not shown when there is no history", async ({ page }) => {
  await openSpeed(page, {});
  await page.evaluate(() => LibreSpeedI18n.ready);
  await page.waitForTimeout(1500);
  expect(await page.locator(".toast").count()).toBe(0);
});

test("saving the CSV and clearing the history tell what was done", async ({ page }) => {
  await openSpeed(page);
  await page.locator(".toast-close").click();
  await expect(page.locator(".toast")).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#historyExport").click()]);
  expect(download.suggestedFilename()).toMatch(/^history_results_/);
  await expect(page.locator(".toast.visible")).toHaveText("CSV downloaded×");
  await page.locator(".toast-close").click();
  await expect(page.locator(".toast")).toHaveCount(0);
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#historyClear").click();
  await expect(page.locator(".toast.visible")).toHaveText("History deleted×");
});

for (const [lang, message, close] of [
  ["pt", "Salvo só neste navegador, neste aparelho.", "Fechar"],
  ["es", "Guardado solo en este navegador, en este dispositivo.", "Cerrar"],
  ["sv", "Sparas bara i den här webbläsaren, på den här enheten.", "Stäng"]
]) {
  test(`the toast is in the language of the page: ${lang}`, async ({ page }) => {
    await openSpeed(page, withHistory, `?lang=${lang}`);
    await expect(page.locator(".toast .toast-text")).toHaveText(message);
    await expect(page.locator(".toast-close")).toHaveAttribute("aria-label", close);
  });
}

test("with reduced motion the toast does not fade or move", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  await openSpeed(page);
  const style = await page.locator(".toast").evaluate(node => getComputedStyle(node).transitionDuration);
  // The browser writes "no transition" as a time that is practically zero
  expect(parseFloat(style)).toBeLessThan(0.001);
  await context.close();
});

test("without sessionStorage the toast shows once for each page load", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (this === window.sessionStorage) throw new DOMException("blocked", "SecurityError");
      return original.call(this, key);
    };
  });
  await openSpeed(page);
  await expect(page.locator(".toast")).toHaveCount(1);
  // The history is drawn again (a change of language does it), and the same toast does not come back
  await page.evaluate(() => testHistory.render());
  await page.locator(".toast-close").click();
  await page.evaluate(() => testHistory.render());
  await page.waitForTimeout(600);
  expect(await page.locator(".toast").count()).toBe(0);
});

test("the toast floats at the bottom left corner of the window", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await openSpeed(page);
  await expect(page.locator(".toast.visible")).toBeVisible();
  const box = await page.locator(".toast").boundingBox();
  // Close to the left edge and to the bottom edge, not in the middle
  expect(box.x).toBeLessThan(40);
  expect(800 - (box.y + box.height)).toBeLessThan(40);
  expect(box.x + box.width).toBeLessThan(550);
});

test("on a phone the toast is at the bottom left too, inside the window", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openSpeed(page);
  await expect(page.locator(".toast.visible")).toBeVisible();
  const box = await page.locator(".toast").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x).toBeLessThan(40);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
});

test("a message stays as long as it takes to read it", async ({ page }) => {
  await openSpeed(page, {});
  const times = await page.evaluate(() => [
    LibreSpeedToast.readTime("x"),
    LibreSpeedToast.readTime("x".repeat(100)),
    LibreSpeedToast.readTime("x".repeat(1000))
  ]);
  // At least five seconds, three and a little for each letter, at most fourteen
  expect(times).toEqual([5000, 8500, 14000]);
});

test("at most three messages are on the page, the others wait for a place", async ({ page }) => {
  await openSpeed(page, {});
  await page.evaluate(() => {
    for (let i = 1; i <= 5; i++) LibreSpeedToast.show(`message ${i}`);
  });
  await expect(page.locator(".toast")).toHaveCount(3);
  await expect(page.locator(".toast").last()).toContainText("message 3");
  await page.locator(".toast-close").first().click();
  // One goes away and the fourth takes its place, at the bottom
  await expect(page.locator(".toast")).toHaveCount(3);
  await expect(page.locator(".toast").last()).toContainText("message 4");
  await expect(page.locator(".toast").first()).toContainText("message 2");
});

test("each close button closes its own message", async ({ page }) => {
  await openSpeed(page, {});
  await page.evaluate(() => {
    LibreSpeedToast.show("first");
    LibreSpeedToast.show("second");
    LibreSpeedToast.show("third");
  });
  await expect(page.locator(".toast")).toHaveCount(3);
  await page.locator(".toast").nth(1).locator(".toast-close").click();
  await expect(page.locator(".toast")).toHaveCount(2);
  expect(await page.locator(".toast-text").allTextContents()).toEqual(["first", "third"]);
});

test("a pile of messages stays longer than one alone", async ({ page }) => {
  await openSpeed(page, {});
  // The clock is the one of the test from here on: the time is moved by hand
  await page.clock.install();
  await page.evaluate(() => LibreSpeedToast.show("alone"));
  await page.clock.runFor(4900);
  await expect(page.locator(".toast")).toHaveCount(1);
  await page.clock.runFor(600);
  await expect(page.locator(".toast")).toHaveCount(0);
  // Three together: eight seconds each (five, and a second and a half for each of the other two)
  await page.evaluate(() => {
    LibreSpeedToast.show("one");
    LibreSpeedToast.show("two");
    LibreSpeedToast.show("three");
  });
  await page.clock.runFor(7800);
  await expect(page.locator(".toast")).toHaveCount(3);
  await page.clock.runFor(700);
  await expect(page.locator(".toast")).toHaveCount(0);
});

test("a message that comes while another is on the page gives the other more time", async ({ page }) => {
  await openSpeed(page, {});
  await page.clock.install();
  await page.evaluate(() => LibreSpeedToast.show("first"));
  await page.clock.runFor(4000);
  await page.evaluate(() => LibreSpeedToast.show("second"));
  // Alone the first would be gone at five seconds: now it has five and a half seconds more
  await page.clock.runFor(5500);
  await expect(page.locator(".toast")).toHaveCount(2);
  // Both go at ten and a half seconds: five and a half after the second one came, which also has a second and a half more
  await page.clock.runFor(1500);
  await expect(page.locator(".toast")).toHaveCount(0);
});

test("a message never goes before the time it was given, when the others are gone", async ({ page }) => {
  await openSpeed(page, {});
  await page.clock.install();
  await page.evaluate(() => {
    LibreSpeedToast.show("one");
    LibreSpeedToast.show("two");
    LibreSpeedToast.show("three");
  });
  // Three together: each one was given eight seconds. Two are closed, and a new one comes after 0.6 seconds
  await page.locator(".toast", { hasText: "one" }).locator(".toast-close").click();
  await page.locator(".toast", { hasText: "two" }).locator(".toast-close").click();
  await page.clock.runFor(600);
  await expect(page.locator(".toast")).toHaveCount(1);
  await page.evaluate(() => LibreSpeedToast.show("four"));
  // With the new one the third would have only 6.5 seconds from now, which is less than the eight it was given
  await page.clock.runFor(6800);
  await expect(page.locator(".toast-text")).toHaveText(["three"]);
  await page.clock.runFor(800);
  await expect(page.locator(".toast")).toHaveCount(0);
});
