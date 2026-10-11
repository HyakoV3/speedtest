# Better pages

`index-better.html` and `stability-better.html` are alternative versions of the classic speed test and of the stability
test, with the same features and a different look. `route-better.html` is a third page that only exists in the better
pages (see Route page below). The other pages are not changed. The assets are in this folder:

- `styling/`: the color tokens (`tokens.css`), the layout (`better.css`), high contrast, the theme panel and the font sets
- `javascript/`: the page scripts (`index.js`, `stability.js`) and the modules they use
- `locales/`: the translations
- `fonts/` and `vendor/`: the fonts (SIL Open Font License) and uPlot (MIT), served from here so nothing leaves the server

## Options

The round button in the top right corner opens a panel with every option. Each one is kept in the browser
(`localStorage`), and the ones with a URL parameter can also be set with it. The URL wins over the saved choice.

| Option                         | URL parameter                  |
| ------------------------------ | ------------------------------ |
| Mode: auto, light or dark      | `?theme=auto\|light\|dark`     |
| Brand color (12 colors)        | `?brand=blue` (see `theme.js`) |
| Rounding of buttons and boxes  | panel only                     |
| Footer style: text, chips, bar | `?footer=text\|chips\|bar`     |
| Font: system, Inter, Sora, Manrope | `?font=sora`               |
| Icon set (see `icons/README.md`) | `?icons=lucide`              |
| Weight of the icons: light, regular, bold | `?weight=bold`      |
| Chart style (stability page)   | `?chart=polished\|bands\|uplot` |
| Language                       | `?lang=en\|pt\|es\|sv`         |
| Text size and high contrast    | panel only                     |

## Site defaults

`better-defaults.js` (empty in the repository) sets what a visitor sees the first time: the font, and whether the photo
background is on and how often it changes. A choice made in the theme panel, or a URL parameter, wins over it. In Docker,
mount a file over `/speedtest/better-defaults.js`. The comments in the file list the values.

## Server names

An entry of `server-list.json` can carry `names`, the name of the server in each language of the pages, next to `name`
(the fallback, and what the other pages show). The pages use the one of the language they are shown in, and change it
with the language:

```json
{ "name": "Local Server (Vör, Brazil)", "names": { "pt": "Servidor local (Vör, Brasil)", "sv": "Lokal server (Vör, Brasilien)" }, "server": "/backend" }
```

## Route page

`route-better.html` shows the path from the server to the visitor: each router, the time to it, its network (AS) and approximate
country, and the MTU of the path. It is off by default and only works on a server of this fork that has the back end for it
(`backend/route.php`).

- The target is only the address the server sees for the visitor. Nothing else is accepted from the request.
- The server runs `traceroute` (the "Modern traceroute" of Debian, and the `traceroute` package of Alpine; the one of busybox
  has no `--mtu`). It only sends UDP test packets and needs no extra privilege.
- In Docker, set `ENABLE_ROUTE=true` (and `ROUTE_TRUSTED_PROXIES` behind a reverse proxy: see `doc_docker.md`). The link "Route" then
  shows in the footer of the other two pages. Without Docker, edit `backend/route_settings.php` (`$route_enabled = true;`),
  install the `traceroute` package and show the link by removing `hidden` from `<a id="routeLink">`.
- IPv6 visitors are traced only with `ROUTE_IPV6=true` (`$route_ipv6 = true;` without Docker), and only where the server has IPv6; otherwise the page tells that only IPv4 routes are traced.
- The network and country come from `backend/country_asn.mmdb` and are approximate; the page says so. The MTU is told as unknown
  where the server cannot measure it (for example a container whose own interface has an MTU above 1500).
- The page has three views: Table (the default), Chart (the time to each router, drawn with the uPlot of `vendor/`) and Map (the countries the route goes through, with the shapes of Natural Earth, public domain, made by `map/build-world.js` into `vendor/world-110m.js`: see `map/README.md`). The map has one numbered point for each network of the list "Networks on the way", in the country the database gives for its routers, and a line between the points; a network that goes through more than one country (a backbone) has its number in the last of them (where it hands the route on) and a small dot, with no number, in each of the others, and the line goes through all of them in the order of the route (n countries are n - 1 pieces of the line); inside a country the place of a point only keeps the points apart. It is a map of countries, not of cities, and says the country is where the database places the address of a router. The map can be zoomed and moved: the buttons (closer, farther, the whole world, back to the route), Ctrl + scroll, two fingers, and dragging (a finger moves the map only after a zoom, so it does not trap the scroll of the page); the zoom goes back to the route when there is a new route. The files of the chart and of the map are only downloaded when each one is chosen, and the choice is kept in the browser (`?routeview=table|chart|map` wins over it).
- The latest routes are kept in the browser (Route history: up to 100, the latest 20 with their hops and addresses, which can be shown again in the three views); nothing of it goes to the server. By period it is told apart by IP version and by the network of the visitor; the CSV has no address. A change in the networks of the path, compared with the last route from the same IP version and the same network of the visitor, is marked as a new path.
- The route is the one from the server to the visitor, which is the one the download takes; the one of the upload can be different.
- "You → server" is the way back, the one the upload takes. A web page cannot trace it (a browser has no TTL and no ICMP), so the page gives the command for Windows, macOS and Linux (`tracert`, `traceroute`, `tracepath`), the visitor runs it on their own device and pastes the output. It is read in the browser (`route-parse.js`; also `mtr` reports, and the text of a future app): the words of the tool are never read, only numbers, times and addresses, so any language of the system works. Only the public addresses of the routers are sent to this server (`backend/route_enrich.php`, a read of the same offline database, rate limited, nothing stored) to get their network and country; the internal ones never leave the browser. The route is drawn like the other one (table, chart, map), with "server" where the visitor was, and a panel compares the networks of the two directions. The page did not measure it, and says so. `tests/route_parity.php` writes the answers of the PHP that the parser of the page is held to (`tests/e2e/fixtures/route-parity.json`); run it again when `backend/route_util.php` changes. The samples of `tests/fixtures/route-back/` say which ones are real. The way back is never saved by itself: the button "Save to history" (it waits for the networks to arrive) puts it in the same history, marked "way back" (`d: "b"` in the entry and in the row of the summary, and a `direction` column in the CSV). The summary keeps it in its own group (IPv4, IPv6, and each of them "· way back"), and a path is only compared with the last one of the same direction; a saved way back is shown again in "You → server".

## Languages

The catalogs are flat JSON files with dotted keys, in the format of the shared localization (`data-i18n`,
`data-i18n-attr`, `LibreSpeedI18n.t`). The text of the pages in English is the fallback, so a key that is missing in a
catalog shows in English. To add a language, copy `locales/en.json`, translate it and add the language to the list at the
top of `javascript/i18n.js`.
