const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const pages = [
  { name: "speed test", path: "/index-better.html", start: "#startStopBtn", numbers: "#dlMeter" },
  { name: "stability", path: "/stability-better.html", start: "#startBtn", numbers: "#pingChart" }
];

async function open(page, path, query = "") {
  // The stability page reads the server list, an empty one means the local server
  await page.route("**/server-list.json*", route => route.fulfill({ json: [] }));
  await page.goto(`${staticRepositoryUrl}${path}${query}`);
  await expect(page.locator(".panel-button")).toBeVisible();
}

function rootStyle(page, name) {
  return page.evaluate(property => getComputedStyle(document.documentElement).getPropertyValue(property).trim(), name);
}

for (const { name, path, start } of pages) {
  test.describe(`Better ${name} page`, () => {
    test("loads in English without errors", async ({ page }) => {
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await open(page, path);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.locator(start)).toHaveText("Start");
      expect(errors).toEqual([]);
    });

    test("the panel opens with its button and closes with Escape", async ({ page }) => {
      await open(page, path);
      await expect(page.locator(".panel-box")).toBeHidden();
      await page.locator(".panel-button").click();
      await expect(page.locator(".panel-box")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".panel-box")).toBeHidden();
    });

    test("the mode is forced by the URL and by the panel, and kept", async ({ page }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await open(page, path, "?theme=dark");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

      await page.locator(".panel-button").click();
      await page.getByRole("radio", { name: "Light" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await page.goto(`${staticRepositoryUrl}${path}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    });

    test("auto follows the system", async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await open(page, path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.emulateMedia({ colorScheme: "light" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    });

    test("the brand color and the rounding are applied and kept", async ({ page }) => {
      await open(page, path);
      const before = await rootStyle(page, "--brand-h");
      await page.locator(".panel-button").click();
      await page.getByRole("radio", { name: "Green" }).click();
      expect(await rootStyle(page, "--brand-h")).toBe("150");
      expect(before).toBe("255");
      await page.getByRole("radio", { name: "Level 1" }).first().click();
      expect(await rootStyle(page, "--radius-button")).toBe("0rem");

      await page.reload();
      expect(await rootStyle(page, "--brand-h")).toBe("150");
      expect(await rootStyle(page, "--radius-button")).toBe("0rem");
    });

    test("an unknown brand in the URL is ignored", async ({ page }) => {
      await open(page, path, "?brand=nope");
      expect(await rootStyle(page, "--brand-h")).toBe("255");
    });

    test("the language is chosen with the URL or the panel and kept, with English for what is missing", async ({
      page
    }) => {
      await open(page, path, "?lang=pt");
      await expect(page.locator("html")).toHaveAttribute("lang", "pt");
      await expect(page.locator(start)).toHaveText("Iniciar");

      await page.locator(".panel-button").click();
      await page.getByRole("radio", { name: "Español" }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "es");
      await page.goto(`${staticRepositoryUrl}${path}`);
      await expect(page.locator("html")).toHaveAttribute("lang", "es");

      await page.goto(`${staticRepositoryUrl}${path}?lang=sv`);
      await expect(page.locator("html")).toHaveAttribute("lang", "sv");
      // The panel has no Swedish text yet, so it shows the English one
      await page.locator(".panel-button").click();
      await expect(page.locator(".panel-title").first()).toHaveText("Mode");
    });

    test("a font set, the text size and high contrast work from the panel", async ({ page }) => {
      await open(page, path);
      await page.locator(".panel-button").click();
      await page.getByRole("radio", { name: "Sora" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-font", "sora");

      await page.getByRole("button", { name: "Larger text" }).click();
      expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe("112.5%");

      await page.getByRole("button", { name: "High contrast" }).click();
      await expect(page.locator("html")).toHaveClass(/high-contrast/);
      expect(await rootStyle(page, "--primary")).toBe("#facc15");
    });

    test("the footer style changes", async ({ page }) => {
      await open(page, path);
      await page.locator(".panel-button").click();
      await page.getByRole("radio", { name: "Chips" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-footer", "chips");
    });

    test("the history shows the saved results", async ({ page }) => {
      const key = name === "stability" ? "librespeed-better-stability-history" : "librespeed-better-history";
      const entry =
        name === "stability"
          ? { date: Date.now(), duration: 60, avg: 12, min: 8, max: 30, jitter: 2, loss: 0, pings: [] }
          : { date: Date.now(), dl: 250, ul: 100, ping: 8, jitter: 1, ip: "203.0.113.5", conn: "multi" };
      await page.addInitScript(
        ([storageKey, value]) => window.localStorage.setItem(storageKey, JSON.stringify([value])),
        [key, entry]
      );
      await open(page, path);
      await expect(page.locator("#historySection")).toBeVisible();
      await page.locator(".history-header").first().click();
      await expect(page.locator(".history-details")).toBeVisible();
      await page.locator("#historyClear").click({ trial: true });
    });
  });
}

test("the stability page changes the chart style from the panel and keeps it", async ({ page }) => {
  await open(page, "/stability-better.html");
  await page.locator(".panel-button").click();
  await page.getByRole("radio", { name: "Bands" }).click();
  await page.reload();
  await page.locator(".panel-button").click();
  await expect(page.getByRole("radio", { name: "Bands" })).toHaveAttribute("aria-checked", "true");
});

test("the speed test page keeps the server list of the original page", async ({ page }) => {
  await page.route("**/server-list.json*", route => route.fulfill({ json: [] }));
  await page.goto(`${staticRepositoryUrl}/index-better.html`);
  await expect(page.locator("#serverArea")).toBeHidden();
  const source = await page.evaluate(() => fetch("index-better.html").then(response => response.text()));
  expect(source).toContain("var SPEEDTEST_SERVERS = [");
  expect(source).toContain('id="server"');
});
