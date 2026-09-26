# Phase 21 — The sea: low flight, plunge dives and swimming

Milestone: B · Chill loop · Effort: L · Depends on: 20 (movement; shares skim, breach and flow), water module, fx

Status: in progress (requested by the owner on 26 September 2026): stage 1 done; stage 3 built (plunge, under water, breach), awaiting the pose-sheet approval and the feel test; stage 7b built (vessels as floating rigid bodies), awaiting the owner's look in game. Stages 1–2 can start in parallel with phase 20
stage B; stage 4 (underwater rendering) needs GPU review by the owner.

## Goal

Istanbul is a city on the water; the dragon should treat the sea as a place, not a floor. Flying low should change
the water under you, the dragon should be able to plunge in and burst out, and swimming should feel like a big
animal in real waves. All of it calm and optional, and some of it useful to a skilled racer.

## Current state

- **Physics** (`src/dragon/flight/airborne.ts`, `locomotion.ts`): the sea is a flat plane at y = 0. Skimming applies
  hydrodynamic drag, planing lift and spray (`applyWaterSkim`); slow or deep contact turns into `swimming`: a float
  at a fixed depth with a synthetic bob, paddling, splashes; depth is clamped at −2.5 m (no diving). Ground effect
  lift exists below ~60 m.
- **Rendering** (`src/world/water/`): Gerstner waves plus detail bands on the GPU, sea regimes (poyraz / lodos, swell)
  computed per frame on the CPU (`sea-state.ts`), planar reflection. Nothing reacts to the dragon except fx splashes.
- **Life** (`src/world/life/`): ferries, boats and ships with Kelvin wakes (`wakes/`), gulls.
- **Mismatch:** the dragon floats and skims on a flat plane while the rendered surface moves with waves up to a few
  metres in lodos.
- **Vessel motion** (stage 7b): every vessel is a floating rigid body on the real waves (`vessels/physics/`); wakes
  are still parametric ribbons drawn from speed and hull size (`wakes/wake-trails.ts`), not from what the hull does
  to the water (7a). Small hulls feel the wakes of passing ships through an analytic Kelvin pattern until wave
  particles exist.

## Strand 1 — One sea for physics and pictures

- A CPU wave evaluator that uses the **same** wave set, phases and regime as the shader (`sea-state.ts` already
  computes them in double precision): `heightAt(x, z)`, `normalAt(x, z)`, `velocityAt(x, z)` (orbital velocity),
  plus the Bosphorus surface current (north → south, stronger in the narrows).
- Plus the **dynamic part** of strand 7 (wave particles from hulls, the dragon and splashes): `heightAt` returns the
  sum, so everything floats on the same water.
- Published through a new `water` service in `contracts.ts` (owned by the water module). Flight, fx, life and the
  camera use it instead of y = 0.
- A headless parity test: sample the CPU evaluator against a JS port of the shader formula at many points and
  times (max error < 2 cm).

## Strand 2 — Flying low over the sea

| Effect | What happens | Where |
|---|---|---|
| **Downwash** | Below ~12 m the wing beats flatten and ruffle a ring of water under the dragon; each downstroke pushes a gust ring outward; spray lifts at the ring's edge in strong beats | water shader: a small dynamic ripple texture (128², ≈ 60 m) that follows the dragon; fx spray |
| **Skim wake** | Skimming (phase 20) leaves a V wake and a foam line that fades; the tail and claws can trail | reuse the vessel wake trails for the dragon |
| **Wingtip vortices** | In a fast low pass, two thin spray curls from the wingtips | fx |
| **Claw dip** | Low and slow over water, L dips the claws (a touch-and-go on the water); in bonito season it can snatch a fish (a moment) | flight + moments |
| **Reactions** | Gulls lift off the water ahead; fish schools flash and scatter under the surface; boats' crews wave | life, moments |
| **Fire on water** | The fire jet hitting the sea throws a steam cloud and a hiss | fx, audio |
| **Sound** | A rushing water layer that grows with low speed over the sea, spray hits, the downwash roar | audio |

