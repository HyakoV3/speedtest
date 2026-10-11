const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const staticRepositoryUrl = "http://127.0.0.1:18184";
const DIR = path.join(__dirname, "..", "fixtures", "route-back");
const PHP_DIR = path.join(__dirname, "..", "fixtures", "route");
const parity = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "route-parity.json"), "utf8"));

async function open(page) {
  await page.route("**/backend/route.php*", route =>
    route.fulfill({ json: { v: 1, enabled: true, ipv6: false, window_s: 60 } })
  );
  await page.goto(`${staticRepositoryUrl}/route-better.html`);
  await page.waitForFunction(() => !!window.LibreSpeedRouteParse);
}

const parse = (page, text) => page.evaluate(t => window.LibreSpeedRouteParse.parse(t), text);

const samples = fs.readdirSync(DIR).filter(name => name.endsWith(".txt"));

test("every sample gives what its .expected.json says", async ({ page }) => {
  await open(page);
  expect(samples.length).toBeGreaterThanOrEqual(10);
  for (const name of samples) {
    const text = fs.readFileSync(path.join(DIR, name), "utf8");
    const expected = JSON.parse(fs.readFileSync(path.join(DIR, name.replace(".txt", ".expected.json")), "utf8"));
    expect(await parse(page, text), name).toEqual(expected);
  }
});

test("what the samples say, read by hand: tools, addresses, hops", async ({ page }) => {
  await open(page);
  const read = name => parse(page, fs.readFileSync(path.join(DIR, name), "utf8"));

  const ptbr = await read("windows-ptbr-tracert.txt");
  expect(ptbr).toMatchObject({
    tool: "tracert",
    family: 4,
    target_ip: "8.8.8.8",
    target_name: "dns.google",
    skipped: 0
  });
  expect(ptbr.hops.map(h => h.ip)).toEqual([
    "192.168.0.1",
    "10.20.0.1",
    null,
    "100.64.10.34",
    "187.16.208.188",
    "72.14.208.80",
    "8.8.8.8"
  ]);
  // "<1 ms" is half a millisecond; the line that did not answer is one hop with no address
  expect(ptbr.hops[0]).toMatchObject({ rtt_min: 0.5, rtt_avg: 0.5, sent: 3, answered: 3, scope: "private" });
  expect(ptbr.hops[2]).toMatchObject({ ip: null, scope: "none", sent: 3, answered: 0, rtt_min: null });
  expect(ptbr.hops[3].scope).toBe("cgnat");

  // The silent tail is cut, as the server does
  const silent = await read("windows-en-tracert-silent.txt");
  expect(silent.hops.length).toBe(4);
  expect(silent.hops[3]).toMatchObject({ ip: "1.1.1.1", scope: "public" });

  // A router that only reports something is not an answer, and the end of the route is cut
  const unreachable = await read("windows-es-tracert-unreachable.txt");
  expect(unreachable.hops.map(h => h.ip)).toEqual(["192.168.0.1", "200.100.50.1"]);

  // The names in front of the "(address)" are not read; three routers in a hop: the most answered one wins, the others are alternatives
  const names = await read("linux-traceroute-names.txt");
  expect(names.hops[7]).toMatchObject({ ip: "100.64.10.73", alt_ips: ["100.64.10.65", "100.64.10.53"], answered: 3 });
  expect(names.hops[0].ip).toBe("192.168.0.1");

  const mac = await read("macos-traceroute.txt");
  expect(mac.hops[5]).toMatchObject({ ip: "72.14.208.80", alt_ips: ["74.125.1.1", "74.125.1.2"], answered: 3 });
  expect(mac.hops[3]).toMatchObject({ sent: 3, answered: 2 });

  const mac6 = await read("macos-traceroute6.txt");
  expect(mac6).toMatchObject({ family: 6, target_ip: "2001:4860:4860::8888", target_name: "dns.google" });
  expect(mac6.hops[0]).toMatchObject({ ip: "fe80::1", scope: "private" });

  const tracepath = await read("linux-tracepath-n.txt");
  expect(tracepath.tool).toBe("tracepath");
  // The line of the MTU ("pmtu") is not a probe: hop 2 is the router that answered, and the hop 1 that was printed twice has two times
  expect(tracepath.hops.map(h => h.ip).slice(0, 3)).toEqual(["192.168.0.1", "172.24.74.112", "172.24.75.37"]);
  expect(tracepath.hops[0].answered).toBe(2);
  expect(tracepath.hops.length).toBe(10);

  const mtr = await read("mtr-silent-alt.txt");
  expect(mtr.tool).toBe("mtr");
  // Best is the minimum, Avg is the mean; 33.3% of 3 is one lost; "???" has no address and did not answer
  expect(mtr.hops[2]).toMatchObject({
    ip: "187.16.208.188",
    alt_ips: ["187.16.208.189"],
    rtt_min: 19.1,
    rtt_avg: 20.8,
    sent: 3,
    answered: 2
  });
  expect(mtr.hops[1]).toMatchObject({ ip: null, scope: "none", sent: 3, answered: 0 });

  const thirty = await read("linux-traceroute-30hops.txt");
  expect(thirty.hops.length).toBe(30);
  expect(thirty.hops[29].ttl).toBe(30);
});

