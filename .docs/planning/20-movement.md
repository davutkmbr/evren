# Phase 20 — Movement variety, combos and flow

Milestone: B · Chill loop (with a skill ceiling) · Effort: L · Depends on: 05 (flight feel), 13 (ring races)

Status: stages A, B and C built, awaiting the owner's feel test (plan agreed with the owner on 26 September 2026).

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

### Stage B as built (awaiting the owner's feel test)

- **Code:** power stroke, dart and side-slip in `src/dragon/flight/maneuvers.ts` (the power stroke runs on top of the
  normal law like the urge; dart and side-slip are tricks with their own control laws, `TrickKind` `'dart'` /
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
  flow system that consumes the clean flags (stage D).

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
