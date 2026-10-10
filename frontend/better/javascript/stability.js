/* global SPEEDTEST_SERVERS:writable, LibreSpeedI18n, LibreSpeedChart, LibreSpeedHistory, LibreSpeedStability, LibreSpeedUplot, uPlot */
/* exported initServers, startStop, resetTest, onServerChange, updateThreshold */
/**
 * Stability test of the better page (stability-better.html)
 *
 * The page sets SPEEDTEST_SERVERS (a URL of a list or the list itself) before loading this file. The markup calls
 * startStop, resetTest, onServerChange and updateThreshold.
 */
function I(id) {
  return document.getElementById(id);
}

function t(key, fallback, parameters) {
  return LibreSpeedI18n.t(key, fallback, parameters);
}

// State
var worker = null;
var updater = null;
var running = false;
var recordedTest = false; // a finished measurement is saved once
var allPingData = []; // the whole measurement, for the chart and the CSV
var latestData = null;
var alertThresholdMs = 0;
var selectedServer = null;
var localServerReady = false;
var serverDiscoveryPending = false;

function joinServerUrl(server, path) {
  if (!server) return path;
  if (!path) return server;
  if (server.charAt(server.length - 1) === "/" || path.charAt(0) === "/") return server + path;
  return server + "/" + path;
}

// Load the server list (Docker exposes server-list.json, older setups may expose servers.json)
function loadServers(callback) {
  if (Array.isArray(SPEEDTEST_SERVERS)) {
    callback();
    return;
  }
  var serverListUrl = typeof SPEEDTEST_SERVERS === "string" ? SPEEDTEST_SERVERS : "";
  if (!serverListUrl) {
    SPEEDTEST_SERVERS = [];
    callback();
    return;
  }
  var xhr = new XMLHttpRequest();
  var fallbackTried = false;
  var retryOrGiveUp = function () {
    if (fallbackTried) {
      SPEEDTEST_SERVERS = [];
      callback();
      return;
    }
    fallbackTried = true;
    xhr.open("GET", "servers.json?r=" + Math.random());
    xhr.send();
  };
  xhr.onload = function () {
    var servers = null;
    try {
      servers = JSON.parse(xhr.responseText);
    } catch (error) {
      // Not a list: try the other file
    }
    if (Array.isArray(servers)) {
      SPEEDTEST_SERVERS = servers;
      callback();
    } else {
      retryOrGiveUp();
    }
  };
  xhr.onerror = retryOrGiveUp;
  xhr.open("GET", serverListUrl + (serverListUrl.match(/\?/) ? "&" : "?") + "r=" + Math.random());
  try {
    xhr.timeout = 2000;
    xhr.ontimeout = xhr.onerror;
  } catch (error) {
    // Some old browsers do not allow a timeout on this request
  }
  xhr.send();
}

// The page shows once the server search is over: the loading message goes away and the test shows
function showPage() {
  I("loading").className = "hidden";
  I("stabilityArea").className = "visible";
}

// Ping every server and select the closest one. The search is the one of the speed test page: speedtest.js pings each
// server up to three times, six servers at the same time, and sets pingT (the best ping, or -1) on every server.
function discoverServers() {
  serverDiscoveryPending = true;
  I("server").disabled = true;
  var pending = document.createElement("option");
  pending.value = "";
  pending.textContent = t("stability.finding-server", "Finding best server...");
  I("server").appendChild(pending);
  updateStartButtonState();

  var finish = function (best) {
    I("server").innerHTML = "";
    SPEEDTEST_SERVERS.forEach(function (candidate, index) {
      if (!(candidate.pingT > 0)) return;
      var option = document.createElement("option");
      option.value = index;
      option.textContent = LibreSpeedI18n.serverName(candidate);
      if (candidate === best) option.selected = true;
      I("server").appendChild(option);
    });
    selectedServer = best;
    serverDiscoveryPending = false;
    localServerReady = selectedServer !== null || I("server").options.length > 0;
    I("server").disabled = !localServerReady;
    updateStartButtonState();
    showPage();
  };

  // An entry that is not a valid server is left out, the others are still searched
  var selector = new Speedtest();
  var added = 0;
  SPEEDTEST_SERVERS.forEach(function (server) {
    try {
      selector.addTestPoint(server);
      added++;
    } catch (error) {
      console.warn("A server of the list is not valid:", server && server.name, error);
    }
  });
  if (added === 0) {
    finish(null);
    return;
  }
  selector.selectServer(finish);
}