test("the answers of the PHP that the parser is held to are from the PHP that is in the repository", () => {
  // If this fails, backend/route_util.php changed: run tests/route_parity.php again (see its first lines) and look at what the other tests say
  const md5 = require("crypto")
    .createHash("md5")
    .update(fs.readFileSync(path.join(__dirname, "..", "..", "backend", "route_util.php")))
    .digest("hex");
  expect(md5).toBe(parity.util_md5);
});

test("the scope of an address is the one the PHP gives, and so is a route", async ({ page }) => {
  await open(page);
  const scopes = await page.evaluate(
    list => list.map(ip => window.LibreSpeedRouteParse.scope(ip)),
    Object.keys(parity.scopes)
  );
  expect(Object.keys(parity.scopes).length).toBeGreaterThanOrEqual(80);
  expect(scopes).toEqual(Object.values(parity.scopes));
  expect(await page.evaluate(() => window.LibreSpeedRouteParse.scope(null))).toBe("none");

  for (const [name, hops] of Object.entries(parity.outputs)) {
    const text = fs.readFileSync(path.join(PHP_DIR, name), "utf8");
    const result = await parse(page, text);
    expect(result.hops, name).toEqual(hops);
  }
});

test("a text that is not a route, too long, or made to be slow gives no hops and no error in the page", async ({
  page
}) => {
  await open(page);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));

  expect(await parse(page, "")).toEqual({ error: "empty" });
  expect(await parse(page, "   \n  ")).toEqual({ error: "empty" });
  expect(await parse(page, "hello world\nthis is not a route")).toEqual({ error: "unknown" });
  expect(await parse(page, null)).toEqual({ error: "empty" });

  const started = Date.now();
  const long = await parse(page, "x".repeat(1024 * 1024));
  expect(long).toEqual({ error: "too_long" });
  expect(Date.now() - started).toBeLessThan(200);

  // Garbage with a fixed seed, and the shapes that make a regular expression slow
  const seeds = await page.evaluate(() => {
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const alphabet = "0123456789 .:*<>[]()msabcdef!-\n\t,;%";
    const started = performance.now();
    let hops = 0;
    for (let i = 0; i < 300; i++) {
      let text = "";
      const length = 20 + Math.floor(next() * 400);
      for (let c = 0; c < length; c++) text += alphabet[Math.floor(next() * alphabet.length)];
      const result = window.LibreSpeedRouteParse.parse(text);
      if (result.hops) hops += result.hops.length;
    }
    const slow = [
      " 1 " + "1 ".repeat(10000),
      " 1 " + "1".repeat(30000),
      " 1  " + "* ".repeat(15000),
      " 1  " + "1.1.1.1 ".repeat(3000),
      " 1  " + "::".repeat(10000),
      ("1  " + "<".repeat(100) + "\n").repeat(300),
      "a" + " ".repeat(32760) + "b",
      "1 " + ")".repeat(32760) + "a",
      "1 " + ",;".repeat(16380) + "a",
      "1 " + "[".repeat(32760) + "a",
      " 1  " + "1:".repeat(16000),
      "  1.|-- " + "x".repeat(32000),
      " 1:  " + "1ms ".repeat(8000)
    ];
    let worst = 0;
    for (const text of slow) {
      const begin = performance.now();
      window.LibreSpeedRouteParse.parse(text);
      worst = Math.max(worst, performance.now() - begin);
    }
    return { ms: performance.now() - started, worst, hops };
  });
  expect(seeds.ms).toBeLessThan(2000);
  // No text of the size that is accepted takes the page for more than a fraction of a second
  expect(seeds.worst).toBeLessThan(150);
  expect(errors).toEqual([]);
});

