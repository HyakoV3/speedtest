const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));
const sample = name => fs.readFileSync(path.join(__dirname, "..", "fixtures", "route-back", name), "utf8");
const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };

const hop = (ttl, country, rtt, number, name) => ({
  ttl,
  ip: `198.51.100.${ttl}`,
  alt_ips: [],
  rtt_min: rtt,
  rtt_avg: rtt,
  sent: 3,
  answered: 3,
  flags: [],
  scope: "public",
  asn: `AS${number}`,
  as_name: name,
  country,
  continent: "NA",
  country_doubt: false,
  is_target: false
});
const THERE = {
  ...fixture("normal"),
  pmtu: null,
  pmtu_drops: [],
  target_reached: false,
  target_country: "BR",
  hops: [hop(1, "US", 1, 394151, "Whatbox"), hop(2, "BR", 115, 174, "Cogent"), hop(3, "BR", 120, 13786, "Seabras")]
};
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

async function openRoute(page, base = staticRepositoryUrl) {
  await page.route("**/backend/route.php*", route => {
    if (route.request().method() === "POST") return route.fulfill({ json: THERE });
    return route.fulfill({ json: CAPS });
  });
  await page.route("**/backend/route_enrich.php", route =>
    route.fulfill({ json: ENRICH(JSON.parse(route.request().postData())) })
  );
  await page.goto(`${base}/route-better.html`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
}
const goBack = async page => {
  await expect(page.locator("#routeDirection")).toBeVisible();
  await page.locator('[data-direction="back"]').click();
  await expect(page.locator("#routeBack")).toBeVisible();
};

test("P1 the wait is told as up to two minutes, in the four languages: a tracert to a silent host takes about 90 s", async ({
  page
}) => {
  await openRoute(page);
  await goBack(page);
  const wait = page.locator('#routeBack [data-i18n="route.back.wait"]');
  const texts = {
    en: "It can take up to two minutes.",
    pt: "Pode levar até dois minutos.",
    es: "Puede tardar hasta dos minutos.",
    sv: "Det kan ta upp till två minuter."
  };
  for (const [language, text] of Object.entries(texts)) {
    await page.evaluate(code => window.LibreSpeedI18n.set(code, false), language);
    await expect(wait).toHaveText(text);
  }
});

test("P2 a name of the server that a command cannot take says why there is no command", async ({ page }) => {
  // "$" is a character that a host name of a URL can have and the command does not take. The name does not resolve, so the
  // requests for it are answered with the files of the test server
  await page.route(/^http:\/\/a\$b\.localhost:18184\//, async route => {
    const response = await route.fetch({ url: route.request().url().replace("a$b.localhost", "127.0.0.1") });
    await route.fulfill({ response });
  });
  await openRoute(page, "http://a$b.localhost:18184");
  await goBack(page);
  await expect(page.locator("#routeBackCommand")).toHaveText("");
  await expect(page.locator("#routeBackCopy")).toBeDisabled();
  await expect(page.locator("#routeBackNoCommand")).toBeVisible();
  await expect(page.locator("#routeBackNoCommand")).toContainText("No command is shown");
  await page.evaluate(() => window.LibreSpeedI18n.set("pt", false));
  await expect(page.locator("#routeBackNoCommand")).toContainText("Nenhum comando é mostrado");
  // The other host: the command is there and the note is not
  const other = await page.context().newPage();
  await openRoute(other);
  await goBack(other);
  await expect(other.locator("#routeBackCommand")).not.toHaveText("");
  await expect(other.locator("#routeBackNoCommand")).toBeHidden();
});

test("P3 a network that is only in one direction is told to a screen reader too, not only by the mark", async ({
  page
}) => {
  await openRoute(page);
  await page.locator("#routeStart").click();
  await expect(page.locator("#routeTable tbody tr")).toHaveCount(THERE.hops.length);
  await goBack(page);
  await page.locator("#routeBackText").fill(sample("windows-ptbr-tracert.txt"));
  await page.locator("#routeBackShow").click();
  await expect(page.locator(".route-compare-only")).not.toHaveCount(0);
  const only = page.locator(".route-compare-only").first();
  // The picture is hidden from the screen reader and the words are not
  await expect(only.locator(".route-compare-mark")).toHaveAttribute("aria-hidden", "true");
  await expect(only.locator(".route-visually-hidden")).toHaveText(" (only in this direction)");
  expect(await only.evaluate(item => item.getAttribute("aria-hidden"))).toBeNull();
  // The networks that are in both have no such words
  const both = await page.locator("#routeCompareLists li:not(.route-compare-only)").count();
  const words = await page.locator("#routeCompareLists .route-visually-hidden").count();
  expect(words).toBe(await page.locator(".route-compare-only").count());
  expect(both + words).toBeGreaterThan(0);
  // In another language
  await page.evaluate(() => window.LibreSpeedI18n.set("pt", false));
  await expect(page.locator(".route-compare-only .route-visually-hidden").first()).toHaveText(" (só neste sentido)");
});
