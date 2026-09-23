# Phase 14 — Multi-dragon foundation

Milestone: F · Multiplayer · Effort: M · Depends on: 01, 12

## Goal

Remove the engine's "single dragon" assumption. A prerequisite for multiplayer, AI rival dragons (Phase 11) and showing
different species at the same time (Phase 12).

## Current state

- The `rig` and `dragon` services are singletons; camera, fx, audio, UI and flight all depend on them.
- One dragon is about 130k triangles and 7 draw calls; expensive for many dragons at a distance.

## Scope

1. **Entity model:** `DragonEntity { id, spec, state: DragonState, rig: DragonRig, controller: 'local'|'ai'|'remote' }`
   and a `dragons` service (add, remove, list, `local`). The existing `rig`/`dragon` services remain as aliases of the
   local player's dragon (backwards compatible).
2. **Controller separation:** Flight physics reads input from a `ControlInput` interface; local keyboard and gamepad,
   AI and network all feed the same interface.
3. **LOD:** 3 dragon model levels (near full, mid ~25k triangles, far ~3k triangles + impostor); animation update rate drops with distance.
4. **Shared resources:** Dragons of the same species share geometry, textures and the skeleton template; only bone matrices are per instance.
5. **Effects and audio:** Fire, trails and wing sounds per dragon; budgeted by distance.
6. **AI dragon (for testing):** A simple route-following AI to test multiple dragons without networking.

## Acceptance criteria

- 16 dragons (1 local + 15 AI) in the same scene at 60 fps on "high".
- The local player experience is unchanged (compared against the Phase 01 acceptance screenshots).
- Draw-call budget: far dragons as instanced impostors, ≤ 2 draw calls in total.
