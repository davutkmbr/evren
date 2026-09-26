# Phase 21 — The sea: low flight, plunge dives and swimming

Milestone: B · Chill loop · Effort: L · Depends on: 20 (movement; shares skim, breach and flow), water module, fx

Status: in progress (requested by the owner on 26 September 2026): stage 1 done; stage 3 built (plunge, under water, breach), awaiting the pose-sheet approval and the feel test; stage 4 built (the camera follows the dragon under
water, underwater look, waterline, droplets, underwater audio), awaiting the owner's GPU review. Stages 1–2 can start
in parallel with phase 20 stage B.

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
- **Canned vessel motion:** ships heave, pitch and roll with fixed sine amplitudes scaled by size (`fleet.ts`), not
  from the waves they sit in; wakes are parametric ribbons drawn from speed and hull size (`wakes/wake-trails.ts`),
  not from what the hull does to the water. Nothing reacts to anything else's wake.

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
- Camera: stage 3 held the chase camera's pivot at the surface line; stage 4 replaced that (the camera now follows
  the dragon under water, see "Stage 4 as built").
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

### Stage 4 as built

The owner's report: "it dives under water but we can't see under water"; the camera should go under with the dragon.

- **Camera follows under** (`src/camera/obstruction.ts`, `modes/chase.ts`, `modes/pov.ts`, `blend.ts`,
  `shots/shoulder.ts`). The camera collision has a *submerge allowance*: unlimited while the dragon is in its
  `underwater` mode (only the seabed + 1.5 m and colliders, including the vessel hull boxes, bound the eye; boom casts
  and push-outs ignore the water plane), then it starts at the eye's own depth when the dragon leaves the water and
  shrinks exponentially (3/s plus 1.2 m/s), so every camera rises back out without a jump and never lingers. Above
  water the floor is now the real wave crest at the eye (`water.heightAt`, never below y = 0), so a camera never cuts
  through a lodos swell and never flashes "under" by accident. The chase camera under water: boom 0.55 × length,
  nearly level (2.5° elevation) behind the dragon, 25 % of the flight-path pitch and 35 % of the roll-follow, 35 % of
  the acceleration lag, sinking to the lower floor at ω 6 (rising at ω 12). The boom's speed stretch is smoothed now
  (a water entry brakes the dragon by 10+ m/s within one frame, which made the boom jump ~1.5 m). POV simply rides
  along (its "never below the water" clamp follows the same allowance).
- **Under-water state** (`src/world/water/underwater/state.ts`, service `underwater` in `contracts.ts`): the camera
  height against the CPU wave height at the camera x/z (the surface the shader draws). Switches 4 cm past the surface
  in either direction, holds a switch ≥ 0.3 s unless the camera is decisively (35 cm) past it: a real plunge or breach
  switches in its frame, a lens bobbing on the waterline never flickers. `lensActive` (under, or within 0.9 m above
  the surface) gates every lens effect; `droplets` goes to 1 on a breach after ≥ 0.35 s under and fades in 1.1 s.
- **Underwater look** (`src/render/post/composite-pass.ts` `UNDERWATER_LOOK`, `shaders/composite.glsl.ts`), evaluated
  inside the existing composite pass (no extra pass, no extra scene render), branch skipped while the lens is dry:
  per pixel, the near-plane point against the local wave plane (height + normal at the camera) decides under / above,
  so the waterline crosses the lens as a clean tilted line with a thin milky wet band (the scene itself already shows
  the right side of the surface on each half, the near plane clips the surface in between); under-water pixels get the
  fog with distance (extinction 0.40 / 0.12 / 0.13 per m: green-blue, ~15–25 m visibility), the in-scattered water
  colour that darkens with camera depth and when looking down, the daylight lost on its way down to each lit point,
  caustics projected along the refracted sun, and light shafts (3 / 5 / 6 steps on medium / high / ultra, off on
  low: a shaft pattern at the point where the refracted sun ray through each sample entered the surface, so the shafts
  line up with the sun). Exposure +0.8 EV under water (the meter reads the scene before the medium). Droplets: two
  layers of refracting drops with dark rims that slide down and shrink over ~1 s after a breach.
