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
- **Ferry escort ("Vapur eşliği") — built** (`src/activities/escort/`): follow a ferry from pier to pier; fly with
  the gulls. No timer, no fail state, no medals.
  - *Start:* beside a vapur or city ferry in service (the moments' 'ferry' anchor kinds: underway and going ahead,
    within 120 m, direction of travel within 50° of the dragon's heading, no race) the hint line offers
    "[L] Vapura eşlik et" (`HUD_PRIORITY.escortPrompt`, joinable). L, the land key, is claimed by the escort while this offer (or the drifting note) shows (owner choice, 26 Sep; was Z; E is the
    rudder), listed in CONTROL_HELP.
  - *During:* the top zone's line under the compass (`HUD_PRIORITY.escortLine`, above the compass landmark label)
    reads "Sıradaki iskele: Kadıköy · 1,4 km" ("Vapur iskelede · Sıradaki iskele: …" alongside) with a closeness line
    (a gold dot from the ferry to the 200 m radius, warm orange while away). Within 200 m the escort goes on; beyond,
    "Vapurdan uzaklaşıyorsun · [L] Eşliği bırak" (`HUD_PRIORITY.escortNote`) after 1.5 s, and the escort ends quietly
    after 30 s away (a toast, no penalty). The ferry's gull flock follows it: `FerryGullHold`
    (`src/moments/gull-simit/actor.ts`) shares one scene per ferry between the escort and the gull-and-simit moment,
    so the moment can still play on the escorted ferry. The dragon glances at the ferry every ~9 s
    (`dragon-attention`, kind 'ferry').
  - *Arrival:* when the ferry comes alongside its next pier (`LifeService.ferryLeg`: the ferry's line, leg and phase
    from the living world's FerryService), a soft vapur horn plays at the ferry (the existing synthesised ambience
    horn as the moment cue 'ferry-horn'; no recorded asset) and the arrival card takes the corner zone with the
    discovery card's look and priority for 9 s: "Vapur eşliği", the time, "Eminönü → Kadıköy", a warm line and
    "Eşlik edilen hatlar n/24" ("Yeni hat" the first time). Records (count, best time, last date per directed leg)
    live in localStorage `evren.escort.v1` (guarded; in memory without storage). The 24 routes are the directed legs
    of the vapur and city ferry lines (sea buses excluded).
  - *Next leg:* staying along through the dwell, the escort carries on when the ferry leaves; L stops it while drifting away; landing ends it.
  - *Coexistence:* a race (context 'race' or `dragon.racing`) ends it and blocks the offer; a foreign teleport ends
    it; moments are not blocked; pause and photo mode freeze it (dt 0). No `activity` events (their listeners treat
    any started activity as a race).
  - *Debug:* `?escort=1` puts the dragon ~70 m abeam of a ferry mid-crossing, flying its heading (the offer shows);
    `?escort=start` also starts the escort; `window.__evrenEscort` (dev server, sandboxes, `?escort=`): `state()`,
    `start()`, `stop()`, `place(start?)`, `records()`, `routes()`, `clearRecords()`.
  - *Check:* `npx tsx tools/headless/escort-check.ts` (eligibility, keeping and losing with the grace period, arrival
    card, records, next leg, races; the real fleet through the life service from the ?escort= pose to the next pier
    and on to the following leg; `--quick` skips the fleet).
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
