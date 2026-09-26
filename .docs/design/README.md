# Evren — UI design language (locked)

Status: **locked on 26 September 2026** after the HUD, pause menu, map, race and loading-screen redesigns were approved.
New screens follow this document. A change to the language itself is a deliberate decision: update this file first,
then the components, then the screens.

The approved mockups live on the design canvas ("Evren duraklatma menüsü", a private Claude artifact owned by the
project owner): pause menu, HUD, map, the five race screens and the component sheet. The code is the source of
truth once implemented; the canvas is the reference for intent.

## 1. Principles

1. **The city is the interface.** In flight, nothing sits in a box over the scene. Readouts are plain text with a soft
   shadow (`text-shadow: 0 1px 6px rgba(0,0,0,.5)`). Panels appear only for things that stop the game (pause menu,
   map, race picker, dialogs).
2. **Show it when it matters.** Every HUD element earns its place by being needed now: stamina fades out when full,
   the area title shows once when entering an area, race readouts exist only during a race, toasts replace in place
   instead of stacking. When in doubt, leave it out and put it in the pause menu.
3. **Key first, then the verb.** Actions are shown the way games show them: a key cap followed by the action
   ("[Enter] Yarışa başla"). No pill buttons, no filled buttons except the gold key cap of the main action.
4. **Units carry meaning; no caps labels.** "133 km/sa", "18 m", "yerden 20 m" instead of HIZ / İRTİFA headers.
   Uppercase is not used for labels. Letter-spaced small caps are not used at all.
5. **Structure encodes information.** Lines, dots and positions mean something (a medal is earned because your best
   marker stands left of it on the time line, a selected row has a gold bar). Borders and cards are not decoration.
6. **One component, everywhere.** A key, an action, an option, a value or a medal target is always built from the same
   component (section 4). No one-off buttons.
7. **Turkish, calm, short.** Player-facing text is Turkish, sentence case, active voice, a little warm, never shouty.
   Numbers use Turkish formatting (`1,24`, `%60`, `4:31,62`).

## 2. Tokens

Defined on `.ejd` in `src/ui/styles/base.css`; components fall back to the same values.

| Token | Value | Use |
|---|---|---|
| `--ink` | `#f3eee5` | primary text on dark (HUD over the scene uses `#f6f1e7`) |
| `--ink-2` | ink at 70 % | secondary text |
| `--ink-3` | ink at 48 % | captions, hints |
| `--ink-4` | ink at 30 % | separators in key combos |
| `--accent` | `#e8b872` | gold: the main action's key cap, selection, stamina, perches, gates |
| `--accent-2` | `#f3d3a0` | gold text on dark gold tints |
| `--warn` | `#ff9168` (text `#ffb89c`) | low stamina, danger actions, invalid, warnings |
| `--good` | `#a3dcb4` | positive status only (not for data) |
| `--line` / `--line-2` / `--line-3` | white at 8.5 / 15 / 24 % | hairlines, field borders |
| sheet background | `rgba(17,19,24,.94–.96)` | pause menu, race picker, dialogs |
| scene scrim | `rgba(8,9,12,.45–.82)` | behind a sheet or the result screen |

Domain colours (fixed meaning, never reused for anything else):

| Meaning | Colour |
|---|---|
| Gold / silver / bronze medal | `#e8b872` / `#c9ccd3` / `#c98d5e` |
| Speed ring | `#7fd1c0` |
| Ghost | `#b39cf0` |
| Faster / slower (data) | `#5a93cf` / `#cc8140` — validated for colour-vision deficiency on the dark surface; on the bright scene the text variants `#8fbdea` / `#e6a46b` |
| Water labels on the map | italic, `rgba(170,190,215,.55)` |

Typography: the system UI font (`--font-ui`, `--font-display`); no web fonts without asset approval (CLAUDE.md).
Numbers are always tabular (`font-variant-numeric: tabular-nums`, class `ejd-num`).

| Role | Size / weight |
|---|---|
| Result time, countdown | 88–120 px / 700, letter-spacing −0.03 em |
| Race time, HUD headline numbers | 34–44 px / 600 |
| Area title | 46 px / 300 |
| Sheet title | 20–28 px / 600 |
| Row title, action label | 14.5–15.5 px / 500–650 |
| Body, descriptions | 13–14 px / 400 |
| Captions | 12–12.5 px / 400 |

Radii: sheet 20 px, panels and cards 12–14 px, rows 10 px, fields 10–11 px, key caps 6 px. Touch targets at least
40 px tall. Motion: fades 150–280 ms (`--ease-out`), no bounce; pulsing only for things that need attention now (low
stamina, the next gate).

## 3. Layout

- **HUD (flight):** compass as a bare tape top centre; bottom centre cluster: speed (left), stamina wings + hotbar
  (centre), altitude (right); minimap bottom right (132 px circle); area title in the upper third; discovery card top
  right as shadowed text. Race readouts replace nothing: they appear under the compass.
- **Sheets (pause menu, race picker):** centred, ≈1220 × 760 at 1440 × 900, top bar with title/tabs and the close
  prompt; content in two columns (list left, detail right). Scales down under 1440 × 820.
- **Full-screen overlays (map, result):** content directly on a scrim or the map, chrome in the corners: title top
  left, close top right, controls bottom right, scale/attribution bottom left, hints bottom centre.
- **On-scene prompts (countdown, editor):** centred text, key strip on the left edge, nothing boxed.

