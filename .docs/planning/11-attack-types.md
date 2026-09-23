# Phase 11 — Attack types

Milestone: D · Character and action · Effort: L · Depends on: 01 (14 for rival dragons)

## Goal

Two to three (or more) "utopian" attack types beyond fire breath; spectacular without breaking the chill balance.

## Attacks

| Attack | Key (proposal) | Look and effect |
|---|---|---|
| Fireball | Right click | Arcing projectile from the mouth; affected by gravity and wind; on impact an explosion, temporary light, a smoke mushroom and a scorch decal; steam if it hits water |
| Lightning breath | 1 | Chain lightning bouncing between nearby targets; lights up the sky for a moment, thunder |
| Ice breath | 2 | Cold mist and ice crystals; where it touches water a temporary frozen patch (an ice island in the Bosphorus), fogging air |
| Roar shockwave | R (long press) | A visible ring of air; punches through clouds, scatters gulls, ripples the water surface, bends nearby trees |
| Tail slam from a dive | F while diving | Impact wave on ground or water, a column of dust or water, camera shake |

Each attack has a stamina cost and a cooldown; fire breath stays as it is and gets improved (long flame jet when seen
from behind, Phase 01).

## Targets (sensitivity rule)

Real mosques, Hagia Sophia and other landmarks are never damaged; effects leave no marks on them.

| Target | Description |
|---|---|
| Training targets | Floating lantern balloons over the Bosphorus, buoy rings on the sea |
| Ghost ships | Fantastical, non-historical ships appearing on foggy nights |
| Fictional creatures | Stone golems in the northern forests and off the Black Sea coast, shadow birds |
| Rival dragons | AI or multiplayer (Phases 14–15) |

Activity ideas (with Phase 13): a target-shooting course, defending against the ghost fleet, time trials.

## Technical approach

- `src/combat/`: projectile system (physics + collision-world rays), hit events, damage and health for targets only.
- Effects in the fx module: explosions, lightning (procedural branching lines, bloom), ice (a temporary freeze mask in
  the water shader), shockwave (screen-space refraction ring + water ripple).
- Lights: pooled temporary lights for explosions and lightning (at most 4 active).
- Audio: synthesized layers per attack + impact sounds; the action layer in the music (Phase 07).
- Aiming: a centre-screen reticle and projectile path prediction in third person; the rider's gaze direction in POV.

## Acceptance criteria

- Each of the 5 attacks approved with day and night screenshots; explosions and lightning look striking with bloom.
- Attacks that hit landmarks leave no marks and do no damage.
- 60 fps with 10 simultaneous fireballs and explosions.
- An ice patch melts within 30 s; the water shader is not corrupted.
