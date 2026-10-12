/*
 * The panel at the side of the route page: the card "Your route to the server" (the command, the box to paste, the button of the browser
 * extension) lives in it, so that the page itself is about the way from the server. It is NOT a dialog: the page behind stays usable, nothing is
 * made inert and the focus is not held (Tab leaves it). It opens with the button on the edge of the screen;
 * Esc or its cross close it and the focus goes back to what opened it. On a wide screen it is a card at the right; on a narrow one a sheet at
 * the bottom. Whether it was left open is remembered (try/catch), and only a wide screen opens it by itself, never a phone.
 */
window.LibreSpeedRouteSide = (function () {
  "use strict";

  var KEY = "librespeed-better-route-side";
  var WIDE = "(min-width: 37.5em)";

  function create(options) {
    var panel = options.panel;
    var toggle = options.toggle;
    var closeButton = options.close;
    var heading = options.heading;
    var query = window.matchMedia ? window.matchMedia(WIDE) : null;
    var available = false;
    var opener = null;

    function isWide() {
      return query ? query.matches : true;
    }

    function isOpen() {
      return !panel.hidden;
    }

    // The two openers say whether the panel is open; the edge button is not needed while a sheet covers the screen
    function sync() {
      var open = isOpen();
      toggle.setAttribute("aria-expanded", String(open));
      toggle.hidden = !available || (open && !isWide());
      document.body.classList.toggle("route-side-on", !toggle.hidden);
    }

    function save(open) {
      try {
        window.localStorage.setItem(KEY, open ? "open" : "closed");
      } catch (error) {
        // It only lasts until the page is closed
      }
    }

    // by: what opened it (the focus goes back to it); quiet: no focus moved and nothing saved (restoring it at the start)
    function open(by, quiet) {
      if (!available || isOpen()) return;
      opener = by || toggle;
      panel.hidden = false;
      sync();
      if (typeof options.onOpen === "function") options.onOpen();
      if (quiet) return;
      save(true);
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }

    function close(quiet) {
      if (!isOpen()) return;
      var inside = panel.contains(document.activeElement);
      panel.hidden = true;
      sync();
      if (quiet) return;
      save(false);
      if (!inside) return;
      var back = opener && !opener.hidden && document.documentElement.contains(opener) ? opener : toggle;
      if (!back.hidden) back.focus();
    }

    toggle.addEventListener("click", function () {
      if (isOpen()) close(false);
      else open(toggle, false);
    });
    closeButton.addEventListener("click", function () {
      close(false);
    });
    // Esc is heard here and goes no further (the theme panel closes itself on Esc at the document, and it would take the focus too)
    panel.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || event.isComposing) return;
      event.stopPropagation();
      close(false);
    });
    if (query && query.addEventListener) {
      query.addEventListener("change", sync);
    }
    sync();

    return {
      open: function () {
        open(toggle, false);
      },
      close: function () {
        close(false);
      },
      isOpen: isOpen,
      // The button is there only while the route is on
      setAvailable: function (value) {
        available = value === true;
        if (!available) close(true);
        sync();
      },
      // A wide screen opens it by itself if it was left open; a phone never does
      restore: function () {
        var saved = null;
        try {
          saved = window.localStorage.getItem(KEY);
        } catch (error) {
          saved = null;
        }
        if (saved === "open" && isWide()) open(toggle, true);
      },
      // On a narrow screen the sheet would cover what was just drawn: it goes, quietly
      closeIfNarrow: function () {
        if (!isWide()) close(true);
      },
      isWide: isWide
    };
  }

  return { create: create };
})();
