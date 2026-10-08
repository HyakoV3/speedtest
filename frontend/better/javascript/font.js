/* exported LibreSpeedFont */
/**
 * Font sets for the better pages
 *
 * Three sets besides the default font of the pages (the default is "system"):
 *   inter, sora, manrope
 * The choice is kept on <html> as data-font (the attribute does not exist for "system"). The URL parameter
 * ?font= wins over the saved choice, which is kept in localStorage. An unknown value is ignored.
 *
 * The fonts and the rules that use them are in ../styling/font-sets.css, which is only requested when
 * a set is chosen, so the default font downloads and changes nothing.
 *
 * Markup used by the pages: <select data-font-select> with the values system, inter, sora and manrope.
 *
 * LibreSpeedFont.family(role, fallback) is the font family a canvas should use ("body" or "mono"), or the
 * fallback when no set is active. A "fontchange" event is fired on window after a change and when the
 * fonts of the set are ready, so pages can redraw what they paint on a canvas.
 */
var LibreSpeedFont = (function () {
  "use strict";

  var SETS = ["system", "inter", "sora", "manrope"];
  var STORAGE_KEY = "librespeed-better-font";
  var STYLESHEET = new URL("../styling/font-sets.css", document.currentScript.src).href;
  var FACES = [
    ["400", "--font-body"],
    ["600", "--font-display"],
    ["600", "--font-num"],
    ["500", "--font-mono"]
  ];
  var root = document.documentElement;
  var stylesheet = null;

  function current() {
    return root.getAttribute("data-font") || "system";
  }

  function readSetting() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function notifyChange() {
    var event = document.createEvent("Event");
    event.initEvent("fontchange", false, false);
    window.dispatchEvent(event);
  }

  // The stylesheet is added the first time a set is used and switched off for "system"
  function updateStylesheet() {
    if (current() === "system") {
      if (stylesheet) stylesheet.media = "not all";
      return;
    }
    if (!stylesheet) {
      stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = STYLESHEET;
      document.head.appendChild(stylesheet);
    }
    stylesheet.media = "all";
  }

  function updateSelects() {
    var selects = document.querySelectorAll("[data-font-select]");
    for (var i = 0; i < selects.length; i++) selects[i].value = current();
  }

  // Canvas text only uses a web font once it has loaded: wait for the faces of the set, then ask for a redraw
  function loadFaces() {
    if (current() === "system" || !document.fonts || !document.fonts.load || !stylesheet) return;
    var chosen = current();
    var load = function () {
      var style = getComputedStyle(root);
      Promise.all(
        FACES.map(function (face) {
          var family = style.getPropertyValue(face[1]).trim();
          return family ? document.fonts.load(face[0] + " 1em " + family).catch(function () {}) : Promise.resolve();
        })
      ).then(function () {
        if (current() === chosen) notifyChange();
      });
    };
    if (stylesheet.sheet) load();
    else stylesheet.addEventListener("load", load, { once: true });
  }

  function set(name, save) {
    if (SETS.indexOf(name) < 0) return false;
    if (name === "system") root.removeAttribute("data-font");
    else root.setAttribute("data-font", name);
    if (save) {
      try {
        window.localStorage.setItem(STORAGE_KEY, name);
      } catch (error) {
        // The choice then only lasts until the page is closed
      }
    }
    updateStylesheet();
    updateSelects();
    loadFaces();
    notifyChange();
    return true;
  }

  function family(role, fallback) {
    if (current() === "system") return fallback;
    var value = getComputedStyle(root)
      .getPropertyValue(role === "mono" ? "--font-mono" : "--font-body")
      .trim();
    return value || fallback;
  }

  // The saved choice is restored before the page is painted; ?font= wins over it, and it wins over the site default
  var requested = new URLSearchParams(window.location.search).get("font");
  var initial = SETS.indexOf(requested) >= 0 ? requested : readSetting();
  // Without a choice the site default (better-defaults.js) applies
  if (SETS.indexOf(initial) < 0 && window.LibreSpeedDefaults) initial = window.LibreSpeedDefaults.font;
  if (SETS.indexOf(initial) >= 0 && initial !== "system") {
    root.setAttribute("data-font", initial);
    updateStylesheet();
  }

  document.addEventListener("DOMContentLoaded", function () {
    updateSelects();
    loadFaces();
  });
  document.addEventListener("change", function (event) {
    if (event.target.hasAttribute && event.target.hasAttribute("data-font-select")) set(event.target.value, true);
  });

  return { sets: SETS, family: family, set: set, current: current };
})();
