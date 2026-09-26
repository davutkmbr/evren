# Phase 20 — Movement variety, combos and flow

Milestone: B · Chill loop (with a skill ceiling) · Effort: L · Depends on: 05 (flight feel), 13 (ring races)

Status: stages A, B, C and D built, and landing v2 (the approach and flare, after the owner's stage A feedback); stage
D v2 (chain bursts and perceived speed, after the owner's stage D and race feedback) built; all awaiting the owner's
feel test (plan agreed with the owner on 26 September 2026).

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
  slow / double tap; release or Space catches). (The urge on V was removed on 26 Sep, see below.)
- Ground (`locomotion.ts`, `GROUND`): walk 3.5 m/s, run 9 m/s, standing leap take-off (crouch 0.3 s, leap 8 m/s up),
  running leap from a run (Shift + W, then Space / L; stage A). (The V gallop run-up was removed on 26 Sep.)
- Landing (`LANDING`): approach, flare, settle; touchdown ground speed ≤ 6 m/s. A fast approach flares hard to shed
  speed instead of running it out. (Superseded by stage A's run-out and landing v2 below.)
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

- **Harmony, not a combo table** (owner, 26 September: more moves will come; combinations should work because
  everything harmonises with everything, not through tables): flow is built from the physical harmony between
  consecutive motions, measured from the state (energy kept against plain gliding, no jerk across the handover,
  momentum carried, the natural beat, the world used, variety). Any move, and unnamed hand-flown manoeuvring, takes
  part without a pair table or a per-move score. Flow (0–1) decays slowly in steady flight and drops on a stall,
  contact or wasted energy. As built: stage D below.
- **Payback:** flow lowers drag slightly (up to −8 %) and raises the power stroke's surge; the effective top cruise
  speed rises by up to ~5 m/s at full flow. Capped, so it rewards execution without breaking the energy model.
- **Chain bursts** (stage D v2): every clean chain link gives an instant, felt push forward (+15 / 20 / 25 % of the
  airspeed for link 1 / 2 / 3 and on, over 1.2 s, capped), so chaining the right moves pays in the moment, not only
  through the slow payback. As built: stage D v2 below.
- **Timing bonuses ("Kusursuz"):** generic: when a harmony term peaks (near-perfect energy stewardship, a move
  started exactly on the beat, a seamless handover, a clean pass at the lowest safe clearance or through a snug ring)
  a small extra flow step and a short caption.
- **Readability:** the HUD shows flow as a thin line under the stamina wings (same visual family, the design
  language's contextual reveal: only while a chain is alive) and the chain length as a small "×3" at its right end;
  chain captions reuse the maneuver caption. No score numbers flying around.
- **Races:** speed rings, gates under bridges and skim-friendly legs are placed so chains pay off. Medal targets
  (stage D v2): bronze reachable with plain flying, silver needs some chaining, gold needs sustained flow (target: a
  skilled chained run 15–25 % faster than a clean unchained run on each built-in course; stage D had 6–10 %).

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

### Stage B as built (awaiting the owner's feel test)

- **Code:** power stroke, dart and side-slip in `src/dragon/flight/maneuvers.ts` (the power stroke runs on top of the
  normal law; dart and side-slip are tricks with their own control laws, `TrickKind` `'dart'` /
  `'slip'`), the skim in `src/dragon/flight/skim.ts` (called from `airborne.ts` before the aerodynamics), pose and
  rider cues in `pose.ts`, gestures in `src/core/gestures.ts` (`DoubleTapRecognizer`, used by `core/input.ts`), new
  pilot edges `powerPressed`, `slipLeftPressed`, `slipRightPressed` (`types.ts`, `pilot.ts`). Tunables: `POWER_STROKE`,
  `DART`, `SLIP`, `SKIM` in `params.ts` (plus `PROXIMITY.pilotLandGain` / `pilotLandClimb` / `pilotFloorSoften`).
- **Flow hooks:** every move announces its start on the `maneuver` event (captions "Güç vuruşu", "Ok gibi", "Kayış",
  "Sıyırma") and marks its end with `ended: true` and `clean` (no contact, no stall, exit speed ≥ entry −
  `cleanTolerance`, not cut short); the finished moves are also kept in `Maneuvers.log` (`MoveRecord`: entry / exit
  speed, height change, lateral shift, heading change). Refusals use the existing hint style ("Güç vuruşu için ejderha
  yorgun", "Ok gibi atılmak için yer yok / düz uç", "Kayış için yer yok / hızlan", "Ejderha yorgun").
- **Güç vuruşu (Space ×2):** two deep, full-amplitude downstrokes: the first tap's downstroke still under way counts
  as the first (deepened), otherwise the next starts at once; flap force × `thrust` (2.6) faded out as the surge
  reaches entry + `gain` (5 m/s); the path hold keeps it level. Costs 0.07 stamina up front, refused below 0.12 or
  while tired. Sounds: a whoosh. Pose: full strokes reaching forward, neck stretched forward and down, the tail pumping
  with the strokes, the rider's hands pumping with each downstroke.
- **Dart (Shift ×2 above 30 m/s, flight path within ±25°):** wings half folded (spread 0.5, sweep 0.8) and the body
  streamlined (parasite drag × 0.6) for 1 s, a push-over onto a −15° path (shallower below 12 m of clearance, level
  below 4 m), then the wings open on their own over 0.35 s with a soft wing snap. A / D steer with up to 30° of bank.
  Physics decides the gain: the drag area drops to ~0.4–0.5 of plain gliding, so a 1 s shallow dive at 34 m/s ends
  ~+0.9 m/s over its entry and ~+2.8 m/s over plain gliding for ~7 m of height. Pose: neck and tail in line (an
  arrow), rider flat on the neck.
- **Kayış (Q / E ×2):** a sideways shift of 1.1 body lengths (the rig's 18.5 m nose to tail, 20 m) over 1.7 s with the
  heading held: a sine-shaped lateral acceleration profile (out, then back to zero lateral speed) made of the lift of a
  quick bank into the slip and out of it (35°, leading by 0.15 s) and a muscle push for the rest (the outer wing's
  asymmetric downstroke and the tail flick, capped at 4 g), with feedback on the offset. Costs 0.04 stamina. Refused
  without room: horizontal rays along the slip from four points along the track (body, feet and raised-wing height)
  must reach the shift + half the span + 4 m without a hit, and at the destination the ground or a roof must stay 3 m
  below the feet and nothing lower than 6 m above; also refused below 16 m/s or tired. Sounds: a wing snap and a
  whoosh. Pose: the wing twist flicks into the slip and back, the tail sweeps out opposite, the head looks where the
  body goes, the slip-side rein comes back.
- **Sıyırma (automatic):** foot clearance below 6 m (full from 3 m) over water or flat open ground (no structure below,
  the surface ahead level within 1.5 m), at 20 m/s or more (full from 24), bank under 12°, wings spread, no trick
  running. On top of the physical ground effect it cuts the induced drag by up to 45 % and the parasite drag by 10 %
  (drag area × 0.83 of the plain ground effect at 3.2 m). The tail is lowered until it kisses the surface (0.45 m over
  land, touching the water), the wingtips at the bottom of the stroke and the tail tip throw a thin line of spray
  (the water skim's `splash` events) or dust over land. The stroke amplitude keeps a 0.6 m wider wingtip margin while
  skimming (the membrane's trailing edge early in the upstroke reaches lower than the fitted stroke bottom). The water
  skim of `airborne.ts` (feet and belly in the water) stays the contact that follows when the dragon goes too low. A
  skim held 0.5 s is announced (caption at most every 8 s) and its end reported like the other moves.
- **Assist clearance:** pushing W low over land used to overshoot the 1.5 m pilot floor (the feet reached the ground
  and the wingtips went through it); below the floor's clearance it now also climbs by the height missing
  (0.12 rad/m, up to 0.15 rad), and within 4 m of it the stick's push fades out over the last 6° of path above the
  floor. Descents from higher up are unchanged.
- **Gesture collisions:** see `core/gestures.ts`. One 300 ms window for every double tap; the first tap always acts as
  a plain press (one Space beat, a short Shift fold, a rudder blip) and the move the second tap starts takes over.
  Space ×2 is ignored while diving with Shift held, braking, hovering, taking off or under water (so Space
  still catches a free fall or a steep dive, and still strokes and breaches under water; on a landing approach the
  first tap goes around and the second strokes). Shift ×2 is the dart only
  above 30 m/s from about level flight; slower, or already diving steeply, it stays the free fall. Shift held on after
  the dart's second tap is ignored until released (the wings reopen as planned), like after a catch. The dart's
  shallow path never arms a plunge. Q / E held after the double tap keep the rudder once the slip ends. A / D ×2 and
  S ×2 are unchanged.
- **Checks:** `tools/headless/air-moves-check.ts` (gesture unit tests, collisions in the flight model, per-move
  envelopes and refusals, skim drag and clearance on the rig mesh); the mesh part measurements moved to
  `tools/headless/pose/parts.ts`. Pose scenarios `power`, `dart`, `slip`, `skim`, `skim-water`.
- **Not yet:** audio beyond the existing whoosh / wing-snap / splash cues; the flow system that consumes the clean
  flags (stage D).

### Stage C as built (awaiting the owner's feel test)

- **Code:** the three reversals are tricks in `src/dragon/flight/maneuvers.ts` (`TrickKind` `'wingover'`,
  `'immelmann'`, `'splits'`) with their own control laws; gesture resolvers and `AxisPress` in `src/core/gestures.ts`;
  pose and rider cues in `pose.ts` (`Maneuvers.reversalCue`). Tunables: `WINGOVER`, `IMMELMANN`, `SPLIT_S` and
  `REVERSAL_POSE` in `params.ts`. No new pilot edges: S ×2 and A / D ×2 are resolved by the flight state, the
  Immelmann reads the held roll axis.
- **Flow hooks:** captions "Kanat üstü dönüş", "Immelmann", "Split-S"; each end is marked on the `maneuver` event with
  `ended: true` and `clean`, and logged in `Maneuvers.log` (`MoveRecord` now also carries the track's `headingChange`
  and `energyRatio` = specific energy ½V² + g·Δh at the end over the entry's, height measured from the entry, for every
  move). Clean = no contact, no stall, not cut short, upright, the track within ±15° of the reverse heading, and the
  move's trade: the wingover keeps ≥ 90 % of the entry energy, the Immelmann ends higher (keeping ≥ 75 %), the Split-S
  ends lower and faster. Refusals: "Kanat üstü dönüş için hızlan / düz uç / yüksel / yer yok", "Ejderha yorgun",
  "Immelmann için yer yok", "Split-S için hızlan / yüksel".
- **Kanat üstü dönüş (wingover, S ×2 while banked more than 45°; up to 45° it stays the loop):** a climbing turn
  toward the low wing, a pivot over the high wing at low speed (the bank passes 90° to ~120° and the nose slices
  through the horizon), a dive out rolling level on the reverse heading. The flight path follows a plan over the
  heading turned (p = heading / 180°): γ = 50° · f(p) on the climb and 45° · f(p) in the dive, f = sin(2πp) eased in
  and out; each substep the lift vector is solved for it (vertical part: the path's curvature plus gravity, floored at
  −0.3 g over the top and −0.45 g in the dive; horizontal part: from tan(entry bank) to 1.15 g, 0.7 g in the dive,
  0.6 g as it rolls out) and the dragon rolls about the flight path to point it; the climb keeps at least 34° of bank
  (a climbing turn, not a straight pull-up); the pull out of the dive is capped at 2.2 g (it runs a little deeper and
  comes out faster). Wing beats: 0.9 effort on the climb, 0.6 in the dive, full while slow over the top. The dragon's
  drag is high (L/D ≈ 6.5: a glide loses ~10 % of its energy per second at 36 m/s), so the beats are what keeps the
  energy; they cost stamina like any beat (plus 0.03 up front). Entry: ≥ 24 m/s, path within ±30°, clearance ≥ 25 m,
  45 m of headroom, and room along the turn (rays along an inner and an outer arc of the planned radius V² / (1.15 g)
  with the wingtip margin, columns below at ≥ 25 m and overhead above the climb). Near the ground the dive out gets
  shallower. Ends at 95 % of the turn; the normal law rolls the last degrees out.
- **Immelmann (A / D pressed during the top of a loop, loop angle 99°–194°):** the loop pulls on until the path is level
  on its back, then a half roll about the flight path toward the key's side (3.6 rad/s, wings at 0.8 spread) brings it
  out upright on the reverse heading, a loop's height above the entry. A fresh press on the roll axis (past 0.5 after
  a release below 0.2) or an A / D double tap counts; earlier in the loop A / D do nothing, as before. Refused under a
  ceiling lower than half the span plus the margin ("Immelmann için yer yok"); the loop's own entry checks apply.
- **Split-S (A / D ×2 in a dive steeper than 30°):** decided: only from a steep dive (W or Shift first). From level
  flight and shallower dives A / D ×2 stays the barrel roll, so the roll never changes meaning in level flight. A half
  roll onto the back about the flight path (4.2 rad/s, wings half folded, the dive goes on straight), then a pull
  through the bottom of a half loop in the entry's vertical plane (4 g, 0.35 s onset, wings open part way at dive
  speed like the catch) to level flight on the reverse heading. The caption comes with the pull (a wing snap and a
  camera jolt). A point-mass prediction (half roll + pull through, drag included) gives the height it needs; it is
  refused when the lowest point would come closer than 18 m to the surface (now, along the track and below the
  farthest point and the end of the pull), and pulls up to 4.8 g if the bottom gets close anyway. From a 40° dive at
  36 m/s it takes ~150 m (the dragon's drag keeps the speed gain to ~+14 m/s). The key still held when the half roll
  ends keeps spinning instead: the diving barrel roll finishes the revolution (and more while held), so the spinning
  dive stays. Shift held from the dive is ignored after it until released (the wings stay open).
- **Pose:** the wingover twists the wings into the pivot, raises and turns the head into the turn, sweeps the tail out
  opposite (a rudder), the rider leans into it with the inside rein back; the loop, the Immelmann's pull and the
  Split-S's pull hold the neck raised into the pull (instead of the horizon-seeking neck that would crane it back
  past the vertical) with the tail trailing in line; the half rolls twist the wings, turn the head toward the roll,
  sweep the tail opposite, the rider pulls the rein on the roll side and leans with it. Sounds: whoosh at the start,
  wing snap at the Immelmann's roll and the Split-S's pull.
- **Checks:** `tools/headless/air-moves-check.ts` section 7 (energy table: wingover 28 / 32 / 38 m/s exits
  6–7° off the reverse heading with ×1.08–1.18 of the entry energy, ~13–16 m lower and ~+5–6 m/s faster, slow
  (24–27 m/s) and past knife-edge over the top; Immelmann +46–60 m, ≤ 3° off; Split-S −150 to −200 m, +13–15 m/s,
  < 1° off; refusals; collisions; the spinning dive), gesture resolvers and the axis press in section 1. Pose
  scenarios `wingover`, `immelmann`, `splits`.
- **Not yet:** a wingover entry faster than ~43 m/s keeps less than 90 % of its energy (unclean, still flies); the
  flow system that consumes the clean flags (stage D, built below).

### Stage D as built (awaiting the owner's feel test)

Owner direction (26 September): more moves will come; combinations should work because everything harmonises with
everything, not through constants or tables. So flow has **no pair table and no per-move score**: every motion is
judged by the same physical harmony terms, measured from the state, and a new move (or unnamed hand-flown
manoeuvring) takes part without registering anything.

- **Code:** `src/dragon/flight/flow/` — `params.ts` (the global knobs, `FLOW`), `types.ts` (`MotionSnapshot`,
  `MotionDescriptor`, `HarmonyTerms`), `harmony.ts` (the terms, pure functions), `segmenter.ts` (motions from the state,
  energy bookkeeping, `referenceGlideRate`), `flow.ts` (`FlowSystem`: flow value, payback, moments, debug lines),
  `debug-overlay.ts` (`?flowdebug=1`). Hooks (additive): `FlightSim.flow` stepped at the end of `FlightSim.step`, fed
  by `FlightSim.emit` (maneuver events) and reset on teleport; `FlightSim.musclePower` (airborne.ts: the wing beats' and
  pushes' power into the motion through the air); all aerodynamic drag × `flow.dragScale` and the flap force ×
  `flow.thrustScale` in `airborne.ts`; the power stroke's surge × `flow.powerGainScale` / `powerThrustScale` in
  `maneuvers.ts`; `DragonState.flow` and `notePass()` (gates and speed rings, `passTightness()` in
  `activities/race.ts`); `addVelocity` re-bases the energy integration (a speed ring's push is not the dragon's).
  HUD: `src/ui/hud/flow-line.ts`. Maneuver id `'flow'` (caption "Kusursuz …").
- **Motions (segmenter):** a *named* motion starts on the sim's `maneuver` event (any id but hints, the plain
  `takeoff` and the flow's own captions; a landing approach is a motion too, judged energy-neutral) and ends on the move's `ended` event, on the next named start, or once the maneuver
  system is idle and the manoeuvring has settled. An *unnamed* motion opens when the activity
  max(|ω| / 0.4 rad/s, |n − 1| / 0.55, |γ| / 20°) (low-passed 0.15 s, lift load only so the beat's own force does not
  count) stays above 1 for 0.2 s, and closes below 0.6 for 0.4 s; shorter than 0.5 s or turning less than 25° (and
  changing little height and speed) is not a motion. Each descriptor: entry / exit snapshots (air path, speed, total
  specific energy ½V² + g·h, attitude, low-passed body rates and lift load, the active rhythm's phase / strength /
  frequency and its natural breaks, clearance, ceiling gap, updraft, stamina), the energy integrals over the motion and
  the gap before it, rotation amounts, heading change, mean load, the handover jerks, entry / exit rates, the early
  path, the recent peak speed, the world proximity and the tightest pass, contact / stall and the move's own verdict.
- **Energy bookkeeping:** every substep the specific energy change net of the muscle work (`musclePower`) is
  integrated against the reference loss of *plain gliding* at the same airspeed and height from the sim's own drag
  model (`referenceGlideRate`: lift = weight, the cruise wing the normal law picks for that speed, no ground effect, no
  brake). In plain flight the two agree to < 0.5 %; drag cuts (dart, skim, flow), the ground effect and rising air show
  up as saved energy, hard pulls and brakes as lost energy. Neutral on the ground, in the water and in the deliberately
  slow modes (landing approach, hover).
- **Harmony terms** (0..1, `harmony.ts`), for the transition from the previous motion A into motion B:
  - *energy* e = 1 / (1 + exp((x − 0.5) / 0.3)), x = (net loss − reference loss) / reference loss over B and the gap
    before it (x = 0, as plain gliding: 0.84; x ≤ −0.5, half the loss or a gain: ~1; x = 1: 0.16).
  - *continuity* c = exp(−½((j_n / 12 g/s)² + (j_ω / 25 rad/s²)²)) from the largest jerk of the low-passed lift load and
    body rates within ±0.3 s of the handover; an abrupt reversal earns back up to half of the rest when it is itself
    energy-efficient (e > 0.8).
  - *alignment* a = 0.4 · exp(−(θ / 22°)²) + 0.3 · rate agreement + 0.3 · (V_entry / V_peak)⁶: θ between the handover
    velocity and B's mean path over its first 0.6 s, the agreement of A's exit and B's entry body rates (1 same sense,
    0 reversed, 0.6 when either hardly rotates), the entry speed against the peak of the last 1.5 s.
  - *rhythm* r = exp(−½(Δt / 70 ms)²), Δt from B's entry phase to the nearest natural break of the active rhythm (wing
    beat: top and bottom of the stroke; swim stroke and gait: the two strokes / footfalls); 0.6 without a rhythm
    (gliding). The entry snapshot is the substep before the move changed anything.
  - *world* w = max(½ peak + ½ mean proximity, pass tightness), 0 after any contact. Proximity: surface clearance full
    at 3 m, none from 22 m (fading back out below 0.6 m: contact is never rewarded), a deck overhead full at 5 m of gap,
    none from 40 m, an updraft full from 3 m/s, all only at 18 m/s or more. Pass tightness = max((12 m / r)², offset / r)
    for a ring of radius r passed `offset` from its centre.
  - *novelty* v = 1 − Σ similarity × exp(−age / 12 s) over the last 8 motions, similarity exp(−|Δs|² / (2 · 0.35²)) of the
    signature s = (rotation about the three body axes / π, |heading change| / π, Δh / 80 m, ΔKE / (g · 60 m),
    duration / 3 s, mean load − 1). A motion repeated at once scores ~0.08; a 3-motion cycle wears out within ~18 s.
  - *chain* k = exp(−(gap / 2.6 s)²), 0 past 6 s: the handover terms only mean something between close motions.
  - Total H = 0.35 e + k · (0.2 c + 0.2 a + 0.15 r) + 0.2 w (clamped to 1). A lone motion out of steady flight tops out
    near 0.55, a chained one near 1.
- **Flow value:** each finished motion changes flow by 0.9 · (H − 0.58) · smoothstep(0.15, 0.75, v) ·
  smoothstep(0.3, 0.65, e) above the threshold and by 0.3 · (H − 0.58) · k below it (a clumsy handover costs, a lone
  motion does not); a motion with contact or a stall costs 30 % of the flow, a move's own unclean verdict forbids a gain.
  Flow leaks 0.005 /s in the air and decays 0.02 /s after 2.5 s without a motion (0.15 /s on the ground or in the
  water); the start of a stall halves it, the start of a contact keeps 35 %; sustained waste (net loss faster than 2.5 ×
  plain gliding, low-passed 0.8 s: braking, mushing) drains 0.12 /s.
- **Payback (capped, physical):** all aerodynamic drag × (1 − 0.08 f), the flap force × (1 + 0.2 f), the power stroke's
  surge gain × (1 + 0.4 f) and its thrust × (1 + 0.25 f). At full flow: drag −8 %, top cruise 48.3 → 53.1 m/s (+4.8),
  a 20 s glide still loses energy (−978 vs −1008 J/kg), the power stroke surges +6.5 instead of +3.9 m/s. Without flow
  every scale is exactly 1: plain flight is bit-identical with the flow system on or off (checked).
- **"Kusursuz" moments** (generic; one per transition at most, at least 3 s apart, only with H ≥ 0.55 and novelty
  ≥ 0.5): *ritim*, started within 35 ms of a natural break while beating, chained; *enerji*, x ≤ −0.5 over a motion of
  1 s or more; *geçiş*, chained with continuity and alignment ≥ 0.9; *çizgi*, a clean pass at ≤ 3.5 m clearance at
  speed or through a ring with tightness ≥ 0.85. +0.06 flow and the caption ("Kusursuz ritim / enerji / geçiş / çizgi")
  on the maneuver caption (zones director, maneuver priority). Random flying sees ~0.5 per minute.
- **HUD:** a 2 px line under the stamina wings in their colour and width, growing from the centre outward with flow,
  out of the layout (in the gap above the hotbar), faded in only while there is flow (contextual reveal). No numbers.
  `?flowdebug=1` lists the flow value, payback, the open motion, activity, proximity, waste and the last transition's
  terms live (top left, monospace).
- **Global knobs** (`FLOW` in `flow/params.ts`; none names a move): the term weights (0.35 / 0.2 / 0.2 / 0.15 / 0.2),
  response scales (energy mid / width, jerk scales, path angle, speed-use exponent, rhythm σ, proximity distances,
  signature σ, history size and forgetting), the chain gap, segmentation thresholds, threshold / gain / loss, leak /
  decay / drops / waste drain, the payback caps and the moment thresholds.
- **How to add a move:** emit the usual `maneuver` start event with the move's id (its caption) and, when the move
  knows when it ends, the `ended` event with its `clean` verdict (`Maneuvers.endMove` with a `MoveTracker` record does
  both), or call `sim.flow.beginMotion(id)` / `endMotion(id, clean)` for a silent move. That is all: the descriptor
  (entry / exit state, energy, rotation, rhythm, world) is measured from the state, so the move harmonises (or not)
  with every other move at once. A move that does neither still counts as an unnamed motion once it rotates, loads or
  dives enough. Tune only the global knobs; never add per-move or per-pair numbers.
- **Races:** medal paces (defaults) gold 50 / silver 44 / bronze 37 m/s over the timed distance (were 44 / 38 / 32);
  targets Boğaz turu 3:36 / 4:00 / 4:45, Haliç kıvrımı 1:40 / 1:51 / 2:12, Adalar turu 4:57 / 5:35 / 6:40
  (superseded: retuned after the urge was removed, see "Urge removed" below). The Boğaz
  speed ring of leg 2 moved to leg 9 (the long climb to the Fatih Sultan Mehmet deck, where no low line fits), so the
  other water legs are skim-friendly.
- **Checks:** `tools/headless/flow-check.ts` (harmony unit tests; baseline identity and payback; chains through the real
  sim with key gestures; random chain search) and `tools/headless/race-balance.ts` (plain vs chained pilot on every
  built-in course); helpers in `tools/headless/flow/` (`key-pilot.ts`: keys → gestures → pilot commands like the game's
  input; `chains.ts`; `fuzz.ts`; `race-pilot.ts`).
  - Chains (mean H of the chained transitions, chained vs spaced by 4–7 s of steady flight): Split-S → dart → power
    stroke 0.67 vs 0.32; wingover → power stroke 0.66 vs 0.32; loop → Immelmann → dive → dart 0.68 vs 0.49; dart →
    power → slip → roll → power 0.64 vs 0.34 (flow 0.20 vs 0); skim → landing → run-out → touch-and-go 0.85 vs 0.66
    from a plain approach (flow 0.82 vs 0.51); a side-slip started on the beat: rhythm 0.97, half-way down the stroke 0.10.
  - Fuzz (2000 random runs of 60 s, random gestures and timing, half of them chained): mean flow p50 0.07, p90 0.21,
    max 0.59; every gesture macro repeated back to back stays below a mean flow of 0.07; wasteful runs (> 1.3 × plain
    gliding's loss) stay under 0.5; the runs reaching 0.8 all fly within 1.12 × plain gliding's loss; the muscle-free
    energy never rises over 3 s without contact (also with full flow forced); top speed < 80 m/s; no NaN.
  - Race balance (superseded by the retune in "Urge removed" below; scripted pilots, real terrain, calm noon air;
    both urged the dragon on with V whenever they could and beat the wings as stamina allows; the chained pilot also dives to a low line over the water legs and zooms back to
    the gates, darts on the descents, strokes in the urges' gaps and takes the gates on the inside): Boğaz 227.3 →
    212.6 s (−6.5 %), Haliç 104.9 → 98.1 s (−6.5 %), Adalar 318.3 → 291.7 s (−8.4 %); mean flow plain 0.03–0.11,
    chained 0.89–0.92. The plain run earns silver, the chained run gold on every course.
- **Not yet:** a sound for the moments (they reuse the caption only), the rider's reaction to high flow, tuning in the
  game (feel test). The balance numbers move with any flight-model change: rerun `race-balance.ts` after one.

### Urge removed (owner decision 26 Sep)

The urge ("dehh", V: the rider's rein snap and a speed burst; on the ground a galloping run-up into the running leap;
swimming an instant leap) is gone. Reasons: a free speed button that bypassed the flow system and duplicated the power
stroke, and it made the dragon feel like a mount. V (and the gamepad's D-pad up) is unbound, reserved for a future
rider–dragon interaction in the bond phase.

- **Removed:** the `urge` input action and `KeyV` binding, `PilotCommand.urgePressed`, `Maneuvers.tryUrge` /
  `applyUrge` / the urge timers and cooldown, `TRICKS.urge*`, the `'urge'` maneuver id and its caption "Dehh!", the
  ground gallop (`GROUND.runTakeoff*`), the V leap when swimming and the V breach under water, the rider's `riderUrge`
  cue (rein snaps and heel kicks) and its animation, the `'rein-snap'` sound and its mix entry, the `CONTROL_HELP` rows
  and the pose scenario `urge`. The other rider cues (reins, tuck, point, cheer, pet, stand) are unchanged.
- **Take-offs now:** on the ground Space / L leaps: standing (vertical or bound), from a walk or a run (Shift + W) the
  running leap (`LEAP.run*`, ground speed > 2.5 m/s), at an edge the drop, tired the tired leap; a fast run-out flies
  out with the touch-and-go. On the water Space / L starts the take-off run (`SWIM_POSE.run*`, `sim.runTakeoff`, now
  used only there) into the leap; under water Space strokes and breaches. Hovering flies out with W, a landing goes
  around with Space / L (both were also reachable with V).
- **Race balance retune** (`race-balance.ts`, best of 3 chained seeds): without the urge the plain pilot steers and
  beats the wings as stamina allows; the chained pilot strings power strokes, darts on the descents and side-slips
  onto the racing line (`DEFAULT_PILOT`: moves power / dart / slip, pause 0.1 + 0–1 s, apex 0.5), dives to the low
  line over the water legs and takes the gates on the inside.

  | Course | plain | chained | gain | flow chained | gold / silver / bronze |
  |---|---|---|---|---|---|
  | Boğaz turu | 275.8 s (silver) | 252.6 s (gold) | 8.4 % | 0.70 | 4:22 / 4:47 / 5:41 |
  | Haliç kıvrımı | 126.5 s (silver) | 116.0 s (gold) | 8.4 % | 0.79 | 2:01 / 2:19 / 2:45 |
  | Adalar turu | 379.7 s (silver) | 346.1 s (gold) | 8.9 % | 0.79 | 6:01 / 6:39 / 7:53 |

  Default medal paces gold 42 / silver 38 / bronze 32 m/s over the timed distance (were 50 / 44 / 37); Adalar uses the
  defaults, Boğaz (gold 262 s vs 260) and Haliç (gold 121 s vs 125) are nudged so both runs sit 3–5 % inside their
  medal. The flow fuzz (`flow-check.ts`) no longer taps V: mean flow p50 0.06, p90 0.18, max 0.57 (was 0.07 / 0.21 /
  0.59). The race-balance pilot is chaotic: small option changes move single courses by several percent, so rerun it
  after any flight-model change.

### Stage D v2 as built: chain bursts and perceived speed (owner feedback 26 Sep, awaiting the feel test)

Owner feedback on stage D and the races: "The chained-vs-plain gap (6.5–8.4 %) is too small to feel. A race should give
visible, felt speed gains when I chain the right moves." Loops, wingovers, Immelmann and Split-S may cost time in a race;
the race-useful chains (dart on descents, dive to a skim and zoom back to the gate, power stroke on the beat, speed
rings, inside lines) must pay off clearly. Three parts: instant chain bursts, the races retuned around them, and the
same speed made to feel faster.

**1. Chain bursts** (`src/dragon/flight/flow/burst.ts`, `ChainBurst` and `BURST`; applied by `FlowSystem`)

- **A link** is a finished motion whose transition from the one before it is clean by the same harmony terms flow is
  built from: chain factor ≥ 0.45 (gap ≲ 2.3 s), harmony H ≥ 0.6, novelty ≥ 0.5, energy ≥ 0.6, the move's own verdict
  clean, no contact or stall. A speed ring (and a gate at pass tightness ≥ 0.7, the inside line) taken while a chain
  is alive (≤ 2.6 s since its last link or motion) is a link too (80 % push). No per-move or per-pair numbers.
- **Variety:** a motion of the same kind as either of the chain's last two different kinds (maneuver id; unnamed
  hand-flown motions are one kind) never pays: a clean handover of that kind keeps the chain alive but adds no link,
  so a move repeated back to back, or two moves alternated, earns nothing, while a third kind links again. The kind
  history survives a broken chain and is forgotten only after 20 s without a motion (`kindMemory`), so a pattern of
  long moves (a wingover and its roll-out, over and over) cannot relink after every pause.
- **The push:** link 1 / 2 / 3+ = +15 / 20 / 25 % of the airspeed × a quality factor (0.75 at H 0.6 → 1 at H 0.85) ×
  a flow factor (0.5 without flow → 1 at full flow: full size only in sustained flow), capped at +12 m/s per burst and
  never past 74 m/s (under the folded dive envelope; speed rings stop at 78). Delivered along the air path over 1.2 s
  with a sin² rate (no jerk at either end); a new link takes over what is left of the running burst (never stacks).
  Only in cruising modes (flying, gliding, diving); a stall or a contact breaks the chain and cancels the burst.
  Bursts are 0.6× in free flight (the game's calm direction; the activity system sets 1 during a race through
  `DragonState.setRacing`), and off with `flow.payback` off.
- **Energy bookkeeping:** a burst is outside work, not the dragon's energy management: the segmenter's energy
  integration is offset by exactly the burst's kinetic energy (`MotionSegmenter.external`). (The first version
  re-based it every substep, which dropped one substep of drag loss each time; the fuzz caught it as "free energy".)
- **Events:** the sim emits `{ type: 'chain', link, dv, source }`; the game gets `chain-link` (camera, audio, HUD).
  `DragonState.chain` (links in the current chain) and `.burst` (the push right now, 0..1) are written every frame.
  `?flowdebug=1` shows the chain, the running burst and the link count. `__flightTest.chainLink(n)` lands link n now
  (review captures).

**2. Races retuned** (`tools/headless/race-balance.ts`, `tools/headless/flow/race-pilot.ts`; on top of the urge
removal above)

- **Three racers:** plain (no moves, beats as stamina allows), some chaining (`SOME_PILOT`: the chained racer on every
  other leg, plain on the legs between) and chained (every leg; flies both skilled lines, with and without the low
  line over the water, best of 3 seeds each).
- **Pilot upgrades** (a skilled player's habits, needed once the bursts made the dragon fast enough to overshoot):
  climb-rate lead near a gate (the path lags its target by ~0.8 s; a fast zoom overshot gates by 14–18 m), the inside
  line only once the turn is settled and leaving room for the height still to correct, a go-around after a miss
  (fly out to a point in front of the gate, then take it through the centre: a gate only counts crossed in its
  direction), an orbit breaker, a clearance floor on the low line (5 m foot clearance, the skim engages below 6 m),
  a stamina reserve for the beats and variety by kind (it remembers the move it started until flow has closed its
  motion). Moves: power stroke, dart (on any fast straight), barrel roll (≥ 500 m before a gate); the side-slip onto
  the racing line is available but made the scripted line miss gates at burst speeds.
- **Payback unchanged** (drag −8 %, beat thrust +20 % at full flow): a stronger payback was tried while the urge was
  still in (drag −12 %, thrust +30 %), but without the urge the plain racer is slow enough that bursts alone reach the
  target band.
- **Before / after** (calm noon air, real terrain; seconds, gap to plain):

  | Course | Stage D (urge removed): plain → chained | Stage D v2: plain / some / chained | Mean flow some / chained | V plain / chained |
  |---|---|---|---|---|
  | Boğaz turu | 275.8 → 252.6 (8.4 %) | 275.9 / 258.5 (6.3 %) / 227.9 (17.4 %) | 0.16 / 0.63 | 39.7 / 48.3 m/s |
  | Haliç kıvrımı | 126.5 → 116.0 (8.4 %) | 126.6 / 115.7 (8.6 %) / 97.3 (23.1 %) | 0.16 / 0.51 | 42.0 / 54.3 m/s |
  | Adalar turu | 379.7 → 346.1 (8.9 %) | 379.7 / 347.7 (8.4 %) / 319.6 (15.8 %) | 0.19 / 0.45 | 40.3 / 47.5 m/s |

  (With the urge still in, the first version of this stage measured 15.7 / 16.6 / 19.9 %.) The chained racer lands
  17–27 links per Boğaz run (longest chains 2–10, +77–172 m/s of bursts in total, ~40 m/s a minute at ~6.5 m/s a
  link).
- **Medals** (gold = best chained run + 3 %, silver = plain − 3 %, bronze = plain + 12 %): Boğaz turu 3:55 / 4:28 / 5:09
  (was 4:22 / 4:47 / 5:41), Haliç kıvrımı 1:40 / 2:03 / 2:22 (was 2:01 / 2:19 / 2:45), Adalar turu 5:29 / 6:08 / 7:05
  (was 6:01 / 6:39 / 7:53). Default paces for custom courses gold 48 / silver 41 / bronze 36 m/s (were 42 / 38 / 32).
  Results: plain bronze, some chaining silver, chained gold on every course; all runs finish with no missed gate.

**3. Perceived speed** (one factor for all of it: `src/core/speed-feel.ts`)

- **Speed feel** = the player's setting × the context. Setting: Ayarlar → Görüntü → **Hareket efektleri** Tam (1) /
  Azaltılmış (0.4) / Kapalı (0), stored per viewer (`evren.ui.motion.v1`), for motion sensitivity. Context: 1 in a race
  (countdown included) and at high flow; free flight 0.35, growing to 1 between flow 0.5 and 0.95. Speed ramp 32 → 72
  m/s.
- **Camera** (`src/camera/feel.ts`): chase +6° FOV (rider +4°) with speed, a +5° kick (rider +3.5°) following each
  burst's push (fast attack, smooth release), a light high-speed shake (+0.035, +0.03 at a burst's peak), and the post
  speed effect raised (0.75 × speed + 0.35 × burst, on top of the existing one from 45 m/s). Captured in the flight
  sandbox at link 3 in a race: FOV 68.0° → 72.6° at the push peak and back, 51.8 → 61.3 m/s, streaks at the edges;
  the same link in free flight at flow 0.2: FOV 65.8° → 67.1°, 51.5 → 53.2 m/s, no visible streaks.
- **Wind streaks** (`render/post/shaders/composite.glsl.ts`, `windStreaks`): thin radial dashes flying outward at the
  screen edges, more and faster with the speed effect, brightening the scene toward its own luminance (no fixed
  colour), never over the dragon (the speed mask) or the middle of the screen.
- **Spray and wake** (`dragon/flight/index.ts`, `burstSpray`): while a burst pushes below 9 m over water, spray under
  both wingtips and a wake behind the tail every 5 m, scaled by push × feel × height × speed (FX only).
- **Audio:** the airflow bed gets a *surge* (race speeds and bursts in their context): up to +2.5 dB, +8 % loop rate,
  a brighter hiss; each link plays a burst rush (a fast bright noise sweep with a low thump, `playBurstRush`) when it
  pushes and a soft struck tone a pentatonic step higher per link (D5 E5 F♯5 A5 B5, `playChainCue`), so a growing chain
  is heard as a rising line. The audio accents follow the context only (the setting is about visual motion).
- **HUD** (`src/ui/hud/chain-counter.ts`): the chain length as "×3" at the right end of the flow line, gold, text only
  with the HUD's shadow; each link brightens it briefly (no bounce), it dims when the chain breaks and fades out 1.2 s
  later.

**Checks**

- `race-balance.ts`: 15 rules pass (every run finishes; plain bronze not silver; some chaining silver not gold;
  chained gold; chained 15–25 % faster than plain). The rules use each racer's best run; the script also prints the
  spread of the gap over every seed and line. With `--seeds 5` (26 Sep): chained Boğaz mean 9.7 ± 5.6 % (median
  12.6, range 0.5–17.4), Haliç 18.1 ± 3.6 % (median 19.7, 13.0–23.1), Adalar 13.7 ± 3.3 % (median 15.3, 9.0–19.5);
  some chaining 4.2 ± 2.0 / 7.7 ± 1.2 / 8.0 ± 0.9 %. The spread is the scripted pilot's hit rate, not the model: with
  the same number of moves (~40 per Boğaz run) the links landed range 9–27 and the time follows them almost linearly
  (a missed link window pays nothing). The 15–25 % band is what a player who chains reliably earns; an unreliable
  chainer lands between plain and gold, which is the intended skill curve.
- `flow-check.ts`: all pass, with a new section "5. Chain bursts": size by link (+6 / 8 / 10 m/s at 40 m/s and full
  flow), the cap, the flow factor, the envelope (sums to the push, peak twice the mean), the speed cap, variety, the
  link test, a varied chain through the real sim (dart → power → slip → roll → power: 3 links, longest 3; spaced 4 s
  apart: none), bursts booked as outside work, payback off → no push. Fuzz (2000 random runs of 60 s): every gesture
  macro repeated back to back stays at a longest chain of 1 (worst 2.6 m/s of bursts in 120 s; worst mean flow 0.06,
  as without bursts); random gestures (half of them chained at the best timing) do link, 3 / 6 links a minute at p50 /
  p90, but build little flow, so their links are small (3.3 m/s on average against the racer's ~6.5) and they push
  9.9 / 22.6 m/s a minute at p50 / p90, about half of the chained racer's ~40; the muscle-free energy never rises
  (max −35 J/kg over 3 s; −37 with full flow forced); top speed 82.3 m/s; flow p50 0.06, p90 0.19, max 0.66.
- `speed-feel-check.ts` (new): race full strength, free flight subtle and growing with flow, the setting scaling (off
  removes every effect), the speed ramp, camera additions bounded, free-flight bursts smaller.
- `races-check`, `air-moves-check`, `movement-check`, `lowflight-check`, `plunge-check`, `perch-landing-check`,
  `hud-zones-check`, `lift-check`: pass.
- Review sheets: `node tools/review/burst-review.mjs` (flight sandbox via `scripts/snap.mjs`; a race and free flight
  at low flow, one contact sheet each under `.shots/speed-feel/`). `SNAP_CHROME=<chromium>` runs snap.mjs with a given
  Chromium on SwiftShader (Linux containers).
- **Not yet / known:** the spray and the HUD counter are not in the sandbox captures (no FX or HUD there); the feel
  in the game (FOV and shake amounts, streak density, the tones' level) is for the owner's feel test. The balance
  numbers move with any flight-model change: rerun `race-balance.ts` after one.

### Landing v2 as built (owner feedback 26 Sep, awaiting the feel test)

Owner feedback on stage A: "On L landings the dragon comes down like an aeroplane, rigid and steady; after it lands
the run-out and the manoeuvres are good." Landing v2 rebuilds everything from pressing L to the touchdown so it reads
as a big flying animal (raptor / swan / bat); the settle, run-out and touch-and-go after the touchdown are unchanged.

- **Code:** `src/dragon/flight/landing.ts` (`LandingStyle`, owned by `FlightController.landingStyle`: the variant, the
  approach progress and path shape, checks, weave / turn, backstroke count, the flare envelope, the touchdown record),
  the laws in `controller.ts` (`landingLaw`, `runOutApproachLaw`, new `runOutFlare`, `countBackstroke`,
  `openAround`), the touchdown window and leg flex in `airborne.ts checkTouchdown`, pose cues in `pose.ts`
  (`landingNeck`, tail steering, `legReach`, the new optional `DragonPose.landFlare`), the rig's flare shape in
  `animator.ts` (neck S-curve, head, claws) and `wing-pose.ts` (wings forward, steeper stroke, cupped hand). Tunables:
  `LANDING_STYLE` (with the per-variant `variants`) and `LANDING_POSE` in `params.ts`; `LANDING` keeps the base glide
  slope, speed schedule and flare trigger (unused v1 fields removed).
- **Physics first:** every change of speed comes from the flight model. A *check* pulls the path up towards level for
  ~1 s: the nose comes above the horizon, the airbrake opens and one deep beat with the stroke tilted forward (hover
  blend) lifts instead of pushing (a beat while nose-down drove the dragon forward, so the beat waits for the nose).
  The flare's *backstrokes* are real flap force: with the body pitched 55–60° the stroke force points up and back
  (hover stroke 62° over the body), so the beats brake while they carry the weight; the stalled, cupped wing and the
  airbrake do the rest. Until the body has reared past ~18–38° the effort is capped (the wing's lift arrests the sink;
  a beat while still level would balloon it forward), except to arrest a fast sink.
- **Approach (slow landing):** the glide slope × a shape over the approach progress (0.9 at L → 1.3 in the middle →
  0.85 before the flare): a steeper drop in the middle and a round-out. Wing sweep and spread breathe on seeded slow
  waves, checks every 2–3.4 s while higher than 12 m (and 3 m above the flare height). With open air around the track
  (no deck or ceiling over it, nothing tall ahead) a seeded weave (a cosine bank of 6–9°, 2.2–3.8 s period, so the
  heading swings about the entry heading) or, for the drop-in, a final turn (24° bank over 1.8 s, seeded side) is flown
  through `overrides.bankTarget` — only while the pilot's stick and any other override leave the bank free. The head
  looks at the spot (about where the flight path meets the ground, 0.1 rad short of it) and into the weave / turn; the
  tail steers with the bank changes, wanders a little and is lowered as an airbrake.
- **Flare (slow):** starts at (1 + 0.65 × sink + 0.1 × ground speed) × the variant's scale (drop 9–12 m, shallow and
  tired from 6.5 m). The body rears to 55–61° (flare back tilt 0.55–0.78 over the hover attitude), floats down no
  faster than 1.4 m/s while the ground speed is still above the touchdown speed, the backstrokes (beat effort 0.7–0.8,
  sloppy ±30 % when tired) hold on until it stops sinking, the lift dump is small (0.18) so the wings stay forward and
  open. Then the settle: the sink profile √(0.25² + 2 × 1 × h), no faster than 0.55 + 0.7 × h (the last metre is nearly
  a hover, because the wing beat's force profile bobs the body ±0.7–1.5 m/s at hover effort), cushioning beats with
  +35 % force in the last 2.5 m, the tilt back to ~30° so the stroke points down, the touchdown speed 2.2 m/s (W / S
  adjust it). Downwash dust at each backstroke below 9 m over land (sea: the low-flight module's downwash).
- **Contact (slow):** feet within 0.6 m count as the touchdown only while sinking slower than 1.2 m/s at walking pace
  (the legs reach down the rest and the stance's settle takes it, flexing 1 m/s deeper as the wings unload); sinking
  faster, the feet wait for the ground itself (2 cm). Hind feet first (pitch ~30–35° at contact), wings high and open,
  then stage A's settle folds them over ~0.6 s while the body comes down onto the wrists.
- **Run-out:** the shallow approach (9–13° path) with the airbrake and seeded checks / weave down to 3.5 m, a round-out
  (sink 0.9 + 0.45 × h), then from 1.7 m × the variant's scale a short flare: the hover law with the pitch at the hover
  attitude + the variant's tilt, less while fast (1.6°/(m/s) above 14 m/s) and eased forward while it balloons
  (0.3 rad per m/s of missing sink), a lift dump of 0.35, one or two backstrokes (the first kicked off as the body starts
  to come up, like a tap), the hind feet down at 13–20 m/s and the run-out takes over. Still faster than 24 m/s low
  down it floats until the airbrake has taken the speed out.
- **Variants** (`LandingStyle.pick`: the most specific first, never the one used last time when another applies,
  seeded otherwise): *drop* (steep drop-in from ≥ 22 m: path × 1.3, a final turn, a big flare from higher up),
  *shallow* (≤ 45 m: a lower path, a weave, a lower flare), *tired* (stamina < 0.3: sloppier beats and weave), and for
  the run-out *glide* (flat, a shallow flare, touches ~16–20 m/s) and *swoop* (steeper, deeper flare ~25–30°, two
  backstrokes, ~13–16 m/s). `landingStyle.forceNext` picks the next one (scenarios, tests).
- **Rig:** `landFlare` (0..1, rises through the flare, fades at 3/s after the touchdown): per-bone neck S (base raised,
  upper neck bent down, sum −0.22 rad) with the pose's flare neck (−0.12 − 0.95 × pitch, allowed down to −0.9), head
  +0.12, claws opened 0.45 on the reaching feet; wings (with the flare sweep) humerus +0.16 forward and +0.1 up, more
  elevation and less fore-aft stroke, hand twisted 0.14 and outer fingers curled 0.1 (cupped). The legs reach forward
  from 10 m up in the flare.
- **Run-out skid fix:** braking from a slow, four-footed run opened the air-brake wings while the wrists were still on
  the ground (membrane below it); the spread now waits for the wrists (`ground-moves.ts`).
- **Numbers** (movement-check, before → after): slow landing (30 m, 22 m/s) contact ground speed 3.95 → 1.6 m/s, sink
  0.58 → 1.19 m/s, flare pitch 51 → 60°, backstrokes 3 → 4; run-out (8 m, 30 m/s) contact 20.4 → 14.3 m/s at a flare
  pitch of 4 → 30°, 0 → 2 backstrokes; the glide variant 17.7 m/s at 14°. Sweep over 26–60 m × 16–24 m/s × three variants: every slow landing ≤ 1.2 m/s
  sink, ≤ 3 m/s ground speed, 60° flare, ≥ 4 backstrokes; 45 m takes 7.7–9.2 s from L (v1: 7.5 s). Run-outs from
  5–20 m × 18–36 m/s: 13.8–20 m/s at contact, 1–4 backstrokes.
- **Checks:** `movement-check.ts` section "Landing v2" (`--landing` runs only the landing sections): contact sink
  ≤ 1.5 m/s and ground speed ≤ 3 m/s (slow), 8–22 m/s (run-out), flare pitch ≥ 40° (slow) / ≥ 10° with a backstroke
  (run-out), approach pitch not held constant (sd ≥ 3°, range ≥ 10°), ≥ 2 backstrokes (slow), hind feet first (the
  first part within 10 cm of the ground), wings and tail above the ground from L on, no per-frame velocity jump
  > 1.5 m/s, variants alternating. Pose scenarios `land`, `land-drop`, `land-shallow`, `land-tired`, `fastland`,
  `runout`, `runout-glide`, `runout-swoop`; the `runout-edge` drop moved from 100 to 125 m (the approach and flare
  cover ~105 m now).
- **Known:** a slow landing is up to ~1.5 s longer than v1 from high up (the float and the near-hover last metre);
  the pure hover descent from 60 m takes ~16 s (v1 13 s). Perch landings can drive the approach through
  `overrides.bankTarget` (it wins over the weave) and `landingStyle.forceNext`.

## Discoverability: contextual move hints (built, awaiting the owner's feel test)

Owner request (26 Sep): the many moves should be discoverable in play, each hint at the right moment, once (or a
few times until the move is used), quietly and key first, on the shared hint line through the zones director.

- **Code:** `src/ui/tutorial/` — `hints-data.ts` (the catalogue: id, key caps, Turkish text, trigger predicate over a
  `TutorialFrame`, hold, cooldown, max shows, learn rule, optional prerequisites and the Kontroller row), `engine.ts`
  (pure, deterministic: pacing, gates, one zone item `hint.tutorial`), `store.ts` (localStorage
  `ejderha.ui.tutorial.v1`, every access guarded), `sense.ts` (the frame from `DragonState`, geo and the zones),
  `index.ts` (`TutorialHints`, owned by the UI system). The flight now emits `maneuver-end` `{ id, clean }` for the
  moves that report their end, and `maneuver` carries the breach's `clean`.
- **Catalogue** (order = precedence when several hold at once):

  | Id | Hint | Trigger | Learned when |
  |---|---|---|---|
  | breach | [Space] Sudan fırla | under water ≥ 1 s | a breach (clean) |
  | water-takeoff | [Space / L] Sudan havalan | swimming ≥ 4 s | a take-off while swimming |
  | touchgo | [Space] Dokun-kalk | running out a fast landing, ≥ 10 m/s | a touch-and-go |
  | plunge | [Shift] Dal: suya gir | path < −20° toward water ≥ 12 m deep, coast ≥ 40 m, 30–300 m up, ≥ 18 m/s | a clean plunge |
  | splits | [A / D ×2] Split-S | dive steeper than 32°, ≥ 190 m up, ≥ 24 m/s | a clean Split-S |
  | wingover | [S ×2] Kanat üstü dönüş | bank 48–100°, ≥ 26 m/s, ≥ 45 m up, path within ±30° | a clean wingover |
  | immelmann | [A / D] Looping tepesinde: Immelmann | 2–10 s after a loop, upright, ≥ 40 m up | a clean Immelmann |
  | runout | [L] Koşarak in | 14–34 m/s, 3–30 m over flat open land, path within ±15°, 1 s | a run-out |
  | skim | Suya yakın uç: sıyırma | ≥ 20 m/s, 6–35 m over water, wings and path level, 1.5 s | a skim |
  | dart | [Shift ×2] Ok gibi süzül | level flight > 30 m/s, ≥ 20 m up, 1 s | a clean dart |
  | power | [Space ×2] Güç vuruşu | level flight at 12–22 m/s, ≥ 15 m up, stamina ≥ 45 %, 2 s | a clean power stroke |
  | flow | Hareketleri zincirle: akış | flow first rises (≥ 0.12); shown once, stays its full time | a chain of two links |
  | dive | [Shift] Kanatları kapat: dal | cruising ≥ 150 m up, 4 s | a free fall or a dive |
  | roll | [A / D ×2] Takla at | calm level flight ≥ 60 m up, ≥ 20 m/s, 5 s; after the power hint | a roll |
  | loop | [S ×2] Looping | calm level flight ≥ 80 m up, ≥ 24 m/s, 5 s; after the roll hint | a loop |
  | slip | [Q / E ×2] Kayış | steady level flight at 18–34 m/s, ≥ 15 m up, 5 s; after the dart hint | a clean slip |
  | land | [L] Yere in | < 17 m/s, < 40 m over flat open land, 3 s | a landing |

  Not duplicated: "[L] Kon" near a perch (the perch prompt), "[I] Kaynağa bak" (the moments), the hover controls and
  the start-of-game keys.
- **Pacing** (`TUTORIAL_PACING`, seconds of play; paused time, menus and photo mode do not count): evaluated 4 times a
  second; nothing in the first 45 s or while the start hints are requested; the hint line, the title and the corner
  free for 3 s; one new hint per 60 s; at most 12 per session; a hint shows 6 s and is dropped if the line is not free
  within 1 s; a non-sticky hint leaves 1.5 s after its trigger stops holding; displaced by any other message it does
  not come back. Per hint: 3 shows in total (persisted), 240 s cooldown (90–120 s for the fleeting situations); once
  the move was tried at most 2 shows and a doubled cooldown; learned (clean) = never again; performing the move while
  its hint shows removes it at once.
- **Gates:** a race (the `race` zone context or `DragonState.racing`), a landing approach (`landing` mode), perching
  (a perch offer, approach, perched viewing, the leap off), no dragon, a busy hint line (moments' subtitle lines and
  cards, captions, perch prompts, hover hints); the UI suspends the engine while a menu, the map, photo mode or a
  hidden HUD is up. Priority `HUD_PRIORITY.tutorialHint` (20): below the start hints, above toasts.
- **Settings:** Ayarlar → Oyun → İpuçları: the "İpuçları" switch (on by default) and "İpuçlarını sıfırla".
- **Pause menu:** Kontroller marks the rows of moves not yet tried with a small gold dot, explained once under the
  rows ("Henüz denemediğin hareket"); the H overlay's compact list is unmarked.
- **Checks:** `tools/headless/tutorial-check.ts` (every entry fires in its situation, pacing, hold, cooldown, max
  shows, tried / learned, relevance, gates, one at a time, persistence round trip, sense).
- **Not yet:** gamepad key names in the hints (the hints name keyboard keys, like `CONTROL_HELP`); the plunge,
  breach and swimming rows in `CONTROL_HELP`.

## Controls summary (additions)

| Gesture | Move |
|---|---|
| Fast touchdown | run-out; Ctrl/X stop, Space fly out |
| Space ×2 | güç vuruşu |
| Shift ×2 (fast; slow: free fall as before) | dart |
| S ×2 while banked | wingover (level: loop, unchanged) |
| A/D at the top of a loop · A/D ×2 in a dive steeper than 30° | Immelmann · Split-S |
| Q/E ×2 | kayış |
| low and fast | sıyırma (automatic) |

`CONTROL_HELP` and the pause menu's Kontroller view get these rows (group "Hız ve figürler").

## Risks

- Gesture collisions (double taps vs. held keys): each gesture gets a unit-tested input recogniser and the
  existing double-tap window (300 ms).
- Feel can only be judged in the game: keep every parameter in `params.ts`, one owner feel test per stage.
- Flow must not make plain flying feel slow: the unchained baseline stays exactly as today.
