# Better pages

`index-better.html` and `stability-better.html` are alternative versions of the classic speed test and of the stability
test, with the same features and a different look. The other pages are not changed. The assets are in this folder:

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

## Languages

The catalogs are flat JSON files with dotted keys, in the format of the shared localization (`data-i18n`,
`data-i18n-attr`, `LibreSpeedI18n.t`). The text of the pages in English is the fallback, so a key that is missing in a
catalog shows in English. To add a language, copy `locales/en.json`, translate it and add the language to the list at the
top of `javascript/i18n.js`.
