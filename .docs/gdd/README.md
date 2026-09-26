# Seventeen Skies — Game Design Document

Version 1 · 26 September 2026 · owner: Davut Kember

This document describes what Seventeen Skies is and how its parts fit together. The phase files in `.docs/planning/` describe
how and when each part gets built; the UI design language is locked in `.docs/design/README.md`. Where this document
and a phase file disagree, the newer decision wins and both get updated.

## 1. The game in one paragraph

Seventeen Skies is a calm, open-world flight game in the browser: you ride a dragon over a realistic Istanbul, generated in
code from real geography and OpenStreetMap data. There is no fail state. You fly, glide on thermals along the
Bosphorus, perch on bridge towers and mosque domes to watch the sunset, discover landmarks, race through rings,
stumble on small moments from the city's legends and daily life, and later land, walk and meet people in a walkable
Kadıköy.

## 2. Pillars

| Pillar | Means | Never |
|---|---|---|
| **Chill** | forgiving controls, the dragon helps, discovery over challenge, short optional activities | fail states, timers you did not ask for, nagging |
| **Real Istanbul** | real coastline, relief, streets and landmarks at real size; real light, weather and seasons | a fantasy city, landmarks out of place |
| **A companion, not a vehicle** | the dragon has weight, moods and reactions; the rider shows every command | a plane with a dragon skin |
| **Variety** | every behaviour has several variations; landings, moments, music and views don't repeat | one animation per action |
| **Runs well** | 60 fps on an M2 Max at 1600 × 900 on "high"; scales down gracefully | features that ship before their performance budget |

Sensitivity rule: real mosques, Hagia Sophia and similar landmarks are never damaged; fire and attacks only touch
fictional targets.

## 3. Player fantasy and audience

"I am flying a dragon over my city." For players who know Istanbul, recognising their street from the sky is the
hook; for everyone else it is a beautiful, calm place to explore. Sessions are 10–60 minutes, keyboard and mouse
first, gamepad supported, Turkish UI.

## 4. Core loop

1. **Fly** — take off, cruise, dive, soar; the assist keeps you safe when you let go.
2. **Notice** — a landmark on the compass, a thermal over a hill, a ring course, a moment's trigger.
3. **Go there** — discover it (discovery card), perch and watch, race it, or play the moment.
4. **Keep** — discoveries, medals, records, ghosts and the photo album remain; the map fills in.

Secondary loops: tune the day (time, weather), take photos, build and share ring courses.

## 5. Systems

### 5.1 Flight and the dragon (`src/dragon/`)
- Physics-based flight: lift, drag, stall, flapping effort and stamina; glide ratio 8–12, cruise 25–45 m/s, folded
  dive 80–90 m/s.
- Tricks: barrel roll, loop, free fall with a wing-snap catch; air moves (phase 20 stage B): power
  stroke (güç vuruşu), dart, side-slip (kayış) and the automatic surface skim (sıyırma), each reporting a clean or
  unclean end for the flow system to come. There is no speed button: speed comes from the wing beats, the power
  stroke, the air and flow (the rider's "dehh" urge on V was removed on 26 Sep; V is reserved for a rider–dragon
  interaction in the bond phase).
- Assisted hands-off flight: the dragon holds a safe clearance, climbs over what it cannot pass, **passes under**
  bridges and overhangs that leave room, and with a speed-scaled look-ahead (150–600 m) climbs over or turns away
  from towers. Player input always wins.
- Wind field: environment wind, gusts, **thermals** (sun, land use, slopes, summits) and **ridge lift**
  (poyraz and lodos on the Bosphorus slopes).
- Rider: every command shows on the rider; petting, standing, the dragon's gaze back. Humans are MetaHuman +
  Mixamo (private asset store).
