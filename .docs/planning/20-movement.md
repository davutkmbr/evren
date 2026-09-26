# Phase 20 — Movement variety, combos and flow

Milestone: B · Chill loop (with a skill ceiling) · Effort: L · Depends on: 05 (flight feel), 13 (ring races)

Status: stage A built, awaiting the owner's feel test (plan agreed with the owner on 26 September 2026).

## Goal

The dragon moves in more ways, and the moves chain. A calm player never has to learn any of it; a player who wants
to go fast can read the air and the course and string moves together to beat the medal times. Three strands:

1. **Ground:** a fast landing turns into a run you can stop or fly out of; take-offs leap and beat hard.
2. **Air:** five to six new moves that feel like a big animal flying, not a plane doing aerobatics.
3. **Flow:** clean chains of moves pay back in speed (capped, skill-based, readable), which is what makes combos a
   racing tactic.

Principles (from the GDD pillars):
- **Physics first.** Speed comes from energy: altitude → speed in a dive, speed kept by clean exits. Bonuses only
  reward execution on top of that; they never replace the energy model.
- **Same keys, more meaning.** New moves are gestures on existing keys (double taps, holds, context), not new keys.
  The hotbar (1–5) stays for abilities and items; B, J, K are the course editor's.
- **The dragon helps.** Every move has a safe version: moves refuse (with the existing hint style) when there is no
  room, and the hands-off assist still guards clearance between moves.
- **No fail state.** A botched move costs speed or stamina, never a crash screen.

The sea (low flight, plunge dives, breach, swimming) is planned in [phase 21](21-sea.md) and shares the skim, the
breach and flow with this phase.

## Current state (what exists)

- Modes: flying, gliding, diving, hovering, stalling, landing, grounded, takeoff, swimming (`FlightMode`).
- Tricks (`maneuvers.ts`): barrel roll (A/D double tap), loop (S double tap), free fall with wing-snap catch (Shift
  slow / double tap; release or Space catches), the urge (V).
- Ground (`locomotion.ts`, `GROUND`): walk 3.5 m/s, run 9 m/s, standing leap take-off (crouch 0.3 s, leap 8 m/s up),
  running take-off from the urge (gallop to 12 m/s, then leap).
- Landing (`LANDING`): approach, flare, settle; touchdown ground speed ≤ 6 m/s. A fast approach flares hard to shed
  speed instead of running it out.
- Pose (`PoseDriver` → `DragonPose`): flap phase/amplitude, spread, sweep, twist, neck, jaw, tail, legs tuck,
  walk phase/amount, breath, rider cues.

## Strand 1 — Ground

### 1a. Run-out landing ("koşarak iniş")
- Trigger: touching down on walkable ground (land, road, roof, deck) with ground speed above `runOutMin` (≈ 8 m/s)
  and a shallow path (≤ 12°); steeper or faster than `runOutMax` (≈ 22 m/s) still flares first.
- Motion: the hind legs reach forward before contact, first contact on the hind feet, the fore legs come down one
  stride later; a gallop that decelerates (`runOutDecel` ≈ 3–4 m/s², more with the brake) while the wings stay
  half open for balance and fold as the speed drops; the tail counterbalances.
- Control while running: Ctrl/X brakes harder to a stop (skid, claws dig, wings flare as air brakes); A/D steer;
  Space (or holding W with speed) flies out: a two-beat run-up and a leap straight back into flight, keeping most of
  the ground speed ("touch-and-go"). If the path ahead ends (edge, water, obstacle), the dragon leaps on its own.
- Terrain: follows slopes within `GROUND.maxStep`; on water the run becomes a skim and a splash take-off.

### 1b. Leaping take-off ("sıçrayarak kalkış")
- Standing: a slow, deep crouch (0.6–0.8 s, 0.7–0.85 m, owner feedback 26 Sep: chest low, wings raised high and back, tail down), an explosive push
  (hind legs extend, fore legs push off a beat later), two or three full-amplitude downstrokes with the neck
  stretched forward, legs tucking only after the second stroke.
- From a walk or run: the leap blends into the stride (no stop to crouch).
- Variations (picked by context and a seeded random, never the same twice in a row): a straight vertical leap from
  a perch or roof edge (drop and snap the wings open), a low skimming take-off over water, a tired take-off (slower,
  an extra stroke) at low stamina.

