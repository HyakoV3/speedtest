const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { openBackPanel, showRoute } = require("./helpers/route-side");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));
const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };
const HISTORY_KEY = "librespeed-better-route-history";

// What librespeed-route gives for a route: the internal hops are -p and -c, the others are public (a real one, from a Windows 11)
const LSR1 =
  "LSR1!n=fb8c88f1c59c13c3!f=4!t=77.42.65.55!s=1791768133!a=0.2.0+tracert!h=1,-p,0.5,3,3;2,-p,0.5,3,3;3,-p,1,3,3;4,-p,1,3,3;5,-p,1,3,3;6,-c,1,3,3;7,8.242.72.137,2,3,3;8,171.75.10.35,235,3,3;9,212.133.6.2,232,3,3;10,213.239.224.38,233,3,3;11,213.239.228.10,233,3,3;12,*,0,3,0;13,*,0,3,0;14,95.216.131.198,232,3,3;15,77.42.65.55,231,3,3";

async function openRoute(page, caps = CAPS, { waitForSwitch = true } = {}) {
  const seen = { enrich: [] };
  await page.route("**/backend/route.php*", route => {
    if (route.request().method() === "POST") return route.fulfill({ json: fixture("normal") });
    return route.fulfill({ json: caps });
  });
  await page.route("**/backend/route_enrich.php", route => {
    const body = JSON.parse(route.request().postData());
    seen.enrich.push(body);
    return route.fulfill({
      json: {
        v: 1,
        hops: body.hops.map(h => ({
          ttl: h.ttl,
          asn: "AS24940",
          as_name: "Hetzner Online GmbH",
          country: "FI",
          country_doubt: false
        })),
        target_as: { asn: "AS24940", as_name: "Hetzner Online GmbH" },
        target_country: "FI"
      }
    });
  });
  await page.goto(`${staticRepositoryUrl}/route-better.html`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  if (waitForSwitch) await expect(page.locator("#routeSideToggle")).toBeVisible();
  return seen;
}
// What the extension does: the page gets a message of its own window, for its own origin
const hand = (page, data) => page.evaluate(d => window.postMessage(d, window.location.origin), data);
const message = (lsr1, extra = {}) => ({ source: "librespeed-route-extension", v: 1, lsr1, ...extra });
const rows = page => page.locator("#routeTable tbody tr");

test("M1 a route handed over by the extension is shown at once, on the way back, and said to be from the extension", async ({
  page
}) => {
  const seen = await openRoute(page);
  // Nothing is shown and no panel is open: the route comes and is shown at once, as the way back
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator("#routeSide")).toBeHidden();
  await hand(page, message(LSR1));
  await expect(page.locator("#routeTable caption")).toHaveText("Hops from you to this server");
  await expect(rows(page)).toHaveCount(14);
  await expect(page.locator("#routeBackNotes")).toContainText("Route received from the browser extension.");
  await expect(page.locator("#routeBackText")).toHaveValue(LSR1);
  // The internal hops are told as internal, and the public ones have their networks (asked for as for a pasted text, once)
  await expect(rows(page).nth(0)).toContainText("internal network");
  await expect(rows(page).nth(5)).toContainText("internal network");
  await expect(rows(page).nth(8)).toContainText("212.133.6.2");
  await expect(rows(page).nth(8)).toContainText("Hetzner");
  expect(seen.enrich).toHaveLength(1);
  expect(seen.enrich[0].hops.map(h => h.ip)).toEqual([
    "8.242.72.137",
    "171.75.10.35",
    "212.133.6.2",
    "213.239.224.38",
    "213.239.228.10",
    "95.216.131.198",
    "77.42.65.55"
  ]);
  // Never saved to the history by itself: only the button does it
  expect(await page.evaluate(key => window.localStorage.getItem(key), HISTORY_KEY)).toBeNull();
  await expect(page.locator("#routeBackSave")).toHaveAttribute("aria-disabled", "false");
});