function initServers() {
  selectedServer = null;
  localServerReady = false;
  serverDiscoveryPending = false;
  I("server").innerHTML = "";
  loadServers(function () {
    if (SPEEDTEST_SERVERS.length === 0) {
      I("serverArea").style.display = "none";
      localServerReady = true;
      updateStartButtonState();
      showPage();
    } else {
      discoverServers();
    }
  });
}

function onServerChange(index) {
  if (index === "") return;
  selectedServer = SPEEDTEST_SERVERS[index];
  updateStartButtonState();
}

// The server list only matters once the target is a LibreSpeed server, and only when there is something to choose
function updateServerAreaVisibility() {
  var choosable = serverDiscoveryPending || I("server").options.length > 1;
  var libre = I("targetSelect").value === "libre";
  I("serverArea").style.display = libre && choosable ? "" : "none";
  showSponsor(libre ? selectedServer : null);
}

// An external target does not need the server of the page
function canStartTest() {
  var target = I("targetSelect").value;
  return target === "libre" ? localServerReady : !!target;
}

function updateStartButtonState() {
  if (running) return;
  var button = I("startBtn");
  var canStart = canStartTest();
  button.className = canStart ? "" : serverDiscoveryPending ? "disabled finding" : "disabled";
  button.setAttribute("aria-disabled", canStart ? "false" : "true");
  button.textContent = serverDiscoveryPending ? t("stability.finding", "Finding...") : t("classic.start", "Start");
  if (canStart) button.removeAttribute("title");
  else if (!I("targetSelect").value) button.title = t("stability.select-target", "Select a target");
  else if (serverDiscoveryPending) button.title = t("stability.finding-server", "Finding best server...");
  else button.title = t("stability.no-server", "No reachable local server found");
  I("server").disabled = !localServerReady || serverDiscoveryPending;
  updateServerAreaVisibility();
}

// Start/Stop
function startStop() {
  if (running) abortTest();
  else if (canStartTest()) LibreSpeedConsent.ensure(startTest);
}

function abortTest() {
  if (worker) worker.postMessage("abort");
  stopTest();
}

function workerSettings() {
  var externalTarget = I("targetSelect").value === "libre" ? "" : I("targetSelect").value;
  var settings = {
    duration: parseInt(I("durationSelect").value, 10),
    ping_allowPerformanceApi: true,
    url_ping_external: externalTarget
  };
  if (!externalTarget && selectedServer) {
    settings.url_ping = joinServerUrl(selectedServer.server, selectedServer.pingURL);
    settings.mpot = true;
  }
  return settings;
}

function onWorkerMessage(currentWorker, event) {
  if (worker !== currentWorker) return;
  var data = JSON.parse(event.data);
  latestData = data;
  if (data.pingData && data.pingData.length > 0) Array.prototype.push.apply(allPingData, data.pingData);
  if (alertThresholdMs > 0 && data.currentPing > alertThresholdMs) LibreSpeedStability.beep();
  if (data.testState >= 4) {
    if (!recordedTest) {
      recordedTest = true;
      recordTest(data);
    }
    stopTest();
  }
}

function startTest() {
  if (running || !canStartTest()) return;
  allPingData = [];
  latestData = null;
  recordedTest = false;
  resetUI();
  running = true;
  var button = I("startBtn");
  button.className = "running";
  button.textContent = t("classic.abort", "Abort");
  I("durationSelect").disabled = true;
  I("targetSelect").disabled = true;
  I("server").disabled = true;
  var currentWorker = new Worker("stability_worker.js?r=" + Math.random());
  worker = currentWorker;
  worker.onmessage = function (event) {
    onWorkerMessage(currentWorker, event);
  };
  updater = setInterval(function () {
    if (worker) worker.postMessage("status");
  }, 200);
  worker.postMessage("start " + JSON.stringify(workerSettings()));
}

function stopTest() {
  running = false;
  I("startBtn").className = "";
  I("durationSelect").disabled = false;
  I("targetSelect").disabled = false;
  I("server").disabled = false;
  updateStartButtonState();
  if (updater) {
    clearInterval(updater);
    updater = null;
  }
  if (worker) {
    // Ask for the final status before the worker is stopped
    var stoppedWorker = worker;
    stoppedWorker.postMessage("status");
    setTimeout(function () {
      try {
        stoppedWorker.terminate();
      } catch (error) {
        // The worker is already gone
      }
      if (worker === stoppedWorker) worker = null;
    }, 500);
  }
}

