/**
 * The route from the visitor to the server (route-better.html, "You → server"): the commands to run, the box to paste what they print,
 * and the route that comes out of it in the shape that route.php gives for the other direction
 *
 * A web page cannot trace a route (no TTL, no ICMP), so the visitor traces it on their own device and pastes the text. It is read in the
 * browser (route-parse.js). Only the public addresses of the routers are sent to the server, and only to look up their network and
 * country (backend/route_enrich.php); the addresses and the answer are not stored (only a keyed hash of the visitor and the times of the requests, for up to an hour, to apply the limits).
 *
 * LibreSpeedRouteBack.commands(system, host, family) is { main, alt } (alt may be null), or null when the host is not one that can be
 *   written in a command
 * LibreSpeedRouteBack.detect(userAgent, platform) is { system: "windows" | "macos" | "linux", mobile }
 * LibreSpeedRouteBack.build(parsed) is the route (as route.php gives it, "client_to_server") of the result of LibreSpeedRouteParse.parse
 * LibreSpeedRouteBack.enrichBody(data, targetIp) is what is sent to the server: the numbers and the public addresses of the hops, and
 *   the address of the target when it is public; no more
 * LibreSpeedRouteBack.merge(data, answer) is the route with the network and the country of the answer put in (a new object), or the same
 *   route when the answer is not one
 * LibreSpeedRouteBack.create(options) wires the panel; options: t(key, parameters), host, family() (4, 6 or null), onRoute(data, first),
 *   onSettled() (the networks arrived, or will not), onClear(), endpoint; it gives forget() and note(key)
 */
