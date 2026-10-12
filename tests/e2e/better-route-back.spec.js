const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { openBackPanel, showRoute } = require("./helpers/route-side");

const staticRepositoryUrl = "http://127.0.0.1:18184";

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `route-${name}.json`), "utf8"));
const sample = name => fs.readFileSync(path.join(__dirname, "..", "fixtures", "route-back", name), "utf8");

const CAPS = { v: 1, enabled: true, ipv6: false, window_s: 60 };
const KEY = "librespeed-better-route-direction";
const SIDE = "librespeed-better-route-side";

// The networks that the test gives to the routers: by the last number of the address ("9.9.9.<n>" is AS<n>)
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

// Opens the route page with route.php and route_enrich.php answered by the test. Everything the page asks is noted.
async function openRoute(page, { post = fixture("normal"), enrich = ENRICH, query = "", caps = CAPS } = {}) {
  const seen = { requests: [], enrich: [] };
  page.on("request", request => seen.requests.push(request.url()));
  await page.route("**/backend/route.php*", route => {
    if (route.request().method() === "POST")
      return typeof post === "function" ? post(route) : route.fulfill({ json: post });
    return route.fulfill({ json: caps });
  });
  await page.route("**/backend/route_enrich.php", route => {
    const body = JSON.parse(route.request().postData());
    seen.enrich.push(body);
    if (typeof enrich === "number") return route.fulfill({ status: enrich, json: { error: "x" } });
    return route.fulfill({ json: enrich(body) });
  });
  await page.goto(`${staticRepositoryUrl}/route-better.html${query}`);
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await page.evaluate(() => window.LibreSpeedI18n.ready);
  return seen;
}

const goBack = openBackPanel;
const paste = async (page, text) => {
  await page.locator("#routeBackText").fill(text);
  await page.locator("#routeBackShow").click();
};
const rows = page => page.locator("#routeTable tbody tr");

test("the panel of the way back is only there when the server can trace routes, and the page starts at 'Server → you'", async ({
  page
}) => {
  await openRoute(page, { caps: { v: 1, enabled: false } });
  await expect(page.locator("#routeStatus")).toContainText("not available");
  await expect(page.locator("#routeSideToggle")).toBeHidden();
  await expect(page.locator("#routeSide")).toBeHidden();
  const other = await page.context().newPage();
  await openRoute(other);
  await expect(other.locator("#routeSideToggle")).toBeVisible();
  // The panel is closed, and the selector of the two routes is not there while there is only one
  await expect(other.locator("#routeSide")).toBeHidden();
  await expect(other.locator("#routeTableBoth")).toBeHidden();
  await expect(other.locator("#routeStart")).toBeVisible();
});

test("the tracert of a Portuguese Windows is drawn: a line for each hop, the silent one told, the server marked", async ({
  page
}) => {
  const seen = await openRoute(page);
  await goBack(page);
  // Start is on the page while the panel is open: the way from the server can be traced at any time
  await expect(page.locator("#routeStart")).toBeVisible();
  await paste(page, sample("windows-ptbr-tracert.txt"));
  await expect(rows(page)).toHaveCount(7);
  await expect(rows(page).nth(2)).toHaveClass(/hop-none/);
  await expect(rows(page).nth(2)).toContainText("no reply");
  await expect(rows(page).nth(6).locator(".route-you")).toHaveText("server");
  await expect(page.locator("#routeTable caption")).toHaveText("Hops from you to this server");
  await expect(page.locator("#routeStatHops")).toHaveText("7");
  await expect(page.locator("#routeEnd")).toContainText("The server answered.");
  // The route was measured by the visitor, and the page says so; there is no MTU of the way back
  await expect(page.locator("#routeMtu")).toContainText("tracert");
  await expect(page.locator("#routeMtu")).toContainText("did not measure it");
  await expect(page.locator("#routeMtu")).not.toContainText("MTU");
  // The networks and the countries of the answer are in the table
  await expect(rows(page).nth(6)).toContainText("Net 8");
  await expect(rows(page).nth(4)).toContainText("Brazil");
  // The name of the host that was traced is not the one of this page: it is told
  await expect(page.locator("#routeBackNotes")).toContainText("dns.google");
  expect(seen.enrich).toHaveLength(1);
});

test("only the public addresses of the routers are sent, to this server, and nothing else is asked", async ({
  page
}) => {
  const seen = await openRoute(page);
  await goBack(page);
  await paste(page, sample("windows-ptbr-tracert.txt"));
  await expect(rows(page)).toHaveCount(7);
  expect(seen.enrich).toHaveLength(1);
  const body = seen.enrich[0];
  expect(body.target).toBe("8.8.8.8");
  expect(body.hops.map(hop => hop.ip)).toEqual(["187.16.208.188", "72.14.208.80", "8.8.8.8"]);
  expect(JSON.stringify(body)).not.toMatch(/192\.168|10\.20|100\.64/);
  // Every request went to the origin of the page
  for (const url of seen.requests) expect(url.startsWith(staticRepositoryUrl)).toBe(true);
  const posts = seen.requests.filter(url => url.includes("route_enrich.php"));
  expect(posts).toHaveLength(1);
});

test("the text that is pasted is only text: a script in the name of the host does nothing", async ({ page }) => {
  await openRoute(page);
  await goBack(page);
  const before = await page.locator("img").count();
  await paste(
    page,
    "traceroute to <img/src=x/onerror=window.__x=1> (9.9.9.9), 30 hops max\n 1  <img/src=x/onerror=window.__x=2>  9.9.9.9  1.0 ms  1.1 ms  1.2 ms"
  );
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator("#routeBackNotes")).toContainText("<img/src=x/onerror=window.__x=1>");
  expect(await page.locator("img").count()).toBe(before);
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
});