test("the rules of the lines: whole milliseconds, the numbers of the hops, the parentheses, the addresses that are not public", async ({
  page
}) => {
  await open(page);
  const hops = text => parse(page, text).then(result => result.hops);

  // "<1 ms" is not 1
  expect((await hops("1  <1 ms  <1 ms  <1 ms  9.9.9.9"))[0]).toMatchObject({ rtt_min: 0.5, rtt_avg: 0.5 });
  // Hops go from 1 to 64; 65 is left out, and counted as a line that was not understood
  const high = await parse(page, "63  9.9.9.9  1.0 ms\n64  9.9.9.10  2.0 ms\n65  9.9.9.11  3.0 ms\n");
  expect(high.hops.map(h => h.ttl)).toEqual([63, 64]);
  expect(high.skipped).toBe(1);
  // The address in parentheses is the router; the name before it is not read
  expect((await hops("1  gw.example.net (203.0.114.7)  1.5 ms  1.6 ms  1.7 ms"))[0]).toMatchObject({
    ip: "203.0.114.7",
    answered: 3
  });
  // CGNAT is not private, and the documentation range is not public
  expect(
    (await hops("1  100.64.0.1  1.0 ms\n2  100.127.255.255  1.0 ms\n3  100.128.0.1  1.0 ms")).map(h => h.scope)
  ).toEqual(["cgnat", "cgnat", "public"]);
  // An address with leading zeros is not an address
  expect((await hops("1  010.0.0.1  1.0 ms\n2  9.9.9.9  1.0 ms")).map(h => h.ip)).toEqual(["9.9.9.9"]);
  // The hops at the end that did not answer are left out
  expect((await hops("1  9.9.9.9  1.0 ms\n2  * * *\n3  * * *")).length).toBe(1);
  // mtr: Best is the minimum and Avg the mean
  const mtr = await hops("  1.|-- 9.9.9.9   0.0%     4    1.1   3.0   1.0   6.8   3.3");
  expect(mtr[0]).toMatchObject({ rtt_min: 1, rtt_avg: 3, sent: 4, answered: 4 });
  // A text with a script in it is only text
  const xss = await parse(
    page,
    "traceroute to <img src=x onerror=window.__x=1> (9.9.9.9)\n 1  <script>alert(1)</script>  9.9.9.9  1.0 ms"
  );
  expect(xss.hops.length).toBe(1);
  expect(typeof xss.target_name).toBe("string");
});

