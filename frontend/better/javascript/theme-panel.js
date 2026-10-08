/**
 * Theme panel of the better pages
 *
 * A round button in the top right corner that opens a box with every option of the page: mode, brand color, corner
 * radius, chart style (when the page has one), footer style, background (when the pack has photos), font, text size, high contrast and language.
 * The options are applied by theme.js, font.js, accessibility.js and i18n.js, this file only builds the controls.
 * A page with a chart style option sets window.LibreSpeedChartStyle = { list: [ids], get(), set(id) } before this file.
 *
 * Needs theme.js, font.js, accessibility.js and i18n.js.
 */
(function () {
  "use strict";

  var Theme = window.LibreSpeedTheme;
  var Font = window.LibreSpeedFont;
  var I18n = window.LibreSpeedI18n;
  var ChartStyle = window.LibreSpeedChartStyle;
  var refreshers = [];

  var SUN =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function t(key, fallback, parameters) {
    return I18n.t(key, fallback, parameters);
  }

  function element(tag, className, attributes) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    for (var name in attributes || {}) node.setAttribute(name, attributes[name]);
    return node;
  }

  // Code that writes text or state, run now and again after a change of language or of any option
  function refresh(callback) {
    refreshers.push(callback);
    callback();
  }

  function refreshAll() {
    for (var i = 0; i < refreshers.length; i++) refreshers[i]();
  }

  function title(box, key, fallback, className) {
    var heading = element("p", "panel-title" + (className ? " " + className : ""));
    refresh(function () {
      heading.textContent = t(key, fallback);
    });
    box.appendChild(heading);
    return heading;
  }

  // A group of radio buttons. items: [{ id, label: function () { return "text"; } }]
  function radios(box, columns, labelKey, labelFallback, items, current, pick) {
    var group = element("div", "panel-options" + (columns ? " " + columns : ""), { role: "radiogroup" });
    var buttons = items.map(function (item) {
      var button = element("button", "panel-option", { type: "button", role: "radio" });
      button.onclick = function () {
        pick(item.id);
      };
      group.appendChild(button);
      return button;
    });
    refresh(function () {
      group.setAttribute("aria-label", t(labelKey, labelFallback));
      items.forEach(function (item, index) {
        buttons[index].textContent = item.label();
        buttons[index].setAttribute("aria-checked", String(item.id === current()));
      });
    });
    box.appendChild(group);
    return group;
  }

  function colorsSection(box) {
    var group = element("div", "panel-colors", { role: "radiogroup" });
    var buttons = Theme.palette.map(function (color) {
      var button = element("button", "panel-color", { type: "button", role: "radio" });
      button.style.background = "oklch(0.6 " + color.c + " " + color.h + ")";
      button.onclick = function () {
        Theme.setBrand(color.id, true);
      };
      group.appendChild(button);
      return button;
    });
    refresh(function () {
      group.setAttribute("aria-label", t("panel.color", "Brand color"));
      Theme.palette.forEach(function (color, index) {
        var name = t("color." + color.id, color.id);
        buttons[index].title = name;
        buttons[index].setAttribute("aria-label", name);
        buttons[index].setAttribute("aria-checked", String(color.id === Theme.brand()));
      });
    });
    box.appendChild(group);
  }

  function radiusSection(box, kind, key, fallback) {
    var group = element("div", "panel-radii", { role: "radiogroup" });
    var levels = Theme.radiusLevels(kind);
    var buttons = levels.map(function (value, index) {
      var button = element("button", "panel-radius", { type: "button", role: "radio" });
      button.style.borderRadius = Theme.lengthOf(kind, index);
      button.onclick = function () {
        Theme.setRadius(kind, index, true);
      };
      group.appendChild(button);
      return button;
    });
    refresh(function () {
      group.setAttribute("aria-label", t(key, fallback));
      levels.forEach(function (value, index) {
        var last = index === levels.length - 1 && kind === "button";
        var name = last ? t("panel.radius-max", "Maximum") : t("panel.radius-level", "Level {n}", { n: index + 1 });
        buttons[index].title = name;
        buttons[index].setAttribute("aria-label", name);
        buttons[index].setAttribute("aria-checked", String(index === Theme.radius(kind)));
      });
    });
    box.appendChild(group);
  }

  function appearanceSection(box) {
    var section = element("div", "panel-appearance");
    title(section, "panel.mode", "Mode");
    radios(
      section,
      "",
      "panel.mode",
      "Mode",
      Theme.modes.map(function (id) {
        return {
          id: id,
          label: function () {
            return t("panel.mode-" + id, id);
          }
        };
      }),
      Theme.mode,
      function (id) {
        Theme.set(id, true);
      }
    );
    title(section, "panel.color", "Brand color");
    colorsSection(section);
    title(section, "panel.radius-button", "Button rounding");
    radiusSection(section, "button", "panel.radius-button", "Button rounding");
    title(section, "panel.radius-card", "Box rounding");
    radiusSection(section, "card", "panel.radius-card", "Box rounding");
    box.appendChild(section);
  }

  function chartSection(box) {
    if (!ChartStyle) return;
    title(box, "panel.chart", "Chart style");
    radios(
      box,
      "",
      "panel.chart",
      "Chart style",
      ChartStyle.list.map(function (id) {
        return {
          id: id,
          label: function () {
            return t("chart." + id, id);
          }
        };
      }),
      ChartStyle.get,
      function (id) {
        ChartStyle.set(id, true);
        refreshAll();
      }
    );
  }

  function footerSection(box) {
    title(box, "panel.footer", "Footer style");
    radios(
      box,
      "",
      "panel.footer",
      "Footer style",
      Theme.footers.map(function (id) {
        return {
          id: id,
          label: function () {
            return t("footer." + id, id);
          }
        };
      }),
      Theme.footer,
      function (id) {
        Theme.setFooter(id, true);
      }
    );
  }

  // The photo background is off by default. Its list of packs is only requested the first time the panel opens, and
  // the section does not show when there are no packs. The packs and the change options show with the "packs" mode.
  function backgroundSection(box) {
    var Background = window.LibreSpeedBackground;
    if (!Background) return function () {};
    var holder = element("div");
    var requested = false;
    box.appendChild(holder);

    function everyLabel(seconds) {
      var fallbacks = {
        "-1": "Never",
        0: "Every load",
        300: "Every 5 min",
        900: "Every 15 min",
        3600: "Every hour",
        86400: "Every day",
        604800: "Every week"
      };
      return t("background.every-" + seconds, fallbacks[seconds]);
    }

    // A group of toggle buttons: items [{ id, label }], on(id) tells if it is selected, toggle(id) changes it
    function toggles(parent, labelKey, labelFallback, items, on, toggle) {
      var group = element("div", "panel-options two", { role: "group" });
      var buttons = items.map(function (item) {
        var button = element("button", "panel-option", { type: "button" });
        button.onclick = function () {
          toggle(item.id);
        };
        group.appendChild(button);
        return button;
      });
      refresh(function () {
        group.setAttribute("aria-label", t(labelKey, labelFallback));
        items.forEach(function (item, index) {
          buttons[index].textContent = item.label;
          buttons[index].setAttribute("aria-pressed", String(on(item.id)));
        });
      });
      parent.appendChild(group);
    }

    return function () {
      if (requested) return;
      requested = true;
      Background.load().then(function (packs) {
        if (!packs.length) return;
        title(holder, "panel.background", "Background");
        radios(
          holder,
          "",
          "panel.background",
          "Background",
          [
            {
              id: "none",
              label: function () {
                return t("background.none", "None");
              }
            },
            {
              id: "packs",
              label: function () {
                return t("background.packs", "Packs");
              }
            }
          ],
          Background.mode,
          function (id) {
            Background.setMode(id);
            refreshAll();
          }
        );
        var more = element("div");
        title(more, "panel.background-packs", "Packs");
        toggles(
          more,
          "panel.background-packs",
          "Packs",
          packs.map(function (pack) {
            return { id: pack.id, label: pack.title };
          }),
          function (id) {
            return Background.packs().indexOf(id) >= 0;
          },
          function (id) {
            var chosen = Background.packs().slice();
            var at = chosen.indexOf(id);
            if (at >= 0) chosen.splice(at, 1);
            else chosen.push(id);
            // One pack always stays selected
            if (chosen.length) Background.setPacks(chosen);
            refreshAll();
          }
        );
        title(more, "panel.background-every", "Show a new photo");
        radios(
          more,
          "two",
          "panel.background-every",
          "Show a new photo",
          Background.everyValues.map(function (seconds) {
            return {
              id: seconds,
              label: function () {
                return everyLabel(seconds);
              }
            };
          }),
          Background.every,
          function (seconds) {
            Background.setEvery(seconds);
            refreshAll();
          }
        );
        var match = element("button", "panel-option", { type: "button", "aria-pressed": "false" });
        match.style.width = "100%";
        match.style.marginTop = "0.5rem";
        match.onclick = function () {
          Background.setMatch(!Background.match());
          refreshAll();
        };
        more.appendChild(match);
        holder.appendChild(more);
        refresh(function () {
          more.hidden = Background.mode() !== "packs";
          match.textContent = t("background.match", "Match the theme");
          match.setAttribute("aria-pressed", String(Background.match()));
        });
      });
    };
  }

  function fontSection(box) {
    title(box, "panel.font", "Font");
    radios(
      box,
      "two",
      "panel.font",
      "Font",
      Font.sets.map(function (id) {
        return {
          id: id,
          label: function () {
            return id === "system" ? t("font.system", "System") : id.charAt(0).toUpperCase() + id.slice(1);
          }
        };
      }),
      Font.current,
      function (id) {
        Font.set(id, true);
        refreshAll();
      }
    );
  }

  // The size and contrast buttons are handled by accessibility.js through their data attributes
  function accessibilitySection(box) {
    title(box, "panel.text-size", "Text size");
    var group = element("div", "panel-options", { role: "group" });
    [
      ["smaller", "A−", "panel.text-smaller", "Smaller text"],
      ["reset", "A", "panel.text-default", "Default size"],
      ["larger", "A+", "panel.text-larger", "Larger text"]
    ].forEach(function (item) {
      var button = element("button", "panel-option", { type: "button", "data-text-size": item[0] });
      button.textContent = item[1];
      refresh(function () {
        button.setAttribute("aria-label", t(item[2], item[3]));
        button.title = t(item[2], item[3]);
      });
      group.appendChild(button);
    });
    box.appendChild(group);
    title(box, "panel.contrast", "Contrast");
    var toggle = element("button", "panel-option", {
      type: "button",
      "data-contrast-toggle": "",
      "aria-pressed": "false"
    });
    toggle.style.width = "100%";
    refresh(function () {
      toggle.textContent = t("panel.high-contrast", "High contrast");
    });
    box.appendChild(toggle);
  }

  function languageSection(box) {
    title(box, "panel.language", "Language");
    radios(
      box,
      "two",
      "panel.language",
      "Language",
      I18n.languages.map(function (language) {
        return {
          id: language.id,
          label: function () {
            return language.name;
          }
        };
      }),
      function () {
        return I18n.language;
      },
      function (id) {
        I18n.set(id, true);
      }
    );
  }

  function build() {
    var panel = element("div", "panel");
    var button = element("button", "panel-button", {
      type: "button",
      "aria-haspopup": "true",
      "aria-expanded": "false"
    });
    var box = element("div", "panel-box", { role: "dialog" });
    box.hidden = true;
    appearanceSection(box);
    chartSection(box);
    footerSection(box);
    var fillBackground = backgroundSection(box);
    fontSection(box);
    accessibilitySection(box);
    languageSection(box);
    refresh(function () {
      button.setAttribute("aria-label", t("panel.open", "Customize theme"));
      box.setAttribute("aria-label", t("panel.open", "Customize theme"));
      button.innerHTML = Theme.isDark() ? SUN : MOON;
    });

    function open(visible) {
      box.hidden = !visible;
      button.setAttribute("aria-expanded", String(visible));
      if (visible) fillBackground();
    }
    button.onclick = function (event) {
      event.stopPropagation();
      open(box.hidden);
    };
    document.addEventListener("click", function (event) {
      if (!document.documentElement.contains(event.target)) return;
      if (!box.hidden && !panel.contains(event.target)) open(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !box.hidden) {
        open(false);
        button.focus();
      }
    });
    panel.appendChild(button);
    panel.appendChild(box);
    document.body.appendChild(panel);
  }

  window.addEventListener("themechange", refreshAll);
  window.addEventListener("i18nchange", refreshAll);
  window.addEventListener("fontchange", refreshAll);
  window.addEventListener("backgroundchange", refreshAll);
  build();
})();
