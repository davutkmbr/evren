# Candidates: human base for the rider (and later NPCs)

Status: **pending approval** (asked 2026-09-26). Nothing below is in `public/` or referenced by code.

## Why

The procedural SDF rider (`src/dragon/model/rider/`, `?rider=new`) does not reach the dragon's level of detail: next
to the dragon's dense scales and realistic materials it reads as a smooth clay figure, whatever the costume or colours
(diagnosis renders: `.shots/rider/dragon-a.png`, `dragon-b.png`, `dragon-c.png`). The rider needs a proper human base
mesh with real skin textures, and garments modelled and cloth-simulated in Blender with baked detail maps.

MetaHuman (already approved for humans) works in three.js as glTF, but every character has to be created and exported
in Unreal on the owner's Mac, and faces cannot be customised in the game beyond picking presets. The candidate below
can be driven entirely by scripts (Blender, headless) in any environment, and its morph targets allow body and face
customisation at runtime.

## Candidates

| # | Name | Source | Licence | Author | Size | Resolution / polys | Preview |
|---|---|---|---|---|---|---|---|
| 1 | MakeHuman system assets (base mesh, body and face targets, eyes, eyebrows, eyelashes, teeth, a few hair meshes, proxies, default skins, skeletons incl. a game-engine rig) | https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html | CC0 | MakeHuman team | 281 MB zip | base mesh ~13k quads (proxies from ~1.5k); skins 2K–4K | `.shots/assets/rider-humans/system-afro01.png`, `system-braid01.png` |
| 2 | MakeHuman skins pack 01 (natural skin textures, various ages and origins) | https://static.makehumancommunity.org/assets/assetpacks/skins01.html | CC0 | various community authors (per asset, all CC0) | 104 MB zip | 4K diffuse (plus normal / specular on some) | `.shots/assets/rider-humans/skins01-uniform.png` |
| 3 | Face units 01 (ARKit-style face expression units for the MakeHuman face) | https://static.makehumancommunity.org/assets/assetpacks/faceunits01.html | CC0 (MakeHuman functional assets) | MakeHuman team | 0.3 MB | 52 expression units | — |

Tools (not shipped, not assets): Blender 4.5 LTS (GPL; its output is ours) and MPFB 2 (the MakeHuman add-on for Blender,
GPL; the characters it produces from CC0 assets are not GPL). CC-BY packs on the same site are deliberately excluded.

## Plan if approved

1. Blender scripts (`tools/humans/`, run headless) build the base human from the CC0 assets: body and face targets
   exported as glTF morph targets (build, shape, face archetypes), a game-engine skeleton renamed to the
   Mixamo names the rider animator uses, skins downsized to 2K and packed (KTX2).
2. Garments and armour for each origin (Akıncı, Alp, Hezarfen, Kam) are modelled by script, draped with Blender cloth
   simulation on the seated pose, detail-baked (normal, AO, curvature: stitches, folds, wear) and exported as swappable
   skinned parts.
3. The runtime loads the base + chosen parts, sets morph weights and palette colours; the appearance model, skeleton
   names and the menu design from the procedural work carry over.
4. Every integrated asset is recorded in `public/models/LICENSES.md` / `public/textures/LICENSES.md`.