test("M2 only a message of this window, of this origin, of exactly this shape and of up to 1900 characters is taken", async ({
  page
}) => {
  const seen = await openRoute(page);
  const refused = [
    { ...message(LSR1), source: "something-else" },
    { ...message(LSR1), v: 2 },
    { ...message(LSR1), v: "1" },
    message(LSR1, { more: 1 }),
    { source: "librespeed-route-extension", v: 1 },
    { source: "librespeed-route-extension", lsr1: LSR1 },
    message(42),
    message(["LSR1"]),
    message(null),
    message(LSR1 + "x".repeat(1901 - LSR1.length)),
    "LSR1",
    null,
    42
  ];
  for (const data of refused) await hand(page, data);
  // A message that a frame of this page sends (the script runs in the frame, so the source of the message is the frame and not the window)
  await page.evaluate(text => {
    const frame = document.createElement("iframe");
    frame.srcdoc = `<script>parent.postMessage({ source: "librespeed-route-extension", v: 1, lsr1: ${JSON.stringify(text)} }, "*")<\/script>`;
    document.body.appendChild(frame);
  }, LSR1);
  await page.waitForTimeout(500);
  await expect(page.locator("#routeBackText")).toHaveValue("");
  await expect(rows(page)).toHaveCount(0);
  expect(seen.enrich).toHaveLength(0);
  await expect(rows(page)).toHaveCount(0);
  // The same message, well formed, is taken
  await hand(page, message(LSR1));
  await expect(rows(page)).toHaveCount(14);
});

test("M3 with the route off nothing is taken", async ({ page }) => {
  const seen = await openRoute(page, { v: 1, enabled: false }, { waitForSwitch: false });
  await expect(page.locator("#routeStatus")).toContainText("not available");
  await hand(page, message(LSR1));
  await page.waitForTimeout(400);
  await expect(page.locator("#routeBackText")).toHaveValue("");
  expect(seen.enrich).toHaveLength(0);
});

test("M4 a line that is not a route, or one with markup in it, says so as text and draws nothing", async ({ page }) => {
  await openRoute(page);
  await hand(page, message("LSR1!n=<img src=x onerror=window.__x=1>!f=4"));
  await expect(page.locator("#routeBackNotes")).toContainText("does not look like the output");
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
  await expect(page.locator("#routeBackNotes img")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(0);
  // A line that has a public target but an address of the internal network in a hop is not a route either
  await hand(page, message("LSR1!n=0123456789abcdef!f=4!t=8.8.8.8!s=1!a=1!h=1,192.168.0.1,1,3,3"));
  await expect(rows(page)).toHaveCount(0);
});

test("M5 the hint and the note are in the four languages, and the privacy text names the extension", async ({
  page
}) => {
  await openRoute(page);
  const texts = {
    en: ["With the browser extension", "Route received from the browser extension.", "your browser extension"],
    pt: ["Com a extensão do navegador", "Rota recebida da extensão do navegador.", "extensão do seu navegador"],
    es: ["Con la extensión del navegador", "Ruta recibida de la extensión del navegador.", "extensión de tu navegador"],
    sv: ["Med webbläsartillägget", "Vägen togs emot från webbläsartillägget.", "webbläsartillägg"]
  };
  await openBackPanel(page);
  for (const [language, [hint, note, privacy]] of Object.entries(texts)) {
    await page.evaluate(code => window.LibreSpeedI18n.set(code, false), language);
    await expect(page.locator("#routeBackExtension")).toContainText(hint);
    expect(await page.locator('#routeBack [data-i18n="route.back.privacy"]').innerText(), language).toContain(privacy);
    await hand(page, message(LSR1 + ""));
    await expect(page.locator("#routeBackNotes")).toContainText(note);
    await page.locator("#routeBackClear").click();
  }
});

test("M6 at 360 px the hint fits, in Swedish", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openRoute(page);
  await openBackPanel(page);
  await page.evaluate(() => window.LibreSpeedI18n.set("sv", false));
  await expect(page.locator("#routeBackExtension")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true
  );
});