function resetTest() {
  if (running) abortTest();
  allPingData = [];
  latestData = null;
  resetUI();
  drawChart();
}

function resetUI() {
  ["statCurrent", "statAvg", "statMin", "statMax", "statJitter", "statLoss", "statElapsed"].forEach(function (id) {
    I(id).textContent = "";
  });
  I("rating").textContent = "--";
  I("rating").className = "none";
}

function formatTime(seconds) {
  return LibreSpeedChart.fmtTime(seconds);
}

function showRating(data) {
  var rating = LibreSpeedStability.rating(data.avgPing, data.jitter, data.packetLoss);
  I("rating").textContent = LibreSpeedStability.ratingLabel(rating);
  I("rating").className = rating;
}

// UI update loop
function updateUI() {
  if (!latestData) return;
  var d = latestData;
  var format = LibreSpeedStability.format;
  I("statCurrent").textContent = format(d.currentPing);
  I("statAvg").textContent = format(d.avgPing);
  I("statMin").textContent = d.minPing > 0 ? format(d.minPing) : "--";
  I("statMax").textContent = format(d.maxPing);
  I("statJitter").textContent = format(d.jitter);
  I("statLoss").textContent = d.totalSamples > 0 ? d.packetLoss.toFixed(1) : "--";
  I("statElapsed").textContent = formatTime(d.elapsed);
  showRating(d);
}

// CHART: the style is chosen in the theme panel (or with ?chart=) and kept in the browser
var CHART_STYLES = ["polished", "bands", "uplot"];
var CHART_STYLE_KEY = "librespeed-better-chart";
var chartStyle = "polished";
var uplotLoading = false;
var uplotFailed = false;

(function () {
  var requested = new URLSearchParams(window.location.search).get("chart");
  var saved = null;
  try {
    saved = window.localStorage.getItem(CHART_STYLE_KEY);
  } catch (error) {
    // Without storage the default is used
  }
  if (CHART_STYLES.indexOf(requested) >= 0) chartStyle = requested;
  else if (CHART_STYLES.indexOf(saved) >= 0) chartStyle = saved;
})();

// Used by theme-panel.js
window.LibreSpeedChartStyle = {
  list: CHART_STYLES,
  get: function () {
    return chartStyle;
  },
  set: function (style, save) {
    if (CHART_STYLES.indexOf(style) < 0) return;
    chartStyle = style;
    if (save) {
      try {
        window.localStorage.setItem(CHART_STYLE_KEY, style);
      } catch (error) {
        // The choice then only lasts until the page is closed
      }
    }
    drawChart();
  }
};

function uplotReady() {
  return typeof uPlot !== "undefined" && typeof LibreSpeedUplot !== "undefined";
}

function invalidateUplot() {
  if (uplotReady()) LibreSpeedUplot.invalidate();
}

// uPlot (about 50 KB) is only loaded when its style is chosen
function loadUplot() {
  if (uplotLoading || uplotFailed) return;
  uplotLoading = true;
  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "frontend/better/vendor/uPlot.min.css";
  document.head.appendChild(link);
  ["frontend/better/vendor/uPlot.iife.min.js", "frontend/better/javascript/chart-uplot.js"].forEach(function (src) {
    var script = document.createElement("script");
    script.async = false; // run in order
    script.src = src;
    script.onerror = function () {
      uplotFailed = true;
      uplotLoading = false;
    };
    document.head.appendChild(script);
  });
}

function chartState() {
  return { data: allPingData, threshold: alertThresholdMs };
}

function drawChart() {
  var canvas = I("pingChart");
  if (chartStyle === "uplot") {
    if (uplotReady()) {
      LibreSpeedUplot.draw(canvas, I("chartContainer"), chartState);
      return;
    }
    // While uPlot loads (or if it fails) the polished style is drawn
    if (!uplotFailed) loadUplot();
    canvas.style.display = "";
    LibreSpeedChart.draw(canvas, "polished", chartState());
    return;
  }
  if (uplotReady()) LibreSpeedUplot.hide();
  canvas.style.display = "";
  LibreSpeedChart.draw(canvas, chartStyle, chartState());
}

// The chart is painted again with the theme, the text size, the font and the language
["themechange", "accessibilitychange", "fontchange", "i18nchange"].forEach(function (name) {
  window.addEventListener(name, function () {
    invalidateUplot();
    drawChart();
  });
});

// Animation frame loop
function frame() {
  window.requestAnimationFrame(frame);
  updateUI();
  drawChart();
}

