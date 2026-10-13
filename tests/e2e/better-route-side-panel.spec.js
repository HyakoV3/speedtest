const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { openBackPanel, showRoute } = require("./helpers/route-side");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));
const sample = name => fs.readFileSync(path.join(__dirname, "..", "fixtures", "route-back", name), "utf8");
const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };
const SIDE = "librespeed-better-route-side";
const OLD_KEY = "librespeed-better-route-direction";
const LSR1 =
  "LSR1!n=fb8c88f1c59c13c3!f=4!t=77.42.65.55!s=1791768133!a=0.2.0+tracert!h=1,-p,0.5,3,3;2,-p,0.5,3,3;7,8.242.72.137,2,3,3;8,171.75.10.35,235,3,3;15,77.42.65.55,231,3,3";

const ENRICH = body => ({
  v: 1,
  hops: body.hops.map(hop => ({
    ttl: hop.ttl,
    asn: `AS${hop.ip.split(".").pop()}`,
    as_name: `Net ${hop.ip.split(".").pop()}`,
    country: "BR",
    country_doubt: false
  })),
  target_as: { asn: "AS15169", as_name: "Google LLC" },
  target_country: "US"
});

async function openRoute(page, { post = fixture("normal"), enrich = ENRICH, caps = CAPS } = {}) {
  const seen = { enrich: [] };
  await page.route("**/backend/route.php*", route => {
    if (route.request().method() === "POST")
      return typeof post === "function" ? post(route) : route.fulfill({ json: post });
    return route.fulfill({ json: caps });
  });
  await page.route("**/backend/route_enrich.php", async route => {
    const body = JSON.parse(route.request().postData());
    seen.enrich.push(body);
    if (typeof enrich === "function" && enrich.length === 2) return enrich(route, body);
    return route.fulfill({ json: enrich(body) });
  });
  await page.goto(`${staticRepositoryUrl}/route-better.html`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  return seen;
}

const rows = page => page.locator("#routeTable tbody tr");
const paste = async (page, text) => {
  await page.locator("#routeBackText").fill(text);
  await page.locator("#routeBackShow").click();
};
const toggle = page => page.locator("#routeSideToggle");
const panel = page => page.locator("#routeSide");
const hand = (page, lsr1) =>
  page.evaluate(
    text => window.postMessage({ source: "librespeed-route-extension", v: 1, lsr1: text }, window.location.origin),
    lsr1
  );
const focusedId = page => page.evaluate(() => document.activeElement && document.activeElement.id);

test("S1 the button is there when the route is on; it opens the panel and says it is open, and there is no sentence about it on the page", async ({
  page
}) => {
  await openRoute(page);
  await expect(toggle(page)).toBeVisible();
  await expect(page.locator("#routeBackInvite")).toHaveCount(0);
  await expect(page.locator("#routeArea")).not.toContainText("Want to test the way back");
  await expect(panel(page)).toBeHidden();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(toggle(page)).toHaveAttribute("aria-controls", "routeSide");
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  // The panel is a complementary region with the name of its title, and the focus is on that title
  expect(await panel(page).evaluate(el => el.tagName)).toBe("ASIDE");
  await expect(panel(page)).toHaveAttribute("aria-labelledby", "routeBackTitle");
  expect(await focusedId(page)).toBe("routeBackTitle");
  // It is not in the main region of the page (a complementary region inside main is not announced as one)
  expect(await panel(page).evaluate(el => !!el.closest("main"))).toBe(false);
  // The button closes it, and says so
  await toggle(page).click();
  await expect(panel(page)).toBeHidden();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
});

test("S2 the cross and Esc close it and the focus goes back to what opened it; Esc is not heard by the theme panel", async ({
  page
}) => {
  await openRoute(page);
  await toggle(page).click();
  await page.locator("#routeSideClose").click();
  await expect(panel(page)).toBeHidden();
  expect(await focusedId(page)).toBe("routeSideToggle");
  // Closed with Esc from inside the box: the focus goes back to the button
  await toggle(page).click();
  await page.locator("#routeBackText").focus();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  expect(await focusedId(page)).toBe("routeSideToggle");
  // The theme panel (opened by its own button) does not close with the Esc of this one: the focus is in the box of the panel, and the panel of
  // the themes was opened after it
  await toggle(page).click();
  await page.locator(".panel-toggle, .panel > button").first().click();
  await expect(page.locator(".panel-box")).toBeVisible();
  await page.locator("#routeBackText").focus();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(page.locator(".panel-box")).toBeVisible();
});

test("S3 it is not a dialog: Tab leaves it, and the page behind keeps working while it is open", async ({ page }) => {
  await openRoute(page);
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  // Walk forward through the page: the focus gets outside of the panel (there is no trap)
  let outside = false;
  for (let i = 0; i < 80 && !outside; i++) {
    await page.keyboard.press("Tab");
    outside = await page.evaluate(() => !document.getElementById("routeSide").contains(document.activeElement));
  }
  expect(outside).toBe(true);
  // Nothing is inert, and Start works with the panel open
  expect(await panel(page).evaluate(el => el.closest("[inert]") === null && !el.hasAttribute("aria-modal"))).toBe(true);
  await expect(page.locator("#routeStart")).toBeEnabled();
  await page.locator("#routeStart").click();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  await expect(panel(page)).toBeVisible();
});

test("S4 a route pasted in the panel is shown at once, over the one from the server, and the panel stays", async ({
  page
}) => {
  await openRoute(page);
  await page.locator("#routeStart").click();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  await expect(page.locator("#routeTableBoth")).toBeHidden();
  await openBackPanel(page);
  await paste(page, sample("linux-traceroute-n.txt"));
  await expect(rows(page)).toHaveCount(11);
  await expect(page.locator("#routeTable caption")).toHaveText("Hops from you to this server");
  await expect(page.locator("#routeTableBoth")).toBeVisible();
  await expect(page.locator('[data-shown="back"]:visible').first()).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page)).toBeVisible();
});

