/**
 * Route history, the part that is only data: what is saved of a route, the row of its summary and the check of "did the path change"
 *
 * It does not touch the page or the storage: route.js gives the history to LibreSpeedHistory and uses this to build what is saved
 * and to trust what comes back (what is in the storage may be old, cut or written by hand, so a route is rebuilt field by field).
 * Needs LibreSpeedRouteView (route-view.js).
 *
 * LibreSpeedRouteHistory.trim(data) is the route kept: the fields the page uses, with their types checked, or null when it is not a
 *   route that can be drawn. A route drawn from trim(data) is the same as one drawn from data.
 * LibreSpeedRouteHistory.signature(data) is the path as the public networks in order ("AS3356>AS15169"), or "". The internal network, the
 *   hops that did not answer, a router with no network, the address of the router and the visitor's own hop do not change it; the
 *   network of the visitor goes at the end.
 * LibreSpeedRouteHistory.compare(current, rows) is true when the path is not the one of the last route from the same IP version and
 *   the same network of the visitor, false when it is, null when there is nothing to compare (rows: the summary, newest first).
 * LibreSpeedRouteHistory.entryOf(data, time, rows) is what the history saves for a route, or null.
 * LibreSpeedRouteHistory.rowOf(entry) is the row of the summary of an entry (no address), or null.
 * LibreSpeedRouteHistory.slim(entry) is the entry without the route (and so without any address).
 */
var LibreSpeedRouteHistory = (function () {
  "use strict";

  var MAX_HOPS = 64;
  var AS = /^AS\d{1,10}$/;
  var SCOPES = { public: true, private: true, cgnat: true, none: true };

  function finite(value) {
    return typeof value === "number" && isFinite(value);
  }

  function text(value, limit) {
    return typeof value === "string" ? value.slice(0, limit) : null;
  }

  function trimHop(hop) {
    if (!hop || typeof hop !== "object" || !finite(hop.ttl)) return null;
    var result = {
      ttl: hop.ttl,
      ip: text(hop.ip, 64),
      rtt_min: finite(hop.rtt_min) ? hop.rtt_min : null,
      sent: finite(hop.sent) ? hop.sent : 0,
      answered: finite(hop.answered) ? hop.answered : 0,
      scope: SCOPES[hop.scope] === true ? hop.scope : "none"
    };
    if (Array.isArray(hop.alt_ips)) {
      var alt = hop.alt_ips
        .filter(function (ip) {
          return typeof ip === "string";
        })
        .slice(0, 8)
        .map(function (ip) {
          return ip.slice(0, 64);
        });
      if (alt.length) result.alt_ips = alt;
    }
    var asn = text(hop.asn, 16);
    if (asn) result.asn = asn;
    var name = text(hop.as_name, 200);
    if (name) result.as_name = name;
    var country = text(hop.country, 8);
    if (country) result.country = country;
    if (hop.country_doubt === true) result.country_doubt = true;
    if (hop.is_target === true) result.is_target = true;
    return result;
  }

  function trim(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.hops)) return null;
    if (data.hops.length === 0 || data.hops.length > MAX_HOPS) return null;
    var hops = [];
    for (var i = 0; i < data.hops.length; i++) {
      var hop = trimHop(data.hops[i]);
      if (hop === null) return null;
      hops.push(hop);
    }
    var as = data.target_as && typeof data.target_as === "object" ? data.target_as : null;
    return {
      family: data.family === 6 ? 6 : 4,
      target_reached: data.target_reached === true,
      target_as: as ? { asn: text(as.asn, 16), as_name: text(as.as_name, 200) } : null,
      target_country: text(data.target_country, 8),
      pmtu: finite(data.pmtu) ? data.pmtu : null,
      pmtu_drops: (Array.isArray(data.pmtu_drops) ? data.pmtu_drops : [])
        .filter(function (drop) {
          return drop && finite(drop.ttl) && finite(drop.from) && finite(drop.to);
        })
        .slice(0, 20)
        .map(function (drop) {
          return { ttl: drop.ttl, from: drop.from, to: drop.to };
        }),
      hops: hops
    };
  }

  function signature(data) {
    var list = [];
    var hops = data && Array.isArray(data.hops) ? data.hops : [];
    hops.forEach(function (hop) {
      if (!hop || hop.scope !== "public" || hop.is_target === true) return;
      if (typeof hop.asn !== "string" || !AS.test(hop.asn)) return;
      if (list[list.length - 1] !== hop.asn) list.push(hop.asn);
    });
    var own = data && data.target_as && typeof data.target_as.asn === "string" ? data.target_as.asn : null;
    if (own !== null && AS.test(own) && list[list.length - 1] !== own) list.push(own);
    return list.join(">");
  }

  function sameNetwork(a, b) {
    return (a === undefined || a === null ? null : a) === (b === undefined || b === null ? null : b);
  }

  function compare(current, rows) {
    if (!current || !current.path) return null;
    var list = Array.isArray(rows) ? rows : [];
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (!row || typeof row !== "object" || row.f !== current.f || !sameNetwork(row.as, current.as)) continue;
      if (typeof row.path === "string" && row.path !== "") return row.path !== current.path;
    }
    return null;
  }

  function entryOf(data, time, rows) {
    var kept = trim(data);
    if (kept === null || !finite(time)) return null;
    var last = window.LibreSpeedRouteView.chartData(kept).last;
    var asn =
      kept.target_as && typeof kept.target_as.asn === "string" && AS.test(kept.target_as.asn)
        ? kept.target_as.asn
        : null;
    var entry = {
      t: time,
      f: kept.family,
      hops: kept.hops.length,
      nets: window.LibreSpeedRouteView.groups(kept.hops).length,
      ms: last === null ? null : Math.round(last.ms * 100) / 100,
      mtu: kept.pmtu,
      reached: kept.target_reached,
      as: asn,
      path: signature(kept),
      changed: null,
      jump: window.LibreSpeedRouteView.biggestJump(kept.hops),
      data: kept
    };
    entry.changed = compare(entry, rows);
    return entry;
  }

  function rowOf(entry) {
    if (!entry || typeof entry !== "object" || !finite(entry.t)) return null;
    return {
      t: entry.t,
      f: entry.f === 6 ? 6 : 4,
      hops: finite(entry.hops) ? entry.hops : 0,
      nets: finite(entry.nets) ? entry.nets : 0,
      ms: finite(entry.ms) ? entry.ms : null,
      mtu: finite(entry.mtu) ? entry.mtu : null,
      reached: entry.reached === true,
      as: typeof entry.as === "string" && AS.test(entry.as) ? entry.as : null,
      path: typeof entry.path === "string" ? entry.path : "",
      changed: entry.changed === true ? true : entry.changed === false ? false : null
    };
  }

  function slim(entry) {
    var result = {};
    for (var key in entry) if (key !== "data") result[key] = entry[key];
    return result;
  }

  return { trim: trim, signature: signature, compare: compare, entryOf: entryOf, rowOf: rowOf, slim: slim };
})();
