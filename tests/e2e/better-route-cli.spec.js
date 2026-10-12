const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));
const DOWNLOAD = "https://github.com/HyakoV3/librespeed-route/releases";
const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60, cli_url: DOWNLOAD };
const TOOL_KEY = "librespeed-better-route-back-tool";

async function openRoute(page, caps = CAPS, { back = true, query = "" } = {}) {
  await page.route("**/backend/route.php*", route => {
    if (route.request().method() === "POST") return route.fulfill({ json: fixture("normal") });
    return route.fulfill({ json: caps });
  });
  await page.goto(`${staticRepositoryUrl}/route-better.html${query}`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  await expect(page.locator("#routeDirection")).toBeVisible();
  if (back) {
    await page.locator('[data-direction="back"]').click();
    await expect(page.locator("#routeBack")).toBeVisible();
  }
}
const command = page => page.locator("#routeBackCommand");
const tool = (page, name) => page.locator(`#routeBackTool [data-tool="${name}"]`);
const system = (page, name) => page.locator(`#routeBackSystems [data-system="${name}"]`).click();

test("L1 with an address from the server the choice of the tool is there, and starts at the command of the system", async ({
  page
}) => {
  await openRoute(page);
  await expect(page.locator("#routeBackTool")).toBeVisible();
  await expect(tool(page, "system")).toHaveAttribute("aria-pressed", "true");
  await expect(tool(page, "cli")).toHaveAttribute("aria-pressed", "false");
  await expect(tool(page, "cli")).toHaveText("librespeed-route");
  await expect(page.locator("#routeBackCli")).toBeHidden();
  await expect(page.locator("#routeBackClipLabel")).toBeVisible();
  await system(page, "windows");
  await expect(command(page)).toHaveText(/^tracert -d -h 30 -w 1000 \S+$/);
});

test("L2 librespeed-route: the command of each system, piped, with the family; the clipboard box and the alternative are not there", async ({
  page,
  context
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openRoute(page);
  await tool(page, "cli").click();
  await expect(tool(page, "cli")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#routeBackCli")).toBeVisible();
  await expect(page.locator("#routeBackCliRun")).toBeVisible();
  await expect(page.locator("#routeBackClipLabel")).toBeHidden();
  await expect(page.locator("#routeBackClipHint")).toBeHidden();
  await expect(page.locator("#routeBackAlt")).toBeHidden();
  await system(page, "windows");
  await expect(command(page)).toHaveText(/^librespeed-route \S+ \| clip$/);
  await system(page, "macos");
  await expect(command(page)).toHaveText(/^librespeed-route \S+ \| pbcopy$/);
  await system(page, "linux");
  await expect(command(page)).toHaveText(/^librespeed-route \S+ \| xclip -selection clipboard$/);
  // The Copy button copies what is shown
  await page.locator("#routeBackCopy").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^librespeed-route \S+ \| xclip/);
  // The link to get it is the address of the server, in a new tab and with no referrer or opener
  const link = page.locator("#routeBackCliLink");
  await expect(link).toHaveAttribute("href", DOWNLOAD);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  // Back to the command of the system
  await tool(page, "system").click();
  await expect(page.locator("#routeBackCli")).toBeHidden();
  await expect(page.locator("#routeBackClipLabel")).toBeVisible();
  await expect(command(page)).toHaveText(/^traceroute -n -m 30 -w 1 \S+$/);
});

test("L3 the family of the route from the server is an option of the command, before the host", async ({ page }) => {
  await openRoute(page);
  const results = await page.evaluate(() => ({
    four: window.LibreSpeedRouteBack.commands("windows", "example.org", 4, false, "cli"),
    six: window.LibreSpeedRouteBack.commands("macos", "example.org", 6, false, "cli"),
    none: window.LibreSpeedRouteBack.commands("linux", "example.org", null, true, "cli"),
    bad: window.LibreSpeedRouteBack.commands("linux", "a$b.example", 4, false, "cli"),
    dash: window.LibreSpeedRouteBack.commands("linux", "-oProxy", 4, false, "cli"),
    system: window.LibreSpeedRouteBack.commands("linux", "example.org", 4, false, "system"),
    unknown: window.LibreSpeedRouteBack.commands("plan9", "example.org", 4, false, "cli")
  }));
  expect(results.four.main).toBe("librespeed-route -4 example.org | clip");
  expect(results.six.main).toBe("librespeed-route -6 example.org | pbcopy");
  expect(results.none.main).toBe("librespeed-route example.org | xclip -selection clipboard");
  expect(results.bad).toBeNull();
  expect(results.dash).toBeNull();
  expect(results.system.main).toBe("traceroute -n -m 30 -w 1 -4 example.org");
  expect(results.unknown).toBeNull();
});

test("L4 without an address from the server, or with one that is not a plain https address, nothing is offered", async ({
  page
}) => {
  const bad = [
    undefined,
    null,
    "",
    "http://example.org/x",
    "javascript:alert(1)",
    "https://user@example.org/",
    "https://example.org/?a=b",
    'https://example.org/x"y',
    "https://example.org/x y",
    42,
    ["https://example.org"],
    `https://example.org/${"a".repeat(200)}`
  ];
  for (const value of bad) {
    const context = await page.context().browser().newContext();
    const other = await context.newPage();
    await openRoute(other, { ...CAPS, cli_url: value });
    await expect(other.locator("#routeBackTool"), String(value)).toBeHidden();
    await expect(other.locator("#routeBackCli"), String(value)).toBeHidden();
    await expect(other.locator("#routeBackCommand")).toHaveText(/^traceroute|^tracert/);
    await context.close();
  }
  // The page only checks the address: what it keeps is the one it was given, and a plain one is taken
  await openRoute(page);
  const kept = await page.evaluate(() => [
    window.LibreSpeedRouteBack.cliUrl("https://example.org"),
    window.LibreSpeedRouteBack.cliUrl("https://example.org:8443/a/b-c_d.e~f%20g+h"),
    window.LibreSpeedRouteBack.cliUrl("https://example.org/x\n")
  ]);
  expect(kept).toEqual(["https://example.org", "https://example.org:8443/a/b-c_d.e~f%20g+h", null]);
});

test("L5 the choice is kept for the next visit, and a stale choice with no address from the server is not used", async ({
  page
}) => {
  await openRoute(page);
  await tool(page, "cli").click();
  expect(await page.evaluate(key => window.localStorage.getItem(key), TOOL_KEY)).toBe("cli");
  await page.reload();
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await expect(page.locator("#routeBack")).toBeVisible();
  await expect(tool(page, "cli")).toHaveAttribute("aria-pressed", "true");
  await expect(command(page)).toHaveText(/^librespeed-route /);
  // The server stops offering it (the administrator emptied the address): the choice saved is not used
  await page.unroute("**/backend/route.php*");
  await page.route("**/backend/route.php*", route => route.fulfill({ json: { ...CAPS, cli_url: null } }));
  await page.reload();
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await expect(page.locator("#routeBack")).toBeVisible();
  await expect(page.locator("#routeBackTool")).toBeHidden();
  await expect(command(page)).toHaveText(/^traceroute|^tracert/);
});

test("L6 the new texts are in the four languages", async ({ page }) => {
  await openRoute(page);
  await tool(page, "cli").click();
  const texts = {
    en: ["System command", "Download for Windows, macOS and Linux", "Run it, then press Paste and show."],
    pt: ["Comando do sistema", "Baixar para Windows, macOS e Linux", "Rode-o e depois clique em Colar e mostrar."],
    es: ["Comando del sistema", "Descargar para Windows, macOS y Linux", "Ejecútalo y luego pulsa Pegar y mostrar."],
    sv: ["Systemkommando", "Ladda ner för Windows, macOS och Linux", "Kör det och tryck sedan på Klistra in och visa."]
  };
  for (const [language, [system, download, run]] of Object.entries(texts)) {
    await page.evaluate(code => window.LibreSpeedI18n.set(code, false), language);
    await expect(tool(page, "system")).toHaveText(system);
    await expect(page.locator("#routeBackCliLink")).toHaveText(download);
    await expect(page.locator("#routeBackCliRun")).toHaveText(run);
    // The name of the program is not translated
    await expect(tool(page, "cli")).toHaveText("librespeed-route");
    await expect(page.locator("#routeBackTool")).toHaveAttribute("aria-label", /.+/);
  }
});

test("L7 at 360 px the choice and the command fit, in Swedish", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openRoute(page);
  await page.evaluate(() => window.LibreSpeedI18n.set("sv", false));
  await tool(page, "cli").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true
  );
  for (const selector of ['#routeBackTool [data-tool="system"]', '#routeBackTool [data-tool="cli"]']) {
    const box = await page.locator(selector).boundingBox();
    expect(box.x, selector).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, selector).toBeLessThanOrEqual(360);
    expect(box.height, selector).toBeGreaterThanOrEqual(36);
  }
});

