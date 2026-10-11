# Map of the route page

`route-better.html` can show the countries a route goes through on a map. The shapes of the countries are in
`../vendor/world-110m.js`: a generated file (about 90 KB, about 25 KB with gzip) that the page asks for only when the map is
chosen. It is a `.js` file and not a `.json` one because the Apache of the Docker image compresses JavaScript but not JSON.

The file is made from the countries of [Natural Earth](https://www.naturalearthdata.com/) 5.1.2 (public domain, see
`../vendor/world-110m.LICENSE`). The page asks nothing of other sites: the data is here.

## Regenerate it

Download the two files in a new, empty folder outside the repository, and check them. The script checks the `sha256` too and
stops when they are not these:

```
https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson
  sha256 6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f
https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson
  sha256 3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb
```

```
node frontend/better/map/build-world.js <ne_110m_admin_0_countries.geojson> <ne_50m_admin_0_countries.geojson>
```

The downloaded files are only data for the script: nothing of them runs in the page. Running it twice gives the same file.

## What is in the file

`LibreSpeedWorld = { v, width: 360, height: 142, shapes, centers, points }` in an equirectangular projection (x = longitude + 180,
y = 84 - latitude, Antarctica is not drawn):

- `shapes`: `[code, path]` for each country of the 110m file. `code` is the ISO 3166-1 alpha-2 code (the `ISO_A2_EH` field, which
  has FR, NO and TW right) or `""` when there is none.
- `centers[code] = [x, y, x0, y0, x1, y1]`: a point well inside the largest polygon of the country, and its box.
- `points[code] = [x, y]`: for the small countries that the 110m file does not draw (the 50m file has them) and for a few
  territories (`EXTRA` in the script) that Natural Earth draws inside another country. The page draws a spot for them.

The map is of countries: the address of a router is placed in a country by a database, often where the operator has its head
office, so there is no pin in a city.

## Sea crossings (`frontend/better/javascript/route-crossings.js`)

Where a route crosses a sea by submarine cable, the map draws two small marks with no number: the regions where the cables of
that sea land. The table is by pair of countries (a corridor), not by network: the networks that carry the traffic are global and
own more than one cable. A crossing is drawn only when the time rose at least what light in fiber needs to cross that sea.
A line is added only with a source, and a region is in whole degrees, never a town. Verified on 2026-10-10 with the public API of
the Submarine Cable Map (TeleGeography), `https://www.submarinecablemap.com/api/v3/cable/<id>.json`.

| Pair | Regions | Cables (landings) | Source |
|---|---|---|---|
| BR-US | br-northeast / us-east | Seabras-1 (Wall Township NJ; Praia Grande) | https://www.submarinecablemap.com/api/v3/cable/seabras-1.json |
| BR-US | br-northeast / us-east | GlobeNet (Tuckerton NJ, Boca Raton FL; Fortaleza, Rio) | https://www.submarinecablemap.com/api/v3/cable/globenet.json |
| BR-US | br-northeast / us-east | Monet (Boca Raton FL; Fortaleza, Santos) | https://www.submarinecablemap.com/api/v3/cable/monet.json |
| BR-US | br-northeast / us-east | BRUSA (Virginia Beach VA; Fortaleza, Rio) | https://www.submarinecablemap.com/api/v3/cable/brusa.json |
| BR-US | br-northeast / us-east | SAm-1 (Boca Raton FL; Fortaleza, Salvador, Rio, Santos) | https://www.submarinecablemap.com/api/v3/cable/south-america-1-sam-1.json |
| BR-US | br-northeast / us-east | Firmina (Myrtle Beach SC; Praia Grande) | https://www.submarinecablemap.com/api/v3/cable/firmina.json |
| BR-PT | br-northeast / pt-southwest | EllaLink (Fortaleza; Sines) | https://www.submarinecablemap.com/api/v3/cable/ellalink.json |
| AO-BR | ao-north / br-northeast | SACS (Sangano; Fortaleza) | https://www.submarinecablemap.com/api/v3/cable/south-atlantic-cable-system-sacs.json |
| ES-US | es-north / us-east | MAREA (Bilbao; Virginia Beach VA) | https://www.submarinecablemap.com/api/v3/cable/marea.json |
| ES-US | es-north / us-east | Grace Hopper (Bilbao; Bellport NY) | https://www.submarinecablemap.com/api/v3/cable/grace-hopper.json |
| FR-US | fr-west / us-east | Dunant (Saint-Hilaire-de-Riez; Virginia Beach VA) | https://www.submarinecablemap.com/api/v3/cable/dunant.json |
| GB-US | gb-southwest / us-east | Grace Hopper (Bude; Bellport NY) | https://www.submarinecablemap.com/api/v3/cable/grace-hopper.json |

The BR end is the northeast coast because 4 of the 6 US-BR systems land at Fortaleza. Left out: pairs with a land route (AR-BR),
and US to NL or DE (the traffic often crosses into GB or FR and goes on by land). Seabras-1 at Fortaleza is not confirmed by the
Submarine Cable Map (only Praia Grande), so it is not counted. The state of the ARBR cable (same operator as AS13786) was not verified.
