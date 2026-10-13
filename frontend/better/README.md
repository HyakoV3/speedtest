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
- "You → server" is the way back, the one the upload takes. The page is about the way from the server (Start, the table, the chart, the map); everything of the way back (the command, the box for the output, the button of the browser extension) is in a **panel at the side** (`route-side.js`): a card at the right of the page that does not push it (not a dialog: nothing is inert, Tab leaves it, Esc or its cross close it and the focus goes back to what opened it), opened by a button on the edge of the screen, and a sheet at the bottom on a narrow screen (which is never opened by itself and goes down when a route is drawn). Whether it was left open is kept in the browser and restored on a wide screen only. The results show one route at a time: when there are two, a small selector over them ("Server → you" / "You → server") chooses which; a route pasted or handed over is shown at once, and one that arrives while the route from the server is being traced is kept and not drawn until the trace ends. The box for the output is also where things are dropped and pasted: Ctrl+V anywhere on the card puts the text in it (a paste into another field of the page, or with the card closed, is left alone), a text or a `.txt` file dropped on it (or chosen with the clip in its corner) goes into it, with a card for the name, the kind and the size of the file, and an image or any other thing that is not text is refused with a message. None of these shows or sends anything: only the button "Show route" does. A web page cannot trace it (a browser has no TTL and no ICMP), so the page gives the command for Windows, macOS and Linux (`tracert`, `traceroute`, `tracepath`), the visitor runs it on their own device and pastes the output. It is read in the browser (`route-parse.js`; also `mtr` reports, and the text of a future app): the words of the tool are never read, only numbers, times and addresses, so any language of the system works. Only the public addresses of the routers are sent to this server (`backend/route_enrich.php`, a read of the same offline database; limited to one request every 5 seconds and 120 an hour for each visitor, and 3600 an hour in all; the addresses and the answer are not stored, only a keyed hash of the visitor with the times of the requests, for up to an hour, to apply those limits) to get their network and country; the internal ones never leave the browser. The route is drawn like the other one (table, chart, map), with "server" where the visitor was, and a panel compares the networks of the two directions. The page did not measure it, and says so. `tests/route_parity.php` writes the answers of the PHP that the parser of the page is held to (`tests/e2e/fixtures/route-parity.json`); run it again when `backend/route_util.php` changes. The samples of `tests/fixtures/route-back/` say which ones are real. The way back is never saved by itself: the button "Save to history" (it waits for the networks to arrive) puts it in the same history, marked "way back" (`d: "b"` in the entry and in the row of the summary, and a `direction` column in the CSV). The summary keeps it in its own group (IPv4, IPv6, and each of them "· way back"), and a path is only compared with the last one of the same direction; a saved way back is shown again in "You → server". The way back can also be brought by `librespeed-route` (its own repository, `HyakoV3/librespeed-route`: a small Go program that runs the `tracert`/`traceroute`/`tracepath` of the visitor's system and writes the route as one line of `LSR1` text, without the internal addresses): when the server gives an address to get it from (`ROUTE_CLI_URL`, in `route.php?caps` as `cli_url`, only a plain `https` address, checked again by the page), the steps of the "Browser extension" method (shown only until the extension answers; after that there is only its button) have a link to get the program and the extension; with the address empty there are the steps and no link. The command that the card shows is always the one of the system (the choice between it and `librespeed-route`, and the old key that kept it, are gone). The way back can also come from the **browser extension** of `librespeed-route` (`extension/` in that repository: Chrome, Edge, Firefox): the person clicks its icon on this page and presses Trace, the extension asks the program to trace to the server of the page, and hands the line of `LSR1` to the page with `window.postMessage({ source: "librespeed-route-extension", v: 1, lsr1 }, origin)`. The page takes it only when the message is of this window (not of a frame) and this origin, has exactly those three keys, `v` is 1 and the line has up to 1900 characters, and the route is on; it shows it as the way back (while the route from the server is traced it is kept, not drawn), reads it as a pasted text (so the networks are asked for in the same way: the privacy text names it), says "Route received from the browser extension", and **never saves it to the history by itself**. A page can ask for a trace only if the person allowed that site in the extension (the popup, the permission of the browser for that one host name): the button "Trace the way back" in the panel posts `hello`, `trace` and `cancel` to its own window, the extension answers with the states `ready`, `off`, `tracing`, `done` and `error` and the route in the form above (see `docs/protocol.md` of `librespeed-route`); the page reads an answer only if it is of this window and origin, has exactly the keys, and is about the trace it asked for; an error is written next to the button and also shown in a red box at the top of the screen (for the eyes only). When both directions are on the page, the map can draw them together (the button "Show both directions", on by default and remembered in the browser): the direction on the screen keeps its numbers and its line; the other one is drawn under it in the colour `--secondary`, with the same dashes, its own arrows and a dashed ring where it ends, and has no numbers: a network that is in both (same ASN, same country) has no mark of its own and a network that is only in the other direction is a small dot beside the line of the numbers. The two curves of a sea bend to opposite sides, so both are seen.

## Languages

The catalogs are flat JSON files with dotted keys, in the format of the shared localization (`data-i18n`,
`data-i18n-attr`, `LibreSpeedI18n.t`). The text of the pages in English is the fallback, so a key that is missing in a
catalog shows in English. To add a language, copy `locales/en.json`, translate it and add the language to the list at the
top of `javascript/i18n.js`.