test("a text that is not a route says so, and an empty one asks for the output; neither draws or sends anything", async ({
  page
}) => {
  const seen = await openRoute(page);
  await goBack(page);
  await paste(page, "");
  await expect(page.locator("#routeBackNotes")).toContainText("Paste the output of the command first.");
  await paste(page, "hello, this is not a route");
  await expect(page.locator("#routeBackNotes")).toContainText("does not look like the output");
  await page.locator("#routeBackText").evaluate(box => {
    box.removeAttribute("maxlength");
    box.value = "x".repeat(40000);
  });
  await page.locator("#routeBackShow").click();
  await expect(page.locator("#routeBackNotes")).toContainText("too long");
  await expect(rows(page)).toHaveCount(0);
  expect(seen.enrich).toHaveLength(0);
});

test("when the networks cannot be looked up the route is still drawn, and it says so", async ({ page }) => {
  await openRoute(page, { enrich: 500 });
  await goBack(page);
  await paste(page, sample("linux-traceroute-names.txt"));
  await expect(rows(page)).toHaveCount(10);
  await expect(page.locator("#routeBackNotes")).toContainText("could not be looked up");
  await expect(rows(page).nth(9)).toContainText("72.14.208.80");
});

test("each route keeps its own, the panel is remembered for the next visit, and nothing is traced by the change", async ({
  page
}) => {
  const seen = await openRoute(page);
  await expect(page.locator("#routeStart")).toBeEnabled();
  await page.locator("#routeStart").click();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  await goBack(page);
  // Opening the panel changes nothing on the screen: the route from the server is still there, and there is nothing to choose between yet
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  await expect(page.locator("#routeTableBoth")).toBeHidden();
  // A route pasted in the panel is shown at once, and now there are two to choose from
  await paste(page, sample("linux-traceroute-n.txt"));
  await expect(rows(page)).toHaveCount(11);
  await expect(page.locator("#routeTableBoth")).toBeVisible();
  await expect(page.locator('[data-shown="back"]:visible').first()).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(key => localStorage.getItem(key), SIDE)).toBe("open");
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
  await showRoute(page, "there");
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  await expect(page.locator("#routeTable caption")).toHaveText("Hops from this server to you");
  // The panel stays open: it is not a dialog
  await expect(page.locator("#routeBack")).toBeVisible();
  await showRoute(page, "back");
  await expect(rows(page)).toHaveCount(11);
  expect(seen.enrich).toHaveLength(1);
  // The next visit opens the panel again (on a wide screen), and no route
  await page.reload();
  await page.waitForFunction(() => !!window.LibreSpeedI18n);
  await expect(page.locator("#routeBack")).toBeVisible();
  await expect(page.locator("#routeTableBoth")).toBeHidden();
});

