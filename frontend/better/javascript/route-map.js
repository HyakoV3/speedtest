/* global LibreSpeedWorld, LibreSpeedRouteCrossings */
/* exported LibreSpeedRouteMap */
/**
 * Map of the route: the networks it goes through, each one a numbered point in the country where the database places it
 *
 * Loaded by route.js only when the map is chosen (with the shapes of vendor/world-110m.js), so nothing here runs before. It does
 * not listen to events and does not write texts of the page: route.js builds the data (LibreSpeedRouteView.mapData), the list and the
 * key, and calls render again when the language changes. The colors come from the CSS (the SVG is part of the page), so a theme
 * or contrast change needs no redrawing.
 *
 * A point is a network of the list "Networks on the way", with the number it has there. It is drawn in the country of its routers
 * as the database says, which is not where the routers are. The networks of one country go on a short line through its middle, in
 * order, and then the ones that still touch are pushed apart: inside a country the place of a point only keeps the points apart.
 * The line links the points in order (a curve between countries, a straight piece inside one). Nothing is a pin or a city.
 * Where the route crosses a sea by submarine cable (data.crossings, from route-crossings.js), the curve between the two countries
 * goes by two small marks with no number: the regions where the cables of that sea land, which are approximate.
 *
 * The map can be zoomed and moved by the person: the buttons of controls (data-zoom="in|out|world|fit"), Ctrl + scroll (a plain
 * scroll is left to the page), two fingers or the drag of the pointer (a finger moves the map only after a zoom, so that the map
 * is not a trap for the scroll of the page on a phone). The points and the lines keep their size in px. The zoom is kept while
 * the language changes and goes back to the frame of the route (resetView) when there is a new route.
 *
 * LibreSpeedRouteMap.render(host, data, controls) draws the map in host, in place of the one that was there (data is what
 *   LibreSpeedRouteView.mapData() gives, controls the element with the buttons of the zoom, or nothing); it draws again by itself
 *   when the width of host changes.
 * LibreSpeedRouteMap.resetView() goes back to the frame of the route.
 * LibreSpeedRouteMap.destroy() takes the map away (the zoom of the person stays).
 * LibreSpeedRouteMap.has(code) tells whether the country is on the map (a shape or a spot).
 * LibreSpeedRouteMap.info() is { builds, width, frame, auto, user, aspect, painted, legs, nodes, ring, unplaced, landings, waypoints }: for the tests only.
 */
