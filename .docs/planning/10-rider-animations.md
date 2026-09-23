# Phase 10 — Rider animation system

Milestone: D · Character and action · Effort: L · Depends on: 01

## Goal

Give the character on the dragon varied, natural animations beyond today's leaning and rein poses.

## Source decision

**Mixamo.** Characters and animations are free and royalty-free in games, no attribution required. The only restriction
is not redistributing the raw files as a standalone product. Far more natural motion than hand-coded keyframes. The
download is done by the user (an Adobe account is required).

## Scope

### Character
- A rider model on a Mixamo-compatible humanoid skeleton (65 bones), keeping today's outfit language (hooded cloak,
  leather armour, goggles, scarf). Either the procedural model is skinned to this skeleton, or procedural clothing is
  dressed over a Mixamo character.
- Face: a simple but proper face under the hood and scarf.

### Animations
| Group | Animations |
|---|---|
| Flight | Seated variations, leaning into the wind, banking into turns, crouching forward in a dive |
| Interaction | Waving, pointing at a landmark (with the discovery card), looking back, petting the dragon (Phase 06) |
| Show | Standing up on the saddle, spreading arms (while soaring), saluting |
| Action | Throwing a spear, drawing and releasing a bow, raising a sword (Phase 11) |
| Ground | Dismounting and mounting, walking beside the dragon, sitting and watching the view (while perched) |

### System
- `THREE.AnimationMixer` + layered blending: lower body locked to the saddle (IK), upper body animated; hands return to the reins with IK.
- Additive layers: breathing, g-force reaction, wind flutter.
- Cloak: the existing vertex-shader flutter stays; simple cloth simulation when standing or walking (Verlet, low resolution).
- POV: the rider's own arms and hands are visible (petting, pointing, spear).

## Technical notes

- Retargeting: Mixamo FBX → glTF at build time (`scripts/anim/`), keeping only the bone tracks of the clips we use; ≤ 2 MB in total.
- Add a rider animation API to the `DragonRig` contract: `rider.play(name, { layer, fade })`, `rider.setLook(target)`.

## Acceptance criteria

- At least 15 animations can be triggered in game; no sliding or popping in transitions.
- The seated pose is locked: the rider never detaches from the saddle during high g or rolls.
- In POV, hands and arms look natural (screenshots).
- Performance: rider animation ≤ 0.2 ms CPU.
