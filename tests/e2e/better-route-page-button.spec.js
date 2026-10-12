const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));
const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };
const LSR1 =
  "LSR1!n=fb8c88f1c59c13c3!f=4!t=77.42.65.55!s=1791768133!a=0.2.0+tracert!h=1,-p,0.5,3,3;2,-p,0.5,3,3;3,-p,1,3,3;4,-p,1,3,3;5,-p,1,3,3;6,-c,1,3,3;7,8.242.72.137,2,3,3;8,171.75.10.35,235,3,3;9,212.133.6.2,232,3,3;10,213.239.224.38,233,3,3;11,213.239.228.10,233,3,3;12,*,0,3,0;13,*,0,3,0;14,95.216.131.198,232,3,3;15,77.42.65.55,231,3,3";
const CODES = [
  "not-allowed",
  "no-gesture",
  "busy",
  "no-host",
  "update",
  "refused",
  "no-tool",
  "failed",
  "silent",
  "interrupted",
  "too-long",
  "moved"
];

// What the bridge of the extension does in a page that the person allowed: it answers a hello with "ready" (when it is there), and keeps what
// the page asks. The test makes it say the rest.
const BRIDGE = () => {
  window.__bridge = { present: window.__present !== false, log: [] };
  window.__say = message =>
    window.postMessage(Object.assign({ source: "librespeed-route-extension", v: 1 }, message), window.location.origin);
  window.addEventListener("message", event => {
    var d = event.data;
    if (event.source !== window || !d || d.source !== "librespeed-route-page") return;
    window.__bridge.log.push(d);
    if (d.type === "hello" && window.__bridge.present) window.__say({ type: "state", id: d.id, state: "ready" });
  });
};