test("S5 the networks that arrive late never take the person back to the way back", async ({ page }) => {
  let answer;
  const gate = new Promise(resolve => {
    answer = resolve;
  });
  await openRoute(page, {
    enrich: async (route, body) => {
      await gate;
      await route.fulfill({ json: ENRICH(body) });
    }
  });
  await page.locator("#routeStart").click();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  await openBackPanel(page);
  await paste(page, sample("linux-traceroute-n.txt"));
  await expect(rows(page)).toHaveCount(11);
  await showRoute(page, "there");
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  answer();
  await expect(page.locator("#routeBackNotes")).not.toContainText("could not");
  await page.waitForTimeout(400);
  await expect(page.locator('[data-shown="there"]:visible').first()).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
});

test("S6 a route that arrives while the other is traced is kept, not drawn: the status stays, and it is there after", async ({
  page
}) => {
  let release;
  let calls = 0;
  const wait = new Promise(resolve => {
    release = resolve;
  });
  await openRoute(page, {
    post: async route => {
      if (++calls > 0) await wait;
      await route.fulfill({ json: fixture("normal") });
    }
  });
  await page.locator("#routeStart").click();
  await expect(page.locator("#routeStatus")).toContainText("Tracing");
  // The extension hands a route over while the trace runs
  await hand(page, LSR1);
  await page.waitForTimeout(400);
  await expect(page.locator("#routeStatus")).toContainText("Tracing");
  await expect(rows(page)).toHaveCount(0);
  release();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  // After the trace both routes are there, the one from the server is on the screen, and the other is one press away
  await expect(page.locator("#routeTableBoth")).toBeVisible();
  await expect(page.locator('[data-shown="there"]:visible').first()).toHaveAttribute("aria-pressed", "true");
  await showRoute(page, "back");
  await expect(rows(page)).toHaveCount(5);
  await expect(page.locator("#routeTable caption")).toHaveText("Hops from you to this server");
});

test("S7 the command follows the IP version of the route from the server, also with the panel already open", async ({
  page
}) => {
  await openRoute(page, { post: fixture("v6") });
  await openBackPanel(page);
  await expect(page.locator("#routeBackCommand")).not.toContainText("-6");
  await page.locator("#routeStart").click();
  await expect(rows(page).first()).toBeVisible();
  // Without pressing anything in the panel: it knows the family of the route that just arrived
  await expect(page.locator("#routeBackCommand")).toContainText("-6");
});

test("S8 the panel is remembered on a wide screen, and the old choice of the direction is forgotten", async ({
  page
}) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("__seeded")) {
      window.sessionStorage.setItem("__seeded", "1");
      window.localStorage.setItem("librespeed-better-route-direction", "back");
    }
  });
  await openRoute(page);
  await expect(panel(page)).toBeHidden();
  expect(await page.evaluate(key => window.localStorage.getItem(key), OLD_KEY)).toBeNull();
  await toggle(page).click();
  expect(await page.evaluate(key => window.localStorage.getItem(key), SIDE)).toBe("open");
  await page.reload();
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await expect(panel(page)).toBeVisible();
  // Restoring it does not take the focus
  expect(await focusedId(page)).not.toBe("routeBackTitle");
  await page.locator("#routeSideClose").click();
  expect(await page.evaluate(key => window.localStorage.getItem(key), SIDE)).toBe("closed");
  await page.reload();
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await expect(panel(page)).toBeHidden();
});

