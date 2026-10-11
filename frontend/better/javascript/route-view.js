/* exported LibreSpeedRouteView */
/**
 * The pure part of the route page: what is worked out from the answer of backend/route.php, with no DOM
 *
 * LibreSpeedRouteView.groups(hops) is the networks on the way: runs of hops of the same network (AS), of internal hops, or of
 * public hops that are not in the database. A hop with no answer stays in the run it is in.
 * LibreSpeedRouteView.biggestJump(hops) is where the time rises the most, as a hint: { from, to, ms }, or null.
 * LibreSpeedRouteView.floors(hops) is the lowest time from each hop to the end, and chartData(data) what the chart draws.
 * LibreSpeedRouteView.mapData(data) is the countries and the networks (as points) of the route, for the map.
 * LibreSpeedRouteView.mtuText(pmtu, drops) is { key, params } of the text about the MTU of the path.
 * LibreSpeedRouteView.countryName(code, language) is the name of a country in the language of the page.
 */
(function () {
  "use strict";

  // The smallest rise that is worth telling, in ms
  var MIN_JUMP = 10;

  function kindOf(hop) {
    if (hop.scope === "none") return null;
    if (hop.scope === "private" || hop.scope === "cgnat") return "internal";
    if (hop.asn) return "as:" + hop.asn;
    return "unknown";
  }

  function groups(hops) {
    var result = [];
    var current = null;
    var waiting = null;
    for (var i = 0; i < hops.length; i++) {
      var hop = hops[i];
      var kind = kindOf(hop);
      if (kind === null) {
        // A hop with no answer is in the run that is open, or in the next one when there is none yet
        if (current) current.to = hop.ttl;
        else if (waiting === null) waiting = hop.ttl;
        continue;
      }
      if (current && current.key === kind) {
        current.to = hop.ttl;
        if (hop.rtt_min !== null) current.rttTo = hop.rtt_min;
        continue;
      }
      current = {
        key: kind,
        kind: kind.indexOf("as:") === 0 ? "as" : kind,
        asn: hop.asn || null,
        name: hop.as_name || null,
        from: waiting === null ? hop.ttl : waiting,
        to: hop.ttl,
        rttFrom: hop.rtt_min,
        rttTo: hop.rtt_min
      };
      waiting = null;
      result.push(current);
    }
    return result.map(function (group) {
      delete group.key;
      return group;
    });
  }

  // The time of a hop, or null when it did not answer (old data can carry a time in a hop with no answer: the scope wins)
  function timeOf(hop) {
    return hop.scope !== "none" && typeof hop.rtt_min === "number" ? hop.rtt_min : null;
  }

  // The time of a hop is the best of its answers. A router that is slow to make an ICMP answer shows a peak that is not
  // in the path, so the rise is worked out on the lowest time from each hop to the end: a peak that goes away does not count.
  // This is that lowest time, aligned with hops (null where the hop did not answer)
  function floors(hops) {
    var result = [];
    var lowest = Infinity;
    for (var i = hops.length - 1; i >= 0; i--) {
      var time = timeOf(hops[i]);
      if (time === null) {
        result[i] = null;
        continue;
      }
      lowest = Math.min(lowest, time);
      result[i] = lowest;
    }
    return result;
  }

  function biggestJump(hops) {
    var floor = floors(hops);
    var best = null;
    var before = null;
    for (var i = 0; i < hops.length; i++) {
      if (floor[i] === null) continue;
      if (before !== null) {
        var ms = floor[i] - floor[before];
        if (best === null || ms > best.ms) best = { from: hops[before].ttl, to: hops[i].ttl, ms: ms };
      }
      before = i;
    }
    if (best === null || best.ms < MIN_JUMP) return null;
    best.ms = Math.round(best.ms);
    return best;
  }

  // Upper end of the time axis: the next "round" value above the value
  function niceMax(value) {
    var steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    var magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(value, 1))));
    for (var i = 0; i < steps.length; i++) if (steps[i] * magnitude >= value) return steps[i] * magnitude;
    return 10 * magnitude;
  }

  // What the chart of the route draws, all arrays aligned with data.hops:
  //   x the number of each hop (also the ones with no answer), y the time measured or null, slow true for a router that was
  //   slow to answer (the next ones answered sooner: its time is not on the way), line what the line draws (the lowest time
  //   from there to the end for a slow one), internal for hops of the internal network, target the number of the hop that is
  //   the visitor, jump the largest rise, drops the places where the MTU drops (between two hops, so at x - 0.5),
  //   first and last the first and the last hop that answered, yMax the top of the time axis
  function chartData(data) {
    var hops = data.hops || [];
    var floor = floors(hops);
    var result = {
      x: [],
      y: [],
      slow: [],
      line: [],
      internal: [],
      target: null,
      jump: biggestJump(hops),
      drops: (data.pmtu_drops || []).map(function (drop) {
        return { x: drop.ttl - 0.5, from: drop.from, to: drop.to };
      }),
      first: null,
      last: null,
      yMax: 10
    };
    var largest = 0;
    hops.forEach(function (hop, i) {
      var time = timeOf(hop);
      var slow = time !== null && time - floor[i] >= MIN_JUMP;
      result.x.push(hop.ttl);
      result.y.push(time);
      result.slow.push(slow);
      result.line.push(time === null ? null : slow ? floor[i] : time);
      result.internal.push(hop.scope === "private" || hop.scope === "cgnat");
      if (hop.is_target === true) result.target = hop.ttl;
      if (time !== null) {
        if (result.first === null) result.first = { ttl: hop.ttl, ms: time };
        result.last = { ttl: hop.ttl, ms: time };
        largest = Math.max(largest, time);
      }
    });
    if (largest > 0) result.yMax = niceMax(largest * 1.1);
    return result;
  }

  var CODE = /^[A-Z]{2}$/;

  function countryOf(value) {
    return typeof value === "string" && CODE.test(value) ? value : null;
  }

  // The most frequent code of the list (a tie goes to the one seen first), or null
  function mostFrequent(codes) {
    var count = {};
    var best = null;
    codes.forEach(function (code) {
      count[code] = (count[code] || 0) + 1;
      if (best === null || count[code] > count[best]) best = code;
    });
    return best;
  }

  // The networks of groups(hops) as points of the map, in the same order (n is the number in the list "Networks on the
  // way"). country is where the network hands the route on: the last country of its public hops that are not country_doubt (when
  // all of them are, the most frequent of those, and doubt is true). via is the countries of its firm hops in the order of the
  // route, more than one when the network goes through more than one country: the line goes through all of them. A network with
  // no country (internal, or public hops with no country) is drawn with the network before it that has a firm country, or at the
  // start with the first country of the one after it (borrowed): never with a doubt one, and never with the visitor. country is
  // null when there is nothing to borrow.
  function nodesOf(hops) {
    var nodes = groups(hops).map(function (group, index) {
      var firm = [];
      var doubtful = [];
      // The countries of the firm hops, in the order of the route and with the same country in a row only once
      var via = [];
      hops.forEach(function (hop) {
        if (hop.ttl < group.from || hop.ttl > group.to || hop.scope !== "public") return;
        var code = countryOf(hop.country);
        if (code === null) return;
        if (hop.country_doubt === true) {
          doubtful.push(code);
          return;
        }
        firm.push(code);
        if (via[via.length - 1] !== code) via.push(code);
      });
      var own = mostFrequent(firm);
      return {
        n: index + 1,
        kind: group.kind,
        asn: group.asn,
        name: group.name,
        from: group.from,
        to: group.to,
        // The country of the number is where the network hands the route on: the last of its countries
        country: own !== null ? via[via.length - 1] : mostFrequent(doubtful),
        doubt: own === null && doubtful.length > 0,
        borrowed: false,
        via: own !== null ? via : []
      };
    });
    // A network with no country is drawn next to the one before it (where that one hands the route on) or, at the start, next to
    // the one after it (where that one takes the route in: the first of its countries)
    function lender(start, step) {
      for (var j = start; j >= 0 && j < nodes.length; j += step)
        if (nodes[j].country !== null && !nodes[j].doubt && !nodes[j].borrowed)
          return step > 0 && nodes[j].via.length ? nodes[j].via[0] : nodes[j].country;
      return null;
    }
    nodes.forEach(function (node, i) {
      if (node.country !== null) return;
      node.country = lender(i - 1, -1) || lender(i + 1, 1);
      node.borrowed = node.country !== null;
    });
    return nodes;
  }

  // Light in fiber goes about 204 km each ms; the least rise of the time to cross a sea is the two ways of the distance, with
  // some room (0.8) because the ends of a crossing are regions and not the towns where the cables land
  var FIBER_KM_PER_MS = 204;
  var CROSSING_ROOM = 0.8;

  function kmBetween(a, b) {
    var rad = Math.PI / 180;
    var h =
      Math.pow(Math.sin(((b.lat - a.lat) * rad) / 2), 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.pow(Math.sin(((b.lon - a.lon) * rad) / 2), 2);
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // The corridors of the table that can be used, by "AA-BB": two codes in order, and two regions that exist and are in the
  // country of their side. Ends more than half the world apart (the Pacific) are used: the map draws that curve round the date line
  function corridorsOf(table) {
    var result = {};
    if (!table || typeof table !== "object" || !table.regions || !table.corridors || !table.corridors.length)
      return result;
    table.corridors.forEach(function (corridor) {
      var pair = corridor && corridor.pair;
      var ends = corridor && corridor.ends;
      if (!pair || !ends || pair.length !== 2 || ends.length !== 2) return;
      if (!countryOf(pair[0]) || !countryOf(pair[1]) || pair[0] >= pair[1]) return;
      var a = table.regions[ends[0]];
      var b = table.regions[ends[1]];
      if (!a || !b || a.country !== pair[0] || b.country !== pair[1]) return;
      var key = pair.join("-");
      if (!result[key]) result[key] = { regions: [ends[0], ends[1]], countries: [pair[0], pair[1]], points: [a, b] };
    });
    return result;
  }

  // Where the route crosses a sea by submarine cable. It is the stretch between two networks of the line that are in the two
  // countries of a corridor of the table, and only when the time rose at least what light in fiber needs to cross that sea:
  // the rise is from the start of the run of networks in the first country to the end of the run in the second one, so a
  // crossing inside a network that the database puts in one of the two countries is counted. Each one is
  // { from, to (the n of the two networks), key "AA-BB", start and end (the region of each side, in the way of the route), ms }.
  // Without a table, or with a table that cannot be used, there is none. Only a change of country between two networks of the line,
  // or inside the first one, is looked for: a sea crossed inside a later network that has routers in three countries is not.
  function crossingsOf(hops, nodes, line, table) {
    var result = [];
    var corridors = corridorsOf(table);
    if (!line || line.length < 2 || !hops || !hops.length) return result;
    var floor = floors(hops);
    function timeAt(node, last) {
      var found = null;
      hops.forEach(function (hop, i) {
        if (hop.ttl < node.from || hop.ttl > node.to || floor[i] === null) return;
        if (found === null || last) found = floor[i];
      });
      return found;
    }
    var linked = line.map(function (n) {
      return nodes[n - 1];
    });
    // The first network of the line has no network before it: its own change of country (its hops in the first country, then in the
    // second) is a crossing too, with the rise from its first hop in the first country to its last in the second
    var head = linked[0];
    if (head.via && head.via.length > 1) {
      var runs = [];
      hops.forEach(function (hop, i) {
        if (hop.ttl < head.from || hop.ttl > head.to || hop.scope !== "public" || hop.country_doubt === true) return;
        var code = countryOf(hop.country);
        if (code === null || floor[i] === null) return;
        var last = runs[runs.length - 1];
        if (!last || last.code !== code) runs.push({ code: code, first: floor[i], last: floor[i] });
        else last.last = floor[i];
      });
      for (var r = 1; r < runs.length; r++) {
        var inner = corridors[[runs[r - 1].code, runs[r].code].sort().join("-")];
        if (!inner) continue;
        var innerSide = runs[r - 1].code === inner.countries[0] ? 0 : 1;
        var innerMin = Math.round((CROSSING_ROOM * 2 * kmBetween(inner.points[0], inner.points[1])) / FIBER_KM_PER_MS);
        var innerRise = Math.round(runs[r].last - runs[r - 1].first);
        if (innerRise < innerMin) continue;
        result.push({
          from: head.n,
          to: head.n,
          key: inner.countries.join("-"),
          start: inner.regions[innerSide],
          end: inner.regions[1 - innerSide],
          ms: innerRise
        });
      }
    }
    // The first and the last hop of the run of firm hops of a network in one country (the first run for "first", else the last one),
    // as the time floor of that hop; null when the network has no such hop
    function runTime(node, code, first) {
      var runs = [];
      hops.forEach(function (hop, i) {
        if (hop.ttl < node.from || hop.ttl > node.to || hop.scope !== "public" || hop.country_doubt === true) return;
        if (countryOf(hop.country) === null || floor[i] === null) return;
        var run = runs[runs.length - 1];
        if (!run || run.code !== hop.country) runs.push({ code: hop.country, first: floor[i], last: floor[i] });
        else run.last = floor[i];
      });
      var wanted = runs.filter(function (run) {
        return run.code === code;
      });
      if (!wanted.length) return null;
      return first ? wanted[wanted.length - 1].first : wanted[0].last;
    }
    for (var i = 1; i < linked.length; i++) {
      var p = linked[i - 1];
      var q = linked[i];
      if (p.country === q.country) continue;
      // The country the route goes to from the one of p: the first country of q that is not the one of p (a network that goes
      // through a third country first does not cross the sea of p to q.country, and the step from that country on is not looked for)
      var entry = q.country;
      for (var v = 0; v < q.via.length; v++) {
        if (q.via[v] !== p.country) {
          entry = q.via[v];
          break;
        }
      }
      var key = [p.country, entry].sort().join("-");
      var corridor = corridors[key];
      if (!corridor) continue;
      var start = i - 1;
      while (start > 0 && linked[start - 1].country === p.country) start--;
      var end = i;
      if (entry === q.country) while (end < linked.length - 1 && linked[end + 1].country === q.country) end++;
      // The rise is from the first hop in the country of p to the last one in the country of q. A network that has hops in more
      // than one country counts only its hops in that country, so a rise it already made is not made again
      var t0 = linked[start].via.length > 1 ? runTime(linked[start], p.country, true) : timeAt(linked[start], false);
      var t1 =
        linked[end].via.length > 1 || entry !== q.country
          ? runTime(linked[end], entry, false)
          : timeAt(linked[end], true);
      if (t0 === null) t0 = timeAt(linked[start], false);
      if (t0 === null || t1 === null) continue;
      var side = p.country === corridor.countries[0] ? 0 : 1;
      var min = Math.round((CROSSING_ROOM * 2 * kmBetween(corridor.points[0], corridor.points[1])) / FIBER_KM_PER_MS);
      var rise = Math.round(t1 - t0);
      if (rise < min) continue;
      result.push({
        from: p.n,
        to: q.n,
        key: key,
        start: corridor.regions[side],
        end: corridor.regions[1 - side],
        ms: rise
      });
    }
    return result;
  }

  // The countries of the route, for the map. A stop is a run of public hops in the same country (hops of the internal network,
  // hops with no answer and hops with no country in between do not break it). A country is "doubt" when all its hops are
  // country_doubt. nodes are the networks of the route as points (nodesOf), and line the n of the ones the line links: the
  // ones with a country that is not doubt. you is the country of the visitor (target_country, or the country of the hop that is the
  // visitor), tail is true when the route did not reach the visitor and the visitor is in another country than the last network
  // of the line. crossings are the places where the line crosses a sea by cable (crossingsOf, with the table when it is given).
  function mapData(data, table) {
    var hops = data.hops || [];
    var stops = [];
    var current = null;
    var visitor = null;
    hops.forEach(function (hop) {
      if (hop.is_target === true && visitor === null) visitor = countryOf(hop.country);
      var code = hop.scope === "public" ? countryOf(hop.country) : null;
      if (code === null) return;
      var doubt = hop.country_doubt === true;
      if (current && current.code === code) {
        current.to = hop.ttl;
        current.hops.push(hop.ttl);
        current.doubt = current.doubt && doubt;
        return;
      }
      current = { code: code, from: hop.ttl, to: hop.ttl, hops: [hop.ttl], doubt: doubt };
      stops.push(current);
    });

    var countries = [];
    var byCode = {};
    stops.forEach(function (stop) {
      var country = byCode[stop.code];
      if (!country) {
        country = { code: stop.code, hops: [], doubt: true, you: false };
        byCode[stop.code] = country;
        countries.push(country);
      }
      country.hops = country.hops.concat(stop.hops);
      country.doubt = country.doubt && stop.doubt;
    });

    var you = countryOf(data.target_country) || visitor;
    if (you !== null) {
      if (byCode[you]) {
        byCode[you].you = true;
      } else {
        countries.push({ code: you, hops: [], doubt: false, you: true });
      }
    }

    var nodes = nodesOf(hops);
    var line = nodes
      .filter(function (node) {
        return node.country !== null && !node.doubt;
      })
      .map(function (node) {
        return node.n;
      });
    var last = line.length ? nodes[line[line.length - 1] - 1] : null;
    // A network that goes through more than one country ends the line in the last of them
    var lastCountry = last === null ? null : last.via.length ? last.via[last.via.length - 1] : last.country;
    var tail = !data.target_reached && you !== null && last !== null && lastCountry !== you;
    return {
      stops: stops,
      countries: countries,
      nodes: nodes,
      line: line,
      you: you,
      tail: tail,
      crossings: crossingsOf(hops, nodes, line, table)
    };
  }

  // The networks of a route, in order, each once in a row: the public hops that have a network, without the end of the route (the visitor
  // in the way from the server, the server in the way back)
  function asPath(data) {
    var list = [];
    var hops = (data && data.hops) || [];
    for (var i = 0; i < hops.length; i++) {
      var hop = hops[i];
      if (hop.scope !== "public" || hop.is_target === true || !hop.asn) continue;
      if (list.length === 0 || list[list.length - 1] !== hop.asn) list.push(hop.asn);
    }
    return list;
  }

  // The two directions side by side: { state, there, back, onlyThere, onlyBack, a, b }
  //   state "need-both": one of them is missing; "family": not the same IP version; "unknown": too few networks in one of them;
  //   "same": the same networks in the same order (the way back read from its end); "order": the same networks, in another order;
  //   "different": a network that is in only one of them
  function compareDirections(there, back) {
    var result = { state: "need-both", there: [], back: [], onlyThere: [], onlyBack: [], a: null, b: null };
    if (!there || !back) return result;
    if (there.family !== back.family) {
      result.state = "family";
      result.a = there.family;
      result.b = back.family;
      return result;
    }
    result.there = asPath(there);
    result.back = asPath(back);
    if (result.there.length < 2 || result.back.length < 2) {
      result.state = "unknown";
      return result;
    }
    var reversed = result.back.slice().reverse();
    var same =
      result.there.length === reversed.length &&
      result.there.every(function (asn, index) {
        return asn === reversed[index];
      });
    result.onlyThere = result.there.filter(function (asn) {
      return result.back.indexOf(asn) < 0;
    });
    result.onlyBack = result.back.filter(function (asn) {
      return result.there.indexOf(asn) < 0;
    });
    // A network that comes back in a different place is the same network: only the ones that are in one way count as different
    result.state = same ? "same" : result.onlyThere.length || result.onlyBack.length ? "different" : "order";
    return result;
  }

  function mtuText(pmtu, drops) {
    if (pmtu === null || pmtu === undefined) return { key: "route.mtu-unknown", params: {} };
    if (!drops || !drops.length) return { key: "route.mtu", params: { mtu: pmtu } };
    // The "F=" shows at the first hop after the narrowest link: the drop is between the hop before and that one
    var last = drops[drops.length - 1];
    return {
      key: "route.mtu-drop",
      params: { mtu: pmtu, from: last.from, to: last.to, before: last.ttl - 1, hop: last.ttl }
    };
  }

  function countryName(code, language) {
    try {
      return new Intl.DisplayNames([language], { type: "region" }).of(code) || code;
    } catch (error) {
      return code;
    }
  }

  window.LibreSpeedRouteView = {
    groups: groups,
    biggestJump: biggestJump,
    floors: floors,
    chartData: chartData,
    mapData: mapData,
    crossingsOf: crossingsOf,
    nodesOf: nodesOf,
    niceMax: niceMax,
    asPath: asPath,
    compareDirections: compareDirections,
    mtuText: mtuText,
    countryName: countryName
  };
})();