async function openRoute(page, { extension = true } = {}) {
  await page.addInitScript(extension ? "window.__present = true" : "window.__present = false");
  await page.addInitScript(BRIDGE);
  await page.route("**/backend/route.php*", route => {
    if (route.request().method() === "POST") return route.fulfill({ json: fixture("normal") });
    return route.fulfill({ json: CAPS });
  });
  await page.route("**/backend/route_enrich.php", route => {
    const body = JSON.parse(route.request().postData());
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
  await expect(page.locator("#routeDirection")).toBeVisible();
  await page.locator('[data-direction="back"]').click();
  await expect(page.locator("#routeBack")).toBeVisible();
}

const say = (page, message) => page.evaluate(m => window.__say(m), message);
const asked = page => page.evaluate(() => window.__bridge.log.filter(m => m.type !== "hello"));
// The message of the page reaches the bridge in a task of its own: wait until n requests are there, and give the last
const nth = async (page, n) => {
  await expect.poll(async () => (await asked(page)).length).toBe(n);
  return (await asked(page))[n - 1];
};
const state = (id, name, code) => Object.assign({ type: "state", id, state: name }, code ? { code } : {});
const button = page => page.locator("#routeBackTraceButton");
const notes = page => page.locator("#routeBackNotes");
const traceNote = page => page.locator("#routeBackTraceNote");

test("P1 without the extension the button is off and says what to do; the page asked once whether it is there", async ({
  page
}) => {
  await openRoute(page, { extension: false });
  await expect(button(page)).toBeDisabled();
  await expect(page.locator("#routeBackTraceHint")).toBeVisible();
  await expect(page.locator("#routeBackTraceHint")).toContainText("Allow this site");
  const log = await page.evaluate(() => window.__bridge.log);
  expect(log).toHaveLength(1);
  expect(Object.keys(log[0]).sort()).toEqual(["id", "source", "type", "v"]);
  expect(log[0]).toMatchObject({ source: "librespeed-route-page", v: 1, type: "hello" });
  expect(log[0].id).toMatch(/^[0-9a-f]{18}$/);
});

test("P2 the extension is here: the button is on, a click asks for a trace in the exact shape, and the route comes in", async ({
  page
}) => {
  await openRoute(page);
  await expect(button(page)).toBeEnabled();
  await expect(page.locator("#routeBackTraceHint")).toBeHidden();
  await button(page).click();
  const request = await nth(page, 1);
  expect(Object.keys(request).sort()).toEqual(["id", "source", "type", "v"]);
  expect(request).toMatchObject({ source: "librespeed-route-page", v: 1, type: "trace" });
  expect(request.id).toMatch(/^[0-9a-f]{18}$/);
  // While it traces: the button is off, Cancel is there, and it is said
  await expect(button(page)).toBeDisabled();
  await expect(page.locator("#routeBackTraceCancel")).toBeVisible();
  await expect(traceNote(page)).toBeVisible();
  await expect(traceNote(page)).toContainText("Tracing the route from your computer");
  await say(page, state(request.id, "tracing"));
  await say(page, { lsr1: LSR1 });
  await say(page, state(request.id, "done"));
  await expect(page.locator("#routeTable tbody tr")).toHaveCount(14);
  await expect(notes(page)).toContainText("Route received from the browser extension.");
  await expect(button(page)).toBeEnabled();
  await expect(page.locator("#routeBackTraceCancel")).toBeHidden();
  // Never saved by itself
  expect(await page.evaluate(() => window.localStorage.getItem("librespeed-better-route-history"))).toBeNull();
});

test("P3 a site that is allowed while the page is open: the extension says ready by itself and the button turns on", async ({
  page
}) => {
  await openRoute(page, { extension: false });
  await expect(button(page)).toBeDisabled();
  await say(page, state("", "ready"));
  await expect(button(page)).toBeEnabled();
  await expect(page.locator("#routeBackTraceHint")).toBeHidden();
});

test("P3b the person turns the site off while the page is open: the button goes off and says what to do", async ({
  page
}) => {
  await openRoute(page);
  await expect(button(page)).toBeEnabled();
  await say(page, state("", "off"));
  await expect(button(page)).toBeDisabled();
  await expect(page.locator("#routeBackTraceHint")).toBeVisible();
  await say(page, state("", "ready"));
  await expect(button(page)).toBeEnabled();
});

test("P4 every code of the protocol has its text, in the four languages, and an unknown one is a failure", async ({
  page
}) => {
  await openRoute(page);
  for (const lang of ["en", "pt", "es", "sv"]) {
    const texts = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "better", "locales", `${lang}.json`), "utf8")
    );
    for (const code of [...CODES, "timeout"])
      expect(texts[`route.back.trace-error.${code}`], `${lang} ${code}`).toBeTruthy();
    for (const key of ["trace", "trace-cancel", "trace-setup", "trace-tracing"])
      expect(texts[`route.back.${key}`], `${lang} ${key}`).toBeTruthy();
  }
  const english = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "better", "locales", "en.json"), "utf8")
  );
  let n = 0;
  for (const code of CODES) {
    await button(page).click();
    const id = (await nth(page, ++n)).id;
    await say(page, state(id, "error", code));
    await expect(traceNote(page)).toBeVisible();
    await expect(traceNote(page)).toHaveText(english[`route.back.trace-error.${code}`]);
    // And the same words in the red box at the top, in the middle, for the eyes only
    await expect(page.locator("#routeToast")).toBeVisible();
    await expect(page.locator("#routeToast")).toHaveText(english[`route.back.trace-error.${code}`]);
    await expect(page.locator("#routeToast")).toHaveAttribute("aria-hidden", "true");
    await expect(traceNote(page)).toHaveClass(/route-error/);
    await expect(button(page)).toBeEnabled();
  }
  await button(page).click();
  const id = (await nth(page, ++n)).id;
  await say(page, state(id, "error", "something-else"));
  await expect(traceNote(page)).toHaveText(english["route.back.trace-error.failed"]);
});

