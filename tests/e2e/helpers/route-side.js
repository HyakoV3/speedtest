const { expect } = require("@playwright/test");

// The way back lives in a panel at the side of the route page: open it (once) and wait for the card that is in it
async function openBackPanel(page) {
  const card = page.locator("#routeBack");
  if (await card.isVisible()) return;
  const toggle = page.locator("#routeSideToggle");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(card).toBeVisible();
}

// The small selector over the results, when there are two routes to choose from
async function showRoute(page, way) {
  const button = page.locator(`[data-shown="${way}"]`);
  await expect(button).toBeVisible();
  await button.click();
}

module.exports = { openBackPanel, showRoute };