test("the commands carry the host of the page and the IP version of the route from the server, and can be copied", async ({
  page,
  context
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openRoute(page, { post: fixture("v6") });
  await page.locator("#routeStart").click();
  await expect(rows(page).first()).toBeVisible();
  await goBack(page);
  await page.locator('[data-system="windows"]').click();
  await expect(page.locator("#routeBackCommand")).toHaveText("tracert -d -h 30 -w 1000 -6 127.0.0.1");
  await page.locator('[data-system="macos"]').click();
  await expect(page.locator("#routeBackCommand")).toHaveText("traceroute6 -n -m 30 127.0.0.1");
  await page.locator('[data-system="linux"]').click();
  await expect(page.locator("#routeBackCommand")).toHaveText("traceroute -n -m 30 -w 1 -6 127.0.0.1");
  await expect(page.locator("#routeBackAltCommand")).toHaveText("tracepath -n -6 127.0.0.1");
  await page.locator("#routeBackCopy").click();
  await expect(page.locator("#routeBackCopy")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("traceroute -n -m 30 -w 1 -6 127.0.0.1");
});

test("the commands that are built are safe: a host that cannot be written in a command gives none", async ({
  page
}) => {
  await openRoute(page);
  const build = (system, host, family) =>
    page.evaluate(([s, h, f]) => window.LibreSpeedRouteBack.commands(s, h, f), [system, host, family]);
  expect(await build("linux", "speed.example.com", null)).toEqual({
    main: "traceroute -n -m 30 -w 1 speed.example.com",
    alt: "tracepath -n speed.example.com"
  });
  expect(await build("windows", "[2001:db8::1]", 6)).toEqual({
    main: "tracert -d -h 30 -w 1000 -6 2001:db8::1",
    alt: null
  });
  for (const host of ["a b", "a;b", "a$(x)", "a`x`", "-oProxy", "a&b", "a|b", "", "a\nb", "a'b", 'a"b'])
    expect(await build("linux", host, null), host).toBeNull();
  const systems = await page.evaluate(() => [
    window.LibreSpeedRouteBack.detect("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32"),
    window.LibreSpeedRouteBack.detect("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel"),
    window.LibreSpeedRouteBack.detect("Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64"),
    window.LibreSpeedRouteBack.detect("Mozilla/5.0 (Linux; Android 14; Pixel) Mobile", "Linux armv8l"),
    window.LibreSpeedRouteBack.detect("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile", "iPhone")
  ]);
  expect(systems).toEqual([
    { system: "windows", mobile: false },
    { system: "macos", mobile: false },
    { system: "linux", mobile: false },
    { system: "linux", mobile: true },
    { system: "macos", mobile: true }
  ]);
});

test("the answer of the server is not trusted: what is not a network or a country is not shown", async ({ page }) => {
  await openRoute(page, {
    enrich: body => ({
      v: 1,
      hops: body.hops.map(hop => ({
        ttl: hop.ttl,
        asn: "<img src=x onerror=window.__y=1>",
        as_name: "x".repeat(300),
        country: "<b>",
        country_doubt: "yes"
      })),
      target_as: { asn: "AS1; drop", as_name: "x" },
      target_country: "usa"
    })
  });
  await goBack(page);
  await paste(page, sample("linux-traceroute-names.txt"));
  await expect(rows(page)).toHaveCount(10);
  await expect(rows(page).nth(9)).toContainText("not in the database");
  expect(await page.locator("#routeTable img, #routeTable b").count()).toBe(0);
  expect(await page.evaluate(() => window.__y)).toBeUndefined();
});

test("a narrow screen: nothing scrolls sideways and the commands break inside their box", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openRoute(page);
  await goBack(page);
  await paste(page, sample("windows-ptbr-tracert.txt"));
  await expect(rows(page)).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  // On a phone the sheet goes down when the route is drawn: it is opened again to see the command
  await expect(page.locator("#routeSide")).toBeHidden();
  await goBack(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const box = await page.locator("#routeBackCommand").boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(360);
});

test("the four languages: the way back is drawn again with their texts, and no key shows", async ({ page }) => {
  await openRoute(page);
  await page.locator("#routeStart").click();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  await goBack(page);
  await paste(page, sample("windows-ptbr-tracert.txt"));
  await expect(rows(page)).toHaveCount(7);
  const texts = { pt: "Você → servidor", es: "Tú → servidor", sv: "Du → servern", en: "You → server" };
  for (const lang of ["pt", "es", "sv", "en"]) {
    await page.evaluate(code => window.LibreSpeedI18n.set(code, false), lang);
    await expect(page.locator('[data-shown="back"]:visible').first()).toHaveText(texts[lang]);
    await expect(page.locator("#routeArea")).not.toContainText("route.back.");
    await expect(page.locator("#routeArea")).not.toContainText("route.compare.");
    await expect(page.locator("#routeArea")).not.toContainText("route.server");
    await expect(page.locator("#routeMtu")).not.toContainText("{tool}");
  }
});

test("the other route can be chosen again after a paste, and the panel stays where it is", async ({ page }) => {
  await openRoute(page);
  await page.locator("#routeStart").click();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  await goBack(page);
  await paste(page, sample("linux-traceroute-n.txt"));
  await expect(rows(page)).toHaveCount(11);
  await showRoute(page, "there");
  await expect(page.locator("#routeBack")).toBeVisible();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
});

// The comparison of the networks of the two directions
const hop = (ttl, asn, extra = {}) => ({
  ttl,
  ip: `9.9.9.${ttl}`,
  alt_ips: [],
  rtt_min: ttl,
  rtt_avg: ttl,
  sent: 3,
  answered: 3,
  flags: [],
  scope: "public",
  asn: asn ? `AS${asn}` : null,
  as_name: asn ? `Net ${asn}` : null,
  country: "BR",
  country_doubt: false,
  is_target: false,
  ...extra
});
const route = (family, asns, targetLast = true) => ({
  v: 1,
  family,
  hops: asns.map((asn, index) =>
    hop(index + 1, asn, targetLast && index === asns.length - 1 ? { is_target: true } : {})
  )
});

test("compareDirections: eight cases, with the way back read from its end", async ({ page }) => {
  await openRoute(page);
  const compare = (there, back) =>
    page.evaluate(([a, b]) => window.LibreSpeedRouteView.compareDirections(a, b), [there, back]);
  const there = route(4, [1, 2, 3, 3, 4, 99]);
  expect((await compare(there, null)).state).toBe("need-both");
  expect((await compare(null, there)).state).toBe("need-both");
  expect(await compare(there, route(6, [4, 3, 2, 1, 99]))).toMatchObject({ state: "family", a: 4, b: 6 });
  expect((await compare(route(4, [1, 99]), route(4, [1, 2, 99]))).state).toBe("unknown");
  // The same networks, the way back from its end: 4 3 2 1 is 1 2 3 4 read backwards; the same network twice in a row counts once (ECMP)
  expect((await compare(there, route(4, [4, 4, 3, 2, 2, 1, 99]))).state).toBe("same");
  expect((await compare(there, route(4, [4, 2, 3, 1, 99]))).state).toBe("order");
  const different = await compare(there, route(4, [4, 3, 7, 1, 99]));
  expect(different).toMatchObject({ state: "different", onlyThere: ["AS2"], onlyBack: ["AS7"] });
  // The end of each route (the visitor, the server) is not one of the networks; a router with no network is not either
  expect((await compare(route(4, [1, 2, 3, null, 4, 99]), route(4, [4, 3, 2, 1, 99]))).state).toBe("same");
  expect(await page.evaluate(r => window.LibreSpeedRouteView.asPath(r), route(4, [1, 2, 99]))).toEqual(["AS1", "AS2"]);
});

test("the comparison is on the page: the networks of one direction only are marked, in words too", async ({ page }) => {
  // The way from the server goes through 12, 13 and 14; the pasted one goes (read from its end) through 12, 99 and 14
  const there = {
    ...fixture("normal"),
    hops: [hop(1, 12), hop(2, 13), hop(3, 14), hop(4, 15, { is_target: true })]
  };
  await openRoute(page, { post: there });
  await page.locator("#routeStart").click();
  await expect(rows(page)).toHaveCount(4);
  // With only the way from the server there is nothing to compare
  await expect(page.locator("#routeCompare")).toBeHidden();
  await goBack(page);
  // Before the way back is pasted, nothing is told
  await expect(page.locator("#routeCompare")).toBeHidden();
  await paste(
    page,
    "traceroute to 9.9.9.9 (9.9.9.9), 30 hops max\n 1  9.9.9.14  1 ms\n 2  9.9.9.99  2 ms\n 3  9.9.9.12  3 ms\n 4  9.9.9.9  4 ms"
  );
  await expect(page.locator("#routeCompare")).toBeVisible();
  await expect(page.locator("#routeCompareText")).toContainText("different networks");
  await expect(page.locator("#routeCompareText")).toContainText("Only on the way to you: AS13 Net 13");
  await expect(page.locator("#routeCompareText")).toContainText("Only on the way to the server: AS99 Net 99");
  await expect(page.locator(".route-compare-only")).toHaveCount(2);
  await expect(page.locator(".route-compare-lists li")).toHaveCount(6);
  // The way from the server shows it too
  await showRoute(page, "there");
  await expect(page.locator("#routeCompare")).toBeVisible();
});

test("the way back alone: the page tells how to compare", async ({ page }) => {
  await openRoute(page);
  await goBack(page);
  await paste(page, sample("linux-traceroute-n.txt"));
  await expect(rows(page)).toHaveCount(11);
  await expect(page.locator("#routeCompareText")).toContainText("Trace the route from the server");
  await expect(page.locator(".route-compare-lists li")).toHaveCount(0);
});

test("the chart and the map draw the way back, with 'server' where the visitor was", async ({ page }) => {
  await openRoute(page);
  await page.locator("#routeStart").click();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  await goBack(page);
  await paste(page, sample("windows-ptbr-tracert.txt"));
  await expect(rows(page)).toHaveCount(7);
  await page.locator('[data-view="chart"]').click();
  await expect(page.locator("#routeChartHost canvas")).toBeVisible();
  await expect(page.locator('#routeChart li[data-key="you"]')).toContainText("server");
  await page.locator('[data-view="map"]').click();
  await expect(page.locator("#routeMapHost svg")).toBeVisible();
  await showRoute(page, "there");
  await page.locator('[data-view="chart"]').click();
  await expect(page.locator('#routeChart li[data-key="you"]')).toContainText("you");
  await expect(page.locator('#routeChart li[data-key="you"]')).not.toContainText("server");
});

test("while a route is traced the route shown cannot be changed, and it can after", async ({ page }) => {
  let release;
  let calls = 0;
  const wait = new Promise(resolve => {
    release = resolve;
  });
  await openRoute(page, {
    post: async route => {
      // The first trace answers at once (so that there are two routes to choose between), the second waits
      if (++calls > 1) await wait;
      await route.fulfill({ json: fixture("normal") });
    }
  });
  await expect(page.locator("#routeStart")).toBeEnabled();
  await page.locator("#routeStart").click();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  await goBack(page);
  await paste(page, sample("linux-traceroute-n.txt"));
  await expect(rows(page)).toHaveCount(11);
  await expect(page.locator("#routeTableBoth")).toBeVisible();
  await expect(page.locator("#routeStart")).toBeEnabled();
  await page.locator("#routeStart").click();
  // The results are blank while the route is traced, and the directions are not offered
  await expect(page.locator("#routeStatus")).toContainText("Tracing");
  await expect(page.locator('[data-shown="back"]:visible')).toHaveCount(0);
  await expect(page.locator('[data-shown="there"]:visible')).toHaveCount(0);
  release();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  await expect(page.locator('[data-shown="back"]:visible').first()).toBeEnabled();
  await expect(page.locator('[data-shown="there"]:visible').first()).toHaveAttribute("aria-pressed", "true");
});

test("the strip of a saved route is not over the way back", async ({ page }) => {
  const data = fixture("normal");
  const old = {
    t: Date.parse("2026-10-01T12:00:00Z"),
    f: 4,
    hops: 13,
    nets: 4,
    ms: 16.9,
    mtu: 1480,
    reached: true,
    as: "AS64500",
    path: "AS3356>AS15169",
    changed: null,
    jump: null
  };
  await page.addInitScript(
    ([entry, summary]) => {
      if (window.sessionStorage.getItem("__seeded")) return;
      window.sessionStorage.setItem("__seeded", "1");
      window.localStorage.setItem("librespeed-better-route-history", JSON.stringify([entry]));
      window.localStorage.setItem("librespeed-better-route-history-summary", JSON.stringify({ v: 1, rows: [summary] }));
    },
    [{ ...old, data }, old]
  );
  await openRoute(page);
  await expect(page.locator("#routeStart")).toBeEnabled();
  await page.locator("#routeStart").click();
  await expect(rows(page)).toHaveCount(data.hops.length);
  await page.locator("#historyList .history-panel").nth(1).locator(".history-action-btn").click();
  await expect(page.locator("#routeShowing")).toBeVisible();
  await goBack(page);
  await paste(page, sample("linux-traceroute-n.txt"));
  await expect(rows(page)).toHaveCount(11);
  await expect(page.locator("#routeShowing")).toBeHidden();
  await showRoute(page, "there");
  await expect(page.locator("#routeShowing")).toBeVisible();
});

test("whether the server answered: said when the text tells it, and said that the text does not when it does not", async ({
  page
}) => {
  await openRoute(page);
  await goBack(page);
  // tracepath: "reached" in the last line
  await paste(page, sample("linux-tracepath-reached.txt"));
  await expect(page.locator("#routeEnd")).toContainText("The server answered.");
  await expect(page.locator(".route-you")).toHaveText("server");
  // mtr that ends in "???": the router that answered last is not the server
  await paste(page, sample("mtr-unreached.txt"));
  await expect(page.locator("#routeEnd")).toContainText("did not answer the last probes");
  await expect(page.locator(".route-you")).toHaveCount(0);
  // Only the lines of the hops: the page does not say it did not answer
  await paste(page, sample("windows-ptbr-tracert-lines-only.txt"));
  await expect(page.locator("#routeEnd")).toContainText("does not say whether the server answered");
  await expect(page.locator(".route-you")).toHaveCount(0);
  await expect(page.locator("#routeEnd")).not.toContainText("did not answer");
});

test("the warning about another host is for a name that is not this one, and not for an address, a name of this page or the app", async ({
  page
}) => {
  await openRoute(page);
  await goBack(page);
  await paste(page, sample("macos-traceroute-multi.txt"));
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator("#routeBackNotes")).toContainText("dns.example.net");
  await paste(page, sample("linux-traceroute-n.txt"));
  await expect(rows(page)).toHaveCount(11);
  await expect(page.locator("#routeBackNotes")).not.toContainText("was traced to");
  await paste(page, "traceroute to 127.0.0.1 (127.0.0.1), 30 hops max\n 1  9.9.9.9  1.0 ms  1.1 ms  1.2 ms");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator("#routeBackNotes")).not.toContainText("was traced to");
  await paste(page, fs.readFileSync(path.join(__dirname, "..", "fixtures", "route-back", "lsr1.txt"), "utf8").trim());
  await expect(page.locator("#routeBackNotes")).not.toContainText("was traced to");
});

