# Icons of the better pages

The pages draw their icons (the sun and the moon of the theme button, the share icon, the previous, pause, play and next
buttons, the carets, the check marks, the arrow of the selects and the close buttons) from an **icon set the visitor can
choose** in the theme panel (Page > Icons, or `?icons=<id>`). The choice is kept in the browser.

`subset.json` has the few icons the pages use, in each set. They are files of this server: **nothing is asked of Iconify or
of anyone else when a page opens.** `javascript/icons.js` reads the file, and `styling/icons.css` draws the signs that are
not an `<svg>` of the page.

| Id                       | Set                    | Author              | License    |
| ------------------------ | ---------------------- | ------------------- | ---------- |
| `material-symbols`       | Material Symbols       | Google              | Apache-2.0 |
| `mdi`                    | Material Design Icons  | Pictogrammers       | Apache-2.0 |
| `tabler`                 | Tabler Icons           | Paweł Kuna          | MIT        |
| `lucide`                 | Lucide                 | Lucide Contributors | ISC        |
| `ph`                     | Phosphor               | Phosphor Icons      | MIT        |

The author, the address and the license of each set are in `subset.json` too, and the sets are:

- Material Symbols: <https://github.com/google/material-design-icons>, license
  <https://github.com/google/material-design-icons/blob/master/LICENSE>
- Material Design Icons: <https://github.com/Templarian/MaterialDesign>, license
  <https://github.com/Templarian/MaterialDesign/blob/master/LICENSE>
- Tabler Icons: <https://github.com/tabler/tabler-icons>, license
  <https://github.com/tabler/tabler-icons/blob/master/LICENSE>
- Lucide: <https://github.com/lucide-icons/lucide>, license <https://github.com/lucide-icons/lucide/blob/main/LICENSE>
- Phosphor: <https://github.com/phosphor-icons/core>, license
  <https://github.com/phosphor-icons/core/blob/main/LICENSE>

These licenses ask for the notice of the author and of the license when the icons are shared. The list above is that
notice. The icons were taken through [Iconify](https://iconify.design), which publishes the sets as data.

## Weight

`?weight=light|regular|bold` (or `weight` in `better-defaults.js`) asks for a weight of the icons. Only a set that draws its
icons in more than one weight changes, which today is **Phosphor** (light, regular and bold, for every icon). The other sets
have one weight, so they are drawn in regular whatever the weight asked for. `<html>` gets `data-icons-weight` with the
weight asked for.

## Changing the icons

`build-subset.js` writes `subset.json` (it needs Node 18 or newer and the network, only to run, never in the pages):

```
node frontend/better/icons/build-subset.js
```

- To use a new icon in a page, add its name to `ICONS` in the script and its name in each set (they differ between the
  sets), run the script, and ask for it with `LibreSpeedIcons.html("name")`, or with `data-icon="name"` on an element.
- A set that has other weights lists them in `weights` of its entry in `SETS`, with the ending of the name of each one
  (`{ light: "-light", bold: "-bold" }`). The script then keeps those drawings in `subset.json` too, and asks for every
  icon in every weight.
- To offer another set, add it to `SETS` in the script. It must have the icons the script lists, all on the same grid (24 x 24 for most sets, 256 x 256 for Phosphor: the
  grid of each set is kept in `subset.json`). A variant of a set that has its own id in the panel but the prefix of another set in Iconify uses `prefix` and `label`.
- `DEFAULT_SET` in the script is the set of the file. A site can choose another with `icons` in `better-defaults.js`.
