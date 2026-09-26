# Phase 24 — The rider as a full character

Milestone: D · Character and action · Effort: XL · Depends on: 10 (supersedes its character section)

## Goal

The rider is a real, charismatic character, rooted in Turkic myth and Ottoman culture (the owner's direction: heroic
and noble, stylised is fine but never comic or plastic). The player sees them up close on the dragon, and later they
leave it: leap from the saddle, glide on their own wind wings like Hezarfen Ahmed Çelebi, land, walk, run, crouch and
jump. The mechanics for being on foot come later. The character, its skeleton and its animation system must be ready
for them now, and every motion must be smooth, weighty and pleasant to watch.

## Where it stands (2026-09-26)

- **Pipeline** (`tools/humans/`, Blender 4.5 + MPFB 2, CC0 MakeHuman assets):
  - The body is generated with a heroic phenotype and face targets.
  - The skeleton is Mixamo-named and bound in the standing A-pose. Clips are exported as glTF actions.
  - The Akıncı outfit is modelled by script and cloth-simulated on the body:
    - Dolama, şalvar, boots.
    - Mail vest and aventail, vambraces.
    - Sash with hanging ends.
    - Fluted çiçak with cheek plates and a sorguç.
- **Game side** (`src/dragon/model/rider/human.ts`):
  - Loaded under the dragon's chest bone with `?riderUrl=`, playing the held `ride` clip.
  - Scanned CC0 materials with sheen and baked AO.
  - Wind bone chains on the skirt panels and sash ends (`wind-bones.ts`).
- **Not done:** everything below.

## Gaps

### A. On the dragon

1. **Seat fit.**
   - The ride pose is a fixed guess.
   - The hips, thighs and skirt sink into the saddle's cantle.
   - The feet hang behind the stirrups.
   - The pose must be fitted to the real seat, stirrups and rein grips, and hold for any body shape → runtime IK
     (two-bone legs to the stirrups, arms to the rein grips) over a base seated pose.
2. **Reins.** The rope must leave the fist between the fingers and follow the hands as they move:
   - Tension pulls it straight.
   - Slack lets it hang in a catenary.
   - The fingers close around it.
3. **Rider animator for the new skeleton.** Port every cue the old rider has:
   - Leaning into banks, bracing in dives, sitting back on climbs and flares.
   - Rein pulls on turns and the urge's rein snap.
   - Looking around and at the discovery landmark.
   - Petting the neck, standing in the stirrups, cheering and pointing.
   - Breathing, idle fidgets, turbulence bumps and g-force compression.

   All of this is procedural layers on the base pose, with IK keeping the seat and hands attached.
4. **First person.**
   - The POV anchor sits at the new head's eyes.
   - The head and helmet are hidden from the rider's own camera; hands and arms stay visible.
5. **Wind.**
   - The skirt and sash chains respond (done).
   - The plume feathers and the aventail's hem should also move a little.

### B. On foot (character ready, game mechanics later)

1. **Clip set**, authored as glTF actions on the same skeleton:

   | Group | Clips |
   |---|---|
   | Standing | idle (breathing, weight shift) |
   | Locomotion | walk, run (in place, with speed metadata) |
   | Transitions | run-stop (plant and skid, recover), start, turn in place |
   | Crouch | crouch idle, crouch walk |
   | Jump | take-off, air (rising and falling), landing (soft and hard) |
   | Dragon | leap off the saddle, glide with wings, mount |

2. **Locomotion controller** (`src/dragon/model/rider/locomotion/`):
   - A state machine over an `AnimationMixer` with:
     - speed-synchronised blending (idle ↔ walk ↔ run share a normalised phase, so feet never slide or skip);
     - inertia-like crossfades between states;
     - a stop that plays the skid when stopping from a run;
     - a jump sequence driven by the vertical velocity;
     - a crouch blend.
   - Procedural layers on top: lean into acceleration and turns, head looking ahead into the turn, landing compression
     on a spring, and foot IK on uneven ground.
3. **Test bench** (`sandbox/human.html`):
   - The character on the ground with a follow camera.
   - Controls: WASD relative to the camera, Shift to run, C to crouch, Space to jump.
   - A clip preview mode, a wind slider and screenshots for every clip.

### C. Detail and life

1. **Face:**
   - Blinking, eye saccades and a look target.
   - Jaw and brow for effort (a running grimace, a shout on the leap).
   - These come as a few morph targets from the approved MakeHuman face units.
2. **Secondary motion on foot:** the same wind chains swing with the body's own motion (inertia), not only with airflow.
3. **Performance:** ≤ 0.3 ms CPU for the rider's animation, one skinned draw per material.

### D. Customisation (after the character is right)

- Origins: Alp, Akıncı/Deli, Hezarfen, Kam.
- Slots: headwear, top, armour, legs/boots, belt, accessories.
- Curated face archetypes, palettes.
- The "Binici" menu tab.
- Reuse for NPCs.

## Plan and order

1. **Test bench and clip authoring tool.**
   - `sandbox/human.html` with a clip picker, orbit view and a wind slider.
   - `tools/humans/anim.py`: a small procedural keyframing layer on Blender. Per frame it drives:
     - pelvis and foot trajectories with leg IK and planted feet;
     - spine, neck and arms as functions of the cycle phase.
   - The result is baked into actions (30 fps, looping clips exactly periodic).
   - Mixamo clips (approved, downloaded by the owner into `private-assets/mixamo/`) can replace any clip later with the
     same names.
2. **Locomotion clips:** idle, walk, run, run-stop, crouch idle, crouch walk, jump take-off / air / land.
3. **Locomotion controller** with synchronised blending and procedural layers, driven from the test bench.
4. **Riding:**
   - Seat fit with IK to the saddle and stirrups; reins in the fists.
   - The rider animator ported to the new skeleton, with all cues.
   - First-person anchor and head hiding.
5. **Dragon moments:** leap off the saddle, glide pose with wing anchors (the wings themselves are a separate asset),
   mount.
6. **Face life:** blink, eyes, effort expressions.
7. **Polish pass:**
   - Screenshots of every state and transition.
   - Tuning of timing and weight (anticipation, follow-through, settle).
   - Then the default switches to the new rider in game.

## Acceptance criteria

- On the dragon:
  - The seat, stirrups and reins are visibly in contact in every cue.
  - No part sinks into the saddle.
  - The rope runs out of the fists.
- On the test bench, walk ↔ run ↔ stop ↔ crouch ↔ jump:
  - no foot sliding at steady speed;
  - no pops at transitions;
  - stops and landings show weight (anticipation, compression, settle).
- All clips and the character come from the Blender scripts (reproducible). No unapproved assets.
