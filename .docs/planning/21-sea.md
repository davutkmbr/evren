# Phase 21 — The sea: low flight, plunge dives and swimming

Milestone: B · Chill loop · Effort: L · Depends on: 20 (movement; shares skim, breach and flow), water module, fx

Status: planned (requested by the owner on 26 September 2026). Stages 1–2 can start in parallel with phase 20
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
- Collisions with ships and piers under water: the collision world has their hulls only above water; add simple
  underwater hull boxes for vessels before stage 3 ships.
