const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const pages = [
  { name: "speed test", path: "/index-better.html", start: "#startStopBtn", numbers: "#dlMeter" },
  { name: "stability", path: "/stability-better.html", start: "#startBtn", numbers: "#pingChart" }
];

async function open(page, path, query = "") {
  // The stability page reads the server list, an empty one means the local server
  await page.route("**/server-list.json*", route =>
    route.fulfill({
      json: path.startsWith("/index")
        ? [
            {
              name: "local",
              server: "/backend",
              dlURL: "garbage.php",
              ulURL: "empty.php",
              pingURL: "empty.php",
              getIpURL: "getIP.php"
            }
          ]
        : []
    })
  );
  await page.route("**/backend/empty.php*", route =>
    route.fulfill({ body: "", headers: { "Access-Control-Allow-Origin": "*" } })
  );
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

test("the speed test page shows the server list like the modern design", async ({ page }) => {
  await page.route("**/server-list.json*", route =>
    route.fulfill({
      json: [
        {
          name: "Alpha, Testland",
          server: "/backend",
          dlURL: "garbage.php",
          ulURL: "empty.php",
          pingURL: "empty.php",
          getIpURL: "getIP.php"
        },
        {
          name: "Beta, Testland",
          server: "/backend",
          dlURL: "garbage.php",
          ulURL: "empty.php",
          pingURL: "empty.php",
          getIpURL: "getIP.php"
        }
      ]
    })
  );
  await page.route("**/backend/empty.php*", route =>
    route.fulfill({ body: "", headers: { "Access-Control-Allow-Origin": "*" } })
  );
  await page.goto(`${staticRepositoryUrl}/index-better.html`);
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
  await expect(page.locator("#serverArea")).toBeVisible();
  await expect(page.locator("#server option")).toHaveText(["Alpha, Testland", "Beta, Testland"]);
});

test("an external target can be tested when no server is reachable", async ({ page }) => {
  await page.route("**/server-list.json*", route =>
    route.fulfill({
      json: [{ name: "Unreachable", server: "http://127.0.0.1:1/", pingURL: "empty.php", dlURL: "garbage.php" }]
    })
  );
  await page.goto(`${staticRepositoryUrl}/stability-better.html`);
  await expect(page.locator("#startBtn")).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("#startBtn")).toHaveAttribute("title", "Select a target");

  await page.locator("#targetSelect").selectOption({ label: "LibreSpeed server" });
  await expect(page.locator("#startBtn")).toHaveAttribute("title", "No reachable local server found");

  await page.locator("#targetSelect").selectOption({ label: "Google" });
  await expect(page.locator("#startBtn")).toHaveAttribute("aria-disabled", "false");
  await page.locator("#targetSelect").selectOption({ label: "LibreSpeed server" });
  await expect(page.locator("#startBtn")).toHaveAttribute("aria-disabled", "true");
});

// Stability page: the target row and the server that shows up next to it
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

test("stability: nothing is chosen at first and the server is hidden", async ({ page }) => {
  await mockServers(page, ["Alpha, Testland", "Beta, Testland"]);
  await page.goto(`${staticRepositoryUrl}/stability-better.html`);
  await expect(page.locator("#targetSelect")).toHaveValue("");
  await expect(page.locator("#targetSelect option:checked")).toHaveText("Select a target");
  await expect(page.locator("#serverArea")).toBeHidden();
  await expect(page.locator("#startBtn")).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("#startBtn")).toHaveAttribute("title", "Select a target");
});

test("stability: the server shows up next to the target when LibreSpeed is chosen", async ({ page }) => {
  await mockServers(page, ["Alpha, Testland", "Beta, Testland"]);
  await page.goto(`${staticRepositoryUrl}/stability-better.html`);
  await page.locator("#targetSelect").selectOption({ label: "LibreSpeed server" });
  await expect(page.locator("#serverArea")).toBeVisible();
  await expect(page.locator("#server option")).toHaveText(["Alpha, Testland", "Beta, Testland"]);
  await expect(page.locator("#startBtn")).toHaveAttribute("aria-disabled", "false");

  // Same row as the target, below the row with the duration, Start and Reset
  const target = await page.locator("#targetSelect").boundingBox();
  const server = await page.locator("#server").boundingBox();
  const start = await page.locator("#startBtn").boundingBox();
  expect(Math.abs(target.y - server.y)).toBeLessThan(8);
  expect(target.y).toBeGreaterThan(start.y + start.height - 1);
});