test("the text of the app is read by strict rules: anything that is not exact is not read", async ({ page }) => {
  await open(page);
  const good = fs.readFileSync(path.join(DIR, "lsr1.txt"), "utf8").trim();
  const ok = await parse(page, good);
  expect(ok).toMatchObject({ tool: "lsr1", family: 4, target_ip: "1.1.1.1", nonce: "0123456789abcdef" });
  expect(ok.hops.map(h => h.scope)).toEqual(["private", "private", "none", "cgnat", "public", "public"]);
  // The internal addresses are not in what the page gets
  expect(JSON.stringify(ok)).not.toMatch(/192\.168|10\.\d+\.\d+\.\d+/);

  const bad = [
    good.replace("n=0123456789abcdef", "n=0123456789abcde"),
    good.replace("n=0123456789abcdef", "n=0123456789ABCDEF"),
    good.replace("!f=4", "!f=5"),
    good.replace("!f=4", "!f=6"),
    good.replace("t=1.1.1.1", "t=10.0.0.1"),
    good.replace("t=1.1.1.1", "t=1.1.1"),
    good.replace("!s=1791740000", "!s=abc"),
    good.replace("!a=1.0.0", "!a=<script>"),
    good.replace(";6,1.1.1.1,16.4,3,3", ";6,10.0.0.1,16.4,3,3"),
    good.replace("1,-p,1.2,3,3;2", "2,-p,1.2,3,3;2"),
    good.replace("3,*,0,3,0", "3,*,0,3,1"),
    good.replace("5,187.16.208.188,19.1,3,3,187.16.208.189", "5,187.16.208.188,19.1,3,4"),
    good.replace("LSR1!", "LSR2!"),
    good + "!x=1",
    good.replace("!h=", "!h=") + ";" + "7,*,0,3,0;".repeat(70),
    good.replace("3,*,0,3,0", "3,*,x,3,0"),
    good.replace("3,*,0,3,0", "3,*,0,3,0,zzz"),
    good.replace("1,-p,1.2,3,3", "1,-p,1.2,3,3,9.9.9.9"),
    "LSR1!" + "a".repeat(2000)
  ];
  for (const text of bad) expect(await parse(page, text), text.slice(0, 80)).toEqual({ error: "unknown" });
});

test("whether the server answered: what the text says, and what it does not", async ({ page }) => {
  await open(page);
  const read = name => parse(page, fs.readFileSync(path.join(DIR, name), "utf8"));
  // tracepath says "reached" in the last line, and the address of that line is the target; the one that stops at the hops it can reach says no
  expect(await read("linux-tracepath-reached.txt")).toMatchObject({ reached: true, target_ip: "1.1.1.1" });
  expect(await read("linux-tracepath-n.txt")).toMatchObject({ reached: false, target_ip: null });
  // mtr: the report ends at the target, and "???" at its end are the target that did not answer
  expect(await read("mtr-unreached.txt")).toMatchObject({ reached: false });
  expect(await read("linux-mtr.txt")).toMatchObject({ reached: true });
  // The lines of the hops alone say nothing about the target
  expect(await read("windows-ptbr-tracert-lines-only.txt")).toMatchObject({
    reached: null,
    target_ip: null,
    target_name: null
  });
  // The line that warns about the addresses of a name does not take the place of the "traceroute to name (address)" one
  expect(await read("macos-traceroute-multi.txt")).toMatchObject({
    target_name: "dns.example.net",
    target_ip: "1.1.1.1"
  });
  // The other routers of a hop of mtr
  const mtr = await read("mtr-silent-alt.txt");
  expect(mtr.hops[2].alt_ips).toEqual(["187.16.208.189"]);
  expect(mtr.hops[2].answered).toBe(2);
});

