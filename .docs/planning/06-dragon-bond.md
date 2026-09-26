# Phase 06 — Bond with the dragon: gaze, petting, mood

Milestone: B · Chill loop · Effort: M · Depends on: 03 (stronger with Phase 10)

## Goal

The dragon is a companion, not a vehicle. It turns its head to look at us, we can pet it in POV, and it shows small
behaviours with a personality of its own.

## Scope

### Gaze
- While gliding, while perched, or when the rider looks at its neck for a while in POV, the dragon turns its head back and makes eye contact.
- Blinking, pupils reacting to light and mood, steam from the nostrils.
- When a discovery card opens it also looks at the landmark; it turns its head toward ferry horns and flocks of birds.

### Petting (POV)
- Holding a key makes the rider's hand reach its neck and stroke the scales (hand placed on the neck surface with IK).
- The dragon's reaction:
  - A deep, cat-like purr (synthesized).
  - Half-closed eyes, leaning its head into the hand, neck plates rising.
  - The tail tip curls slowly.
- Light gamepad rumble.

### Mood and self-driven behaviour
- States: curious, playful, tired, content, excited.
- Triggers: flight time, stamina, time of day, petting, discoveries.
- Behaviours (each with a few variants):
  - Reaching for a gull or trying to snap at it.
  - A small flame when yawning, smoke when sneezing.
  - Grooming its wings while perched, shaking its head, curling up to rest.
  - Heavier wingbeats when tired.
- **Bond level:** Grows with petting and flying together; unlocks rolls, loops and "show-off" moves; a small indicator in the UI.

## Technical approach

- New module `src/dragon/behavior/`: mood state machine, behaviour queue, attention (look-at) target selection.
- `DragonPose` extensions: `eyeLid`, `pupil`, `nostrilSteam`, `neckPlates`, `lookTarget` (world point; neck chain via IK).
- Rider hand: if Phase 10 is not ready, the first version uses procedural arm IK (shoulder, elbow, wrist) to reach the neck.
- Audio: purr, yawn, sneeze, content grumble.
- Persistence: bond level in `localStorage` (try/catch).

## Acceptance criteria

- After looking at the neck for 3 s in POV, the dragon turns its head toward the camera within 2 s (screenshot).
- Petting starts and ends smoothly; the hand stays within ±3 cm of the neck surface.
- A 10-minute autopilot recording shows at least 6 different self-driven behaviours.
- Performance: behaviour system ≤ 0.2 ms CPU.

## As built (26 September 2026)

Code: `src/dragon/model/behavior/bond/` — a pure core (`types.ts` with the tunables `BOND`, `gaze.ts`, `mood.ts`,
`behaviors.ts`, `core.ts`, `apply.ts`) and the engine adapter `bond-behavior.ts`, run by the model system every frame
after the rider behaviour (petting G, standing T) and before the rig applies the pose. The core is deterministic
(seeded), so `tools/headless/bond-check.ts` and the pose sheets run exactly the game's code. The module sits under
`src/dragon/model/behavior/` next to the existing rider behaviour instead of a new `src/dragon/behavior/`.

New pose cues (`DragonPose`, all optional): `eyeLid`, `pupil`, `neckPlates`, `headRoll`, `neckShake` (applied past the
neck springs so a 4 Hz shake is not smoothed away), `bodyRoll` (a visual rig roll only, never the flight body; ×0.3 in
POV), `tailCurl`, and the rider cues `riderLaugh`, `riderShow` + `riderShowYaw` / `riderShowPitch`, `riderPat`. Instead
of a world `lookTarget`, glances are additive neck yaw / pitch offsets from body-relative directions.

### Gaze
- **Safety gate** (`SafetyGate`): the head only comes round when nothing asks for its eyes — no race, landing,
  take-off, dive, stall, trick / hard bank / g, fire, perch approach or leave; airborne not below 30 m unless hovering
  slower than 4 m/s; not faster than 40 m/s; on the ground or in the water slower than 3 m/s; the path ahead clear for
  7 s (a collision ray along the velocity every 0.2 s; clear again only past 10 s: hysteresis); then 1.5 s of calm.
  Unsafe drops the look at 6.5/s. Glances at the world use a softer gate (55 m/s, 15 m, 5 s).
- **Triggers:** petting (after 0.6 s; the head comes round on the right, the petting side), the rider's POV view
  resting on the neck (a cone 16–72° below the flight path, ±48°) for 3 s (level 0.9, on the side of the view), after
  a trick and when the rider stands up (as before), and idle looks back while gliding (every 18–40 s), perched
  (12–26 s) or resting on the ground (25–50 s), scaled by mood (playful more often, tired less).
