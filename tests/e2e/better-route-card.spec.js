const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { openBackPanel, chooseMethod } = require("./helpers/route-side");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));
const sample = name => fs.readFileSync(path.join(__dirname, "..", "fixtures", "route-back", name), "utf8");
const locale = lang =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "better", "locales", `${lang}.json`), "utf8")
  );
const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };
const METHOD_KEY = "librespeed-better-route-back-method";

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

async function openRoute(page, { enrich = ENRICH, caps = CAPS } = {}) {
  const seen = { enrich: [] };
  await page.route("**/backend/route.php*", route => {
    if (route.request().method() === "POST") return route.fulfill({ json: fixture("normal") });
    return route.fulfill({ json: caps });
  });
  await page.route("**/backend/route_enrich.php", async route => {
    const body = JSON.parse(route.request().postData());
    seen.enrich.push(body);
    if (enrich.length === 2) return enrich(route, body);
    return route.fulfill({ json: enrich(body) });
  });
  await page.goto(`${staticRepositoryUrl}/route-better.html`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  return seen;
}

const text = page => page.locator("#routeBackText");
const show = page => page.locator("#routeBackShow");
const rows = page => page.locator("#routeTable tbody tr");
const method = (page, way) => page.locator(`#routeBackMethod [data-method="${way}"]`);

test("C1 the card has one main action, and no two buttons for the same thing", async ({ page }) => {
  await openRoute(page);
  await openBackPanel(page);
  await expect(page.locator("#routeBackTitle")).toHaveText("Trace the route back");
  await expect(page.locator(".route-back-lead")).toHaveText(
    "Help identify the connection path from this server to your device."
  );
  // One main action, as wide as the card, and it says what it does
  await expect(page.locator("#routeBack .route-button-primary")).toHaveCount(1);
  await expect(show(page)).toHaveText("Show route");
  const card = await page.locator("#routeBack").boundingBox();
  const button = await show(page).boundingBox();
  expect(button.width).toBeGreaterThan(card.width * 0.8);
  // The words of the old buttons are gone: the same action is not named three ways
  const card_text = await page.locator("#routeSide").innerText();
  for (const gone of ["Show my route", "Paste and show", "Test the way back", "Trace the way back"])
    expect(card_text).not.toContain(gone);
  await expect(page.locator("#routeSideToggle")).toHaveText("Trace the route back");
  // The text field has its label and its placeholder, and the choices are named
  await expect(page.locator('label[for="routeBackText"]')).toHaveText("Traceroute output");
  await expect(text(page)).toHaveAttribute("placeholder", "Paste command output here…");
  expect(
    await page
      .locator("#routeBackMethod")
      .evaluate(el => document.getElementById(el.getAttribute("aria-labelledby")).textContent.trim())
  ).toBe("Choose your method");
  expect(
    await page
      .locator("#routeBackSystems")
      .evaluate(el => document.getElementById(el.getAttribute("aria-labelledby")).textContent.trim())
  ).toBe("Select your operating system");
});

test("C2 the method: a command to run is the first, the extension is the other, and the choice is kept", async ({
  page
}) => {
  await openRoute(page);
  await openBackPanel(page);
  await expect(method(page, "command")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#routeBackCommandArea")).toBeVisible();
  await expect(page.locator("#routeBackExtensionArea")).toBeHidden();
  await method(page, "extension").click();
  await expect(method(page, "extension")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#routeBackExtensionArea")).toBeVisible();
  await expect(page.locator("#routeBackCommandArea")).toBeHidden();
  // The box for the result is there in both: the route can also be pasted
  await expect(text(page)).toBeVisible();
  await expect(show(page)).toBeVisible();
  expect(await page.evaluate(key => window.localStorage.getItem(key), METHOD_KEY)).toBe("extension");
  await page.reload();
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await expect(page.locator("#routeBackExtensionArea")).toBeVisible();
  await method(page, "command").click();
  await expect(page.locator("#routeBackCommandArea")).toBeVisible();
});

test("C3 the system chosen changes the command, and Copy copies the one that is shown", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openRoute(page);
  await openBackPanel(page);
  const expected = {
    windows: /^tracert -d -h 30 -w 1000 127\.0\.0\.1$/,
    macos: /^traceroute -n -m 30 -w 1 127\.0\.0\.1$/,
    linux: /^traceroute -n -m 30 -w 1 127\.0\.0\.1$/
  };
  for (const [system, pattern] of Object.entries(expected)) {
    await page.locator(`#routeBackSystems [data-system="${system}"]`).click();
    await expect(page.locator("#routeBackCommand")).toHaveText(pattern);
    await expect(page.locator("#routeBackCommandHelp")).toHaveText("Run this command, then paste the result below.");
    await page.locator("#routeBackCopy").click();
    await expect(page.locator("#routeBackCopy")).toHaveText("Copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(await page.locator("#routeBackCommand").innerText());
  }
});

test("C4 the extension saying it is here moves a first visit to it, and never a choice that was made", async ({
  page
}) => {
  await openRoute(page);
  await openBackPanel(page);
  const ready = () =>
    page.evaluate(() =>
      window.postMessage(
        { source: "librespeed-route-extension", v: 1, type: "state", id: "", state: "ready" },
        window.location.origin
      )
    );
  await ready();
  await expect(page.locator("#routeBackExtensionArea")).toBeVisible();
  await expect(method(page, "extension")).toHaveAttribute("aria-pressed", "true");
  // The person goes back to the command: it stays there
  await method(page, "command").click();
  await ready();
  await page.waitForTimeout(300);
  await expect(page.locator("#routeBackCommandArea")).toBeVisible();
  await expect(page.locator("#routeBackExtensionArea")).toBeHidden();
});

test("C5 a .txt file can be chosen or dropped, and what is in it is shown only when the person presses Show route", async ({
  page
}) => {
  const seen = await openRoute(page);
  await openBackPanel(page);
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#routeBackUpload").click();
  const file = await chooser;
  expect(file.isMultiple()).toBe(false);
  await file.setFiles({
    name: "route.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(sample("linux-traceroute-n.txt"))
  });
  await expect(text(page)).toHaveValue(/traceroute to/);
  // Nothing is shown or sent by choosing the file
  await page.waitForTimeout(300);
  await expect(rows(page)).toHaveCount(0);
  expect(seen.enrich).toHaveLength(0);
  await show(page).click();
  await expect(rows(page)).toHaveCount(11);
  // A file that is not text is refused and the box is left as it was
  await page.locator("#routeBackClear").click();
  await page
    .locator("#routeBackFile")
    .setInputFiles({ name: "x.txt", mimeType: "text/plain", buffer: Buffer.from([0, 1, 2, 0]) });
  await expect(text(page)).toHaveValue("");
  await expect(page.locator("#routeBackNotes")).toContainText("could not be read as text");
});

test("C6 Clear is only there when there is something to clear, and Save when there is a route", async ({ page }) => {
  await openRoute(page);
  await openBackPanel(page);
  await expect(page.locator("#routeBackClear")).toBeHidden();
  await expect(page.locator("#routeBackSave")).toBeHidden();
  await text(page).fill("x");
  await expect(page.locator("#routeBackClear")).toBeVisible();
  await expect(page.locator("#routeBackSave")).toBeHidden();
  await text(page).fill("");
  await expect(page.locator("#routeBackClear")).toBeHidden();
  await text(page).fill(sample("linux-traceroute-n.txt"));
  await show(page).click();
  await expect(rows(page)).toHaveCount(11);
  await expect(page.locator("#routeBackClear")).toBeVisible();
  await expect(page.locator("#routeBackSave")).toBeVisible();
  await page.locator("#routeBackClear").click();
  await expect(page.locator("#routeBackClear")).toBeHidden();
  await expect(page.locator("#routeBackSave")).toBeHidden();
  await expect(text(page)).toHaveValue("");
});

test("C7 while the networks of the text are looked up the button says so and is off; another text can be shown at once", async ({
  page
}) => {
  let answer;
  const gate = new Promise(resolve => {
    answer = resolve;
  });
  const seen = await openRoute(page, {
    enrich: async (route, body) => {
      await gate;
      await route.fulfill({ json: ENRICH(body) });
    }
  });
  await openBackPanel(page);
  await text(page).fill(sample("linux-traceroute-n.txt"));
  await show(page).click();
  await expect(rows(page)).toHaveCount(11);
  await expect(show(page)).toBeDisabled();
  await expect(show(page)).toHaveAttribute("aria-busy", "true");
  await expect(show(page)).toHaveText("Looking up the networks…");
  // Another text is another request: the button is on again
  await text(page).fill(sample("linux-traceroute-names.txt"));
  await expect(show(page)).toBeEnabled();
  await expect(show(page)).toHaveText("Show route");
  await text(page).fill(sample("linux-traceroute-n.txt"));
  await expect(show(page)).toBeDisabled();
  answer();
  await expect(show(page)).toBeEnabled();
  await expect(show(page)).toHaveText("Show route");
  await expect(show(page)).not.toHaveAttribute("aria-busy", "true");
  // The same text pressed again asks nothing new
  const before = seen.enrich.length;
  await show(page).click();
  await page.waitForTimeout(300);
  expect(seen.enrich.length).toBe(before);
});

test("C8 how the data is handled: said short, and the whole text one press away", async ({ page }) => {
  await openRoute(page);
  await openBackPanel(page);
  await expect(page.locator(".route-privacy-summary")).toHaveText(
    "Only public router addresses are checked. The route is not stored on the server."
  );
  const details = page.locator(".route-disclosure");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(details.locator("summary")).toHaveText("How your data is handled");
  await expect(details.locator("p")).toBeHidden();
  await details.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(details.locator("p")).toBeVisible();
  // The whole text keeps what the server does: only public addresses, not saved, a keyed hash for up to an hour
  await expect(details.locator("p")).toContainText("only the public addresses of the routers");
  await expect(details.locator("p")).toContainText("keyed hash");
  await expect(details.locator("p")).toContainText("up to an hour");
});

test("C9 at 360 px: nothing sideways, the words of the choices on one line, and the main action can be reached", async ({
  page
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await openRoute(page);
  await openBackPanel(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  for (const selector of ["#routeBackMethod button", "#routeBackSystems button"]) {
    const boxes = await page.locator(selector).evaluateAll(list => list.map(b => b.getBoundingClientRect().height));
    for (const height of boxes) expect(height, selector).toBeLessThan(48);
  }
  // The panel scrolls inside itself, and the button is not under anything when it is scrolled to
  await show(page).scrollIntoViewIfNeeded();
  const box = await show(page).boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(640);
  const covered = await show(page).evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(hit === el || el.contains(hit));
  });
  expect(covered).toBe(false);
  await page.evaluate(() => window.LibreSpeedI18n.set("sv", false));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const heights = await page
    .locator("#routeBackMethod button")
    .evaluateAll(list => list.map(b => b.getBoundingClientRect().height));
  for (const height of heights) expect(height).toBeLessThan(48);
});

test("C10 the new texts are in the four languages, and the card says them", async ({ page }) => {
  await openRoute(page);
  await openBackPanel(page);
  const keys = [
    "route.back.title",
    "route.back.intro",
    "route.back.method",
    "route.back.method-extension",
    "route.back.method-command",
    "route.back.system-label",
    "route.back.command-help",
    "route.back.paste-label",
    "route.back.paste-placeholder",
    "route.back.upload",
    "route.back.paste-clip",
    "route.back.show",
    "route.back.show-busy",
    "route.back.privacy-summary",
    "route.back.privacy-title",
    "route.back.trace",
    "route.side.toggle"
  ];
  const english = locale("en");
  for (const lang of ["en", "pt", "es", "sv"]) {
    const texts = locale(lang);
    for (const key of keys) expect(texts[key], `${lang} ${key}`).toBeTruthy();
    if (lang !== "en")
      for (const key of ["route.back.method", "route.back.upload", "route.back.show"])
        expect(texts[key]).not.toBe(english[key]);
    await page.evaluate(code => window.LibreSpeedI18n.set(code, false), lang);
    await expect(page.locator("#routeBackTitle")).toHaveText(texts["route.back.title"]);
    await expect(page.locator("#routeBackMethodLabel")).toHaveText(texts["route.back.method"]);
    await expect(page.locator("#routeBackSystemLabel")).toHaveText(texts["route.back.system-label"]);
    await expect(text(page)).toHaveAttribute("placeholder", texts["route.back.paste-placeholder"]);
    await expect(page.locator("#routeBackUpload")).toHaveText(texts["route.back.upload"]);
    await expect(show(page)).toHaveText(texts["route.back.show"]);
    await expect(page.locator(".route-disclosure summary")).toHaveText(texts["route.back.privacy-title"]);
    await expect(page.locator("#routeSide")).not.toContainText("route.back.");
  }
});

test("C12 the main action stays in view while the card scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await openRoute(page, { caps: { ...CAPS, cli_url: "https://github.com/HyakoV3/librespeed-route/releases" } });
  await openBackPanel(page);
  // On a short screen the card scrolls inside itself, and Show route is at its bottom edge all the time
  const inside = await page.evaluate(() => {
    const side = document.getElementById("routeSide").getBoundingClientRect();
    const button = document.getElementById("routeBackShow").getBoundingClientRect();
    return {
      scrolls: document.getElementById("routeSide").scrollHeight > document.getElementById("routeSide").clientHeight,
      visible: button.top >= side.top && button.bottom <= side.bottom + 1
    };
  });
  expect(inside.scrolls).toBe(true);
  expect(inside.visible).toBe(true);
});

test("C13 there is one instruction for the extension, not two, and none when it is here", async ({ page }) => {
  await openRoute(page);
  await chooseMethod(page, "extension");
  await expect(page.locator("#routeBackExtensionArea p:visible")).toHaveCount(1);
  await expect(page.locator("#routeBackTraceHint")).toBeVisible();
  await page.evaluate(() =>
    window.postMessage(
      { source: "librespeed-route-extension", v: 1, type: "state", id: "", state: "ready" },
      window.location.origin
    )
  );
  await expect(page.locator("#routeBackTraceButton")).toBeEnabled();
  await expect(page.locator("#routeBackExtensionArea p:visible")).toHaveCount(0);
});

test("C14 the button of the extension is in the middle of the card, with its words", async ({ page }) => {
  await openRoute(page);
  await chooseMethod(page, "extension");
  const where = await page.evaluate(() => {
    const card = document.getElementById("routeBack").getBoundingClientRect();
    const button = document.getElementById("routeBackTraceButton").getBoundingClientRect();
    const hint = document.getElementById("routeBackTraceHint");
    return {
      card: card.left + card.width / 2,
      button: button.left + button.width / 2,
      align: getComputedStyle(hint).textAlign
    };
  });
  expect(Math.abs(where.button - where.card)).toBeLessThan(4);
  // And when the extension is here, with the button of Cancel beside it while it traces, the two are still in the middle
  await page.evaluate(() =>
    window.postMessage(
      { source: "librespeed-route-extension", v: 1, type: "state", id: "", state: "ready" },
      window.location.origin
    )
  );
  await expect(page.locator("#routeBackTraceButton")).toBeEnabled();
  const ready = await page.evaluate(() => {
    const card = document.getElementById("routeBack").getBoundingClientRect();
    const button = document.getElementById("routeBackTraceButton").getBoundingClientRect();
    return { card: card.left + card.width / 2, button: button.left + button.width / 2 };
  });
  expect(Math.abs(ready.button - ready.card)).toBeLessThan(4);
});

test("C15 the clipboard option is a switch: the keyboard and the click turn it on and off, and the handle and the colour follow", async ({
  page
}) => {
  await openRoute(page);
  await openBackPanel(page);
  const input = page.locator("#routeBackClip");
  // It is a checkbox that says it is a switch, with its label, and no separate square
  await expect(input).toHaveAttribute("role", "switch");
  await expect(input).not.toBeChecked();
  await expect(page.locator('label[id="routeBackClipLabel"] input#routeBackClip')).toHaveCount(1);
  const look = () =>
    page.evaluate(() => {
      const track = document.querySelector(".route-switch-track");
      const handle = document.querySelector(".route-switch-handle");
      return {
        handle: handle.getBoundingClientRect().left - track.getBoundingClientRect().left,
        track: getComputedStyle(track).backgroundColor,
        width: track.getBoundingClientRect().width,
        height: track.getBoundingClientRect().height
      };
    });
  const off = await look();
  expect(off.width).toBeGreaterThan(off.height * 1.5);
  // Pressing the switch turns it on: the handle goes to the other end, the track takes the colour of the action, and the command is piped
  // The input is over the track (it is what the pointer meets), so pressing the switch is pressing it
  await input.click();
  await expect(input).toBeChecked();
  await page.waitForTimeout(500);
  const on = await look();
  expect(on.handle).toBeGreaterThan(off.handle + 8);
  expect(on.track).not.toBe(off.track);
  await expect(page.locator("#routeBackCommand")).toContainText("| clip");
  // The label turns it too, and Space does with the focus on it
  await page.locator(".route-back-clip-text").click();
  await expect(input).not.toBeChecked();
  await input.focus();
  await page.keyboard.press("Space");
  await expect(input).toBeChecked();
  expect(await input.evaluate(el => getComputedStyle(el.nextElementSibling).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Space");
  await expect(input).not.toBeChecked();
  await expect(page.locator("#routeBackCommand")).not.toContainText("| clip");
});
