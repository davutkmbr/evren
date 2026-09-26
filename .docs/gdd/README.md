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
- Tricks: barrel roll, loop, free fall with a wing-snap catch, the "dehh" urge.
- Assisted hands-off flight: the dragon holds a safe clearance, climbs over what it cannot pass, **passes under**
  bridges and overhangs that leave room, and with a speed-scaled look-ahead (150–600 m) climbs over or turns away
  from towers. Player input always wins.
- Wind field: environment wind, gusts, **thermals** (sun, land use, slopes, summits) and **ridge lift**
  (poyraz and lodos on the Bosphorus slopes).
- Rider: every command shows on the rider; petting, standing, the dragon's gaze back. Humans are MetaHuman +
  Mixamo (private asset store).
- Hooks for other systems: `addVelocity` (speed rings, powers), `requestRoar`, `fireBurst`.
- Planned (phase 20): run-out landings and touch-and-go, leaping take-offs, new air moves (power stroke, dart,
  wingover, Immelmann / Split-S, side-slip, surface skim) and a flow system that rewards clean chains with capped
  speed — the skill ceiling for races.
- Planned (phase 21): the sea as a place — physics on the real waves, downwash and wakes when flying low, plunge
  dives and breaches, reworked swimming (waves, currents, water take-off runs, short dives), underwater view.

### 5.2 The world (`src/world/`, `tools/world-compiler/`)
- Real relief (SRTM-based), coastline and land use; OSM streets, buildings, traffic and pedestrians (the
  Galata–Karaköy–Eminönü slice today, city-wide later with tiling and LOD).
- Landmarks: hand-modelled mosques, bridges, towers, palaces and fortresses at real size.
- Street layer: compiled street tiles for walkable districts (Eminönü, Kadıköy), streamed in below 80 m.
- Sky, clouds, weather presets (clear, haze, fog, rain, storm), day–night cycle; seasons planned.

### 5.3 Viewpoints (perches) — phase 03
14 viewpoints (bridge towers, Galata cap, Süleymaniye dome, Kız Kulesi, hills). Perch, watch in a slow cinematic
orbit, time-lapse the sunset, open photo mode, drop off to fly again. Data and service exist (`perches`); landing and
the viewing mode are next.

### 5.4 Ring races — phase 13 (`src/activities/`)
- Built-in courses: Boğaz turu (under the 15 Temmuz deck), Haliç kıvrımı, Adalar turu; speed rings give a short push.
- Medals from course length (gold ≈ 44 m/s average, silver 38, bronze 32); records, per-gate splits and ghost
  replays stored per player.
- Course editor: place gates and speed rings in flight, save, race, share as a code (`EVR1.…`).
- Screens: picker, countdown, in-race readout, result with per-gate chart, editor (design language, section 3).

### 5.5 Moments — phase 19 (`src/moments/`)
Data-driven small scenes on the map: legends (Hezarfen, Lagari, Kız Kulesi, ships over land), city life (gulls and
simit, anglers, stork migration), poems (Orhan Veli's first stanza while gliding low along the shore). Triggers by
place, altitude, time, date, weather; once per session or with a cooldown; players can switch categories off
(Ayarlar → Oyun → Anlar). Rights: no ripped media; official embeds only; stylised, original characters.

### 5.6 Hotbar, abilities and items
Five slots on keys 1–5 (HUD, bottom centre). Today: fire (1) and roar (2). Items and special powers register through
the `hotbar` service (icon, count, cooldown, active state, activate). The inventory is planned on top of it.

### 5.7 Discovery and progression
50 landmarks to discover (discovery card, map, pause menu counter). Medals and records per course. Planned: photo
album and "golden hour" badges, bond level with the dragon, unlocks (saddles, armour, dragon variants — phase 12).

### 5.8 Audio and music
Recorded CC0 wind, wingbeats, thunder, rain and gulls; synthesised fallbacks. Regional, layered music is planned
(phase 07); licences recorded per track.

### 5.9 On foot and beyond (phases 16–17, 14–15)
Walkable Kadıköy: land, walk, enter cafés, talk to NPCs, drive (street track S3–S8). Co-op moving game "Hamallar".
Multi-dragon foundation and multiplayer come after the Kadıköy slice ships.

## 6. Controls (keyboard; the in-game list is `CONTROL_HELP`)

| Group | Keys |
|---|---|
| Flight | W/S pitch, A/D roll, Q/E rudder, Space flap, Ctrl/X brake and hover, L land/take off |
| Speed and tricks | V urge, Shift fold wings (dive), A/D ×2 roll, S ×2 loop |
| Dragon and rider | F / left click fire, R roar, G pet (hold), T stand up |
| Camera and world | right mouse look, C camera, O photo mode, [ ] time of day, N weather |
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
