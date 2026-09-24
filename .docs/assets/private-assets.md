# Private assets

Assets whose licence allows use inside the game but forbids redistributing the raw files. They live in
`private-assets/` (gitignored), are never committed or copied into `public/`, and reach players only inside builds.

| Source | Use | Licence | Notes |
|---|---|---|---|
| MetaHuman (Epic Games) | Player, hero NPCs, crowd (low LODs); faces via MetaHuman Animator | MetaHuman licence / Unreal Engine EULA: free under $1 M annual revenue, usable in any engine since mid-2025, no royalty outside Unreal | Characters are created in the Unreal Engine MetaHuman plugin and exported once. |
| Fab: Epic MetaHuman wardrobe | Crowd and NPC clothing (garments, shoes, construction presets) | Fab Standard License, Professional tier ($0): any engine; no standalone distribution; restrict extraction by end users | Added via Fab "Add to Project" in the Unreal project; approved 2026-09-24 (`.docs/assets/candidates/metahuman-outfits.md`). |
| Mixamo (Adobe) | Body animation clips, retargeted to the MetaHuman skeleton with Unreal's IK Retargeter (batch, Python) | Mixamo FAQ: royalty-free in games; raw files must not be redistributed | Downloaded "without skin" per clip. |

## Layout

```
private-assets/
  unreal/EvrenHumans/         Unreal 5.8 project (MetaHuman Creator, Animator, IK Retargeter, exports)
  metahuman/<character-id>/   exported characters (source) + runtime LOD exports
  mixamo/<clip>.fbx           source clips (without skin)
  build/                      retargeted, packed runtime files (per runtime)
```

## Log

| Date | Asset | Source | Added by |
|---|---|---|---|
