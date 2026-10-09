/* exported LibreSpeedIcons */
/**
 * Icons of the better pages, in the icon set the visitor chose.
 *
 * The icons come from ../icons/subset.json (see ../icons/README.md): a few icons in each of the sets the theme panel
 * offers. They are files of this server, nothing is asked of Iconify or of anyone else when the page opens. The choice is
 * kept in localStorage. The URL parameter ?icons=<id> wins over the saved choice, and the saved choice wins over the
 * site default (LibreSpeedDefaults.icons in better-defaults.js), which wins over the default of the file.
 *
 * The weight of the icons is the URL parameter ?weight=light|regular|bold, then the site default
 * (LibreSpeedDefaults.weight), then regular. Only a set that draws its icons in that weight (Phosphor) changes: the others
 * stay in regular. <html> gets data-icons-weight="<weight>" with the weight asked for.
 *
 * Where an icon is drawn:
 *   - LibreSpeedIcons.html(name, size) is an <svg> to put in an element (size: "18" for pixels, or "1.15em")
 *   - an element with data-icon="name" gets its icon, and the text it had stays until the icon is there
 *   - the style sheet icons.css draws the carets and the check marks from the CSS variables --icon-chevron-down,
 *     --icon-chevron-right and --icon-check, and the arrow of the selects from --icon-select-arrow (and the same arrow
 *     in the color of high contrast, --icon-select-arrow-contrast). <html> gets data-icons="<id>" when they are set.
 *
 * LibreSpeedIcons.ready resolves once the file was read, .sets() is the list of { id, name, ... }, .current() the id in use
 * and .set(id, save) changes it. "iconschange" is fired on window after the icons were first set and after every change.
 */
var LibreSpeedIcons = (function () {
  "use strict";

  var STORAGE_KEY = "librespeed-better-icons";
  var SUBSET = new URL("../icons/subset.json", document.currentScript.src).href;
  var root = document.documentElement;
  var WEIGHTS = ["light", "regular", "bold"];
  var data = null;
  var current = null;
  var weight = "regular";

  function findSet(id) {
    if (!data) return null;
    for (var i = 0; i < data.sets.length; i++) if (data.sets[i].id === id) return data.sets[i];
    return null;
  }

  function saved() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  // The drawing of an icon: in the weight asked for when the set has it, in regular when it does not
  function body(set, name) {
    var other = weight !== "regular" && set.weights && set.weights[weight];
    return (other && other[name]) || set.icons[name];
  }

  function weightAtStart() {
    var requested = new URLSearchParams(window.location.search).get("weight");
    var site = window.LibreSpeedDefaults && window.LibreSpeedDefaults.weight;
    if (WEIGHTS.indexOf(requested) >= 0) return requested;
    if (WEIGHTS.indexOf(site) >= 0) return site;
    return "regular";
  }

  function chosenAtStart() {
    var requested = new URLSearchParams(window.location.search).get("icons");
    var site = window.LibreSpeedDefaults && window.LibreSpeedDefaults.icons;
    var candidates = [requested, saved(), site, data.default];
    for (var i = 0; i < candidates.length; i++) if (findSet(candidates[i])) return candidates[i];
    return data.sets[0].id;
  }

  // The <svg> of an icon of the current set, or "" when the set is not there (yet)
  function html(name, size) {
    var set = findSet(current);
    if (!set || !set.icons[name]) return "";
    var side = size === undefined || size === null ? "1em" : size;
    return (
      '<svg viewBox="' +
      set.viewBox +
      '" width="' +
      side +
      '" height="' +
      side +
      '" aria-hidden="true" focusable="false">' +
      body(set, name) +
      "</svg>"
    );
  }

  // The icon as a CSS url(): black for a mask (only its shape counts), or in the color asked for
  function cssUrl(name, color) {
    var set = findSet(current);
    if (!set || !set.icons[name]) return "";
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' +
      set.viewBox +
      '">' +
      body(set, name).replace(/currentColor/g, color || "#000") +
      "</svg>";
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }

  function paint() {
    var variables = {
      "--icon-chevron-down": cssUrl("chevron-down"),
      "--icon-chevron-right": cssUrl("chevron-right"),
      "--icon-check": cssUrl("check"),
      "--icon-select-arrow": cssUrl("chevron-down", "#808080"),
      "--icon-select-arrow-contrast": cssUrl("chevron-down", "#facc15")
    };
    Object.keys(variables).forEach(function (name) {
      root.style.setProperty(name, variables[name]);
    });
    root.setAttribute("data-icons", current);
    root.setAttribute("data-icons-weight", weight);
    var slots = document.querySelectorAll("[data-icon]");
    for (var i = 0; i < slots.length; i++) {
      var icon = html(slots[i].getAttribute("data-icon"));
      if (icon) slots[i].innerHTML = icon;
    }
    window.dispatchEvent(new Event("iconschange"));
  }

  function set(id, persist) {
    if (!findSet(id)) return false;
    current = id;
    if (persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, id);
      } catch (error) {
        // The choice then only lasts until the page is closed
      }
    }
    paint();
    return true;
  }

  var ready = window
    .fetch(SUBSET)
    .then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then(function (json) {
      data = json;
      current = chosenAtStart();
      weight = weightAtStart();
      // The elements with data-icon exist once the page is parsed
      if (document.readyState === "loading") {
        return new Promise(function (resolve) {
          document.addEventListener("DOMContentLoaded", resolve);
        });
      }
    })
    .then(function () {
      if (data) paint();
    })
    .catch(function (error) {
      // Without the file the pages keep the signs they have in text and in the style sheet
      console.warn("The icons are not available:", error);
    });

  return {
    ready: ready,
    html: html,
    set: set,
    current: function () {
      return current;
    },
    weights: WEIGHTS,
    weight: function () {
      return weight;
    },
    sets: function () {
      return data ? data.sets : [];
    }
  };
})();