// The text written by this file follows the language
window.addEventListener("i18nchange", function () {
  I("thresholdValue").textContent = alertThresholdMs > 0 ? alertThresholdMs + " ms" : t("stability.off", "Off");
  if (latestData) showRating(latestData);
  updateStartButtonState();
  testHistory.render();
  // The server names that have a text in the language of the page
  Array.prototype.forEach.call(I("server").options, function (option) {
    if (option.value !== "" && SPEEDTEST_SERVERS[option.value]) {
      option.textContent = LibreSpeedI18n.serverName(SPEEDTEST_SERVERS[option.value]);
    }
  });
});

// Alert threshold
function updateThreshold(value) {
  alertThresholdMs = parseInt(value, 10);
  I("thresholdValue").textContent = alertThresholdMs > 0 ? alertThresholdMs + " ms" : t("stability.off", "Off");
}

// SHARE: a summary of a measurement, with the share sheet of the system or the clipboard
function canShare() {
  return !!(navigator.share || navigator.clipboard);
}

function shareSummary(entry) {
  var format = LibreSpeedStability.format;
  var rating = LibreSpeedStability.rating(entry.avg, entry.jitter, entry.loss);
  return t(
    "share.stability-text",
    "LibreSpeed stability test, {time}: {rating}. Average {avg} ms, jitter {jitter} ms, min {min} ms, max {max} ms, failed requests {loss}%.",
    {
      time: formatTime(entry.duration),
      rating: LibreSpeedStability.ratingLabel(rating),
      avg: format(entry.avg),
      jitter: format(entry.jitter),
      min: format(entry.min),
      max: format(entry.max),
      loss: entry.loss.toFixed(1)
    }
  );
}

function shareEntry(entry) {
  var url = window.location.href.split("#")[0].split("?")[0];
  if (navigator.share) {
    return navigator
      .share({ title: "LibreSpeed", text: shareSummary(entry), url: url })
      .then(function () {
        return "shared";
      })
      .catch(function () {
        // The person closed the share sheet
      });
  }
  return navigator.clipboard.writeText(shareSummary(entry) + " " + url).then(function () {
    return "copied";
  });
}

// TEST HISTORY (see test-history.js)
// The text of a target as it is in the list of targets (the one of the local server is translated there)
function targetLabel(value) {
  var options = I("targetSelect").options;
  for (var i = 0; i < options.length; i++) if (value && options[i].value === value) return options[i].textContent;
  return t("history.unknown", "Unknown");
}

// The figures of the measurements of a period: the median of the average and of the jitter, the mean of the failures
function periodFigures(rows) {
  var periods = LibreSpeedPeriods;
  var failed = periods.mean(periods.values(rows, "loss"));
  return {
    average: periods.median(periods.values(rows, "avg")),
    jitter: periods.median(periods.values(rows, "jitter")),
    failed: failed
  };
}

function periodRating(rows) {
  var figures = periodFigures(rows);
  return LibreSpeedStability.rating(figures.average, figures.jitter, figures.failed);
}

