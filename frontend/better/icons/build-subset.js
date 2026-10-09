/**
 * Builds subset.json: the few icons of the better pages, in each icon set the theme panel offers.
 *
 *   node frontend/better/icons/build-subset.js
 *
 * The pages never ask Iconify for an icon: this script asks it once (it needs the network and Node 18 or newer),
 * and the pages read the file it writes, from the same server as the pages. To add an icon, add its name to ICONS and
 * its name in every set (the names differ between sets), then run the script. To add a set, add it to SETS.
 */
const fs = require("node:fs");
const path = require("node:path");

const API = "https://api.iconify.design";

// The icons the pages use, by the name the pages give them
const ICONS = [
  "sun",
  "moon",
  "share",
  "chevron-left",
  "chevron-right",
  "chevron-down",
  "pause",
  "play",
  "check",
  "close",
  "link",
  "image",
  "download"
];

// The sets, in the order the theme panel lists them. names: our name -> the name of the icon in that set. prefix is the
// set in Iconify when the id is a variant of it, label the name shown for it. weights: for a set that draws its icons in
// more than one weight, the ending of the name of each weight besides the regular one (the pages ask for light, regular
// or bold: a set without the weight is drawn in regular).
const SETS = [
  {
    id: "material-symbols",
    names: { sun: "light-mode", moon: "dark-mode", "chevron-down": "expand-more", play: "play-arrow" }
  },
  { id: "mdi", names: { sun: "weather-sunny", moon: "weather-night", share: "share-variant" } },
  { id: "tabler", names: { pause: "player-pause", play: "player-play", close: "x", image: "photo" } },
  { id: "lucide", names: { share: "share-2", close: "x" } },
  {
    id: "ph",
    // The weights of the set that has them: the light and the bold drawing of every icon, by the end of its name
    weights: { light: "-light", bold: "-bold" },
    names: {
      sun: "sun",
      moon: "moon",
      share: "share-network",
      "chevron-left": "caret-left",
      "chevron-right": "caret-right",
      "chevron-down": "caret-down",
      pause: "pause",
      play: "play",
      check: "check",
      close: "x"
    }
  }
];

const DEFAULT_SET = "material-symbols";

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const prefixes = [...new Set(SETS.map(set => set.prefix || set.id))];
  const info = await getJson(`${API}/collections?prefixes=${prefixes.join(",")}`);
  const sets = [];
  for (const set of SETS) {
    const prefix = set.prefix || set.id;
    const wanted = ICONS.map(icon => set.names[icon] || icon);
    const data = await getJson(`${API}/${prefix}.json?icons=${wanted.join(",")}`);
    if (data.not_found && data.not_found.length) throw new Error(`${set.id}: not found ${data.not_found.join(", ")}`);
    const icons = {};
    // The grid of the set (24 for most, 256 for Phosphor): every icon of a set must have the same one
    let box = null;
    ICONS.forEach((icon, index) => {
      const entry = data.icons[wanted[index]];
      if (!entry) throw new Error(`${set.id}: ${wanted[index]} is missing`);
      const width = entry.width || data.width || 24;
      const height = entry.height || data.height || 24;
      const here = `0 0 ${width} ${height}`;
      if (box !== null && box !== here) throw new Error(`${set.id}: ${wanted[index]} is ${here}, the others ${box}`);
      box = here;
      icons[icon] = entry.body;
    });
    // The other weights: each must have every icon, on the same grid as the regular ones
    const weights = {};
    for (const [weight, ending] of Object.entries(set.weights || {})) {
      const names = wanted.map(name => name + ending);
      const other = await getJson(`${API}/${prefix}.json?icons=${names.join(",")}`);
      if (other.not_found && other.not_found.length) {
        throw new Error(`${set.id} ${weight}: not found ${other.not_found.join(", ")}`);
      }
      weights[weight] = {};
      ICONS.forEach((icon, index) => {
        const entry = other.icons[names[index]];
        const here = `0 0 ${entry.width || other.width || 24} ${entry.height || other.height || 24}`;
        if (here !== box) throw new Error(`${set.id} ${weight}: ${names[index]} is ${here}, the regular ones ${box}`);
        weights[weight][icon] = entry.body;
      });
    }
    const about = info[prefix];
    sets.push({
      id: set.id,
      name: set.label || about.name,
      viewBox: box,
      author: about.author.name,
      url: about.author.url,
      license: about.license.spdx,
      licenseUrl: about.license.url,
      icons,
      ...(Object.keys(weights).length ? { weights } : {})
    });
  }
  const file = path.join(__dirname, "subset.json");
  fs.writeFileSync(file, JSON.stringify({ default: DEFAULT_SET, sets }, null, 2) + "\n");
  console.log(`${file}: ${sets.length} sets, ${ICONS.length} icons each`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