Ground-effect lift keeps working and becomes the physical basis of **sıyırma** (phase 20).

## Strand 3 — Plunge dive and breach

- **Plunge ("dalış"):** diving steeply into the sea with folded wings (Shift, aimed down) enters the water instead of
  splashing to a stop: a tall splash column and a crown of spray, a thud and muffled sound, the camera follows
  under. Momentum carries the dragon down 5–15 m depending on entry speed and angle; buoyancy and wing sculling
  bring it back.
- **Under water (a few seconds):** steer with the usual keys, Space strokes (a strong wing sweep), air (stamina)
  drains slowly; bubbles stream from the nostrils; the rider holds on.
- **Breach ("fırlama"):** Space near the surface, or rising fast, bursts out: the body clears the water, the wings snap
  open throwing a sheet of spray, and the dragon climbs away keeping part of its underwater speed. A plunge + breach is
  a flow move (phase 20) and a legitimate way to reverse or change height fast.
- **Safety:** a plunge is refused (with the existing hint) or turns into a hard skim over shallow water (bathymetry
  from geo: the seabed height), near ships, piers and the shore. The dragon never gets stuck: after a time limit or
  at low air it surfaces on its own.

### Stage 3 as built

- Code: `src/dragon/flight/underwater.ts` (plunge look-ahead, entry, the `underwater` flight mode, breach), tunables in
  the `PLUNGE` block of `params.ts`; hooks in the dive floor (`controller.ts`: an armed, clear plunge removes the
  water clearance), the free fall's automatic catch (`maneuvers.ts`: waits while plunging) and the water skim
  (`airborne.ts`: a steep folded contact plunges; the skim leaves a breaching body alone for `PLUNGE.exitGrace`).
- Fit water: seabed ≥ 6 m down at the entry and along the next 20 m, up to 5 m more at the entry for steeper entries
  (the 18 m body goes in head first); no hull, pier or quay within 12 m; the coastline ≥ 30 m away. Refusals hint
  ("Burası dalış için çok sığ", "Gemiye çok yakın, dalış yok", "İskeleye / Kıyıya / Yapıya çok yakın, dalış yok").
- Under water: streamlined drag with the wings folded, a half-open wing brake when hands-off and fast (plunge depth
  5–13 m from 22–80 m/s and −38° to −88°), buoyancy + sculling bring it up in 5–9 s; Space strokes (~14 m/s peaks);
  surfacing on its own after 9 s or at low air; soft pushes out of the seabed and structures, an escape toward open
  water from under a hull. Bubbles are small splashes where they reach the surface (true underwater bubbles: stage 4).
- Breach keeps 60 % of the underwater speed (at least 8 m/s, climbing at least 7 m/s) into the take-off climb.
- Vessel hulls: `src/world/life/vessels/hull-colliders.ts` registers one underwater box per vessel within 900 m of the
  dragon (tag `vessel`, top just below the surface) and re-places it every frame (`CollisionWorld.move`).
- Camera (until stage 4): the chase camera holds its pivot at the surface line above the dragon (1 m under it) and
  stops following the underwater pitch and acceleration, so it follows the dragon's track just above the water with a
  level horizon instead of diving after it or swinging with every pitch change under water.
- Flow hooks: 'maneuver' events 'plunge' ("Dalış") and 'breach' ("Fırlama", with `clean`); the plunge's end is a
  flight-internal event with `ended` and `clean` (no seabed / hull contact, not surfaced by force). The game-level
  `GameEvents['maneuver']` carries id and label only; flow in phase 20 needs an optional `clean?: boolean` there (or
  to live in the flight module, which already has it).
- Checks: `tools/headless/plunge-check.ts`; pose strips `plunge`, `underwater`, `breach`.

## Strand 4 — Seeing under water (GPU review needed)

- Camera below the surface: underwater fog with depth, a blue-green tint that darkens with depth, light shafts from
  the surface, the surface seen from below (the bright Snell window, refracted sky), floating particles.
