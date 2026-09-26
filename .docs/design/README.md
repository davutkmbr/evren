# Seventeen Skies — UI design language (locked)

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
| Result time | 88–120 px / 700, letter-spacing −0.03 em |
| Countdown (title zone) | 64–112 px (10.5 vh) / 700, letter-spacing −0.03 em |
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
  (centre; the flow line, a 2 px line under the wings, appears only while there is flow, with the chain length as a
  small gold "×3" at its right end while a chain is alive), altitude (right); minimap
  bottom right (132 px circle). Everything transient is placed by the zones below.
- **HUD zones (`src/ui/zones`):** the HUD composes itself. Every transient message (area title, race intro /
  countdown / warnings / callouts, discovery card, maneuver and shot captions, hover and start hints, the race's
  "[Y] iptal", toasts, the compass landmark label) asks the zone director (`hudZones` service) for a zone with a
  priority and a duration. Per zone the highest priority shows; the others wait and are dropped once stale (their
  `maxWait`); a zone fades out the old item before the new one fades in. One item per zone. Nothing positions itself
  with its own `top:`; bands come from the viewport (`bands.ts`, checked from 1280 × 720 to 2560 × 1440 by
  `tools/headless/hud-zones-check.ts`).

  | Zone | Band | Holds |
  |---|---|---|
  | `top` | compass (gutter + 2 px, 54 px) and one line under the heading (gutter + 52 px) | landmark label; while racing the race readout (gutter + 72 px) replaces it |
  | `title` | from max(top band + 14 px, 18 %) down 21 % (150–290 px) | area title; a perch's name and info; race intro: course name small, countdown / "Başla!" large, counts and medal targets as one line; race warnings; "+10 m/s" |
  | `center` | between title and lowerCenter (≥ 25 % of the height) | reserved for the aim and the ring: no text except small labels next to world markers (gate distance) |
  | `lowerCenter` | one line, bottom edge gutter + 158 px (grows upwards for the hover panel) | the shared hint line (key hints, optional caption; the "[L] Kon" prompt and the viewing keys; the contextual move hints), maneuver and shot captions, hover controls, a moment's subtitle line (italic, shadowed, no box, slow fades) |
  | `bottom` | gutter + 10 px, 146 px tall | the static cluster (not a zone item) |
  | `corner` / `toast` | top right / top left (top centre over a menu or the map) | discovery card (also a moment's closing card, "Yeni an") / one toast at a time |

  Priorities, highest first: race countdown, "Başla!", race readout and the race hint line (100) > race warnings (90) >
  race callouts (85) > discovery card and the perch title (70) > area title (60) > maneuver captions (50) > moment
  subtitle lines and the perch prompt, approach and viewing hint lines (45) > hover hints and shot caption (40) > a moment's "[I] Kaynağa bak" for 10 s
  after it (35, joinable; while the moment plays the prompt rides quietly under its subtitle line) >
  start-of-game hints and the compass label (30) > contextual move hints (20, `src/ui/tutorial`) > toasts (10); ties go to the newer message (a toast replaces the
  current one). The context `race` (a race prepared, running, aborting or its result open) defers the area title
  (dropped after 8 s), the compass landmark label (the next gate is the target) and moment lines and cards (no moment
  starts during a race). Start hints and "[Y] iptal" are items of the same hint line and never share it; only hints
  marked `joinable` ride along on a higher line. **Contextual move hints** (the tutorial, `src/ui/tutorial`): one
  key-first hint at a time ("[Space ×2] Güç vuruşu", keyless for automatic moves: "Suya yakın uç: sıyırma") at the
  lowest hint-line priority, requested only when the line, the title and the corner have been free for 3 s, never
  during a race, a landing approach, perching, a menu or photo mode, at most one new hint per 60 s of play and none in
  the first 45 s; displaced by any other message it does not come back; a move performed cleanly never shows its hint
  again (Ayarlar → Oyun → İpuçları switches them off, "İpuçlarını sıfırla" starts over). While perched on a viewpoint (the viewing mode, phase 03) the compass,
  the bottom cluster and the minimap fade out: only the zones remain (the perch title, the viewing hint line, toasts).
- **Small sheets (a moment's sources):** the same sheet look at ≈760 px wide, one column that scrolls, a top bar with
  the state ("Kaynak · oyun duraklatıldı") and "[Esc] Kapat".
- **Sheets (pause menu, race picker):** centred, ≈1220 × 760 at 1440 × 900, top bar with title/tabs and the close
  prompt; content in two columns (list left, detail right). Scales down under 1440 × 820.
- **Full-screen overlays (map, result):** content directly on a scrim or the map, chrome in the corners: title top
  left, close top right, controls bottom right, scale/attribution bottom left, hints bottom centre.
- **On-scene prompts (countdown, editor):** horizontally centred text (the countdown in the `title` zone, never over
  the dragon or the ring), key strip on the left edge, nothing boxed.

## 4. Components (`src/ui/components/`)

Every screen builds these from the library; styles in `src/ui/styles/components.css`.

| Component | API | What it is |
|---|---|---|
| Key cap | `keyCap(label, tone, { size, state })`, `keyCombo('Ctrl + W / S', tone, { size })` (a trailing "×2" is a double-tap mark), `setKeyCapState(cap, state)` | a raised key; tones `gold` (main action), `ink`, `quiet`, `warn`; sizes `s` (inline, small slots), `m`, `l` (keyboard drawing, `--key` × `--w`); states `dim` / `lit` / `hot` for caps that light up |
| Key text | `keyText('Konmak için [L]')` | a sentence whose `[X]` parts become small key caps (toasts, hint sentences) |
| Key hint | `keyHint(keys, label, tone)` | a key and what it does as plain text, not a button (key strips, HUD and loading hints) |
| Prompt | `prompt(label, key, variant, onPress)`, `.setDisabled(on, reason)` | key + verb, the only action button; variants `primary` (gold key), `secondary`, `danger`; key `''` for a pointer-only action (verb alone) |
| Link prompt | `linkPrompt(label, key, href, domain)`, `.open()` | a prompt that leaves the game: key, verb, then the destination's domain, quieter ("[1] Tarayıcıda aç  tr.wikisource.org"); a real link to a new tab (`rel="noopener noreferrer"`) |
| Option switch | `optionSwitch(label, key, on, accent, onToggle)` | key, name, written state "açık/kapalı" with a coloured dot |
| Stat | `stat(label, value, size)` | a value under its name, tabular |
| Medal ladder | `medalLadder(format).set(targets, best)` | medal targets on a time line with the best time as a marker |
| Medal dot / disc | `medalDot(medal, size)`, `medalDisc(medal)` | a small dot in a medal's colour (ring when none); the big result-screen disc with a star |
| Pill | `pill(text, tone)` | a short status tag ("Yeni rekor"), `gold` or `quiet` |
| Legend | `legend(items, className)` | colour keys for a chart or map: swatch (`dot`, `ring`, `square`) + label |
| List row | `listRow(content, onPick, onHover, { focusable })` | a selectable list entry: name, quieter second line, value and marker; selection is a gold bar on the left edge; `focusable` puts it in the tab order (Enter / Space pick it) |
| Text field | `textField(label, { key, placeholder, maxLength, size })` | a labelled single-line input with an optional focus key and a message line |
| Segmented control | `segmented(label, options, current, onChange)` | one of a few options as equal segments; a radio group driven by ArrowLeft / ArrowRight |
| Slider | `slider({ label, min, max, step, value, format, onInput })` | a range slider with a gold fill and its value written out on the right |
| Toggle | `toggle(label, value, onChange)` | an on/off switch for a setting row (for an option with its own key use the option switch) |
| Setting row | `settingRow(title, desc, control, { keys, sub })`, `settingSection(title, rows, lede)`, `settingDisclosure(label, rows)`, `setRowsEnabled(rows, on, reason)` | a setting's title, description, shortcut caps and control; titled groups of rows; a "show more" group; greying out dependent rows |
| Layer toggle | `layerToggle(label, { color, mark, count, on, onToggle })`, `layerGroup(label, toggles)` | a legend row that shows or hides a map layer (swatch, name, count); rows grouped in a small dark panel |
| Hover card | `hoverCard().set(title, meta, action)`, `.showAt(x, y, w, h)` | a small card beside the thing under the pointer, flipped to stay inside the view |
| Zoom cluster | `zoomCluster({ onZoomIn, onZoomOut, onRecenter })` | stacked +, − and back-to-my-position buttons for a zoomable view |
| Scale bar | `scaleBar(attribution).set(pxPerMeter, maxPx)` | a round-distance map scale with an optional attribution line |
| Hint line | `hintLine([[gesture, verb], …])` | a quiet one-line list of pointer gestures ("Sürükle: kaydır · Tıkla: ışınlan"); keys use key caps instead |
| Route map | `routeMap({ aspect, minSpan, legend, label }).set(data)`, `.setWater(sampler)`, `frameRoute(points, aspect)` | a route on a small map card: land and water, dashed gold line, stops and side targets, framed to fit |
| Diverging bars | `divergingBars({ negativeColor, positiveColor, label, maxHeight }).set(rows)` | per-item bars left or right of a neutral zero line with ink value labels and hover cards (the race result chart) |

| Interaction states | `interactive(node, family)`, `bindKeyPress(node, key)`, `flashPressed(node)` | the shared hover / pressed / focus / disabled states (families `cap`, `surface`, `segment`, `control`); a bound key held on the keyboard presses the visible component that names it |

Additions go into the library first (with a line in this table), then into screens. A component never hard-codes
screen copy.

### Interaction states

One system for every interactive component (`components/interaction.ts`, "Interaction states" in `components.css`),
built on tokens: `--ui-hover-surface` (white 5 %), `--ui-selected-surface` (8 %), `--ui-press-surface` +
`--ui-press-shadow`, `--ui-focus-ring` (2 px `--accent`) with `--ui-focus-offset` 3 px (`-inset` −2 px, `-tight`
1 px), `--ui-disabled-opacity` .45, `--ui-motion-fast` 140 ms, `--ui-motion-press` 90 ms, `--ui-ease-out`.

- **Key cap = physical key.** Hover: the cap rises 1 px, its edge a touch deeper, the face brighter (gold adds a warm
  glow), the verb goes to full ink, no underline. Pressed (pointer, or the bound key held while the prompt is shown):
  the cap sinks 1 px with a thin edge; gold darkens slightly.
- **Rows, toggles, segments:** hover lifts the surface and the label to full ink; selected keeps the gold bar and a
  stronger surface; pressed is a darker surface with a 1 px inset shadow.
- **Focus** is keyboard only (`:focus-visible`): the gold ring outside prompts, switches and toggles, inside rows,
  tight around a segment, on a slider's thumb. **Disabled:** 45 % opacity, no hover or press, a reason as tooltip.
- **Motion:** 140 ms ease-out in, 90 ms press, no bounce; with reduced motion only colours change.

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
