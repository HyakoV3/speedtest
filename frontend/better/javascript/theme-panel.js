/**
 * Theme panel of the better pages
 *
 * A round button in the top right corner that opens a box with every option of the page, in four sections:
 * appearance (mode, brand color, rounding), page (background, font, footer style, chart style), accessibility
 * (text size, high contrast) and language. SECTIONS below lists them in the order they show. The sections are an
 * accordion: one is open at a time, and the last one opened is kept.
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
  var Icons = window.LibreSpeedIcons;
  var refreshers = [];

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

  // The sections are an accordion: the heading of each is a button that opens and closes its options, and only one
  // is open at a time. The last one opened is kept in the browser.
  var SECTION_KEY = "librespeed-better-panel-section";
  var sections = [];
  var openId = null;

  function isOpen(id) {
    return openId === id;
  }

  function showSection(id, save) {
    openId = id;
    sections.forEach(function (entry) {
      entry.header.setAttribute("aria-expanded", String(entry.id === id));
      entry.body.hidden = entry.id !== id;
    });
    if (save) {
      try {
        window.localStorage.setItem(SECTION_KEY, id || "none");
      } catch (error) {
        // The choice then only lasts until the page is closed
      }
    }
    // Parts of the panel depend on the open section (the second column of the background)
    refreshAll();
  }

  // The section open when the panel is built: the last one opened, else the first one that is not hidden
  function firstSection() {
    var saved = null;
    try {
      saved = window.localStorage.getItem(SECTION_KEY);
    } catch (error) {
      // No saved choice
    }
    if (saved === "none") return null;
    for (var i = 0; i < sections.length; i++) if (sections[i].id === saved) return saved;
    return document.documentElement.classList.contains("high-contrast") ? "page" : sections[0].id;
  }

  // A section: a heading button and a box for its options. The box is named by the heading for screen readers.
  function section(column, id, key, fallback, className) {
    var box = element("div", "panel-section" + (className ? " " + className : ""), { "data-panel-section": id });
    var header = element("button", "panel-section-title", {
      type: "button",
      id: "panel-section-" + id,
      "aria-controls": "panel-section-body-" + id,
      "aria-expanded": "false"
    });
    var body = element("div", "panel-section-body", {
      id: "panel-section-body-" + id,
      role: "group",
      "aria-labelledby": "panel-section-" + id
    });
    body.hidden = true;
    refresh(function () {
      header.textContent = t(key, fallback);
    });
    header.onclick = function () {
      showSection(isOpen(id) ? null : id, true);
    };
    box.appendChild(header);
    box.appendChild(body);
    column.appendChild(box);
    sections.push({ id: id, header: header, body: body });
    return body;
  }

  // The second column continues an option of a section: a heading with the name of the option, then its controls.
  // It is not a section of the accordion.
  function sideGroup(column, id, key, fallback) {
    var box = element("div", "panel-side-group", {
      role: "group",
      "aria-labelledby": "panel-side-" + id,
      "data-panel-side": id
    });
    var heading = element("p", "panel-side-heading", { id: "panel-side-" + id });
    refresh(function () {
      heading.textContent = t(key, fallback);
    });
    box.appendChild(heading);
    column.appendChild(box);
    return box;
  }

  // One option of a section: its title (when it has one) and its controls
  function itemBox(box, id, key, fallback) {
    var holder = element("div", "panel-item", { "data-panel-item": id });
    if (key) title(holder, key, fallback);
    box.appendChild(holder);
    return holder;
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

  function modeItem(box) {
    radios(
      box,
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
  }

  function colorsItem(box) {
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

  function radiusItem(box, kind, key, fallback) {
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

  function chartItem(box) {
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

  function footerItem(box) {
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
  // the option stays hidden when there are no packs. The packs and the change options show in the second column of
  // the panel, under the name of the option, with the "packs" mode.
  function backgroundItem(box, context) {
    var Background = window.LibreSpeedBackground;
    box.hidden = true;

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

    context.onOpen(function () {
      Background.load().then(function (packs) {
        if (!packs.length) return;
        box.hidden = false;
        radios(
          box,
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
        // The second column continues this option, so its heading is the name of the option
        var more = sideGroup(context.side, "background", "panel.background", "Background");
        toggles(
          itemBox(more, "background-packs", "panel.background-packs", "Packs"),
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
        var every = itemBox(more, "background-every", "panel.background-every", "Show a new photo");
        radios(
          every,
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
        every.appendChild(match);
        refresh(function () {
          context.side.hidden = Background.mode() !== "packs" || !isOpen("page");
          match.textContent = t("background.match", "Match the theme");
          match.setAttribute("aria-pressed", String(Background.match()));
        });
      });
    });
  }

  // The icon set, in a menu because the names are long. The list of sets comes with the icons file, so the option shows
  // once the file is read, and not at all when it could not be read.
  function iconsItem(box) {
    box.hidden = true;
    if (!Icons) return;
    Icons.ready.then(function () {
      var sets = Icons.sets();
      if (!sets.length) return;
      var menu = element("select", "panel-select");
      sets.forEach(function (set) {
        var option = element("option");
        option.value = set.id;
        option.textContent = set.name;
        menu.appendChild(option);
      });
      menu.onchange = function () {
        Icons.set(menu.value, true);
      };
      refresh(function () {
        menu.value = Icons.current();
        menu.setAttribute("aria-label", t("panel.icons", "Icons"));
      });
      box.appendChild(menu);
      box.hidden = false;
    });
  }

  function fontItem(box) {
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
  function textSizeItem(box) {
    var group = element("div", "panel-options", { role: "group" });
    [
      ["smaller", "A−", "panel.text-smaller", "Smaller text"],
      ["reset", "A", "panel.text-default", "Default size"],
      ["larger", "A+", "panel.text-larger", "Larger text"]
    ].forEach(function (option) {
      var button = element("button", "panel-option", { type: "button", "data-text-size": option[0] });
      button.textContent = option[1];
      refresh(function () {
        button.setAttribute("aria-label", t(option[2], option[3]));
        button.title = t(option[2], option[3]);
      });
      group.appendChild(button);
    });
    box.appendChild(group);
  }

  function contrastItem(box) {
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

  function languageItem(box) {
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

  // The sections and their options, in the order they show: to add an option, add it where it should show.
  // key and text are the i18n key of the title and its English text. An option without key has no title, because
  // its controls already say what it is (the high contrast button, or the list of languages under the heading of
  // its section). An option with "when" only shows when it returns true, and a section without options does not
  // show. High contrast hides the "panel-appearance" section (contrast.css), since it replaces the mode and the colors.
  var SECTIONS = [
    {
      id: "appearance",
      key: "panel.section-appearance",
      text: "Appearance",
      className: "panel-appearance",
      items: [
        { id: "mode", key: "panel.mode", text: "Mode", build: modeItem },
        { id: "brand", key: "panel.color", text: "Brand color", build: colorsItem },
        {
          id: "radius-button",
          key: "panel.radius-button",
          text: "Button rounding",
          build: function (box) {
            radiusItem(box, "button", "panel.radius-button", "Button rounding");
          }
        },
        {
          id: "radius-card",
          key: "panel.radius-card",
          text: "Box rounding",
          build: function (box) {
            radiusItem(box, "card", "panel.radius-card", "Box rounding");
          }
        }
      ]
    },
    {
      id: "page",
      key: "panel.section-page",
      text: "Page",
      items: [
        {
          id: "icons",
          key: "panel.icons",
          text: "Icons",
          when: function () {
            return !!Icons;
          },
          build: iconsItem
        },
        {
          id: "background",
          key: "panel.background",
          text: "Background",
          when: function () {
            return !!window.LibreSpeedBackground;
          },
          build: backgroundItem
        },
        { id: "font", key: "panel.font", text: "Font", build: fontItem },
        { id: "footer", key: "panel.footer", text: "Footer style", build: footerItem },
        {
          id: "chart",
          key: "panel.chart",
          text: "Chart style",
          when: function () {
            return !!ChartStyle;
          },
          build: chartItem
        }
      ]
    },
    {
      id: "accessibility",
      key: "panel.section-accessibility",
      text: "Accessibility",
      items: [
        { id: "text-size", key: "panel.text-size", text: "Text size", build: textSizeItem },
        { id: "contrast", build: contrastItem }
      ]
    },
    {
      id: "language",
      key: "panel.language",
      text: "Language",
      items: [{ id: "language", build: languageItem }]
    }
  ];

  function build() {
    var panel = element("div", "panel");
    var button = element("button", "panel-button", {
      type: "button",
      "aria-haspopup": "true",
      "aria-expanded": "false"
    });
    var box = element("div", "panel-box", { role: "dialog" });
    box.hidden = true;
    // The main column has every option; a second one opens beside it when the photo background has more to show
    var main = element("div", "panel-column panel-main");
    var side = element("div", "panel-column panel-side");
    side.hidden = true;
    box.appendChild(main);
    box.appendChild(side);
    // What the options get besides their box: the second column, and onOpen(callback) for work that waits for the
    // panel to open (the callbacks run the first time it opens)
    var openers = [];
    var context = {
      side: side,
      onOpen: function (callback) {
        openers.push(callback);
      }
    };
    SECTIONS.forEach(function (entry) {
      var items = entry.items.filter(function (option) {
        return !option.when || option.when();
      });
      if (!items.length) return;
      var holder = section(main, entry.id, entry.key, entry.text, entry.className);
      items.forEach(function (option) {
        option.build(itemBox(holder, option.id, option.key, option.text), context);
      });
    });
    showSection(firstSection(), false);
    refresh(function () {
      button.setAttribute("aria-label", t("panel.open", "Customize theme"));
      box.setAttribute("aria-label", t("panel.open", "Customize theme"));
      button.innerHTML = Icons ? Icons.html(Theme.isDark() ? "sun" : "moon", 18) : "";
    });

    var opened = false;
    function open(visible) {
      box.hidden = !visible;
      button.setAttribute("aria-expanded", String(visible));
      // The work that waits for the panel runs the first time it opens
      if (visible && !opened) {
        opened = true;
        openers.forEach(function (callback) {
          callback();
        });
      }
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
  window.addEventListener("iconschange", refreshAll);
  build();
})();
