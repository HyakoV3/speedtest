/**
 * Route page: the path from the server to the visitor, hop by hop
 *
 * Asks backend/route.php?caps whether this server can do it (nothing else is asked before the person presses the button) and,
 * on the press, posts to it once. The answer is drawn with textContent only: the names of the networks come from a database.
 */
(function () {
  "use strict";

  var view = window.LibreSpeedRouteView;
  var ENDPOINT = "backend/route.php";
  var TIMEOUT_MS = 25000;
  var BAR_EMPTY = 0.02;

  var button = document.getElementById("routeStart");
  var status = document.getElementById("routeStatus");
  var mtuBox = document.getElementById("routeMtu");
  var groupBox = document.getElementById("routeGroups");
  var endBox = document.getElementById("routeEnd");
  var table = document.getElementById("routeTable");
  var viewsBox = document.getElementById("routeViews");
  var tableWrap = document.getElementById("routeTableWrap");
  var chartBox = document.getElementById("routeChart");
  var mapBox = document.getElementById("routeMap");
  var resultsBox = document.getElementById("routeResults");
  var summaryBox = document.getElementById("routeSummary");
  var statHops = document.getElementById("routeStatHops");
  var statNetworks = document.getElementById("routeStatNetworks");
  var statTime = document.getElementById("routeStatTime");
  var showingBox = document.getElementById("routeShowing");
  var showingText = document.getElementById("routeShowingText");
  var showLatest = document.getElementById("routeShowLatest");
  var actionBox = document.querySelector(".route-action");
  var compareBox = document.getElementById("routeCompare");
  var compareText = document.getElementById("routeCompareText");
  var compareLists = document.getElementById("routeCompareLists");
  var compareLettersNote = document.getElementById("routeCompareLetters");
  var compareSeasTitle = document.getElementById("routeCompareSeasTitle");
  var compareSeas = document.getElementById("routeCompareSeas");
  var bothBox = document.getElementById("routeMapBoth");
  // The chin under each of the three views (the table, the chart and the map): the button for the two directions and the two directions
  // themselves, which are also how one of them is chosen. Only there when there are two routes.
  var chins = ["routeTableBoth", "routeChartBoth", "routeMapBoth"].map(function (id, index) {
    var box = document.getElementById(id);
    return {
      box: box,
      button: box.querySelector(".route-both-button"),
      list: box.querySelector(".route-both-ways"),
      // The map and the chart draw a line for each direction, and the legend shows it; the table has none. Each draws its own lines, and so
      // has its own samples (the chart: solid in the colour of the action, and dashed in the second one; the map has its own dashes)
      lines: index > 0,
      sample: index === 2 ? "route-map-leg" : "route-chart-leg"
    };
  });

  var VIEW_KEY = "librespeed-better-route-view";
  var DIRECTION_KEY = "librespeed-better-route-direction";
  var BOTH_KEY = "librespeed-better-route-map-both";
  var ENRICH_ENDPOINT = "backend/route_enrich.php";
  var HISTORY_KEY = "librespeed-better-route-history";
  var SUMMARY_KEY = "librespeed-better-route-history-summary";
  var HISTORY_LIMIT = 100;
  // Only the latest routes keep their hops (and with them the addresses); the older ones keep their numbers
  var HISTORY_FULL = 20;
  var CHART_CSS = "frontend/better/vendor/uPlot.min.css";
  // In order; each one is skipped when its global already exists (a second try after a failure only asks what is missing)
  var CHART_SCRIPTS = [
    { src: "frontend/better/vendor/uPlot.iife.min.js", global: "uPlot" },
    { src: "frontend/better/javascript/colors.js", global: "LibreSpeedColors" },
    { src: "frontend/better/javascript/route-chart.js", global: "LibreSpeedRouteChart" }
  ];

  // A loader of the files of a view, asked for only when the view is chosen: the style sheet (if any) and the scripts in order,
  // each one skipped when its global already exists, and asked again after a failure
  function loader(css, scripts) {
    var pending = null;
    function ready() {
      return scripts.every(function (item) {
        return !!window[item.global];
      });
    }
    function load() {
      if (ready()) return Promise.resolve();
      if (pending) return pending;
      if (css && !document.querySelector('link[href="' + css + '"]')) {
        var link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = css;
        document.head.appendChild(link);
      }
      pending = Promise.all(
        scripts.map(function (item) {
          if (window[item.global]) return Promise.resolve();
          return new Promise(function (resolve, reject) {
            var script = document.createElement("script");
            script.src = item.src;
            script.async = false;
            script.onload = resolve;
            script.onerror = function () {
              script.remove();
              reject(new Error(item.src));
            };
            document.head.appendChild(script);
          });
        })
      ).catch(function (error) {
        pending = null;
        throw error;
      });
      return pending;
    }
    return { ready: ready, load: load };
  }

  var chartFiles = loader(CHART_CSS, CHART_SCRIPTS);
  // The shapes of the countries (about 25 KB with gzip) and the code that draws them
  // The table of the sea crossings alone: the comparison of the two directions needs it without the map
  var crossingFiles = loader(null, [
    { src: "frontend/better/javascript/route-crossings.js", global: "LibreSpeedRouteCrossings" }
  ]);
  var mapFiles = loader(null, [
    { src: "frontend/better/vendor/world-110m.js", global: "LibreSpeedWorld" },
    { src: "frontend/better/javascript/route-crossings.js", global: "LibreSpeedRouteCrossings" },
    { src: "frontend/better/javascript/route-map.js", global: "LibreSpeedRouteMap" }
  ]);

  // The route that is drawn. The two directions each keep theirs while the other is shown: "there" is the one the server traced, "back" the
  // one the visitor traced and pasted
  // Which of the two routes the results show: "there" (server → you) or "back" (you → server). Each route is kept in its own variable.
  var shown = "there";
  var thereData = null;
  var backData = null;
  // The panel at the side (route-side.js), where the way back is brought in
  var side = null;

  // The route that the results show
  function shownData() {
    return shown === "back" ? backData : thereData;
  }
  var backPanelApi = null;
  // The way back that is shown: the time of the saved one that was reopened (null: the one pasted), whether the networks have arrived (the
  // button that saves it waits for them), and whether it is already in the history
  var backShownT = null;
  var backReady = false;
  var backSaved = false;
  var saveButton = document.getElementById("routeBackSave");
  // The route traced in this visit and the time it was saved at, the time of the saved route that is shown (null: the one traced)
  var liveData = null;
  var liveT = null;
  var shownT = null;
  // Whether the server can trace routes ("on"/"off"), for the page that shows saved ones where it cannot
  var capsState = "pending";
  var routeHistory = null;
  var lastStatus = null;
  var busy = false;
  // The request is on its way: the button says so, and tells it to the screen readers
  var running = false;
  var tick = null;

  function t(key, parameters) {
    return window.LibreSpeedI18n.t(key, key, parameters || {});
  }

  function setStatus(key, parameters) {
    lastStatus = key ? { key: key, parameters: parameters || {} } : null;
    drawStatus();
  }

  function drawStatus() {
    status.textContent = "";
    if (!lastStatus) return;
    if (lastStatus.key === "route.running") {
      // The counter is in a span that screen readers skip: they hear the start and the end, not each second
      var parts = t("route.running", { seconds: "\u0001" }).split("\u0001");
      var spinner = document.createElement("span");
      spinner.className = "route-spinner";
      spinner.setAttribute("aria-hidden", "true");
      status.appendChild(spinner);
      status.appendChild(document.createTextNode(parts[0]));
      var counter = document.createElement("span");
      counter.setAttribute("aria-hidden", "true");
      counter.textContent = String(lastStatus.parameters.seconds);
      status.appendChild(counter);
      status.appendChild(document.createTextNode(parts[1] || ""));
      return;
    }
    status.textContent = t(lastStatus.key, lastStatus.parameters);
  }

  // Before a route and while it is traced, the table, the chart and the map are there, blank and ready to be filled: only what is
  // told about a route (the summary, the networks, the end, the MTU, the strip of a saved route) is not shown
  function clear() {
    [summaryBox, showingBox, mtuBox, groupBox, endBox, compareBox].forEach(function (element) {
      element.hidden = true;
    });
    if (chartReady()) window.LibreSpeedRouteChart.destroy();
    if (mapFiles.ready()) window.LibreSpeedRouteMap.destroy();
    table.querySelector("tbody").textContent = "";
    mtuBox.textContent = "";
    groupBox.textContent = "";
    endBox.textContent = "";

    var summary = document.getElementById("routeChartSummary");
    summary.textContent = "";
    summary.hidden = true;
    document.getElementById("routeChartReadout").textContent = "";
    Array.prototype.forEach.call(chartBox.querySelectorAll("li[data-key]"), function (item) {
      item.hidden = item.dataset.key !== "time";
    });
    document.getElementById("routeMapHost").hidden = false;
    document.getElementById("routeMapNone").hidden = true;
    chins.forEach(function (chin) {
      chin.box.hidden = true;
    });
    dropOtherTable();
    var zoom = document.getElementById("routeMapZoom");
    zoom.hidden = false;
    Array.prototype.forEach.call(zoom.querySelectorAll("[data-zoom]"), function (button) {
      button.disabled = true;
    });

    resultsBox.hidden = false;
    viewsBox.hidden = false;
    table.hidden = false;
    markView();
  }

  function cell(tag, text, className) {
    var element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function lastPublicAnswer(hops) {
    for (var i = hops.length - 1; i >= 0; i--) if (hops[i].scope === "public" && hops[i].answered > 0) return hops[i];
    return null;
  }

  function networkText(hop) {
    if (hop.scope === "private" || hop.scope === "cgnat") return t("route.internal");
    if (hop.scope !== "public") return "";
    if (hop.asn && hop.as_name) return hop.asn + " · " + hop.as_name;
    return hop.asn || hop.as_name || t("route.unknown-network");
  }

  // Hops in a row that did not answer are one line: a vertical ellipsis where the number of the hop is (the numbers are for the screen
  // readers and the tip), the "*" of a hop that did not answer, and "no reply"
  function drawGap(first, last) {
    var row = document.createElement("tr");
    row.className = "hop-none hop-gap";
    var number = cell("th", "");
    number.setAttribute("scope", "row");
    number.title = t("route.no-reply-hops", { n: last.ttl - first.ttl + 1 });
    var mark = cell("span", "⋮", "route-gap-mark");
    mark.setAttribute("aria-hidden", "true");
    number.appendChild(mark);
    number.appendChild(cell("span", first.ttl + "–" + last.ttl, "route-visually-hidden"));
    row.appendChild(number);
    row.appendChild(cell("td", "*", "route-address"));
    row.appendChild(cell("td", t("route.no-reply"), "route-time"));
    row.appendChild(cell("td", "", "route-network"));
    row.appendChild(cell("td", "", "route-country"));
    return row;
  }

  function drawRow(hop, widest, jump, back) {
    var row = document.createElement("tr");
    if (hop.scope === "none") row.className = "hop-none";
    if (jump && jump.to === hop.ttl) row.className = (row.className + " hop-jump").trim();
    row.appendChild(cell("th", String(hop.ttl))).setAttribute("scope", "row");

    // The route of the app has no address for an internal router: it only says it was one
    var internal = hop.ip === null && (hop.scope === "private" || hop.scope === "cgnat");
    var address = cell("td", hop.ip === null ? (internal ? "–" : "*") : hop.ip, "route-address");
    if (hop.alt_ips && hop.alt_ips.length) address.title = [hop.ip].concat(hop.alt_ips).join(", ");
    if (hop.is_target) {
      var you = cell("span", t(back ? "route.server" : "route.you"), "route-you");
      address.appendChild(document.createTextNode(" "));
      address.appendChild(you);
    }
    row.appendChild(address);

    var time = cell("td", "", "route-time");
    if (hop.scope === "none" || hop.rtt_min === null) {
      time.textContent = t("route.no-reply");
    } else {
      time.appendChild(document.createTextNode(hop.rtt_min.toFixed(1) + " ms"));
      var bar = cell("span", "", "route-bar");
      bar.setAttribute("aria-hidden", "true");
      bar.style.width = Math.max(BAR_EMPTY, hop.rtt_min / widest) * 100 + "%";
      time.appendChild(bar);
      if (hop.answered < hop.sent) time.title = t("route.answers", { answered: hop.answered, sent: hop.sent });
    }
    row.appendChild(time);

    row.appendChild(cell("td", networkText(hop), "route-network"));

    var country = cell("td", "", "route-country");
    if (hop.scope === "public" && hop.country) {
      country.textContent = "≈ " + view.countryName(hop.country, window.LibreSpeedI18n.language);
      if (hop.country_doubt) {
        country.classList.add("doubt");
        country.textContent += " ?";
        country.title = t("route.country-doubt", { ms: hop.rtt_min === null ? "?" : hop.rtt_min.toFixed(0) });
      }
    }
    row.appendChild(country);
    return row;
  }

  // The letter of each network when the two directions are known, the same in both; nothing when there is only one, where there is
  // no network to tell from the other direction
  function lettersOf() {
    var there = thereOf();
    var back = backOf();
    if (!there || !back || !(there.hops || []).length || !(back.hops || []).length) return {};
    return view.networkLetters(there, back);
  }

  function letterBadge(letter) {
    return cell("span", letter, "route-letter");
  }

  // The networks on the way: of the route on the screen, and, with both directions on, of the other one too (each under its own direction)
  function drawGroups(data) {
    var second = mapBoth ? otherData() : null;
    var routes = [data];
    if (second && (second.hops || []).length) routes.push(second);
    var both = routes.length > 1;
    var heading = cell("p", t("route.groups"), "route-groups-title");
    var letters = lettersOf();
    var added = false;
    routes.forEach(function (route) {
      var list = view.groups(route.hops || []);
      if (!list.length) return;
      if (!added) groupBox.appendChild(heading);
      added = true;
      if (both) {
        groupBox.appendChild(
          cell(
            "p",
            t(route.direction === "client_to_server" ? "route.direction.back" : "route.direction.there"),
            "route-groups-way"
          )
        );
      }
      var items = document.createElement("ol");
      list.forEach(function (group) {
        var name =
          group.kind === "as"
            ? group.asn + (group.name ? " " + group.name : "")
            : group.kind === "internal"
              ? t("route.internal")
              : t("route.unknown-network");
        var key = group.from === group.to ? "route.group-one" : "route.group";
        var item = cell("li", t(key, { name: name, from: group.from, to: group.to }));
        if (group.kind === "as" && letters[group.asn])
          item.insertBefore(letterBadge(letters[group.asn]), item.firstChild);
        items.appendChild(item);
      });
      groupBox.appendChild(items);
    });
    if (added) groupBox.hidden = false;
  }

  // The strip over a saved route that is shown: its date, and the way back to the route just traced
  function drawShowing() {
    var at = shown === "back" ? backShownT : shownT;
    showingBox.hidden = at === null;
    if (at === null) return;
    showingText.textContent = t("route.history.showing", { date: window.LibreSpeedHistory.formatDateTime(at) });
    // The way back has no "route just traced" to go back to: the one that was pasted is in the box
    showLatest.hidden = shown === "back" || !liveData;
  }

  function toolName(tool) {
    return tool === "lsr1" ? "app" : String(tool || "");
  }

  // The rows of the table of a route (the table is the one of the page or the second one, of the other direction)
  function fillTable(element, data) {
    var hops = data.hops || [];
    var back = data.direction === "client_to_server";
    var jump = view.biggestJump(hops);
    var widest = hops.reduce(function (most, hop) {
      return hop.rtt_min !== null && hop.rtt_min > most ? hop.rtt_min : most;
    }, 1);
    var body = element.querySelector("tbody");
    body.textContent = "";
    for (var i = 0; i < hops.length; i++) {
      var end = i;
      while (hops[i].scope === "none" && end + 1 < hops.length && hops[end + 1].scope === "none") end++;
      if (end > i) {
        body.appendChild(drawGap(hops[i], hops[end]));
        i = end;
      } else {
        body.appendChild(drawRow(hops[i], widest, jump, back));
      }
    }
  }

  // With both directions on, the table of the other one comes under the first, with its own caption
  function dropOtherTable() {
    var old = document.getElementById("routeTableOther");
    if (old) old.parentNode.removeChild(old);
  }

  function drawOtherTable() {
    dropOtherTable();
    var other = otherData();
    if (!mapBoth || !other || !(other.hops || []).length || !shownData()) return;
    var second = table.cloneNode(true);
    second.id = "routeTableOther";
    second.hidden = false;
    second.querySelector("caption").removeAttribute("data-i18n");
    second.querySelector("caption").textContent = t(
      other.direction === "client_to_server" ? "route.back.caption" : "route.caption"
    );
    fillTable(second, other);
    tableWrap.insertBefore(second, chins[0].box);
  }

  // announce: this is a route that was just brought to the screen (traced, pasted, handed over, opened), not a redraw of the one that is there: its
  // end and its MTU are said in toasts, at the bottom left, once
  function draw(data, announce) {
    clear();
    // The route the visitor traced goes from the visitor to the server: the end of it is the server, and the page did not measure it
    var back = data.direction === "client_to_server";
    table.querySelector("caption").textContent = t(back ? "route.back.caption" : "route.caption");
    var hops = data.hops || [];
    if (!hops.length) {
      setStatus("route.no-hops");
      return;
    }
    setStatus(null);

    // The summary: the numbers first, then how it ended and the MTU
    var lastAnswer = view.chartData(data).last;
    statHops.textContent = String(hops.length);
    statNetworks.textContent = String(view.groups(hops).length);
    statTime.textContent = lastAnswer === null ? "–" : lastAnswer.ms.toFixed(1) + " ms";
    resultsBox.hidden = false;
    summaryBox.hidden = false;
    // What to keep in mind when reading the result: a toast, once in each session, for as long as it takes to read it
    if (window.LibreSpeedToast) {
      window.LibreSpeedToast.once(
        back ? "route-about-back" : "route-about",
        t(back ? "route.back.notice" : "route.notice")
      );
    }

    var told = [];
    if (back) {
      // There is no MTU of the way back; the box says who measured the route (a toast too, and the words stay for a screen reader)
      var measured = t("route.back.measured", { tool: toolName(data.tool) });
      mtuBox.appendChild(cell("p", measured, "route-mtu-text"));
      told.push(measured);
      mtuBox.classList.add("route-visually-hidden");
    } else {
      // The MTU is a toast: the box keeps the words for a screen reader and is not seen
      var mtu = view.mtuText(data.pmtu === undefined ? null : data.pmtu, data.pmtu_drops || []);
      mtuBox.appendChild(cell("p", t(mtu.key, mtu.params), "route-mtu-text"));
      var mtuTold = t(mtu.key, mtu.params);
      if (data.pmtu !== null && data.pmtu !== undefined && data.pmtu < 1500) {
        mtuBox.appendChild(cell("p", t("route.mtu-hint"), "route-hint"));
        mtuTold += ". " + t("route.mtu-hint");
      }
      told.push(mtuTold);
      mtuBox.classList.add("route-visually-hidden");
    }
    mtuBox.hidden = false;

    drawGroups(data);

    fillTable(table, data);
    table.hidden = false;
    drawOtherTable();

    var text = back
      ? t(
          data.target_reached === true
            ? "route.back.reached"
            : data.target_reached === false
              ? "route.back.not-reached"
              : "route.back.reached-unknown"
        )
      : data.target_reached
        ? t("route.reached")
        : t("route.not-reached");
    if (!back && !data.target_reached && data.target_as && data.target_as.asn) {
      var last = lastPublicAnswer(hops);
      if (last && last.asn === data.target_as.asn) {
        text += " " + t("route.reached-as", { name: data.target_as.as_name || data.target_as.asn });
      }
    }
    endBox.textContent = text;
    endBox.hidden = false;
    // How the route ended is a toast too; the paragraph is kept, out of sight, for a screen reader that reads the page
    endBox.classList.add("route-visually-hidden");
    told.unshift(text);
    if (announce && window.LibreSpeedToast) {
      told.forEach(function (message) {
        window.LibreSpeedToast.show(message);
      });
    }

    viewsBox.hidden = false;
    markShown();
    applyView();
    drawShowing();
    drawCompare();
  }

  function networkNames() {
    var names = {};
    [thereOf(), backOf()].forEach(function (data) {
      ((data && data.hops) || []).forEach(function (hop) {
        if (hop.asn && hop.as_name && !names[hop.asn]) names[hop.asn] = hop.as_name;
      });
    });
    return names;
  }

  // The route of each direction, whichever of them is on the screen
  function thereOf() {
    return thereData;
  }

  function backOf() {
    return backData;
  }

  // The networks of the two directions side by side. Shown with the route of the way back (and when the way from the server is there too,
  // with the way from the server); not on the way from the server alone, where there is nothing to compare
  function drawCompare() {
    var there = thereOf();
    var back = backOf();
    compareLists.textContent = "";
    if (!back || !shownData()) {
      compareBox.hidden = true;
      return;
    }
    var result = view.compareDirections(there, back);
    var names = networkNames();
    var name = function (asn) {
      return asn + (names[asn] ? " " + names[asn] : "");
    };
    var text = t("route.compare." + (result.state === "different" ? "diff" : result.state), {
      a: result.a,
      b: result.b
    });
    compareText.textContent = text;
    if (result.state === "different") {
      var extra = [];
      if (result.onlyThere.length) {
        extra.push(t("route.compare.only-there", { list: result.onlyThere.map(name).join(", ") }));
      }
      if (result.onlyBack.length) {
        extra.push(t("route.compare.only-back", { list: result.onlyBack.map(name).join(", ") }));
      }
      compareText.textContent = text + " " + extra.join(" ");
    }
    var listed = result.state === "same" || result.state === "order" || result.state === "different";
    compareLettersNote.hidden = !listed;
    if (listed) {
      var letters = lettersOf();
      [
        { title: "route.direction.there", list: result.there, numbers: result.thereN, only: result.onlyThere },
        { title: "route.direction.back", list: result.back, numbers: result.backN, only: result.onlyBack }
      ].forEach(function (column) {
        var box = document.createElement("div");
        box.appendChild(cell("h4", t(column.title)));
        var items = document.createElement("ol");
        column.list.forEach(function (asn, index) {
          var item = cell("li", name(asn));
          // The number of the list "Networks on the way", not the count of this list, which leaves some networks out
          item.value = column.numbers[index];
          if (letters[asn]) item.insertBefore(letterBadge(letters[asn]), item.firstChild);
          if (column.only.indexOf(asn) >= 0) {
            item.className = "route-compare-only";
            var mark = cell("span", "◆", "route-compare-mark");
            mark.setAttribute("aria-hidden", "true");
            item.insertBefore(mark, item.firstChild);
            // The mark is only a picture: the same is said, for whoever does not see it, after the name
            item.appendChild(cell("span", " (" + t("route.compare.only-mark") + ")", "route-visually-hidden"));
          }
          items.appendChild(item);
        });
        box.appendChild(items);
        compareLists.appendChild(box);
      });
    }
    drawSeas(there, back);
    compareBox.hidden = false;
  }

  // The seas that the two directions cross by submarine cable, said by the names of the two countries of each. It says the sea and never
  // the cable: a traceroute does not show which of the cables of a sea carried the traffic.
  function drawSeas(there, back) {
    compareSeas.textContent = "";
    compareSeasTitle.hidden = true;
    compareSeas.hidden = true;
    if (!there || !back) return;
    // The table of the corridors is small (a few KB) and is asked for here, not only with the map; without it nothing is said
    crossingFiles.load().then(
      function () {
        // The routes may have changed while it was coming: the ones of now are compared
        paintSeas(view.compareSeas(thereOf(), backOf(), window.LibreSpeedRouteCrossings));
      },
      function () {}
    );
  }

  function paintSeas(seas) {
    if (seas.state === "none" || compareBox.hidden) return;
    compareSeasTitle.hidden = false;
    compareSeas.hidden = false;
    var language = window.LibreSpeedI18n.language;
    var name = function (key) {
      return key
        .split("-")
        .map(function (code) {
          return view.countryName(code, language);
        })
        .join(" – ");
    };
    var parts = [];
    if (seas.state === "same") {
      parts.push(t("route.compare.seas.same", { list: seas.there.map(name).join(", ") }));
    } else {
      parts.push(t("route.compare.seas.diff"));
      if (seas.onlyThere.length) {
        parts.push(t("route.compare.only-there", { list: seas.onlyThere.map(name).join(", ") }));
      }
      if (seas.onlyBack.length) {
        parts.push(t("route.compare.only-back", { list: seas.onlyBack.map(name).join(", ") }));
      }
    }
    parts.push(t("route.compare.seas.note"));
    compareSeas.textContent = parts.join(" ");
  }

  // Each view: the element it shows, and what it does when it is shown (the table is drawn by draw())
  var VIEWS = {
    table: { element: tableWrap, show: function () {} },
    chart: { element: chartBox, show: showChart },
    map: { element: mapBox, show: showMap }
  };
  var current = firstView();

  // Whether the map draws the other direction too (when there is one): on, until the person turns it off
  var mapBoth = savedBoth();
  chins.forEach(function (chin) {
    chin.button.setAttribute("aria-pressed", String(mapBoth));
  });

  function savedBoth() {
    try {
      return window.localStorage.getItem(BOTH_KEY) !== "off";
    } catch (error) {
      return true;
    }
  }

  function savedView() {
    try {
      return window.localStorage.getItem(VIEW_KEY);
    } catch (error) {
      return null;
    }
  }

  function firstView() {
    var requested = new URLSearchParams(window.location.search).get("routeview");
    if (requested && Object.prototype.hasOwnProperty.call(VIEWS, requested)) return requested;
    var saved = savedView();
    if (saved && Object.prototype.hasOwnProperty.call(VIEWS, saved)) return saved;
    return "table";
  }

  function setView(id, save) {
    if (!Object.prototype.hasOwnProperty.call(VIEWS, id)) return;
    current = id;
    if (save) {
      try {
        window.localStorage.setItem(VIEW_KEY, id);
      } catch (error) {
        // Without storage the choice only lasts until the page is closed
      }
    }
    applyView();
  }

  // Which view is pressed and shown (blank until a route is drawn in it)
  function markView() {
    Array.prototype.forEach.call(viewsBox.querySelectorAll("[data-view]"), function (item) {
      item.setAttribute("aria-pressed", String(item.dataset.view === current));
    });
    Object.keys(VIEWS).forEach(function (id) {
      VIEWS[id].element.hidden = id !== current;
    });
  }

  function applyView() {
    markView();
    VIEWS[current].show();
  }

  function chartReady() {
    return chartFiles.ready();
  }

  function showChart() {
    if (!shownData()) return;
    if (!chartReady()) setStatus("route.chart.loading");
    chartFiles.load().then(
      function () {
        if (lastStatus && lastStatus.key === "route.chart.loading") setStatus(null);
        if (current === "chart" && shownData()) renderChart();
      },
      function () {
        setStatus("route.chart.error");
        setView("table", false);
      }
    );
  }

  function describeHop(index) {
    return hopText(shownData(), index);
  }

  // The hop of the other direction, for the line under the chart that says what is pointed at
  function describeOtherHop(index) {
    var second = otherData();
    return second && second.hops[index] ? hopText(second, index) : "";
  }

  function hopText(data, index) {
    var hop = data.hops[index];
    var time = view.chartData(data).y[index];
    var text =
      t("route.chart.hop", { hop: hop.ttl }) + " · " + (time === null ? t("route.no-reply") : time.toFixed(1) + " ms");
    if (hop.ip) text += " · " + hop.ip;
    var network = networkText(hop);
    if (network) text += " · " + network;
    return text;
  }

  function renderChart() {
    var data = view.chartData(shownData());
    var summary = document.getElementById("routeChartSummary");
    if (data.first === null) {
      summary.textContent = "";
      summary.hidden = true;
    } else {
      summary.textContent = t("route.chart.summary", {
        first: data.first.ms.toFixed(1),
        firstHop: data.first.ttl,
        last: data.last.ms.toFixed(1),
        lastHop: data.last.ttl
      });
      summary.hidden = false;
    }
    var keyShown = {
      time: true,
      internal: data.internal.some(function (value, i) {
        return value && data.y[i] !== null;
      }),
      slow: data.slow.some(Boolean),
      silent: data.y.some(function (value) {
        return value === null;
      }),
      jump: !!data.jump,
      mtu: data.drops.length > 0,
      you: data.target !== null
    };
    Array.prototype.forEach.call(chartBox.querySelectorAll("li[data-key]"), function (item) {
      item.hidden = !keyShown[item.dataset.key];
    });
    chartBox.querySelector('li[data-key="you"] span:last-child').textContent = t(
      shownData().direction === "client_to_server" ? "route.server" : "route.you"
    );
    // With both directions on, the other one is drawn under the first
    var second = mapBoth ? otherData() : null;
    window.LibreSpeedRouteChart.render(document.getElementById("routeChartHost"), data, {
      xLabel: t("route.chart.x"),
      hint: t("route.chart.hint"),
      readout: document.getElementById("routeChartReadout"),
      describe: describeHop,
      other: second && (second.hops || []).length ? view.chartData(second) : null,
      describeOther: describeOtherHop
    });
  }

  function showMap() {
    if (!shownData()) return;
    if (!mapFiles.ready()) setStatus("route.map.loading");
    mapFiles.load().then(
      function () {
        if (lastStatus && lastStatus.key === "route.map.loading") setStatus(null);
        if (current === "map" && shownData()) renderMap();
      },
      function () {
        setStatus("route.map.error");
        setView("table", false);
      }
    );
  }

  // The route of the other direction, when there is one: the one that the person does not have on the screen
  function otherData() {
    return shown === "there" ? backOf() : thereOf();
  }

  // The chin of a view: the button for the two directions and the two directions themselves, the one on the screen first. They are how one of
  // them is chosen (the one that is not on the screen takes its place), and, where lines are drawn, the legend of the lines: the first has
  // the line of the numbers, the other the line under it, and the sample is there only while both are drawn.
  function drawWays(chin, has, drawn) {
    chin.box.hidden = !has;
    chin.button.setAttribute("aria-pressed", String(mapBoth));
    chin.list.hidden = !has;
    chin.list.textContent = "";
    if (!has) return;
    var other = shown === "there" ? "back" : "there";
    [
      { id: shown, other: false },
      { id: other, other: true }
    ].forEach(function (way) {
      var item = document.createElement("li");
      var choice = document.createElement("button");
      choice.type = "button";
      choice.className = "route-both-way";
      choice.dataset.shown = way.id;
      choice.setAttribute("aria-pressed", String(way.id === shown));
      choice.disabled = running;
      if (drawn && chin.lines) {
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 28 10");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", "1");
        line.setAttribute("x2", "27");
        line.setAttribute("y1", "5");
        line.setAttribute("y2", "5");
        line.setAttribute("class", chin.sample + (way.other ? " " + chin.sample + "-other" : ""));
        svg.appendChild(line);
        choice.appendChild(svg);
      }
      choice.appendChild(
        document.createTextNode(t(way.id === "there" ? "route.direction.there" : "route.direction.back"))
      );
      choice.addEventListener("click", function () {
        setShown(way.id);
      });
      item.appendChild(choice);
      chin.list.appendChild(item);
    });
  }

  function renderMap() {
    var md = view.mapData(shownData(), window.LibreSpeedRouteCrossings);
    var second = otherData();
    var other = second ? view.mapData(second, window.LibreSpeedRouteCrossings) : null;
    if (other && !other.countries.length) other = null;
    var host = document.getElementById("routeMapHost");
    var zoom = document.getElementById("routeMapZoom");
    var none = document.getElementById("routeMapNone");
    var map = window.LibreSpeedRouteMap;

    var empty = md.countries.length === 0;
    host.hidden = empty;
    zoom.hidden = empty;
    none.hidden = !empty;
    if (empty) {
      map.destroy();
      // Nothing to draw for this direction, but the other one can still be chosen from the chin
      drawWays(chins[2], second !== null, false);
      return;
    }
    var drawn = mapBoth ? other : null;
    // The chin is there with two routes, even if the other one has no country to draw (the directions are chosen from it)
    drawWays(chins[2], second !== null, drawn !== null);
    map.render(host, md, zoom, drawn || undefined);
  }

  function label() {
    return t("classic.start");
  }

  // The button comes back at once, or after the time the server asked to wait (counting it down on the button)
  function release(seconds) {
    window.clearInterval(tick);
    running = false;
    markShown();
    button.removeAttribute("aria-busy");
    if (!seconds) {
      busy = false;
      button.disabled = false;
      button.textContent = label();
      return;
    }
    var left = seconds;
    button.disabled = true;
    button.textContent = label() + " (" + left + ")";
    tick = window.setInterval(function () {
      left -= 1;
      if (left <= 0) {
        release(0);
        return;
      }
      button.textContent = label() + " (" + left + ")";
    }, 1000);
  }

  function showFailure(response, body) {
    var seconds = Number(body && body.retry_after) || Number(response.headers.get("Retry-After")) || 0;
    if (response.status === 429) {
      var key =
        body && body.error === "rate_server"
          ? "route.rate-server"
          : body && body.error === "busy"
            ? "route.busy"
            : "route.rate-client";
      setStatus(key, { seconds: seconds });
      release(seconds || 60);
      return;
    }
    if (response.status === 422 && body && body.error === "ipv6") setStatus("route.ipv6");
    else if (response.status === 422) setStatus("route.not-global");
    else if (response.status === 404) setStatus("route.unavailable");
    else setStatus("route.error");
    release(0);
  }

  // ---- The history of the routes: the latest ones in this browser, with the summary by period (LibreSpeedHistory)

  function number(value) {
    return typeof value === "number" && isFinite(value) ? value : null;
  }

  // A median or a lowest value for a column: a whole number as it is, the others with one decimal, "--" when there is none
  function figure(value) {
    if (value === null) return "--";
    return Math.round(value) === value ? String(value) : value.toFixed(1);
  }

  function readRows() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(SUMMARY_KEY));
      return saved && saved.v === 1 && Array.isArray(saved.rows) ? saved.rows : [];
    } catch (error) {
      return [];
    }
  }

  // What is in the storage may be old, cut or written by hand: the items that are not a route with a time go away, so that
  // nothing that is drawn from them stops at one of them
  function repairStorage() {
    function valid(item) {
      return !!item && typeof item === "object" && number(item.t) !== null;
    }
    try {
      var list = JSON.parse(window.localStorage.getItem(HISTORY_KEY));
      if (Array.isArray(list) && !list.every(valid)) {
        window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list.filter(valid)));
      }
    } catch (error) {
      // Unreadable or blocked: the history starts from nothing, or goes without storage
    }
    try {
      var saved = JSON.parse(window.localStorage.getItem(SUMMARY_KEY));
      if (saved && saved.v === 1 && Array.isArray(saved.rows) && !saved.rows.every(valid)) {
        saved.rows = saved.rows.filter(valid);
        window.localStorage.setItem(SUMMARY_KEY, JSON.stringify(saved));
      }
    } catch (error) {
      // As above
    }
  }

  // Saves the route that was traced; the time it was saved at, or null (the history is a convenience: it never stops the page)
  function record(data) {
    try {
      if (!routeHistory) return null;
      var entry = window.LibreSpeedRouteHistory.entryOf(data, Date.now(), readRows());
      if (!entry) return null;
      routeHistory.add(entry);
      return entry.t;
    } catch (error) {
      return null;
    }
  }

  // Shows a route that was saved, in the view that is chosen. The route that arrives is always the one that wins
  function reopen(entry) {
    if (running) return;
    var data = window.LibreSpeedRouteHistory.trim(entry && entry.data);
    if (data === null) return;
    // A route goes to the direction it has: the way back to "You → server", the other one to "Server → you"
    var way = data.direction === "client_to_server" ? "back" : "there";
    shown = way;
    markShown();
    if (way === "back") {
      // What is on its way for a text that was pasted must not come over the route that is shown now
      if (backPanelApi) backPanelApi.forget();
      backData = data;
      backShownT = entry.t;
      backReady = true;
      backSaved = true;
      drawSave();
    } else if (liveData && entry.t === liveT) {
      shownT = null;
      thereData = liveData;
    } else {
      shownT = entry.t;
      thereData = data;
    }
    if (mapFiles.ready()) window.LibreSpeedRouteMap.resetView();
    draw(shownData(), true);
    // The command of the panel follows the family of the route that is shown; a sheet that covers the results is closed
    markShown();
    if (way === "there" && backPanelApi) backPanelApi.refresh();
    if (side) side.closeIfNarrow();
    if (capsState === "off" && way === "there") setStatus("route.unavailable");
    resultsBox.scrollIntoView({ block: "start" });
    var target = showingBox.hidden ? document.getElementById("routeSummaryTitle") : showingBox;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }

  showLatest.addEventListener("click", function () {
    if (!liveData || running) return;
    shown = "there";
    markShown();
    shownT = null;
    thereData = liveData;
    if (mapFiles.ready()) window.LibreSpeedRouteMap.resetView();
    draw(shownData(), true);
    if (backPanelApi) backPanelApi.refresh();
    resultsBox.scrollIntoView({ block: "start" });
  });

  // The chins of the table and of the chart (the one of the map is drawn with the map): there when there are two routes, and the directions in
  // them cannot be used while a route is traced (the answer would come to a page that is showing something else)
  function markShown() {
    var two = !!(thereData && backData);
    drawWays(chins[0], two, false);
    drawWays(chins[1], two, two && mapBoth);
    if (!bothBox.hidden) drawWays(chins[2], two, two && mapBoth && !!otherData());
  }

  // Which of the two routes the results show: each keeps the route it has, and nothing is traced or sent by the change
  function setShown(next) {
    if ((next !== "there" && next !== "back") || running) return;
    if (next === shown) {
      markShown();
      return;
    }
    shown = next;
    markShown();
    if (mapFiles.ready()) window.LibreSpeedRouteMap.resetView();
    if (shownData()) {
      draw(shownData());
    } else {
      clear();
      setStatus(next === "there" && capsState === "off" ? "route.unavailable" : null);
    }
  }

  // The route that the visitor traced and pasted: drawn now, and again when the networks and countries arrive
  function drawSave() {
    saveButton.textContent = t(backSaved ? "route.back.saved" : "route.back.save");
    // aria-disabled, not disabled: the button is pressed with the keyboard, and a button that turns disabled takes the focus away from the
    // person (and the screen reader does not tell that it is saved)
    saveButton.setAttribute("aria-disabled", String(!routeHistory || !backData || !backReady || backSaved));
    // Save to history is there only when there is a way back to save, and Clear only when there is something to clear
    saveButton.hidden = !backData;
    if (backPanelApi) backPanelApi.refresh();
  }

  // The way back goes to the history only when the person says so, with the networks it has by then
  function saveBack() {
    if (!backData || backSaved || !backReady || saveButton.getAttribute("aria-disabled") === "true") return;
    var time = record(backData);
    // The history swallows an error of the storage (it is full or blocked): that it is saved is only said when it is there
    var kept =
      time !== null &&
      readRows().some(function (row) {
        return row && row.t === time;
      });
    if (kept) backSaved = true;
    else if (backPanelApi) backPanelApi.note("route.back.save-failed");
    drawSave();
  }

  // The way back from the panel (a paste, the extension) or its networks arriving later. A new one is shown at once; one that arrives while
  // the route from the server is traced is only kept (drawing it would wipe the status of the trace); the networks that arrive late never
  // take the person back to the way back after they chose the other route
  // What comes from the other direction in the three views (the networks on the way, the second table, the second line of the chart and of
  // the map), made again: when the button for the two directions is pressed, when the networks of the other direction arrive, and when it is
  // cleared. The route on the screen is not drawn again.
  function redrawOther() {
    if (!shownData()) return;
    groupBox.textContent = "";
    groupBox.hidden = true;
    drawGroups(shownData());
    drawOtherTable();
    markShown();
    if (current === "chart" && chartReady()) renderChart();
    if (current === "map" && mapFiles.ready()) renderMap();
  }

  function showBack(data, first) {
    backData = data;
    if (first) {
      // A new text: it is not a saved route, it has no networks yet, and it is not in the history
      backShownT = null;
      backReady = false;
      backSaved = false;
    }
    drawSave();
    markShown();
    if (running) return;
    if (first) {
      shown = "back";
      markShown();
      if (mapFiles.ready()) window.LibreSpeedRouteMap.resetView();
      draw(data, true);
      if (side) side.closeIfNarrow();
      return;
    }
    if (shown === "back") {
      draw(data);
      return;
    }
    // The networks of the way back arrive when the person is looking at the way from the server: everything that comes from the other
    // direction (the table, the networks on the way, the lines of the chart and of the map) and the comparison show them as soon as they are there
    redrawOther();
    drawCompare();
  }

  function clearBack() {
    backData = null;
    backShownT = null;
    backReady = false;
    backSaved = false;
    drawSave();
    if (shown !== "back") {
      // The way back that is gone is not on the screen any more: not its table, not its networks, not its lines
      redrawOther();
      drawCompare();
      return;
    }
    // The way back that was shown is gone: the other route takes the screen, if there is one
    shown = "there";
    markShown();
    if (running) return;
    if (mapFiles.ready()) window.LibreSpeedRouteMap.resetView();
    if (shownData()) {
      draw(shownData());
    } else {
      clear();
      setStatus(null);
    }
  }

  function jumpText(jump) {
    return jump && number(jump.from) !== null && number(jump.to) !== null && number(jump.ms) !== null
      ? "#" + jump.from + " → #" + jump.to + ": +" + jump.ms + " ms"
      : "–";
  }

  function createHistory() {
    if (!window.LibreSpeedHistory || !window.LibreSpeedRouteHistory || !window.LibreSpeedPeriods) return;
    var data = window.LibreSpeedRouteHistory;
    var periods = window.LibreSpeedPeriods;
    // The medians of a period are the ones of the way from the server, unless the group of the way back is the one chosen: "All" does
    // not mix the two directions (the way back is told apart in its own group)
    function pick(rows) {
      var select = document.getElementById("historyGroup");
      if (!select || select.hidden || /b$/.test(select.value)) return rows;
      // With only way-back routes in the history, "All" has nothing to keep apart: it shows them instead of nothing
      if (
        !readRows().some(function (row) {
          return row && row.d !== "b";
        })
      )
        return rows;
      return rows.filter(function (row) {
        return row.d !== "b";
      });
    }
    function median(rows, field) {
      return figure(periods.median(periods.values(pick(rows), field)));
    }
    repairStorage();
    routeHistory = window.LibreSpeedHistory.create({
      key: HISTORY_KEY,
      limit: HISTORY_LIMIT,
      slimAfter: HISTORY_FULL,
      slim: data.slim,
      notices: function () {
        return [{ key: "route-history-local", text: t("route.history.local-note") }];
      },
      confirmText: function () {
        return t("route.history.confirm");
      },
      header: function (entry) {
        if (!entry || number(entry.t) === null) return { date: "–", metrics: [] };
        var metrics = [
          t("route.history.hops", { n: number(entry.hops) === null ? "–" : entry.hops }),
          number(entry.ms) === null ? "–" : entry.ms.toFixed(1) + " ms"
        ];
        if (entry.changed === true) metrics.push(t("route.history.new-path"));
        return {
          date:
            window.LibreSpeedHistory.formatDate(entry.t) +
            " · IPv" +
            (entry.f === 6 ? 6 : 4) +
            (entry.d === "b" ? " · " + t("route.history.back") : ""),
          metrics: metrics
        };
      },
      rows: function (entry) {
        entry = entry || {};
        var unknown = t("history.unknown");
        var rows = [
          [t("route.stat.hops"), number(entry.hops) === null ? "–" : String(entry.hops)],
          [t("route.stat.networks"), number(entry.nets) === null ? "–" : String(entry.nets)],
          [t("route.stat.time"), number(entry.ms) === null ? "–" : entry.ms.toFixed(1) + " ms"],
          [t("route.history.mtu"), number(entry.mtu) === null ? unknown : String(entry.mtu)],
          // In the way back who answers is the server, and the text may not say
          [
            t(entry.d === "b" ? "route.history.server-answered" : "route.history.answered"),
            entry.reached === true ? t("route.history.yes") : entry.reached === null ? unknown : t("route.history.no")
          ],
          [t("route.chart.key.jump"), jumpText(entry.jump)],
          [t("route.history.network"), typeof entry.as === "string" && entry.as ? entry.as : unknown],
          [t("route.groups"), typeof entry.path === "string" && entry.path ? entry.path.split(">").join(" → ") : "–"]
        ];
        if (typeof entry.path === "string" && entry.path) {
          rows.push([
            t("route.history.path-state"),
            entry.changed === true
              ? t("route.history.changed")
              : entry.changed === false
                ? t("route.history.same")
                : t("route.history.first")
          ]);
        }
        return rows;
      },
      // Only the routes that still have their hops can be shown again
      actions: function (entry) {
        var kept = data.trim(entry && entry.data);
        // A route that says one direction in its row and another in its data is not shown: it would open in the wrong place
        return kept && (entry.d === "b") === (kept.direction === "client_to_server")
          ? [
              {
                icon: "route",
                label: t("route.history.open"),
                run: function () {
                  reopen(entry);
                }
              }
            ]
          : [];
      },
      summary: {
        key: SUMMARY_KEY,
        csvName: "route_history",
        fromEntry: data.rowOf,
        // IPv4 and IPv6 do not take the same way, and the way back is not the way from the server: their medians are not mixed
        group: function (row) {
          return String(row.f) + (row.d === "b" ? "b" : "");
        },
        groupLabel: function (value) {
          return (
            "IPv" + String(value).charAt(0) + (String(value).charAt(1) === "b" ? " · " + t("route.history.back") : "")
          );
        },
        // The network of the visitor: a list of them when the history has more than one
        filter: {
          value: function (row) {
            return row.as || "";
          },
          label: function (value) {
            return value || t("history.unknown");
          }
        },
        trend: function (rows) {
          return periods.median(periods.values(pick(rows), "ms"));
        },
        csvColumns: [
          {
            label: "date",
            value: function (row) {
              return window.LibreSpeedHistory.formatDateTime(row.t);
            }
          },
          {
            label: "ip_version",
            value: function (row) {
              return row.f;
            }
          },
          {
            label: "hops",
            value: function (row) {
              return row.hops;
            }
          },
          {
            label: "networks",
            value: function (row) {
              return row.nets;
            }
          },
          {
            label: "last_answer_ms",
            value: function (row) {
              return row.ms;
            }
          },
          {
            label: "mtu",
            value: function (row) {
              return row.mtu;
            }
          },
          {
            label: "target_answered",
            value: function (row) {
              return row.reached === null ? "" : row.reached ? 1 : 0;
            }
          },
          {
            label: "your_as",
            value: function (row) {
              return row.as;
            }
          },
          {
            label: "path",
            value: function (row) {
              return row.path;
            }
          },
          {
            label: "path_changed",
            value: function (row) {
              return row.changed === null ? "" : row.changed ? 1 : 0;
            }
          },
          {
            label: "direction",
            value: function (row) {
              return row.d === "b" ? "back" : "there";
            }
          }
        ],
        columns: [
          {
            label: function () {
              return t("route.history.col-routes");
            },
            value: function (rows) {
              var shown = pick(rows).length;
              var more = rows.length - shown;
              return String(shown) + (more > 0 ? " (+" + more + " " + t("route.history.back") + ")" : "");
            }
          },
          {
            label: function () {
              return t("route.stat.hops");
            },
            value: function (rows) {
              return median(rows, "hops");
            }
          },
          {
            label: function () {
              return t("route.stat.networks");
            },
            value: function (rows) {
              return median(rows, "nets");
            }
          },
          {
            label: function () {
              return t("route.history.col-time");
            },
            value: function (rows) {
              var value = periods.median(periods.values(pick(rows), "ms"));
              return value === null ? "--" : value.toFixed(1);
            }
          },
          {
            // The lowest: the median of 1500 and 1480 is not an MTU
            label: function () {
              return t("route.history.col-mtu");
            },
            value: function (rows) {
              var list = periods.values(pick(rows), "mtu");
              return list.length ? String(Math.min.apply(null, list)) : "--";
            }
          },
          {
            label: function () {
              return t("route.history.col-changes");
            },
            value: function (rows) {
              return String(
                pick(rows).filter(function (row) {
                  return row.changed === true;
                }).length
              );
            }
          }
        ]
      }
    });
  }

  function start() {
    if (busy) return;
    busy = true;
    running = true;
    // The trace is of the way from the server: what the results show is that
    shown = "there";
    markShown();
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = t("route.tracing");
    clear();
    var seconds = 0;
    setStatus("route.running", { seconds: seconds });
    window.clearInterval(tick);
    tick = window.setInterval(function () {
      seconds += 1;
      lastStatus = { key: "route.running", parameters: { seconds: seconds } };
      drawStatus();
    }, 1000);
    var controller = new AbortController();
    var timer = window.setTimeout(function () {
      controller.abort();
    }, TIMEOUT_MS);
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "X-LibreSpeed-Route": "1" },
      cache: "no-store",
      signal: controller.signal
    })
      .then(function (response) {
        return response.json().then(
          function (body) {
            return { response: response, body: body };
          },
          function () {
            return { response: response, body: null };
          }
        );
      })
      .then(function (result) {
        window.clearInterval(tick);
        if (result.response.status === 200 && result.body) {
          liveData = thereData = result.body;
          shownT = null;
          if (backPanelApi) backPanelApi.refresh();
          // A new route starts with its own frame: the zoom of the last one is not kept
          if (mapFiles.ready()) window.LibreSpeedRouteMap.resetView();
          draw(result.body, true);
          liveT = record(result.body);
          release(0);
        } else {
          showFailure(result.response, result.body);
        }
      })
      .catch(function () {
        window.clearInterval(tick);
        setStatus("route.error");
        release(0);
      })
      .then(function () {
        window.clearTimeout(timer);
      });
  }

  function init() {
    button.disabled = true;
    clear();
    try {
      // The old choice of the direction is not kept any more
      window.localStorage.removeItem(DIRECTION_KEY);
    } catch (error) {
      // Nothing to remove
    }
    try {
      side = window.LibreSpeedRouteSide.create({
        panel: document.getElementById("routeSide"),
        toggle: document.getElementById("routeSideToggle"),
        close: document.getElementById("routeSideClose"),
        heading: document.getElementById("routeBackTitle"),
        // The command depends on the family of the route that is on the screen
        onOpen: function () {
          if (backPanelApi) backPanelApi.refresh();
        }
      });
    } catch (error) {
      // Without the panel the page still traces the way from the server
    }
    try {
      backPanelApi = window.LibreSpeedRouteBack.create({
        t: t,
        host: window.location.hostname,
        endpoint: ENRICH_ENDPOINT,
        family: function () {
          var there = thereData;
          return there && (there.family === 4 || there.family === 6) ? there.family : null;
        },
        onRoute: showBack,
        hasRoute: function () {
          return !!backData;
        },
        // The route handed over by the browser extension is taken when the route is on (while the other is traced it is only kept)
        enabled: function () {
          return capsState === "on";
        },
        onSettled: function () {
          backReady = true;
          drawSave();
        },
        onClear: clearBack
      });
    } catch (error) {
      // Without the panel the page still traces the way to the visitor
    }
    // After the language is loaded: the texts of the history are written when it is made
    try {
      createHistory();
    } catch (error) {
      // The history is a convenience: the page works without it
    }
    fetch(ENDPOINT + "?caps", { cache: "no-store" })
      .then(function (response) {
        return response.status === 200 ? response.json() : null;
      })
      .then(function (caps) {
        capsState = caps && caps.enabled === true ? "on" : "off";
        // The server may offer librespeed-route (an address; the panel checks it again and shows nothing for anything else)
        if (backPanelApi && caps && caps.enabled === true) backPanelApi.setCli(caps.cli_url);
        if (caps && caps.enabled === true) {
          button.disabled = false;
          if (side) {
            side.setAvailable(true);
            side.restore();
          }
        } else {
          setStatus("route.unavailable");
        }
      })
      .catch(function () {
        capsState = "off";
        setStatus("route.unavailable");
      });
  }

  button.addEventListener("click", start);
  Array.prototype.forEach.call(viewsBox.querySelectorAll("[data-view]"), function (item) {
    item.addEventListener("click", function () {
      setView(item.dataset.view, true);
    });
  });
  // The chart is painted on a canvas, so it reads the colors and the sizes again when they change
  ["themechange", "accessibilitychange", "fontchange"].forEach(function (name) {
    window.addEventListener(name, function () {
      if (shownData() && current === "chart" && chartReady()) renderChart();
    });
  });
  window.addEventListener("i18nchange", function () {
    if (running) button.textContent = t("route.tracing");
    else if (!busy || !button.disabled) button.textContent = label();
    drawStatus();
    if (backPanelApi) backPanelApi.refresh();
    drawSave();
    if (shownData()) draw(shownData());
  });
  saveButton.addEventListener("click", saveBack);
  // The button for the two directions is the same in the three chins: it is for the table, the chart and the map at once
  chins.forEach(function (chin) {
    chin.button.addEventListener("click", function () {
      mapBoth = !mapBoth;
      try {
        window.localStorage.setItem(BOTH_KEY, mapBoth ? "on" : "off");
      } catch (error) {
        // The choice only lasts until the page is closed
      }
      redrawOther();
    });
  });
  Promise.resolve(window.LibreSpeedI18n && window.LibreSpeedI18n.ready).then(init);
})();
