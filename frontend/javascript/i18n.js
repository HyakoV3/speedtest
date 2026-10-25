/**
 * Localization for the modern page
 *
 * Flat JSON catalogs with dotted keys in ../locales/<language>.json. The text of the page in English stays in the HTML
 * as the fallback, so a missing key or a failed request leaves the page readable.
 *   data-i18n="key"                      sets the text of the element
 *   data-i18n-attr="attribute:key,..."   sets attributes of the element
 *   LibreSpeedI18n.t(key, fallback, { name: value })   for the text written by scripts, with {name} placeholders
 *
 * The language is the saved choice (localStorage), then the first supported language of the browser, then English.
 * A <select data-language-select> is filled with the languages and changes the language of the open page.
 * "i18nchange" is fired on window after every change of language, for the texts that scripts draw.
 */
(() => {
  const DEFAULT_LANGUAGE = "en";
  const LANGUAGES = [
    { id: "en", name: "English" },
    { id: "sv", name: "Svenska" },
    { id: "pt", name: "Português" },
    { id: "es", name: "Español" }
  ];
  const STORAGE_KEY = "librespeed-language";
  const localesURL = new URL("../locales/", document.currentScript.src);
  let language = DEFAULT_LANGUAGE;
  let messages = {};

  const supported = id => LANGUAGES.some(item => item.id === id);
  const normalize = value =>
    String(value || "")
      .toLowerCase()
      .split("-")[0];

  function initialLanguage() {
    try {
      const saved = normalize(window.localStorage.getItem(STORAGE_KEY));
      if (supported(saved)) return saved;
    } catch (error) {
      // Storage can be blocked; the browser language is used then
    }
    const browser = navigator.languages || [navigator.language];
    return browser.map(normalize).find(supported) || DEFAULT_LANGUAGE;
  }

  function translate(key, fallback = key, parameters = {}) {
    return (messages[key] || fallback).replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : match
    );
  }

  function translateDocument() {
    document.querySelectorAll("[data-i18n]").forEach(element => {
      element.textContent = translate(element.dataset.i18n, element.textContent.trim());
    });
    document.querySelectorAll("[data-i18n-attr]").forEach(element => {
      element.dataset.i18nAttr.split(",").forEach(binding => {
        const [attribute, key] = binding.split(":");
        element.setAttribute(attribute, translate(key, element.getAttribute(attribute)));
      });
    });
    document.querySelectorAll("[data-language-select]").forEach(select => {
      select.value = language;
    });
  }

  function set(id, save) {
    if (!supported(id)) return Promise.resolve();
    return fetch(new URL(`${id}.json`, localesURL))
      .then(response => {
        if (!response.ok) throw new Error(`Unable to load the ${id} translations`);
        return response.json();
      })
      .then(catalog => {
        language = id;
        messages = catalog;
        if (save) {
          try {
            window.localStorage.setItem(STORAGE_KEY, id);
          } catch (error) {
            // The choice then only lasts until the page is closed
          }
        }
        document.documentElement.lang = id;
        translateDocument();
        window.dispatchEvent(new Event("i18nchange"));
      })
      .catch(error => console.warn("LibreSpeed localization unavailable:", error))
      .finally(() => document.documentElement.removeAttribute("data-i18n-pending"));
  }

  const initial = initialLanguage();
  // The page waits for a catalog other than English, so it does not flash in English first
  if (initial !== DEFAULT_LANGUAGE) document.documentElement.setAttribute("data-i18n-pending", "");

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-language-select]").forEach(select => {
      LANGUAGES.forEach(item => select.add(new Option(item.name, item.id)));
      select.value = language;
      select.addEventListener("change", () => set(select.value, true));
    });
    if (initial !== DEFAULT_LANGUAGE) set(initial, false);
  });

  window.LibreSpeedI18n = {
    get language() {
      return language;
    },
    set,
    t: translate
  };
})();
