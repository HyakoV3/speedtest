/* exported LibreSpeedBackground */
/**
 * Optional photo background of the better pages. Off by default: with no choice nothing is requested or painted.
 *
 * The photos are local files grouped in packs, listed in ../backgrounds/backgrounds.json (see ../backgrounds/README.md).
 * Mode "packs" shows a photo of the chosen packs and changes it as set by "every": never, on every load, or every
 * 5 minutes, 15 minutes, hour, day or week (like Tabliss). Pausing stops the changes, previous and next walk through the
 * photos shown. With "match" on, a photo is picked among those whose tone fits the dark or light mode of the page.
 * The options are kept in localStorage; before a choice is made, better-defaults.js can set the mode and "every". The URL parameter ?background=<id>|none shows that photo (or none) on this
 * visit only. The list, the style sheet and the photo are only requested when a background is on or when the list is
 * asked for (the first time the theme panel opens). Nothing is painted when the browser asks to save data. A change
 * never happens while a test is running.
 *
 * "backgroundchange" is fired on window after every change, so the panel and the credit can repaint.
 */
var LibreSpeedBackground = (function () {
  "use strict";

  var STORAGE_KEY = "librespeed-better-bg";
  var LEGACY_KEY = "librespeed-better-background";
  var BASE = new URL("../backgrounds/", document.currentScript.src).href;
  var STYLESHEET = new URL("../styling/background.css", document.currentScript.src).href;
  var UTM = "?utm_source=librespeed&utm_medium=referral";
  var MODES = ["none", "packs"];
  // Seconds between two photos, 0 is on every load and -1 is never
  var EVERY = [-1, 0, 300, 900, 3600, 86400, 604800];
  var HISTORY_SIZE = 30;
  var root = document.documentElement;
  var options = {
    mode: "none",
    packs: [],
    every: -1,
    paused: false,
    match: true,
    id: null,
    at: 0,
    history: [],
    pos: 0
  };
  var packs = [];
  var photos = [];
  var request = null;
  var layer = null;
  var credit = null;
  var styled = false;
  var ticket = 0;
  var timer = null;
  var explicit = null;

  function readStore() {
    try {
      var stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
      if (stored && typeof stored === "object") return stored;
      // A photo chosen with the first version of this option, which kept just its id
      var legacy = window.localStorage.getItem(LEGACY_KEY);
      if (legacy && /^[a-z0-9-]+$/.test(legacy)) {
        return { mode: "packs", every: -1, id: legacy, at: Date.now(), history: [legacy], pos: 0 };
      }
    } catch (error) {
      // No saved choice
    }
    return null;
  }

  function writeStore() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
    } catch (error) {
      // The choices then only last until the page is closed
    }
  }

  function loadOptions() {
    var stored = readStore();
    if (!stored) return;
    if (MODES.indexOf(stored.mode) >= 0) options.mode = stored.mode;
    if (Array.isArray(stored.packs)) options.packs = stored.packs;
    if (EVERY.indexOf(stored.every) >= 0) options.every = stored.every;
    if (typeof stored.paused === "boolean") options.paused = stored.paused;
    if (typeof stored.match === "boolean") options.match = stored.match;
    if (typeof stored.id === "string" && /^[a-z0-9-]+$/.test(stored.id)) options.id = stored.id;
    if (typeof stored.at === "number") options.at = stored.at;
    if (Array.isArray(stored.history)) {
      options.history = stored.history.filter(function (id) {
        return typeof id === "string" && /^[a-z0-9-]+$/.test(id);
      });
    }
    if (typeof stored.pos === "number") options.pos = stored.pos;
  }

  function saveData() {
    var connection = navigator.connection;
    return !!(connection && connection.saveData);
  }

  function text(key, fallback) {
    return window.LibreSpeedI18n ? window.LibreSpeedI18n.t(key, fallback) : fallback;
  }

  function notify() {
    window.dispatchEvent(new Event("backgroundchange"));
  }

  function load() {
    if (!request) {
      request = window
        .fetch(BASE + "backgrounds.json")
        .then(function (response) {
          return response.ok ? response.json() : [];
        })
        .catch(function () {
          return [];
        })
        .then(function (items) {
          // The pack is a list of packs, each with its photos; photos are the photos of all of them
          packs = Array.isArray(items) ? items : [];
          photos = [];
          packs.forEach(function (pack) {
            (pack.photos || []).forEach(function (photo) {
              photo.pack = pack.id;
              photos.push(photo);
            });
          });
          return packs;
        });
    }
    return request;
  }

  function find(id) {
    for (var i = 0; i < photos.length; i++) if (photos[i].id === id) return photos[i];
    return null;
  }

  function wantedTone() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  // The packs the person chose that exist (a pack can leave the list later); all of them when none is left
  function chosenPacks() {
    var all = packs.map(function (pack) {
      return pack.id;
    });
    var chosen = options.packs.filter(function (id) {
      return all.length === 0 || all.indexOf(id) >= 0;
    });
    return chosen.length ? chosen : all;
  }

  // A photo of the chosen packs, other than the current one, whose tone fits the page when "match" is on
  function pick() {
    var inPacks = photos.filter(function (photo) {
      return chosenPacks().indexOf(photo.pack) >= 0;
    });
    var pool = inPacks;
    if (options.match) {
      var fitting = inPacks.filter(function (photo) {
        return photo.tone === wantedTone();
      });
      if (fitting.length) pool = fitting;
    }
    var others = pool.filter(function (photo) {
      return photo.id !== options.id;
    });
    if (others.length) pool = others;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  function remember(photo) {
    options.id = photo.id;
    options.at = Date.now();
    options.history = options.history.slice(0, options.pos + 1);
    options.history.push(photo.id);
    if (options.history.length > HISTORY_SIZE) options.history.shift();
    options.pos = options.history.length - 1;
  }

  function due() {
    if (!options.id || !find(options.id)) return true;
    if (options.paused || options.every < 0) return false;
    return options.every === 0 || Date.now() - options.at >= options.every * 1000;
  }

  function addStyle() {
    if (styled) return;
    styled = true;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = STYLESHEET;
    document.head.appendChild(link);
  }

  var ICONS = {
    prev: '<path d="M15 5l-7 7 7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    play: '<path d="M8 5l11 7-11 7z"/>'
  };

  function icon(name) {
    return (
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      ICONS[name] +
      "</svg>"
    );
  }

  function link(label, href) {
    var anchor = document.createElement("a");
    anchor.href = href;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    anchor.textContent = label;
    return anchor;
  }

  function control(name, label, action, disabled) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "bg-control";
    button.innerHTML = icon(name);
    button.setAttribute("aria-label", label);
    button.title = label;
    button.disabled = !!disabled;
    button.onclick = action;
    return button;
  }

  // The credit and the previous / pause / next buttons, on one line under the footer links
  function paintCredit(photo) {
    var footer = document.querySelector(".footer");
    if (credit && credit.parentNode) credit.parentNode.removeChild(credit);
    credit = null;
    if (!photo || !footer) return;
    credit = document.createElement("p");
    credit.className = "bg-credit";
    var line = document.createElement("span");
    line.appendChild(document.createTextNode(text("background.photo", "Photo") + ": "));
    line.appendChild(link(photo.author, "https://unsplash.com/@" + photo.handle + UTM));
    line.appendChild(document.createTextNode(" / "));
    line.appendChild(link("Unsplash", "https://unsplash.com/" + UTM));
    if (explicit) {
      credit.appendChild(line);
    } else {
      // Previous on the left, the credit between, pause (when photos change by time) and next on the right
      credit.appendChild(control("prev", text("background.prev", "Previous photo"), previous, options.pos <= 0));
      credit.appendChild(line);
      if (options.every > 0) {
        var paused = options.paused;
        credit.appendChild(
          control(
            paused ? "play" : "pause",
            paused ? text("background.play", "Resume changes") : text("background.pause", "Pause changes"),
            function () {
              setPaused(!options.paused);
            }
          )
        );
      }
      credit.appendChild(control("next", text("background.next", "Next photo"), next));
    }
    footer.insertBefore(credit, footer.querySelector(".poweredby"));
  }

  function clear() {
    root.removeAttribute("data-background");
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    layer = null;
    paintCredit(null);
  }

  function paint(photo) {
    var mine = ++ticket;
    load().then(function () {
      addStyle();
      var url = BASE + photo.file;
      var image = new Image();
      image.onload = function () {
        if (mine !== ticket) return;
        var fresh = !layer;
        if (fresh) {
          layer = document.createElement("div");
          layer.className = "bg-photo";
          layer.setAttribute("aria-hidden", "true");
          document.body.insertBefore(layer, document.body.firstChild);
        }
        layer.style.backgroundImage = 'url("' + url + '")';
        root.setAttribute("data-background", photo.id);
        paintCredit(photo);
        // The fade starts after the first paint with the photo
        window.requestAnimationFrame(function () {
          if (layer) layer.className = "bg-photo bg-ready";
        });
      };
      image.src = url;
    });
  }

  // A test running right now (the speed test page and the stability page keep that in a global each)
  function busy() {
    try {
      if (window.s && typeof window.s.getState === "function" && window.s.getState() === 3) return true;
    } catch (error) {
      // Not the speed test page
    }
    return window.running === true;
  }

  function show(photo) {
    if (!photo) return;
    paint(photo);
    schedule();
  }

  function schedule() {
    window.clearTimeout(timer);
    timer = null;
    if (options.mode !== "packs" || explicit || options.paused || options.every <= 0) return;
    var wait = Math.max(1000, options.at + options.every * 1000 - Date.now());
    timer = window.setTimeout(function tick() {
      if (busy() || document.hidden) {
        timer = window.setTimeout(tick, 30000);
        return;
      }
      load().then(function () {
        var photo = pick();
        if (photo) {
          remember(photo);
          writeStore();
          notify();
          show(photo);
        }
      });
    }, wait);
  }

  function next() {
    if (options.mode !== "packs") return;
    load().then(function () {
      if (options.pos < options.history.length - 1) {
        options.pos++;
        options.id = options.history[options.pos];
        options.at = Date.now();
      } else {
        var photo = pick();
        if (!photo) return;
        remember(photo);
      }
      writeStore();
      notify();
      show(find(options.id));
    });
  }

  function previous() {
    if (options.mode !== "packs" || options.pos <= 0) return;
    options.pos--;
    options.id = options.history[options.pos];
    options.at = Date.now();
    writeStore();
    notify();
    load().then(function () {
      show(find(options.id));
    });
  }

  function setMode(mode) {
    if (MODES.indexOf(mode) < 0) return false;
    options.mode = mode;
    explicit = null;
    writeStore();
    if (mode === "none") {
      ticket++;
      window.clearTimeout(timer);
      clear();
    } else {
      start();
    }
    notify();
    return true;
  }

  function setPacks(ids) {
    options.packs = ids;
    var current = find(options.id);
    // The photo on show leaves with its pack
    if (current && ids.length && ids.indexOf(current.pack) < 0) options.id = null;
    writeStore();
    if (options.mode === "packs") start();
    notify();
  }

  function setEvery(value) {
    if (EVERY.indexOf(value) < 0) return false;
    options.every = value;
    options.at = Date.now();
    writeStore();
    schedule();
    paintCredit(find(options.id));
    notify();
    return true;
  }

  function setPaused(paused) {
    options.paused = !!paused;
    options.at = Date.now();
    writeStore();
    schedule();
    paintCredit(find(options.id));
    notify();
  }

  function setMatch(match) {
    options.match = !!match;
    writeStore();
    notify();
  }

  // Show the photo the options ask for: the one saved, or a new one when it is time
  function start() {
    if (saveData()) return;
    load().then(function () {
      if (explicit) {
        show(find(explicit));
        return;
      }
      if (options.mode !== "packs") return;
      var photo = due() ? pick() : find(options.id);
      if (!photo) return;
      if (photo.id !== options.id || options.history.length === 0) remember(photo);
      writeStore();
      show(photo);
    });
  }

  // Waiting for the page to finish loading, so the photo never delays the first paint
  function begin() {
    var run = function () {
      if (explicit || options.mode === "packs") start();
    };
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run);
  }

  // The site defaults (better-defaults.js) first, then what the visitor chose over them
  var site = window.LibreSpeedDefaults && window.LibreSpeedDefaults.background;
  if (site && MODES.indexOf(site.mode) >= 0) options.mode = site.mode;
  if (site && EVERY.indexOf(site.every) >= 0) options.every = site.every;
  loadOptions();
  var param = new URLSearchParams(window.location.search).get("background");
  if (param === "none") options.mode = "none";
  else if (param && /^[a-z0-9-]+$/.test(param)) explicit = param;
  if (document.body) begin();
  else document.addEventListener("DOMContentLoaded", begin);

  // A new photo that fits the mode when the page changes from dark to light or back
  window.addEventListener("themechange", function () {
    if (explicit || options.mode !== "packs" || !options.match || !photos.length) return;
    var current = find(options.id);
    if (current && current.tone !== wantedTone() && !busy()) {
      var photo = pick();
      if (photo) {
        remember(photo);
        writeStore();
        show(photo);
        notify();
      }
    }
  });

  return {
    load: load,
    modes: MODES,
    everyValues: EVERY,
    mode: function () {
      return options.mode;
    },
    packs: chosenPacks,
    every: function () {
      return options.every;
    },
    paused: function () {
      return options.paused;
    },
    match: function () {
      return options.match;
    },
    setMode: setMode,
    setPacks: setPacks,
    setEvery: setEvery,
    setPaused: setPaused,
    setMatch: setMatch,
    next: next,
    previous: previous
  };
})();
