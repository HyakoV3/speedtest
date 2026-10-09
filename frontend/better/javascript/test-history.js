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
 *   limit: number of results to keep (default 20),
 *   header: function (entry) { return { date: "text", metrics: ["text", ...] }; },
 *   rows: function (entry) { return [["label", "value"], ...]; },
 *   canDownload: function (entry) { whether the panel gets a download icon, after the share icon (default: no),
 *   onDownload: function (entry) { called when the icon is used },
 *   downloadLabel: function () { the name of the download icon, for the tip and for the screen readers },
 *   canShare: function (entry) { whether the panel gets a share icon next to its header (default: no),
 *   onShare: function (entry) { called when the icon is used; may return "copied" (or a promise of it) to
 *     flash a check mark on the icon }
 * }) returns { add(entry), clear(), render() }
 *
 * A panel with a share icon is a pill of two parts: the header (date, numbers, caret) and the share icon. With a download
 * icon too it has three parts.
 */
var LibreSpeedHistory = (function () {
  "use strict";

  var DEFAULT_LIMIT = 20;

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
    list.innerHTML = "";
    section.style.display = entries.length ? "" : "none";
    for (var i = 0; i < entries.length; i++) {
      var panel = element("div", "history-panel");
      var panelId = history.listId + "-" + i;
      var bar = element("div", "history-bar");
      bar.appendChild(buildHeader(history, entries[i], i, panelId));
      if (history.canShare && history.onShare && history.canShare(entries[i])) {
        bar.appendChild(buildShare(history, entries[i]));
      }
      if (history.canDownload && history.onDownload && history.canDownload(entries[i])) {
        bar.appendChild(buildDownload(history, entries[i]));
      }
      panel.appendChild(bar);
      panel.appendChild(buildBody(history, entries[i], panelId));
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
      limit: config.limit || DEFAULT_LIMIT,
      header: config.header,
      rows: config.rows,
      canDownload: config.canDownload,
      onDownload: config.onDownload,
      downloadLabel: config.downloadLabel,
      canShare: config.canShare,
      onShare: config.onShare,
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
        if (!window.confirm(text("history.confirm", "Delete all the test history saved in this browser?"))) return;
        save(history, []);
        render(history);
      };
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
    return {
      add: function (entry) {
        var list = load(history);
        list.unshift(entry);
        save(history, list.slice(0, history.limit));
        render(history);
      },
      clear: function () {
        save(history, []);
        render(history);
      },
      render: function () {
        render(history);
      }
    };
  }

  return { create: create, formatDate: formatDate };
})();