- The surface line crossing the camera: a clean split with a thin wet band, droplets on the lens after a breach
  (post pass, short).
- Night: dark water, city lights shimmering from below.
- Budget: ≤ 1 ms GPU on "high" while under water, zero cost above water.

## Strand 5 — Swimming, reworked

- **Rides real waves:** floats on `heightAt`, pitches and rolls with `normalAt`, is carried by the current and by
  passing ferries' wakes (the wake system gives heights too).
- **Gaits:** slow paddle (legs), fast swim (wing sculling with the wings half open, like a cormorant), rest (floating,
  wings folded, head up, occasional shake of the head).
- **Short dive from the surface:** Ctrl ducks under for a few seconds (same under-water rules), Space surfaces.
- **Take-off from water:** a running take-off on the surface: wing beats slapping the water with rows of splashes,
  like a swan, longer in rough seas; or a breach take-off after a dive.
- **Leaving the water:** a shake-off (spray burst from the wings and the neck), a wet sheen on the scales that dries in
  ~20 s (material parameter), drips while flying low.
- **Company:** gulls land on the floating dragon's back; boats give it room (vessel agents treat the swimming dragon
  as an obstacle); anglers on the Galata Bridge react (moments).

## Strand 6 — Weather and the sea

- Lodos: big waves, spray blown off crests, harder water take-offs, the dragon rocks more while swimming.
- Poyraz: choppy, cold light; fog banks sitting on the water in the morning (phase 13).
- Rain: rings on the water; storms: whitecaps everywhere.

## Strand 7 — A physical sea: vessels, wakes and foam from the simulation

Owner's requirement: ships floating, the waves, the ships' motion in the waves, the wake and the foam behind a ship
must not be canned effects; they come from the physics of the moment, and performance stays within budget.

### 7a. The wave field = spectrum + interactive part
- **Ambient sea:** the existing Gerstner set, driven by the sea regime (wind speed, fetch, poyraz/lodos direction,
  swell). Keep it, but derive its amplitudes and periods from a wind-wave spectrum (JONSWAP-style, fetch-limited in the
  Bosphorus and the Marmara), so the sea state follows the wind physically.
- **Interactive part: wave particles.** Every disturbance (a hull pushing water, the dragon's downwash and skim, a
  plunge, a breach, a splash) emits wave-front particles that travel with the deep-water group speed, spread and lose
  amplitude with distance. A moving hull emits them continuously along its waterline, so the **bow wave, the stern wave
  and the Kelvin pattern emerge** from the hull's speed and length (the 19.5° wedge for displacement hulls, a narrower
  wake as planing hulls speed up) instead of being drawn. Particles are cheap on the CPU (they can be queried for
  buoyancy) and splatted into a height/normal texture on the GPU for rendering.
- **Crossing wakes interact:** a ferry's wake reaches a small boat, and the boat rolls because the water under it
  really rises; the dragon swimming in a wake bobs the same way.

### 7b. Vessels as floating rigid bodies
- Each vessel gets a simplified 6-DOF rigid body: mass, inertia and a set of hull sample points generated from its hull
  model (`hull.ts`: 8–24 points on the waterline and keel, more for long hulls).
- **Buoyancy** from the water height at each point (displaced volume, Archimedes), **damping** from hull drag, **wind
  heel** from the superstructure's side area, **propulsion and rudder as forces**: the existing navigation keeps
  choosing speed and heading, a controller turns them into thrust and rudder force, the body does the rest (turning
  heel, squat, trim).
- **Planing craft** (speedboats, small launches) get dynamic lift with speed: they rise, trim bow-up, slam in waves.
- Natural periods and stability come from the hull shape (metacentric height), so a ferry rolls slowly and a caique
  bounces; nothing capsizes in lodos (checked).
- Moored and anchored boats ride the same water on springs (mooring lines / anchor chain), swinging to wind and current.

### Stage 7b as built

