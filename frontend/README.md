# LibreSpeed frontend

This directory contains the modern LibreSpeed UI assets.

## Deployment

For installation and deployment, follow the top-level [README.md](../README.md)
and [DESIGN_SWITCH.md](../DESIGN_SWITCH.md). This directory is copied as a
whole: `index-modern.html` loads its assets from `frontend/`, so the layout
here is the layout that gets served.

## Configuration

The two configuration files live at the top level rather than here, because the
page fetches them relative to itself:

- `../server-list.json` contains the default server list used by the modern UI.
- `../settings.json` overrides selected `speedtest_worker.js` settings.
- `index.html` and `../index-modern.html` show how the frontend is wired up.

## Localization

The modern page ships with English, Swedish, Portuguese and Spanish. The language is the saved choice, then the first
supported language of the browser, then English; the selector in the footer changes it and saves the choice in the
browser.

- `javascript/i18n.js` loads `locales/<language>.json` (flat JSON, dotted keys) and fills the elements marked with
  `data-i18n="key"` (text) or `data-i18n-attr="attribute:key"` (attributes). The English text stays in the HTML as the
  fallback.
- Texts written by `javascript/index.js` go through `LibreSpeedI18n.t(key, fallback, { name: value })`.
- To add a language, copy `locales/en.json` to `locales/<id>.json`, translate it and add `{ id, name }` to `LANGUAGES` in
  `javascript/i18n.js`. `tests/e2e/i18n.spec.js` checks that every catalog has the same keys as the English one.
- In the Docker image, a `TITLE` or `TAGLINE` other than the default replaces the translated title, heading and tagline with that text; the defaults keep them translated.

## Theming

The look of the modern design is driven by the CSS variables in `styling/colors.css`. To brand an instance, put your own
values in `styling/theme.css`. That file ships empty and is loaded after `index.css`, so it wins. There is no switch for
the visitors: the host decides.

```css
:root {
  --theme-green: #ff8a00; /* accents, links, the tagline */
  --theme-pink: #7a2cff; /* the second color of the button and the hover of the links */
  --background-backup-color: #101820; /* the page behind the background image */
}

html {
  background-image: url("../images/my-background.jpg"); /* relative to theme.css, so to this folder */
}
```

The variables that change the look are the ones in `styling/colors.css`: the accent colors (`--theme-green`,
`--theme-pink`), the texts (`--primary-text-color`, `--secondary-text-color`, `--tagline-text-color`, and the disabled
ones), the background (`--background-backup-color`, `--background-overlay-color`), the start button
(`--button-*`), the server selector (`--server-selector-*`), the gauges (`--gauge-background-color`,
`--gauge-pointer-green`, `--gauge-pointer-pink`), ping and jitter (`--ping-and-jitter-*`) and the popups
(`--popup-background-color`). `--gauge-progress-color` and `--popup-shadow-color` are declared but not used by the
page, so changing them has no effect.

The logo is `images/logo.svg`; put your own file at that path. The favicon is `images/favicon.svg`.

What the theme cannot reach: the colors written inside the SVG files (the logo and the favicon gradient, the chevron and
the close button), the `theme-color` of the page and of `manifest.webmanifest`, and the image that is made for sharing
a result (`results/index.php`). Change those files themselves if you need them to match.

This applies to the modern design only. The classic design and the stability page have their own styles.

### Docker

The container copies `/speedtest/frontend` to the web root every time it starts, so a theme has to be put in
`/speedtest/frontend`, not in `/var/www/html/frontend`. Mounting a file over a path in `/var/www/html` makes the start
fail, because the entrypoint empties that folder first.

```sh
docker run -d -p 80:8080 -e MODE=standalone -e USE_NEW_DESIGN=true \
  -v $PWD/theme.css:/speedtest/frontend/styling/theme.css:ro \
  -v $PWD/logo.svg:/speedtest/frontend/images/logo.svg:ro \
  ghcr.io/librespeed/speedtest
```

To bake the theme into your own image instead of mounting it:

```dockerfile
FROM ghcr.io/librespeed/speedtest
COPY theme.css /speedtest/frontend/styling/theme.css
COPY logo.svg /speedtest/frontend/images/logo.svg
```

The modern design is only served when `USE_NEW_DESIGN=true`. A change to a mounted file needs a restart of the
container, because the files are copied at start.

## Notes

- The modern frontend expects modern browser features and does not support old
  browsers.
- This directory does not contain the backend or results-sharing files.
