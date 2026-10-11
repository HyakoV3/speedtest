/**
 * Builds ../vendor/world-110m.js: the shapes of the countries, for the map of the route page.
 *
 *   node frontend/better/map/build-world.js <ne_110m_admin_0_countries.geojson> <ne_50m_admin_0_countries.geojson>
 *
 * It downloads nothing: see README.md for where the two files come from and their sha256, which are checked here. The files are
 * only data for this script; the page reads the file it writes, from the same server as the page. The projection is
 * equirectangular (x = longitude + 180, y = 84 - latitude), cut to 84 N - 58 S without Antarctica, so the world is 360 x 142.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const TAG = "v5.1.2";
const HASHES = {
  "ne_110m_admin_0_countries.geojson": "6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f",
  "ne_50m_admin_0_countries.geojson": "3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb"
};
const LAT_TOP = 84;
const LAT_BOTTOM = -58;
const WIDTH = 360;
const HEIGHT = LAT_TOP - LAT_BOTTOM;
const OUTPUT = path.join(__dirname, "..", "vendor", "world-110m.js");

// Territories that Natural Earth draws inside another country (or not at all): the approximate middle of each, not a city
const EXTRA = {
  GF: [-53.1, 3.9],
  GP: [-61.55, 16.25],
  MQ: [-61.0, 14.65],
  RE: [55.53, -21.12],
  YT: [45.15, -12.82],
  GI: [-5.35, 36.14],
  BQ: [-68.27, 12.18],
  SJ: [16.0, 78.6],
  CX: [105.69, -10.49],
  CC: [96.87, -12.16],
  TK: [-171.85, -9.2]
};

function fail(message) {
  console.error("build-world: " + message);
  process.exit(1);
}

function readChecked(file) {
  const text = fs.readFileSync(file);
  const name = path.basename(file);
  if (!HASHES[name]) fail(name + " is not one of the files this script knows (" + Object.keys(HASHES).join(", ") + ")");
  const hash = crypto.createHash("sha256").update(text).digest("hex");
  if (hash !== HASHES[name])
    fail(name + " has the sha256 " + hash + ", expected " + HASHES[name] + " (Natural Earth " + TAG + ")");
  return JSON.parse(text.toString("utf8"));
}

// ISO_A2_EH has the right code for France, Norway and Taiwan; ISO_A2 gives -99 or "CN-TW"
function codeOf(feature) {
  const code = feature.properties.ISO_A2_EH;
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

function polygonsOf(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

const round = value => Math.round(value * 10) / 10;

function project(lon, lat) {
  return [lon + 180, LAT_TOP - Math.max(LAT_BOTTOM, Math.min(LAT_TOP, lat))];
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return area / 2;
}

function inside(point, ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) result = !result;
  }
  return result;
}

function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t = dx || dy ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy) : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

// A point well inside the polygon (outer ring and holes): the point of a 25 x 25 grid that is farthest from every edge, then
// three rounds, each one on a grid 1/6 the size of the one before, around the best point so far
function visualCenter(rings) {
  const outer = rings[0];
  const xs = outer.map(point => point[0]);
  const ys = outer.map(point => point[1]);
  const score = p => {
    if (!inside(p, outer)) return -1;
    for (let h = 1; h < rings.length; h++) if (inside(p, rings[h])) return -1;
    let distance = Infinity;
    rings.forEach(ring => {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
        distance = Math.min(distance, distanceToSegment(p, ring[j], ring[i]));
    });
    return distance;
  };
  let width = Math.max(...xs) - Math.min(...xs);
  let height = Math.max(...ys) - Math.min(...ys);
  let cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  let cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  let best = [cx, cy];
  let bestScore = -Infinity;
  for (let round_ = 0; round_ < 3; round_++) {
    const n = 24;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const p = [cx - width / 2 + (width * i) / n, cy - height / 2 + (height * j) / n];
        const s = score(p);
        if (s > bestScore) {
          bestScore = s;
          best = p;
        }
      }
    }
    cx = best[0];
    cy = best[1];
    width /= 6;
    height /= 6;
  }
  return best;
}

// The shapes (relative paths between points already rounded to 0.1) and, for each code, the center of its largest polygon
function build(features) {
  const shapes = [];
  const centers = {};
  const areas = {};
  features.forEach(feature => {
    const code = codeOf(feature);
    if (code === "AQ") return;
    let d = "";
    let largest = null;
    let largestArea = 0;
    polygonsOf(feature.geometry)
      .filter(polygon => polygon[0].some(point => point[1] > LAT_BOTTOM))
      .forEach(polygon => {
        const projected = polygon.map(ring => ring.map(point => project(point[0], point[1])));
        const area = Math.abs(ringArea(projected[0]));
        if (area > largestArea) {
          largestArea = area;
          largest = projected;
        }
        projected.forEach(ring => {
          let last = null;
          let part = "";
          let points = 0;
          ring.forEach(point => {
            const q = [round(point[0]), round(point[1])];
            if (last && q[0] === last[0] && q[1] === last[1]) return;
            part += last ? "l" + round(q[0] - last[0]) + " " + round(q[1] - last[1]) : "M" + q[0] + " " + q[1];
            last = q;
            points++;
          });
          if (points >= 3) d += part + "z";
        });
      });
    if (code && largest && (!areas[code] || areas[code] < largestArea)) {
      const c = visualCenter(largest);
      const xs = largest[0].map(q => q[0]);
      const ys = largest[0].map(q => q[1]);
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round);
      centers[code] = [round(c[0]), round(c[1])].concat(box);
      areas[code] = largestArea;
    }
    // A minus separates numbers, so "l-1.5 -2" is written "l-1.5-2"
    if (d) shapes.push([code, d.replace(/ -/g, "-")]);
  });
  return { shapes, centers };
}

const [, , file110, file50] = process.argv;
if (!file110 || !file50)
  fail("usage: node build-world.js <ne_110m_admin_0_countries.geojson> <ne_50m_admin_0_countries.geojson>");
const ne110 = readChecked(file110);
const ne50 = readChecked(file50);

const big = build(ne110.features);
const known = new Set(ne110.features.map(codeOf).filter(Boolean));
const small = build(ne50.features.filter(feature => codeOf(feature) && !known.has(codeOf(feature))));
const points = {};
Object.keys(small.centers).forEach(code => {
  points[code] = [small.centers[code][0], small.centers[code][1]];
});
Object.keys(EXTRA).forEach(code => {
  const p = project(EXTRA[code][0], EXTRA[code][1]);
  points[code] = [round(p[0]), round(p[1])];
});

const world = { v: 1, width: WIDTH, height: HEIGHT, shapes: big.shapes, centers: big.centers, points };

// Checks before writing: only what the page can draw
const numbers = JSON.stringify(world).match(/-?\d+(\.\d+)?/g) || [];
if (!numbers.every(n => Number.isFinite(Number(n)))) fail("a number is not finite");
world.shapes.forEach(([code, d]) => {
  if (code !== "" && !/^[A-Z]{2}$/.test(code)) fail("a bad code: " + code);
  if (!/^M[-0-9.Mlz ]+$/.test(d)) fail("a bad path for " + code);
});
Object.keys(world.centers)
  .concat(Object.keys(world.points))
  .forEach(code => {
    if (!/^[A-Z]{2}$/.test(code)) fail("a bad code: " + code);
  });

const header =
  "/* Generated by frontend/better/map/build-world.js from Natural Earth 5.1.2 (public domain, see world-110m.LICENSE). Do not edit. */\n";
fs.writeFileSync(OUTPUT, header + "var LibreSpeedWorld = " + JSON.stringify(world) + ";\n");
console.log(
  "wrote " +
    path.relative(process.cwd(), OUTPUT) +
    ": " +
    world.shapes.length +
    " shapes, " +
    Object.keys(world.centers).length +
    " centers, " +
    Object.keys(points).length +
    " points"
);
