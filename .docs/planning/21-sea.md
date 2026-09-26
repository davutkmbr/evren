# Phase 21 — The sea: low flight, plunge dives and swimming

Milestone: B · Chill loop · Effort: L · Depends on: 20 (movement; shares skim, breach and flow), water module, fx

Status: in progress (requested by the owner on 26 September 2026): stage 1 done; stage 2 built (the sea reacts to low
flight), awaiting the owner's GPU review; stage 3 built (plunge, under water, breach), awaiting the pose-sheet approval
and the feel test; stage 4 built (underwater camera, look and audio), awaiting the owner's GPU review; stage 5 swimming
part built, awaiting the pose-sheet approval and the feel test; stage 7b built (vessels as floating rigid bodies),
awaiting the owner's look in game; stage 7a built (wind-wave spectrum, wave particles), awaiting the owner's GPU
review; stage 7c built (foam and spray from the water's state), awaiting the owner's GPU review; stage 6 built (the
weather and the sea: storm seas, rocking in waves, rough-sea take-offs, rain rings, sea fog banks), awaiting the owner's
GPU review and feel test.

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
  computed per frame on the CPU (`sea-state.ts`), planar reflection. Since stage 2 a disturbance field under a
  low-flying dragon (downwash, skim wake, vortices, steam) adds ripples, roughness and foam.
- **Life** (`src/world/life/`): ferries, boats and ships with Kelvin wakes (`wakes/`), gulls.
- **Mismatch:** the dragon floats and skims on a flat plane while the rendered surface moves with waves up to a few
  metres in lodos.
- **Vessel motion** (stage 7b): every vessel is a floating rigid body on the real waves (`vessels/physics/`).
- **Wave field** (stage 7a): the Gerstner amplitudes come from a fetch-limited JONSWAP spectrum of the wind; hulls,
  the dragon and splashes emit wave particles that the water service adds to every query and the surface draws from a
  splat window, so the Kelvin wakes are real water other hulls and the dragon float on.
- **Foam and spray** (stage 7c): an advected foam field around the camera fed by whitecaps from the spectrum,
  breaking wake crests, surf, hulls, the dragon and splashes; spray (spindrift, bow spray, rooster tails) from the
  same physics. The ribbon wakes (`wakes/wake-trails.ts`) remain only as the far level of detail and on "low".

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

### Stage 2 as built (GPU review needed)

Downwash, skim wake, wingtip vortex curls, fire steam and their sound. Claw dip and the reactions (gulls, fish, crews)
are not part of it; they stay open in the table above.

- **One model for pictures, sprays and sound** (`src/world/water/lowflight/low-flight.ts`, service `lowFlight` in
  `contracts.ts`, owned by the water system, updated after flight and camera): from DragonState (mode, velocity,
  airspeed, `flapEffort`, `firing`, `touchingWater`), the rig's wingtip and mouth anchors and the water service it works
  out per frame, against the **local wave height**: `downwash` (hover-like modes or slow flight below ~24 m/s, fading in
  from 1.5 wingspans up to full at 0.3), `downwashPulse` + a gust ring per downstroke (the flight 'flap' events),
  `edgeSpray` (a strong hover close to the water), `wake` (the skim: `touchingWater`, or the belly within ~2.5 m of the
  waves at > 8 m/s; fast attack, 0.35 s release), `tipVortex` / `vortex` (wingtips within 0.45 wingspans of the water at
  > 18 m/s), tail and wingtip heights over the waves, and `steam` (the fire jet ray-marched against the waves over the
  fire's 40 m reach; mouth under the surface boils at the mouth). The flight side is only read; the skim physics stays
  theirs.
- **Disturbance field on the water** (`disturbance-window.ts`, `disturbance-gpu.ts`, `shaders.glsl.ts`): a square window
  (medium 128² × 0.8 m, high 192² × 0.6 m, ultra 256² × 0.5 m; off on low) that follows the dragon in whole texels,
  trailing up to 30 % of its extent behind a fast dragon so more wake stays in view. One half-float RGBA ping-pong pass
  per fixed 60 Hz step: r/g = a damped wave equation (ripples at 4 m/s, sponge edges), b = roughness (decays, spreads a
  little), a = foam (decays). The model writes stamps (disks, rings, swept capsules, up to 16 a frame): each downstroke
  pushes a dent that the wave equation turns into an expanding ripple ring, and its gust ring races out (11 m/s, slowing)
  as a dark roughened annulus; the downwash keeps a ruffled patch under the wings; the skim leaves a furrow (depression +
  foam + roughness; the moving trough radiates a narrow V at asin(4 / v)) and a wider roughened strip; wingtip vortices
  leave roughened streaks, a tip or the tail touching the water a foam line; the fire leaves a boiling foamy patch.
  Swept stamps are normalised by their overlap, so the amount per pass does not depend on speed or frame rate; frames
  without a step due run an apply-only pass (no time passes), so ripples keep their speed at any frame rate.
- **Water shader** (`water-fragment.glsl.ts`): inside one uniform branch (skipped while the field is off) 5 taps of the
  field: the ripple gradient is added to the surface slope (faded into roughness where finer than a pixel), roughness
  amplifies the detail bands (up to 3.4×) and widens the GGX lobe, ruffled patches reflect up to 22 % less sky (the
  darker "cat's paw" look), foam is broken up by the foam texture.
- **Sprays** (`src/fx/emitters/surface-emitter.ts`, `fire-emitter.ts`): over the sea the service drives the existing
  downwash mist, droplets, ring and foam; new: spray whipped up at the downwash ring's edge (drops, spray sheets, mist
  thrown outward and swirled), wingtip vortex curls (faint mist on a helix around each trailing vortex, outboard side
  rising, top rolling in, plus fine drops), a rooster tail where the tail tip kisses the water, wingtip kisses at the
  real wave height. Every water emission (splashes included) now spawns on and dies at the local wave surface instead
  of y = 0. Fire on the sea: a steady steam cloud at the service's steam point plus hissing spurts (tight, fast-rising
  puffs every 0.1–0.35 s); it keeps steaming for ~1 s after the breath stops.