test("P5 only the answers about the trace that this page asked for are read, and only of exactly the shape of the protocol", async ({
  page
}) => {
  await openRoute(page);
  await button(page).click();
  const id = (await nth(page, 1)).id;
  // Another id, a message with more keys, another version, another source, a text for a code, a message from a frame
  await say(page, state("aaaaaaaaaaaa", "error", "busy"));
  await say(page, Object.assign(state(id, "error", "busy"), { extra: 1 }));
  await say(page, { v: 2, type: "state", id, state: "error", code: "busy" });
  await page.evaluate(
    i =>
      window.postMessage(
        { source: "other", v: 1, type: "state", id: i, state: "error", code: "busy" },
        window.location.origin
      ),
    id
  );
  await page.evaluate(i => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    frame.contentWindow.eval(
      "parent.postMessage(" +
        JSON.stringify({
          source: "librespeed-route-extension",
          v: 1,
          type: "state",
          id: i,
          state: "error",
          code: "busy"
        }) +
        ", '*')"
    );
  }, id);
  await page.waitForTimeout(300);
  await expect(button(page)).toBeDisabled();
  await expect(page.locator("#routeBackTraceCancel")).toBeVisible();
  await expect(traceNote(page)).toContainText("Tracing the route");
  // The real one ends it
  await say(page, state(id, "error", "busy"));
  await expect(button(page)).toBeEnabled();
});

test("P6 Cancel tells the extension, ends the wait, and a late answer is ignored", async ({ page }) => {
  await openRoute(page);
  await button(page).click();
  const id = (await nth(page, 1)).id;
  await page.locator("#routeBackTraceCancel").click();
  await expect.poll(async () => (await asked(page)).length).toBe(2);
  expect((await asked(page))[1]).toEqual({ source: "librespeed-route-page", v: 1, type: "cancel", id });
  await expect(button(page)).toBeEnabled();
  await expect(page.locator("#routeBackTraceCancel")).toBeHidden();
  await expect(traceNote(page)).toBeHidden();
  await say(page, state(id, "error", "busy"));
  await page.waitForTimeout(200);
  await expect(traceNote(page)).toBeHidden();
});

test("P7 an extension that never answers: after 150 seconds the page cancels and says so", async ({ page }) => {
  await page.clock.install();
  await openRoute(page);
  await button(page).click();
  const id = (await nth(page, 1)).id;
  await page.clock.fastForward(149000);
  await expect(button(page)).toBeDisabled();
  await page.clock.fastForward(2000);
  await expect(button(page)).toBeEnabled();
  await expect(traceNote(page)).toContainText("The extension did not answer in time.");
  const log = await asked(page);
  expect(log[log.length - 1]).toEqual({ source: "librespeed-route-page", v: 1, type: "cancel", id });
});

test("P8 a trace is asked for once at a time, and not when the button is off", async ({ page }) => {
  await openRoute(page, { extension: false });
  await button(page).click({ force: true });
  await page.waitForTimeout(300);
  expect(await asked(page)).toEqual([]);
  await say(page, state("", "ready"));
  await button(page).click();
  await button(page).click({ force: true });
  await page.waitForTimeout(300);
  expect(await asked(page)).toHaveLength(1);
});

test("P9 the red box goes by itself, with a click, and when a new trace starts; the tracing line is not one", async ({
  page
}) => {
  await page.clock.install();
  await openRoute(page);
  await button(page).click();
  const first = (await nth(page, 1)).id;
  await expect(page.locator("#routeToast")).toHaveCount(0);
  await say(page, state(first, "error", "busy"));
  await expect(page.locator("#routeToast")).toBeVisible();
  // At the top of the screen, in the middle (and not over the panel of the corner)
  const box = await page.locator("#routeToast").boundingBox();
  const view = page.viewportSize();
  expect(box.y).toBeLessThan(40);
  expect(Math.abs(box.x + box.width / 2 - view.width / 2)).toBeLessThan(2);
  await page.clock.fastForward(8000);
  await expect(page.locator("#routeToast")).toBeVisible();
  await page.clock.fastForward(2000);
  await expect(page.locator("#routeToast")).toBeHidden();
  // A click takes it away
  await button(page).click();
  const second = (await nth(page, 2)).id;
  await say(page, state(second, "error", "failed"));
  await expect(page.locator("#routeToast")).toBeVisible();
  await page.locator("#routeToast").click();
  await expect(page.locator("#routeToast")).toBeHidden();
  // A new trace takes it away, and "tracing" is not an error
  await button(page).click();
  const third = (await nth(page, 3)).id;
  await say(page, state(third, "error", "silent"));
  await expect(page.locator("#routeToast")).toBeVisible();
  await button(page).click();
  await expect(page.locator("#routeToast")).toBeHidden();
  await expect(traceNote(page)).toContainText("Tracing the route");
});
