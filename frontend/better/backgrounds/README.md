# Backgrounds of the better pages

An optional photo behind the page, **off by default**. Nothing here is requested until someone picks a background in the
theme panel (or opens a page with `?background=<id>`), and nothing is ever requested from another server: the photos are files
of this repository.

The photos come from [Unsplash](https://unsplash.com) and are used under the
[Unsplash License](https://unsplash.com/license) (free to use and to host, attribution not required but given).
They are downloaded once, by hand, from the website, not through the API (the API terms ask for hotlinking).

## The pack

`backgrounds.json` lists the packs (`id`, `title`, `photos`). Each photo has `id` (lowercase letters, digits and dashes), `file`, `title`,
`tone` (`dark` or `light`, the mode of the page it reads best with), `author`, `handle` (Unsplash username, without @) and `page` (the photo on Unsplash). The page shows the credit under the footer links while a background is active.

## Changing the pack

1. Pick a photo on unsplash.com (not an Unsplash+ one) and note its id (`.../photos/<id>`), author and handle.
2. Save it as a WebP of about 1600 px wide and under 150 KB, for example from the image URL
   `https://images.unsplash.com/photo-<number>?w=1600&q=55&fm=webp&fit=max`, as `backgrounds/<id>.webp`.
3. Add its entry to a pack in `backgrounds.json`. Remove files and entries to shrink the pack.

Dark, low-detail photos read best behind the meters. The page already puts a veil of the page color over the photo.

## Grain

Some photos have film grain or night-sky noise that shows when they fill the page. `dusk-blur`, `soft-1` and `soft-2` were smoothed before saving (the Unsplash License allows changing the photos). Start from the
`q=90` version of the image URL, then, with ImageMagick:

- soft, blurry photos: `convert in.webp -resize 1600x -blur 0x1.8 -quality 70 out.webp`
