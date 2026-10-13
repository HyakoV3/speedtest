const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { openBackPanel, showRoute } = require("./helpers/route-side");

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
  await openBackPanel(page);
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
  // Nothing is said while it is off, and what is said when it is turned on is a toast, not a paragraph of the card
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(page.locator("#routeBackClipHint")).toHaveCount(0);
  const plain = { windows: /^tracert -d -h 30 -w 1000 [^|]+$/, macos: /^traceroute -n -m 30 -w 1 [^|]+$/ };
  await system(page, "windows");
  await expect(command(page)).toHaveText(plain.windows);
  await clip.check();
  await expect(command(page)).toHaveText(/^tracert -d -h 30 -w 1000 \S+ \| clip$/);
  await expect(page.locator(".toast", { hasText: "The terminal shows nothing until the command ends" })).toHaveCount(1);
  await expect(page.locator(".toast", { hasText: "Then paste it here (Ctrl+V) and press Show route." })).toHaveCount(1);
  await expect(page.locator(".toast", { hasText: "xclip" })).toHaveCount(0);
  // The copy button copies what is shown
  await page.locator("#routeBackCopy").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\| clip$/);
  await system(page, "macos");
  await expect(command(page)).toHaveText(/^traceroute -n -m 30 -w 1 \S+ \| pbcopy$/);
  await system(page, "linux");
  await expect(command(page)).toHaveText(/^traceroute -n -m 30 -w 1 \S+ \| xclip -selection clipboard$/);
  await expect(page.locator("#routeBackAltCommand")).toHaveText(/^tracepath -n \S+ \| xclip -selection clipboard$/);
  // On Linux, which tool puts it in the clipboard
  await expect(page.locator(".toast", { hasText: "xclip" })).toHaveCount(1);
  // Off again: the plain command
  await clip.uncheck();
  await expect(command(page)).toHaveText(/^traceroute -n -m 30 -w 1 \S+$/);
  const told = await page.locator(".toast").count();
  await clip.check();
  await clip.uncheck();
  // Turning it off says nothing; turning it on says it again (the two toasts of Linux)
  await expect.poll(() => page.locator(".toast").count()).toBeGreaterThanOrEqual(Math.min(3, told));
  await system(page, "macos");
  await expect(command(page)).toHaveText(plain.macos);
  // Without a command (a name that a command cannot take) there is no hint of the pipe
  const result = await page.evaluate(() => window.LibreSpeedRouteBack.commands("windows", "a$b.example", 4, true));
  expect(result).toBeNull();
});

// What a Ctrl+V does: a paste event on an element, with the clipboard that the test gives it
const pasteOn = (page, selector, { text = null, file = null } = {}) =>
  page.evaluate(
    ([target, content, attached]) => {
      const data = new DataTransfer();
      if (content !== null) data.setData("text/plain", content);
      if (attached) data.items.add(new File([new Uint8Array(attached.bytes)], attached.name, { type: attached.type }));
      const element = target === "body" ? document.body : document.querySelector(target);
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    },
    [selector, text, file ? { ...file, bytes: Array.from(file.bytes) } : null]
  );

test("K2 pasting on the card (Ctrl+V, the focus anywhere) puts the output in the box, and shows and sends nothing until the button is pressed", async ({
  page
}) => {
  const seen = await openRoute(page);
  // The focus is on a button of the card, not in the box
  await page.locator("#routeBackSystems [data-system='linux']").focus();
  expect(await pasteOn(page, "body", { text: TRACERT })).toBe(true);
  await expect(page.locator("#routeBackText")).toHaveValue(BOXED);
  await expect(page.locator("#routeBackShow")).toBeFocused();
  await page.waitForTimeout(300);
  await expect(rows(page)).toHaveCount(0);
  expect(seen.enrich).toHaveLength(0);
  await page.locator("#routeBackShow").click();
  await expect(rows(page)).toHaveCount(13);
  expect(seen.enrich).toHaveLength(1);
  expect(seen.enrich[0].hops.map(h => h.ip)).toEqual(["72.14.208.80", "142.251.69.137", "192.178.240.77", "8.8.8.8"]);
  // A second paste takes the place of the first
  await pasteOn(page, "body", { text: "traceroute to 1.1.1.1 (1.1.1.1)\n 1  1.1.1.1  1 ms" });
  await expect(page.locator("#routeBackText")).toHaveValue(/^traceroute to 1\.1\.1\.1/);
});

