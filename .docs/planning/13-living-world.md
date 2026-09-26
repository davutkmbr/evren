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
- **Dolphins:** Pods jumping in the Bosphorus (built, see [Dolphins as built](#dolphins-as-built)).
- **Gulls:** Gulls following ferries (exists), swarming when someone throws a simit.
- **Sea:** During bonito season, anglers on the bridge and along the shore, fishing boats.

### Dolphins as built

`src/world/life/dolphins/`, owned and updated by the life system (`LifeSystem.dolphins`). Pure modules (spawn rules,
pod simulation, instance fill, model) run unchanged in the headless check; `dolphins.ts` is the engine side.

- **When and where** (`spawn.ts`, `director.ts`): a spawn roll every 2 s, as a Poisson rate of about one pod every
  3.5 minutes within view, weighted by the time of day (×1.8 at 06:30–09:30, ×1 at noon, ×0.2 at night) and the sea
  state from the water service (×1.3 on a calm sea with Hs < 0.35 m, fading to none at Hs 1.7 m or a 13.5 m/s wind),
  thinned by rain (up to −60 %) and fog (−35 %), none in a storm (living pods dive and leave when one starts). At most
  two pods, at least 70 s apart, and none while the camera is above 650 m. A site is 260–900 m from the camera within
  ±70° of the view, on water at least 140 m from the shore and 8 m deep, within 4.2 km of the strait's centreline
  (the Bosphorus and the Marmara near its mouth; never the Golden Horn), at least 160 m from the traffic lanes and
  the ferry routes (a spatial hash of the lane and ferry-route polylines, `lanes.ts`) and 260 m from any vessel.
- **Motion** (`pod-sim.ts`): 3–8 dolphins (70 % short-beaked common dolphins with the hourglass pattern, 30 %
  bottlenose; a calf now and then) in a loose staggered formation with a slow wander, travelling at 2.4–4.8 m/s along
  the strait (either way), steering down the coast-distance gradient when the shore comes within 150 m. Between
  breaths they travel ~2 m down; the pod rises in group pulses every 4.5–9 s: a porpoising arc (0.3–0.8 m out), a
  slow surface roll with the back and dorsal fin showing, or (8 %) a full leap (4.8–7.4 m/s take-off, 1–1.5 s in the
  air, apex 1.2–2.8 m) with a splash. Heights are relative to the local wave surface, so every act starts and ends in
  the water. After 150–240 s the pod stops surfacing and leaves under water.
- **The dragon**: surfacings within 480 m send `dragon-attention` (kind `dolphin`, priority like a stork kettle, 2.6 s
  look, the rider points, curiosity kick); flying low (≤ 12 m over the water, or swimming) within 40 m at up to 16 m/s
  makes the pod ride beside the dragon, 11 m to the side and a little ahead (up to 14 m/s, bow-riding), for 45–80 s,
  with faster breathing pulses and 25 % leaps; then it rests 45 s. The dragon under water within 60 m, or a splash of
  strength ≥ 1.4 within 75 m (a plunge, a breach, a hard water landing), scatters the pod: they flee at ~8.5 m/s,
  deeper, without breathing, for 5–8 s, regroup over 10 s and carry on, excited (more leaps) for 30 s.
- **Look** (`dolphin-model.ts`, `dolphin-material.ts`, `dolphin-instances.ts`): procedural lofted body with beak,
  melon, dorsal fin, pectoral fins and flukes; 248 triangles near (< 140 m), 43 far (to 1.4 km); one instanced mesh
  per LOD (two draws), the tail beat bending the rear body in the vertex shader, countershading and the species'
  pattern in the fragment shader, wet-skin roughness. Deep dolphins are skipped for a camera above the water beyond
  70 m. No meshes are in the scene while no pod is alive; an idle frame costs a timer decrement (0.5 µs measured).
- **Water effects**: splashes use fx's new `worldSplash` (the one-shot splash without the dragon's skim-contact
  bookkeeping), the water's foam and a small wave-particle ring; breaths and leap exits a small puff and ring.
- **Discovery**: the first surfacing within 130 m of the camera shows the toast "Yunuslar!" once per player
  (localStorage `evren.nature.dolphins.seen.v1`), not during a race. No moment record (moments are being reworked);
  follow-up: offer the pods as an optional moment anchor or actor ("Boğaz'da yunuslar") once the rework lands.
- **Sound**: the owner wants real recordings only. `dolphinCue('whistle' | 'breath' | 'splash')` in the audio engine
  plays the `dolphin/*` sprites of the audio manifest (a partial sample group: each approved file works on its own);
  until then only the leap splash sounds (the generic water splash). Shortlist pending approval:
  `.docs/assets/candidates/dolphin-sounds.md`.
- **Debug**: `?dolphins=near` keeps a pod near the dragon (a new one 5 s after the last left), `?dolphins=often`
  spawns 12× as often, `?dolphins=off` disables them; `window.__dolphins.near()` in dev.
- **Check**: `npx tsx tools/headless/dolphins-check.ts` (spawn rates and sites on the real geography with the real
  ferry routes and fleet, pod motion over a full life on the real sea, company and scatter, the engine side with a
  stubbed engine including the idle cost, the toast and the gaze, determinism, budget: two pods of 8 ≈ 16 µs a frame).

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
    "[Z] Vapura eşlik et" (`HUD_PRIORITY.escortPrompt`, joinable). Z is the input button `escort` (free key; E is the
    rudder), listed in CONTROL_HELP.
  - *During:* the top zone's line under the compass (`HUD_PRIORITY.escortLine`, above the compass landmark label)
    reads "Sıradaki iskele: Kadıköy · 1,4 km" ("Vapur iskelede · Sıradaki iskele: …" alongside) with a closeness line
    (a gold dot from the ferry to the 200 m radius, warm orange while away). Within 200 m the escort goes on; beyond,
    "Vapurdan uzaklaşıyorsun · [Z] Eşliği bırak" (`HUD_PRIORITY.escortNote`) after 1.5 s, and the escort ends quietly
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
  - *Next leg:* staying along through the dwell, the escort carries on when the ferry leaves; Z stops it any time.
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