var testHistory = LibreSpeedHistory.create({
  key: "librespeed-better-stability-history",
  // There is no limit of measurements but the space, and the pings are what takes it: only the latest ones keep them
  // (the older ones keep their numbers, and lose the file of their pings)
  slimAfter: 20,
  slim: function (entry) {
    var slim = {};
    for (var key in entry) if (key !== "pings") slim[key] = entry[key];
    return slim;
  },
  // What the person should know about this history, as a toast, once in each session
  notices: function () {
    return [{ key: "history-local", text: t("history.local-note", "Saved only in this browser, on this device.") }];
  },
  // One small row per finished measurement, for the history by period: a measurement stopped before its end stays in the
  // list of results but not in the summary
  summary: {
    key: "librespeed-better-stability-history-summary",
    // The ping to one target is not the ping to another, so they are shown apart
    group: function (row) {
      return row.target;
    },
    groupLabel: targetLabel,
    // The measurements to one server are not the ones to another: a list of the servers, when the history has more than one
    filter: {
      value: function (row) {
        return row.server;
      },
      label: function (value) {
        if (!value) return t("history.unknown", "Unknown");
        var servers = typeof SPEEDTEST_SERVERS === "object" ? SPEEDTEST_SERVERS : [];
        for (var i = 0; i < servers.length; i++)
          if (servers[i].name === value) return LibreSpeedI18n.serverName(servers[i]);
        return value;
      }
    },
    // The average ping is what is followed from a period to the next
    trend: function (rows) {
      return LibreSpeedPeriods.median(LibreSpeedPeriods.values(rows, "avg"));
    },
    // The columns of the file of the latest measurements: fixed names, for a spreadsheet or a script
    csvColumns: [
      {
        label: "date",
        value: function (row) {
          return LibreSpeedHistory.formatDateTime(row.t);
        }
      },
      {
        label: "average_ms",
        value: function (row) {
          return row.avg;
        }
      },
      {
        label: "min_ms",
        value: function (row) {
          return row.min;
        }
      },
      {
        label: "max_ms",
        value: function (row) {
          return row.max;
        }
      },
      {
        label: "jitter_ms",
        value: function (row) {
          return row.jitter;
        }
      },
      {
        label: "failed_percent",
        value: function (row) {
          return row.loss;
        }
      },
      {
        label: "target",
        value: function (row) {
          return row.target;
        }
      },
      {
        label: "server",
        value: function (row) {
          return row.server;
        }
      }
    ],
    columns: [
      {
        label: function () {
          return t("history.col-measurements", "Measurements");
        },
        value: function (rows) {
          return String(rows.length);
        }
      },
      {
        label: function () {
          return t("history.col-average", "Average (ms)");
        },
        value: function (rows) {
          return LibreSpeedStability.format(periodFigures(rows).average);
        }
      },
      {
        label: function () {
          return t("history.col-jitter", "Jitter (ms)");
        },
        value: function (rows) {
          return LibreSpeedStability.format(periodFigures(rows).jitter);
        }
      },
      {
        label: function () {
          return t("history.col-failed", "Failed (%)");
        },
        value: function (rows) {
          var failed = periodFigures(rows).failed;
          return failed === null ? "--" : failed.toFixed(1);
        }
      },
      {
        label: function () {
          return t("history.rating", "Rating");
        },
        value: function (rows) {
          return LibreSpeedStability.ratingLabel(periodRating(rows));
        },
        className: function (rows) {
          return "history-badge " + periodRating(rows);
        }
      }
    ],
    fromEntry: function (entry) {
      if (entry.complete === false) return null;
      var number = LibreSpeedHistory.number;
      return {
        t: entry.date,
        avg: number(entry.avg, true),
        min: number(entry.min, true),
        max: number(entry.max, true),
        jitter: number(entry.jitter),
        loss: number(entry.loss),
        target: entry.target || "",
        server: entry.server || ""
      };
    }
  },
  header: function (entry) {
    return {
      date: LibreSpeedHistory.formatDate(entry.date) + " · " + entry.duration + "s",
      metrics: [
        LibreSpeedStability.format(entry.avg) + " " + t("history.average", "ms avg."),
        entry.loss.toFixed(1) + " " + t("history.loss", "% loss")
      ]
    };
  },
  rows: function (entry) {
    var rating = LibreSpeedStability.rating(entry.avg, entry.jitter, entry.loss);
    var format = LibreSpeedStability.format;
    return [
      [t("history.rating", "Rating"), LibreSpeedStability.ratingLabel(rating), "history-badge " + rating],
      [t("history.minimum", "Minimum"), format(entry.min) + " ms"],
      [t("history.maximum", "Maximum"), format(entry.max) + " ms"],
      [t("metric.jitter", "Jitter"), format(entry.jitter) + " ms"]
    ];
  },
  canShare: canShare,
  onShare: shareEntry,
  // Every saved measurement keeps its pings, so each one can be saved as a CSV file from its own row
  canDownload: function (entry) {
    return !!(entry.pings && entry.pings.length);
  },
  onDownload: function (entry) {
    LibreSpeedStability.downloadCsv(entry.pings, LibreSpeedHistory.formatDate(entry.date).replace(/[/: ]/g, "-"));
  },
  downloadLabel: function () {
    return t("stability.download-csv", "Download CSV");
  }
});

function recordTest(data) {
  try {
    testHistory.add({
      date: Date.now(),
      duration: parseInt(I("durationSelect").value, 10),
      avg: data.avgPing,
      min: data.minPing,
      max: data.maxPing,
      jitter: data.jitter,
      loss: data.packetLoss,
      // The target is read when the result is saved, as the duration is: the selector is disabled during the test
      target: I("targetSelect").value,
      server: I("targetSelect").value === "libre" && selectedServer ? selectedServer.name || "" : "",
      complete: data.testState === 4,
      pings: allPingData.slice()
    });
  } catch (error) {
    // The history is a convenience, it must not break the page
  }
}

// Init
initServers();
frame();