test("pressing the button twice, or again with the same text, asks the server once and keeps the networks", async ({
  page
}) => {
  const seen = await openRoute(page);
  await goBack(page);
  await page.locator("#routeBackText").fill(sample("linux-traceroute-names.txt"));
  await page.locator("#routeBackShow").dblclick();
  await expect(rows(page).nth(9)).toContainText("Net 80");
  await page.locator("#routeBackShow").click();
  await expect(rows(page).nth(9)).toContainText("Net 80");
  await expect(page.locator("#routeBackNotes")).not.toContainText("could not be looked up");
  expect(seen.enrich).toHaveLength(1);
});

test("when the server says to wait, the page asks once more and the networks arrive", async ({ page }) => {
  const seen = await openRoute(page);
  await page.unroute("**/backend/route_enrich.php");
  await page.route("**/backend/route_enrich.php", route => {
    seen.enrich.push(JSON.parse(route.request().postData()));
    if (seen.enrich.length === 1) return route.fulfill({ status: 429, json: { error: "rate_client", retry_after: 1 } });
    return route.fulfill({ json: ENRICH(JSON.parse(route.request().postData())) });
  });
  await goBack(page);
  await paste(page, sample("linux-traceroute-names.txt"));
  await expect(rows(page)).toHaveCount(10);
  await expect(rows(page).nth(9)).toContainText("Net 80", { timeout: 10000 });
  expect(seen.enrich).toHaveLength(2);
  await expect(page.locator("#routeBackNotes")).not.toContainText("could not be looked up");
});