var LibreSpeedRouteMap = (function () {
  "use strict";

  var SVG = "http://www.w3.org/2000/svg";
  // The smallest frame, in units of the map (the world is 360 wide): with one point per network, a route through Europe needs
  // this zoom at 360 px (60 left Belgium and Luxembourg 8 px apart)
  var MIN_FRAME = 36;
  var PADDING = 4;
  // The points of the networks, in px: a number of two digits fits in the circle, and two centres are never nearer than SPACING
  var RADIUS = 7;
  var FONT = 9.5;
  var SPACING = 20;

  var host = null;
  var data = null;
  var observer = null;
  var onResize = null;
  // How much one step of the zoom changes the width of the frame, and the smallest and the largest frame
  var STEP = 1.5;
  var WHEEL = 1.25;
  // What the person chose: { cx, cy, w } (the middle and the width of the frame, in units of the map), or null for the frame of the route
  var user = null;
  var controls = null;
  var removers = [];
  var state = {
    builds: 0,
    width: 0,
    frame: [0, 0, 0, 0],
    auto: [0, 0, 0, 0],
    user: false,
    aspect: 1.5,
    painted: {},
    legs: [],
    nodes: [],
    ring: null,
    unplaced: [],
    landings: [],
    waypoints: []
  };

  function has(code) {
    return !!(LibreSpeedWorld.centers[code] || LibreSpeedWorld.points[code]);
  }

  // The middle of a country: [x, y], or null when it is not on the map
  function position(code) {
    var center = LibreSpeedWorld.centers[code];
    if (center) return [center[0], center[1]];
    var point = LibreSpeedWorld.points[code];
    return point ? [point[0], point[1]] : null;
  }

  // The box of a country: [x0, y0, x1, y1], or null
  function boxOf(code) {
    var center = LibreSpeedWorld.centers[code];
    if (center) return center.slice(2);
    var point = LibreSpeedWorld.points[code];
    return point ? [point[0] - 2, point[1] - 2, point[0] + 2, point[1] + 2] : null;
  }

  // The place of a region of the table of crossings: [x, y] in units of the map, or null
  function regionAt(key) {
    var table = typeof LibreSpeedRouteCrossings === "object" ? LibreSpeedRouteCrossings : null;
    var region = table && table.regions ? table.regions[key] : null;
    return region ? [region.lon + 180, 84 - region.lat] : null;
  }

  // The crossing that is between the networks from and to, or null
  function crossingOf(md, from, to) {
    var list = md.crossings || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].from === from && list[i].to === to && regionAt(list[i].start) && regionAt(list[i].end))
        return list[i];
    }
    return null;
  }

  // All of the world in the shape of the host (the same proportion as the frame of a route, so the map does not change its height
  // between the two): the whole width, centred in height, with sea over and under the world when the host is taller than it
  function worldFrame(aspect) {
    var w = LibreSpeedWorld.width;
    var h = w / aspect;
    if (h <= LibreSpeedWorld.height) return [0, 0, w, LibreSpeedWorld.height];
    return [0, (LibreSpeedWorld.height - h) / 2, w, h];
  }

  function el(name, attributes, className) {
    var node = document.createElementNS(SVG, name);
    Object.keys(attributes || {}).forEach(function (key) {
      node.setAttribute(key, String(attributes[key]));
    });
    if (className) node.setAttribute("class", className);
    return node;
  }

  function number(value) {
    return Math.round(value * 100) / 100;
  }

  // dx the shorter way round the world
  function wrapDx(dx) {
    var W = LibreSpeedWorld.width;
    return dx > W / 2 ? dx - W : dx < -W / 2 ? dx + W : dx;
  }

  // The direction of the short line of a country: from the firm country before its first network to the one after its last
  // network, or flat when there is none. Where the route comes in (or goes out) by a crossing of a sea, the end of the
  // crossing is the place it comes from (or goes to), so the line follows the coast the route reached, not the middle of the
  // country on the other side
  function directionOf(code, list, nodes, crossings) {
    function near(start, step) {
      for (var i = start; i >= 0 && i < nodes.length; i += step) {
        var node = nodes[i];
        if (node.country && !node.doubt && node.country !== code && position(node.country))
          return position(node.country);
      }
      return null;
    }
    function crossed(side) {
      for (var k = 0; k < (crossings || []).length; k++) {
        var item = crossings[k];
        var inside = list.some(function (node) {
          return node.n === (side === "in" ? item.to : item.from);
        });
        var place = side === "in" ? regionAt(item.end) : regionAt(item.start);
        if (inside && place) return place;
      }
      return null;
    }
    var here = position(code);
    var a = crossed("in") || near(nodes.indexOf(list[0]) - 1, -1) || here;
    var b = crossed("out") || near(nodes.indexOf(list[list.length - 1]) + 1, 1) || here;
    var v = [wrapDx(b[0] - a[0]), b[1] - a[1]];
    var length = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
    return length < 1e-6 ? [1, 0] : [v[0] / length, v[1] / length];
  }

  // Points nearer than min are pushed apart along the line between them, half each, in a fixed order: the same route gives
  // the same picture, and a point moves only a few px
  function separate(points, min) {
    for (var round = 0; round < 50; round++) {
      var moved = false;
      for (var i = 0; i < points.length; i++) {
        for (var j = i + 1; j < points.length; j++) {
          var dx = points[j][0] - points[i][0];
          var dy = points[j][1] - points[i][1];
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d >= min * 0.999) continue;
          var push = (min - d) / 2;
          if (d < 1e-9) {
            dx = Math.cos(j * 2.4);
            dy = Math.sin(j * 2.4);
            d = 1;
          }
          points[i][0] -= (dx / d) * push;
          points[i][1] -= (dy / d) * push;
          points[j][0] += (dx / d) * push;
          points[j][1] += (dy / d) * push;
          moved = true;
        }
      }
      if (!moved) return;
    }
  }

  // Where each network is drawn, { n: [x, y] } in units of the map, for a scale of unit (units per px): the networks of a
  // country on one short line through its middle, in order, SPACING px apart; then the ones that still touch are separated
  function layout(nodes, unit, crossings) {
    var byCountry = {};
    var order = [];
    nodes.forEach(function (node) {
      if (!node.country || !position(node.country)) return;
      if (!byCountry[node.country]) {
        byCountry[node.country] = [];
        order.push(node.country);
      }
      byCountry[node.country].push(node);
    });
    var at = {};
    var points = [];
    order.forEach(function (code) {
      var list = byCountry[code];
      var here = position(code);
      var dir = directionOf(code, list, nodes, crossings);
      list.forEach(function (node, i) {
        var k = (i - (list.length - 1) / 2) * SPACING * unit;
        at[node.n] = [here[0] + dir[0] * k, here[1] + dir[1] * k];
        points.push(at[node.n]);
      });
    });
    separate(points, SPACING * unit);
    return at;
  }

  // The networks the line links, with a country that is on the map
  function linkedOf(md) {
    return md.line
      .map(function (n) {
        return md.nodes[n - 1];
      })
      .filter(function (node) {
        return node.country && position(node.country);
      });
  }

  // The places the line goes through, in order: one for each network, and for a network that goes through more than one country
  // (md.nodes[i].via) one for each of its countries. The one of the network is its number (marker); the others are small dots
  // with no number (waypoints) in the middle of their country. n countries in a row are n - 1 pieces of the line.
  function sequenceOf(md) {
    var result = [];
    linkedOf(md).forEach(function (node) {
      var countries = (node.via || []).filter(function (code) {
        return !!position(code);
      });
      if (countries.length < 2 || countries.indexOf(node.country) < 0) {
        result.push({ n: node.n, country: node.country, marker: true });
        return;
      }
      var placed = false;
      countries.forEach(function (code) {
        var marker = !placed && code === node.country;
        if (marker) placed = true;
        result.push({ n: node.n, country: code, marker: marker });
      });
    });
    return result;
  }

  // Where a place of the sequence is drawn
  function placeOf(point, at) {
    return point.marker ? at[point.n] : position(point.country);
  }

  // Whether the line goes more than half the world wide between two countries, so it goes round the date line. It is worked out
  // from the middles of the countries (not from the points) so that it does not change when the points move
  function wraps(md) {
    var linked = sequenceOf(md);
    var W = LibreSpeedWorld.width;
    for (var i = 1; i < linked.length; i++) {
      var a = linked[i - 1].country;
      var b = linked[i].country;
      if (a !== b && Math.abs(position(b)[0] - position(a)[0]) > W / 2) return true;
    }
    if (md.tail && linked.length && md.you && position(md.you)) {
      var last = linked[linked.length - 1].country;
      if (last !== md.you && Math.abs(position(md.you)[0] - position(last)[0]) > W / 2) return true;
    }
    return false;
  }

  // The part of the world that is shown, around the boxes: with the margin for the aspect of the host, never smaller than MIN_FRAME
  function fit(boxes, aspect) {
    var world = worldFrame(aspect);
    var x0 =
      Math.min.apply(
        null,
        boxes.map(function (b) {
          return b[0];
        })
      ) - PADDING;
    var y0 =
      Math.min.apply(
        null,
        boxes.map(function (b) {
          return b[1];
        })
      ) - PADDING;
    var x1 =
      Math.max.apply(
        null,
        boxes.map(function (b) {
          return b[2];
        })
      ) + PADDING;
    var y1 =
      Math.max.apply(
        null,
        boxes.map(function (b) {
          return b[3];
        })
      ) + PADDING;
    var w = Math.max(x1 - x0, MIN_FRAME);
    var h = Math.max(y1 - y0, MIN_FRAME / aspect);
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    if (w >= LibreSpeedWorld.width || h >= LibreSpeedWorld.height) return world;
    var x = Math.max(0, Math.min((x0 + x1) / 2 - w / 2, LibreSpeedWorld.width - w));
    var y = Math.max(0, Math.min((y0 + y1) / 2 - h / 2, LibreSpeedWorld.height - h));
    return [x, y, w, h];
  }

  function sameFrame(a, b) {
    return a.every(function (value, i) {
      return Math.abs(value - b[i]) < 1e-6;
    });
  }

  // All of the world, or the countries of the route and the points of the networks with a margin, in the shape of the host. The
  // points depend on the scale and the scale on the frame, so it is worked out again until the frame stops changing
  function frameOf(md, wrapped, aspect, width, unplaced) {
    var world = worldFrame(aspect);
    var boxes = [];
    md.countries.forEach(function (country) {
      var box = boxOf(country.code);
      if (box) boxes.push(box);
      else unplaced.push(country.code);
    });
    if (!boxes.length || wrapped) return world;
    var ends = [];
    (md.crossings || []).forEach(function (crossing) {
      [crossing.start, crossing.end].forEach(function (key) {
        var place = regionAt(key);
        if (place) ends.push(place);
      });
    });
    ends.forEach(function (place) {
      boxes.push([place[0] - 2, place[1] - 2, place[0] + 2, place[1] + 2]);
    });
    var frame = fit(boxes, aspect);
    for (var round = 0; round < 4 && !sameFrame(frame, world); round++) {
      var unit = frame[2] / width;
      var at = layout(md.nodes, unit, md.crossings);
      var margin = (RADIUS + 3) * unit;
      var extra = Object.keys(at)
        .map(function (n) {
          return at[n];
        })
        .concat(ends)
        .map(function (place) {
          return [place[0] - margin, place[1] - margin, place[0] + margin, place[1] + margin];
        });
      var next = fit(boxes.concat(extra), aspect);
      if (sameFrame(next, frame)) break;
      frame = next;
    }
    return frame;
  }

  function straight(a, b, className) {
    return el(
      "path",
      { d: "M" + number(a[0]) + " " + number(a[1]) + "L" + number(b[0]) + " " + number(b[1]) },
      className
    );
  }

  // A curved line, always bending to the left of its direction, with an arrow at the middle
  function drawLeg(group, a, b, className, unit) {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var c = [(a[0] + b[0]) / 2 + dy * 0.2, (a[1] + b[1]) / 2 - dx * 0.2];
    group.appendChild(
      el(
        "path",
        {
          d:
            "M" +
            number(a[0]) +
            " " +
            number(a[1]) +
            "Q" +
            number(c[0]) +
            " " +
            number(c[1]) +
            " " +
            number(b[0]) +
            " " +
            number(b[1])
        },
        className
      )
    );
    var mid = [0.25 * a[0] + 0.5 * c[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * c[1] + 0.25 * b[1]];
    var angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    var arrow = el(
      "polygon",
      {
        points:
          number(5 * unit) +
          ",0 " +
          number(-5 * unit) +
          "," +
          number(3.5 * unit) +
          " " +
          number(-5 * unit) +
          "," +
          number(-3.5 * unit),
        transform: "translate(" + number(mid[0]) + " " + number(mid[1]) + ") rotate(" + number(angle) + ")"
      },
      "route-map-arrow" + (className.indexOf("tail") >= 0 ? " route-map-leg-tail" : "")
    );
    group.appendChild(arrow);
  }

  // A curve between two countries, or two when it goes round the date line: one part leaves the map by one side, the other comes
  // in by the other side
  function drawFar(group, a, b, wrap, className, unit) {
    if (!wrap) {
      drawLeg(group, a, b, className, unit);
      return;
    }
    var W = LibreSpeedWorld.width;
    var shift = b[0] > a[0] ? -W : W;
    drawLeg(group, a, [b[0] + shift, b[1]], className, unit);
    drawLeg(group, [a[0] - shift, a[1]], b, className, unit);
  }

  function destroy() {
    removers.forEach(function (remove) {
      remove();
    });
    removers = [];
    if (observer) observer.disconnect();
    if (onResize) window.removeEventListener("resize", onResize);
    observer = null;
    onResize = null;
    if (host) host.textContent = "";
    host = null;
    data = null;
  }

  function draw(target, md) {
    var width = target.clientWidth;
    target.textContent = "";
    if (width < 60) return;
    var aspect = width >= 600 ? 2 : 1.5;
    var unplaced = [];
    var automatic = frameOf(md, wraps(md), aspect, width, unplaced);
    var frame = user ? userFrame(aspect) : automatic;
    var unit = frame[2] / width;
    var hatch = 6 * unit;
    // The sea fills all of the frame (more than the world when the frame is the whole world in the shape of the host)
    var seaTop = Math.min(0, frame[1]);
    var world = [0, seaTop, LibreSpeedWorld.width, Math.max(LibreSpeedWorld.height, frame[1] + frame[3]) - seaTop];
    var at = layout(md.nodes, unit, md.crossings);

    var svg = el("svg", {
      viewBox: frame.map(number).join(" "),
      width: width,
      height: Math.round((width * frame[3]) / frame[2]),
      "aria-hidden": "true",
      focusable: "false"
    });

    var defs = el("defs");
    var pattern = el("pattern", {
      id: "routeMapHatch",
      patternUnits: "userSpaceOnUse",
      width: number(hatch),
      height: number(hatch),
      patternTransform: "rotate(45)"
    });
    pattern.appendChild(el("rect", { width: number(hatch), height: number(hatch) }, "route-map-hatch-bg"));
    pattern.appendChild(el("rect", { width: number(2.4 * unit), height: number(hatch) }, "route-map-hatch"));
    defs.appendChild(pattern);
    var clip = el("clipPath", { id: "routeMapClip" });
    clip.appendChild(el("rect", { x: world[0], y: world[1], width: world[2], height: world[3] }));
    defs.appendChild(clip);
    svg.appendChild(defs);

    svg.appendChild(el("rect", { x: world[0], y: world[1], width: world[2], height: world[3] }, "route-map-sea"));
    var painted = {};
    var kinds = {};
    md.countries.forEach(function (country) {
      kinds[country.code] = country.doubt ? "doubt" : "on";
    });
    LibreSpeedWorld.shapes.forEach(function (shape) {
      var code = shape[0];
      var path = el("path", { d: shape[1] }, "route-map-land");
      if (code && kinds[code]) {
        path.setAttribute("class", "route-map-land route-map-" + kinds[code]);
        path.setAttribute("data-code", code);
        painted[code] = kinds[code];
      }
      svg.appendChild(path);
    });

    var group = el("g", { "clip-path": "url(#routeMapClip)" });

    // The line: between the networks it links, a straight piece inside a country and a curve between countries
    var linked = sequenceOf(md);
    var legs = [];
    var landings = [];
    for (var i = 1; i < linked.length; i++) {
      var p = linked[i - 1];
      var q = linked[i];
      var pAt = placeOf(p, at);
      var qAt = placeOf(q, at);
      if (p.country === q.country) {
        legs.push({ from: p.n, to: q.n, kind: "near", wrap: false });
        group.appendChild(straight(pAt, qAt, "route-map-leg route-map-leg-near"));
      } else {
        var wrap = Math.abs(position(q.country)[0] - position(p.country)[0]) > LibreSpeedWorld.width / 2;
        var crossing = wrap || p.n === q.n ? null : crossingOf(md, p.n, q.n);
        if (crossing) {
          // Land to the coast, over the sea by a curve, from the coast to the next network
          var a = regionAt(crossing.start);
          var b = regionAt(crossing.end);
          legs.push({ from: p.n, to: q.n, kind: "cross", wrap: false, via: [crossing.start, crossing.end] });
          group.appendChild(straight(pAt, a, "route-map-leg route-map-leg-land"));
          drawLeg(group, a, b, "route-map-leg route-map-leg-sea", unit);
          group.appendChild(straight(b, qAt, "route-map-leg route-map-leg-land"));
          [crossing.start, crossing.end].forEach(function (key, side) {
            var place = side ? b : a;
            landings.push({ key: key, x: number(place[0]), y: number(place[1]) });
          });
        } else {
          legs.push({ from: p.n, to: q.n, kind: "path", wrap: wrap });
          drawFar(group, pAt, qAt, wrap, "route-map-leg", unit);
        }
      }
    }

    // The ring is on the visitor: on its network when the line ends in its country, else at the middle of the country
    var last = linked.length ? linked[linked.length - 1] : null;
    var youAt = md.you ? position(md.you) : null;
    var ringAt = null;
    var ring = null;
    if (youAt) {
      if (last && last.country === md.you) {
        ringAt = placeOf(last, at);
        ring = last.n;
      } else {
        ringAt = youAt;
        ring = "center";
      }
    }
    if (md.tail && last && ringAt) {
      var tailWrap = Math.abs(youAt[0] - position(last.country)[0]) > LibreSpeedWorld.width / 2;
      legs.push({ from: last.n, to: "you", kind: "tail", wrap: tailWrap });
      drawFar(group, placeOf(last, at), ringAt, tailWrap, "route-map-leg route-map-leg-tail", unit);
    }

    // The countries with no shape are a spot
    md.countries.forEach(function (country) {
      var place = position(country.code);
      if (place && !LibreSpeedWorld.centers[country.code]) {
        group.appendChild(
          el(
            "circle",
            { cx: place[0], cy: place[1], r: number(6 * unit) },
            "route-map-spot" + (country.doubt ? " route-map-spot-doubt" : "")
          )
        );
      }
    });
    if (ringAt)
      group.appendChild(
        el("circle", { cx: ringAt[0], cy: ringAt[1], r: number((RADIUS + 3.5) * unit) }, "route-map-you")
      );

    // The ends of a crossing: a small diamond with no number
    var side = 5 * unit;
    landings.forEach(function (landing) {
      group.appendChild(
        el(
          "rect",
          {
            x: number(-side / 2),
            y: number(-side / 2),
            width: number(side),
            height: number(side),
            transform: "translate(" + landing.x + " " + landing.y + ") rotate(45)"
          },
          "route-map-landing"
        )
      );
    });

    // The countries a network goes through besides the one of its number: a small dot with no number
    var waypoints = [];
    linked.forEach(function (point) {
      if (point.marker) return;
      var place = position(point.country);
      group.appendChild(
        el("circle", { cx: number(place[0]), cy: number(place[1]), r: number(3.5 * unit) }, "route-map-via")
      );
      waypoints.push({ n: point.n, code: point.country });
    });

    // The numbers, in order: the last one is on top
    var shown = [];
    md.nodes.forEach(function (node) {
      if (!at[node.n]) return;
      var kind = node.doubt ? "doubt" : node.borrowed ? "borrowed" : "firm";
      var marker = el(
        "g",
        { transform: "translate(" + number(at[node.n][0]) + " " + number(at[node.n][1]) + ")" },
        "route-map-node" + (kind === "firm" ? "" : " route-map-node-" + kind)
      );
      marker.appendChild(el("circle", { r: number(RADIUS * unit) }));
      var label = el("text", { "text-anchor": "middle", dy: "0.35em", "font-size": number(FONT * unit) });
      label.appendChild(document.createTextNode(String(node.n)));
      marker.appendChild(label);
      group.appendChild(marker);
      shown.push({ n: node.n, code: node.country, kind: kind, x: number(at[node.n][0]), y: number(at[node.n][1]) });
    });
    svg.appendChild(group);
    target.appendChild(svg);
    target.classList.toggle("route-map-pannable", frame[2] < LibreSpeedWorld.width);
    target.classList.toggle("route-map-chosen", user !== null);

    state = {
      builds: state.builds + 1,
      width: width,
      frame: frame.map(number),
      auto: automatic.map(number),
      user: user !== null,
      aspect: aspect,
      painted: painted,
      legs: legs,
      nodes: shown,
      ring: ring,
      unplaced: unplaced,
      landings: landings,
      waypoints: waypoints
    };
    updateControls();
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  // The frame the person chose, in the shape of the host: all of the world when it does not fit in it
  function userFrame(aspect) {
    var world = [0, 0, LibreSpeedWorld.width, LibreSpeedWorld.height];
    var w = Math.min(user.w, world[2]);
    var h = w / aspect;
    if (w >= world[2] || h >= world[3]) return worldFrame(aspect);
    return [clamp(user.cx - w / 2, 0, world[2] - w), clamp(user.cy - h / 2, 0, world[3] - h), w, h];
  }

  // The widest frame that is not all of the world, for the shape of the host
  function reach() {
    return Math.min(LibreSpeedWorld.width, LibreSpeedWorld.height * state.aspect);
  }

  function isWorld() {
    return state.frame[2] >= LibreSpeedWorld.width - 1e-6 || state.frame[3] >= LibreSpeedWorld.height - 1e-6;
  }

  // Zooms by factor (more than 1 comes closer) around a point of the map, or the middle of the frame
  function zoomTo(factor, ax, ay) {
    if (!host || !data || !state.width) return;
    var f = state.frame;
    var limit = reach();
    var current = isWorld() ? limit : f[2];
    var w = clamp(current / factor, MIN_FRAME, limit);
    if (factor < 1 && w >= limit - 0.01) {
      showWorld();
      return;
    }
    if (Math.abs(w - current) < 1e-6) return;
    var x = ax === undefined ? f[0] + f[2] / 2 : ax;
    var y = ay === undefined ? f[1] + f[3] / 2 : ay;
    var rx = (x - f[0]) / f[2];
    var ry = (y - f[1]) / f[3];
    var h = w / state.aspect;
    user = { cx: x - rx * w + w / 2, cy: y - ry * h + h / 2, w: w };
    draw(host, data);
  }

  function showWorld() {
    if (!host || !data) return;
    user = { cx: LibreSpeedWorld.width / 2, cy: LibreSpeedWorld.height / 2, w: LibreSpeedWorld.width };
    draw(host, data);
  }

  function resetView() {
    user = null;
    if (host && data) draw(host, data);
  }

  // Moves the frame by a drag of dx, dy px, keeping it inside the world: only the viewBox changes, so it is quick
  function pan(dx, dy) {
    var f = state.frame;
    var unit = f[2] / state.width;
    user = { cx: f[0] + f[2] / 2 - dx * unit, cy: f[1] + f[3] / 2 - dy * unit, w: f[2] };
    var next = userFrame(state.aspect);
    var svg = host.querySelector("svg");
    if (svg) svg.setAttribute("viewBox", next.map(number).join(" "));
    state.frame = next.map(number);
    state.user = true;
    host.classList.add("route-map-chosen");
    updateControls();
  }

  // The point of the map under a point of the screen
  function toUnits(clientX, clientY) {
    var svg = host.querySelector("svg");
    var box = svg.getBoundingClientRect();
    var f = state.frame;
    return [f[0] + ((clientX - box.left) / box.width) * f[2], f[1] + ((clientY - box.top) / box.height) * f[3]];
  }

  function updateControls() {
    if (!controls) return;
    var world = isWorld();
    Array.prototype.forEach.call(controls.querySelectorAll("[data-zoom]"), function (button) {
      var action = button.getAttribute("data-zoom");
      button.disabled =
        action === "in" ? !world && state.frame[2] <= MIN_FRAME + 1e-6 : action === "fit" ? user === null : world;
    });
  }

  function listen(target, name, handler, options) {
    target.addEventListener(name, handler, options);
    removers.push(function () {
      target.removeEventListener(name, handler, options);
    });
  }

  // The buttons, Ctrl + scroll, and the pointers (the drag, and the two fingers)
  function bind() {
    if (controls) {
      Array.prototype.forEach.call(controls.querySelectorAll("[data-zoom]"), function (button) {
        listen(button, "click", function () {
          var action = button.getAttribute("data-zoom");
          if (action === "in") zoomTo(STEP);
          else if (action === "out") zoomTo(1 / STEP);
          else if (action === "world") showWorld();
          else resetView();
        });
      });
    }
    // A plain scroll is the page's: the zoom needs Ctrl (or Cmd)
    listen(
      host,
      "wheel",
      function (event) {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        var at = toUnits(event.clientX, event.clientY);
        zoomTo(event.deltaY < 0 ? WHEEL : 1 / WHEEL, at[0], at[1]);
      },
      { passive: false }
    );
    var pointers = {};
    var pinch = null;
    listen(host, "pointerdown", function (event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
      if (Object.keys(pointers).length === 2) {
        var two = Object.keys(pointers).map(function (id) {
          return pointers[id];
        });
        pinch = Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y);
      }
    });
    listen(host, "pointermove", function (event) {
      var last = pointers[event.pointerId];
      if (!last) return;
      pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 1) {
        // A finger moves the map only after the person zoomed: before, it is the scroll of the page
        if (isWorld() || (event.pointerType === "touch" && user === null)) return;
        try {
          if (!host.hasPointerCapture(event.pointerId)) host.setPointerCapture(event.pointerId);
        } catch (error) {
          // A pointer that is gone: the drag goes on without the capture
        }
        pan(event.clientX - last.x, event.clientY - last.y);
      }
      if (ids.length === 2 && pinch) {
        var two = ids.map(function (id) {
          return pointers[id];
        });
        var distance = Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y);
        if (distance > 0) {
          var at = toUnits((two[0].x + two[1].x) / 2, (two[0].y + two[1].y) / 2);
          zoomTo(distance / pinch, at[0], at[1]);
          pinch = distance;
        }
      }
    });
    function release(event) {
      delete pointers[event.pointerId];
      pinch = null;
    }
    listen(host, "pointerup", release);
    listen(host, "pointercancel", release);
  }

  function render(target, md, panel) {
    destroy();
    host = target;
    data = md;
    controls = panel || null;
    draw(host, data);
    bind();
    function fitHost() {
      if (host && Math.abs(host.clientWidth - state.width) >= 1 && host.clientWidth >= 60) draw(host, data);
    }
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(fitHost);
      observer.observe(host);
    } else {
      onResize = fitHost;
      window.addEventListener("resize", onResize);
    }
  }

  function info() {
    return state;
  }

  return { render: render, destroy: destroy, resetView: resetView, has: has, info: info };
})();