test("L8 the pasted line of librespeed-route is read by the page: the internal hops are told as internal, the others have their networks", async ({
  page
}) => {
  await page.route("**/backend/route_enrich.php", route =>
    route.fulfill({
      json: {
        v: 1,
        hops: JSON.parse(route.request().postData()).hops.map(h => ({
          ttl: h.ttl,
          asn: "AS15169",
          as_name: "Google LLC",
          country: "US",
          country_doubt: false
        })),
        target_as: { asn: "AS15169", as_name: "Google LLC" },
        target_country: "US"
      }
    })
  );
  await openRoute(page);
  await tool(page, "cli").click();
  const line =
    "LSR1!n=0123456789abcdef!f=4!t=8.8.8.8!s=1790000000!a=0.1.0+traceroute!h=1,-p,1.85,3,3;2,-c,5.35,3,3;3,72.14.208.80,18.19,3,3;4,*,0,3,0;5,8.8.8.8,16.36,3,3";
  await page.locator("#routeBackText").fill(line);
  await page.locator("#routeBackShow").click();
  const rows = page.locator("#routeTable tbody tr");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText("internal network");
  await expect(rows.nth(1)).toContainText("internal network");
  await expect(rows.nth(2)).toContainText("72.14.208.80");
  await expect(rows.nth(3)).toContainText("no reply");
  await expect(rows.nth(4)).toContainText("8.8.8.8");
});
