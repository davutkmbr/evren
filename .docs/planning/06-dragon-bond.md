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