- Hooks for other systems: `addVelocity` (speed rings, powers), `requestRoar`, `fireBurst`.
- Phase 20: run-out landings and touch-and-go, leaping take-offs, the stage B air moves and the reversals (wingover,
  Immelmann, Split-S) are built, and **flow ("akış")**: consecutive motions that harmonise physically (energy kept
  against plain gliding, no jerk across the handover, momentum carried, started on the beat, the world used low and
  clean, variety) build a flow value that pays back as capped speed (up to −8 % drag, ~+5 m/s top cruise, a stronger
  power stroke). No combo tables: any move, and unnamed hand-flown manoeuvring, takes part; repeating one pattern
  wears out, wasting energy never builds flow. Shown as a thin line under the stamina wings, "Kusursuz …" captions
  when a harmony peaks — the skill ceiling for races.
- Planned (phase 21): the sea as a place — physics on the real waves, downwash and wakes when flying low, plunge
  dives and breaches, reworked swimming (waves, currents, water take-off runs, short dives), underwater view.

### 5.2 The world (`src/world/`, `tools/world-compiler/`)
- Real relief (SRTM-based), coastline and land use; OSM streets, buildings, traffic and pedestrians (the
  Galata–Karaköy–Eminönü slice today, city-wide later with tiling and LOD).
- Landmarks: hand-modelled mosques, bridges, towers, palaces and fortresses at real size.
- Street layer: compiled street tiles for walkable districts (Eminönü, Kadıköy), streamed in below 80 m.
- Sky, clouds, weather presets (clear, haze, fog, rain, storm), day–night cycle; seasons planned.

### 5.3 Viewpoints (perches) — phase 03
14 viewpoints (bridge towers, Galata cap, Süleymaniye dome, Kız Kulesi, Rumeli Hisarı, the Sapphire roof, hills). Built
(`src/dragon/flight/perch.ts`, `src/ui/perch-view.ts`, `src/camera/modes/perch-rig.ts`):
- **Prompt:** within 260 m of a perch, below 44 m/s, inside a 70° cone around the direction of travel (any direction
  while hovering) and at most 160 m above / 45 m below it, the hint line offers "[L] Kon: Galata Kulesi" (it stays
  until 320 m / 52 m/s / 88°).
- **Guided approach:** L plans a curve from the current state to the perch (arrivals around the perch heading, higher
  arrivals, then detours over or around obstacles), checks it against the collision world, and flies it: the entry
  speed kept for the first part, then bled off, a flare with the wings swept forward and back-strokes limited to the
  room under the wings, the wings raised in a V for the last metres, and the feet set down exactly on the perch pose.
  Any stick, dive, brake, Space or L again aborts back into free flight; a blocked approach is refused with a toast.
- **Viewing mode:** the dragon sits (upright on its hind feet on a narrow cap, on all fours elsewhere), wings folded,
  tail wrapped aside, head up with a slow look along the view now and then, the rider relaxed. The HUD fades to the
  zones; the perch camera drifts slowly behind and beside the dragon framing the view (C: orbit → still framing →
  rider's eyes); a quiet hint line names Space (take off), T (time-lapse: the clock runs 36 game minutes a second,
  ramping in and out), O (photo) and C. Stamina refills.