test("an answer that comes after Clear or after another text is not drawn", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const seen = await openRoute(page);
  await page.unroute("**/backend/route_enrich.php");
  await page.route("**/backend/route_enrich.php", async route => {
    seen.enrich.push(JSON.parse(route.request().postData()));
    await gate;
    await route.fulfill({ json: ENRICH(JSON.parse(route.request().postData())) });
  });
  await goBack(page);
  await paste(page, sample("linux-traceroute-names.txt"));
  await expect(rows(page)).toHaveCount(10);
  await page.locator("#routeBackClear").click();
  await expect(rows(page)).toHaveCount(0);
  release();
  await page.waitForTimeout(600);
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator("#routeSummary")).toBeHidden();
});

test("a text that is not a route leaves the route that is on the screen, and its networks still arrive", async ({
  page
}) => {
  await openRoute(page);
  await goBack(page);
  await paste(page, sample("linux-traceroute-names.txt"));
  await paste(page, "hello this is not a route");
  await expect(page.locator("#routeBackNotes")).toContainText("does not look like");
  await expect(rows(page)).toHaveCount(10);
  await expect(rows(page).nth(9)).toContainText("Net 80");
});

test("a country that is in doubt shows its question mark on the way back too", async ({ page }) => {
  await openRoute(page, {
    enrich: body => ({
      ...ENRICH(body),
      hops: ENRICH(body).hops.map((hop, index) => ({ ...hop, country_doubt: index === body.hops.length - 1 }))
    })
  });
  await goBack(page);
  await paste(page, sample("linux-traceroute-names.txt"));
  await expect(rows(page).nth(9).locator(".route-country")).toContainText("?");
  await expect(rows(page).nth(8).locator(".route-country")).not.toContainText("?");
});