**Code** (`src/world/life/vessels/physics/`):
- `hull-data.ts`: one design record per vessel kind (freeboard, waterplane and vertical prismatic coefficients,
  design GM, radii of gyration, added mass, damping ratios, quadratic roll damping, propulsion / steering sizing,
  planing data, double-ender and catamaran flags) and `buildHullBody`, which derives the buoyancy columns (2 per
  station, 3–6 stations: 6–12 columns on the port / starboard lines that reproduce the waterplane's second moment),
  mass from the displaced volume at the equilibrium draft (ballast ships: design draft minus their lift), KB, KG
  (= KM − design GM), GM / GM_L at the actual draft, inertias, stiffnesses, damping and the linear natural periods.
  Column volume law: A·T·Cvp·(d/T)^(1/Cvp) below the design waterline (so Cvp and KB = T/(1+Cvp) come out right),
  wall-sided above it, nothing more once the deck edge is under.
- `rigid-hull.ts`: the body. Heave, roll and pitch from the column forces on the sampled water (plus the KG − KB
  heeling term, heave damping relative to the water's vertical velocity, linear + quadratic roll damping); surge,
  sway and yaw in body axes with added masses (Coriolis / Munk coupling), thrust, rudder / thruster yaw moment
  (rudder authority ∝ speed², thrusters fading out above 1–3 m/s), a rudder side force at the stern, longitudinal
  drag, lateral drag = slender-body lift ∝ speed × sway plus cross-flow drag (much higher than longitudinal), all
  through the water (current included). Turning heel (outward; inward once planing), planing lift and bow-up trim,
  a little squat trim for displacement hulls. The steering controller follows the navigation reference: wanted
  ground velocity = route speed + a pull onto the reference point, taken through the water (crab into the current,
  up to 57°), course control with drift compensation (the bow leads by the hull's slip in a turn), thrust from the
  drag feed-forward, yaw rate from the heading error plus the reference's yaw rate. Alongside, at anchor or paused:
  a soft, well-damped mooring spring (8–30 s period, damped against the ground) to the reference pose. Impulses
  (splashes, the dragon) change the heave / roll / pitch / plane / yaw rates.
- `vessel-physics.ts`: the fleet's physics. Level of detail by camera distance (8 % hysteresis): **full** (≤ 1.5 km:
  every column; water refreshed at 30 Hz within 600 m and 12 Hz beyond, heights extrapolated with their rate in
  between), **mid** (≤ 4 km: heave from 3 samples at 6 Hz, roll and pitch settle), **kinematic** beyond. Fixed step
  1/60 s (at most 8 per frame), water refreshes on the step clock (frame-rate independent) and staggered across the
  fleet, render poses interpolated between the last two steps. Safety net: a body much nearer the shore than its
  reference, or beyond its leash (max(60 m, 1.5 L); free-roaming craft max(6 m, 0.3 L)), is eased back onto the
  reference (free-roaming craft re-plan from where the hull is instead); lane respawns teleport. The navigation
  waits for a hull that lags behind its reference (a speed cap; the traffic rules' own cap is untouched). A
  double-ender swaps ends while held. Non-finite states reset the body (never seen in the checks).
- Interactions: `splash(x, z, strength)` (subscribed to the `splash` event in `life-system.ts`: skims, plunges,
  breaches, bubbles) lifts the near side of hulls within 6·(1 + strength) m and pushes them away;
  `contact(pos, vel)` (the dragon, every frame): landing on a small hull (from above, descending) presses it down at
  the contact point, bumping into one pushes it; momentum exchange with the reduced mass (dragon 1600 kg), 0.8 s
  cooldown per hull. Passing wakes: moving hulls ≥ 20 m at ≥ 2 m/s add an analytic Kelvin pattern (cusp lines at
  19.5°, transverse wavelength 2πU²/g, amplitude from length and Froude number, decaying astern) to the water under
  hulls < 35 m; wave particles replace it in 7a.
- `fleet.ts`: the behaviours still run first and produce the reference (`vessel.state`, unchanged for the traffic
  rules); the render pose is the body's (`vessel.x/z/yaw/heave/roll/pitch`), used by the renderer, wakes, lights,
  gulls and `hull-colliders.ts` (the box follows position, heading and heave; its bottom follows the lowest keel
  corner of the tilted hull and its centre the tilted underwater middle; the collision world's boxes stay yawed
  only, `collision.ts` is unchanged). No shader changes.

**Hull table** (design draft; linear natural periods, the free-decay test agrees within 1 %):

| Model | L × B × T (m) | Columns | Mass (t) | KG (m) | GM (m) | Heave (s) | Roll (s) | Pitch (s) |
|---|---|---|---|---|---|---|---|---|
| vapur | 72 × 13.2 × 3.1 | 10 | 1740 | 5.34 | 1.60 | 4.3 | 9.2 | 4.5 |
| ferry (double-ender) | 41.7 × 9.6 × 2.0 | 10 | 473 | 4.03 | 1.35 | 3.5 | 7.3 | 3.6 |
| seabus (catamaran) | 38.5 × 11.2 × 1.35 | 8 | 204 | 4.76 | 15.5 | 2.5 | 2.8 | 2.4 |
| tour | 30 × 7.2 × 1.6 | 8 | 193 | 2.92 | 0.95 | 3.1 | 6.5 | 3.2 |
| tug | 26 × 9.5 × 3.4 | 8 | 494 | 3.03 | 1.50 | 4.5 | 6.8 | 4.6 |
| pilot | 16 × 4.8 × 1.2 | 6 | 44 | 1.36 | 1.20 | 2.4 | 3.9 | 2.4 |
| motorboat | 8.5 × 2.8 × 0.55 | 6 | 6.2 | 0.59 | 1.10 | 1.6 | 2.4 | 1.6 |
| fishing | 9.5 × 3.2 × 0.8 | 6 | 11 | 0.75 | 0.90 | 2.0 | 3.0 | 2.0 |
| sailboat | 13 × 4.1 × 0.8 | 6 | 17 | 1.00 | 1.60 | 1.9 | 3.3 | 1.9 |
| seiner | 28 × 7.6 × 2.4 | 8 | 293 | 2.64 | 1.00 | 3.7 | 6.7 | 3.9 |
| yacht | 24 × 6 × 1.6 | 8 | 110 | 2.01 | 1.20 | 2.8 | 4.8 | 2.9 |
| tanker-a / b | 183–228 × 32.2 × 11.6–13.2 | 12 | 53 000–75 000 | 11.1 | 2.30 | 9.7–10.3 | 17.4 | 9.2–9.8 |
| tanker-c | 118 × 19.6 × 7.2 | 12 | 12 900 | 5.83 | 2.30 | 7.6 | 10.6 | 7.3 |
| container-a / b | 172–222 × 27.4–32.2 × 9.6–11.2 | 12 | 31 000–55 000 | 10.2–12.2 | 1.60 | 8.5–9.2 | 17.8–20.9 | 8.4–9.0 |
| bulk-a / b | 180 × 30 × 10.4; 146 × 23.6 × 9.1 | 12 | 43 600; 24 300 | 9.7; 7.0 | 2.80 | 9.2; 8.6 | 14.7; 11.6 | 8.7; 8.1 |

**Tunables:** `HULL_DESIGNS` in `hull-data.ts` (per kind: `gm` sets KG and the roll period, `zetaRoll` / `rollQuad`
how fast rolling dies out and how big it gets in a seaway, `vmax` / `accel` / `yawRate` / `thrusters` the propulsion
and steering authority, `planing` lift and trim); `VESSEL_PHYSICS` in `vessel-physics.ts` (step, LOD ranges, water
refresh rates, leashes, dragon mass, splash impulse and reach, wake source / target sizes); `CRAB_MAX` /
`DRIFT_MAX` in `rigid-hull.ts`.

**Checks** (`tools/headless/vessels-check.ts`, `--quick` for shorter fleet runs): free-decay periods within ±15 % of
the formulas (they agree within 1 %) and roll periods in range for the size; righting arm positive at every heel to
30° (GZ at 30° from 0.17 m, tour, to 1.5 m, seabus); equilibrium draft exact (±10 % allowed), ballast drafts too; a
lodos of U10 18 m/s (beyond the game's 16 m/s cap; Hs 2.2 m): max roll motorboat 25°, fishing 22°, ferry 14°, vapur
7°, tanker 1.4°, nothing capsizes; the high-preset fleet for 25 simulated minutes with every hull physical:
route-bound cross-track p95 0.2–3 m (max 8.7 m, vapur / seabus in the current), free-roaming craft within their
leash, 24 of 24 ferry arrivals alongside (2 m, 3°) after 7.5 s median / 11.5 s max, ≤ 2 m while alongside, no hull
ever nearer the land than its reference, no resets; a dragon landing on a fishing boat / motorboat / sailboat rocks
it 6° / 9° / 3° and it settles; a plunge splash 4 m off a motorboat rolls it 5°; a vapur's wake rocks a fishing boat
80 m off (1.7° rms, 0 in calm water); the ultra fleet (138 vessels) with the camera at Karaköy: physics 0.12 ms avg /
0.17 ms p95 at 60 fps, 0.26 / 0.36 ms at 24 fps (every hull forced onto the full body: 0.82 ms avg); the same motion
at dt 1/24, 1/60 and 1/144 (roll within 1.4°, position within 0.25 m after 60 s in a lodos) and no NaNs with
jittered frame times. Node timings; the browser should be similar (plain JS, no allocations per frame).

**What the owner should look at (GPU, in game):**
- Ferries crossing to Kadıköy / Üsküdar in a lodos (`?wu10=14`): a slow 7–9 s roll, heave and pitch on the swell, a
  little outward heel in turns, crabbing against the Bosphorus current; docking (they come alongside and hold on a
  soft spring) and the double-enders leaving with the other end first.
- Small boats (fishing, motorboats, sailboats) bobbing quickly (2–3 s) and following the wave slope; a motorboat
  planing bow-up; fishing boats rocking as a vapur's wake reaches them.
- Fly low and splash or plunge next to a moored boat, or swim into one: it should rock and settle.
- Anchored ships swinging slowly with their hulls barely moving; ballast ships riding high.
- LOD changes 1.5 km / 4 km from the camera: roll and pitch fade in and out there by design; report any pop.

Not built in 7b: wind heel from the superstructure's side area, slamming, moored boats swinging on real mooring-line
geometry (they sit on a spring at their spot), roll / pitch of the underwater hull boxes (they stay yawed boxes),
wave particles from hulls (7a replaces the analytic wake push).

### 7c. Foam and spray from the water's state
- **Foam** is generated where the simulated surface breaks (steepness / surface compression above a threshold: wave
  crests in lodos, the bow wave, the crest of a wake), where the propeller churns the water (source strength from
  thrust) and where anything hits the water. It is **advected** with the surface flow and decays over tens of seconds,
  in a world-space foam texture that scrolls with a moving window around the camera, so a ship leaves a persistent
  white trail that bends when it turns and spreads and fades behind it.
- **Spray** particles are emitted from the same breaking events (bow slamming into a wave, the dragon's plunge),
  their amount from the local energy, not from fixed timers.

### 7d. Level of detail and budgets
| Range | Wave field | Vessels | Foam |
|---|---|---|---|
| near (≤ 600 m) | spectrum + wave particles, full splat resolution | full rigid body, all hull points | full foam texture |
| mid (0.6–2 km) | spectrum + wave particles at lower splat density | 4-point rigid body (bow, stern, both beams) | coarse foam |
| far (> 2 km) | spectrum only | analytic response to the spectrum (transfer functions from the same hull data) | analytic wake line tinted into the water shader, parameters from the same hull |

Budgets on "high" (M2 Max, 1600 × 900): vessel physics ≤ 1.0 ms CPU for everything within 2 km (a worker if needed),
wave particles ≤ 0.5 ms CPU, splatting ≤ 0.4 ms GPU, foam ≤ 0.3 ms GPU. The current canned motion and ribbons stay
only as the far LOD and as a fallback on "low".

### 7e. Verification (mostly headless)
- Natural heave and roll periods of each vessel class against the textbook formulas from its hull data (±15 %).
- No capsizing and bounded roll in the strongest lodos; moored boats stay within their lines.
- Measured wake half-angle ≈ 19.5° for displacement hulls at low Froude numbers, narrowing with speed for planing
  hulls; wake height decaying with distance.
- A small boat crossing a ferry's wake rolls more than in calm water (interaction exists).
- Energy check: wave particles never gain amplitude; particle count and CPU time stay within budget with the full fleet.
- Timings measured in Node for the CPU parts; GPU parts reviewed by the owner.

## Racing tie-ins

- Water gates close to the surface reward skims; a plunge + breach can shortcut a vertical reversal.
- Flow (phase 20): skim held through a speed ring, a clean breach, a claw dip at a gate count as timing bonuses.

## Controls

| Gesture | Action |
|---|---|
| Shift, steep toward the sea | plunge dive |
| Space under water / near the surface | stroke / breach |
| L low and slow over water | claw dip (touch-and-go on the water) |
| Swimming: Ctrl | duck under |
| Swimming: Space | surface; hold for a water take-off run |

## Tooling and verification

- **Parity test** for the CPU wave evaluator (strand 1).
- **Flight checks** (`movement-check.ts`): skim distance and speed loss; plunge depth vs entry speed and angle;
  breach exit speed and height; water take-off distance per sea state; swim drift in the current; refusals over
  shallow water.
- **Pose strip:** scenarios `swim`, `swim-fast`, `water-takeoff`, `plunge`, `breach`, `claw-dip`, `shake-off`.
- **Owner review on a GPU:** downwash ripples, wakes, spray, steam, the underwater look (strand 4), feel.

## Stages

| Stage | Content | Done when |
|---|---|---|
| 1 | Water service with the CPU wave evaluator; dragon floats and skims on real waves; current | Parity test passes; swim/skim checks pass |
| 2 | Low flight: downwash ripples, skim wake, wingtip curls, fire steam, water sound | Owner GPU review OK; budget met |
| 3 | Plunge, under-water movement (camera stays above for now), breach, safety | Plunge/breach checks pass; pose sheets approved; feel test OK |
| 4 | Underwater rendering | Owner GPU review OK; ≤ 1 ms |
| 5 | Swimming rework: gaits, duck under, water take-off run, shake-off, wet sheen, company | Checks and sheets approved; feel test OK |
| 6 | Weather coupling and race/flow tie-ins | Race balance report; feel test OK |
| 7a | Wind-wave spectrum; wave particles (CPU + GPU splat), fed by hulls, the dragon and splashes | Wake-angle and energy checks pass; budgets met; owner GPU review |
| 7b | Vessels as floating rigid bodies with LOD; propulsion/rudder forces; moorings | Period, stability and interaction checks pass; CPU ≤ 1 ms |
| 7c | Foam and spray from breaking, propellers and impacts; advected foam texture | Owner GPU review; ≤ 0.3 ms |

## Risks

- Physics/visual mismatch is worse than no feature: strand 1 comes first and the parity test gates the rest.
- Underwater rendering is GPU-heavy and cannot be judged headless: keep it behind stage 4 and owner review.
- Physical vessels change traffic behaviour (slower turns, drift): the navigation controller must be retuned so ferries
  still dock on time; the old kinematic path stays available as a fallback per vessel class.
- Collisions with ships and piers under water: vessels had no colliders at all; stage 3 added underwater hull boxes
  (above the water ships still have none: a skimming dragon passes through their upper works).
