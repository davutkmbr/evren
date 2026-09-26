# Phase 04 — Landing and takeoff variety

Milestone: B · Chill loop · Effort: L · Depends on: 03

## Goal

No two landings or takeoffs should look the same. Fluid animations with a sense of weight that change with the
situation, surface and speed.

## Landing types (chosen automatically from approach speed, angle and surface)

| Type | When | Look |
|---|---|---|
| Running landing | Flat ground, medium speed | Claws dig into the ground, a few running steps, dust trail |
| Hover-and-settle | Slow, brake held | Strong wingbeats, dust ring on the ground, soft touchdown |
| Perch landing | Viewpoint (Phase 03) | Claw grip, wing balance, tail wrapped around the structure |
| Rooftop landing | On a building | Short brake, hind claws first, half-open wings for balance |
| Slope landing | Steep hillside | Glide uphill, stall onto the slope |
| Water landing | Sea | Belly slide, long splash trail, transition to swimming |
| Hard landing | Too fast | Tumbles and recovers, shakes its head and growls; no penalty (built, see below) |

Built so far (phase 20, `20-movement.md`): the running landing (run-out, with the *glide* and *swoop* variants of its
flare), hover-and-settle and rooftop / slope landings through the slow landing (landing v2: an animal approach with
checks and a weave or a final turn, a flare pitched back 55–60° with backstrokes, hind feet first; *drop*, *shallow*
and *tired* variants, never the same twice in a row) and the water landing into swimming. A slow landing from 45 m
takes 7.7–9.2 s from L (the animal flare and near-hover last metre cost ~1 s over the ≤ 8 s target below).

**Hard landing** (built, `src/dragon/flight/hard-landing.ts`, tunables `HARD_LANDING` in `params.ts`):

- *When.* A floor-like contact (normal y > 0.7: the ground, a roof) on land that is too fast: the feet meeting the
  ground sinking ≥ 8 m/s (legs out), or a body sphere meeting it at a normal approach speed ≥ 6 m/s (legs tucked), or
  a glancing belly hit at ≥ 3 m/s while ≥ 24 m/s over the ground (no flare, a botched landing). The sim's own normal
  touchdowns sink 0.3–1.6 m/s (the slow landing at 0.3–2 m/s, the running landing at 12–18 m/s; the run-out takes up
  to 6 m/s) and the only body contact they make is a hip meeting a slope at ~2.4 m/s, so they never trigger it. Water
  keeps the plunge and the water landing; perching (approach, perched, leaving) never counts.
- *What.* Impact: an "oof" (the bond's huff), a dust burst, a camera jolt, the "Sert iniş" caption. Then one of
  three tumbles, never the same twice in a row (seeded; a fast flat hit likes the belly skid, a steep slow one the
  plow): **front** — the chest plows in, the nose dips with the head held up and the hindquarters kick up, then a roll
  over the shoulder (1.3 s); **side** — it slews across its track and rolls like a log along it, twice from 20 m/s up
  (1.3 / 1.7 s), and gets up facing sideways; **belly** — a fishtailing skid with the wings spread flat like a sled,
  chin up (1.5 s). Wings flail, then fold before a roll starts; the rider holds on tight (tuck and both reins, the
  "hold tight" cue) from the impact to the get-up; each half turn thuds on the ground; dust along the slide. It slides
  to a stop (the slide starts at 55 % of the ground speed, at most 16 m/s), gets up (0.7 s, legs out), then stands
  while the bond plays the head shake (1.3 s: the shake-off's head shake, the full wet-dog shake, or the sneeze with a
  smoke puff, each with a grumble or the sneeze; never the same one twice in a row). The mood turns *embarrassed* at
  the impact and goes back within ~10 s. Total 3.3–3.7 s, then control is back, standing.
- *Physics.* Scripted and deterministic, not a ragdoll: the body rests on its lowest points (the height at which no
  collision sphere, the head where the raised neck holds it, nor the rider is below the surface under it, sampled per
  sphere) and falls no faster than gravity; rolls turn about the long axis so the neck and tail never vault. The slide
  stops where the ground ahead of the head ends, rises into a wall or turns into water; walls push the body out.
  Input is ignored until control returns (the camera still looks around; the chase camera holds its heading and does
  not roll with the tumble).
- *Races and flow.* A race does not count it as standing on the ground (only its time is lost); a flow chain breaks
  like on any ground contact (flow × 0.35, the chain spoiled).
- *Checks.* `tools/headless/hard-landing-check.ts`: 19 normal-landing scenarios and a 40-run L sweep (4–45 m,
  8–38 m/s, braked or not) with no hard landing; six fast impacts that trigger it and two below the thresholds that do
  not; on the ground throughout (spheres and rider ≥ 0 m), over in 3.3–3.7 s, controllable after, no NaN; stops at
  the water, a wall and a roof edge; hammered input changes nothing; determinism; seven in a row without a repeat;
  the bond cues; the flow drop. `perch-landing-check.ts` confirms no perch run turns into one. Pose strips:
  `npx tsx tools/headless/pose-strip.ts hardland-front` (and `-side`, `-belly`).
- *Debug.* `__evren.hardLanding(variant?, speed?, sink?)` or `__flightTest.hardLanding(...)` (dev server, sandboxes,
  `?flighttest=1`): a hard landing right where the dragon is, as if it had met the ground below it at `speed` m/s
  (default its speed, at least 20) sinking `sink` m/s (default 10); `variant` is `'front' | 'side' | 'belly'`.
  `__flightTest.hardState()` reads it.

## Takeoff types

| Type | When | Look |
|---|---|---|
| **Leap takeoff** (default, first takeoff from the ground) | Space while grounded | Crouch (0.3 s), powerful jump from the hind legs, wings unfold mid-air for the first big beat; climbs 15–25 m within a few seconds. Light camera shake, dust burst. |
| Running takeoff | Grounded, forward held | A few galloping strides, lifts off while flapping |
| Cliff drop | Perches and viewpoints | Free fall with folded wings, then a sharp unfold (Phase 05) |
| Vertical takeoff | Tight space, brake held | Climbs straight up with strong beats in place, high stamina cost |
| Water takeoff | Swimming + Space | Runs across the surface flapping, curtain of spray |

## Technical approach

- **Animation state machine** (`src/dragon/flight/locomotion/`): states (approach, flare, touchdown, settle, grounded,
  crouch, leap, launch, splashdown…), transition conditions and blend times. Physics stays active in every state;
  animation "steers" physics, it never teleports.
- **Pose layers:** Extend `DragonPose` with `crouch`, `leap`, `gripFront/gripBack`, `tailWrap`, `landingImpact`,
  `headShake`. The model module applies them to the bones.
- **Foot IK:** Feet settle onto the ground and its slope on contact (rays into the collision world).
- **Variation:** 2–3 random variants per type (head motion, wing unfold timing, last step).
- **Audio and effects:** Contact, dust, splash and claw sounds; add a `footstep` event to the contract (requested by the audio module).

## Acceptance criteria

- Every landing and takeoff type can be triggered with `?view=...` + a scenario script (extend `scripts/flight-test.mjs`) and is recorded with screenshots.
- Leap takeoff: at least 10 m of height within 1.5 s of pressing Space; flight control back to the player within 4 s.
- Landings: feet neither sink into nor float above the ground (±0.2 m).
- Landing from 45 m takes ≤ 8 s (currently 15–23 s).
- Repeating the same landing type 3 times in a row shows at least 2 different variants.