test("stability: an external target hides the server again", async ({ page }) => {
  await mockServers(page, ["Alpha, Testland", "Beta, Testland"]);
  await page.goto(`${staticRepositoryUrl}/stability-better.html`);
  await page.locator("#targetSelect").selectOption({ label: "LibreSpeed server" });
  await expect(page.locator("#serverArea")).toBeVisible();
  for (const name of ["Google", "Cloudflare", "Apple"]) {
    await page.locator("#targetSelect").selectOption({ label: name });
    await expect(page.locator("#serverArea")).toBeHidden();
    await expect(page.locator("#startBtn")).toHaveAttribute("aria-disabled", "false");
  }
});

test("stability: a single server is not offered as a choice", async ({ page }) => {
  await mockServers(page, ["Only, Testland"]);
  await page.goto(`${staticRepositoryUrl}/stability-better.html`);
  await page.locator("#targetSelect").selectOption({ label: "LibreSpeed server" });
  await expect(page.locator("#startBtn")).toHaveAttribute("aria-disabled", "false");
  await expect(page.locator("#serverArea")).toBeHidden();
});

test("speed test: a single server is not offered as a choice", async ({ page }) => {
  await mockServers(page, ["Only, Testland"]);
  await page.goto(`${staticRepositoryUrl}/index-better.html`);
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
  await expect(page.locator("#serverArea")).toBeHidden();
});

test("speed test: the sponsor of the selected server shows under the list", async ({ page }) => {
  await page.route("**/server-list.json*", route =>
    route.fulfill({
      json: [
        {
          name: "Alpha, Testland",
          server: "/backend",
          dlURL: "garbage.php",
          ulURL: "empty.php",
          pingURL: "empty.php",
          getIpURL: "getIP.php",
          sponsorName: "Alpha Hosting",
          sponsorURL: "https://alpha.example"
        },
        {
          name: "Beta, Testland",
          server: "/backend",
          dlURL: "garbage.php",
          ulURL: "empty.php",
          pingURL: "empty.php",
          getIpURL: "getIP.php",
          sponsorName: "Beta Net"
        },
        {
          name: "Gamma, Testland",
          server: "/backend",
          dlURL: "garbage.php",
          ulURL: "empty.php",
          pingURL: "empty.php",
          getIpURL: "getIP.php"
        }
      ]
    })
  );
  await page.route("**/backend/empty.php*", route =>
    route.fulfill({ body: "", headers: { "Access-Control-Allow-Origin": "*" } })
  );
  await page.goto(`${staticRepositoryUrl}/index-better.html`);
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
  await page.locator("#server").selectOption({ label: "Alpha, Testland" });
  await expect(page.locator("#sponsor")).toHaveText("Sponsor: Alpha Hosting");
  await expect(page.locator("#sponsor a")).toHaveAttribute("href", "https://alpha.example");
  await page.locator("#server").selectOption({ label: "Beta, Testland" });
  await expect(page.locator("#sponsor")).toHaveText("Sponsor: Beta Net");
  await expect(page.locator("#sponsor a")).toHaveCount(0);
  await page.locator("#server").selectOption({ label: "Gamma, Testland" });
  await expect(page.locator("#sponsor")).toHaveText("");
});

