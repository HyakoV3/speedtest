const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";
const subset = JSON.parse(fs.readFileSync(path.join(__dirname, "../../frontend/better/icons/subset.json"), "utf8"));

async function openPage(page, pagePath = "/index-better.html", query = "") {
  await page.addInitScript(() => window.localStorage.setItem("librespeed-better-consent", String(Date.now())));
  await page.route("**/server-list.json*", route => route.fulfill({ json: [] }));
  await page.goto(`${staticRepositoryUrl}${pagePath}${query}`);
}

function themeButton(page) {
  return page.locator(".panel-button");
}

test("every set of the file has every icon the pages use", () => {
  const names = [
    "sun",
    "moon",
    "share",
    "chevron-left",
    "chevron-right",
    "chevron-down",
    "pause",
    "play",
    "check",
    "close",
    "link",
    "image",
    "download"
  ];
  expect(subset.sets.map(set => set.id)).toEqual(["material-symbols", "mdi", "tabler", "lucide", "ph"]);
  for (const set of subset.sets) {
    expect(Object.keys(set.icons).sort(), set.id).toEqual([...names].sort());
    expect(set.license, set.id).toBeTruthy();
    expect(set.author, set.id).toBeTruthy();
    // Each set has its own grid (24 for most, 256 for Phosphor)
    expect(set.viewBox, set.id).toMatch(/^0 0 \d+ \d+$/);
    // A set that has other weights has them for every icon, and drawn differently from the regular one
    for (const [weight, icons] of Object.entries(set.weights || {})) {
      expect(["light", "bold"], `${set.id} ${weight}`).toContain(weight);
      expect(Object.keys(icons).sort(), `${set.id} ${weight}`).toEqual([...names].sort());
      for (const name of names) expect(icons[name], `${set.id} ${weight} ${name}`).not.toBe(set.icons[name]);
    }
  }
});

test("the icons of the default set are drawn, and the close buttons get theirs", async ({ page }) => {
  await openPage(page);
  await expect(page.locator("html")).toHaveAttribute("data-icons", subset.default);
  await expect(themeButton(page).locator("svg")).toHaveCount(1);
  await expect(page.locator("#shareDialog .privacy-close svg")).toHaveCount(1);
});

test("?icons= chooses the set, and an unknown one is ignored", async ({ page }) => {
  await openPage(page, "/index-better.html", "?icons=lucide");
  await expect(page.locator("html")).toHaveAttribute("data-icons", "lucide");
  // Lucide draws with strokes, the Material sets with fills
  await expect(themeButton(page).locator("svg path").first()).toHaveAttribute("stroke", "currentColor");
  await page.goto(`${staticRepositoryUrl}/index-better.html?icons=mdi`);
  await expect(themeButton(page).locator("svg path").first()).toHaveAttribute("fill", "currentColor");
  await page.goto(`${staticRepositoryUrl}/index-better.html?icons=nope`);
  await expect(page.locator("html")).toHaveAttribute("data-icons", subset.default);
});

test("the set is chosen in the panel and kept", async ({ page }) => {
  await openPage(page);
  const before = await themeButton(page).innerHTML();
  await themeButton(page).click();
  await page.locator('[data-panel-section="page"] > .panel-section-title').click();
  await page.getByLabel("Icons", { exact: true }).selectOption("tabler");
  await expect(page.locator("html")).toHaveAttribute("data-icons", "tabler");
  expect(await themeButton(page).innerHTML()).not.toBe(before);
  expect(await page.evaluate(() => window.localStorage.getItem("librespeed-better-icons"))).toBe("tabler");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-icons", "tabler");
});

test("the arrow of the selects and the caret have a color in high contrast", async ({ page }) => {
  await openPage(page, "/stability-better.html");
  await expect(page.locator("html")).toHaveAttribute("data-icons", subset.default);
  const variables = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      arrow: style.getPropertyValue("--icon-select-arrow"),
      contrast: style.getPropertyValue("--icon-select-arrow-contrast"),
      caret: style.getPropertyValue("--icon-chevron-down")
    };
  });
  expect(variables.arrow).toContain("%23808080");
  expect(variables.contrast).toContain("%23facc15");
  expect(variables.caret).toContain("data:image/svg+xml");
});

test("nothing is asked of another server for the icons", async ({ page }) => {
  const outside = [];
  page.on("request", request => {
    if (!request.url().startsWith(staticRepositoryUrl) && !request.url().startsWith("data:"))
      outside.push(request.url());
  });
  await openPage(page);
  await expect(page.locator("html")).toHaveAttribute("data-icons", subset.default);
  expect(outside.filter(url => /iconify|unpkg|jsdelivr|cdn/i.test(url))).toEqual([]);
});

test("without the file the page still works and the icon option is not shown", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/icons/subset.json", route => route.abort());
  await openPage(page);
  await themeButton(page).click();
  await expect(page.locator(".panel-box")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-icons", /.+/);
  await expect(page.locator('[data-panel-item="icons"]')).toBeHidden();
  // The close button keeps the sign it has in the page
  await expect(page.locator("#shareDialog .privacy-close")).toHaveText("×");
  expect(errors).toEqual([]);
});

// The first path of the drawing of an icon of a set, and the same on the page: the theme button shows the moon in the
// light mode
function pathOf(body) {
  return /\sd="([^"]+)"/.exec(body)[1];
}

function moonOf(setId, weight) {
  const set = subset.sets.find(entry => entry.id === setId);
  return pathOf(weight && set.weights && set.weights[weight] ? set.weights[weight].moon : set.icons.moon);
}

async function drawnPath(page) {
  return themeButton(page).locator("svg path").first().getAttribute("d");
}

test("?weight= picks the light, regular or bold drawing of a set that has them", async ({ page }) => {
  await openPage(page, "/index-better.html", "?theme=light&icons=ph&weight=bold");
  await expect(page.locator("html")).toHaveAttribute("data-icons-weight", "bold");
  expect(await drawnPath(page)).toBe(moonOf("ph", "bold"));
  await page.goto(`${staticRepositoryUrl}/index-better.html?theme=light&icons=ph&weight=light`);
  await expect(page.locator("html")).toHaveAttribute("data-icons-weight", "light");
  expect(await drawnPath(page)).toBe(moonOf("ph", "light"));
  await page.goto(`${staticRepositoryUrl}/index-better.html?theme=light&icons=ph`);
  await expect(page.locator("html")).toHaveAttribute("data-icons-weight", "regular");
  expect(await drawnPath(page)).toBe(moonOf("ph", "regular"));
  expect(moonOf("ph", "bold")).not.toBe(moonOf("ph", "regular"));
});

test("a set without the weight is drawn in regular, and an unknown weight is ignored", async ({ page }) => {
  for (const id of ["material-symbols", "mdi", "tabler", "lucide"]) {
    await page.goto(`${staticRepositoryUrl}/index-better.html?theme=light&icons=${id}&weight=bold`);
    await expect(page.locator("html")).toHaveAttribute("data-icons", id);
    // The weight asked for is kept on <html>, but the drawing is the regular one
    expect(await drawnPath(page), id).toBe(moonOf(id));
  }
  await page.goto(`${staticRepositoryUrl}/index-better.html?theme=light&icons=ph&weight=heavy`);
  await expect(page.locator("html")).toHaveAttribute("data-icons-weight", "regular");
  expect(await drawnPath(page)).toBe(moonOf("ph", "regular"));
});