test("K3 the paste is left alone where it is not for the card: in the box itself, in another field, with the card closed, or with nothing to paste", async ({
  page
}) => {
  const seen = await openRoute(page);
  // In the box: the browser puts it (the event is not taken)
  expect(await pasteOn(page, "#routeBackText", { text: "typed here" })).toBe(false);
  // In another field of the page
  await page.evaluate(() => {
    const field = document.createElement("input");
    field.id = "elsewhere";
    document.body.appendChild(field);
  });
  expect(await pasteOn(page, "#elsewhere", { text: "for the other field" })).toBe(false);
  await expect(page.locator("#routeBackText")).toHaveValue("");
  // Nothing to paste, or only blanks
  expect(await pasteOn(page, "body", {})).toBe(false);
  expect(await pasteOn(page, "body", { text: "   \n  " })).toBe(true);
  await expect(page.locator("#routeBackText")).toHaveValue("");
  // With the card closed the page is not touched
  await page.locator("#routeSideClose").click();
  await expect(page.locator("#routeSide")).toBeHidden();
  expect(await pasteOn(page, "body", { text: TRACERT })).toBe(false);
  await page.locator("#routeSideToggle").click();
  await expect(page.locator("#routeBackText")).toHaveValue("");
  // A text over the limit of the box is told, and not put in
  await pasteOn(page, "body", { text: "x".repeat(40000) });
  await expect(notes(page)).toContainText("too long");
  await expect(page.locator("#routeBackText")).toHaveValue("");
  expect(seen.enrich).toHaveLength(0);
});