var LibreSpeedRouteBack = (function () {
  "use strict";

  var HOST = /^[A-Za-z0-9._:-]{1,253}$/;
  // The longest text that the box and the parser take (route-parse.js, MAX_TEXT), and the biggest file that can hold it
  var TOOL_KEY = "librespeed-better-route-back-tool";
  var MAX_TEXT = 32768;
  // The longest line of LSR1 (route-parse.js, MAX_LSR1)
  var MAX_LSR1 = 1900;
  var MAX_FILE_BYTES = 131072;
  var TIMEOUT_MS = 10000;
  var AS = /^AS\d{1,10}$/;

  // What sends the output of the command to the clipboard, in each system (the paste button reads it from there)
  var CLIPBOARD = { windows: " | clip", macos: " | pbcopy", linux: " | xclip -selection clipboard" };

  // The address that the server offers to get librespeed-route from (route.php?caps, cli_url): https only, no user name, no query, no quote.
  // The same rule as routeCliUrl() of the PHP, because the page does not trust what it was given
  var CLI_URL = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~:/%+-]*)?$/;

  function cliUrl(value) {
    return typeof value === "string" && value.length <= 200 && CLI_URL.test(value) ? value : null;
  }

  // The command to run, with clip true: with its output sent to the clipboard (the terminal shows nothing until it ends). With tool "cli":
  // librespeed-route, which writes one line for the page to its output and its table to the error output, so it is always piped
  function commands(system, host, family, clip, tool) {
    if (typeof host !== "string") return null;
    var name = host.replace(/^\[|\]$/g, "");
    if (!HOST.test(name) || name.charAt(0) === "-") return null;
    var flag = family === 4 ? " -4" : family === 6 ? " -6" : "";
    if (tool === "cli") {
      return CLIPBOARD[system] ? { main: "librespeed-route" + flag + " " + name + CLIPBOARD[system], alt: null } : null;
    }
    var tail = clip === true && CLIPBOARD[system] ? CLIPBOARD[system] : "";
    if (system === "windows") return { main: "tracert -d -h 30 -w 1000" + flag + " " + name + tail, alt: null };
    if (system === "macos") {
      return {
        main: (family === 6 ? "traceroute6 -n -m 30 " + name : "traceroute -n -m 30 -w 1 " + name) + tail,
        alt: null
      };
    }
    return {
      main: "traceroute -n -m 30 -w 1" + flag + " " + name + tail,
      alt: "tracepath -n" + flag + " " + name + tail
    };
  }

  // The text of a file or of the clipboard as the person wrote it: a file from PowerShell (">") is UTF-16 with a mark at the start, one from
  // cmd is in the code page of the console (the words are never read, only the numbers and addresses, so it does not matter which)
  function decode(buffer) {
    var bytes = new Uint8Array(buffer);
    var label = "utf-8";
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) label = "utf-16le";
    else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) label = "utf-16be";
    try {
      return new TextDecoder(label).decode(bytes);
    } catch (error) {
      return null;
    }
  }

  function detect(userAgent, platform) {
    var text = String(userAgent || "") + " " + String(platform || "");
    var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(text);
    var system = "linux";
    if (/Win/i.test(platform || "") || /Windows/i.test(text)) system = "windows";
    else if (/iPhone|iPad|iPod|Mac/i.test(text)) system = "macos";
    return { system: system, mobile: mobile };
  }

  function build(parsed) {
    var hops = parsed.hops.map(function (hop) {
      var copy = {};
      Object.keys(hop).forEach(function (key) {
        copy[key] = hop[key];
      });
      copy.alt_ips = hop.alt_ips.slice();
      copy.flags = hop.flags.slice();
      return copy;
    });
    var answered = null;
    for (var i = hops.length - 1; i >= 0; i--) {
      if (hops[i].scope !== "none" && hops[i].answered > 0) {
        answered = i;
        break;
      }
    }
    // Whether the target answered: true or false when the text tells it (the address of the target in the first line, "reached" in
    // tracepath, the end of an mtr report), null when it does not (only the lines of the hops were pasted)
    var reached = null;
    if (parsed.target_ip && answered !== null) reached = hops[answered].ip === parsed.target_ip;
    else if (typeof parsed.reached === "boolean") reached = answered !== null && parsed.reached;
    hops.forEach(function (hop, index) {
      if (hop.scope === "public") hop.is_target = reached === true && index === answered;
    });
    return {
      v: 1,
      direction: "client_to_server",
      source: "paste",
      tool: parsed.tool,
      family: parsed.family,
      target_reached: reached,
      target_as: null,
      target_country: null,
      pmtu: null,
      pmtu_drops: [],
      hops: hops
    };
  }

  function enrichBody(data, targetIp) {
    var list = [];
    data.hops.forEach(function (hop) {
      if (hop.scope === "public" && hop.ip) list.push({ ttl: hop.ttl, ip: hop.ip, rtt_min: hop.rtt_min });
    });
    var target = null;
    if (targetIp && window.LibreSpeedRouteParse.scope(targetIp) === "public") target = targetIp;
    return { v: 1, target: target, hops: list };
  }

  function text(value, limit) {
    return typeof value === "string" && value.length > 0 && value.length <= limit ? value : null;
  }

  function merge(data, answer) {
    if (!answer || answer.v !== 1 || !Array.isArray(answer.hops)) return data;
    var byTtl = {};
    answer.hops.forEach(function (item) {
      if (item && typeof item.ttl === "number") byTtl[item.ttl] = item;
    });
    var copy = {};
    Object.keys(data).forEach(function (key) {
      copy[key] = data[key];
    });
    copy.hops = data.hops.map(function (hop) {
      var item = byTtl[hop.ttl];
      if (hop.scope !== "public" || !item) return hop;
      var next = {};
      Object.keys(hop).forEach(function (key) {
        next[key] = hop[key];
      });
      next.asn = typeof item.asn === "string" && AS.test(item.asn) ? item.asn : null;
      next.as_name = text(item.as_name, 200);
      next.country = typeof item.country === "string" && /^[A-Z]{2}$/.test(item.country) ? item.country : null;
      next.country_doubt = item.country_doubt === true;
      return next;
    });
    var as = answer.target_as;
    if (as && typeof as.asn === "string" && AS.test(as.asn)) {
      copy.target_as = { asn: as.asn, as_name: text(as.as_name, 200) };
    }
    if (typeof answer.target_country === "string" && /^[A-Z]{2}$/.test(answer.target_country)) {
      copy.target_country = answer.target_country;
    }
    return copy;
  }

  function create(options) {
    var t = options.t;
    var byId = function (id) {
      return document.getElementById(id);
    };
    var textarea = byId("routeBackText");
    var notesBox = byId("routeBackNotes");
    var commandBox = byId("routeBackCommand");
    var altBox = byId("routeBackAlt");
    var clipBox = byId("routeBackClip");
    var clipHint = byId("routeBackClipHint");
    var clipLinux = byId("routeBackClipLinux");
    var pasteClipButton = byId("routeBackPasteClip");
    var toolBox = byId("routeBackTool");
    var clipLabel = byId("routeBackClipLabel");
    var cliBox = byId("routeBackCli");
    var cliLink = byId("routeBackCliLink");
    var cliRun = byId("routeBackCliRun");
    // "system": the tracert/traceroute of the system; "cli": librespeed-route (only when the server offers it)
    var tool = "system";
    var cliAddress = null;
    var noCommandBox = byId("routeBackNoCommand");
    var altCommand = byId("routeBackAltCommand");
    var mobileBox = byId("routeBackMobile");
    var copyButton = byId("routeBackCopy");
    var systems = byId("routeBackSystems");
    var showButton = byId("routeBackShow");
    var traceButton = byId("routeBackTraceButton");
    var traceCancel = byId("routeBackTraceCancel");
    var traceHint = byId("routeBackTraceHint");
    var traceNote = byId("routeBackTraceNote");
    var seen = detect(
      navigator.userAgent,
      (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform
    );
    var system = seen.system;
    var notes = [];
    var ticket = 0;
    var copiedTimer = null;

    function drawNotes() {
      notesBox.textContent = "";
      notes.forEach(function (note) {
        var line = document.createElement("p");
        line.textContent = t(note.key, note.parameters);
        if (note.error) line.className = "route-error";
        notesBox.appendChild(line);
      });
    }

    function setNotes(list) {
      notes = list;
      drawNotes();
    }

    function drawCommand() {
      var found = commands(system, options.host, options.family(), clipBox.checked, tool);
      commandBox.textContent = found ? found.main : "";
      var cli = tool === "cli";
      cliBox.hidden = !cli;
      cliRun.hidden = !cli;
      clipLabel.hidden = cli;
      toolBox.hidden = cliAddress === null;
      Array.prototype.forEach.call(toolBox.querySelectorAll("[data-tool]"), function (button) {
        button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
      });
      clipHint.hidden = cli || !(found && clipBox.checked);
      clipLinux.hidden = system !== "linux";
      copyButton.disabled = !found;
      noCommandBox.hidden = !!found;
      altBox.hidden = !(found && found.alt);
      altCommand.textContent = found && found.alt ? found.alt : "";
      Array.prototype.forEach.call(systems.querySelectorAll("[data-system]"), function (button) {
        button.setAttribute("aria-pressed", String(button.dataset.system === system));
      });
      mobileBox.hidden = !seen.mobile;
    }

    function copy() {
      var found = commands(system, options.host, options.family(), clipBox.checked, tool);
      if (!found) return;
      var done = function () {
        copyButton.textContent = t("route.back.copied");
        window.clearTimeout(copiedTimer);
        copiedTimer = window.setTimeout(function () {
          copyButton.textContent = t("route.back.copy");
        }, 1500);
      };
      var fallback = function () {
        var range = document.createRange();
        range.selectNodeContents(commandBox);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(found.main).then(done, fallback);
      } else {
        fallback();
      }
    }

    // The answer (or the request that is on its way) for the text that is shown: the same text pressed again, or pressed twice, does not
    // ask again (the server answers one request in 5 seconds for each visitor)
    var current = null;

    function settle(mine) {
      if (mine !== ticket || !current) return;
      current.settled = true;
      if (options.onSettled) options.onSettled();
    }

    function enrich(data, parsed, mine, retried) {
      var controller = new AbortController();
      var timer = window.setTimeout(function () {
        controller.abort();
      }, TIMEOUT_MS);
      var body = enrichBody(data, parsed.target_ip);
      if (!body.hops.length && !body.target) {
        window.clearTimeout(timer);
        settle(mine);
        return;
      }
      var wait = 0;
      fetch(options.endpoint, {
        method: "POST",
        headers: { "X-LibreSpeed-Route": "1", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal
      })
        .then(function (response) {
          if (response.status === 429 && !retried) {
            // Once more, when the server says it can be asked again
            return response.json().then(function (answer) {
              wait = Math.min(10, Math.max(1, Number(answer && answer.retry_after) || 5));
              throw new Error("later");
            });
          }
          if (response.status !== 200) throw new Error("status");
          return response.json();
        })
        .then(function (answer) {
          if (mine !== ticket) return;
          var merged = merge(data, answer);
          if (current) current.merged = merged;
          options.onRoute(merged, false);
          settle(mine);
        })
        .catch(function () {
          if (mine !== ticket) return;
          if (wait) {
            window.setTimeout(function () {
              if (mine === ticket) enrich(data, parsed, mine, true);
            }, wait * 1000);
            return;
          }
          notes = notes.filter(function (note) {
            return note.key !== "route.back.enrich-failed";
          });
          notes.push({ key: "route.back.enrich-failed" });
          drawNotes();
          settle(mine);
        })
        .then(function () {
          window.clearTimeout(timer);
        });
    }

    // fromExtension: the route was handed over by the browser extension (the person pressed its button on this page): it is said so
    function show(fromExtension) {
      var parsed = window.LibreSpeedRouteParse.parse(textarea.value);
      if (parsed.error) {
        // A text that is not a route says so and leaves the route that is on the screen as it is
        var key = parsed.error === "too_long" ? "too-long" : parsed.error;
        setNotes([{ key: "route.back.error." + key, error: true }]);
        return;
      }
      if (current && current.text === textarea.value) {
        // The same text again: what is known of it is shown, and nothing is asked
        if (fromExtension === true) setNotes([{ key: "route.back.from-extension" }]);
        options.onRoute(current.merged || current.data, false);
        return;
      }
      ticket++;
      var data = build(parsed);
      current = { text: textarea.value, data: data, merged: null, settled: false };
      var list = fromExtension === true ? [{ key: "route.back.from-extension" }] : [];
      var host = String(options.host || "")
        .replace(/^\[|\]$/g, "")
        .toLowerCase();
      // Only a name: when the tool was run with an address, or the text is the one of the app, there is nothing to compare it with
      if (
        parsed.target_name &&
        window.LibreSpeedRouteParse.normalize(parsed.target_name) === null &&
        parsed.target_name.toLowerCase() !== host
      ) {
        list.push({ key: "route.back.other-host", parameters: { name: parsed.target_name, host: options.host } });
      }
      if (parsed.skipped > 0) list.push({ key: "route.back.skipped", parameters: { n: parsed.skipped } });
      setNotes(list);
      options.onRoute(data, true);
      enrich(data, parsed, ticket, false);
    }

    function clear() {
      ticket++;
      current = null;
      textarea.value = "";
      setNotes([]);
      options.onClear();
    }

    // The output of the command, taken from the clipboard and shown: one press, which is the one that says "show"
    function pasteFromClipboard() {
      var denied = function () {
        setNotes([{ key: "route.back.clip-denied", error: true }]);
      };
      if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
        denied();
        return;
      }
      navigator.clipboard.readText().then(function (text) {
        if (typeof text !== "string" || !text.trim()) {
          setNotes([{ key: "route.back.error.empty", error: true }]);
          return;
        }
        textarea.value = text;
        show();
      }, denied);
    }

    // A file dropped on the box: put in the box, to be shown with the button (what is sent is still what the person presses)
    function takeFile(file) {
      // 32768 characters (the limit of the box and of the parser) are at most 131072 bytes, at 4 bytes a character
      if (!file || file.size > MAX_FILE_BYTES || typeof file.arrayBuffer !== "function") {
        setNotes([{ key: "route.back.file-bad", error: true }]);
        return;
      }
      file.arrayBuffer().then(
        function (buffer) {
          var text = decode(buffer);
          if (text === null || !text.trim() || text.length > MAX_TEXT || /\u0000/.test(text)) {
            setNotes([{ key: "route.back.file-bad", error: true }]);
            return;
          }
          setNotes([]);
          textarea.value = text;
          showButton.focus();
        },
        function () {
          setNotes([{ key: "route.back.file-bad", error: true }]);
        }
      );
    }

    textarea.addEventListener("dragover", function (event) {
      event.preventDefault();
    });
    textarea.addEventListener("drop", function (event) {
      var files = event.dataTransfer && event.dataTransfer.files;
      if (!files || !files.length) return;
      event.preventDefault();
      takeFile(files[0]);
    });
    clipBox.addEventListener("change", drawCommand);
    Array.prototype.forEach.call(toolBox.querySelectorAll("[data-tool]"), function (button) {
      button.addEventListener("click", function () {
        tool = button.dataset.tool === "cli" && cliAddress !== null ? "cli" : "system";
        try {
          window.localStorage.setItem(TOOL_KEY, tool);
        } catch (error) {
          // The choice only lasts until the page is closed
        }
        drawCommand();
      });
    });
    pasteClipButton.addEventListener("click", pasteFromClipboard);

    Array.prototype.forEach.call(systems.querySelectorAll("[data-system]"), function (button) {
      button.addEventListener("click", function () {
        system = button.dataset.system;
        drawCommand();
      });
    });
    copyButton.addEventListener("click", copy);
    showButton.addEventListener("click", function () {
      show(false);
    });

    // The route that the browser extension hands over (docs/protocol.md of librespeed-route): a message of this window to itself, of
    // this origin, of exactly this shape. A script of another site, a frame, a message with more in it or a line that is too long is
    // ignored. It is read as a pasted text is (and the networks are asked for as for a pasted text), and it is never saved to the
    // history by itself.
    window.addEventListener("message", function (event) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      var data = event.data;
      if (!data || typeof data !== "object" || Object.keys(data).sort().join(",") !== "lsr1,source,v") return;
      if (data.source !== "librespeed-route-extension" || data.v !== 1) return;
      if (typeof data.lsr1 !== "string" || data.lsr1.length > MAX_LSR1) return;
      if (typeof options.enabled === "function" && !options.enabled()) return;
      if (typeof options.onExtension === "function") options.onExtension();
      textarea.value = data.lsr1;
      show(true);
    });
    // The button of this page, with the browser extension (docs/protocol.md of librespeed-route). The extension is only in a page of a site that
    // the person allowed; it says "ready" when it is here (to a hello, and by itself when it is allowed while the page is open). A trace is
    // asked for in the click itself (the browser wants the click of the person), and what comes back is read only if it is of this window and
    // origin, with exactly the keys of the protocol, and about the trace that this page asked for.
    var STATE_KEYS = "id,source,state,type,v";
    var STATE_CODES = [
      "not-allowed",
      "no-gesture",
      "busy",
      "no-host",
      "update",
      "refused",
      "no-tool",
      "failed",
      "silent",
      "interrupted",
      "too-long",
      "moved"
    ];
    var TRACE_WAIT_MS = 150000;
    var extensionHere = false;
    var traceId = null;
    var traceTimer = null;

    function newId() {
      var bytes = new Uint8Array(9);
      if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
      else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      return Array.prototype.map
        .call(bytes, function (b) {
          return ("0" + b.toString(16)).slice(-2);
        })
        .join("");
    }

    function toExtension(type, id) {
      window.postMessage({ source: "librespeed-route-page", v: 1, type: type, id: id }, window.location.origin);
    }

    function drawTrace() {
      var busy = traceId !== null;
      traceButton.disabled = !extensionHere || busy;
      traceCancel.hidden = !busy;
      traceHint.hidden = extensionHere;
    }

    // An error is also shown as a red box at the top of the screen, where it is seen at once; it is for the eyes only (the line next to the
    // button is what a screen reader reads), it goes by itself after a few seconds, and a click takes it away
    var TOAST_MS = 9000;
    var toast = null;
    var toastTimer = null;

    function hideToast() {
      window.clearTimeout(toastTimer);
      toastTimer = null;
      if (toast) toast.hidden = true;
    }

    function showToast(key) {
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "routeToast";
        toast.className = "route-toast";
        toast.setAttribute("aria-hidden", "true");
        toast.hidden = true;
        toast.addEventListener("click", hideToast);
        document.body.appendChild(toast);
      }
      toast.textContent = t(key);
      toast.hidden = false;
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(hideToast, TOAST_MS);
    }

    // What the trace is doing, or why it stopped, next to the button (the notes of the card are far below it)
    function sayTrace(key, error) {
      hideToast();
      if (key && error) showToast(key);
      traceNote.textContent = key ? t(key) : "";
      traceNote.className = "route-hint" + (error ? " route-error" : "");
      traceNote.hidden = !key;
    }

    function endTrace() {
      traceId = null;
      window.clearTimeout(traceTimer);
      traceTimer = null;
      drawTrace();
    }

    traceButton.addEventListener("click", function () {
      if (traceId !== null || !extensionHere) return;
      if (typeof options.enabled === "function" && !options.enabled()) return;
      traceId = newId();
      drawTrace();
      setNotes([]);
      sayTrace("route.back.trace-tracing");
      toExtension("trace", traceId);
      var mine = traceId;
      traceTimer = window.setTimeout(function () {
        if (traceId !== mine) return;
        toExtension("cancel", mine);
        endTrace();
        sayTrace("route.back.trace-error.timeout", true);
      }, TRACE_WAIT_MS);
    });

    traceCancel.addEventListener("click", function () {
      if (traceId === null) return;
      var mine = traceId;
      endTrace();
      toExtension("cancel", mine);
      sayTrace(null);
    });

    window.addEventListener("message", function (event) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      var data = event.data;
      if (!data || typeof data !== "object") return;
      var keys = Object.keys(data).sort().join(",");
      if (data.source !== "librespeed-route-extension" || data.v !== 1 || data.type !== "state") return;
      if (keys !== STATE_KEYS && keys !== "code," + STATE_KEYS) return;
      if (typeof data.id !== "string" || typeof data.state !== "string") return;
      if (data.state === "ready" || data.state === "off") {
        // "off": the person turned this site off in the extension while the page was open
        extensionHere = data.state === "ready";
        if (!extensionHere) sayTrace(null);
        drawTrace();
        return;
      }
      // The other states are about the trace that this page asked for, and no other
      if (traceId === null || data.id !== traceId) return;
      if (data.state === "done") {
        endTrace();
        sayTrace(null);
      } else if (data.state === "error") {
        var code = STATE_CODES.indexOf(data.code) >= 0 ? data.code : "failed";
        endTrace();
        sayTrace("route.back.trace-error." + code, true);
      }
    });
    // Is the extension here? Only a page that the person allowed there answers
    toExtension("hello", newId());
    drawTrace();

    byId("routeBackClear").addEventListener("click", clear);
    drawCommand();

    return {
      // The address that the server offers to get librespeed-route from (null or anything that is not a plain https address: not offered)
      setCli: function (value) {
        cliAddress = cliUrl(value);
        if (cliAddress === null) {
          tool = "system";
        } else {
          cliLink.href = cliAddress;
          var saved = null;
          try {
            saved = window.localStorage.getItem(TOOL_KEY);
          } catch (error) {
            saved = null;
          }
          tool = saved === "cli" ? "cli" : "system";
        }
        drawCommand();
      },
      // Another route took the screen (a saved one was shown): what is on its way for the pasted one is no longer wanted
      forget: function () {
        ticket++;
        current = null;
        setNotes([]);
      },
      note: function (key) {
        notes.push({ key: key, error: true });
        drawNotes();
      },
      refresh: function () {
        drawCommand();
        drawNotes();
        copyButton.textContent = t("route.back.copy");
      },
      clear: clear
    };
  }

  return {
    commands: commands,
    cliUrl: cliUrl,
    decode: decode,
    detect: detect,
    build: build,
    enrichBody: enrichBody,
    merge: merge,
    create: create
  };
})();
