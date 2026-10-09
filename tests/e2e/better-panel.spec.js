const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

async function openPanel(page, path, query = "") {
  await page.route("**/server-list.json*", route => route.fulfill({ json: [] }));
  await page.goto(`${staticRepositoryUrl}${path}${query}`);
  await page.locator(".panel-button").click();
  await expect(page.locator(".panel-box")).toBeVisible();
}

// The sections are an accordion: the heading of a section is a button, and its options show while it is open
function heading(page, section) {
  return page.locator(`[data-panel-section="${section}"] > .panel-section-title`);
}

async function openSection(page, section) {
  if ((await heading(page, section).getAttribute("aria-expanded")) !== "true") await heading(page, section).click();
}

function sectionTitles(page) {
  return page.locator(".panel-main .panel-section-title");
}

function itemsOf(page, section) {
  return page.locator(`[data-panel-section="${section}"] > .panel-section-body > .panel-item`);
}

test("the panel of the speed test page has four sections in order, without the chart style", async ({ page }) => {
  await openPanel(page, "/index-better.html");
  await expect(sectionTitles(page)).toHaveText(["Appearance", "Page", "Accessibility", "Language"]);
  const ids = section => itemsOf(page, section).evaluateAll(nodes => nodes.map(node => node.dataset.panelItem));
  expect(await ids("appearance")).toEqual(["mode", "brand", "radius-button", "radius-card"]);
  expect(await ids("page")).toEqual(["icons", "background", "font", "footer"]);
  expect(await ids("accessibility")).toEqual(["text-size", "contrast"]);
  expect(await ids("language")).toEqual(["language"]);
  await expect(page.locator(".panel-main .panel-title")).toHaveText([
    "Mode",
    "Brand color",
    "Button rounding",
    "Box rounding",
    "Icons",
    "Background",
    "Font",
    "Footer style",
    "Text size"
  ]);
});

test("the stability page adds the chart style at the end of the page section", async ({ page }) => {
  await openPanel(page, "/stability-better.html");
  await expect(sectionTitles(page)).toHaveText(["Appearance", "Page", "Accessibility", "Language"]);
  const ids = await itemsOf(page, "page").evaluateAll(nodes => nodes.map(node => node.dataset.panelItem));
  expect(ids).toEqual(["icons", "background", "font", "footer", "chart"]);
});

test("one section is open at a time, and the first one is open at the start", async ({ page }) => {
  await openPanel(page, "/index-better.html");
  const states = () => sectionTitles(page).evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-expanded")));
  expect(await states()).toEqual(["true", "false", "false", "false"]);
  await expect(page.getByRole("radio", { name: "Light", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Sora" })).toBeHidden();

  await heading(page, "page").click();
  expect(await states()).toEqual(["false", "true", "false", "false"]);
  await expect(page.getByRole("radio", { name: "Sora" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Light", exact: true })).toBeHidden();

  // A click on the open section closes it, and every section can be closed
  await heading(page, "page").click();
  expect(await states()).toEqual(["false", "false", "false", "false"]);
});

test("the section that was open is open again after a reload", async ({ page }) => {
  await openPanel(page, "/index-better.html");
  await heading(page, "language").click();
  await page.reload();
  await page.locator(".panel-button").click();
  await expect(heading(page, "language")).toHaveAttribute("aria-expanded", "true");
  await expect(heading(page, "appearance")).toHaveAttribute("aria-expanded", "false");
});

test("the panel is short: only one section shows its options", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPanel(page, "/stability-better.html");
  for (const section of ["appearance", "page", "accessibility", "language"]) {
    await openSection(page, section);
    const height = await page.locator(".panel-main").evaluate(node => node.scrollHeight);
    expect(height).toBeLessThan(560);
  }
});

test("the sections are named groups for screen readers", async ({ page }) => {
  await openPanel(page, "/index-better.html");
  const appearance = page.getByRole("group", { name: "Appearance", exact: true });
  await expect(appearance.getByRole("radio", { name: "Light", exact: true })).toBeVisible();
  await openSection(page, "language");
  const language = page.getByRole("group", { name: "Language", exact: true });
  await expect(language.getByRole("radio", { name: "Español" })).toBeVisible();
  await expect(heading(page, "language")).toHaveAttribute("aria-controls", "panel-section-body-language");
});

test("the section headings follow the language of the page", async ({ page }) => {
  await openPanel(page, "/stability-better.html", "?lang=pt");
  await expect(sectionTitles(page)).toHaveText(["Aparência", "Página", "Acessibilidade", "Idioma"]);
  await page.goto(`${staticRepositoryUrl}/stability-better.html?lang=es`);
  await page.locator(".panel-button").click();
  await expect(sectionTitles(page)).toHaveText(["Apariencia", "Página", "Accesibilidad", "Idioma"]);
  await page.goto(`${staticRepositoryUrl}/stability-better.html?lang=sv`);
  await page.locator(".panel-button").click();
  await expect(sectionTitles(page)).toHaveText(["Utseende", "Sida", "Tillgänglighet", "Språk"]);
});

test("the packs of the background open in the second column while the page section is open", async ({ page }) => {
  await openPanel(page, "/index-better.html");
  await openSection(page, "page");
  await expect(page.locator(".panel-side")).toBeHidden();
  await page.getByRole("radio", { name: "Packs" }).click();
  await expect(page.locator(".panel-side")).toBeVisible();
  await expect(page.locator(".panel-side .panel-side-heading")).toHaveText("Background");
  await expect(page.locator(".panel-side .panel-title")).toHaveText(["Packs", "Show a new photo"]);

  // The second column belongs to the page section: it goes away with it and comes back with it
  await heading(page, "appearance").click();
  await expect(page.locator(".panel-side")).toBeHidden();
  await heading(page, "page").click();
  await expect(page.locator(".panel-side")).toBeVisible();

  await page.getByRole("radio", { name: "None" }).click();
  await expect(page.locator(".panel-side")).toBeHidden();
});

test("high contrast hides the appearance section and keeps the others", async ({ page }) => {
  await openPanel(page, "/index-better.html");
  await openSection(page, "accessibility");
  await page.getByRole("button", { name: "High contrast" }).click();
  await expect(page.locator('[data-panel-section="appearance"]')).toBeHidden();
  await expect(page.locator('[data-panel-section="page"]')).toBeVisible();
  await expect(page.locator('[data-panel-section="page"]')).toHaveCSS("border-top-width", "0px");
});