test("stability: the sponsor shows under the target row only for a LibreSpeed server", async ({ page }) => {
  const server = (name, extra) => ({
    name,
    server: "/backend",
    dlURL: "garbage.php",
    ulURL: "empty.php",
    pingURL: "empty.php",
    getIpURL: "getIP.php",
    ...extra
  });
  await page.route("**/server-list.json*", route =>
    route.fulfill({
      json: [
        server("Alpha, Testland", { sponsorName: "Alpha Hosting", sponsorURL: "https://alpha.example" }),
        server("Beta, Testland")
      ]
    })
  );
  await page.route("**/backend/empty.php*", route =>
    route.fulfill({ body: "", headers: { "Access-Control-Allow-Origin": "*" } })
  );
  await page.goto(`${staticRepositoryUrl}/stability-better.html`);
  await expect(page.locator("#sponsor")).toBeHidden();
  await page.locator("#targetSelect").selectOption({ label: "LibreSpeed server" });
  await page.locator("#server").selectOption({ label: "Alpha, Testland" });
  await expect(page.locator("#sponsor")).toHaveText("Sponsor: Alpha Hosting");
  await expect(page.locator("#sponsor a")).toHaveAttribute("href", "https://alpha.example");

  // Centered under the selects
  const sponsor = await page.locator("#sponsor").boundingBox();
  const viewport = page.viewportSize();
  expect(Math.abs(sponsor.x + sponsor.width / 2 - viewport.width / 2)).toBeLessThan(10);

  await page.locator("#server").selectOption({ label: "Beta, Testland" });
  await expect(page.locator("#sponsor")).toBeHidden();
  await page.locator("#server").selectOption({ label: "Alpha, Testland" });
  await page.locator("#targetSelect").selectOption({ label: "Google" });
  await expect(page.locator("#sponsor")).toBeHidden();
});

for (const { name, path } of [
  { name: "speed test", path: "/index-better.html" },
  { name: "stability", path: "/stability-better.html" }
]) {
  test(`${name}: the logo, the title and the tagline of the modern design show on top`, async ({ page }) => {
    await page.goto(`${staticRepositoryUrl}${path}`);
    await expect(page.locator("header.brand .brand-logo")).toHaveAttribute("src", "frontend/images/logo.svg");
    await expect(page.locator("header.brand h1")).toHaveText("Free and Open Source Speedtest.");
    await expect(page.locator("header.brand .tagline")).toHaveText("No Flash, No Java, No Websockets, No Bullsh*t");
    await expect(page.locator('link[rel="shortcut icon"]')).toHaveAttribute("href", "frontend/images/favicon.svg");
    const logo = await page.locator("header.brand .brand-logo").evaluate(image => image.naturalWidth);
    expect(logo).toBeGreaterThan(0);

    await page.goto(`${staticRepositoryUrl}${path}?lang=pt`);
    await expect(page.locator("header.brand h1")).toHaveText("Teste de velocidade livre e de código aberto.");
  });
}

for (const { name, path } of [
  { name: "speed test", path: "/index-better.html" },
  { name: "stability", path: "/stability-better.html" }
]) {
  test(`${name}: the head has the manifest, the icons, the theme color and the description`, async ({ page }) => {
    await page.goto(`${staticRepositoryUrl}${path}`);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "manifest.webmanifest");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "images/icon-192.png");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#000000");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Free and Open Source Speedtest/);
  });
}

test("the tab titles of the better pages", async ({ page }) => {
  await page.goto(`${staticRepositoryUrl}/index-better.html`);
  await expect(page).toHaveTitle("LibreSpeed - Free and Open Source Speedtest");
  await page.goto(`${staticRepositoryUrl}/stability-better.html`);
  await expect(page).toHaveTitle("LibreSpeed - Stability Test");
});

// Privacy notice and sharing (they depend on the telemetry of the server)
async function mockTelemetry(page, level) {
  await page.route("**/settings.json*", route => route.fulfill({ json: { telemetry_level: level } }));
}

