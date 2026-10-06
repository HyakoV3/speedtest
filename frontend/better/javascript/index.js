/* global s, SPEEDTEST_SERVERS:writable, LibreSpeedI18n, LibreSpeedMeter, LibreSpeedHistory */
/* exported initServers, startStop, setConnMode */
/**
 * Speed test of the better page (index-better.html)
 *
 * The page sets SPEEDTEST_SERVERS and creates the Speedtest object s before loading this file. The markup calls
 * initServers (body onload), startStop and setConnMode.
 */
function I(id) {
  return document.getElementById(id);
}

function t(key, fallback, parameters) {
  return LibreSpeedI18n.t(key, fallback, parameters);
}

function format(value) {
  value = Number(value);
  if (value < 10) return value.toFixed(2);
  if (value < 100) return value.toFixed(1);
  return value.toFixed(0);
}

// SERVER AUTO SELECTION
function initServers() {
  if (SPEEDTEST_SERVERS.length == 0) {
    // standalone installation: just make the UI visible
    I("loading").className = "hidden";
    I("serverArea").style.display = "none";
    I("testWrapper").className = "visible";
    initUI();
    return;
  }
  var noServersAvailable = function () {
    I("message").textContent = t("classic.no-servers", "No servers available");
  };
  var runServerSelect = function () {
    s.selectServer(function (server) {
      if (server == null) {
        noServersAvailable();
        return;
      }
      I("loading").className = "hidden";
      // Sort the servers by country, then by city. Names look like "City, Country", "City, Country (qualifier)",
      // "City, Country, Provider" or "Country"
      var parseServerName = function (name) {
        var parts = (name || "").split(",");
        for (var p = 0; p < parts.length; p++) parts[p] = parts[p].trim();
        var country = parts.length >= 2 ? parts[1] : parts[0];
        var city = parts.length >= 2 ? parts[0] : "";
        return { country: country.replace(/\s*\([^)]*\)\s*/g, "").trim(), city: city };
      };
      var indexed = [];
      for (var j = 0; j < SPEEDTEST_SERVERS.length; j++) indexed.push({ idx: j, server: SPEEDTEST_SERVERS[j] });
      indexed.sort(function (a, b) {
        var pa = parseServerName(a.server.name);
        var pb = parseServerName(b.server.name);
        return pa.country.localeCompare(pb.country) || pa.city.localeCompare(pb.city);
      });
      for (var i = 0; i < indexed.length; i++) {
        if (indexed[i].server.pingT == -1) continue;
        var option = document.createElement("option");
        option.value = indexed[i].idx;
        option.textContent = indexed[i].server.name;
        if (indexed[i].server === server) option.selected = true;
        I("server").appendChild(option);
      }
      // With a single server there is nothing to choose
      if (I("server").options.length < 2) I("serverArea").style.display = "none";
      I("testWrapper").className = "visible";
      initUI();
    });
  };
  if (typeof SPEEDTEST_SERVERS === "string") {
    // The list of servers is fetched from the given URL
    s.loadServerList(SPEEDTEST_SERVERS, function (servers) {
      if (servers == null) {
        noServersAvailable();
      } else {
        SPEEDTEST_SERVERS = servers;
        runServerSelect();
      }
    });
  } else {
    s.addTestPoints(SPEEDTEST_SERVERS);
    runServerSelect();
  }
}

// UI CODE
var uiData = null;

// Connections of the test: single is one in each direction, multiple is the default of LibreSpeed (6 for the download,
// 3 for the upload). The choice is kept in the browser
var CONN_KEY = "librespeed-better-connections";
var CONN_SETTINGS = { single: { dl: 1, ul: 1 }, multi: { dl: 6, ul: 3 } };
var connMode = "multi";
try {
  if (window.localStorage.getItem(CONN_KEY) === "single") connMode = "single";
} catch (error) {
  // Without storage the default is used
}

function applyConnMode() {
  // The engine does not take new parameters during a test (for example right after an abort)
  if (s.getState() == 3) return;
  s.setParameter("xhr_dlMultistream", CONN_SETTINGS[connMode].dl);
  s.setParameter("xhr_ulMultistream", CONN_SETTINGS[connMode].ul);
}

function renderConn(running) {
  var buttons = document.querySelectorAll("#connArea button[data-conn]");
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].setAttribute("aria-checked", String(buttons[i].getAttribute("data-conn") === connMode));
    buttons[i].disabled = !!running;
  }
}

function setConnMode(mode) {
  if (s.getState() == 3) return;
  connMode = mode === "single" ? "single" : "multi";
  try {
    window.localStorage.setItem(CONN_KEY, connMode);
  } catch (error) {
    // The choice then only lasts until the page is closed
  }
  applyConnMode();
  renderConn(false);
}

// The start/abort button, the server list and the connections follow the state of the test
function setRunningUI(running) {
  var button = I("startStopBtn");
  button.className = running ? "running" : "";
  button.textContent = running ? t("classic.abort", "Abort") : t("classic.start", "Start");
  I("server").disabled = running;
  renderConn(running);
}