test("a name that ends in a number and a letter is not a time, and a word that looks like an address is not one", async ({
  page
}) => {
  await open(page);
  const hops = text => parse(page, text).then(result => result.hops);
  expect((await hops("2  10g (187.16.208.188)  3.0 ms  4.0 ms  5.0 ms"))[0]).toMatchObject({
    ip: "187.16.208.188",
    answered: 3,
    sent: 3
  });
  // Times that follow something that looks like an address and is not one are not for the address before it
  const one = await hops("1  9.9.9.9  1.0 ms  999.1.1.1  2.0 ms  3.0 ms");
  expect(one[0]).toMatchObject({ ip: "9.9.9.9", answered: 1 });
  // The time of tracepath is glued to its unit; only "ms" is
  expect((await hops(" 1:  9.9.9.9   0.959ms \n 2:  9.9.9.10   1.5ms "))[1]).toMatchObject({
    ip: "9.9.9.10",
    rtt_min: 1.5
  });
});

test("two real outputs of Linux, checked against the text by hand: a home connection over IPv4 and a server over IPv6", async ({
  page
}) => {
  await open(page);
  const read = name => parse(page, fs.readFileSync(path.join(DIR, name), "utf8"));

  // From a home connection: internal networks, then the CGNAT of the provider, a hop of three routers, a silent hop, the destination
  const home = await read("linux-traceroute-v4-cgnat.txt");
  expect(home).toMatchObject({ tool: "traceroute", family: 4, target_ip: "8.8.8.8", skipped: 0 });
  expect(home.hops).toHaveLength(12);
  expect(home.hops.map(h => h.scope)).toEqual([
    "private",
    "private",
    "private",
    "private",
    "private",
    "cgnat",
    "cgnat",
    "cgnat",
    "cgnat",
    "public",
    "none",
    "public"
  ]);
  expect(home.hops[7]).toMatchObject({
    ttl: 8,
    ip: "100.64.10.69",
    alt_ips: ["100.64.10.88", "100.64.10.51"],
    rtt_min: 17.86,
    answered: 3
  });
  expect(home.hops[10]).toMatchObject({ ttl: 11, ip: null, answered: 0, sent: 3 });
  expect(home.hops[11]).toMatchObject({ ttl: 12, ip: "8.8.8.8", rtt_min: 16.8 });

  // Over IPv6 from a hosting provider: two and three routers in one hop, the destination at the end
  const v6 = await read("linux-traceroute-v6-real.txt");
  expect(v6).toMatchObject({ tool: "traceroute", family: 6, target_ip: "2001:4860:4860::8888", skipped: 0 });
  expect(v6.hops.map(h => h.ip)).toEqual([
    "2602:fdb8:131:c001::1",
    "2602:fdb8:132:101::1",
    "2620:b8:4000:2f01::1",
    "2607:f8b0:8482:40::1",
    "2607:f8b0:8484:c0::1",
    "2001:4860:4860::8888"
  ]);
  expect(v6.hops[1].alt_ips).toEqual(["2602:fdb8:1f3:200::1"]);
  expect(v6.hops[3].alt_ips).toEqual(["2607:f8b0:8484:40::1", "2607:f8b0:8484:80::1"]);
  expect(v6.hops[4].alt_ips).toEqual(["2607:f8b0:8482:140::1", "2607:f8b0:8482:c0::1"]);
  expect(v6.hops.every(h => h.scope === "public" && h.answered === 3)).toBe(true);
  expect(v6.hops[5]).toMatchObject({ rtt_min: 0.48 });
});

