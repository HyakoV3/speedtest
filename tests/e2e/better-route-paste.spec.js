const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));
const sample = name => fs.readFileSync(path.join(__dirname, "..", "fixtures", "route-back", name), "utf8");
const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };
const TRACERT = sample("windows-ptbr-real-v4.txt");
// A box of text keeps its lines with LF only, whatever the line ends of what was put in
const BOXED = TRACERT.replace(/\r\n/g, "\n");

const ENRICH = body => ({
  v: 1,
  hops: body.hops.map(h => ({
    ttl: h.ttl,
    asn: `AS${h.ip.split(".").pop()}`,
    as_name: `Net ${h.ip.split(".").pop()}`,
    country: "BR",
    country_doubt: false
  })),
  target_as: { asn: "AS15169", as_name: "Google LLC" },
  target_country: "US"
});

async function openRoute(page) {
  const seen = { enrich: [] };
  await page.route("**/backend/route.php*", route => {
    if (route.request().method() === "POST") return route.fulfill({ json: fixture("normal") });
    return route.fulfill({ json: CAPS });
  });
  await page.route("**/backend/route_enrich.php", route => {
    seen.enrich.push(JSON.parse(route.request().postData()));
    return route.fulfill({ json: ENRICH(JSON.parse(route.request().postData())) });
  });
  await page.goto(`${staticRepositoryUrl}/route-better.html`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  await expect(page.locator("#routeDirection")).toBeVisible();
  await page.locator('[data-direction="back"]').click();
  await expect(page.locator("#routeBack")).toBeVisible();
  return seen;
}
const rows = page => page.locator("#routeTable tbody tr");
const notes = page => page.locator("#routeBackNotes");
const command = page => page.locator("#routeBackCommand");
const system = (page, name) => page.locator(`#routeBackSystems [data-system="${name}"]`).click();

test("K1 the command can send its output to the clipboard: the pipe of each system, in the command and in the copy", async ({
  page,
  context
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openRoute(page);
  const clip = page.locator("#routeBackClip");
  await expect(clip).not.toBeChecked();
  await expect(page.locator("#routeBackClipHint")).toBeHidden();
  const plain = { windows: /^tracert -d -h 30 -w 1000 [^|]+$/, macos: /^traceroute -n -m 30 -w 1 [^|]+$/ };
  await system(page, "windows");
  await expect(command(page)).toHaveText(plain.windows);
  await clip.check();
  await expect(command(page)).toHaveText(/^tracert -d -h 30 -w 1000 \S+ \| clip$/);
  await expect(page.locator("#routeBackClipHint")).toBeVisible();
  await expect(page.locator("#routeBackClipLinux")).toBeHidden();
  // The copy button copies what is shown
  await page.locator("#routeBackCopy").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\| clip$/);
  await system(page, "macos");
  await expect(command(page)).toHaveText(/^traceroute -n -m 30 -w 1 \S+ \| pbcopy$/);
  await system(page, "linux");
  await expect(command(page)).toHaveText(/^traceroute -n -m 30 -w 1 \S+ \| xclip -selection clipboard$/);
  await expect(page.locator("#routeBackAltCommand")).toHaveText(/^tracepath -n \S+ \| xclip -selection clipboard$/);
  await expect(page.locator("#routeBackClipLinux")).toBeVisible();
  // Off again: the plain command
  await clip.uncheck();
  await expect(command(page)).toHaveText(/^traceroute -n -m 30 -w 1 \S+$/);
  await expect(page.locator("#routeBackClipHint")).toBeHidden();
  await system(page, "macos");
  await expect(command(page)).toHaveText(plain.macos);
  // Without a command (a name that a command cannot take) there is no hint of the pipe
  const result = await page.evaluate(() => window.LibreSpeedRouteBack.commands("windows", "a$b.example", 4, true));
  expect(result).toBeNull();
});

test("K2 'Paste and show' reads the clipboard and shows the route: one press, one request for the public addresses", async ({
  page,
  context
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const seen = await openRoute(page);
  await page.evaluate(text => navigator.clipboard.writeText(text), TRACERT);
  await page.locator("#routeBackPasteClip").click();
  await expect(rows(page)).toHaveCount(13);
  await expect(page.locator("#routeBackText")).toHaveValue(BOXED);
  expect(seen.enrich).toHaveLength(1);
  expect(seen.enrich[0].hops.map(h => h.ip)).toEqual(["72.14.208.80", "142.251.69.137", "192.178.240.77", "8.8.8.8"]);
});

test("K3 when the browser does not give the clipboard, or it has no text, nothing is shown or sent", async ({
  page,
  context
}) => {
  const seen = await openRoute(page);
  // No permission: the browser refuses
  await page.locator("#routeBackPasteClip").click();
  await expect(notes(page)).toContainText("did not let this page read the clipboard");
  await expect(page.locator("#routeBackText")).toHaveValue("");
  // Empty clipboard
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("   "));
  await page.locator("#routeBackPasteClip").click();
  await expect(notes(page)).toContainText("Paste the output of the command first.");
  // Text that is not a route
  await page.evaluate(() => navigator.clipboard.writeText("hello, this is not a route"));
  await page.locator("#routeBackPasteClip").click();
  await expect(notes(page)).toContainText("does not look like the output");
  // A browser with no readText at all
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "readText", { value: undefined, configurable: true });
  });
  await page.locator("#routeBackPasteClip").click();
  await expect(notes(page)).toContainText("did not let this page read the clipboard");
  await expect(rows(page)).toHaveCount(0);
  expect(seen.enrich).toHaveLength(0);
});