- **Surface from below** (`src/world/water/shaders/water-fragment.glsl.ts`): the existing underside (Snell's window
  with the refracted sky and sun, total internal reflection of the water body outside it) now also switches on under a
  wave crest (`uCamUnder`), and at night the window's rim carries a faint warm glow of the city lights that shimmers with
  the wave normal. The planar reflection pass is skipped while the camera is under water.
- **Floating particles** (`src/world/water/underwater/particles.ts`): one opaque point draw (250 / 600 / 1200 / 1800
  points by quality) wrapped in a 22 m cube around the camera, drifting with the current; depth-written so the fog
  treats each mote at its own distance; hidden above water.
- **Audio** (`src/audio/master-bus.ts`, `voices/underwater.ts`, `sfx/bubbles.ts`): the air buses (sfx, wind,
  ambience, reverb) pass a new low-pass that sweeps down to 380 Hz and −5 dB under water; the wind bed keeps 3 % and
  the ambience 30 %; a synthesised water bed (breathing brown noise under 260 Hz, a 110 Hz rumble, a rush band that
  rises with speed through the water, darker with depth) plays on a new unmuffled `underwater` input, gated so it
  costs nothing above water. The stage 3 nostril bubbles (splash events of strength ≤ 0.08 while the dragon is under
  water) now play as quiet, varied bubble bloops (2–5 rising sine bloops + a gurgle; full band under water, faint
  pops from above) instead of a splash; the small surface splash visual stays. The dragon's breathing is silent while
  it holds its breath under water.
- **Performance** (estimates, no GPU here): above water nothing runs (composite branch off, particles hidden, water
  bed stopped, one CPU wave query per frame). Under water on "high" at 1600 × 900: composite branch ≈ 0.2–0.35 ms
  (≈ 150 ALU per pixel: lens plane, fog, caustics, 5 shaft steps), particles < 0.05 ms, droplets < 0.05 ms for a
  second; the underside shading is cheaper than the top side and the skipped planar reflection saves more than all of
  it. Clouds and weather HDR passes still run under water (hidden by the fog); a candidate saving if needed.
- **Checks:** `tools/headless/underwater-check.ts` (real flight sim + real chase / POV camera + real camera collision:
  plunges, breaches, a slow rise, a hull ahead, a shallow site with the camera orbited toward the seabed, lodos; no
  NaN, seabed clearance, hull boxes, per-frame jumps, level horizon, camera back out ≤ 3.5 s, under flag vs the CPU
  wave height; the state machine's switching, hysteresis, droplets; structural GLSL sanity, since no GLSL validator is
  installed).

**What the owner should look at (GPU):**

1. Plunge in the Marmara off Kadıköy by day: the camera swoops after the dragon through the surface, stays calm and
   level-ish, and the dragon stays readable at ~16 m (fog density `UNDERWATER_LOOK.sigma`, boom
   `underwaterDistance`).
2. Look up from 5–10 m: the bright Snell window, the darker total-reflection ring, shafts lining up with the sun,
   caustics on the dragon's back and the seabed in shallow water.
3. Hold at the waterline (slow surfacing into swimming, POV): a clean tilted split with a thin wet band, no flicker.
4. Breach: droplets on the lens for about a second.
5. Night: dark water, faint warm shimmer at the window's rim; no bright artefacts.
6. Sound: muffled world, wind gone, the low water bed, quiet varied bubbles instead of splashes; clean return above.
7. Cost with `?stats=1` / `?postbench=N` on "high" under water (budget ≤ 1 ms).

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
| 3 | Plunge, under-water movement, breach, safety | Plunge/breach checks pass; pose sheets approved; feel test OK |
| 4 | Underwater rendering: camera follows under, underwater look, waterline and droplets, underwater audio (built) | Owner GPU review OK; ≤ 1 ms |
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
