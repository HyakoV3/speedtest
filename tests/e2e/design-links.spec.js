const { test, expect } = require("@playwright/test");
const { baseUrls } = require("./helpers/env");

const staticUrl = "http://127.0.0.1:18184";
const KEY = "librespeed-design";

const pages = [
  { design: "classic", path: "/index-classic.html" },
  { design: "modern", path: "/index-modern.html" },
  { design: "better", path: "/index-better.html" }
];
const targets = { classic: "index-classic.html", modern: "index-modern.html", better: "index-better.html" };

function saved(page) {
  return page.evaluate(key => window.localStorage.getItem(key), KEY);
}

function remember(page, design) {
  return page.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch (error) {
        // not needed
      }
    },
    [KEY, design]
  );
}

const stabilityPages = [
  { name: "stability", path: "/stability.html", current: null },
  { name: "stability-better", path: "/stability-better.html", current: "better" }
];

for (const { name, path, current } of stabilityPages) {
  test(`${name}: the footer links go to the stability page of each design`, async ({ page }) => {
    await page.route("**/server-list.json*", route => route.fulfill({ json: [] }));
    await page.goto(staticUrl + path);
    const links = page.locator("a[data-design]");
    await expect(links).toHaveCount(3);
    expect(await links.evaluateAll(list => list.map(link => link.getAttribute("href")))).toEqual([
      "stability.html",
      "stability.html",
      "stability-better.html"
    ]);
    const marked = page.locator('a[data-design][aria-current="page"]');
    if (current) await expect(marked).toHaveAttribute("data-design", current);
    else await expect(marked).toHaveCount(0);
  });
}

test("on the stability pages a click goes to the stability page of the design, with the query", async ({ page }) => {
  await page.route("**/server-list.json*", route => route.fulfill({ json: [] }));
  await page.goto(`${staticUrl}/stability.html?target=1`);
  await page.locator('a[data-design="better"]').click();
  await page.waitForURL(/\/stability-better\.html\?target=1$/);
  expect(await saved(page)).toBe("better");
  await page.locator('a[data-design="classic"]').click();
  await page.waitForURL(/\/stability\.html\?target=1$/);
  expect(await saved(page)).toBe("classic");
});

for (const { design, path } of pages) {
  test(`${design}: the footer has the three design links and marks the current one`, async ({ page }) => {
    await page.goto(staticUrl + path);
    const links = page.locator("a[data-design]");
    await expect(links).toHaveCount(3);
    expect(await links.evaluateAll(list => list.map(link => link.getAttribute("data-design")))).toEqual([
      "classic",
      "modern",
      "better"
    ]);
    expect(await links.evaluateAll(list => list.map(link => link.getAttribute("href")))).toEqual([
      "index-classic.html",
      "index-modern.html",
      "index-better.html"
    ]);
    const current = page.locator('a[data-design][aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("data-design", design);
  });

  test(`${design}: the design links fit in 360px`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    // The speed test pages show their footer once the server list is read
    await page.route("**/server-list.json*", route =>
      route.fulfill({
        json: [
          {
            name: "local",
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
    await page.goto(staticUrl + path);
    const switcher = page.locator("[data-design-switch]:not(script)");
    await expect(switcher).toBeVisible();
    const box = await switcher.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
  });
}

test("a click on a design link keeps the query without design= and remembers the choice", async ({ page }) => {
  await page.goto(`${staticUrl}/index-classic.html?lang=pt&design=old&theme=dark`);
  await page.locator('a[data-design="better"]').click();
  await page.waitForURL(/\/index-better\.html\?lang=pt&theme=dark$/);
  expect(await saved(page)).toBe("better");
});

test("a click without query goes to the page without a question mark", async ({ page }) => {
  await page.goto(`${staticUrl}/index-better.html`);
  await page.locator('a[data-design="modern"]').click();
  await page.waitForURL(/\/index-modern\.html$/);
  expect(await saved(page)).toBe("modern");
});

test("the keyboard activates a design link", async ({ page }) => {
  await page.goto(`${staticUrl}/index-modern.html`);
  await page.locator('a[data-design="better"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/index-better\.html$/);
  expect(await saved(page)).toBe("better");
});

test("a click with a modifier does not remember anything", async ({ page, context }) => {
  await page.goto(`${staticUrl}/index-classic.html`);
  const opened = context.waitForEvent("page");
  await page.locator('a[data-design="better"]').click({ modifiers: ["Control"] });
  const other = await opened;
  await other.close();
  expect(await saved(page)).toBeNull();
  expect(page.url()).toMatch(/index-classic\.html$/);
});

for (const design of ["better", "modern"]) {
  test(`index.html opens the saved design ${design}`, async ({ page }) => {
    await remember(page, design);
    await page.goto(`${staticUrl}/index.html`);
    await page.waitForURL(new RegExp(`/${targets[design]}$`));
  });
}

test("?design= wins over the saved design and stays in the URL", async ({ page }) => {
  await remember(page, "better");
  await page.goto(`${staticUrl}/index.html?design=classic`);
  await page.waitForURL(/\/index-classic\.html\?design=classic$/);
});

test("?design=better and ?design=modern open those designs", async ({ page }) => {
  await page.goto(`${staticUrl}/index.html?design=better`);
  await page.waitForURL(/\/index-better\.html\?design=better$/);
  await page.goto(`${staticUrl}/index.html?design=modern`);
  await page.waitForURL(/\/index-modern\.html\?design=modern$/);
});

test("an invalid saved design falls back to the config", async ({ page }) => {
  await remember(page, "foo");
  await page.goto(`${staticUrl}/index.html`);
  await page.waitForURL(/\/index-classic\.html$/);
});

test("a broken localStorage does not break the redirect or the links", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
  });
  await page.goto(`${staticUrl}/index.html`);
  await page.waitForURL(/\/index-classic\.html$/);
  await page.locator('a[data-design="better"]').click();
  await page.waitForURL(/\/index-better\.html$/);
});

test("designSwitch=false in config.json ignores the saved design", async ({ page }) => {
  await page.route("**/config.json*", route =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ useNewDesign: false, designSwitch: false })
    })
  );
  await remember(page, "better");
  await page.goto(`${staticUrl}/index.html`);
  await page.waitForURL(/\/index-classic\.html$/);
});

test("there are no page errors when using the links", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${staticUrl}/index-better.html`);
  await page.locator('a[data-design="classic"]').click();
  await page.waitForURL(/\/index-classic\.html$/);
  expect(errors).toEqual([]);
});

for (const [name, base] of [
  ["Debian", baseUrls.standalone],
  ["Alpine", baseUrls.standaloneAlpine]
]) {
  test(`docker ${name} serves design-links.js`, async ({ request }) => {
    const response = await request.get(`${base}/design-links.js`);
    expect(response.status()).toBe(200);
  });
}

test("docker with DESIGN_SWITCH=false removes the links and ignores the saved design", async ({ page, request }) => {
  const base = baseUrls.standaloneApostrophe;
  for (const { path } of [...pages, ...stabilityPages]) {
    await page.goto(base + path);
    await expect(page.locator("[data-design-switch]")).toHaveCount(0);
  }
  const config = await (await request.get(`${base}/config.json`)).json();
  expect(config.designSwitch).toBe(false);
  await remember(page, "better");
  await page.goto(`${base}/index.html`);
  await page.waitForURL(/\/index-modern\.html$/);
});