- **Sound** (`src/audio/voices/sea.ts`, `audio-engine.ts`, `audio/index.ts`): a new voice, synthesised, on the sfx bus
  (so it is muffled under water with everything else): downwash buffeting (brown noise AM'd by the buffet signal),
  a thump + spray patter per downstroke over the water (scheduled once per beat, ~0.08 s after the flap sound), skim
  tearing (band noise 0.9–2.4 kHz rising with speed, fast AM) and the furrow rush; steam hiss (high-passed white noise
  sputtered by the crackle buffer) with a low boil, placed at the steam point. The wind voice's airy skim hiss now also
  follows the wake (a wave-relative contact the agl misses in a swell). Offline analysis cases `sea-downwash`,
  `sea-skim`, `sea-steam` (first-pass loudness windows, to be balanced by ear).
- **Off switches:** above ~70 m over the sea, over land, under water, swimming or without a dragon the model costs one
  isWater query and every value is 0 (sprays and sound skip their work: `active` false, the voice's sources are
  stopped); the field stops simulating and the water branch is skipped 7 s after the last stamp; "low" has no field
  (sprays and sound still work); particle counts scale with the quality's particle budget as before.
- **Performance** (estimates, no GPU here): simulation 192² × 1–3 passes ≈ 0.02–0.04 ms; water shader ≈ 0.05–0.1 ms
  while the window covers much of the screen (5 bilinear taps in the window only); extra particles within the existing
  budgets (a full hover adds ~350 drops/s and ~100 volumetric sprays/s, the pass adapts its resolution under heavy
  overdraw) ≈ 0.1–0.2 ms. Total ≈ 0.2–0.35 ms on "high", 0 when not low over water. CPU: ≤ 6 wave queries a frame
  while low, well under 0.05 ms.
- **Checks:** `tools/headless/lowflight-check.ts` (real FlightSim, real sea, real fx emitters on counting pools): hover
  low / high, a slow low pass, a fast skim then 80 m up, fire at the water / high / over land, hover and fast passes
  over land; activation, ranges, NaNs, zero activity when high or over land; window scrolling, clears, culling, queue
  limit, the fixed-step clock at 24 / 60 / 144 fps, lifetime, quality off; structural GLSL checks. The new GLSL (and the
  whole water fragment) also parses with @shaderfrog/glsl-parser (run from a scratch directory, not a dependency).

**What the owner should look at (GPU):**

1. Hover 5–15 m over calm water (Marmara off Kadıköy, `?wu10=4`): a darker ruffled patch under the wings, a ripple ring
   and a dark gust ring racing out with every downstroke, spray whipped up at the ring's edge. Tunables:
   `DISTURBANCE_STAMPS.downwashRough`, `gustRough`, `downstrokeDepth`, `LOW_FLIGHT.gustSpeed`.
2. Slow low pass (15–20 m/s, 8 m): a lighter ruffled track, no edge spray.
3. Skim fast and low: a foam furrow and a narrow V of ripples behind, lasting a few seconds; spray from the wingtips
   and tail where they touch; faint curling spray from the wingtips in a fast low pass. Tunables: `furrow*`,
   `vortexRough`, `DISTURBANCE_SIM.waveSpeed` (V angle), `foamDecay`.
4. The window edge: no visible square (the field fades out over the outer 10 % and ripples are absorbed at the edges).
5. Fire at the water from a hover: a steam cloud and hissing spurts on the waves, a boiling foamy patch, the hiss.
6. Sound: downwash buffet and gust thumps over water only, skim tearing, steam hiss; nothing when high.
7. Lodos (`?wu10=16`): sprays and steam sit on the waves (no spray spawned inside a crest), the field rides the swell.
8. Cost with `?stats=1` on "high" while hovering / skimming (budget ≤ 0.5 ms); "low" shows sprays but no field.

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
  `GameEvents['maneuver']` carries id, label and the breach's `clean`; move ends reach the game as `maneuver-end`
  `{ id, clean }` (read by the tutorial hints, [20](20-movement.md) "Discoverability").
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

### Stage 5 as built: swimming

The owner's report: "When I land slowly on the sea with L, the dragon should swim at the surface, but right now it
looks like it's walking." Cause: swimming reused the ground walk (`walkAmount`, `walkPhase`, the wrists as fore feet)
with no ground plane, so the rig walked its legs on its default standing plane under the water.

- **Pose contract:** `DragonPose.swim` (0..1 floating posture), `swimPhase` (stroke phase, rad) and `swimStroke`
  (strength 0..1), written by `pose.ts`, read by the animator. Swimming no longer drives the walk: `walkAmount` is 0,
  the footstep audio already plays only in `grounded`.
- **Posture** (`animator.ts`, `SWIM_RIG` shape constants): floating low (`SWIM.floatDepth` 0.6 m: the waterline runs
  along the back, the saddle and the rider above it), neck raised with a swan-like S (lower neck up, upper neck
  forward) and the head held level, wings folded tight along the back (the flight fold, higher and closer to the body;
  never fore feet), hind legs kicking alternately below the body (thigh swinging back and forth, shin flexing and the
  foot feathering on the recovery, no plane, no planted feet).
- **Stroke** (`locomotion.ts` drives `sim.swimPhase` / `sim.swimStroke`, tunables in `SWIM_POSE` in `params.ts`): the
  side-to-side undulation of the spine (root, lumbar, pelvis) runs into a travelling wave down the tail (the main
  paddle); the chest and the rider stay steady and the neck undoes the body's swing so the head keeps to the course.
  Frequency 0.2 Hz at rest + 0.13 Hz per m/s, × 1.3 toward the fast swim (0.2 / 0.54 / 1.0 Hz floating / W / W +
  Shift), strength 0.22 / 0.7 / 1 (tail tip ±0.25 / ±0.46 / ±0.9 m). At rest: bobbing on the waves (physics), the slow
  tail sway, a head turn to one side every 3.5–8 s (deterministic). A quiet splash at the tail on each stroke reversal
  above 1.2 m/s (strength 0.05 + 0.025 per m/s, the existing splash sfx and fx) replaces the old timer splash.
- **Landing onto the water (L):** the landing settles into the float without a walking step: for 1.5 s after entering
  the body sinks no faster than 2 m/s and levels out at 1.6/s (no belly flop), the swim posture blends in at 2.2/s
  (out at 5/s).
- **Water take-off run** (Space or L while swimming): 1.2 s on the surface, speeding up to 8 m/s (7 m/s²) while the
  body rises onto the surface (float depth 0.6 → 0.05 m), the wings open (spread 0.85) and beat hard with the stroke
  amplitude limited to 0.7, each downstroke slapping the water with a splash at both wingtips; the hind legs paddle
  quickly (1.5 Hz); then the leap (`SWIM.leapUp` / `leapForward` on top of the run's speed: it leaves the water at
  ~10 m/s). (The instant V leap was removed with the urge on 26 Sep, see [20](20-movement.md).) Since stage 6 the run is longer in rough seas and a wave crest can cut it short (see "Stage 6 as built").
- **Plunge / breach:** surfacing from `underwater` enters swimming through the same settle and blend; a breach leaves
  as before.
- **Shore (wading):** swimming turns into `grounded` where the seabed is within the legs' reach
  (`standHeight + floatDepth − SWIM_POSE.wadeMargin`, ≈ 2.5 m deep), wading turns back into swimming beyond
  `standHeight + floatDepth + floatMargin` (≈ 3.25 m; hysteresis, no flicker). While grounded over water the stance
  stands on the seabed (`sim.sampleSurface` uses the seabed as the surface in `grounded`, and the next step's floor is
  the seabed too), so the dragon walks out of the sea with its feet on the bottom instead of on the water surface.
- **Checks:** `movement-check.ts` section "Swimming" (`--swim` runs it alone): the real rig in open calm water for
  floating / W / W + Shift: no walk cycle, rider's torso and head ≥ 0.77 m and head ≥ 1.84 m above the water, the back
  top 0.59–0.61 m above it, wings no deeper than 0.30 m, stroke frequency 0.20 < 0.54 < 1.02 Hz with the tail tip
  sweeping at it (85–97 % of its sweep) and growing ±0.25 < ±0.46 < ±0.90 m; a slow L landing ends swimming with no
  walk cycle, ≤ 1.1° and ≤ 4 cm per frame; the water take-off runs 1.2 s and is 4 m up 2.3 s after Space; swimming
  toward a shore switches once to wading at 2.5 m, walking (no jump, kicking feet ≤ 0.21 m into the seabed before
  it), and walking back out starts swimming once at 3.25 m. Pose strips `swim-idle`, `swim`, `swim-fast`,
  `land-on-water`, `water-takeoff`, `wade`; sea sheets now tint what is under the surface in every view and draw the
  water plane in the three-quarter and top views.

### Stage 5 v2 as built: swimming like a big animal

The owner, after playing: "While swimming in the sea the swimming animation is weak, bad, and so is its sound." Measured
before: tail tip ±0.25 / ±0.46 / ±0.90 m (floating / W / W + Shift) on an 18.5 m dragon, the body otherwise static,
the wings folded flat (wrists moving 1–3 cm), the hind legs kicking out of sight; the only sound a quiet splash at each
tail reversal. The swim is now a whole-body stroke, readable from the chase camera, and sounds like water, not slaps.

- **One stroke cycle** (`sim.swimPhase`, frequency 0.2 Hz + 0.15 Hz per m/s, × 1.2 fast: 0.20 / 0.59 / 1.04 Hz) drives
  everything; the left wing's catch is at phase 0, the right one's at pi. Shape numbers live in `SWIM_RIG`
  (animator.ts), feel and timing in `SWIM_POSE` (params.ts).
- **Travelling body wave:** root, lumbar and pelvis yaw one after another into a wave down the tail (`tailLag` 0.18 rad
  per bone, about 0.7 of a wavelength over body and tail). The swim wave now sits on top of the tail springs instead of
  being filtered by them (at 1 Hz the soft tip springs cut it by half and shifted it ~130°, so the old "travelling wave"
  mostly cancelled). Tail tip ±1.17 / ±2.48 / ±3.25 m; the chest and neck undo the body's swing, so the head keeps to
  the course; the body rolls ±0.07 rad into each wing's power stroke. The tail is carried slightly lifted
  (`tailPitch` -0.02) so its sweep shows at the waterline.
- **Wings as paddles** (fore limbs of a dragon are its wings), alternating like a crawl: IK drives the wrist around a
  loop beside the shoulder (`paddleCenter`, `paddleReach`, `paddleLow` / `paddleHigh`, `paddleOut`). The catch is
  forward and out, the power stroke sweeps back along the waterline (the hand out, back and just under the surface, the
  fan half open and facing back: the membrane pushes water), then the recovery lifts the wing up and in, folded
  edge-on, and swings it forward through the air. A smooth phase warp gives the power stroke 42 % of the cycle and makes
  it fastest in the middle. The loop grows with the stroke strength; floating idle it shrinks to a lazy, half-folded
  scull (`paddleIdle`, `paddleIdleOpen`). Wrists at W 0.13–1.43 m above the water, at W + Shift -0.06–1.65 m, floating
  0.60–0.93 m; wing membranes no deeper than 2 m.
- **Surge and bob:** each power stroke pushes the body on (`SWIM_POSE.surge` 0.1: a zero-mean thrust in
  `stepSwimming`, two per cycle, peaking at the left wing's mid stroke `surgePhase` and half a cycle later): the speed
  swings ±0.25 m/s at 2.57 m/s and ±0.45 m/s at 4.45 m/s, the mean unchanged. The rig follows: the chest lifts (`bob`
  0.09 m) and the nose rises a little at each power stroke, the lower neck rises (`neckSurge`) with the head countering
  it; floating, the body breathes (`breathBob` 0.05 m at 0.2 Hz) and the tail drifts slowly (`tailDrift`).
- **Hind legs:** the fast swim trails them further back toward the surface (`thighFast`, `shinFast`) and kicks harder
  (`thighKickFast`).
- **Turning:** the body curves into the turn (`turnCurve` on chest, lumbar and pelvis, `SWIM_POSE.tailTurn` on the
  tail), the outer wing's loop grows and the inner one's shrinks (`turnBoost` 0.45: in a right turn the left wrist
  spans 1.82 m, the right 0.74 m).
- **Rider:** stays above the water (torso ≥ 0.63 m); its head moves ≤ 0.29 m up-down and ≤ 0.47 m sideways at the
  fast swim (the bob and surge pitch were trimmed for this).
- **Sound** (all synthesised, no assets):
  - *Water bed* (`voices/swim.ts`, `MIX.swimBed`): a continuous layer at the swimming body: low lapping (brown noise
    around 300 Hz breathing with the slow gust signal), a mid slosh whose band wanders (pink, ~650 Hz), the bow wave's
    fizz rising with speed (1.4–4.2 kHz), and single wavelets clucking against the flanks at random 0.25–1.3 s
    intervals (scheduled envelopes, more often with speed). Louder with speed; sources run only while swimming.
  - *Wing strokes* (`sfx/swim.ts` `playPaddle`, `MIX.paddle`): at each wing's catch (the audio system reads the rig's
    swim phase, as it does the walk phase for footsteps) a soft swoosh of the membrane pushing water (pink noise band
    sweeping ~260 → ~650 Hz, 40–80 ms swell, a decay as long as the power stroke) with a low push and a few bubble
    blips, then a trickle of droplets and a thin hiss as the wing lifts out on the recovery. Placed beside that
    shoulder, strength = stroke strength, varied every time; the lazy idle sculls are faint.
  - *Snorts* (`playSnort`, `MIX.snort`): every 7–16 s while swimming a breathy nasal blow-out with a chest rumble and a
    fine spray, on top of the existing breathing (the creature voice keeps breathing while swimming).
  - The tail-reversal splash events are gone: swimming emits no splash events any more (no spray and no splash sound
    per stroke).
  - Offline audio report case `swim` (sandbox/audio.html): floating → swim → fast swim from the chase camera, target
    window -34..-22 LUFS integrated as a first pass; it has to be rendered and balanced by ear in a browser (the
    headless container has no WebAudio).
- **Checks** (`movement-check.ts --swim`): per case no NaNs, no walk cycle, rider and head above the water (head
  ≥ 0.8 m), back top within 0.25..0.9 m, wings never deeper than 2.2 m, rider head motion < 0.32 m up-down and < 0.55 m
  sideways, tail tip sweep envelopes (floating 0.3..1.4, swim 1.5..2.5, fast > swim + 0.3 and < 4 m) at the stroke
  frequency; swim and fast: both wrists paddle at the surface (lowest -0.5..0.45 m) and recover above it (> 1.2 m,
  range > 1 m), the mean speed within 4 % of the swim speed and the surge ±(0.6..1.4) × `surge` × speed; floating: the
  wrists move (lazy sculls) but stay folded (top < 1.3 m); the wing strokes grow with speed; the new `swim-turn`
  scenario (W, then D): the outer wing's loop > 1.15 × the inner one's. The earlier landing, take-off and shore checks
  are unchanged and pass.
- **Pose sheets:** a `chase` view (from behind, a little right and above, like the chase camera) joins side, front,
  top and three-quarter; the new `swim-turn` scenario. The clearest sheets: `swim-fast-chase`, `swim-fast-top`,
  `swim-top` and `swim-turn-top`.
- Not yet: visual water from the strokes (a churn of foam and droplets at each paddle and the tail); the swim is
  still unaffected by waves beyond the float (strand 6; since stage 6 the body rocks on the waves, see there).

## Strand 6 — Weather and the sea

- Lodos: big waves, spray blown off crests, harder water take-offs, the dragon rocks more while swimming.
- Poyraz: choppy, cold light; fog banks sitting on the water in the morning (phase 13).
- Rain: rings on the water; storms: whitecaps everywhere.

### Stage 6 as built (GPU review and feel test needed)

**Storm seas** (`src/world/water/weather/`, `sea-state.ts`, `water/index.ts`):
- The environment wind is 3–12 m/s at 100 m (U10 ≤ 9.4) whatever the weather, so a storm preset left the sea at ~0.8 %
  whitecaps. The water system now hands the weather's smoothed `rain` / `storm` to the `SeaState`, and the sea is built
  from `seaWindU10` = max(the wind's U10, `SEA_WEATHER.stormU10` (15) × storm) × (1 + 0.12 × rain), capped at 16. The
  sea still lags it by ~40 s (a storm builds its sea: U10 3.9 → 8.7 after 20 s, 13.3 after 60 s, 15.4 after 2 min),
  and everything downstream follows with no special case: the spectrum (open-sea Hs 0.4 → 1.9 m), the 7c whitecaps
  (open sea 0.04 % → 4.9 %: whitecaps everywhere), spindrift (from U10 12), the swimming dragon's rocking and its
  take-offs. `?wu10=` still overrides everything. The rain preset alone gusts the sea only a little (U10 +12 %).

**Swimming in waves** (`locomotion.ts` swimming branch, `SWIM_SEA` in `params.ts`, `sim.seaPitch` / `seaRoll` /
`seaHs` / `runDuration`):
- The body still floats on the body-averaged wave surface (five points over its length and beam, so chop much
  shorter than the dragon hardly moves it), but its pitch and roll now follow the plane through those points as a
  lightly damped oscillator (natural periods 2.8 s pitch, 3.4 s roll, damping ratio 0.3) instead of a first-order lag:
  long lodos waves (periods near and above the body's) rock it a little more than their slope, short chop less, and it
  keeps swaying for a moment after a big wave. Bounded at 16° pitch / 20° roll. Rocking vs the local Hs (Marmara,
  lodos, the real FlightSim on the real sea, sea-weather-check section 2):

  | U10 | local Hs | pitch rms (peak) | roll rms (peak) | rocking / surface plane |
  |---|---|---|---|---|
  | 2 | 0.17 m | 0.05° (0.1°) | 0.4° (0.9°) | 0.96 |
  | 6 | 0.69 m | 1.2° (2.8°) | 3.4° (8.1°) | 1.50 |
  | 10 | 1.19 m | 1.7° (4.8°) | 4.3° (13.7°) | 1.31 |
  | 13 | 1.56 m | 2.0° (4.8°) | 5.6° (16.5°) | 1.32 |
  | 16 | 1.91 m | 2.1° (5.9°) | 6.4° (17.6°) | 1.26 |

  (90 s windows after settling; before stage 6 the body followed the surface plane with a 0.2 s lag, i.e. a ratio just under 1.)

  The roll is larger than the pitch: the body is 18.5 m long but only ~4 m wide, so it filters the waves along its
  length much more than across.
- **Rider on top:** a short steep crest passing under the chest lifts the body (its centre never sits deeper than
  `floatDepth + SWIM_SEA.dryMargin` under the local surface); with the real rig in a U10 16 lodos the rider's head,
  chest and spine stay 0.34 m or more above the local water (calm: ≥ 0.63 m, unchanged).
- The local significant wave height comes from the water service (`WaterService.significantHeightAt`, a new optional
  method: the spectrum slots with the local fetch weights, ~1 µs); flat stand-in water reads as calm, so the calm-water
  swim, landing, take-off and shore behaviour are unchanged (movement-check passes as before).

**Water take-offs in rough seas** (same files):
- The run lasts `runTime` × (1 + 0.9 × rough), rough = smoothstep(0.3, 2.0 m, local Hs), accelerates up to 30 % less and
  costs up to 0.12 stamina on top of the beats: 1.2 s in calm water, 1.55 s at Hs 0.95 m, 2.1 s at 1.56 m, 2.27 s in
  the full lodos.
- **Crest leap:** once the run is 0.72 s old (0.6 of the calm run) in a sea of Hs ≥ 0.5 m, riding a crest (the
  body-averaged surface above 0.2 × Hs, not falling faster than 0.3 m/s) gives the leap at once, and the rising water
  adds its vertical speed to it. In the check about one run in six hits a crest (0.72–1.53 s instead of 1.55–2.27 s); timing Space as a crest
  approaches is a skill, not a special score. The pose's float blend uses the run's real length (`sim.runDuration`).

**Rain on the water** (`weather/shaders.glsl.ts`, `water-fragment.glsl.ts`, `fx/emitters/rain-splash-emitter.ts`,
`audio/voices/rain.ts`):
- *Drop rings:* a procedural ripple normal in the water fragment, no geometry and no textures: two staggered layers of
  0.8 m cells, one drop per cell and 1.1 s cycle at a random point (density 0.85 √rain), its ring (a crest outside, a
  trough inside, 2.5 mm × 1.8 cm, steepest slope ~0.1) running out to 0.22 m while it fades; sampled at the surface
  point, so the rings ride the waves. Finer than the pixel (from 0.8 to 3 ring widths per pixel) they fade into GGX
  roughness (+0.004 mean square slope at full rain: the dull, pitted look of a sea in rain). All behind one uniform
  branch (`uRainParams.x > 0`).
- *Damped roughness:* rain damps the short waves (the detail bands) by up to 30 % (`SEA_WEATHER.rainDamp`).
- *Splashes near the camera:* `RainSplashEmitter` throws tiny droplet crowns (2–4 drops, 0.5–1.1 cm, 0.2–0.4 s) off the
  water within 1.5–16 m of the camera (denser near it), up to 220 splashes/s at full rain × the particle budget, only
  with the camera less than 40 m above the water; none over land or under water.
- *Sound:* the rain voice gets a third layer, a soft bright hiss of drops on open water (pink noise band-passed around
  4.6 / 5.4 kHz, L/R decorrelated) scaled by the rain, the water fraction under the listener and its height (full below
  15 m, gone by 140 m), muted under water. Offline analysis case `rain-sea` (first-pass window −28..−20 LUFS, to be
  balanced by ear).

**Fog banks on the sea** (`src/render/weather/sea-fog.ts`, `weather-pass.ts`, `weather/index.ts`):
- A second, thin exponential fog layer from sea level (scale height 16 m, extinction 0.009/m at full amount, ~330 m
  visibility on the water) in the weather pass's composite, with banks (fbm, 420 m) drifting with half the wind,
  sampled where the view ray runs lowest through the layer: the water and the quays disappear, hills, domes and the
  bridge towers rise out of it; seen from above it lies on the sea in patches.
- *When* (`seaFogTarget`, pure): fog weather gives a full bank in the morning window (forming 02:00–05:00, lifting
  08:30–11:30) and 30 % of it all day; humid air alone (env humidity 0.72 → 0.86, e.g. haze on a poyraz morning) up to
  0.6 in the morning only; a lodos (regime 0.35 → 0.65), a strong wind (U10 7 → 12) and rain (0.15 → 0.5) clear it.
  While it lifts, the layer thins (−55 %) and rises (×2.2 scale height).
- *Foggy mornings of their own* (`seaFogDayAmount`, added 26 Sep): clear weather alone never reached the humidity
  threshold on a poyraz morning (≈ 0.70 < 0.72), so the sea fog only came with the fog setting. Now about 30 % of game
  days (a hash of `time.dayOfYear`: the same day always gives the same answer, a reload does not reroll it) get a
  morning bank of 0.45–0.85 in the same window, even in clear weather; a lodos, a strong wind or rain still clear it.
  On the other days clear weather has none.
- `SeaFogModel` eases the amount with τ = 20 s and switches the layer with hysteresis (on above a target of 0.08, off
  once the amount is below 0.02): a lodos arriving on a foggy morning clears it in ~80 s. Off, the pass gets density 0
  and skips the branch (zero cost); the pass counts it in `active`. Debug `?seafog=0..1` forces the target;
  `__weather.seaFog` shows the model.

**Race / flow tie-in:** nothing special was added. The flow harmony's surface proximity already reads
`sim.footClearance`, which over the sea is measured to the local wave height (the water service), so skimming low along
a crest line counts as a tight use of the world by itself (sea-weather-check section 6: level flight at 7 m over a
lodos sea sees 4.3–6.9 m of clearance and a proximity of 0.89–0.99, rising over the crests). Rough seas make water
take-offs slower (a longer run), which matters only for races that start in or pass through a swim.

**Cost** (estimates, no GPU here):
- Rain rings: ~120 ALU per resolved pixel (the near ~25 % of the screen), a uniform branch elsewhere: ≈ 0.01–0.03 ms on
  "high" (budget 0.1 ms); 0 without rain.
- Sea fog: ~90 ALU per pixel (3 exp + one 3-octave fbm) in the existing weather composite while active: ≈ 0.02–0.05 ms
  at 1600 × 900 (budget 0.2 ms); 0 when off.
- Rain splashes: ≤ 120 droplets a frame from the existing sharp particle pool, a few water queries per frame.
- CPU: a swimming step with the rocking and the local Hs query ≈ 13 µs; the fog model and the sea's weather input are a
  few multiplications per frame.

**Tunables:** `SEA_WEATHER` (stormU10, rainGust, rainDamp) and `RAIN_RINGS` (cell, period, ringMax, width, amplitude,
density, unresolvedVar, fadeStart / fadeEnd) in `src/world/water/weather/config.ts`; `SWIM_SEA` (pitchPeriod,
rollPeriod, damping, maxPitch / maxRoll, alignRate, dryMargin, roughLo / roughHi, runLonger, runAccelLoss, runStamina,
crest*) in `src/dragon/flight/params.ts`; `SEA_FOG` (density, height, lift*, morning window, fog / humidity / lodos /
wind / rain ramps, on / off hysteresis, tau, patches, bankSize, drift) in `src/render/weather/sea-fog.ts`;
`RAIN_SPLASH` in `src/fx/emitters/rain-splash-emitter.ts`; `RAIN_ON_SEA` in `src/audio/voices/rain.ts`.

**Checks:** `tools/headless/sea-weather-check.ts` (`--quick`): storm U10 and its build-up, whitecap coverage and Hs,
`?wu10` precedence; rocking vs Hs on the real sea (grows, bounded, long waves rock it 0.8–1.8× their slope, float
tracking, no NaNs) and the rider on the real rig in a U10 16 lodos; take-offs per sea state (1.2 s in calm water, longer
with Hs, more stamina, crest leaps sometimes and never before 0.72 s, every run leaves the water); the rain ring
uniforms and the JS port of the ring slope (zero without rain, growing with it, visible peak slopes, clock wrap, bad
inputs); the sea fog logic (weather, time, regime, wind, rain, humidity, foggy days; lifting; hysteresis without flicker; zero
density when off; clearing time; NaN inputs); the flow's clearance over waves; shader structure and cost estimates. The
water fragment, water vertex and weather composite shaders parse with @shaderfrog/glsl-parser (scratch directory, not
a dependency). The waves, foam (`--quick`), water (`--quick`), lowflight, underwater, movement, flow and races checks
pass.

**What the owner should look at (GPU):**

1. Storm (`?weather=storm`, open Marmara or the Black Sea mouth): within a minute or two the sea builds up to a storm
   sea with whitecaps everywhere and spindrift; back to clear it calms over ~1–2 min. Tunables:
   `SEA_WEATHER.stormU10`, `rainGust`.
2. Swim in a lodos (`?wind=lodos&wu10=16`, land on the open Marmara with L): the dragon rolls and pitches with the long
   waves (roll up to ~18°, pitch ~6°), keeps swaying a moment after a big one, the rider stays dry; in calm water
   (`?wu10=3`) it lies nearly still. Tunables: `SWIM_SEA.rollPeriod`, `pitchPeriod`, `damping`, `maxRoll`, `dryMargin`.
3. Water take-off in the same lodos: the run is visibly longer (~2.3 s of beating) and drains a little stamina; press
   Space as a crest lifts the dragon and it leaps early. In calm water it is 1.2 s as before. Tunables: `runLonger`,
   `runStamina`, `crestMinRun`, `crestShare`.
4. Rain (`?weather=rain&wu10=3`, hover 5–10 m over calm water): drop rings dotting the water near the camera, a duller,
   less glittery sea further out, small droplet crowns jumping off the water around the camera, a soft hiss of rain on
   water under the rain wash. Look for tiling (the rings live in 0.8 m cells, two staggered layers) and for rings
   shimmering at the fade distance. Tunables: `RAIN_RINGS.amplitude`, `density`, `width`, `fadeStart` / `fadeEnd`,
   `SEA_WEATHER.rainDamp`, `RAIN_SPLASH.rate`, `RAIN_ON_SEA`.
5. Sea fog (`?weather=fog&t=6.5&wind=poyraz`, or `?seafog=1`): low fog lying on the Bosphorus and the Golden Horn in
   drifting banks, the bridge towers, minarets and hills rising out of it; from 300 m up it lies on the water in
   patches; at `t=10` it is thinner and higher; `?weather=haze&t=7` gives light banks; with `&wind=lodos` there is none.
   Tunables: `SEA_FOG.density`, `height`, `patches`, `bankSize`, the morning window.
6. Cost with `?stats=1` on "high": rain rings ≤ 0.1 ms (`?weather=rain` vs `?weather=clear` over water), sea fog
   ≤ 0.2 ms (`?seafog=1` vs `?seafog=0`); nothing measurable with both off.

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

### Stage 7a as built (GPU review needed)

**Wind-wave spectrum** (`src/world/water/spectrum.ts`, lattice and tunables in `config.ts`):
- The Gerstner set is now a fixed lattice of 11 wind-sea slots per regime (2.2–66 m, steps of ~1.4) plus 2 swell
  slots per regime (26 slots, `MAX_WAVES`). Wavelengths and directions never change (the origin-relative phases stay
  continuous); every frame the `SeaState` gives each slot the energy of its frequency bin of a fetch-limited JONSWAP
  spectrum (Hasselmann 1973: X = gF/U10², Hs = 1.6e-3 √X U10²/g, Tp = 0.286 X^⅓ U10/g, capped at the fully developed
  sea X = 22 500; shape γ = 3.3, σ 0.07 / 0.09, normalised to m0 = Hs²/16; Simpson in log frequency), A = √(2E), no
  slot steeper than kA = 0.26, crest sharpening Q·k·A per group with the old total cap of 0.8.
- Groups are fetch classes: **chop** (1 km, slots 2.2–4.6 m; grows everywhere incl. the Golden Horn, harbours and
  lakes), **short** (4 km, the Bosphorus; 6.3–12.1 m), **long** (the open sea: 100 km in a poyraz, the
  duration-limited Black Sea sea; 45 km in a lodos, across the Marmara; 17–66 m) and **swell** (Black Sea swell toward
  SSW in a poyraz, Tp 8.2 s, Hs 0.45 + 0.05 U10; Marmara swell toward NE in a lodos, Tp 5.6 s, Hs 0.1 + 0.04 U10;
  γ = 6). A chop slot carries at least the short sea's energy in its bin (in light winds the short sea peaks there).
- Where each class exists comes from the baked fetch-exposure map (the same `waveGroupWeights` in the shaders and
  `groupsAt` on the CPU, both changed together): chop everywhere (0.45 at the shortest fetch), short from ~1 km of
  fetch, long from ~15 km (full at ~140 km), swell offshore on the exposed side of the regime (the Black Sea in a
  poyraz, the Marmara in a lodos). Directions: poyraz seas toward 212°, lodos seas toward 38°, each slot at a fixed
  sample of the cos^2s(θ/2) spreading lobe (chop rms 33°, short 29°, long 25°, swell 14°). U10 comes from the
  environment wind as before (×0.78, 1.5–16 m/s, smoothed over 40 s) or `?wu10=`.
- **One source for GPU and CPU:** the amplitudes go into the same wave uniforms the shaders and the CPU evaluator read,
  so parity is unchanged (water-check: max 0.02 cm; the test now requires < 1 cm).
- The detail normal bands are unchanged (their slope variance already follows the equilibrium range).

**Spectrum table** (waves-check section 1: the model's wind sea at each place vs JONSWAP at the place's baked fetch,
and 4 × the standard deviation of the CPU surface height over 400 s, swell included):

Cells: wind-sea Hs / Tp of the model at the place (JONSWAP Hs / Tp at the place's baked fetch in brackets); where a
swell is present, its Hs and the surface's 4 std. The Marmara in a poyraz and the Black Sea in a lodos are the lee
sides (short fetch). Golden Horn peaks shorter than the lattice's 2.2 m are carried by the detail bands (normals).

| poyraz U10 (m/s) | Golden Horn (0.3 km) | Bosphorus (2.8 km) | Marmara (8 km) | Black Sea (300 km) |
|---|---|---|---|---|
| 4 | 0.06 m / 1.4 s (0.04 / 0.7) | 0.12 m / 1.4 s (0.11 / 1.4) | 0.12 m / 1.4 s (0.18 / 2.0) | 0.32 m / 3.3 s (0.39 / 3.3), swell 0.66, surface 0.76 |
| 7 | 0.08 m / 1.7 s (0.06 / 0.8) | 0.20 m / 1.7 s (0.19 / 1.7) | 0.22 m / 2.0 s (0.32 / 2.4) | 1.11 m / 5.5 s (1.13 / 5.5), swell 0.82, surface 1.40 |
| 10 | 0.09 m / 1.7 s (0.09 / 0.9) | 0.26 m / 2.0 s (0.27 / 1.9) | 0.32 m / 2.0 s (0.46 / 2.7) | 1.61 m / 6.5 s (1.62 / 6.2), swell 0.97, surface 1.90 |
| 13 | 0.11 m / 1.4 s (0.11 / 1.0) | 0.33 m / 2.4 s (0.35 / 2.1) | 0.42 m / 2.4 s (0.59 / 2.9) | 2.11 m / 6.5 s (2.10 / 6.8), swell 1.12, surface 2.42 |
| 16 | 0.12 m / 1.7 s (0.14 / 1.0) | 0.40 m / 2.4 s (0.43 / 2.2) | 0.51 m / 2.4 s (0.73 / 3.1) | 2.60 m / 6.5 s (2.58 / 7.3), swell 1.28, surface 2.93 |

| lodos U10 (m/s) | Golden Horn (0.3 km) | Bosphorus (2.4 km) | Marmara (126.3 km) | Black Sea (4.7 km) |
|---|---|---|---|---|
| 4 | 0.06 m / 1.4 s (0.04 / 0.7) | 0.12 m / 1.4 s (0.10 / 1.3) | 0.32 m / 3.3 s (0.39 / 3.3), swell 0.27, surface 0.42 | 0.12 m / 1.4 s (0.14 / 1.7) |
| 7 | 0.09 m / 1.7 s (0.07 / 0.8) | 0.19 m / 1.7 s (0.18 / 1.6) | 0.72 m / 3.9 s (0.76 / 4.2), swell 0.39, surface 0.82 | 0.22 m / 1.7 s (0.24 / 2.0) |
| 10 | 0.09 m / 1.7 s (0.09 / 0.9) | 0.25 m / 1.7 s (0.25 / 1.8) | 1.06 m / 4.7 s (1.08 / 4.8), swell 0.51, surface 1.18 | 0.31 m / 2.0 s (0.35 / 2.2) |
| 13 | 0.11 m / 1.4 s (0.12 / 1.0) | 0.31 m / 2.4 s (0.33 / 2.0) | 1.40 m / 5.5 s (1.41 / 5.2), swell 0.63, surface 1.54 | 0.40 m / 2.4 s (0.45 / 2.5) |
| 16 | 0.12 m / 1.7 s (0.15 / 1.1) | 0.37 m / 2.4 s (0.40 / 2.1) | 1.74 m / 5.5 s (1.73 / 5.6), swell 0.76, surface 1.90 | 0.49 m / 2.4 s (0.56 / 2.6) |

**Wave particles** (`src/world/water/particles/`):
- `wave-particles.ts` (CPU, `water.dynamic` in `contracts.ts`, additive API): a pool of wave-front particles after
  Yuksel et al. (2007) with dispersion and a carrier: each particle leaves its origin at the deep-water group speed of
  its wavelength and describes h = a · Wf(f/l) · Wq(q/s) · cos(k q + phase), where W(u) = (1 + cos πu)/2 is a partition
  of unity across the front (l = dispersion angle × radius) and along the wave vector (s = the spacing of a continuous
  source's emissions), so overlapping particles sum to the physical amplitude. The amplitude falls as √(r0/r) (energy
  a²·l conserved on a widening front) and decays at 1/150 s⁻¹ + 0.006·k; it never grows. A particle whose front
  half-width exceeds max(1.8 λ, 6 m) splits into three with a third of the dispersion angle (energy exactly conserved,
  at most 2 generations; 4 in the check), a nearly full pool shrinks the emission range (far sources stop first),
  particles die below 4 mm, after 50 s, over land (coast test, a sixth of the pool per frame) or far from the camera.
- **Hulls:** a moving hull emits, per side and per direction class θ (4 classes near, 3 beyond 350 m from the camera,
  bow and stern, the stern a trough at 0.6), the wave whose phase speed matches its speed along θ (λ = 2πU²cos²θ/g,
  λ between max(1.5 m, beam/4) and 70 m), once per wave period, born at its due instant where the hull was then (frame
  rate independent). The phases are coherent between emissions (the pattern is stationary in the hull's frame) and
  each class runs along its ray at U cos θ / 2: the rays fill a wedge whose envelope is the Kelvin cusp line at 19.5°,
  nothing draws it. Fast sources lose the transverse classes (longer than 70 m): the wake narrows (a planing
  motorboat's peak sits at 16°). Amplitude: 1.0 · √(B·T) · Fr² / (1 + (Fr/0.5)³), ≤ 0.6 m (a vapur at 7 m/s: ~0.25 m
  crests near the hull, ~0.1 m 150 m off).
- **The dragon** (`dragon-waves.ts`, reads DragonState and the low-flight model only): swimming is a 14 × 4 × 1.2 m
  displacement hull, the skim contact a planing patch scaled by the low-flight wake, each downstroke that reaches the
  water a faint ring (0.03 m, λ 3 m), every `splash` event a two-ring train (0.14 × strength m, ≤ 0.5 m; λ 2 + 1.5 ×
  strength m; a plunge ≈ 0.4 m, λ 6 m); the nostril bubbles under water make none.
- **Water service:** `heightAt` / `normalAt` / `velocityAt` add the particles at the queried (displaced) point, sunk
  under land like the sheet (cached per point and update); `ambientHeightAt` and `groupWeightsAt` are new
  diagnostics. The vertical velocity includes the envelope's motion and the decay, so hull heave damping sees the real
  rate. A spatial hash (32 m cells, 4096 buckets, rebuilt once per update) serves the queries.
- **Vessels:** `vessel-physics.ts` drops the 7b analytic Kelvin push; every non-kinematic hull moving faster than
  0.8 m/s within 1.5 km of the camera emits through `water.dynamic.hull` (draft reduced by planing), and every hull
  samples the water with its own particles excluded (`dynamic.exclude`), so boats rock on each other's real wakes (a
  fishing boat 80 m off a passing vapur: 1.7° rms, 0 in calm water).
- **GPU** (`splat-gpu.ts`, `shaders.glsl.ts`): a stateless half-float RGBA window around the camera (medium 256² ×
  1.5 m, high 512² × 1 m, ultra 768² × 0.8 m, off on low), placed in whole texels, cleared and drawn every frame as
  one instanced oriented quad per particle (additive; r = height, g/b = gradient, a = envelope for 7c). The kernel is
  the CPU formula exactly; waves shorter than 5 texels are faded out. The water vertex shader adds the height at the
  displaced vertex where the grid can carry it (vertex spacing < 1.5–4 texels), the fragment shader adds the slope
  (faded into roughness below the pixel footprint); both skip the lookup while no particle is near the camera
  (`uWaveParams.x`), the outer 6 % of the window fades out. The stage 2 disturbance window stays separate (a
  ping-pong simulation at 0.5–0.8 m around the dragon); the splat reuses its whole-texel placement idea.
- **Quality tiers:** pool 384 / 1536 / 3072 / 4096, emission within 0 / 700 / 1000 / 1300 m of the camera and 250–300 m
  of the dragon; "low" has no splat (the spectrum only on screen) and CPU particles only near the dragon.
- The ribbon wakes (`wakes/wake-trails.ts`) stayed as the foam line and the far LOD; since 7c they only draw outside
  the foam field window (and on "low").

**Cost** (Node timings; browser similar, plain JS, no allocations per frame; GPU estimated):
- CPU: ~60–90 ns per particle and update plus the grid; a ship makes 300–900 particles. Real high-preset fleet on the
  real sea: camera at Karaköy 0.03–0.05 ms per frame, camera over the Bosphorus (3 ships passing, pool full at 3072)
  0.22–0.25 ms avg / 0.30–0.36 ms p95 update + ~0.01 ms of queries (~0.1–0.8 µs each). Budget 0.5 ms.
- GPU on "high": the busiest Bosphorus frame splats ~1600 particles, 0.27 M quad fragments of ~40 ALU with an RGBA16F
  blend, plus a 2 MB clear: ≈ 0.1–0.15 ms, and one bilinear lookup per water vertex / pixel inside the window.
  Budget 0.4 ms.

**Tunables:** `SEA_SPECTRUM` (fetch per class, γ, swell per regime, crest sharpening, slot steepness cap) and the slot
lattice in `config.ts`; `WAVE_PARTICLES` (wavelength range, life, damping, subdivision, grid), `HULL_WAVES` (classes,
amplitude law `ampScale` / `frKnee`, stern share, transverse fade, initial front width), `RING_WAVES`, `DRAGON_WAVES`
and `waveParticleQualityFor` in `particles/config.ts`; `VESSEL_PHYSICS.emitSpeed` / `emitRange`.

**Checks:** `tools/headless/waves-check.ts` (`--quick`): spectrum statistics (above; Hs within 0.6–1.5× of JONSWAP at
the local fetch, Tp within 0.72–1.4× (lattice-quantised), growth with wind and fetch, directions within 30° of the
regime, the surface's 4 std within 20 % of the model); the Kelvin cusp at 20° / 20° / 20° / 18° for a tour boat, a
vapur, a fishing boat and a yacht, 16° for a planing motorboat; energy under subdivision constant to 0.000 % over 40 s
(96 splits), no amplitude growth, the subdivided ring within 11 % of the exact circular ring after 25 s (75 % without
subdivision); CPU/GPU parity: the splat shader's kernel equals the CPU sum within 0.003 mm and the window lookup
reconstructs it within 4.1 % rms on high (5.1 % medium, 3.0 % ultra; worst texel 12 % of the peak); the water
service sums ambient + particles exactly, normals match finite differences, vy matches d/dt within 5 cm/s, a hull does not feel its own waves; the
real FlightSim swimming 40 s on the real sea with its own wake (float within 0.06 m rms of the surface); splashes and
bubbles; budgets and quality tiers; the same wake at dt 1/24, 1/60, 1/144 within 5 % rms (jittered 6 %); no NaNs;
bad inputs ignored; the GLSL (and the whole water shaders) parse with @shaderfrog/glsl-parser (scratch directory).
`water-check.ts` now ports the four-group weights and requires < 1 cm; `vessels-check.ts` rocks the fishing boat on
the vapur's particle wake.

**What the owner should look at (GPU):**

1. A vapur crossing to Kadıköy in calm weather (`?wu10=3`), camera low behind it: the V of the wake at ~19.5° with
   the transverse crests between its arms and the cusp waves strongest along the edge, fading over a few hundred m;
   the bow wave riding with the hull. Tunables: `HULL_WAVES.ampScale`, `classes`, `WAVE_PARTICLES.damping`.
2. Small boats and the swimming dragon rocking when a wake reaches them; a motorboat's narrower, steeper wake.
3. Swim (`L` on the water, then W): a small bow wave and a V behind the dragon; plunge and breach: expanding rings.
4. The splat window's edge (~250 m from the camera on high): the wake should fade out, not stop at a line; no
   shimmering as the camera moves (whole-texel placement).
5. Wind: poyraz and lodos at `?wu10=4`, `10`, `16`: small chop in the Golden Horn, a Bosphorus sea of ~0.3–0.4 m,
   the long lodos sea (Hs ~1.7 m, Tp ~5.5 s) in the Marmara and the poyraz sea on the Black Sea side; waves running
   SSW in a poyraz and NE in a lodos.
6. Cost with `?stats=1` on "high": the water pass with a busy Bosphorus in view (splat ≤ 0.4 ms), `__water.particles`
   (`count`, `stats`) and `__water.splat.drawn`.
7. "Low": no splat (flat wakes on screen), no errors.

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
  cooldown per hull. Passing wakes: in 7b moving hulls ≥ 20 m at ≥ 2 m/s added an analytic Kelvin pattern to the
  water under hulls < 35 m; since 7a every moving hull emits wave particles and every hull floats on the others'
  (see "Stage 7a as built").
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
7°, tanker 1.4°, nothing capsizes (on 7a's spectrum sea, Hs 2.2 m with a longer 5.5–6 s peak: motorboat 26°, fishing
23°, tour 21°, ferry 16°, vapur 11°, tanker 1.9°); the high-preset fleet for 25 simulated minutes with every hull physical:
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
wave particles from hulls (built in 7a, which replaced the analytic wake push).

### 7c. Foam and spray from the water's state
- **Foam** is generated where the simulated surface breaks (steepness / surface compression above a threshold: wave
  crests in lodos, the bow wave, the crest of a wake), where the propeller churns the water (source strength from
  thrust) and where anything hits the water. It is **advected** with the surface flow and decays over tens of seconds,
  in a world-space foam texture that scrolls with a moving window around the camera, so a ship leaves a persistent
  white trail that bends when it turns and spreads and fades behind it.
- **Spray** particles are emitted from the same breaking events (bow slamming into a wave, the dragon's plunge),
  their amount from the local energy, not from fixed timers.

### Stage 7c as built (GPU review needed)

**Code:** `src/world/water/foam/` (`config.ts` tunables and quality tiers, `whitecaps.ts` the breaking model,
`foam-window.ts` bookkeeping, `foam-sources.ts` the `water.foam` service, `params.ts` per-step numbers,
`shaders.glsl.ts` sim / stamp / water GLSL, `foam-gpu.ts` the passes, `index.ts` the controller); the water fragment
(`shaders/water-fragment.glsl.ts`), `wave-query.ts` (`lagrangianAt`), vessel physics (`emitWaves` feeds the foam),
the ribbon wakes (fade inside the field), `src/fx/emitters/sea-spray-emitter.ts`; contracts `WaterFoam` /
`WaterSpraySource` (`water.foam`).

**Whitecaps from the spectrum** (`whitecaps.ts`):
- *Where:* on the most compressed crests. The horizontal Jacobian J of the Gerstner displacement comes from the very
  slot table the shaders and the CPU evaluator read. 1 − J is to first order a sum of the slots' q·sin(phase) (q =
  Q k A × group weight) with spread σ = √(Σq²/2); its tail is that of a sum of N = (Σq²)²/Σq⁴ sinusoids (much thinner
  than a normal tail, ending at √(2N) σ). A point is a crest candidate while J < 1 − z_N σ, z_N the exact 5 % quantile
  of such a sum (tabulated for N = 1..16 by convolving arcsine densities): the steepest 5 % of the local surface,
  whether it has two chop slots (Golden Horn) or a dozen (open sea). A fixed J threshold was tried first: it either
  missed sheltered water entirely or, near the thin tail's end, made it break everywhere.
- *How many:* a crest breaks with probability P = activeShare × W(U10) × dev / crestShare, decided per breaking cell
  (5 m along × 9 m across the wind, riding downwind at the local phase speed, re-rolled every 2.5 s with a per-cell
  phase; an integer hash identical in JS and GLSL), so crest segments break together and keep breaking as they travel.
  W = 3.84e-6 U10^3.41 (Monahan & O'Muircheartaigh 1980); dev = (ω_open / ω_local)^1.09 is the wave-development factor
  of Zhao & Toba's (2001) breaking Reynolds number (a young short-fetch sea breaks less at the same wind), ω the
  energy-weighted mean frequency of the slots. `activeShare` = 0.05 is the only calibrated number: the actively breaking
  share of the coverage, the foam left behind (decaying over 5 s) makes up the rest.
- Nothing breaks below U10 3.5 m/s. The same model runs in the field's sim (slots shorter than 2–3 texels faded out),
  in the water fragment for the "low" tier and the sea beyond the field (crests on screen with the whole coverage W,
  plus a statistical brightening W × dev where the waves are filtered out), and on the CPU for spindrift.

**The foam field** (`foam-window.ts`, `foam-gpu.ts`, `FOAM_SIM_FRAG`): a half-float RGBA ping-pong window around the
camera that shares the splat window's size and texel (medium 256² × 1.5 m, high 512² × 1 m, ultra 768² × 0.8 m; off
on low), placed in whole texels, stepped at a fixed 20 Hz (at most 3 steps a frame); the window only moves on step
frames (the water samples the field's own rectangle). Channels: r fresh / whitecap foam (e-folding 5 s), g wake foam
(30 s), b bubbles under fresh foam (1.6 s), a slick (70 s). One pass per step:
1. semi-Lagrangian advection along the surface current + the Stokes drift Σ A²ωk D of the local slots + a wind drift of
   3 % U10 (bilinear between texel centres, zero outside, the scroll folded in); 2. decay; 3. sources filling toward 1:
   breaking crests (above; a 6 % share goes to the long-lived channel as streaks), breaking wave-particle crests (the
   splat's slope above 0.3: bow-wave and wake crests, crossing wakes; 35 % into the wake channel), surf (crests of the
   ambient waves plus wave particles arriving within 28 m of the geo coast distance, scaled by the local Hs);
   4. nothing over land.
Then the frame's stamps are drawn with MAX blending (a stamp holds the field at least at its levels, so continuous
sources never depend on the frame rate).

**Stamped sources** (`foam-sources.ts`, recorded during the frame, turned into stamps in the water's preRender so the
systems' update order never matters):
- *Hulls* (vessel physics, every non-kinematic hull moving > 0.8 m/s within 1.5 km): stern turbulence at the transom
  (radius 0.55 B), the propeller wash along the last max(1.2 L, 25 m) of the hull's own track (a history of stern
  positions, so it bends with turns and restarts when a double-ender swaps ends), 0.35 B wide growing by 5 % of the
  distance, level (0.55 + 0.45 × thrust share) × speed factor, with bubbles and slick; the bow roll along both sides of
  the forefoot (level (Fr / 0.35)², width 0.12 B + 0.06 U); planing craft add foam along the aft chines. Beyond the
  stamped stretch the wake channel's decay keeps the centreline white (below).
- *The dragon:* the skim furrow swept from frame to frame (2.4 m at full wake), spray falling back at the downwash
  ring's edge (a ring at 0.45 wingspans), the fire's boiling patch, the swimming body's wash and the wing strokes where
  a wingtip is under water (read from the rig); splash events (plunge, breach, skim contacts) a disk of radius
  1.2 + 2.2 × strength m. The stage 2 disturbance field keeps its fine, short-lived foam on top.

**Rendering** (water fragment): the field's slick channel damps the detail bands (−45 % roughness: the glassy track);
its coverage (r + g) shapes a lace pattern from the baked procedural foam texture (bubble web where fresh, streaks
stretched along the drift direction as it ages) that thins out as the foam decays, fresh breaking water solid white,
only the coverage beyond ~2 m per pixel; bubbles add a bright aquamarine patch under fresh foam; inside the field the
shader's own caps and the analytic shore breakers step back (the lap line stays). Seen from below the field darkens
Snell's window (−82 % of the refracted sky under full cover). Debug view `?wdebug=foam` (r / g / b channels, shader
caps in magenta).

**Ribbon wakes:** inside the foam field window they fade out (0.78–0.96 of the half side, Chebyshev distance): the
field and the wave particles draw the near wake; the ribbons stay as the far level of detail and as the whole wake on
"low".

**Spray** (`water.foam.sprays` → `SeaSprayEmitter`, existing particle pools, budget scale + pool throttle, ≤ 360
particles a frame): spindrift from U10 12 (full at 16): 48 candidate points per 1/60 s around the camera (radius 180 m,
ahead of it) tested with the same whitecap criterion as the visible foam; each breaking crest found throws fine drops
and a mist streak downwind (the number found per second follows the coverage); bow spray from hulls faster than 6 m/s
(full at 13) scaled by the local chop (Hs) and bow slamming (heave + pitch rate), both sides; rooster tails of planing
craft from 7 m/s. Hulls beyond 600 m throw none.

**Whitecap coverage vs U10** (foam-check section 2: the CPU port of the sim on the real sea, mean coverage r + g of a
192² × 1 m window over 140 s after a 20 s spin-up; Marmara in a lodos, the others in a poyraz):

| Place | U10 3 | U10 4 | U10 6 | U10 8 | U10 10 | U10 12 | U10 14 | U10 16 |
|---|---|---|---|---|---|---|---|---|
| Monahan W | 0.000 % | 0.043 % | 0.173 % | 0.461 % | 0.987 % | 1.84 % | 3.11 % | 4.90 % |
| Black Sea (poyraz) | 0.000 % | 0.051 % | 0.178 % | 0.549 % | 1.01 % | 1.81 % | 3.49 % | 5.28 % |
| Marmara (lodos) | 0.000 % | 0.033 % | 0.172 % | 0.495 % | 1.05 % | 2.03 % | 3.02 % | 5.15 % |
| Bosphorus (poyraz) | 0.000 % | 0.015 % | 0.047 % | 0.119 % | 0.259 % | 0.440 % | 0.769 % | 1.25 % |
| Golden Horn (poyraz) | 0.000 % | 0.023 % | 0.079 % | 0.156 % | 0.260 % | 0.540 % | 0.980 % | 1.49 % |

Open sea within 0.72–1.19× of Monahan for U10 4..16 (0.93–1.19× from 6); the Bosphorus gets ~0.25× and the Golden
Horn ~0.3× of the open sea (wave development), all growing with the wind; none below U10 3.5.

**Wake foam behind a ferry** (41.7 × 9.6 × 2 m at 7 m/s, thrust 60 %, flat calm, high tier): centreline coverage 1.00
at the stern, 0.80 at 50 m, 0.55 at 100 m, 0.32 at 200 m, 0.20 at 300 m; e-folding length 195 m (U × wake life = 210 m), foamy (≥ 0.25) for 250 m;
turning at 0.04 rad/s the foam lies on the arc behind the stern (0.65), not on the straight tangent (0.14).

**Cost** (Node timings for the CPU; the GPU estimated, no GPU here):
- CPU: whitecap model ~1 µs a frame; window + sources with 12 hulls in view + spindrift sampling ~0.08 ms a frame.
- GPU on "high": a sim step is 512² fragments of ~26 slots + 4 texel fetches + a splat lookup (≈ 540 ALU): ≈ 0.035 ms,
  on one frame in three at 60 fps (≈ 0.012 ms averaged); stamps < 0.01 ms; water shading ≈ 70 ALU + 2 fetches per
  pixel ≈ 0.015 ms at 1600 × 900. Total ≈ 0.04–0.06 ms on a step frame (budget 0.3 ms). "Low": only the shader caps
  (a few ALU more in the existing Gerstner loop).

**Tunables:** `WHITECAPS` (activeShare, crestShare, edge, devExp / devMin, cell size and time), `FOAM_SIM` (channel
lifetimes, fill rates, wind drift, particle breaking slope, surf band / crest, slot fade), `HULL_FOAM` (bow roll, stern
radius, wash width / spread / levels, planing chines), `DRAGON_FOAM`, `SPRAY` and `foamQualityFor` in
`foam/config.ts`; `SEA_SPRAY` (particle counts) in `sea-spray-emitter.ts`; `WAKE_NEAR_FADE` in `wake-trails.ts`.

**Checks:** `tools/headless/foam-check.ts` (`--quick`): the crest table against a Monte Carlo of sums of sinusoids
(within 0.4 points for N = 1..13) and the crest share of the real open sea (0.5–1.5× of 5 %); the port's Gerstner sums
equal `WaveQuery.lagrangianAt` (< 1e-5); the breaking cells break at the given probability; coverage vs U10 (open sea
within 0.5–2× of Monahan for U10 6..16, growing with the wind, fewer in the Bosphorus and the Golden Horn, none at
U10 3, many at 14 vs few at 6); the ferry's decay length within 30 % of U × wake life and foamy for 200–600 m, the wash
following a turn; a patch drifting with a uniform current (36.0 m of 36 m), the real Bosphorus current (direction
within 10°) and the open sea's wind + Stokes drift (within 20 %); no channel sum or maximum grows without sources;
whole-texel scrolling keeps the field in place exactly, big jumps and quality changes clear, the fixed-step clock gives
200 steps in 10 s at 24 / 60 / 144 fps, stamp culling and the queue limit; the ferry's wake at dt 1/24, 1/60, 1/144 and
jittered within 0.1 %; NaN inputs ignored; the skim furrow, splashes and wing strokes; spindrift only in strong wind,
bow spray and rooster tails from fast boats only; CPU timings, the GPU estimate and the tiers; shader structure. The
sim, stamp, water and wake shaders parse with @shaderfrog/glsl-parser (run from a scratch directory, not a
dependency). The waves, water (full and `--quick`), vessels, lowflight, underwater, plunge and races checks pass.

**What the owner should look at (GPU):**

1. Wind: poyraz at `?wu10=6`, `10`, `14`, `16` over the Black Sea mouth and the open Marmara (lodos): a few
   whitecaps at 6, many at 14+, each a crest segment breaking for a moment and leaving a lacy patch that streaks
   downwind and fades within ~5–10 s; the Bosphorus with fewer, the Golden Horn with fewest. Tunables:
   `WHITECAPS.activeShare`, `cellAlong` / `cellAcross` / `cellTime`, `FOAM_SIM.capLife`, `capToWake`.
2. A vapur or ferry passing (`?wu10=3`), camera low behind it: a white turbulent centreline from the stern that stays
   foamy for a few hundred metres, widening and breaking into streaks, a glassy slick track, the bow roll along the
   forefoot, foam on the first steep wake crests; the wake bends with the turns. Tunables: `HULL_FOAM.wash*`,
   `FOAM_SIM.wakeLife`, `particleBreak`.
3. The field window's edge (~250 m on high): the ribbon wake takes over without a gap or a double wake; no visible
   square (the field fades out over its outer 8 %).
4. The dragon: a skim leaves a foam furrow that lasts tens of seconds; plunge / breach leave foam disks; swimming
   strokes churn foam at the wingtips; a hover's downwash leaves a foam ring.
5. Surf: exposed beaches and quays in a lodos (`?wu10=14`): crests breaking into foam along the shore that drifts off.
6. Spray: spindrift blowing off crests at `?wu10=15`–`16`; bow spray from fast boats in chop; rooster tails of
   planing motorboats.
7. From below (plunge in a lodos): foam patches as dark blotches in the Snell window.
8. `?wdebug=foam` shows the channels; `__water.foam` (window, sources.stats, model); cost with `?stats=1` on "high"
   (budget ≤ 0.3 ms for the foam passes and shading).
9. "Low": no field; whitecaps on the crests from the spectrum, the ribbon wakes' foam line as before, no errors.

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
| Swimming: Space or L | water take-off run (wings slapping the water), then the leap |

## Tooling and verification

- **Parity test** for the CPU wave evaluator (strand 1).
- **Flight checks** (`movement-check.ts`): skim distance and speed loss; plunge depth vs entry speed and angle;
  breach exit speed and height; water take-off distance per sea state; swim drift in the current; refusals over
  shallow water.
- **Pose strip:** scenarios `swim-idle`, `swim`, `swim-fast`, `land-on-water`, `water-takeoff`, `wade` (built), `plunge`,
  `breach` (built), `claw-dip`, `shake-off`.
- **Owner review on a GPU:** downwash ripples, wakes, spray, steam, the underwater look (strand 4), feel.

## Stages

| Stage | Content | Done when |
|---|---|---|
| 1 | Water service with the CPU wave evaluator; dragon floats and skims on real waves; current | Parity test passes; swim/skim checks pass |
| 2 | Low flight: downwash ripples, skim wake, wingtip curls, fire steam, water sound (built) | Owner GPU review OK; budget met |
| 3 | Plunge, under-water movement, breach, safety | Plunge/breach checks pass; pose sheets approved; feel test OK |
| 4 | Underwater rendering: camera follows under, underwater look, waterline and droplets, underwater audio (built) | Owner GPU review OK; ≤ 1 ms |
| 5 | Swimming rework: gaits, duck under, water take-off run, shake-off, wet sheen, company (swimming pose and stroke, take-off run, wading built) | Checks and sheets approved; feel test OK |
| 6 | Weather coupling and race/flow tie-ins (storm seas, rocking, rough-sea take-offs, rain rings, sea fog built) | Race balance report; feel test OK; owner GPU review |
| 7a | Wind-wave spectrum; wave particles (CPU + GPU splat), fed by hulls, the dragon and splashes (built) | Wake-angle and energy checks pass; budgets met; owner GPU review |
| 7b | Vessels as floating rigid bodies with LOD; propulsion/rudder forces; moorings | Period, stability and interaction checks pass; CPU ≤ 1 ms |
| 7c | Foam and spray from breaking, propellers and impacts; advected foam texture (built) | Owner GPU review; ≤ 0.3 ms |

## Risks

- Physics/visual mismatch is worse than no feature: strand 1 comes first and the parity test gates the rest.
- Underwater rendering is GPU-heavy and cannot be judged headless: keep it behind stage 4 and owner review.
- Physical vessels change traffic behaviour (slower turns, drift): the navigation controller must be retuned so ferries
  still dock on time; the old kinematic path stays available as a fallback per vessel class.
- Collisions with ships and piers under water: vessels had no colliders at all; stage 3 added underwater hull boxes
  (above the water ships still have none: a skimming dragon passes through their upper works).
