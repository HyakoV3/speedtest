# Design Feature Switch

LibreSpeed now supports switching between the classic design and the new modern design.

## Default Behavior

By default, LibreSpeed uses the **classic design** (located in `index-classic.html`).

## Architecture

### File Structure (Non-Docker)
- **`index.html`** - Entry point (lightweight switcher)
- **`index-classic.html`** - Classic design at root
- **`index-modern.html`** - Modern design at root (references assets in subdirectories)
- **`frontend/`** - Directory containing modern design assets (CSS, JS, images, fonts) - kept for non-Docker deployments

### File Structure (Docker)
Docker deployments preserve the same layout as non-Docker deployments:
- **`index.html`** - Entry point (lightweight switcher)
- **`index-classic.html`** - Classic design at root
- **`index-modern.html`** - Modern design at root
- **`frontend/`** - Modern design assets, copied into the web root unchanged
- **`settings.json` and `server-list.json`** - Configuration files at root, next to `index-modern.html`

### Benefits of the Shared Layout
✅ Docker and non-Docker deployments use the same paths
✅ Both designs are at the same level
✅ `results/` and `backend/` use the same relative paths from both designs
✅ The modern design loads assets consistently from `frontend/`
✅ Configuration files stay at the web root, where the modern page expects them

## Browser Compatibility

The feature switch uses modern JavaScript features (URLSearchParams, XMLHttpRequest). It is compatible with all modern browsers. The new design itself requires modern browser features and has no backwards compatibility with older browsers (see `frontend/README.md`).

## Enabling the New Design

There are two ways to enable the new design:

### Method 1: Configuration File (Persistent)

Edit the `config.json` file in the root directory and set `useNewDesign` to `true`:

```json
{
  "useNewDesign": true
}
```

This will make the new design the default for all users visiting your site.

### Method 2: URL Parameter (Temporary Override)

You can override the configuration by adding a URL parameter:

- To use the new design: `http://yoursite.com/?design=new`
- To use the classic design: `http://yoursite.com/?design=classic` or ?design=old

URL parameters take precedence over the configuration file, making them useful for testing or allowing users to choose their preferred design.

### Shared Result Images

The `useNewDesign` setting also controls the default style of shared result
images. Result images can be explicitly overridden with `?style=modern` or
`?style=classic`.

## Design Locations

### Non-Docker Deployments
- **Entry Point**: Root `index.html` file (lightweight redirect page)
- **Old Design**: `index-classic.html` at root
- **New Design**: `index-modern.html` at root (references assets in `frontend/` subdirectory)
- **Assets**: Frontend assets (CSS, JS, images, fonts) in `frontend/` subdirectory

### Docker Deployments
- **Entry Point**: Root `index.html` file (lightweight redirect page)
- **Old Design**: `index-classic.html` at root
- **New Design**: `index-modern.html` at root (references assets in `frontend/` subdirectory)
- **Assets**: Frontend assets in `frontend/`, copied into the web root unchanged
- Same layout as a non-Docker deployment, so the two cannot drift apart

Both designs are at the same directory level, ensuring that relative paths to shared resources like `backend/` and `results/` work correctly for both.

## Better Design and the Design Links

`index-better.html` is a third design. Open it with `?design=better` (`?design=modern` also works for the modern design).

The footer of the three speed test pages (classic, modern and better) has a line `Design: Classic | Modern | Better`. They are plain links, and a plain click also remembers the choice in the browser (`localStorage["librespeed-design"]`) and keeps the query string of the page, without `design=`. The stability pages have the same line. Their links go to the stability page of each design (`stability.html` is shared by classic and modern, so neither is marked as the current one there; `stability-better.html` is the better one).

`index.html` (`design-switch.js`) decides in this order:

1. `?design=` in the URL (`new`/`modern`, `old`/`classic` or `better`). The parameter stays in the URL.
2. The design the visitor saved with the design links, unless `config.json` has `"designSwitch": false`.
3. `useNewDesign` in `config.json` (or `USE_NEW_DESIGN` in Docker): modern when `true`.
4. The classic design.

A saved choice wins over `useNewDesign` for the visitors who made one.

### Turning the design links off

- Docker: set `DESIGN_SWITCH=false`. The links are removed from the pages and `index.html` ignores any saved choice.
- Without Docker: set `"designSwitch": false` in `config.json` **and** delete the lines with `data-design-switch` from `index-classic.html`, `index-modern.html`, `index-better.html`, `stability.html` and `stability-better.html`.

## Technical Details

The feature switch is implemented in `design-switch.js`, which is loaded by the root `index.html`. It checks:

1. First, URL parameters (`?design=new`, `?design=old` or `?design=better`)
2. Then, the design saved by the design links (`design-links.js`)
3. Then, the `config.json` configuration file
4. Redirects to `index-classic.html`, `index-modern.html` or `index-better.html`

Both design HTML files are at the root level, eliminating path issues.

### Non-Docker
The modern design references assets from the `frontend/` subdirectory (e.g., `frontend/styling/index.css`), while both designs can access shared resources like `backend/` and `results/` using the same relative paths.

### Docker
In Docker deployments, `frontend/` is copied into the web root as it stands during container startup, so the container serves the same layout the repository has and the same paths `index-modern.html` asks for.