- **Eyes:** blinks every 2.5–6 s (0.16 s; tired slower and longer; 15 % double blinks), one slow blink when eye contact
  is made, half-closed while petted (0.55, 0.7 after 3–6 s), heavier when tired. Lids and pupils are drawn in the body
  shader (`uEyeLid`, `uPupil`): the lids close over the eye along a curved line; the slit narrows in bright light and
  opens toward a round pupil in the dark, when excited or curious, and a little while petted.
- **Nostril steam:** an estimated air temperature (`estimateAirTemp`: seasonal mean, daily swing, −6.5 °C/km, rain)
  shows breath under 8 °C (full at 1 °C) and in humid air under 13 °C; fx puffs it from both nostrils on each exhale
  (`src/fx/emitters/breath-emitter.ts`), faster after hard flight. Late September at sea level shows none; at 1600 m
  it does, and on winter mornings everywhere.
- **Glances at the world** (`AttentionController`): the landmark whose discovery card opens (3.6 s; the rider points
  at it), a stork kettle (the stork moment emits `dragon-attention` every 2 s; 650 m), a passing underway vapur
  (`life.vessels`, 420 m, 45 s cooldown per ferry), the closest ambient gull or pigeon (`life.nearestBird`, 70 m; the
  ferry-gulls moment emits hints too), and anything else that emits `dragon-attention`. Ferry horns: the game has no
  horn sound yet; the kind `horn` is ready for the system that adds one. One target at a time by priority, per-target
  cooldowns.

### Petting (POV and chase)
- The existing palm IK on the neck track stays; the dragon now holds its neck steady into the hand while petted (the
  flight / look yaw damped by 75 %, the pitch kept within −0.02…0.5 rad), so the palm stays on the skin in every pose:
  reach error ≤ 2.3 cm, palm gap ≤ 2.3 cm (bond-check; acceptance ±3 cm).
- Reaction: purr phrases (deeper and longer with affection: `purr-deep` with a chest layer at ~15 Hz), eyes
  half-closed, the neck plates standing up (the neck's dorsal thorns, `aData.w = 2`, raised in the vertex shader), the
  tail tip curling slowly, the head round on the right with an affectionate tilt; a light dual-rumble on gamepads in
  time with the purr (`Input.rumble`); after 5 s of petting the rider laughs once.

### Mood and self-driven behaviour
- **Drives** (`MoodModel`): fatigue (continuous flight 2→18 min, low stamina, effort, the small hours; rest brings it
  down), affection (petting; slow decay), curiosity (discoveries and new sights; decays in ~45 s to a low base),
  excitement (flow, speed over 42 m/s, tricks, discoveries; decays in ~22 s) and playfulness (fond, rested, a little
  excited; mornings and evenings). The mood is the best score (content is the resting state) with hysteresis: a
  challenger must lead by 0.12 for 4 s (1.5 s for excitement) and a mood holds at least 10 s.
- **Hard landing** (phase 04): the impact makes it *embarrassed* at once (the embarrassment drive set to 1, decaying
  with 5 s; the mood may go after 6 s, so it lasts ~10 s) with an "oof" (huff); the safety gate treats the whole hard
  landing as critical (no gaze, no behaviours); once it stands again it plays a head shake that is not gated like the
  behaviours: the shake-off's head shake with a grumble, the full wet-dog shake with a grumble, or the sneeze (smoke
  puff) followed by a head shake — never the same one twice in a row (`BondCore.reactions`). Its V answer while
  embarrassed is a small huff with the head turned away.
- **Mood shows in pose and sound, no meters:** tired lowers the head and tail and weighs the lids; curious lifts the
  head with slow tilts; playful swings the tail; excited raises head and plates and widens the pupils; content keeps
  the plates a touch up. The pause menu shows one quiet line under the game's name ("Evren keyifli.").
- **Behaviours** (`BEHAVIORS`, each with variants): look-around (scan, tilt, peek), gull-snap (snap; double, with a head
  shake and a laughing rider; reach), yawn (plain; with a small flame puff; long), sneeze (smoke puff, double, snort
  with steam), happy-roll (rock, shimmy, wiggle: visual only), wing-stretch after landing from ≥ 150 s of flight
  (raised V, high, shiver), shake-off after leaving the water (head; full, with drops; tail), head-shake (quick, slow),
  rest (doze, chin down) and groom (left, right) when standing still or perched.
- **Scheduling:** a global gap of 45–95 s (×0.75 curious / playful, ×0.8 excited, ×1.1 tired), the first one after
  ≥ 25 s, per-behaviour cooldowns, the last four drawn at 30 % weight; only when the safety gate allows it and nothing
  else holds the head (petting, a look back, the V answer, the rider standing); a running one fades out in 0.25 s when
  the gate closes. Variants never repeat back to back, the same behaviour never twice in a row. Triggered ones (wing
  stretch, shake-off) wait up to 12 / 10 s for their chance.