test("choosing the route shown writes nothing, however many times the routes were drawn", async ({ page }) => {
  await openRoute(page);
  await page.locator("#routeStart").click();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  await goBack(page);
  await paste(page, sample("linux-traceroute-names.txt"));
  await expect(rows(page).nth(9)).toContainText("Net 80");
  await page.locator('[data-view="chart"]').click();
  await page.locator('[data-view="table"]').click();
  await page.evaluate(() => {
    window.__sets = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      window.__sets++;
      return original.call(this, key, value);
    };
  });
  await showRoute(page, "there");
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  expect(await page.evaluate(() => window.__sets)).toBe(0);
});

test("the line of status is there on the way back too: a chart that cannot be loaded is told", async ({ page }) => {
  await page.route("**/uPlot*", route => route.abort());
  await openRoute(page);
  await goBack(page);
  await paste(page, sample("linux-traceroute-names.txt"));
  await expect(rows(page)).toHaveCount(10);
  await page.locator('[data-view="chart"]').click();
  await expect(page.locator("#routeStatus")).toBeVisible();
  await expect(page.locator("#routeStatus")).toContainText("chart could not be loaded");
  // Start is there on the way back too: the route from the server can be traced at any time
  await expect(page.locator("#routeStart")).toBeVisible();
});

// The way back in the history
const HISTORY = "librespeed-better-route-history";
const SUMMARY = "librespeed-better-route-history-summary";
const stored = (page, key) => page.evaluate(name => JSON.parse(window.localStorage.getItem(name)), key);

test("the way back is saved only when the button is pressed, and only after its networks arrived", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const seen = await openRoute(page);
  await page.unroute("**/backend/route_enrich.php");
  await page.route("**/backend/route_enrich.php", async route => {
    seen.enrich.push(JSON.parse(route.request().postData()));
    await gate;
    await route.fulfill({ json: ENRICH(JSON.parse(route.request().postData())) });
  });
  await goBack(page);
  await expect(page.locator("#routeBackSave")).toBeDisabled();
  await paste(page, sample("linux-traceroute-names.txt"));
  await expect(rows(page)).toHaveCount(10);
  // Drawn, but the networks have not arrived: nothing to save yet, and nothing saved
  await expect(page.locator("#routeBackSave")).toBeDisabled();
  release();
  await expect(rows(page).nth(9)).toContainText("Net 80");
  await expect(page.locator("#routeBackSave")).toBeEnabled();
  expect(await stored(page, HISTORY)).toBeNull();
  await page.locator("#routeBackSave").click();
  await expect(page.locator("#routeBackSave")).toBeDisabled();
  await expect(page.locator("#routeBackSave")).toHaveText("Saved to history");
  const entries = await stored(page, HISTORY);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ d: "b", f: 4, hops: 10, reached: false });
  expect(entries[0].data).toMatchObject({ direction: "client_to_server", tool: "traceroute" });
  // The network of the visitor is the one of its first public router; the summary has no address
  expect(entries[0].as).toBe("AS80");
  const summary = await stored(page, SUMMARY);
  expect(summary.rows).toHaveLength(1);
  expect(summary.rows[0].d).toBe("b");
  expect(JSON.stringify(summary)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  // The list says what it is, and a new text asks again
  await expect(page.locator("#historyList .history-panel").first()).toContainText("way back");
  await paste(page, sample("linux-traceroute-n.txt"));
  await expect(page.locator("#routeBackSave")).toHaveText("Save to history");
  await expect(page.locator("#routeBackSave")).toBeEnabled();
});

