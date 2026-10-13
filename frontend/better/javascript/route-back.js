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
  // The choice of the tool (the system command or librespeed-route) is gone from the card: the old key is taken away once
  var TOOL_KEY = "librespeed-better-route-back-tool";
  var METHOD_KEY = "librespeed-better-route-back-method";
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

  // The command to run, with clip true: with its output sent to the clipboard (the terminal shows nothing until it ends)
  function commands(system, host, family, clip) {
    if (typeof host !== "string") return null;
    var name = host.replace(/^\[|\]$/g, "");
    if (!HOST.test(name) || name.charAt(0) === "-") return null;
    var flag = family === 4 ? " -4" : family === 6 ? " -6" : "";
    var tail = clip === true && CLIPBOARD[system] ? CLIPBOARD[system] : "";
    if (system === "windows") return { main: "tracert -d -h 30 -w 1000" + flag + " " + name + tail, alt: null };
    if (system === "macos") {
      return {
        main: (family === 6 ? "traceroute6 -n -m 30 -w 1 " + name : "traceroute -n -m 30 -w 1 " + name) + tail,
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
    var clipLabel = byId("routeBackClipLabel");
    // Where to get the program and the extension, when the server offers an address for it: a link in the steps of the extension
    var cliLink = byId("routeBackCliLink");
    try {
      window.localStorage.removeItem(TOOL_KEY);
    } catch (error) {
      // Nothing to remove
    }
    var noCommandBox = byId("routeBackNoCommand");
    var altCommand = byId("routeBackAltCommand");
    var mobileBox = byId("routeBackMobile");
    var copyButton = byId("routeBackCopy");
    var systems = byId("routeBackSystems");
    var showButton = byId("routeBackShow");
    var methodBox = byId("routeBackMethod");
    var extensionArea = byId("routeBackExtensionArea");
    var commandArea = byId("routeBackCommandArea");
    var drop = byId("routeBackDrop");
    var fileCard = byId("routeBackFileCard");
    var fileRemove = byId("routeBackFileRemove");
    var uploadButton = byId("routeBackUpload");
    var fileInput = byId("routeBackFile");
    var clearButton = byId("routeBackClear");
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

    // "extension": the browser extension traces and hands the route over; "command": the person runs the command and pastes what it prints.
    // The first visit starts on the command (most people have no extension); the extension saying it is here moves it to the extension, unless
    // the person has already chosen
    var method = "command";
    var methodChosen = false;
    try {
      var savedMethod = window.localStorage.getItem(METHOD_KEY);
      if (savedMethod === "extension" || savedMethod === "command") {
        method = savedMethod;
        methodChosen = true;
      }
    } catch (error) {
      // Only the default
    }

    function drawMethod() {
      Array.prototype.forEach.call(methodBox.querySelectorAll("[data-method]"), function (button) {
        button.setAttribute("aria-pressed", String(button.dataset.method === method));
      });
      extensionArea.hidden = method !== "extension";
      commandArea.hidden = method !== "command";
    }

    // Clear is there only when there is something to clear: text in the box, or a route that was brought
    function drawActions() {
      clearButton.hidden = !(textarea.value !== "" || (typeof options.hasRoute === "function" && options.hasRoute()));
    }

    // While the networks of the text that is shown are being looked up the button says so and is off: the same text pressed again would ask
    // nothing new. Another text can be shown at once.
    function drawShow() {
      var waiting = !!current && !current.settled && current.text === textarea.value;
      showButton.disabled = waiting;
      if (waiting) showButton.setAttribute("aria-busy", "true");
      else showButton.removeAttribute("aria-busy");
      showButton.textContent = t(waiting ? "route.back.show-busy" : "route.back.show");
    }

    function drawCommand() {
      var found = commands(system, options.host, options.family(), clipBox.checked);
      commandBox.textContent = found ? found.main : "";
      copyButton.disabled = !found;
      noCommandBox.hidden = !!found;
      altBox.hidden = !(found && found.alt);
      altCommand.textContent = found && found.alt ? found.alt : "";
      Array.prototype.forEach.call(systems.querySelectorAll("[data-system]"), function (button) {
        button.setAttribute("aria-pressed", String(button.dataset.system === system));
      });
      mobileBox.hidden = !seen.mobile;
      drawMethod();
      drawActions();
      drawShow();
    }

    // The button inside the field of the command is an icon (the copy, and the check for a moment after copying), in the icon set that the
    // visitor chose; its name for a screen reader and for the tip is the word. Without the icons it is the word.
    var copied = false;
    function drawCopy() {
      var label = t(copied ? "route.back.copied" : "route.back.copy");
      copyButton.setAttribute("aria-label", label);
      copyButton.title = label;
      var icon = window.LibreSpeedIcons && window.LibreSpeedIcons.html(copied ? "check" : "copy", "1.2em");
      if (icon) copyButton.innerHTML = icon;
      else copyButton.textContent = label;
    }

    function copy() {
      var found = commands(system, options.host, options.family(), clipBox.checked);
      if (!found) return;
      var done = function () {
        copied = true;
        drawCopy();
        // Said as well as shown: the toast is in a polite live region, and the button is only an icon
        if (window.LibreSpeedToast) window.LibreSpeedToast.show(t("route.back.copied"));
        window.clearTimeout(copiedTimer);
        copiedTimer = window.setTimeout(function () {
          copied = false;
          drawCopy();
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
      drawShow();
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
      drawShow();
      drawActions();
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
      drawFileCard(null);
      setNotes([]);
      drawShow();
      options.onClear();
      drawActions();
    }

    // The output comes into the box in four ways: typed or pasted in it, pasted anywhere on the card (Ctrl+V), dropped on it as text or as a .txt
    // file, or chosen with the clip. In none of them is anything shown or sent: it is in the box, to be shown with the button (what is sent is
    // still what the person presses).
    var loadedText = null;

    function extensionOf(name) {
      var parts = String(name).split(".");
      return parts.length > 1 ? parts.pop().slice(0, 8).toUpperCase() : "";
    }

    function sizeOf(bytes) {
      if (bytes < 1024) return bytes + " B";
      return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + " KB";
    }

    // The file that the text came from, as a card with its name, its kind and its size, while the box has that text as it came
    function drawFileCard(file) {
      if (!file) {
        fileCard.hidden = true;
        loadedText = null;
        return;
      }
      byId("routeBackFileName").textContent = file.name;
      byId("routeBackFileName").title = file.name;
      byId("routeBackFileMeta").textContent = [extensionOf(file.name), sizeOf(file.size)].filter(Boolean).join(" · ");
      fileCard.hidden = false;
    }

    // The icons of the box (the clip, and the ones of the card of the file), in the set of icons that the visitor chose
    function drawDropIcons() {
      var icons = window.LibreSpeedIcons;
      var clip = icons && icons.html("attach", "1.2em");
      var cross = icons && icons.html("close", "1.1em");
      if (clip) uploadButton.innerHTML = clip;
      else uploadButton.textContent = uploadButton.getAttribute("aria-label") || "";
      byId("routeBackFileIcon").innerHTML = (icons && icons.html("attach", "1.2em")) || "";
      if (cross) fileRemove.innerHTML = cross;
      else fileRemove.textContent = "\u00d7";
    }

    // Text that arrives on the card (pasted outside the box, or dropped): it goes into the box, in place of what was there
    function putText(text) {
      if (typeof text !== "string" || !text.trim()) return false;
      if (text.length > MAX_TEXT) {
        setNotes([{ key: "route.back.error.too-long", error: true }]);
        return false;
      }
      setNotes([]);
      textarea.value = text;
      drawFileCard(null);
      drawActions();
      drawShow();
      showButton.focus();
      return true;
    }

    // Something that is not text (an image, a PDF) is told so; a text file is read and put in the box
    function isTextFile(file) {
      if (file.type && file.type.indexOf("text/") === 0) return true;
      if (file.type && file.type !== "application/octet-stream") return /\.(txt|log|out|text)$/i.test(file.name);
      return !/\.(png|jpe?g|gif|webp|bmp|svg|pdf|zip|gz|docx?|xlsx?)$/i.test(file.name);
    }

    function takeFile(file) {
      if (!file || !isTextFile(file)) {
        setNotes([{ key: "route.back.file-type", error: true }]);
        return;
      }
      // 32768 characters (the limit of the box and of the parser) are at most 131072 bytes, at 4 bytes a character
      if (file.size > MAX_FILE_BYTES || typeof file.arrayBuffer !== "function") {
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
          loadedText = text;
          drawFileCard(file);
          drawActions();
          drawShow();
          showButton.focus();
        },
        function () {
          setNotes([{ key: "route.back.file-bad", error: true }]);
        }
      );
    }

    // Dropping on the box: it takes the colour of the action while something is over it
    function carries(event) {
      var types = (event.dataTransfer && event.dataTransfer.types) || [];
      return (
        Array.prototype.indexOf.call(types, "Files") >= 0 || Array.prototype.indexOf.call(types, "text/plain") >= 0
      );
    }
    drop.addEventListener("dragenter", function (event) {
      if (!carries(event)) return;
      event.preventDefault();
      drop.classList.add("dragging");
    });
    drop.addEventListener("dragover", function (event) {
      if (!carries(event)) return;
      event.preventDefault();
      drop.classList.add("dragging");
    });
    drop.addEventListener("dragleave", function (event) {
      if (!drop.contains(event.relatedTarget)) drop.classList.remove("dragging");
    });
    drop.addEventListener("drop", function (event) {
      drop.classList.remove("dragging");
      var transfer = event.dataTransfer;
      if (!transfer) return;
      if (transfer.files && transfer.files.length) {
        event.preventDefault();
        takeFile(transfer.files[0]);
        return;
      }
      // Text dropped on the box itself goes where it is dropped; on the rest of the field it goes into the box
      if (event.target === textarea) return;
      var text = transfer.getData("text/plain");
      if (text) {
        event.preventDefault();
        putText(text);
      }
    });
    // Ctrl+V on the card, with the focus anywhere (the box itself keeps its own paste): a file is read, a text goes into the box. The listener is
    // on the window and does nothing while the card is not on the screen, or when the paste is for another field of the page.
    window.addEventListener("paste", function (event) {
      if (byId("routeBack").getClientRects().length === 0) return;
      var data = event.clipboardData;
      if (!data) return;
      if (data.files && data.files.length) {
        event.preventDefault();
        takeFile(data.files[0]);
        return;
      }
      // The box itself, and any other field, keep their own paste
      var target = event.target;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      var text = data.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      putText(text);
    });
    fileRemove.addEventListener("click", function () {
      textarea.value = "";
      drawFileCard(null);
      setNotes([]);
      drawActions();
      drawShow();
      textarea.focus();
    });
    window.addEventListener("iconschange", drawDropIcons);
    drawDropIcons();
    // What to do after turning the clipboard on is a toast, once, when it is turned on (and, on Linux, which tool puts it there): the command
    // shows nothing until it ends, and then the output is pasted on the card
    function tellClipboard() {
      if (!window.LibreSpeedToast || !clipBox.checked || !commands(system, options.host, options.family(), true))
        return;
      window.LibreSpeedToast.show(t("route.back.clip-hint"));
      if (system === "linux") window.LibreSpeedToast.show(t("route.back.clip-linux"));
    }
    clipBox.addEventListener("change", function () {
      drawCommand();
      tellClipboard();
    });
    Array.prototype.forEach.call(methodBox.querySelectorAll("[data-method]"), function (button) {
      button.addEventListener("click", function () {
        method = button.dataset.method === "extension" ? "extension" : "command";
        methodChosen = true;
        try {
          window.localStorage.setItem(METHOD_KEY, method);
        } catch (error) {
          // The choice only lasts until the page is closed
        }
        drawMethod();
      });
    });
    // The file can be chosen as well as dropped on the box; what is in it is read as a dropped one is
    uploadButton.addEventListener("click", function () {
      fileInput.click();
    });
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (file) takeFile(file);
    });
    textarea.addEventListener("input", function () {
      // Edited, the box is no longer the text of the file: the card goes
      if (loadedText !== null && textarea.value !== loadedText) drawFileCard(null);
      drawActions();
      drawShow();
    });

    Array.prototype.forEach.call(systems.querySelectorAll("[data-system]"), function (button) {
      button.addEventListener("click", function () {
        var before = system;
        system = button.dataset.system;
        drawCommand();
        // Already on, and the system is now Linux: the note about the tool that it uses
        if (
          clipBox.checked &&
          system === "linux" &&
          before !== "linux" &&
          window.LibreSpeedToast &&
          commands(system, options.host, options.family(), true)
        ) {
          window.LibreSpeedToast.show(t("route.back.clip-linux"));
        }
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
        // The extension is here and the person has not chosen: it is the easier way
        if (extensionHere && !methodChosen && method !== "extension") {
          method = "extension";
          drawMethod();
        }
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
    // The icon is there when the set of icons is: now, or when it changes
    window.addEventListener("iconschange", drawCopy);
    drawCopy();
    drawCommand();

    return {
      // The address that the server offers to get the program and the extension from (null or anything that is not a plain https address: no link)
      setCli: function (value) {
        var address = cliUrl(value);
        cliLink.hidden = address === null;
        if (address !== null) cliLink.href = address;
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
        drawCopy();
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