for (const { name, path } of [
  { name: "speed test", path: "/index-better.html" },
  { name: "stability", path: "/stability-better.html" }
]) {
  test(`${name}: without telemetry the test starts without asking`, async ({ page }) => {
    await mockTelemetry(page, "off");
    await page.goto(`${staticRepositoryUrl}${path}`);
    await page.evaluate(() => LibreSpeedConsent.ready);
    await page.evaluate(() => LibreSpeedConsent.ensure(() => (window.started = true)));
    await expect(page.locator("#consentDialog")).toHaveCount(0);
    expect(await page.evaluate(() => window.started)).toBe(true);
  });

  test(`${name}: with telemetry the first start asks for the privacy policy and remembers the answer`, async ({
    page
  }) => {
    await mockTelemetry(page, "basic");
    await page.goto(`${staticRepositoryUrl}${path}`);
    await page.evaluate(() => LibreSpeedConsent.ready);
    await page.evaluate(() => LibreSpeedConsent.ensure(() => (window.started = true)));
    const dialog = page.locator("#consentDialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("you agree to our privacy policy");
    expect(await page.evaluate(() => window.started)).toBeUndefined();

    // Cancel does not start and does not remember
    await dialog.locator(".consent-cancel").click();
    await expect(page.locator("#consentDialog")).toHaveCount(0);
    expect(await page.evaluate(() => window.started)).toBeUndefined();

    // Accept starts, and the next start does not ask again, not even after a reload
    await page.evaluate(() => LibreSpeedConsent.ensure(() => (window.started = true)));
    await page.locator("#consentDialog .consent-accept").click();
    await expect(page.locator("#consentDialog")).toHaveCount(0);
    expect(await page.evaluate(() => window.started)).toBe(true);
    await page.reload();
    await page.evaluate(() => LibreSpeedConsent.ready);
    await page.evaluate(() => LibreSpeedConsent.ensure(() => (window.startedAgain = true)));
    await expect(page.locator("#consentDialog")).toHaveCount(0);
    expect(await page.evaluate(() => window.startedAgain)).toBe(true);
  });

  test(`${name}: an answer older than a year is asked again, in the language of the page`, async ({ page }) => {
    await mockTelemetry(page, "basic");
    await page.addInitScript(() => {
      window.localStorage.setItem("librespeed-better-consent", String(Date.now() - 366 * 24 * 60 * 60 * 1000));
    });
    await page.goto(`${staticRepositoryUrl}${path}?lang=pt`);
    await page.evaluate(() => LibreSpeedConsent.ready);
    await page.evaluate(() => LibreSpeedConsent.ensure(() => (window.started = true)));
    await expect(page.locator("#consentDialog")).toContainText("política de privacidade");
    await expect(page.locator("#consentDialog .consent-accept")).toHaveText("Aceitar e iniciar");
  });
}

test("speed test: the Start button asks before the test and the policy can be read", async ({ page }) => {
  await mockTelemetry(page, "basic");
  await mockServers(page, ["Only, Testland"]);
  await page.goto(`${staticRepositoryUrl}/index-better.html`);
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
  await page.locator("#startStopBtn").click();
  await expect(page.locator("#consentDialog")).toBeVisible();
  await expect(page.locator("#startStopBtn")).not.toHaveClass(/running/);
  await page.locator("#consentDialog .consent-read").click();
  await expect(page.locator("#consentDialog")).toHaveCount(0);
  await expect(page.locator("#privacyPolicy")).toBeVisible();
});

test("stability: the Start button asks before the measurement", async ({ page }) => {
  await mockTelemetry(page, "basic");
  await page.goto(`${staticRepositoryUrl}/stability-better.html`);
  await page.locator("#targetSelect").selectOption({ label: "Google" });
  await page.locator("#startBtn").click();
  await expect(page.locator("#consentDialog")).toBeVisible();
  await expect(page.locator("#startBtn")).not.toHaveClass(/running/);
  await page.locator("#consentDialog .consent-accept").click();
  await expect(page.locator("#startBtn")).toHaveClass(/running/);
  await page.locator("#startBtn").click();
  await expect(page.locator("#startBtn")).not.toHaveClass(/running/);
});

function speedEntry(extra) {
  return { date: Date.now(), dl: 250, ul: 100, ping: 8, jitter: 1, ip: "203.0.113.5", conn: "multi", ...extra };
}

async function seedHistory(page, key, entries) {
  await page.addInitScript(
    ([storageKey, value]) => window.localStorage.setItem(storageKey, JSON.stringify(value)),
    [key, entries]
  );
}

test("speed test: a result with an id has a share icon that opens its link and picture", async ({ page }) => {
  await mockTelemetry(page, "basic");
  await mockServers(page, ["Only, Testland"]);
  await page.route("**/results/**", route =>
    route.fulfill({ status: 200, contentType: "image/png", body: Buffer.alloc(0) })
  );
  await seedHistory(page, "librespeed-better-history", [speedEntry({ testId: "42" }), speedEntry({})]);
  await page.goto(`${staticRepositoryUrl}/index-better.html`);
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);

  // Only the result with an id can be shared: the header and the icon are the two parts of one bar
  await expect(page.locator(".history-share-btn")).toHaveCount(1);
  const bar = page.locator(".history-bar").first();
  await expect(bar.locator(".history-header")).toBeVisible();
  await expect(bar.locator(".history-share-btn")).toBeVisible();
  const header = await bar.locator(".history-header").boundingBox();
  const icon = await bar.locator(".history-share-btn").boundingBox();
  expect(icon.x).toBeGreaterThan(header.x + header.width - 2);
  expect(Math.abs(icon.y - header.y)).toBeLessThan(2);
  expect(Math.abs(icon.height - header.height)).toBeLessThan(2);

  await bar.locator(".history-share-btn").click();
  await expect(page.locator("#shareDialog")).toBeVisible();
  await expect(page.locator("#shareImage")).toHaveAttribute("src", /\/results\/\?id=42&style=classic$/);
  await page.locator("#shareDialog .privacy-close").click();
  await expect(page.locator("#shareDialog")).toBeHidden();

  // The icon does not open the panel, and the header does not share
  await expect(page.locator(".history-panel.open")).toHaveCount(0);
  await bar.locator(".history-header").click();
  await expect(page.locator(".history-panel.open")).toHaveCount(1);
});