test("a saved way back is shown again as the way back, with its strip, and cannot be saved twice", async ({ page }) => {
  await openRoute(page);
  await page.locator("#routeStart").click();
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  await goBack(page);
  await paste(page, sample("linux-traceroute-names.txt"));
  await expect(rows(page).nth(9)).toContainText("Net 80");
  await expect(page.locator("#routeBackSave")).toBeEnabled();
  await page.locator("#routeBackSave").click();
  await showRoute(page, "there");
  await expect(rows(page)).toHaveCount(fixture("normal").hops.length);
  // Reopening it, from the way from the server, goes to the way back, and the panel is left as it is
  await page.locator("#historyList .history-panel").first().locator(".history-action-btn").click();
  await expect(page.locator('[data-shown="back"]:visible').first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#routeTable caption")).toHaveText("Hops from you to this server");
  await expect(rows(page)).toHaveCount(10);
  await expect(rows(page).nth(9)).toContainText("Net 80");
  await expect(page.locator("#routeShowing")).toBeVisible();
  await expect(page.locator("#routeShowLatest")).toBeHidden();
  await expect(page.locator("#routeBackSave")).toBeDisabled();
  await expect(page.locator("#routeBackSave")).toHaveText("Saved to history");
  // A new text takes the strip away
  await paste(page, sample("linux-traceroute-n.txt"));
  await expect(rows(page)).toHaveCount(11);
  await expect(page.locator("#routeShowing")).toBeHidden();
});

test("the way from the server and the way back are not mixed: two groups, and a path is only compared with the same direction", async ({
  page
}) => {
  const data = fixture("normal");
  const old = {
    t: Date.parse("2026-10-01T12:00:00Z"),
    f: 4,
    hops: 13,
    nets: 4,
    ms: 16.9,
    mtu: 1480,
    reached: true,
    as: "AS80",
    path: "AS1>AS2",
    changed: null,
    jump: null
  };
  await page.addInitScript(
    ([entry, summary]) => {
      if (window.sessionStorage.getItem("__seeded")) return;
      window.sessionStorage.setItem("__seeded", "1");
      window.localStorage.setItem("librespeed-better-route-history", JSON.stringify([entry]));
      window.localStorage.setItem("librespeed-better-route-history-summary", JSON.stringify({ v: 1, rows: [summary] }));
    },
    [{ ...old, data }, old]
  );
  await openRoute(page);
  await goBack(page);
  await paste(page, sample("linux-traceroute-names.txt"));
  await expect(rows(page).nth(9)).toContainText("Net 80");
  await expect(page.locator("#routeBackSave")).toBeEnabled();
  await page.locator("#routeBackSave").click();
  const entries = await stored(page, HISTORY);
  // The first one saved is of the way from the server, from the same IP version and the same network: not compared with this one
  expect(entries[0].d).toBe("b");
  expect(entries[0].changed).toBeNull();
  await page.locator("#historyPeriod").selectOption("week");
  const options = await page.locator("#historyGroup option").allTextContents();
  // The most recent first: the way back was saved last
  expect(options).toEqual(["All", "IPv4 · way back", "IPv4"]);
  await page.locator("#historyGroup").selectOption({ label: "IPv4" });
  await expect(page.locator("#historySummary .history-table tbody tr")).toHaveCount(1);
  await expect(page.locator("#historySummary .history-table tbody tr").first().locator("td").first()).toHaveText("1");
  await page.locator("#historyGroup").selectOption({ label: "IPv4 · way back" });
  await expect(page.locator("#historySummary .history-table tbody tr").first().locator("td").first()).toHaveText("1");
});

test("the history of the way back: the data, one by one", async ({ page }) => {
  await openRoute(page);
  const there = {
    ...route(4, [1, 2, 3, 99]),
    direction: "server_to_client",
    target_as: { asn: "AS7", as_name: "x" },
    target_country: "BR"
  };
  there.hops.forEach(item => {
    item.ip = `9.9.9.${item.ttl}`;
  });
  const back = {
    ...route(4, [7, 3, 2, 99]),
    direction: "client_to_server",
    tool: "tracert",
    target_reached: null,
    target_as: null
  };
  back.hops.forEach(item => {
    item.ip = `9.9.9.${item.ttl}`;
  });
  const result = await page.evaluate(
    ([a, b]) => {
      const history = window.LibreSpeedRouteHistory;
      const entryThere = history.entryOf(a, 1000, []);
      const entryBack = history.entryOf(b, 2000, [history.rowOf(entryThere)]);
      const second = history.entryOf({ ...b, hops: b.hops.filter(item => item.ttl !== 2) }, 3000, [
        history.rowOf(entryBack),
        history.rowOf(entryThere)
      ]);
      return {
        thereHasD: "d" in entryThere,
        entryBack: {
          d: entryBack.d,
          as: entryBack.as,
          path: entryBack.path,
          changed: entryBack.changed,
          reached: entryBack.reached
        },
        trimmed: history.trim(b),
        trimmedThere: history.trim(a),
        rowBack: history.rowOf(entryBack),
        rowThere: history.rowOf(entryThere),
        second: { changed: second.changed, d: second.d }
      };
    },
    [there, back]
  );
  // The way from the server is as it was: no direction in it
  expect(result.thereHasD).toBe(false);
  expect(result.trimmedThere).not.toHaveProperty("direction");
  expect(result.rowThere).not.toHaveProperty("d");
  // The way back: the direction and the tool are kept, "does not say" stays that way, the network of the visitor is the first one
  expect(result.trimmed).toMatchObject({ direction: "client_to_server", tool: "tracert", target_reached: null });
  // "does not say" stays that way in the entry and in the row
  expect(result.entryBack).toMatchObject({ d: "b", as: "AS7", reached: null, changed: null });
  expect(result.rowBack.reached).toBeNull();
  expect(result.rowBack.d).toBe("b");
  // Compared with the one before it of the same direction, and not with the other direction
  expect(result.second).toEqual({ changed: true, d: "b" });
});

const saveBackNow = async page => {
  await expect(page.locator("#routeBackSave")).toHaveAttribute("aria-disabled", "false");
  await page.locator("#routeBackSave").click();
};

test("pressing Show again after saving does not offer to save the same route twice", async ({ page }) => {
  await openRoute(page);
  await goBack(page);
  await paste(page, sample("linux-traceroute-names.txt"));
  await expect(rows(page).nth(9)).toContainText("Net 80");
  await saveBackNow(page);
  await expect(page.locator("#routeBackSave")).toHaveText("Saved to history");
  await page.locator("#routeBackShow").click();
  await expect(rows(page)).toHaveCount(10);
  await expect(page.locator("#routeBackSave")).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("#routeBackSave")).toHaveText("Saved to history");
  await page.locator("#routeBackSave").click({ force: true });
  expect(await stored(page, HISTORY)).toHaveLength(1);
});

test("the keyboard stays on the button when it is pressed, and the button says that it is saved", async ({ page }) => {
  await openRoute(page);
  await goBack(page);
  await paste(page, sample("linux-traceroute-names.txt"));
  await expect(rows(page).nth(9)).toContainText("Net 80");
  await expect(page.locator("#routeBackSave")).toHaveAttribute("aria-disabled", "false");
  await page.locator("#routeBackSave").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#routeBackSave")).toHaveText("Saved to history");
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe("routeBackSave");
});