## Strand 2 — Air moves

| Move | Gesture | What it does | Tactical use |
|---|---|---|---|
| **Güç vuruşu** (power stroke) | Space double tap | Two deep, full-amplitude downstrokes: a short thrust surge (+4–6 m/s over ~0.8 s), costs a chunk of stamina | Recover speed after a turn or a gate; start of many chains |
| **Dart** | Shift double tap while fast (> 30 m/s) | Wings half folded for ~1 s: drag drops, a shallow dive, speed builds; opens again on its own | Shoot through a gap or a low gate; bridge between moves |
| **Wingover** | S double tap while banked > 45° (level = loop, as today) | Climb, pivot over the high wing at low speed, dive out on the reverse heading | A U-turn that keeps energy (altitude becomes speed on the way out) |
| **Immelmann / Split-S** | A/D during the top of a loop / A/D double tap while diving steeply | Half loop + roll out on top (gain height, reverse) / half roll + half loop down (lose height, reverse, gain speed) | Reverse direction trading height and speed on purpose |
| **Kayış** (side-slip) | Q/E double tap | A quick sideways shift of one to two body lengths with a wing and tail flick, keeps heading | Line up with the next gate or dodge without turning |
| **Sıyırma** (surface skim) | Automatic below ~6 m over water or flat ground at speed, wings level | Ground effect: less drag and induced drag, wingtips and tail kiss the surface (spray on water) | Low, fast lines; risky near obstacles |

All moves have entry conditions (speed, clearance, attitude, stamina), a clean-exit window and a failure
path (a stall, a scrape, a slow exit) that costs speed, never control.

## Strand 3 — Flow ("Akış") and speed

- **Chain:** a move that ends cleanly (no stall, no contact, exit speed ≥ entry speed − small tolerance) within
  `chainWindow` (≈ 2.5 s) of the previous clean move extends the chain. Each chain step adds to a flow value
  (0–1); flow decays slowly in steady flight and drops on a stall or contact.
- **Payback:** flow lowers drag slightly (up to −8 %) and raises the power stroke's surge; the effective top cruise
  speed rises by up to ~5 m/s at full flow. Capped, so it rewards execution without breaking the energy model.
