# Human characters (riders, later NPCs)

Blender scripts that build the rider from the approved CC0 MakeHuman assets and export `public/models/rider/akinci.glb`.
Everything is generated; nothing is edited by hand.

```
blender -b --factory-startup -noaudio --python-exit-code 1 -P tools/humans/build_rider.py -- public/models/rider/akinci.glb [preview-dir]
```

Needs Blender 4.5 with the MPFB 2 extension enabled and the MakeHuman system assets, skins 01 and face units 01 packs
installed in MPFB's data folder (face units zip path: `RIDER_FACEUNITS`, default `/home/user/tools/mh-assets/faceunits01.zip`).
`-` as the output path renders the previews only.

| File | What it does |
| --- | --- |
| `build_rider.py` | Body (phenotype, face targets), Mixamo rig, eyes / brows / lashes / teeth, skin; outfit; face units and eye bones; clips; texture sizes; Draco + WebP glTF export. |
| `akinci.py` | The Akıncı outfit on the standing body (dolama, şalvar, boots, mail, vambraces, sash, çiçak, aventail, wings), skinned, AO baked, joined per material. |
| `garments.py` | Garment helpers: regions cut from the body by bone weights, grown shells, trims, piping, cloth settling, skinning, bone chains. |
| `wings.py` | Hezarfen's wind wings and their case (bone chains `wing_L/R_1..3`). |
| `face.py` | Face units kept as morph targets while the body targets are baked; keys copied to lashes / brows; eye bones. |
| `anim.py` | Procedural on-foot clips (idle, walk, run, run_stop, crouch, jump, glide) with its own forward kinematics and leg IK. |
| `mpfb.py` | Imports MPFB services inside Blender. |

Env: `RIDER_VIEWS` (preview views), `RIDER_HIDE` (name prefixes hidden in previews), `RIDER_POSE=0` (stop after the
standing previews), `RIDER_CLIPS` (author only these clips), `RIDER_FACE=0`, `RIDER_OUTFIT`.

Game side: `src/dragon/model/rider/` (`human.ts` loading and materials, `retarget.ts` on the dragon, `locomotion/` on
foot, `face.ts`, `wind-bones.ts`); test bench `sandbox/human.html`.
