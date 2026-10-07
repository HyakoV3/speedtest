/* exported LibreSpeedConsent */
/**
 * The privacy consent of the better pages: when the server has telemetry (telemetry_level in settings.json is not
 * off), the first start of a test asks the person to accept the privacy policy. The answer is kept in the browser
 * for a year, so it is not asked again.
 *
 * LibreSpeedConsent.ready                   a promise that resolves once the settings of the server were read
 * LibreSpeedConsent.telemetryEnabled()      whether the server has telemetry (after ready)
 * LibreSpeedConsent.ensure(proceed)         calls proceed now, or after the person accepts the policy
 */
var LibreSpeedConsent = (function () {
  "use strict";

  var KEY = "librespeed-better-consent";
  var VALID_DAYS = 365;
  var enabled = false;

  // Text shown by this file, in the language of the page when LibreSpeedI18n is loaded
  function text(key, fallback) {
    return window.LibreSpeedI18n ? window.LibreSpeedI18n.t(key, fallback) : fallback;
  }

  var ready = window
    .fetch("settings.json")
    .then(function (response) {
      return response.json();
    })
    .then(function (settings) {
      var level = settings && settings.telemetry_level;
      enabled = !!level && ["off", "disabled", "false"].indexOf(level) < 0;
    })
    .catch(function () {
      // Without the settings of the server there is no telemetry to agree to
    });

  function accepted() {
    try {
      var at = Number(window.localStorage.getItem(KEY));
      return at > 0 && Date.now() - at < VALID_DAYS * 24 * 60 * 60 * 1000;
    } catch (error) {
      return false;
    }
  }

  function remember() {
    try {
      window.localStorage.setItem(KEY, String(Date.now()));
    } catch (error) {
      // Without storage it is asked again the next time
    }
  }

  function element(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function ask(proceed) {
    var old = document.getElementById("consentDialog");
    if (old) old.remove();
    var dialog = element("dialog", "consent-dialog");
    dialog.id = "consentDialog";
    dialog.setAttribute("aria-labelledby", "consentTitle");

    var title = element("h2", "", text("privacy.title", "Privacy Policy"));
    title.id = "consentTitle";
    var message = element("p", "", text("consent.text", "By starting the test you agree to our privacy policy."));
    var read = element("a", "consent-read", text("consent.read", "Read the privacy policy"));
    read.href = "#";
    read.onclick = function (event) {
      event.preventDefault();
      // The policy is a page layer, so it can only be seen once this window is closed
      dialog.close();
      var policy = document.getElementById("privacyPolicy");
      if (policy) policy.style.display = "";
    };

    var actions = element("div", "consent-actions");
    var cancel = element("button", "consent-cancel", text("consent.cancel", "Cancel"));
    cancel.type = "button";
    cancel.onclick = function () {
      dialog.close();
    };
    var accept = element("button", "consent-accept", text("consent.accept", "Accept and start"));
    accept.type = "button";
    accept.autofocus = true;
    accept.onclick = function () {
      remember();
      dialog.close();
      proceed();
    };
    actions.appendChild(cancel);
    actions.appendChild(accept);

    dialog.appendChild(title);
    dialog.appendChild(message);
    dialog.appendChild(read);
    dialog.appendChild(actions);
    dialog.addEventListener("close", function () {
      dialog.remove();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  function ensure(proceed) {
    // The text of the window needs the language of the page
    var language =
      window.LibreSpeedI18n && window.LibreSpeedI18n.ready ? window.LibreSpeedI18n.ready : Promise.resolve();
    Promise.all([ready, language]).then(function () {
      if (!enabled || accepted()) proceed();
      else ask(proceed);
    });
  }

  return {
    ready: ready,
    telemetryEnabled: function () {
      return enabled;
    },
    ensure: ensure
  };
})();