test("an answer that arrives after a saved route was opened does not take the screen back", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  let calls = 0;
  const seen = await openRoute(page);
  await page.unroute("**/backend/route_enrich.php");
  await page.route("**/backend/route_enrich.php", async route => {
    calls++;
    seen.enrich.push(JSON.parse(route.request().postData()));
    // The first (the one that is saved) answers at once; the second waits
    if (calls > 1) await gate;
    await route.fulfill({ json: ENRICH(JSON.parse(route.request().postData())) });
  });
  await goBack(page);
  await paste(page, sample("linux-traceroute-names.txt"));
  await expect(rows(page).nth(9)).toContainText("Net 80");
  await saveBackNow(page);
  await paste(page, sample("linux-traceroute-n.txt"));
  await expect(rows(page)).toHaveCount(11);
  await page.locator("#historyList .history-panel").first().locator(".history-action-btn").click();
  await expect(rows(page)).toHaveCount(10);
  release();
  await page.waitForTimeout(700);
  await expect(rows(page)).toHaveCount(10);
  await expect(page.locator("#routeShowing")).toBeVisible();
  await expect(page.locator("#routeBackSave")).toHaveText("Saved to history");
  await expect(page.locator("#routeBackNotes")).toHaveText("");
});

test("the summary with All keeps the medians of the way from the server, and says that there is a way back", async ({
  page
}) => {
  const data = fixture("normal");
  const old = {
    t: Date.parse("2026-10-08T12:00:00Z"),
    f: 4,
    hops: 13,
    nets: 4,
    ms: 16.9,
    mtu: 1480,
    reached: true,
    as: "AS80",
    path: "AS1>AS2",
    changed: null,
    jump: null
  };
  await page.addInitScript(
    ([entry, summary]) => {
      if (window.sessionStorage.getItem("__seeded")) return;
      window.sessionStorage.setItem("__seeded", "1");
      window.localStorage.setItem("librespeed-better-route-history", JSON.stringify([entry]));
      window.localStorage.setItem("librespeed-better-route-history-summary", JSON.stringify({ v: 1, rows: [summary] }));
      window.localStorage.setItem("librespeed-better-history-view", "month");
    },
    [{ ...old, data }, old]
  );
  await openRoute(page);
  const cells = () => page.locator("#historySummary .history-table tbody tr").first().locator("td").allTextContents();
  await expect(page.locator("#historySummary .history-table tbody tr")).toHaveCount(1);
  const before = await cells();
  await goBack(page);
  await paste(page, sample("linux-traceroute-names.txt"));
  await expect(rows(page).nth(9)).toContainText("Net 80");
  await saveBackNow(page);
  await expect(page.locator("#historyGroup")).toBeVisible();
  await expect(page.locator("#historyGroup")).toHaveValue(/all/i);
  const after = await cells();
  // The numbers are the ones of the way from the server; the way back is counted apart, and has its own group
  expect(after.slice(1)).toEqual(before.slice(1));
  expect(after[0]).toBe(`${before[0]} (+1 way back)`);
  await page.locator("#historyGroup").selectOption({ label: "IPv4 · way back" });
  const back = await cells();
  expect(back[0]).toBe("1");
  expect(back[1]).toBe("10");
});

test("a history that cannot be written is not said to be saved", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (String(key).startsWith("librespeed-better-route-history")) throw new Error("full");
      return original.call(this, key, value);
    };
  });
  await openRoute(page);
  await goBack(page);
  await paste(page, sample("linux-traceroute-names.txt"));
  await expect(rows(page).nth(9)).toContainText("Net 80");
  await saveBackNow(page);
  await expect(page.locator("#routeBackNotes")).toContainText("Could not save");
  await expect(page.locator("#routeBackSave")).toHaveText("Save to history");
});

test("when the text does not say whether the server answered, the history does not say it either", async ({ page }) => {
  await openRoute(page);
  await goBack(page);
  await paste(page, sample("windows-ptbr-tracert-lines-only.txt"));
  await expect(rows(page)).toHaveCount(4);
  await saveBackNow(page);
  await expect(page.locator("#routeBackSave")).toHaveText("Saved to history");
  const entries = await stored(page, HISTORY);
  expect(entries[0].reached).toBeNull();
  const summary = await stored(page, SUMMARY);
  expect(summary.rows[0].reached).toBeNull();
  await page.locator("#historyList .history-panel").first().locator(".history-bar").first().click();
  await expect(page.locator("#historyList .history-panel").first()).toContainText("The server answered");
  await expect(page.locator("#historyList .history-panel").first()).not.toContainText("Your address answered");
});

test("a saved way back reopened where the server has no route: the way back is shown, with no 'not available' over it", async ({
  page,
  browser
}) => {
  await openRoute(page);
  await goBack(page);
  await paste(page, sample("linux-traceroute-names.txt"));
  await expect(rows(page).nth(9)).toContainText("Net 80");
  await saveBackNow(page);
  const entries = await stored(page, HISTORY);
  // Another browser: it has its own storage, with the saved way back in it
  const other = await (await browser.newContext()).newPage();
  await other.addInitScript(
    ([history]) => {
      if (window.sessionStorage.getItem("__seeded")) return;
      window.sessionStorage.setItem("__seeded", "1");
      window.localStorage.setItem("librespeed-better-route-history", JSON.stringify(history));
    },
    [entries]
  );
  await openRoute(other, { caps: { v: 1, enabled: false } });
  await other.locator("#historyList .history-panel").first().locator(".history-action-btn").click();
  await expect(other.locator("#routeTable tbody tr")).toHaveCount(10);
  await expect(other.locator("#routeStatus")).not.toContainText("not available");
  // Looking at it did not make the way back the choice for the next visit
  expect(await other.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
});