- Not built: heavier wing beats when tired (the flight model's business; the pose shows tiredness instead), the bond
  level with unlocks and its UI indicator (it would contradict contextual reveal; left for an owner decision), and
  persistence (the mood lives for the session).

### V "encourage"
- V (gamepad D-pad up) pats the neck (`riderPat`: the palm on the neck track tapping at 3.2 Hz) when the rider is
  seated with free hands; 2.4 s between presses. After 0.35 s the dragon answers by mood: tired — a grumble and a slow
  nod; content — a chirp and a head tilt toward the rider (a short look back when safe); curious — a rising trill and a
  tilt; playful — two chirps and a little rock; excited — one visual wing beat (while gliding; on the ground the wings
  shiver up) and a short roar. A caption names the answer ("Evren memnun", "Evren coştu!"). No effect on speed or
  physics; it nudges affection and excitement a little. A control-help row in the dragon group.

### Rider cues
Leaning in to pet (existing), laughing (shoulder bob, the head back; less in POV), pointing the right arm at what the
dragon looks at (landmark, stork, ferry; the torso turns with it, the head only in third person so the player keeps
the POV view), patting for V.

### Audio
Synthesised and additive (`src/audio/sfx/bond.ts`, `AudioService.bondCue`): purr (strength = affection), deep purr,
chirp, trill, grumble, yawn, sneeze, jaw snap, huff, short roar; levels and spacing in `BOND_MIX` / `BOND_SPACING`
(`src/audio/audio-engine.ts`).

### Checks
`npx tsx tools/headless/bond-check.ts`: no look back in 13 unsafe situations with every trigger on; POV 3 s → gaze 0.6
at 3.6 s; an obstacle drops a running look within 1 s; obstacle hysteresis; idle looks while perched / gliding; mood
transitions (tired after ~10 min of hard cruising, back after ~2 min of rest, discoveries → curious and back, petting →
fond, flow → excited and back, no switch on a 1 s spike, no flapping on noisy input); a varied 10-minute autopilot run
(3 seeds) shows 7 different behaviours, rare (≥ 51 s between chance draws), none in a race, landing or take-off, faded
within 0.25 s, no repeats; the wing-stretch and shake-off triggers; V answers by mood; petting IK within ±3 cm in 8
poses; no NaN in 6000 fuzzed frames through the core and the rig; the core costs ~1 µs a frame.
Pose sheets: `npx tsx tools/headless/bond-sheet.ts` → `.shots/pose/bond/` (gaze, petting, yawn, happy-roll,
wing-stretch, gull-snap, encourage).

Debug in dev builds: `window.__bondDebug.behave('yawn', 'flame')`, `.mood('tired')`, `.kick('excitement', 0.5)`,
`.state()`; `window.__riderDebug.force({ eyeLid: 1, neckPlates: 1 })` forces the new cues too.

## Owner feel checklist

Play and tick; the numbers to turn are in `BOND` (`src/dragon/model/behavior/bond/types.ts`).

- [ ] POV: look down at the neck for 3 s — the head comes round within ~2 s, meets your eyes with a slow blink and
      goes back when you look away (`gaze.povDwell`, `gaze.povRelease`, the cone `NECK_VIEW` in the adapter).
- [ ] The look back never happens low over the city, fast, near a tower or in a race (`gaze.maxAirspeed`,
      `gaze.minAgl`, `gaze.obstacleBlock` / `obstacleRelease`); frequent enough while gliding and perched but never
      nagging (`gaze.glideEvery`, `perchEvery`).
- [ ] Petting (G) in POV and chase: the hand stays on the neck; the purr is deep and warm, not buzzy; the eyes close
      halfway, the plates stand up, the tail tip curls; the gamepad rumble is light (`pet.*`, `BOND_MIX['purr-deep']`).
- [ ] Discovery card: the dragon looks at the landmark and the rider points (`look.landmarkTime`, `look.showTime`).
- [ ] Gulls, a passing vapur, the stork kettle: the glances feel natural, not twitchy (`look.*Cooldown`, `look.*Range`).
- [ ] Behaviours: rare (about one a minute), charming, never in the way; the flame yawn and the smoke sneeze read at
      chase distance; the happy rock is not too much in POV (`behavior.gap`, `bodyRoll` ×0.3 in POV).
- [ ] Landing after a long flight: the wing stretch reads as a stretch; after a swim: the shake-off.
- [ ] Mood: a long session makes it tired (lower head, heavier lids, yawns), rest restores it; the pause-menu line
      matches what you feel (`mood.*`).
- [ ] V: the pat reads, the answer fits the mood (grumble / chirp / trill / two chirps / beat + roar), the caption is
      welcome rather than noisy (`encourage.*`, `ENCOURAGE_CAPTIONS`).
- [ ] Breath steam on a winter morning (`?doy=20&t=7`) and up high; none on a warm day (`steam.*`).
- [ ] Performance: no visible cost (the core is ~1 µs; the adapter casts one ray per 0.2 s and one bird query per
      0.25 s).
