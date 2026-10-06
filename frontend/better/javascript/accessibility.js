/**
 * Accessibility options for the better pages
 *
 * 1. Text size: five steps applied to the root font size, so every size written in em scales with it
 * 2. High contrast: black background, white text and yellow accents (class "high-contrast" on <html>)
 *
 * The choices are saved in localStorage. Without a saved choice, high contrast follows the system
 * preference (prefers-contrast: more).
 *
 * Markup used by the pages (the theme panel builds it):
 *   <button data-text-size="smaller|reset|larger">
 *   <button data-contrast-toggle>
 *
 * An "accessibilitychange" event is fired on window after every change, so pages can repaint whatever
 * they draw on a canvas. LibreSpeedAccessibility.isHighContrast() tells the current state.
 */
(function () {
  "use strict";

  var SIZE_KEY = "librespeed-better-text-size";
  var CONTRAST_KEY = "librespeed-better-high-contrast";
  // Root font size in percent, from smaller to larger. The default is the second step
  var SIZES = [87.5, 100, 112.5, 125, 150];
  var DEFAULT_SIZE = 1;

  var sizeStep = DEFAULT_SIZE;
  var highContrast = false;

  function readSetting(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      // Storage can be unavailable (private mode, blocked cookies)
      return null;
    }
  }

  function saveSetting(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // The choice then only lasts until the page is closed
    }
  }

  function systemPrefersContrast() {
    return !!(window.matchMedia && window.matchMedia("(prefers-contrast: more)").matches);
  }

  function applySize() {
    var root = document.documentElement;
    if (sizeStep === DEFAULT_SIZE) {
      root.style.removeProperty("font-size");
    } else {
      root.style.fontSize = SIZES[sizeStep] + "%";
    }
  }

  function applyContrast() {
    var root = document.documentElement;
    if (highContrast) {
      root.classList.add("high-contrast");
    } else {
      root.classList.remove("high-contrast");
    }
  }

  // Reflect the state on the buttons: pressed contrast toggle, size buttons disabled at the ends
  function updateButtons() {
    var buttons = document.querySelectorAll("[data-text-size]");
    for (var i = 0; i < buttons.length; i++) {
      var action = buttons[i].getAttribute("data-text-size");
      buttons[i].disabled =
        (action === "smaller" && sizeStep === 0) || (action === "larger" && sizeStep === SIZES.length - 1);
      buttons[i].setAttribute("aria-pressed", action === "reset" ? String(sizeStep === DEFAULT_SIZE) : "false");
    }
    var toggles = document.querySelectorAll("[data-contrast-toggle]");
    for (var j = 0; j < toggles.length; j++) {
      toggles[j].setAttribute("aria-pressed", String(highContrast));
    }
  }

  function notifyChange() {
    var event = document.createEvent("Event");
    event.initEvent("accessibilitychange", false, false);
    window.dispatchEvent(event);
  }

  function setSizeStep(step) {
    if (step < 0 || step >= SIZES.length) return;
    sizeStep = step;
    saveSetting(SIZE_KEY, String(step));
    applySize();
    updateButtons();
    notifyChange();
  }

  function setHighContrast(enabled) {
    highContrast = enabled;
    saveSetting(CONTRAST_KEY, enabled ? "true" : "false");
    applyContrast();
    updateButtons();
    notifyChange();
  }

  function onClick(event) {
    var target = event.target.closest ? event.target.closest("[data-text-size], [data-contrast-toggle]") : null;
    if (!target) return;
    event.preventDefault();
    if (target.hasAttribute("data-contrast-toggle")) {
      setHighContrast(!highContrast);
      return;
    }
    var action = target.getAttribute("data-text-size");
    if (action === "smaller") setSizeStep(sizeStep - 1);
    if (action === "larger") setSizeStep(sizeStep + 1);
    if (action === "reset") setSizeStep(DEFAULT_SIZE);
  }

  // Restore the saved choices before the page is painted
  var savedSize = parseInt(readSetting(SIZE_KEY), 10);
  if (savedSize >= 0 && savedSize < SIZES.length) sizeStep = savedSize;
  var savedContrast = readSetting(CONTRAST_KEY);
  highContrast = savedContrast === null ? systemPrefersContrast() : savedContrast === "true";
  applySize();
  applyContrast();

  document.addEventListener("click", onClick);
  document.addEventListener("DOMContentLoaded", updateButtons);

  window.LibreSpeedAccessibility = {
    isHighContrast: function () {
      return highContrast;
    }
  };
})();