test("three real outputs of tracert of a Windows in Portuguese, checked against the text by hand", async ({ page }) => {
  await open(page);
  const read = name => parse(page, fs.readFileSync(path.join(DIR, name), "utf8"));

  const v4 = await read("windows-ptbr-real-v4.txt");
  expect(v4).toMatchObject({ tool: "tracert", family: 4, target_ip: "8.8.8.8", skipped: 0 });
  expect(v4.hops).toHaveLength(13);
  expect(v4.hops[0]).toMatchObject({ ip: "192.168.0.1", rtt_min: 0.5, sent: 3, answered: 3 });
  expect(v4.hops[5].scope).toBe("cgnat");
  expect(v4.hops[7]).toMatchObject({ ttl: 8, ip: "100.64.10.88", rtt_min: 15 });
  expect(v4.hops[12]).toMatchObject({ ttl: 13, ip: "8.8.8.8", scope: "public" });

  // The header is in two lines and the first router has a name
  const names = await read("windows-ptbr-real-names.txt");
  expect(names).toMatchObject({ tool: "tracert", target_name: "dns.google", target_ip: "8.8.8.8" });
  expect(names.hops).toHaveLength(12);
  expect(names.hops[0].ip).toBe("192.168.0.1");
  expect(names.hops[11].ip).toBe("192.178.240.77");

  // A hop with a lost probe among answers, then 26 hops with no answer: the ones at the end are cut, as the parser does with any
  // silent hop at the end of a route (they say nothing)
  const silent = await read("windows-ptbr-real-silent.txt");
  expect(silent).toMatchObject({ tool: "tracert", target_ip: "192.0.2.1" });
  expect(silent.hops).toHaveLength(4);
  expect(silent.hops[0]).toMatchObject({ ip: "192.168.0.1", sent: 3, answered: 2 });
  expect(silent.hops.slice(1).every(h => h.sent === 3 && h.answered === 3)).toBe(true);
});

test("the output of tracert sent through '| clip' (the accents of the messages are '?'), checked against the text by hand", async ({
  page
}) => {
  await open(page);
  const clip = await parse(page, fs.readFileSync(path.join(DIR, "windows-ptbr-real-clip.txt"), "utf8"));
  expect(clip).toMatchObject({
    tool: "tracert",
    family: 4,
    target_name: "better.hdl.hv4.xyz",
    target_ip: "77.42.65.55"
  });
  expect(clip.hops).toHaveLength(15);
  expect(clip.hops[5]).toMatchObject({ ip: "100.65.61.62", scope: "cgnat" });
  // The jump of the sea: 3 ms and then 236 ms
  expect(clip.hops[6]).toMatchObject({ ip: "8.242.72.137", rtt_min: 2, scope: "public" });
  expect(clip.hops[7]).toMatchObject({ ip: "171.75.10.35", rtt_min: 236, sent: 3, answered: 2 });
  // Two silent hops in the middle are kept (only the ones at the end are cut)
  expect(clip.hops[11]).toMatchObject({ ttl: 12, ip: null, answered: 0 });
  expect(clip.hops[12]).toMatchObject({ ttl: 13, ip: null, answered: 0 });
  expect(clip.hops[14]).toMatchObject({ ttl: 15, ip: "77.42.65.55", rtt_min: 232 });
});

test("two real outputs from a GitHub runner: macOS with the routers of a hop in lines of their own, and a Windows that nothing answers", async ({
  page
}) => {
  await open(page);
  const mac = await parse(page, fs.readFileSync(path.join(DIR, "macos-traceroute-real-ci.txt"), "utf8"));
  expect(mac).toMatchObject({ tool: "traceroute", family: 4, skipped: 0 });
  expect(mac.hops).toHaveLength(13);
  // A silent first hop is kept: the others are after it
  expect(mac.hops[0]).toMatchObject({ ttl: 1, ip: null, answered: 0, scope: "none" });
  expect(mac.hops[2]).toMatchObject({ ip: "4.136.205.220", alt_ips: ["4.136.205.216"], answered: 3 });
  expect(mac.hops[3]).toMatchObject({ ip: "100.83.24.101", scope: "cgnat" });
  expect(mac.hops[4]).toMatchObject({ ip: "10.58.77.18", scope: "private" });
  expect(mac.hops[6]).toMatchObject({ ip: "51.10.22.207", sent: 3, answered: 1 });
  expect(mac.hops[12]).toMatchObject({ ttl: 13, ip: "8.8.8.8", answered: 3 });
  // When no hop answers, there is no route to show
  const silent = await parse(page, fs.readFileSync(path.join(DIR, "windows-en-real-allsilent-ci.txt"), "utf8"));
  expect(silent).toEqual({ error: "unknown" });
});
