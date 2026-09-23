# Phase 13 — Living world: weather, seasons, events, activities

Milestone: E · Variety · Effort: L · Depends on: 01, 07

## Goal

A different Istanbul on every flight: changing weather, real natural phenomena, seasons, special days and light activities.

## Weather

- **States:** Clear, partly cloudy, overcast, rain, storm (with lightning), fog, snow.
- **Istanbul-specific:**
  - Poyraz (north-east, cool and clear).
  - Lodos (south-west, warm, rough sea — ferry services cancelled!).
  - Morning Bosphorus fog: bridge towers rise above it.
- **Effects:**
  - Cloud layer, waves, light and haze.
  - Flight turbulence and lift.
  - Audio: rain and thunder.
  - Wet-surface reflections.
- Smooth transitions over time; can be pinned in the settings.

## Natural phenomena

- **Bird migration:** Storks and raptors cross the Bosphorus in September–October; thousands of birds circling in
  thermals (linked to Phase 05).
- **Dolphins:** Pods jumping in the Bosphorus.
- **Gulls:** Gulls following ferries (exists), swarming when someone throws a simit.
- **Sea:** During bonito season, anglers on the bridge and along the shore, fishing boats.

## Seasons

| Season | Look |
|---|---|
| Spring | Judas-tree (erguvan) pink on the Bosphorus slopes in April, tulips in Emirgan |
| Summer | Bright sea, heavy boat traffic, crowded Princes' Islands |
| Autumn | Yellow and orange trees, migration, lodos storms |
| Winter | Snow-covered roofs and domes, haze, early nightfall |

## Special days and events

- Ramadan: mahya lights strung between minarets and iftar-time lights.
- New Year and 29 October: fireworks over the Bosphorus, special light shows on the bridges.
- Sailing races on the Bosphorus, the swimming marathon (Kıtalararası Yüzme Yarışı), large ship transits.

## Activities (light, chill)

- **Ring races:** Courses around landmarks (Bosphorus tour, Golden Horn bend, Islands tour), time and ghost replay.
- **Photo hunt:** Discover and photograph all 50 landmarks; an album screen; "golden hour" badges for the best shots.
- **Ferry escort:** Follow a ferry from pier to pier; fly with the gulls.
- **Guided tours:** Narrated routes (historic peninsula, Bosphorus); narration texts in Turkish.
- **Progression:** Saddles, armour and dragon species unlocked by discoveries, photos and bond level (Phase 12).

## Technical approach

- `WeatherService` (an env extension): state, transition, precipitation intensity, fog density, humidity (fx request), wave height.
- Calendar: in-game date (day, month) from the settings; season and event triggers.
- Activities: `src/activities/` (course definitions, timer, records); an activities menu in the UI.

## Acceptance criteria

- Each of the 7 weather states approved with day and night screenshots; no jumps in transitions.
- 4 seasonal looks; at least 2 special-day events.
- At least 3 playable activities; completion records persist.
- Performance: rain and snow particles ≤ 1 ms GPU; 60 fps on "high".
