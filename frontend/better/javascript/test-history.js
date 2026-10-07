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
 *   extra: function (entry, body) { add more elements to the open panel },
 *   canShare: function (entry) { whether the panel gets a share icon next to its header (default: no),
 *   onShare: function (entry) { called when the icon is used; may return "copied" (or a promise of it) to
 *     flash a check mark on the icon }
 * }) returns { add(entry), clear(), render() }
 *
 * A panel with a share icon is a pill of two parts: the header (date, numbers, caret) and the share icon.
 *
 * LibreSpeedHistory.addShare(body, url) adds a row with the link and a copy button to the details
 * of a panel and the result image below them.
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

  // The standard share icon (three connected nodes)
  var SHARE_ICON =
    '<svg viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>';

  function buildShare(history, entry) {
    var label = text("share.button", "Share results");
    var button = element("button", "history-share-btn");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = SHARE_ICON;
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
    if (history.extra) history.extra(entry, body);
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

  function copyLink(input, button) {
    function feedback(ok) {
      button.textContent = ok ? text("history.copied", "Copied!") : text("history.failed", "Failed");
      setTimeout(function () {
        button.textContent = text("history.copy", "Copy");
      }, 1500);
    }
    function fallback() {
      input.focus();
      input.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (error) {
        // The copy command is not available
      }
      feedback(ok);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(input.value).then(function () {
        feedback(true);
      }, fallback);
    } else {
      fallback();
    }
  }

  function addShare(body, url) {
    var row = element("div", "history-row history-share");
    var input = element("input", "history-link");
    input.type = "text";
    input.readOnly = true;
    input.value = url;
    input.title = text("history.link", "Link to the result");
    input.onclick = function () {
      this.select();
    };
    var button = element("button", "history-copy", text("history.copy", "Copy"));
    button.type = "button";
    button.onclick = function () {
      copyLink(input, button);
    };
    row.appendChild(input);
    row.appendChild(button);
    body.querySelector(".history-details").appendChild(row);

    var link = element("a", "history-image-link");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.title = text("history.open", "Open the result in full size");
    var image = element("img", "history-image");
    image.alt = text("history.image", "Test results in graphical form");
    image.loading = "lazy";
    image.src = url;
    link.appendChild(image);
    body.appendChild(link);
  }

  function create(config) {
    var history = {
      key: config.key,
      limit: config.limit || DEFAULT_LIMIT,
      header: config.header,
      rows: config.rows,
      extra: config.extra,
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
    // The headers and the details are written in the language of the page, so they are built again after a change
    window.addEventListener("i18nchange", function () {
      var panels = byId(history.listId).querySelectorAll(".history-panel");
      var open = -1;
      for (var i = 0; i < panels.length; i++) if (panels[i].classList.contains("open")) open = i;
      render(history);
      if (open >= 0) togglePanel(byId(history.listId), open);
    });
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

  return { create: create, addShare: addShare, formatDate: formatDate };
})();
