/* exported LibreSpeedHistory */
/**
 * Test history for the better pages
 *
 * Keeps the latest results in localStorage and shows them as an accordion, one panel open at a time.
 * Only the browser stores them, nothing is sent anywhere. The markup is provided by the page:
 *   an element with id "historySection" (hidden while the history is empty), a button with id
 *   "historyToggle" that collapses the section, a list container with id "historyList" and an
 *   optional button with id "historyClear".
 *
 * LibreSpeedHistory.create({
 *   key: "localStorage key",
 *   collapsed: true to start with the section collapsed,
 *   limit: number of results to keep (default: no limit, the storage is the limit: when it is full the oldest results
 *     go, until the list fits),
 *   pageSize: how many results a page of the list has (default 5),
 *   slimAfter: from this result on (the most recent first) slim(entry) is saved in place of the entry, to spare space,
 *   slim: function (entry) { return the entry without its heavy data },
 *   header: function (entry) { return { date: "text", metrics: ["text", ...] }; },
 *   rows: function (entry) { return [["label", "value"], ...]; },
 *   canDownload: function (entry) { whether the panel gets a download icon, after the share icon (default: no),
 *   onDownload: function (entry) { called when the icon is used },
 *   downloadLabel: function () { the name of the download icon, for the tip and for the screen readers },
 *   canShare: function (entry) { whether the panel gets a share icon next to its header (default: no),
 *   onShare: function (entry) { called when the icon is used; may return "copied" (or a promise of it) to
 *     flash a check mark on the icon }
 *   confirmText: function () { the question asked before "Clear history" deletes everything (optional) },
 *   notices: function () { return [{ key: "name", text: "what the person should know about this history" }] }
 *     shown once in each session as toasts (LibreSpeedToast), when the history has something to show (optional),
 *   summary: { key: "localStorage key", fromEntry: function (entry) { return a small row, or null } } keeps one small
 *     row for every result, apart from the list of results (see below). With these too the history can be shown by
 *     period:
 *       group: function (row) { return the value rows are told apart by, such as the target of a measurement },
 *       groupLabel: function (value) { return the text of that value },
 *       filter: { value: function (row) { return a second value to filter the rows by, such as the server },
 *         label: function (value) { return its text } } (optional, with a select with id "historyServer"),
 *       trend: function (rows) { return the number to follow from a period to the next (a median), or null },
 *       csvColumns: [{ label: "name of the column", value: function (row) { return the value of a row of the summary } }],
 *       columns: [{ label: function () { return text }, value: function (rows) { return text },
 *         className: function (rows) { return "css class" } (optional) }]
 * }) returns { add(entry), clear(), render() }
 *
 * The period is chosen in the page, with the markup it provides next to the ones above: a select with id
 * "historyPeriod" (the value "detail" for the list of results, or one of LibreSpeedPeriods.KINDS), a select with id
 * "historyGroup" (hidden by this file when there is only one group) and an element with id "historySummary" where the
 * table goes. Two buttons with ids "historyNewer" and "historyOlder" go to the page before and to the page after of
 * what is shown, the list of results or the table (hidden by this file while there is only one page); without them the
 * list is shown whole. A page goes back to the first when the period, the group or the results change. A button with id "historyExport" (hidden by this file while there is nothing to save) downloads a CSV file:
 * the table of the period chosen, or, with the latest results chosen, one line for each row of the summary (csvColumns).
 * With trend, the table gets a last column with the change of each period in relation to the one before it. The period is kept in localStorage, the group is not. Without any of them, or without LibreSpeedPeriods,
 * only the list of results is shown.
 *
 * LibreSpeedHistory.formatDateTime(timestamp) is "2026-10-09 12:00" in the time zone of the browser.
 * LibreSpeedHistory.number(value, positive) is a number of a result, or null when there is none (a text such as "Fail",
 * a negative value, or 0 when it must be positive). It is meant for the rows of the summary.
 *
 * The summary is { v: 1, rows: [...] }, the most recent row first, up to 2000 rows, with no IP address. The first time,
 * the results already saved are copied into it. A summary written by a newer version of the page is left alone.
 *
 * A panel with a share icon is a pill of two parts: the header (date, numbers, caret) and the share icon. With a download
 * icon too it has three parts.
 */
