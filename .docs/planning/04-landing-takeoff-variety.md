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
| Hard landing | Too fast | Tumbles and recovers, shakes its head and growls; no penalty |

Built so far (phase 20, `20-movement.md`): the running landing (run-out, with the *glide* and *swoop* variants of its
flare), hover-and-settle and rooftop / slope landings through the slow landing (landing v2: an animal approach with
checks and a weave or a final turn, a flare pitched back 55–60° with backstrokes, hind feet first; *drop*, *shallow*
and *tired* variants, never the same twice in a row) and the water landing into swimming. A slow landing from 45 m
takes 7.7–9.2 s from L (the animal flare and near-hover last metre cost ~1 s over the ≤ 8 s target below).

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