const drop = (page, bytes, name = "output.txt") =>
  page.evaluate(
    ([list, fileName]) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(list)], fileName));
      document
        .getElementById("routeBackText")
        .dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
    },
    [Array.from(bytes), name]
  );

test("K4 a file dropped on the box fills it: UTF-16 from PowerShell, UTF-8, and it is shown only when the person presses", async ({
  page
}) => {
  const seen = await openRoute(page);
  // The file that PowerShell makes with ">": UTF-16 with a mark at the start
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(TRACERT, "utf16le")]);
  await drop(page, utf16);
  await expect(page.locator("#routeBackText")).toHaveValue(BOXED);
  // Nothing is shown or sent by the drop itself
  await expect(rows(page)).toHaveCount(0);
  expect(seen.enrich).toHaveLength(0);
  await expect(page.locator("#routeBackShow")).toBeFocused();
  await page.locator("#routeBackShow").click();
  await expect(rows(page)).toHaveCount(13);
  expect(seen.enrich).toHaveLength(1);
  // UTF-8 (with and without a mark)
  await page.locator("#routeBackClear").click();
  await drop(page, Buffer.from(TRACERT, "utf8"));
  await expect(page.locator("#routeBackText")).toHaveValue(BOXED);
  await page.locator("#routeBackClear").click();
  await drop(page, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(TRACERT, "utf8")]));
  await expect(page.locator("#routeBackText")).toHaveValue(BOXED);
});

test("K5 a file that is not text, is empty or is too big is refused and the box is left as it is", async ({ page }) => {
  await openRoute(page);
  await page.locator("#routeBackText").fill("what the person had written");
  await drop(page, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), "picture.png");
  await expect(notes(page)).toContainText("could not be read as text");
  await expect(page.locator("#routeBackText")).toHaveValue("what the person had written");
  await drop(page, Buffer.alloc(0), "empty.txt");
  await expect(notes(page)).toContainText("could not be read as text");
  await drop(page, Buffer.alloc(300000, 0x61), "big.txt");
  await expect(notes(page)).toContainText("could not be read as text");
  await expect(page.locator("#routeBackText")).toHaveValue("what the person had written");
  // A file of 40 KB is under the limit of bytes and over the limit of characters of the box and the parser (32768): refused too, so that
  // "Show my route" is not left with a text that it can only call too long
  await page.locator("#routeBackText").fill("what the person had written");
  await drop(page, Buffer.from(`${TRACERT}${"x".repeat(40000)}`, "utf8"), "forty.txt");
  await expect(notes(page)).toContainText("could not be read as text");
  await expect(page.locator("#routeBackText")).toHaveValue("what the person had written");
  // The same in UTF-16: 40000 characters are 80 KB
  await drop(page, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("a".repeat(40000), "utf16le")]), "utf16.txt");
  await expect(notes(page)).toContainText("could not be read as text");
  await expect(page.locator("#routeBackText")).toHaveValue("what the person had written");
  // Just inside the limit it is taken: exactly 32768 characters
  const full = `${TRACERT}${" ".repeat(32768 - TRACERT.length - 1)}x`;
  expect(full).toHaveLength(32768);
  await drop(page, Buffer.from(full, "utf8"));
  await expect(page.locator("#routeBackText")).toHaveValue(full.replace(/\r\n/g, "\n"));
  await expect(notes(page)).toHaveText("");
  // And one character more is not
  await page.locator("#routeBackText").fill("what the person had written");
  await drop(page, Buffer.from(`${full}y`, "utf8"));
  await expect(notes(page)).toContainText("could not be read as text");
  await expect(page.locator("#routeBackText")).toHaveValue("what the person had written");
  // A drop with no file (text dragged from somewhere) is left to the browser
  const handled = await page.evaluate(() => {
    const event = new DragEvent("drop", { dataTransfer: new DataTransfer(), bubbles: true, cancelable: true });
    document.getElementById("routeBackText").dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(handled).toBe(false);
});

test("K6 the new texts are in the four languages, and the privacy text names the two buttons", async ({ page }) => {
  await openRoute(page);
  const texts = {
    en: ["Paste and show", "Show my route", "Send the result to the clipboard"],
    pt: ["Colar e mostrar", "Mostrar minha rota", "Mandar o resultado para a área de transferência"],
    es: ["Pegar y mostrar", "Mostrar mi ruta", "Enviar el resultado al portapapeles"],
    sv: ["Klistra in och visa", "Visa min väg", "Skicka resultatet till urklipp"]
  };
  for (const [language, [paste, show, clipLabel]] of Object.entries(texts)) {
    await page.evaluate(code => window.LibreSpeedI18n.set(code, false), language);
    await expect(page.locator("#routeBackPasteClip")).toHaveText(paste);
    await expect(page.locator("#routeBackShow")).toHaveText(show);
    await expect(page.locator(".route-back-clip span")).toHaveText(clipLabel);
    const privacy = await page.locator('#routeBack [data-i18n="route.back.privacy"]').innerText();
    expect(privacy, language).toContain(paste);
    expect(privacy, language).toContain(show);
  }
});

test("K7 at 360 px the new controls fit, in Swedish", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openRoute(page);
  await page.evaluate(() => window.LibreSpeedI18n.set("sv", false));
  await page.locator("#routeBackClip").check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true
  );
  for (const id of ["routeBackPasteClip", "routeBackShow", "routeBackClip"]) {
    const box = await page.locator(`#${id}`).boundingBox();
    expect(box.x, id).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, id).toBeLessThanOrEqual(360);
  }
});
