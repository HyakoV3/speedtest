/* exported LibreSpeedTheme */
/**
 * Theme options for the better pages
 *
 * Mode: auto (follows the system), light or dark. The resolved mode is kept on <html> as data-theme, which the
 * tokens in styling/tokens.css use.
 * Brand color: one of the PALETTE entries, as a hue and a chroma that drive the color tokens (--brand-h, --brand-c).
 * Corner radius: a level for the buttons (0 to 5, the last one is a pill) and one for the boxes (0 to 4).
 *
 * Footer style: text, chips or bar (data-footer on <html>).
 *
 * The URL parameters ?theme=auto|light|dark, ?brand=<id> and ?footer=text|chips|bar win over the saved choices, which are kept in localStorage.
 * An unknown value is ignored. Load this file in the <head>, before the page is painted.
 *
 * LibreSpeedTheme.set(mode, save), .setBrand(id, save), .setRadius(kind, level, save) and .setFooter(style, save)
 * change one option. They fire
 * "themechange" on window, so pages can repaint what they draw on a canvas.
 */
var LibreSpeedTheme = (function () {
  "use strict";

  var PREFIX = "librespeed-better-";
  var MODES = ["auto", "light", "dark"];
  // Hue and chroma (OKLCH) of each brand color
  var PALETTE = [
    { id: "violet", h: 294, c: 0.13 },
    { id: "blue", h: 255, c: 0.17 },
    { id: "teal", h: 190, c: 0.13 },
    { id: "green", h: 150, c: 0.16 },
    { id: "amber", h: 75, c: 0.15 },
    { id: "rose", h: 15, c: 0.19 },
    { id: "indigo", h: 272, c: 0.18 },
    { id: "cyan", h: 215, c: 0.14 },
    { id: "emerald", h: 165, c: 0.15 },
    { id: "orange", h: 50, c: 0.18 },
    { id: "fuchsia", h: 325, c: 0.21 },
    { id: "coral", h: 32, c: 0.19 }
  ];
  var PILL = 9999;
  var RADIUS = {
    button: { levels: [0, 0.25, 0.5, 0.75, 1, PILL], property: "--radius-button", fallback: 3 },
    card: { levels: [0, 0.25, 0.5, 0.75, 1], property: "--radius-card", fallback: 4 }
  };
  var DEFAULT_BRAND = "blue";
  var FOOTERS = ["text", "chips", "bar"];

  var root = document.documentElement;
  var params = new URLSearchParams(window.location.search);
  var mode = "auto";
  var brandId = DEFAULT_BRAND;
  var footerStyle = "text";
  var levels = { button: RADIUS.button.fallback, card: RADIUS.card.fallback };
  var systemQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function read(key) {
    try {
      return window.localStorage.getItem(PREFIX + key);
    } catch (error) {
      return null;
    }
  }

  function save(key, value) {
    try {
      window.localStorage.setItem(PREFIX + key, value);
    } catch (error) {
      // The choice then only lasts until the page is closed
    }
  }

  function findBrand(id) {
    for (var i = 0; i < PALETTE.length; i++) if (PALETTE[i].id === id) return PALETTE[i];
    return null;
  }

  function lengthOf(kind, level) {
    var value = RADIUS[kind].levels[level];
    return value === PILL ? PILL + "px" : value + "rem";
  }

  function notifyChange() {
    var event = document.createEvent("Event");
    event.initEvent("themechange", false, false);
    window.dispatchEvent(event);
  }

  function isDark() {
    return root.getAttribute("data-theme") === "dark";
  }

  function paintMode() {
    var dark = mode === "auto" ? !!(systemQuery && systemQuery.matches) : mode === "dark";
    root.setAttribute("data-theme", dark ? "dark" : "light");
  }

  function paintBrand() {
    var brand = findBrand(brandId);
    root.style.setProperty("--brand-h", brand.h);
    root.style.setProperty("--brand-c", brand.c);
  }

  function paintRadius(kind) {
    root.style.setProperty(RADIUS[kind].property, lengthOf(kind, levels[kind]));
  }

  function set(name, persist) {
    if (MODES.indexOf(name) < 0) return false;
    mode = name;
    if (persist) save("theme", name);
    paintMode();
    notifyChange();
    return true;
  }

  function setBrand(id, persist) {
    if (!findBrand(id)) return false;
    brandId = id;
    if (persist) save("brand", id);
    paintBrand();
    notifyChange();
    return true;
  }

  function setFooter(style, persist) {
    if (FOOTERS.indexOf(style) < 0) return false;
    footerStyle = style;
    if (persist) save("footer", style);
    root.setAttribute("data-footer", style);
    notifyChange();
    return true;
  }

  function setRadius(kind, level, persist) {
    if (!RADIUS[kind] || !(level >= 0 && level < RADIUS[kind].levels.length)) return false;
    levels[kind] = level;
    if (persist) save("radius-" + kind, String(level));
    paintRadius(kind);
    notifyChange();
    return true;
  }

  // The saved choices, then the URL parameters, before the page is painted
  var savedMode = read("theme");
  if (MODES.indexOf(params.get("theme")) >= 0) mode = params.get("theme");
  else if (MODES.indexOf(savedMode) >= 0) mode = savedMode;
  if (findBrand(params.get("brand"))) brandId = params.get("brand");
  else if (findBrand(read("brand"))) brandId = read("brand");
  if (FOOTERS.indexOf(params.get("footer")) >= 0) footerStyle = params.get("footer");
  else if (FOOTERS.indexOf(read("footer")) >= 0) footerStyle = read("footer");
  root.setAttribute("data-footer", footerStyle);
  Object.keys(RADIUS).forEach(function (kind) {
    var saved = parseInt(read("radius-" + kind), 10);
    if (saved >= 0 && saved < RADIUS[kind].levels.length) levels[kind] = saved;
    paintRadius(kind);
  });
  paintMode();
  paintBrand();

  // Without a choice the page follows the system while it is open
  if (systemQuery && systemQuery.addEventListener) {
    systemQuery.addEventListener("change", function () {
      if (mode !== "auto") return;
      paintMode();
      notifyChange();
    });
  }

  return {
    modes: MODES,
    palette: PALETTE,
    footers: FOOTERS,
    footer: function () {
      return footerStyle;
    },
    radiusLevels: function (kind) {
      return RADIUS[kind].levels;
    },
    mode: function () {
      return mode;
    },
    brand: function () {
      return brandId;
    },
    radius: function (kind) {
      return levels[kind];
    },
    lengthOf: lengthOf,
    isDark: isDark,
    set: set,
    setBrand: setBrand,
    setFooter: setFooter,
    setRadius: setRadius
  };
})();
