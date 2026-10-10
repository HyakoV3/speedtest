/* exported LibreSpeedToast */
/**
 * Toasts for the better pages: short messages at the bottom left of the page that go away by themselves.
 *
 * LibreSpeedToast.show(text)         shows a message
 * LibreSpeedToast.once(key, text)    the same, but only the first time in this session (this tab): a reload or a new
 *                                    page of the same tab does not show it again. Without sessionStorage it is only
 *                                    once for each page load
 * LibreSpeedToast.readTime(text)     how long a message stays, in milliseconds
 *
 * Several messages are shown together, piled up: the newest at the bottom, close to the corner, and the older ones above
 * it, up to three at a time (the others wait for a place). A message stays as long as it takes to read it: three seconds
 * and a little for each letter, from five to fourteen seconds, and a second and a half more for each other message that is
 * on the page, so a pile gives more time to read. When a message comes while others are there, the others stay at least
 * that long too.
 *
 * The messages go in a polite live region, so a screen reader reads them without taking the focus. A toast stays while it
 * has the focus (its close button) and has a close button; it does not catch the mouse, so it never covers a control of
 * the page. The style is in better.css (.toast-region, .toast).
 */
var LibreSpeedToast = (function () {
  "use strict";

  var MAX_VISIBLE = 3;
  // Time to read: a base, and a little for each letter, kept between a least and a most
  var BASE = 3000;
  var PER_LETTER = 55;
  var LEAST = 5000;
  var MOST = 14000;
  // What each other message on the page adds to the time of one
  var PER_OTHER = 1500;
  // The time the toast takes to fade out before it is taken from the page
  var LEAVING = 250;
  var PREFIX = "librespeed-better-toast-";
  var queue = [];
  var visible = [];
  var shown = {};
  var region = null;

  function text(key, fallback) {
    return window.LibreSpeedI18n ? window.LibreSpeedI18n.t(key, fallback) : fallback;
  }

  function now() {
    return window.performance && window.performance.now ? window.performance.now() : Date.now();
  }

  function readTime(message) {
    return Math.min(MOST, Math.max(LEAST, BASE + PER_LETTER * String(message).length));
  }

  // The live region exists before the first message, so the screen readers have it when the message is added
  function ensureRegion() {
    if (region || !document.body) return region;
    region = document.createElement("div");
    region.id = "toastRegion";
    region.className = "toast-region";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.appendChild(region);
    return region;
  }

  // The toast goes away at its time, which only ever moves later: more messages on the page, more time to read
  function schedule(item) {
    clearTimeout(item.timer);
    if (item.leaving || item.held) return;
    var wanted = readTime(item.message) + PER_OTHER * Math.max(0, visible.length - 1);
    item.until = Math.max(item.until || 0, now() + wanted);
    item.timer = setTimeout(
      function () {
        leave(item);
      },
      Math.max(0, item.until - now())
    );
  }

  function leave(item) {
    if (item.leaving) return;
    item.leaving = true;
    clearTimeout(item.timer);
    item.box.classList.remove("visible");
    setTimeout(function () {
      item.box.remove();
      visible.splice(visible.indexOf(item), 1);
      next();
    }, LEAVING);
  }

  function build(message) {
    var box = document.createElement("div");
    box.className = "toast";
    var content = document.createElement("span");
    content.className = "toast-text";
    content.textContent = message;
    var close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.textContent = "×";
    var label = text("dialog.close", "Close");
    close.setAttribute("aria-label", label);
    close.title = label;
    box.appendChild(content);
    box.appendChild(close);
    return { box: box, close: close, message: message, until: 0, timer: null, held: false, leaving: false };
  }

  // Puts a message on the page. It is a function of its own so each toast has its own item for its buttons and its timer
  function place(message) {
    var item = build(message);
    item.close.onclick = function () {
      leave(item);
    };
    // While the person is on the close button the message stays, and its time starts again when the focus leaves
    item.box.addEventListener("focusin", function () {
      item.held = true;
      clearTimeout(item.timer);
    });
    item.box.addEventListener("focusout", function () {
      item.held = false;
      item.until = 0;
      schedule(item);
    });
    visible.push(item);
    region.appendChild(item.box);
    // The next frame, so the fade in has a state to start from
    window.requestAnimationFrame(function () {
      item.box.classList.add("visible");
    });
  }

  // Brings the waiting messages in, while there is room; a newcomer gives the ones that are there more time too
  function next() {
    if (!ensureRegion()) return;
    var added = false;
    while (queue.length && visible.filter(isStaying).length < MAX_VISIBLE) {
      place(queue.shift());
      added = true;
    }
    if (added) {
      for (var i = 0; i < visible.length; i++) schedule(visible[i]);
    }
  }

  function isStaying(item) {
    return !item.leaving;
  }

  function show(message) {
    if (!message) return;
    queue.push(message);
    next();
  }

  function once(key, message) {
    var name = PREFIX + key;
    if (shown[name]) return;
    shown[name] = true;
    try {
      if (window.sessionStorage.getItem(name)) return;
      window.sessionStorage.setItem(name, "1");
    } catch (error) {
      // Without storage it is once for each page load
    }
    show(message);
  }

  // The region is made as soon as the page has a body
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensureRegion);
  else ensureRegion();

  return { show: show, once: once, readTime: readTime };
})();