- **Timing bonuses ("Kusursuz"):** a catch at the ideal pull-out moment, a dart exited right at a gate, a skim
  held through a speed ring give a small extra flow step and a short caption. Windows are tight but readable
  (0.2–0.3 s, telegraphed by sound and the rider's posture).
- **Readability:** the HUD shows flow as a thin line under the stamina wings (same visual family, the design
  language's contextual reveal: only while a chain is alive); chain captions reuse the maneuver caption. No score
  numbers flying around.
- **Races:** speed rings, gates under bridges and skim-friendly legs are placed so chains pay off. Medal targets:
  bronze and silver reachable with plain flying; gold needs flow (target: a skilled chained run ≈ 6–10 % faster
  than a clean unchained run on each built-in course).

## Tooling and verification (no GPU needed for most of it)

- **Pose strip** (`tools/headless/pose-strip.ts`): builds the real rig in Node, drives scenarios through the real
  sim and pose driver, renders silhouette contact sheets. Every new movement gets a scenario and a before/after
  sheet.
- **Flight checks** (extend `tools/headless/lift-sim.ts`/a new `movement-check.ts`): scripted inputs for each move
  and chain; measure entry/exit speed, altitude change, time, stamina, flow; assert the envelopes (e.g. wingover
  exits on the reverse heading ±15° with ≥ 90 % of the entry energy; run-out stops within the expected distance;
  touch-and-go keeps ≥ 70 % of ground speed).
- **Race balance:** a scripted pilot flies each built-in course plainly and with chains; report both times against
  the medal targets.
- **Owner's feel test** after every stage (timing, weight, camera), since the tools cannot judge feel.

## Stages

| Stage | Content | Done when |
|---|---|---|
| A | Pose-strip tool; run-out landing and touch-and-go; leaping take-off variations | Sheets approved; run-out/stop/fly-out checks pass; feel test OK |
| B | Güç vuruşu, dart, kayış, sıyırma | Move checks pass; sheets approved; feel test OK |
| C | Wingover, Immelmann / Split-S | Energy checks pass; feel test OK |
| D | Flow, timing bonuses, HUD line, captions; race tuning | Chained runs 6–10 % faster than plain; medal targets retuned; feel test OK |

### Stage A as built (awaiting the owner's feel test)

- **Code:** `src/dragon/flight/ground-moves.ts` (stance, gaits, run-out, leaps; a sub-state of `grounded`, no new
  `FlightMode`), the run-out approach in `FlightController.runOutApproachLaw`, touchdown routing in
  `airborne.ts checkTouchdown`, pose cues in `pose.ts`, the rig's ground plane / gait / raised-wing IK in
  `animator.ts`. Tunables: `GROUND` (stance geometry, settle), `GAIT`, `RUNOUT`, `LEAP` in `params.ts`.
- **Gaits:** stride frequency from a speed table; the rig plants each foot for the sweep its legs reach, so a planted
  foot moves back exactly as fast as the body goes forward. Walk (lateral sequence) → trot → gallop (hind pair, fore
  pair, suspension phases) with a bounding body and spine flex.
- **Touchdown:** the stance starts from the landing's pitch, height and sink and settles on springs (hind feet
  first, the body pitching down onto the wrists as the wings fold); the wing beat finishes at the top of the stroke
  instead of sweeping through the ground; the tail curls up by the geometry it needs near the ground.
- **Run-out:** L fast and low over land flies a shallow approach (≤ 10°) with the airbrake scheduling the speed down,
  a round-out, and floats while still faster than `RUNOUT.maxSpeed`. Touchdowns between 8 and 22 m/s run out:
  bipedal strides with the wings half open while fast, then the wrists come down; Ctrl/X skids (wings as air brakes,
  claws dig), A/D steer and lean, Space or a fresh W at ≥ 8 m/s flies out (two strides with the wings rising, then
  the push). An edge, water or an obstacle ahead makes it leap on its own; slow, it brakes instead.
- **Leaps:** crouch (chest low, hands and fingers raised high and back, tail down), a push-off that ramps the
  velocity through the legs (wrists lift a beat after the hind feet), the first full downstroke at lift-off with a
  forward-reaching stroke, legs tucked after two strokes (tired: three). Variants: vertical and bound (standing,
  alternating), running, drop (edge ahead), tired; the most specific applies, never the same twice in a row.
- **Checks:** `tools/headless/movement-check.ts` (gait slip and lift, touchdown continuity, wings / tail / feet
  above the ground, run-out stop distances against the `RUNOUT` model, touch-and-go retention, push-off, first
  stroke, leg tuck, variant rotation, hover bank); pose scenarios `trot`, `runout`, `touchgo`, `runout-edge`,
  `leap`, `leap-run`, `leap-drop`, `leap-tired`.
- **Bank drift:** without an environment the wind model falls back to a 4.5 m/s default wind with gusts, so the
  headless hover held a crosswind by banking up to the near-ground limit (17°). The pose runtime now flies in still
  air by default (the hover holds 0°); in the game the bank into a real crosswind is intended.
- **Not yet:** the `CONTROL_HELP` rows for the run-out (UI, later), the skim over water (phase 21 / the water work).

## Controls summary (additions)

| Gesture | Move |
|---|---|
| Fast touchdown | run-out; Ctrl/X stop, Space fly out |
| Space ×2 | güç vuruşu |
| Shift ×2 (fast) | dart |
| S ×2 while banked | wingover (level: loop, unchanged) |
| A/D at the top of a loop · A/D ×2 in a steep dive | Immelmann · Split-S |
| Q/E ×2 | kayış |
| low and fast | sıyırma (automatic) |

`CONTROL_HELP` and the pause menu's Kontroller view get these rows (group "Hız ve figürler").

## Risks

- Gesture collisions (double taps vs. held keys): each gesture gets a unit-tested input recogniser and the
  existing double-tap window (300 ms).
- Feel can only be judged in the game: keep every parameter in `params.ts`, one owner feel test per stage.
- Flow must not make plain flying feel slow: the unchained baseline stays exactly as today.