test("S9 a storage that throws does not break the panel", async ({ page }) => {
  await page.addInitScript(() => {
    const fail = () => {
      throw new Error("blocked");
    };
    Storage.prototype.getItem = fail;
    Storage.prototype.setItem = fail;
    Storage.prototype.removeItem = fail;
  });
  await openRoute(page);
  // The route is still on: the storage failing is not told as "not available", and Start works
  await expect(page.locator("#routeStart")).toBeEnabled();
  await expect(page.locator("#routeStatus")).not.toContainText("not available");
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  await paste(page, sample("linux-traceroute-n.txt"));
  await expect(rows(page)).toHaveCount(11);
  await page.locator("#routeSideClose").click();
  await expect(panel(page)).toBeHidden();
  await page.locator("#routeStart").click();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
});

test("S10 at 360 px it is a sheet at the bottom that is not opened by itself and goes down when a route is drawn", async ({
  page
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.addInitScript(() => window.localStorage.setItem("librespeed-better-route-side", "open"));
  await openRoute(page);
  // Left open on the last visit: a phone does not open it by itself
  await expect(panel(page)).toBeHidden();
  await expect(toggle(page)).toBeVisible();
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  const box = await panel(page).boundingBox();
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.width)).toBe(360);
  expect(Math.round(box.y + box.height)).toBe(740);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  // The edge button is not needed while the sheet covers the screen
  await expect(toggle(page)).toBeHidden();
  await paste(page, sample("linux-traceroute-n.txt"));
  await expect(rows(page)).toHaveCount(11);
  await expect(panel(page)).toBeHidden();
  await expect(toggle(page)).toBeVisible();
});

test("S11 it is over the page and under the red box and the theme panel, and does not cover the theme button", async ({
  page
}) => {
  await openRoute(page);
  await toggle(page).click();
  const z = await page.evaluate(() => {
    const style = selector => Number(getComputedStyle(document.querySelector(selector)).zIndex);
    return { side: style("#routeSide"), toggle: style("#routeSideToggle") };
  });
  expect(z.side).toBe(400);
  expect(z.toggle).toBe(400);
  // The toast sits at 500 and the theme panel at 1000, both over it
  const css = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "better", "styling", "route.css"), "utf8");
  expect(css).toMatch(/\.route-toast \{[^}]*z-index: 500;/);
  const panelCss = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "better", "styling", "panel.css"),
    "utf8"
  );
  expect(panelCss).toMatch(/\.panel \{[^}]*z-index: 1000;/);
  // The button of the themes is not under the panel
  const covered = await page.evaluate(() => {
    const button = document.querySelector(".panel > button");
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !(hit === button || button.contains(hit));
  });
  expect(covered).toBe(false);
});

test("S12 in forced colours it has a border of its own, and in print it is not there", async ({ page }) => {
  await openRoute(page);
  await toggle(page).click();
  await page.emulateMedia({ forcedColors: "active" });
  expect(await panel(page).evaluate(el => parseFloat(getComputedStyle(el).borderTopWidth))).toBeGreaterThanOrEqual(2);
  await page.emulateMedia({ forcedColors: "none", media: "print" });
  await expect(panel(page)).toBeHidden();
  await expect(toggle(page)).toBeHidden();
});

test("S13 clearing the way back that is on the screen brings the other route back", async ({ page }) => {
  await openRoute(page);
  await page.locator("#routeStart").click();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  await openBackPanel(page);
  await paste(page, sample("linux-traceroute-n.txt"));
  await expect(rows(page)).toHaveCount(11);
  await page.locator("#routeBackClear").click();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  await expect(page.locator("#routeTableBoth")).toBeHidden();
  await expect(page.locator("#routeTable caption")).toHaveText("Hops from this server to you");
});

test("S14 the button has its text in the four languages, and the selector keeps its own", async ({ page }) => {
  await openRoute(page);
  await page.locator("#routeStart").click();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  await openBackPanel(page);
  await paste(page, sample("linux-traceroute-n.txt"));
  await expect(rows(page)).toHaveCount(11);
  const texts = {
    en: ["Trace the route back", "You → server"],
    pt: ["Traçar a rota de volta", "Você → servidor"],
    es: ["Trazar la ruta de vuelta", "Tú → servidor"],
    sv: ["Spåra vägen tillbaka", "Du → servern"]
  };
  for (const [lang, [button, selector]] of Object.entries(texts)) {
    await page.evaluate(code => window.LibreSpeedI18n.set(code, false), lang);
    await expect(toggle(page)).toHaveText(button);
    await expect(page.locator('[data-shown="back"]:visible').first()).toHaveText(selector);
    await expect(page.locator("body")).not.toContainText("route.side.");
  }
  const parity = ["en", "pt", "es", "sv"].map(lang =>
    Object.keys(
      JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "better", "locales", `${lang}.json`), "utf8")
      )
    )
      .filter(key => key.startsWith("route.side."))
      .sort()
      .join(",")
  );
  expect(new Set(parity).size).toBe(1);
  // Only the text of the button is left: the sentence and its link are gone
  expect(parity[0]).toBe("route.side.toggle");
});