function recordSpeedtest() {
  try {
    testHistory.add({
      date: Date.now(),
      dl: uiData.dlStatus,
      ul: uiData.ulStatus,
      ping: uiData.pingStatus,
      jitter: uiData.jitterStatus,
      ip: uiData.clientIp,
      testId: uiData.testId,
      conn: connMode
    });
  } catch (error) {
    // The history is a convenience, it must not break the page
  }
}

function startStop() {
  if (s.getState() == 3) {
    // the test is running: abort
    s.abort();
    setRunningUI(false);
    initUI();
  } else {
    applyConnMode();
    setRunningUI(true);
    s.onupdate = function (data) {
      uiData = data;
    };
    s.onend = function (aborted) {
      setRunningUI(false);
      updateUI(true);
      if (!aborted) recordSpeedtest();
    };
    s.start();
  }
}

function oscillate() {
  return 1 + 0.02 * Math.sin(Date.now() / 100);
}

function drawMeters(download, upload, downloadProgress, uploadProgress) {
  LibreSpeedMeter.draw(I("dlMeter"), download, { token: "--primary", progress: downloadProgress });
  LibreSpeedMeter.draw(I("ulMeter"), upload, { token: "--secondary", progress: uploadProgress });
}

// The IP card: LibreSpeed sends "IP - ISP, Country", split at the first " - " (without it everything is the IP)
function renderIp(text) {
  var card = I("ipCard");
  text = (text || "").trim();
  if (!text) {
    card.style.display = "none";
    return;
  }
  var separator = text.indexOf(" - ");
  I("ipAddr").textContent = separator > -1 ? text.slice(0, separator) : text;
  I("ipIsp").textContent = separator > -1 ? text.slice(separator + 3) : "";
  I("ipIsp").style.display = separator > -1 ? "" : "none";
  card.style.display = "";
}

function renderSubs(ping, jitter) {
  I("pingText").textContent = ping;
  I("jitText").textContent = jitter;
}

// Reads the data sent back by the test and updates the UI
function updateUI(forced) {
  if (!forced && s.getState() != 3) return;
  if (uiData == null) return;
  var status = uiData.testState;
  renderIp(uiData.clientIp);
  I("dlText").textContent = status == 1 && uiData.dlStatus == 0 ? "..." : format(uiData.dlStatus);
  I("ulText").textContent = status == 3 && uiData.ulStatus == 0 ? "..." : format(uiData.ulStatus);
  drawMeters(
    LibreSpeedMeter.amount(Number(uiData.dlStatus * (status == 1 ? oscillate() : 1))),
    LibreSpeedMeter.amount(Number(uiData.ulStatus * (status == 3 ? oscillate() : 1))),
    Number(uiData.dlProgress),
    Number(uiData.ulProgress)
  );
  renderSubs(format(uiData.pingStatus), format(uiData.jitterStatus));
}

// Update the UI every frame
function frame() {
  window.requestAnimationFrame(frame);
  updateUI();
}

// (Re)initialize the UI
function initUI() {
  drawMeters(0, 0, 0, 0);
  I("dlText").textContent = "";
  I("ulText").textContent = "";
  renderSubs("--", "--");
  renderIp("");
  setRunningUI(s.getState() == 3);
  applyConnMode();
  testHistory.render();
}

function repaintIdleMeters() {
  if (s.getState() != 3) drawMeters(0, 0, 0, 0);
}

// The canvas text and the colors follow the font, the text size and the theme
window.addEventListener("fontchange", repaintIdleMeters);
window.addEventListener("accessibilitychange", repaintIdleMeters);
window.addEventListener("themechange", repaintIdleMeters);
window.addEventListener("i18nchange", function () {
  if (I("testWrapper").className === "visible") setRunningUI(s.getState() == 3);
});
frame();

// TEST HISTORY (see test-history.js)
var testHistory = LibreSpeedHistory.create({
  key: "librespeed-better-history",
  header: function (entry) {
    return {
      date: LibreSpeedHistory.formatDate(entry.date),
      metrics: [format(entry.dl) + " Mbit/s ↓︎", format(entry.ping) + " ms"]
    };
  },
  rows: function (entry) {
    var rows = [[t("history.upload", "Upload"), format(entry.ul) + " Mbit/s"]];
    if (entry.conn) {
      rows.push([
        t("history.mode", "Mode"),
        entry.conn === "single" ? t("history.single", "Single (1↓ / 1↑)") : t("history.multi", "Multiple (6↓ / 3↑)")
      ]);
    }
    rows.push([t("metric.jitter", "Jitter"), format(entry.jitter) + " ms"], ["IP", entry.ip || "--"]);
    if (entry.testId) rows.push([t("classic.test-id", "Test ID:").replace(/:$/, ""), entry.testId]);
    return rows;
  },
  extra: function (entry, body) {
    if (!entry.testId) return;
    var base = window.location.href.substring(0, window.location.href.lastIndexOf("/"));
    LibreSpeedHistory.addShare(body, base + "/results/?id=" + entry.testId + "&style=classic");
  }
});
