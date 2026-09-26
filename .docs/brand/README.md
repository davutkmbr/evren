# Seventeen Skies — brand

![Brand sheet](brand-sheet.jpg)

## Name

**Seventeen Skies**, always written out in words and in title case. Domain: **seventeenskies.com**, shown as
`SeventeenSkies.com` wherever people read it (posters, trailer end cards, social bios) so the two words stay apart.
Hashtag: `#SeventeenSkies`, never `#Seventeen` alone (it collides with the K-pop group SEVENTEEN).

- Do not shorten it to "17 Skies" or put digits in the name, domain or handles; digits read as a cheap mobile game.
- In Turkish text the name stays in English. Mark it `lang="en"` in HTML so CSS uppercasing does not turn the `i`
  of Skies into a Turkish `İ`.
- `evren` remains the internal codename in code identifiers (`window.__evren`, `EVREN_*`, Blender / Unreal assets).
  The dragon you fly today is named Evren.

### The story (for store pages, press and trailers)

In old Turkic belief the sky (*gök*) has seventeen layers. Each layer is home to its own spirits, and Ülgen sits on a
golden throne at the top. Only a *kam* (shaman) could reach him, riding the spirit of a mount up through the layers
one by one. Seventeen Skies is that ride: you fly the mythic creatures of Turkic legend (the dragon Evren today;
Tulpar, Zümrüdüanka, Hüma and others later) over a real, living city. Istanbul is the first sky.

## Lines

| Use | Turkish (in game) | English |
|---|---|---|
| Brand line | Gök on yedi kattır. İlki İstanbul. | The sky has seventeen layers. The first is Istanbul. |
| Description | Türk mitolojisinin uçan yaratıklarıyla gerçek İstanbul üzerinde serbest uçuş. Tarayıcıda, kodla üretilmiş bir dünya. | Ride the flying creatures of Turkic myth over a real, living Istanbul, in your browser. |

The constants live in `src/ui/brand.ts` (`BRAND`); UI code reads them from there.

## Logo

The logo is drawn in code (`src/ui/brand-logo.ts`), so it needs no font and stays sharp at every size. The tone is
calm and luminous, the sky at dusk, never heavy, metallic or aggressive.

- **Lettering:** calligraphic capitals written with a broad nib, a nod to hat (Turkish calligraphy) rather than a
  typeface: every stroke's width follows its direction (thick stems and down-strokes, hairline bars) and flares a
  little at the ends. Small, widely spaced SEVENTEEN over a large SKIES. The ink runs from ivory at the top through
  pale gold to dusk ember at the foot, with a soft warm glow.
- **Crest** (`titleLogoSvg()`, on by default): the dome of the sky in seventeen hairlines, from the horizon at the
  foot of SKIES up to the eight-pointed star, closer together as they rise and warmer near the horizon. The lines
  part around the letters and leave the SEVENTEEN row clear. Use the crest for the loading screen, share images,
  store art and anything above ~300 px wide; below that use `crest: false` (the pause menu uses it at 150 px).
- **Monogram** (`monogramSvg()`): the nib S inside the same dome of seventeen layers, under the star, on a
  night-blue tile warmed from below. App icons, favicons, avatars.

Rules:

- Place the logo on dark or dusk backgrounds (night sky, sunset, darkened game shots). It is not made for light
  backgrounds; use a dark panel or scrim behind it there.
- Do not recolour, stretch, outline, re-letter or add hard shadows or bevels to it. Do not set the name in another
  font next to the logo; the brand line is set in the UI font (`--font-display`).
- Keep clear space of at least the height of SEVENTEEN around the title logo.

## Colours

| Token | Hex | Use |
|---|---|---|
| night | `#070a12` | Backgrounds, theme colour |
| gok | `#14223a` | Secondary backgrounds, gradients |
| gold | `#e8b872` | UI accent (`--accent`) |
| goldPale | `#f3d3a0` | Middle of the logo's ink, brand line (`--accent-2`) |
| ember | `#e0763a` | Foot of the logo's ink, the lowest layers of the sky |
| ivory | `#fbf6ee` | Top of the logo's ink, the star, text on dark |

## Files

Everything is generated from the code that draws it; do not edit the SVG or PNG files by hand.

| Where | What |
|---|---|
| `src/ui/brand.ts` | Source: name, lines, URL, hashtag, colours (`BRAND`, `BRAND_COLORS`) |
| `src/ui/brand-logo.ts` | Source: the lettering, the title logo (`titleLogoSvg`) and the monogram (`monogramSvg`) |
| `sandbox/brand.html` | Brand sheet and every raster view (`?show=logo`, `icon`, `og`, `banner`) |
| `scripts/brand/build-brand.ts` | Writes the SVGs, colour tokens, manifest and `scripts/brand/renders.json` |
| `public/brand/` | Served by the game's page: favicons, app icons, manifest, share image |
| `.docs/brand/kit/` | The brand kit for store pages, press, social media and anything outside the game |

`public/brand/` (linked from `index.html`):

| File | Size | Use |
|---|---|---|
| `favicon.svg`, `favicon-32.png` | any, 32 px | Browser tab |
| `icon.svg`, `icon-192.png`, `icon-512.png` | any, 192, 512 px | Web app manifest, install icon |
| `apple-touch-icon.png` | 180 px, square | iOS home screen (iOS rounds the corners) |
| `og.jpg` | 1200 × 630 | Open Graph / Twitter card |
| `site.webmanifest` | | Name, colours, icons |

`.docs/brand/kit/`:

| File | Size | Use |
|---|---|---|
| `svg/logo.svg` | vector | Title logo with the sky dome and star (default) |
| `svg/logo-title.svg` | vector | Title only, for small sizes |
| `svg/monogram.svg`, `svg/monogram-tile.svg` | vector | The S mark, bare or on its night tile |
| `png/logo-{2400,1200,600}.png` | width in px, transparent | Title logo |
| `png/logo-title-{1200,600}.png` | width in px, transparent | Title only |
| `png/monogram-1024.png` | 1024 px, transparent | Bare S mark |
| `png/monogram-tile-{1024,512}.png` | px, rounded tile | App stores, launchers |
| `social/avatar-400.png` | 400 px, square | Profile pictures (platforms crop to a circle; the mark stays inside it) |
| `social/banner-1500x500.jpg` | 1500 × 500 | X / Twitter header, other wide headers |
| `social/og-1200x630.jpg` | 1200 × 630 | Link previews, posts |
| `colors.json`, `colors.css` | | Colour tokens (`--ss-night`, `--ss-gold-pale`, …) |

The transparent logos are made for dark backgrounds; on a white page viewer they look washed out, which is
expected.

### Regenerating

After changing `src/ui/brand.ts` or `src/ui/brand-logo.ts`:

```bash
npm run brand        # SVGs, colour tokens, manifest, scripts/brand/renders.json
npm run brand:png    # every PNG / JPG above, plus brand-sheet.jpg (snap.mjs, dev server on 5199)
```

The share image and the banner use game shots from `.docs/media/`, cropped so the HUD stays out of frame; replace
them with HUD-less captures (`?nohud=1`) when those exist.

## Domain setup (to do)

The game is still deployed to GitHub Pages under the repository path (`/evren/`). To serve it from
seventeenskies.com: point the domain's DNS at GitHub Pages, set the custom domain in the repository's Pages
settings, and build with `--base=/` in `.github/workflows/deploy.yml`. The Open Graph tags in `index.html` already
use `https://seventeenskies.com/`.