- **Leaving:** Space or L. Over an edge: a drop-off (crouch, push forward, a fall with the wings still until they have
  room, then they snap open into the take-off's dive); on hills and wide tops the ground's own leap. Control is back
  within 2 s.
- **Discovery:** the first perch on a viewpoint is its discovery ("Yeni seyir noktası" with the name and info in the
  title zone; the landmark it sits on is discovered too); the map / pause menu Işınlan puts the dragon straight into
  the viewing mode.

### 5.4 Ring races — phase 13 (`src/activities/`)
- Built-in courses: Boğaz turu (under the 15 Temmuz deck), Haliç kıvrımı, Adalar turu; speed rings give a short push.
- Medals from course length (gold ≈ 42 m/s average, silver 38, bronze 32): bronze and silver are reachable with clean
  flying alone, gold needs flow (a chained run is ~6–10 % faster, checked by a scripted pilot); records, per-gate splits
  and ghost replays stored per player.
- Course editor: place gates and speed rings in flight, save, race, share as a code (`EVR1.…`).
- Screens: picker, countdown, in-race readout, result with per-gate chart, editor (design language, section 3).

### 5.5 Moments — phase 19 (`src/moments/`)
Data-driven small scenes on the map: legends (Hezarfen, Lagari, Kız Kulesi, ships over land), city life (gulls and
simit, anglers, stork migration), poems (Orhan Veli's first stanza while gliding low along the shore). Triggers by
place, altitude, time, date, weather; once per session or with a cooldown; players can switch categories off
(Ayarlar → Oyun → Anlar). Rights: no ripped media; official embeds only; stylised, original characters.
Runtime built (`src/moments/system.ts`, pure logic in `runtime.ts`): one moment at a time, rare (a global gap), never
taking control; subtitles in the lowerCenter zone fade with the glide. Playable today: the Orhan Veli poem (subtitle
only; the coastal ambience lifts in place of its sound) and the stork migration over the Bosphorus (15 Aug – 15 Oct,
09–17 h, 150–1500 m ASL: a procedural kettle of up to 400 white storks rises ahead on a real thermal the dragon can
join, then glides off south; sparse synthesised sounds). The others wait for their characters, animations and sounds.
`?moment=<id>` jumps to a moment's start and plays it once.

### 5.6 Hotbar, abilities and items
Five slots on keys 1–5 (HUD, bottom centre). Today: fire (1) and roar (2). Items and special powers register through
the `hotbar` service (icon, count, cooldown, active state, activate). The inventory is planned on top of it.

### 5.7 Discovery and progression
50 landmarks to discover (discovery card, map, pause menu counter). Medals and records per course.

**Photo album (built, `src/ui/album`).** In photo mode (O) [Enter] takes a photo of the frame as rendered (no HUD),
copied right after the render and encoded to WebP (JPEG where WebP encoding is missing) in a worker, with a 400 px
thumbnail; a short white flash and one quiet toast confirm it. Photos live only in the browser (IndexedDB, no network)
with their metadata: real date and time, in-game time of day and day, weather, camera position and angles, the named
place (a landmark in frame, else the perch, a landmark within 250 m, the district, the water body, "İstanbul"), the
camera mode before photo mode, what the dragon was doing (perched, flying, on the ground, in the water) and the sun
elevation. Storage policy: at most 60 photos and 150 MB, and never beyond 80 % of the origin's quota; when a photo does
not fit, the toast asks first ("Albüm dolu … yine [Enter]") and the oldest photos are deleted (badge photos last)
only after the new one is written. Quality (Yüksek / Dengeli / Küçük) is chosen in the album. Pause menu → **Albüm**:
a thumbnail grid (newest first, arrow keys or the mouse), one photo large with a calm caption ("Galata Kulesi · 18:42 ·
açık hava" and a quieter date line), "[Enter] İndir" (`seventeen-skies-<place>-<date>.webp`, ASCII file name),
"[Del] Sil" with a confirmation, "[Esc] Geri", ← / → for the neighbours.

**Golden-hour badges ("Altın saat", built).** A photo taken while the sun is between −4° and +6° (sunrise or sunset)
with one of 12 iconic places in the picture earns that place's badge: Galata Kulesi, Kız Kulesi, Süleymaniye, Ayasofya,
Sultanahmet, Sarayburnu (Topkapı), Galata Köprüsü, Ortaköy, 15 Temmuz Şehitler Köprüsü, Rumeli Hisarı, Fatih Sultan
Mehmet Köprüsü and Çamlıca. "In the picture" = the camera within the place's radius (1–3 km) and the landmark (or a
bridge tower) inside the view frustum; occlusion is not tested. The data (radii, aim height, anchors) is a list in
`src/ui/album/badges.ts`. Earned badges are kept locally even if the photo is deleted; the album shows "Altın saat
3/12" with a dot per place and a small gold mark on the photo that earned one; the toast names the new badge.

Planned: bond level with the dragon, unlocks (saddles, armour, dragon variants — phase 12).

### 5.8 Audio and music
Recorded CC0 wind, wingbeats, thunder, rain and gulls; synthesised fallbacks. Adaptive music (phase 07, system built,
pieces pending the owner's approval): each piece is a set of equal-length stems (piano, strings, light motion, an
Istanbul colour instrument, pads) that a small rules table fades with the flight — sparse on the ground and perched,
fuller cruising, a pulse when fast or diving, the colour low over the water, a swell in thermals, softer at night —
with silences between sets, a race set synced to "Başla!", strong ducking under moments and a muffle under water.
Settings: Müzik volume, Uyarlanabilir müzik on / off. Owner guide: `.docs/audio/music-system.md`. Regional sets
come later as tags; licences recorded per set.

### 5.9 On foot and beyond (phases 16–17, 14–15)
Walkable Kadıköy: land, walk, enter cafés, talk to NPCs, drive (street track S3–S8). Co-op moving game "Hamallar".
Multi-dragon foundation and multiplayer come after the Kadıköy slice ships.

## 6. Controls (keyboard; the in-game list is `CONTROL_HELP`)

| Group | Keys |
|---|---|
| Flight | W/S pitch, A/D roll, Q/E rudder, Space flap, Ctrl/X brake and hover, L land/take off (fast and low: run-out landing) |
| On the ground | W/S walk, Shift + W run, A/D turn, Space/L leaping take-off (running: the running leap); in a run-out Ctrl/X skid to a stop, Space touch-and-go |
| Speed and tricks | Shift fold wings (dive), Space ×2 power stroke, Shift ×2 dart when fast (free fall when slow), Q/E ×2 side-slip, A/D ×2 roll, S ×2 loop; S ×2 while banked (A/D held) wingover, A/D at the top of a loop Immelmann, A/D ×2 in a steep dive Split-S; low, fast and level over water or flat ground: surface skim (automatic) |
| Dragon and rider | F / left click fire, R roar, G pet (hold), T stand up |
| Camera and world | right mouse look, C camera, O photo mode (Enter takes a photo for the album), [ ] time of day, N weather |
| Game and interface | 1–5 hotbar, Y races (picker, cancel, editor), M map, U hide HUD, H help, Esc/P pause |

## 7. Interface

The HUD, pause menu, map, race screens and loading screen follow the locked design language
(`.docs/design/README.md`): the city is the interface, contextual reveal, key-first prompts, no caps labels, one
component library (`src/ui/components/`).

## 8. Technology and constraints

- Three.js (WebGL2) in the browser, TypeScript, Vite; systems talk only through `src/core/contracts.ts`.
- Everything procedural first; external assets only if free and licence-clean, approved by the owner, and recorded
  (CLAUDE.md). Private assets (MetaHuman, Mixamo) never enter the repository.
- Performance budget: 60 fps on "high" at 1600 × 900 on an M2 Max, dynamic resolution ≥ 0.9; street layer CPU
  ≤ 0.8 ms.
- Headless checks in `tools/headless/` (geography, perches, races, lift, clearance, moments) run without a GPU and
  guard gameplay numbers.

## 9. Roadmap

See `.docs/planning/README.md` for phases, order and effort. Current order: phase 01 fixes → street track S0–S2 →
S3–S5 (walk, enter, talk in Kadıköy) → S6 (sky to street) → S7 (drive) → S8 (chapter one). Flight-only phases (02,
03, 05–07, 13, 19) fit in between.

## 10. Open questions

- Music source and budget (phase 07).
- Commercial intent (affects music, MetaHuman terms above $1 M revenue).
- Inventory contents and which special powers exist.
- Photo album and progression rewards.
- Which films and series get moments (needs the owner's choices and official links).
