/**
 * Localization for the better pages
 *
 * Same catalog format as the shared localization of the other pages: flat JSON files with dotted keys in
 * ../locales/<language>.json, the text of the page in English as the fallback, and
 *   data-i18n="key"                      sets the text of the element
 *   data-i18n-attr="attribute:key,..."   sets attributes of the element
 *   data-i18n-html="key"                 sets the HTML of the element (for text with links)
 *   LibreSpeedI18n.t(key, fallback, { name: value })   for the text written by scripts, with {name} placeholders
 *
 * The language is the ?lang= parameter, then the saved choice (localStorage), then the first supported language of
 * the browser, then English. A key that is missing in a catalog falls back to the English catalog.
 *
 * LibreSpeedI18n.set(language, save) changes the language of the open page and fires "i18nchange" on window.
 * LibreSpeedI18n.serverName(server) is the name of a server of the list in the language of the page: the entry of
 * server.names for the language ({ "pt": "Servidor local" }), or server.name.
 * LibreSpeedI18n.languages is the list of { id, name } with the name of each language in its own language.
 */
(() => {
  const DEFAULT_LANGUAGE = "en";
  const LANGUAGES = [
    { id: "en", name: "English" },
    { id: "pt", name: "Português" },
    { id: "es", name: "Español" },
    { id: "sv", name: "Svenska" }
  ];
  const STORAGE_KEY = "librespeed-better-language";
  const script = document.currentScript;
  const localesURL = new URL("../locales/", script.src);
  const catalogs = {};
  let language = DEFAULT_LANGUAGE;

  function supported(id) {
    return LANGUAGES.some(item => item.id === id);
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .split("-")[0];
  }

  function savedLanguage() {
    try {
      return normalize(window.localStorage.getItem(STORAGE_KEY));
    } catch (error) {
      return "";
    }
  }

  function languageFromRequest() {
    const requested = normalize(new URLSearchParams(window.location.search).get("lang"));
    if (supported(requested)) return requested;
    if (supported(savedLanguage())) return savedLanguage();
    const browser = navigator.languages || [navigator.language || DEFAULT_LANGUAGE];
    return browser.map(normalize).find(supported) || DEFAULT_LANGUAGE;
  }

  function interpolate(value, parameters) {
    return value.replace(/\{(\w+)\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(parameters, key) ? parameters[key] : match
    );
  }

  function translate(key, fallback = key, parameters = {}) {
    const messages = catalogs[language] || {};
    const base = catalogs[DEFAULT_LANGUAGE] || {};
    const value = messages[key] || base[key] || fallback;
    return interpolate(value, parameters);
  }

  function translateDocument() {
    document.querySelectorAll("[data-i18n]").forEach(element => {
      element.textContent = translate(element.dataset.i18n, element.textContent.trim());
    });
    document.querySelectorAll("[data-i18n-html]").forEach(element => {
      element.innerHTML = translate(element.dataset.i18nHtml, element.innerHTML);
    });
    document.querySelectorAll("[data-i18n-attr]").forEach(element => {
      element.dataset.i18nAttr.split(",").forEach(binding => {
        const [attribute, key] = binding.split(":");
        if (attribute && key) element.setAttribute(attribute, translate(key, element.getAttribute(attribute) || key));
      });
    });
  }

  function load(id) {
    if (catalogs[id]) return Promise.resolve();
    return fetch(new URL(`${id}.json`, localesURL))
      .then(response => {
        if (!response.ok) throw new Error(`Unable to load ${id} translations`);
        return response.json();
      })
      .then(catalog => {
        catalogs[id] = catalog;
      });
  }

  function apply() {
    document.documentElement.lang = language;
    translateDocument();
    document.documentElement.removeAttribute("data-i18n-pending");
    window.dispatchEvent(new Event("i18nchange"));
  }

  function set(id, save) {
    if (!supported(id)) return Promise.resolve(false);
    // The English text is kept in the pages, so the English catalog is only needed after a change of language
    return Promise.all([load(DEFAULT_LANGUAGE), load(id)])
      .then(() => {
        language = id;
        if (save) {
          try {
            window.localStorage.setItem(STORAGE_KEY, id);
          } catch (error) {
            // The choice then only lasts until the page is closed
          }
        }
        apply();
        return true;
      })
      .catch(error => {
        console.warn("LibreSpeed localization unavailable:", error);
        document.documentElement.removeAttribute("data-i18n-pending");
        return false;
      });
  }

  const initial = languageFromRequest();
  // Another language than English is shown only after its catalog has loaded, so the page does not flash in English
  if (initial !== DEFAULT_LANGUAGE) document.documentElement.setAttribute("data-i18n-pending", "");
  const ready = new Promise(resolve => {
    const start = () => set(initial, false).then(resolve);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  });

  window.LibreSpeedI18n = {
    languages: LANGUAGES,
    get language() {
      return language;
    },
    ready,
    set,
    t: translate,
    serverName(server) {
      const names = server && server.names;
      return (names && names[language]) || (server && server.name) || "";
    }
  };
})();