## 4. Components (`src/ui/components/`)

Every screen builds these from the library; styles in `src/ui/styles/components.css`.

| Component | API | What it is |
|---|---|---|
| Key cap | `keyCap(label, tone, { size, state })`, `keyCombo('Ctrl + W / S', tone, { size })`, `setKeyCapState(cap, state)` | a raised key; tones `gold` (main action), `ink`, `quiet`, `warn`; sizes `s` (inline, small slots), `m`, `l` (keyboard drawing, `--key` × `--w`); states `dim` / `lit` / `hot` for caps that light up |
| Key text | `keyText('Konmak için [L]')` | a sentence whose `[X]` parts become small key caps (toasts, hint sentences) |
| Key hint | `keyHint(keys, label, tone)` | a key and what it does as plain text, not a button (key strips, HUD and loading hints) |
| Prompt | `prompt(label, key, variant, onPress)` | key + verb, the only action button; variants `primary` (gold key), `secondary`, `danger`; key `''` for a pointer-only action (verb alone) |
| Option switch | `optionSwitch(label, key, on, accent, onToggle)` | key, name, written state "açık/kapalı" with a coloured dot |
| Stat | `stat(label, value, size)` | a value under its name, tabular |
| Medal ladder | `medalLadder(format).set(targets, best)` | medal targets on a time line with the best time as a marker |
| Medal dot / disc | `medalDot(medal, size)`, `medalDisc(medal)` | a small dot in a medal's colour (ring when none); the big result-screen disc with a star |
| Pill | `pill(text, tone)` | a short status tag ("Yeni rekor"), `gold` or `quiet` |
| Legend | `legend(items, className)` | colour keys for a chart or map: swatch (`dot`, `ring`, `square`) + label |
| List row | `listRow(content, onPick, onHover)` | a selectable list entry: name, quieter second line, value and marker; selection is a gold bar on the left edge |
| Text field | `textField(label, { key, placeholder, maxLength, size })` | a labelled single-line input with an optional focus key and a message line |
| Segmented control | `segmented(label, options, current, onChange)` | one of a few options as equal segments; a radio group driven by ArrowLeft / ArrowRight |
| Slider | `slider({ label, min, max, step, value, format, onInput })` | a range slider with a gold fill and its value written out on the right |
| Toggle | `toggle(label, value, onChange)` | an on/off switch for a setting row (for an option with its own key use the option switch) |
| Setting row | `settingRow(title, desc, control, { keys, sub })`, `settingSection(title, rows, lede)`, `settingDisclosure(label, rows)`, `setRowsEnabled(rows, on)` | a setting's title, description, shortcut caps and control; titled groups of rows; a "show more" group; greying out dependent rows |
| Layer toggle | `layerToggle(label, { color, mark, count, on, onToggle })`, `layerGroup(label, toggles)` | a legend row that shows or hides a map layer (swatch, name, count); rows grouped in a small dark panel |
| Hover card | `hoverCard().set(title, meta, action)`, `.showAt(x, y, w, h)` | a small card beside the thing under the pointer, flipped to stay inside the view |
| Zoom cluster | `zoomCluster({ onZoomIn, onZoomOut, onRecenter })` | stacked +, − and back-to-my-position buttons for a zoomable view |
| Scale bar | `scaleBar(attribution).set(pxPerMeter, maxPx)` | a round-distance map scale with an optional attribution line |
| Hint line | `hintLine([[gesture, verb], …])` | a quiet one-line list of pointer gestures ("Sürükle: kaydır · Tıkla: ışınlan"); keys use key caps instead |
| Route map | `routeMap({ aspect, minSpan, legend, label }).set(data)`, `.setWater(sampler)`, `frameRoute(points, aspect)` | a route on a small map card: land and water, dashed gold line, stops and side targets, framed to fit |
| Diverging bars | `divergingBars({ negativeColor, positiveColor, label, maxHeight }).set(rows)` | per-item bars left or right of a neutral zero line with ink value labels and hover cards (the race result chart) |

Additions go into the library first (with a line in this table), then into screens. A component never hard-codes
screen copy.

## 5. Data display

Charts follow the validated dataviz method: pick the form first, colour by job, validate the palette, thin marks,
direct labels in ink (never in the series colour), a legend for two or more series, hover details. The race result's
per-gate chart is the reference: diverging bars around a neutral zero line, faster left in blue, slower right in
orange.

## 6. Do / don't

| Do | Don't |
|---|---|
| Shadowed text over the scene | Glass cards behind every readout |
| Key cap + verb | Pill buttons, gradient buttons |
| Sentence case | UPPERCASE LABELS, letter-spaced eyebrows |
| Units after numbers | Headers over numbers |
| Position and lines that encode data | Checkmarks and badges on cards |
| One toast that updates | Stacks of toasts |
| Contextual reveal | Always-on chips (clock, mode, camera, counters) |

## 7. Art direction for illustrated screens

The loading screen is the reference: a single dusk panorama of the historic peninsula from Salacak, smooth vector
silhouettes in three haze layers (far, middle, near), recognisable landmarks drawn with their real features (six
minarets for Sultanahmet, Ayasofya's flat dome and buttresses), one-pixel rippled reflections, a small bat-winged
dragon. No blocky or stepped outlines, no generic domes, no streaky gradients. It is drawn from a 1600 × 900 design
frame scaled by the screen height (`src/ui/loading/skyline-painter.ts`).