test("K3b a file pasted on the card is read as a dropped one, and an image or another thing that is not text is refused", async ({
  page
}) => {
  const seen = await openRoute(page);
  expect(
    await pasteOn(page, "body", {
      file: { name: "route.txt", type: "text/plain", bytes: Buffer.from(TRACERT, "utf8") }
    })
  ).toBe(true);
  await expect(page.locator("#routeBackText")).toHaveValue(BOXED);
  await expect(page.locator("#routeBackFileCard")).toBeVisible();
  // A picture: the clipboard of a screenshot
  await page.locator("#routeBackClear").click();
  expect(
    await pasteOn(page, "body", {
      file: { name: "image.png", type: "image/png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }
    })
  ).toBe(true);
  await expect(notes(page)).toContainText("This is not text");
  await expect(page.locator("#routeBackText")).toHaveValue("");
  await expect(page.locator("#routeBackFileCard")).toBeHidden();
  // Even when the focus is in the box, a file is not put in it as text
  await pasteOn(page, "#routeBackText", {
    file: { name: "doc.pdf", type: "application/pdf", bytes: Buffer.from([0x25, 0x50, 0x44, 0x46]) }
  });
  await expect(notes(page)).toContainText("This is not text");
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
  await expect(notes(page)).toContainText("This is not text");
  await expect(page.locator("#routeBackText")).toHaveValue("what the person had written");
  await drop(page, Buffer.alloc(0), "empty.txt");
  await expect(notes(page)).toContainText("could not be read as text");
  await drop(page, Buffer.alloc(300000, 0x61), "big.txt");
  await expect(notes(page)).toContainText("could not be read as text");
  await expect(page.locator("#routeBackText")).toHaveValue("what the person had written");
  // A file of 40 KB is under the limit of bytes and over the limit of characters of the box and the parser (32768): refused too, so that
  // "Show route" is not left with a text that it can only call too long
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

test("K6 the texts of the box are in the four languages, and the privacy text names the one button", async ({
  page
}) => {
  await openRoute(page);
  const texts = {
    en: [
      "Paste the output here (Ctrl+V) or drop a .txt file",
      "Choose a .txt file",
      "Show route",
      "Send the result to the clipboard"
    ],
    pt: [
      "Cole a saída aqui (Ctrl+V) ou solte um arquivo .txt",
      "Escolher um arquivo .txt",
      "Mostrar rota",
      "Mandar o resultado para a área de transferência"
    ],
    es: [
      "Pega aquí la salida (Ctrl+V) o suelta un archivo .txt",
      "Elegir un archivo .txt",
      "Mostrar ruta",
      "Enviar el resultado al portapapeles"
    ],
    sv: [
      "Klistra in utskriften här (Ctrl+V) eller släpp en .txt-fil",
      "Välj en .txt-fil",
      "Visa vägen",
      "Skicka resultatet till urklipp"
    ]
  };
  for (const [language, [placeholder, upload, show, clipLabel]] of Object.entries(texts)) {
    await page.evaluate(code => window.LibreSpeedI18n.set(code, false), language);
    await expect(page.locator("#routeBackText")).toHaveAttribute("placeholder", placeholder);
    await expect(page.locator("#routeBackUpload")).toHaveAttribute("aria-label", upload);
    await expect(page.locator("#routeBackUpload")).toHaveAttribute("title", upload);
    await expect(page.locator("#routeBackShow")).toHaveText(show);
    await expect(page.locator(".route-back-clip-text")).toHaveText(clipLabel);
    const privacy = await page.locator('#routeBack [data-i18n="route.back.privacy"]').textContent();
    expect(privacy, language).toContain(show);
    // The button that read the clipboard is gone, and so are its words
    await expect(page.locator("#routeBackPasteClip")).toHaveCount(0);
    expect(await page.locator("#routeSide").innerText(), language).not.toMatch(
      /clipboard and show|portapapeles y mostrar|transferência e mostrar|urklipp och visa/i
    );
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
  for (const id of ["routeBackUpload", "routeBackShow", "routeBackClip"]) {
    const box = await page.locator(`#${id}`).boundingBox();
    expect(box.x, id).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, id).toBeLessThanOrEqual(360);
  }
});

const dragOn = (page, type, { files = false, text = null, target = "#routeBackDrop" } = {}) =>
  page.evaluate(
    ([kind, withFile, content, selector]) => {
      const data = new DataTransfer();
      if (withFile) data.items.add(new File(["x"], "a.txt", { type: "text/plain" }));
      if (content !== null) data.setData("text/plain", content);
      const event = new DragEvent(kind, { dataTransfer: data, bubbles: true, cancelable: true });
      document.querySelector(selector).dispatchEvent(event);
      return event.defaultPrevented;
    },
    [type, files, text, target]
  );

test("K8 the box takes the colour of the action while something is dragged over it, and a text dropped on the field goes into the box", async ({
  page
}) => {
  await openRoute(page);
  const field = page.locator("#routeBackDrop");
  await expect(field).not.toHaveClass(/dragging/);
  expect(await dragOn(page, "dragenter", { files: true })).toBe(true);
  await expect(field).toHaveClass(/dragging/);
  const colours = await field.evaluate(el => ({
    border: getComputedStyle(el).borderTopColor,
    style: getComputedStyle(el).borderTopStyle
  }));
  expect(colours.style).toBe("solid");
  await dragOn(page, "dragleave", { files: true });
  await expect(field).not.toHaveClass(/dragging/);
  // Something that carries nothing that the box can take is not welcomed (no mark)
  await page.evaluate(() => {
    const event = new DragEvent("dragenter", { dataTransfer: new DataTransfer(), bubbles: true, cancelable: true });
    document.getElementById("routeBackDrop").dispatchEvent(event);
  });
  await expect(field).not.toHaveClass(/dragging/);
  // A text dropped on the field (not on the box itself) goes into the box
  await dragOn(page, "dragenter", { text: "hello" });
  expect(await dragOn(page, "drop", { text: TRACERT })).toBe(true);
  await expect(field).not.toHaveClass(/dragging/);
  await expect(page.locator("#routeBackText")).toHaveValue(BOXED);
});

test("K9 the file that the text came from is a card with its name, its kind and its size, and it goes with the text", async ({
  page
}) => {
  await openRoute(page);
  const card = page.locator("#routeBackFileCard");
  await expect(card).toBeHidden();
  await drop(page, Buffer.from(TRACERT, "utf8"), "my route.txt");
  await expect(card).toBeVisible();
  await expect(page.locator("#routeBackFileName")).toHaveText("my route.txt");
  await expect(page.locator("#routeBackFileMeta")).toHaveText(/^TXT · \d+(\.\d)? (B|KB)$/);
  await expect(card.locator("svg")).toHaveCount(2);
  // Editing the text: it is no longer the text of the file
  await page.locator("#routeBackText").press("End");
  await page.locator("#routeBackText").pressSequentially(" ");
  await expect(card).toBeHidden();
  // The cross takes the file out: the box is empty again and the person is where to paste
  await drop(page, Buffer.from(TRACERT, "utf8"), "again.txt");
  await expect(card).toBeVisible();
  await page.locator("#routeBackFileRemove").click();
  await expect(card).toBeHidden();
  await expect(page.locator("#routeBackText")).toHaveValue("");
  await expect(page.locator("#routeBackText")).toBeFocused();
  await expect(page.locator("#routeBackFileRemove")).toHaveAttribute("aria-label", "Remove the file");
  // Clear takes it too
  await drop(page, Buffer.from(TRACERT, "utf8"), "third.txt");
  await expect(card).toBeVisible();
  await page.locator("#routeBackClear").click();
  await expect(card).toBeHidden();
  // A name that is long stays in one line, with the cross in sight
  await drop(page, Buffer.from(TRACERT, "utf8"), `${"long-name-".repeat(12)}.txt`);
  const fit = await page.evaluate(() => {
    const cardBox = document.getElementById("routeBackFileCard").getBoundingClientRect();
    const cross = document.getElementById("routeBackFileRemove").getBoundingClientRect();
    return cross.right <= cardBox.right + 1 && cross.left >= cardBox.left;
  });
  expect(fit).toBe(true);
});

test("K10 the clip in the corner of the box opens the choice of a file, with the keyboard too, in the icon set chosen", async ({
  page
}) => {
  const seen = await openRoute(page);
  const button = page.locator("#routeBackUpload");
  await expect(button.locator("svg")).toHaveCount(1);
  const box = await page.evaluate(() => {
    const field = document.getElementById("routeBackDrop").getBoundingClientRect();
    const clip = document.getElementById("routeBackUpload").getBoundingClientRect();
    return {
      inside: clip.left >= field.left && clip.right <= field.right && clip.bottom <= field.bottom + 1,
      right: clip.left > field.left + field.width / 2
    };
  });
  expect(box.inside && box.right).toBe(true);
  // With the mouse, and with Enter and with Space
  for (const how of ["click", "Enter", "Space"]) {
    const chooser = page.waitForEvent("filechooser");
    if (how === "click") await button.click();
    else {
      await button.focus();
      await page.keyboard.press(how);
    }
    const file = await chooser;
    expect(file.isMultiple()).toBe(false);
    await file.setFiles({ name: `${how}.txt`, mimeType: "text/plain", buffer: Buffer.from(TRACERT) });
    await expect(page.locator("#routeBackFileName")).toHaveText(`${how}.txt`);
    await page.locator("#routeBackFileRemove").click();
  }
  // Every set of icons has the clip and the cross
  const sets = await page.evaluate(() => window.LibreSpeedIcons.sets().map(set => set.id));
  const drawings = new Set();
  for (const id of sets) {
    await page.evaluate(value => window.LibreSpeedIcons.set(value, false), id);
    await expect(button.locator("svg")).toHaveCount(1);
    drawings.add(await button.locator("svg").innerHTML());
  }
  expect(drawings.size).toBe(sets.length);
  // Choosing a file shows and sends nothing
  expect(seen.enrich).toHaveLength(0);
});

test("K1b turning the clipboard on says what to do in a toast, and on Linux which tool puts it there; turning it off says nothing", async ({
  page
}) => {
  await openRoute(page);
  const clip = page.locator("#routeBackClip");
  await system(page, "linux");
  await clip.check();
  await expect(page.locator(".toast", { hasText: "The terminal shows nothing until the command ends" })).toHaveCount(1);
  await expect(page.locator(".toast", { hasText: "xclip" })).toHaveCount(1);
  while ((await page.locator(".toast").count()) > 0) {
    await page.evaluate(
      () => document.querySelector(".toast button") && document.querySelector(".toast button").click()
    );
    await page.waitForTimeout(350);
  }
  await clip.uncheck();
  await page.waitForTimeout(500);
  await expect(page.locator(".toast")).toHaveCount(0);
  // On a system where it is not Linux, no note about xclip
  await system(page, "windows");
  await clip.check();
  await expect(page.locator(".toast", { hasText: "The terminal shows nothing" })).toHaveCount(1);
  await expect(page.locator(".toast", { hasText: "xclip" })).toHaveCount(0);
});