test("speed test: without telemetry the history has no share icon", async ({ page }) => {
  await mockTelemetry(page, "off");
  await mockServers(page, ["Only, Testland"]);
  await seedHistory(page, "librespeed-better-history", [speedEntry({ testId: "42" })]);
  await page.goto(`${staticRepositoryUrl}/index-better.html`);
  await expect(page.locator("#testWrapper")).toHaveClass(/visible/);
  await page.evaluate(() => LibreSpeedConsent.ready);
  await expect(page.locator(".history-header")).toHaveCount(1);
  await expect(page.locator(".history-share-btn")).toHaveCount(0);
});

test("stability: a measurement in the history is shared with a summary", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.share = async data => {
      window.sharedData = data;
    };
  });
  await seedHistory(page, "librespeed-better-stability-history", [
    { date: Date.now(), duration: 60, avg: 12.3, min: 8, max: 30, jitter: 1.5, loss: 0.5, pings: [] }
  ]);
  await page.goto(`${staticRepositoryUrl}/stability-better.html`);
  await expect(page.locator(".history-share-btn")).toHaveCount(1);
  await page.locator(".history-share-btn").click();
  await expect
    .poll(() => page.evaluate(() => window.sharedData && window.sharedData.text))
    .toContain("LibreSpeed stability test, 01:00");
  const shared = await page.evaluate(() => window.sharedData);
  expect(shared.text).toContain("Average 12.3 ms");
  expect(shared.text).toContain("failed requests 0.5%");
  expect(shared.url).toMatch(/\/stability-better\.html$/);
});

test("stability: without the share sheet the summary is copied", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined });
  });
  await seedHistory(page, "librespeed-better-stability-history", [
    { date: Date.now(), duration: 60, avg: 12.3, min: 8, max: 30, jitter: 1.5, loss: 0.5, pings: [] }
  ]);
  await page.goto(`${staticRepositoryUrl}/stability-better.html`);
  await page.locator(".history-share-btn").click();
  await expect(page.locator(".history-share-btn")).toHaveClass(/done/);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Average 12.3 ms");
});