var LibreSpeedHistory = (function () {
  "use strict";

  var DEFAULT_PAGE_SIZE = 5;

  // Text shown by this file, in the language of the page when LibreSpeedI18n is loaded
  function text(key, fallback) {
    return window.LibreSpeedI18n ? window.LibreSpeedI18n.t(key, fallback) : fallback;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function pad(number) {
    return (number < 10 ? "0" : "") + number;
  }

  function formatDate(timestamp) {
    var date = new Date(timestamp);
    return (
      pad(date.getDate()) + "/" + pad(date.getMonth() + 1) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes())
    );
  }

  // "2026-10-09 12:00", in the time zone of the browser
  function formatDateTime(timestamp) {
    var date = new Date(timestamp);
    return (
      date.getFullYear() +
      "-" +
      pad(date.getMonth() + 1) +
      "-" +
      pad(date.getDate()) +
      " " +
      pad(date.getHours()) +
      ":" +
      pad(date.getMinutes())
    );
  }

  function load(history) {
    try {
      var list = JSON.parse(window.localStorage.getItem(history.key));
      return Array.isArray(list) ? list.slice(0, history.limit) : [];
    } catch (error) {
      return [];
    }
  }

  function save(history, list) {
    try {
      window.localStorage.setItem(history.key, JSON.stringify(list));
    } catch (error) {
      // Storage can be unavailable (private mode, blocked cookies): the history just is not kept
    }
  }

  // The results as they are kept: the heavy data of the old ones taken out, and, when the storage is full (or blocked), the
  // oldest tenth of the results given up, and again, until the list fits. The space is the only limit of results
  function persist(history, list) {
    var kept = list.slice(0, history.limit);
    if (history.slim) {
      for (var i = history.slimAfter; i < kept.length; i++) kept[i] = history.slim(kept[i]);
    }
    while (kept.length) {
      try {
        window.localStorage.setItem(history.key, JSON.stringify(kept));
        return;
      } catch (error) {
        kept = kept.slice(0, kept.length - Math.max(1, Math.floor(kept.length / 10)));
      }
    }
  }

  // The pages: the two buttons are in the markup of the page. Without them everything is shown
  function pagerEnabled() {
    return !!(byId("historyNewer") && byId("historyOlder"));
  }

  function pageCount(history, total) {
    return Math.max(1, Math.ceil(total / history.pageSize));
  }

  // The items of the page the person is on (the page is kept inside the pages there are)
  function pageSlice(history, items) {
    if (!pagerEnabled()) return items;
    history.page = Math.max(0, Math.min(history.page, pageCount(history, items.length) - 1));
    return items.slice(history.page * history.pageSize, (history.page + 1) * history.pageSize);
  }

  // The buttons are there only when there is more than one page; at the first and at the last page the one that leads
  // nowhere is dimmed (aria-disabled, so the focus is not lost)
  function updatePager(history, total) {
    if (!pagerEnabled()) return;
    var newer = byId("historyNewer");
    var older = byId("historyOlder");
    var pages = pageCount(history, total);
    newer.hidden = older.hidden = pages < 2;
    newer.setAttribute("aria-disabled", String(history.page <= 0));
    older.setAttribute("aria-disabled", String(history.page >= pages - 1));
  }

  function goToPage(history, step) {
    var button = byId(step < 0 ? "historyNewer" : "historyOlder");
    if (button.getAttribute("aria-disabled") === "true") return;
    history.page += step;
    render(history);
  }

  var SUMMARY_VERSION = 1;
  var SUMMARY_LIMIT = 2000;
  // The value of the "All" option of the lists (a value no row has)
  var ALL = "\u0001all";

  // A number of a result, or null when there is none ("", "Fail", NaN, a negative value, or 0 when it must be positive)
  function number(value, positive) {
    var parsed = parseFloat(value);
    if (!isFinite(parsed) || parsed < 0 || (positive && parsed === 0)) return null;
    return Math.round(parsed * 100) / 100;
  }

  function newestFirst(rows) {
    return rows.sort(function (a, b) {
      return b.t - a.t;
    });
  }

  // The saved summary { v, rows }, null when there is none yet (or it cannot be read), or { newer: true, rows: [] }
  // when a newer version of the page wrote it: then it is neither shown nor written
  function readSummary(history) {
    var data = null;
    try {
      data = JSON.parse(window.localStorage.getItem(history.summary.key));
    } catch (error) {
      return null;
    }
    if (!data || typeof data.v !== "number") return null;
    if (data.v > SUMMARY_VERSION) return { newer: true, rows: [] };
    return data.v === SUMMARY_VERSION && Array.isArray(data.rows) ? data : null;
  }

  function writeSummary(history, rows) {
    try {
      window.localStorage.setItem(
        history.summary.key,
        JSON.stringify({ v: SUMMARY_VERSION, rows: rows.slice(0, SUMMARY_LIMIT) })
      );
    } catch (error) {
      // Full or blocked storage: the summary just is not kept
    }
  }

  function toRow(history, entry) {
    var row = entry ? history.summary.fromEntry(entry) : null;
    return row && typeof row.t === "number" && isFinite(row.t) ? row : null;
  }

  // The rows of the summary, the most recent first. The first time, the results already saved are copied into it
  function summaryRows(history) {
    if (!history.summary) return [];
    var data = readSummary(history);
    if (data) return data.rows;
    var rows = [];
    var entries = load(history);
    for (var i = 0; i < entries.length; i++) {
      var row = toRow(history, entries[i]);
      if (row) rows.push(row);
    }
    writeSummary(history, newestFirst(rows));
    return rows;
  }

  function addToSummary(history, entry) {
    if (!history.summary) return;
    var data = readSummary(history);
    if (data && data.newer) return;
    var row = toRow(history, entry);
    if (!row) return;
    var rows = summaryRows(history);
    for (var i = 0; i < rows.length; i++) if (rows[i].t === row.t) return;
    rows.unshift(row);
    writeSummary(history, newestFirst(rows));
  }

  // "Clear history" empties the summary too, but keeps it (an empty one) so the results are not copied into it again
  function clearAll(history) {
    save(history, []);
    if (history.summary) writeSummary(history, []);
  }

  var VIEW_KEY = "librespeed-better-history-view";
  var MAX_PERIODS = 24;

  // The history can be shown by period when the page has the markup for it and gave the way to group the rows
  function periodsEnabled(history) {
    return !!(
      window.LibreSpeedPeriods &&
      history.summary &&
      history.summary.columns &&
      history.summary.group &&
      byId("historyPeriod") &&
      byId("historySummary")
    );
  }

  function validView(value) {
    return value === "detail" || window.LibreSpeedPeriods.KINDS.indexOf(value) >= 0;
  }

  function readView() {
    try {
      var value = window.localStorage.getItem(VIEW_KEY);
      return validView(value) ? value : "detail";
    } catch (error) {
      return "detail";
    }
  }

  function saveView(value) {
    try {
      window.localStorage.setItem(VIEW_KEY, value);
    } catch (error) {
      // The choice then only lasts until the page is closed
    }
  }

  // What the rows can be told apart by: the group (the connection of a test, the target of a measurement) and, when the page
  // has the list for it, a filter (the server). Each one has its own list to choose from
  function dimensions(history) {
    var list = [];
    if (history.summary.group && byId("historyGroup")) {
      list.push({
        select: byId("historyGroup"),
        key: "group",
        value: history.summary.group,
        label: history.summary.groupLabel
      });
    }
    if (history.summary.filter && byId("historyServer")) {
      list.push({
        select: byId("historyServer"),
        key: "filter",
        value: history.summary.filter.value,
        label: history.summary.filter.label
      });
    }
    return list;
  }

  // The text of a value of a dimension: values that are shown alike (such as the ones that are all "Unknown") are one
  function dimensionText(dimension, value) {
    return dimension.label ? dimension.label(value) : value;
  }

  // The values of a dimension in the rows, the most recent row first, each one once (and once for each text)
  function dimensionValues(dimension, rows) {
    var values = [];
    var texts = [];
    for (var i = 0; i < rows.length; i++) {
      var value = dimension.value(rows[i]);
      var shown = dimensionText(dimension, value);
      if (texts.indexOf(shown) < 0) {
        texts.push(shown);
        values.push(value);
      }
    }
    return values;
  }

  // The lists to choose from: each one is hidden unless there is more than one value. What is chosen is the value of the
  // most recent row until the person chooses another
  function fillGroup(history, rows) {
    var list = dimensions(history);
    for (var d = 0; d < list.length; d++) {
      var dimension = list[d];
      var values = dimensionValues(dimension, rows);
      if (history[dimension.key] !== ALL) {
        // The value chosen may be one that is shown as another one of the list: then it is that one
        var found = null;
        if (history[dimension.key] !== null) {
          var chosen = dimensionText(dimension, history[dimension.key]);
          for (var v = 0; v < values.length; v++) if (dimensionText(dimension, values[v]) === chosen) found = values[v];
        }
        history[dimension.key] = found !== null ? found : values.length ? values[0] : null;
      }
      dimension.select.innerHTML = "";
      if (values.length > 1) {
        var every = element("option", "", text("history.all", "All"));
        every.value = ALL;
        dimension.select.appendChild(every);
      }
      for (var i = 0; i < values.length; i++) {
        var option = element("option", "", dimensionText(dimension, values[i]));
        option.value = values[i];
        dimension.select.appendChild(option);
      }
      dimension.select.value = history[dimension.key] === null ? "" : history[dimension.key];
      dimension.select.hidden = values.length < 2;
    }
  }

  // The notices of the history, as toasts, once in each session. The texts are asked after the translations are there, so
  // they come in the language of the page
  function announce(history) {
    if (!history.notices || !window.LibreSpeedToast) return;
    Promise.resolve(window.LibreSpeedI18n && window.LibreSpeedI18n.ready).then(function () {
      var notices = history.notices();
      for (var i = 0; i < notices.length; i++) window.LibreSpeedToast.once(notices[i].key, notices[i].text);
    });
  }

  // A short message about something that was just done
  function tell(key, fallback) {
    if (window.LibreSpeedToast) window.LibreSpeedToast.show(text(key, fallback));
  }

  // The rows that are what the lists chosen say (a list that is hidden, with a single value, does not filter)
  function groupRows(history, rows) {
    var list = dimensions(history);
    var shown = [];
    for (var i = 0; i < rows.length; i++) {
      var keep = true;
      for (var d = 0; d < list.length; d++) {
        if (
          !list[d].select.hidden &&
          history[list[d].key] !== ALL &&
          dimensionText(list[d], list[d].value(rows[i])) !== dimensionText(list[d], history[list[d].key])
        )
          keep = false;
      }
      if (keep) shown.push(rows[i]);
    }
    return shown;
  }

  // How much a period changed in relation to the one before it, in percent: null when it cannot be told (no period
  // before, nothing to follow in one of them, or a base of zero)
  function trendPercent(history, rows, before) {
    if (!history.summary.trend || !before) return null;
    var now = history.summary.trend(rows);
    var past = history.summary.trend(before);
    if (now === null || past === null || past === 0) return null;
    return Math.round(((now - past) / past) * 1000) / 10;
  }

  // "+12.5%", "-3.0%", "0%", or "--" when there is none. Only the sign tells better from worse: for the ping a
  // smaller number is the better one, so there is no color
  function trendText(percent) {
    if (percent === null) return "--";
    if (percent === 0) return "0%";
    return (percent > 0 ? "+" : "-") + Math.abs(percent).toFixed(1) + "%";
  }

  // The table of a period kind: one line for each period that has results, the most recent first
  function renderSummary(history, kind, rows) {
    var container = byId("historySummary");
    container.innerHTML = "";
    // The older period of a line is needed for its trend, even when that period is beyond the ones shown
    var all = window.LibreSpeedPeriods.group(groupRows(history, rows), kind);
    var periods = all.slice(0, MAX_PERIODS);
    var total = periods.length;
    var offset = 0;
    periods = pageSlice(history, periods);
    if (pagerEnabled()) offset = history.page * history.pageSize;
    var columns = history.summary.columns;

    var wrap = element("div", "history-table-wrap");
    var table = element("table", "history-table");
    // What the medians are, said to the screen readers and not shown
    table.appendChild(
      element(
        "caption",
        "history-table-caption",
        text("history.summary-note", "Medians of the results of each period (the latest 2000).")
      )
    );
    var head = element("tr");
    var first = element("th", "", text("history.col-period", "Period"));
    first.scope = "col";
    head.appendChild(first);
    for (var c = 0; c < columns.length; c++) {
      var th = element("th", "", columns[c].label());
      th.scope = "col";
      head.appendChild(th);
    }
    if (history.summary.trend) {
      var trendHead = element("th", "", text("history.col-trend", "vs. previous"));
      trendHead.scope = "col";
      head.appendChild(trendHead);
    }
    table.appendChild(element("thead")).appendChild(head);

    var body = element("tbody");
    for (var p = 0; p < periods.length; p++) {
      var line = element("tr");
      var title = element("th", "", window.LibreSpeedPeriods.label(periods[p].period));
      title.scope = "row";
      line.appendChild(title);
      for (var k = 0; k < columns.length; k++) {
        var cell = element(
          "td",
          columns[k].className ? columns[k].className(periods[p].rows) : "",
          columns[k].value(periods[p].rows)
        );
        line.appendChild(cell);
      }
      if (history.summary.trend) {
        var before = all[offset + p + 1] ? all[offset + p + 1].rows : null;
        line.appendChild(element("td", "", trendText(trendPercent(history, periods[p].rows, before))));
      }
      body.appendChild(line);
    }
    table.appendChild(body);
    wrap.appendChild(table);
    container.appendChild(wrap);
    return total;
  }

  function csvField(value) {
    var content = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(content) ? '"' + content.replace(/"/g, '""') + '"' : content;
  }

  function csvText(lines) {
    return (
      lines
        .map(function (line) {
          return line.map(csvField).join(",");
        })
        .join("\r\n") + "\r\n"
    );
  }

  function downloadText(name, content) {
    var url = URL.createObjectURL(new Blob([content], { type: "text/csv" }));
    var link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // The day of today, "2026-10-09", for the name of the file
  function today() {
    return formatDateTime(Date.now()).slice(0, 10);
  }

  // A day number (days since 1970-01-01) as "2026-10-09"
  function isoDay(dayNumber) {
    return new Date(dayNumber * 86400000).toISOString().slice(0, 10);
  }

  // The CSV of what is chosen: one line for each row of the summary with the latest results, or one for each period
  function exportCsv(history) {
    var lines = [];
    var name;
    var rows = summaryRows(history);
    if (history.view === "detail") {
      var csvColumns = history.summary.csvColumns;
      lines.push(
        csvColumns.map(function (column) {
          return column.label;
        })
      );
      for (var i = 0; i < rows.length; i++) {
        lines.push(
          csvColumns.map(function (column) {
            return column.value(rows[i]);
          })
        );
      }
      name = "history_results_" + today() + ".csv";
    } else {
      var all = window.LibreSpeedPeriods.group(groupRows(history, rows), history.view);
      var columns = history.summary.columns;
      var head = ["period", "start", "end"];
      for (var c = 0; c < columns.length; c++) head.push(columns[c].label());
      if (history.summary.trend) head.push(text("history.col-trend", "vs. previous"));
      lines.push(head);
      for (var p = 0; p < all.length; p++) {
        var line = [all[p].period.key, isoDay(all[p].period.start), isoDay(all[p].period.end)];
        for (var k = 0; k < columns.length; k++) {
          var value = columns[k].value(all[p].rows);
          line.push(value === "--" ? "" : value);
        }
        if (history.summary.trend) {
          var percent = trendPercent(history, all[p].rows, all[p + 1] ? all[p + 1].rows : null);
          line.push(percent === null ? "" : percent);
        }
        lines.push(line);
      }
      name = "history_" + history.view + "_" + today() + ".csv";
    }
    downloadText(name, csvText(lines));
    tell("history.exported", "CSV downloaded");
  }

  function togglePanel(list, index) {
    var panels = list.querySelectorAll(".history-panel");
    for (var i = 0; i < panels.length; i++) {
      var open = i === index && !panels[i].classList.contains("open");
      panels[i].classList.toggle("open", open);
      panels[i].querySelector(".history-header").setAttribute("aria-expanded", String(open));
      panels[i].querySelector(".history-body").hidden = !open;
    }
  }

  function buildHeader(history, entry, index, panelId) {
    var info = history.header(entry);
    var header = element("button", "history-header");
    header.type = "button";
    header.setAttribute("aria-expanded", "false");
    header.setAttribute("aria-controls", panelId);
    header.appendChild(element("span", "history-date", info.date));
    var metrics = element("span", "history-metrics");
    for (var i = 0; i < info.metrics.length; i++)
      metrics.appendChild(element("span", "history-metric", info.metrics[i]));
    header.appendChild(metrics);
    header.appendChild(element("span", "history-icon"));
    header.onclick = function () {
      togglePanel(byId(history.listId), index);
    };
    return header;
  }

  // The download icon: a button like the share one, in the icon set of the page
  function buildDownload(history, entry) {
    var label = history.downloadLabel ? history.downloadLabel() : text("history.download", "Download");
    var button = element("button", "history-download-btn");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = window.LibreSpeedIcons ? window.LibreSpeedIcons.html("download", "1.15em") : "";
    button.onclick = function () {
      history.onDownload(entry);
    };
    return button;
  }

  function buildShare(history, entry) {
    var label = text("share.button", "Share results");
    var button = element("button", "history-share-btn");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    // The share icon, in the icon set of the page
    button.innerHTML = window.LibreSpeedIcons ? window.LibreSpeedIcons.html("share", "1.15em") : "";
    button.onclick = function () {
      Promise.resolve(history.onShare(entry)).then(function (result) {
        if (result !== "copied") return;
        button.classList.add("done");
        button.title = text("share.copied", "Copied!");
        setTimeout(function () {
          button.classList.remove("done");
          button.title = label;
        }, 1500);
      });
    };
    return button;
  }

  function buildBody(history, entry, panelId) {
    var body = element("div", "history-body");
    body.id = panelId;
    body.hidden = true;
    var details = element("dl", "history-details");
    var rows = history.rows(entry);
    for (var i = 0; i < rows.length; i++) {
      var row = element("div", "history-row");
      row.appendChild(element("dt", "", rows[i][0]));
      row.appendChild(element("dd", "", rows[i][1]));
      details.appendChild(row);
    }
    body.appendChild(details);
    return body;
  }

  function render(history) {
    var section = byId(history.sectionId);
    var list = byId(history.listId);
    if (!section || !list) return;
    var entries = load(history);
    // Reading the summary is what copies the saved results into it the first time, so it is always read here
    var rows = summaryRows(history);
    list.innerHTML = "";
    section.style.display = entries.length || rows.length ? "" : "none";
    if (entries.length || rows.length) announce(history);
    // The list of results, or the table of a period
    var kind = periodsEnabled(history) ? history.view : "detail";
    if (periodsEnabled(history)) {
      fillGroup(history, rows);
      list.hidden = kind !== "detail";
      byId("historySummary").hidden = kind === "detail";
    }
    var total = entries.length;
    if (periodsEnabled(history) && kind !== "detail") total = renderSummary(history, kind, rows);
    // The results of the page; the rest of the list is there, a page away
    var shown = kind === "detail" ? pageSlice(history, entries) : [];
    updatePager(history, total);
    // Something to save only when there are rows, and the page told how to write them
    var exportButton = byId("historyExport");
    if (exportButton) exportButton.hidden = !(periodsEnabled(history) && history.summary.csvColumns && rows.length);
    for (var i = 0; i < shown.length; i++) {
      var panel = element("div", "history-panel");
      var panelId = history.listId + "-" + i;
      var bar = element("div", "history-bar");
      bar.appendChild(buildHeader(history, shown[i], i, panelId));
      if (history.canShare && history.onShare && history.canShare(shown[i])) {
        bar.appendChild(buildShare(history, shown[i]));
      }
      if (history.canDownload && history.onDownload && history.canDownload(shown[i])) {
        bar.appendChild(buildDownload(history, shown[i]));
      }
      panel.appendChild(bar);
      panel.appendChild(buildBody(history, shown[i], panelId));
      list.appendChild(panel);
    }
  }

  // The section can be collapsed with its toggle button, the history stays saved
  function setCollapsed(history, collapsed) {
    history.collapsed = collapsed;
    byId(history.sectionId).classList.toggle("collapsed", collapsed);
    byId(history.toggleId).setAttribute("aria-expanded", String(!collapsed));
  }

  function create(config) {
    var history = {
      key: config.key,
      limit: config.limit || Infinity,
      pageSize: config.pageSize || DEFAULT_PAGE_SIZE,
      page: 0,
      slim: config.slim,
      slimAfter: config.slim ? config.slimAfter || 0 : Infinity,
      header: config.header,
      rows: config.rows,
      canDownload: config.canDownload,
      onDownload: config.onDownload,
      downloadLabel: config.downloadLabel,
      canShare: config.canShare,
      onShare: config.onShare,
      summary: config.summary,
      confirmText: config.confirmText,
      notices: config.notices,
      view: "detail",
      group: null,
      filter: null,
      sectionId: "historySection",
      listId: "historyList",
      toggleId: "historyToggle",
      collapsed: !!config.collapsed
    };
    setCollapsed(history, history.collapsed);
    byId(history.toggleId).onclick = function () {
      setCollapsed(history, !history.collapsed);
    };
    var clearButton = byId("historyClear");
    if (clearButton) {
      clearButton.onclick = function () {
        var question = history.confirmText
          ? history.confirmText()
          : text("history.confirm", "Delete all the test history saved in this browser?");
        if (!window.confirm(question)) return;
        clearAll(history);
        history.page = 0;
        render(history);
        tell("history.cleared", "History deleted");
      };
    }
    if (periodsEnabled(history)) {
      history.view = readView();
      byId("historyPeriod").value = history.view;
      byId("historyPeriod").onchange = function () {
        history.view = validView(this.value) ? this.value : "detail";
        saveView(history.view);
        history.page = 0;
        render(history);
      };
      var lists = dimensions(history);
      for (var d = 0; d < lists.length; d++) {
        lists[d].select.onchange = (function (key) {
          return function () {
            history[key] = this.value;
            history.page = 0;
            render(history);
          };
        })(lists[d].key);
      }
      if (pagerEnabled()) {
        byId("historyNewer").onclick = function () {
          goToPage(history, -1);
        };
        byId("historyOlder").onclick = function () {
          goToPage(history, 1);
        };
      }
      if (byId("historyExport")) {
        byId("historyExport").onclick = function () {
          exportCsv(history);
        };
      }
    }
    render(history);
    // The headers and the details are written in the language of the page, and the share icons come from the icon set
    // of the page, so they are built again after a change of either
    var rebuild = function () {
      var panels = byId(history.listId).querySelectorAll(".history-panel");
      var open = -1;
      for (var i = 0; i < panels.length; i++) if (panels[i].classList.contains("open")) open = i;
      render(history);
      if (open >= 0) togglePanel(byId(history.listId), open);
    };
    window.addEventListener("i18nchange", rebuild);
    window.addEventListener("iconschange", rebuild);
    // A result saved in another tab of the same site shows here too
    window.addEventListener("storage", function (event) {
      if (event.key === null || event.key === history.key || (history.summary && event.key === history.summary.key)) {
        rebuild();
      }
    });
    return {
      add: function (entry) {
        // The summary is small and is written first, so it is kept even when the storage is too full for the list
        addToSummary(history, entry);
        var list = load(history);
        list.unshift(entry);
        persist(history, list);
        history.page = 0;
        render(history);
      },
      clear: function () {
        clearAll(history);
        history.page = 0;
        render(history);
      },
      render: function () {
        render(history);
      }
    };
  }

  return { create: create, formatDate: formatDate, formatDateTime: formatDateTime, number: number };
})();
