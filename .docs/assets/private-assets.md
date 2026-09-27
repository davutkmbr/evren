# Private assets

Assets whose licence allows use inside the game but forbids redistributing the raw files. They live in
`private-assets/` (gitignored), are never committed or copied into `public/`, and reach players only inside builds.

| Source | Use | Licence | Notes |
|---|---|---|---|
| MetaHuman (Epic Games) | Player, hero NPCs, crowd (low LODs); faces via MetaHuman Animator | MetaHuman licence / Unreal Engine EULA: free under $1 M annual revenue, usable in any engine since mid-2025, no royalty outside Unreal | Characters are created in the Unreal Engine MetaHuman plugin and exported once. |
| Fab: Epic MetaHuman wardrobe | Crowd and NPC clothing (garments, shoes, construction presets) | Fab Standard License, Professional tier ($0): any engine; no standalone distribution; restrict extraction by end users | Added via Fab "Add to Project" in the Unreal project; approved 2026-09-24 (`.docs/assets/candidates/metahuman-outfits.md`). |
| Mixamo (Adobe) | Body animation clips, retargeted to the MetaHuman skeleton with Unreal's IK Retargeter (batch, Python) | Mixamo FAQ: royalty-free in games; raw files must not be redistributed | Downloaded "without skin" per clip. |
| Historic 78 rpm recordings, US-risky (Internet Archive, Gallica / BnF) | Moment pieces (music under moments) | Public domain in Turkey (published before 1956; composers and improvising performers died before 1956), **still protected in the US** (published 1926 or later, 17 U.S.C. §1401). Kept out of the public repository so it does not redistribute them; the owner accepts the residual risk (2026-09-26) | Full attribution below and in [archive-78rpm.md](archive-78rpm.md). Takedown requests: `<contact-email>`. |

## One copy everywhere: the private repository

`private-assets/` is a clone of the owner's private repository `davutkmbr/seventeenskies-private` (only the owner has
access; anyone given access would receive the files, so it stays that way). Every machine and cloud session works on
the same files, with their history as the backup:

- `npm run private:pull`: the first time, turns an existing folder into a clone in place (local files are kept); then
  fast-forwards to the repository. Run it after cloning the game repository, and in a cloud session once the private
  repository is attached.
- `npm run private:push -- "what changed"`: commits every change in the folder and pushes. `build/` is not pushed
  (the tools regenerate it: `tools/humans/build_rider.py`, `scripts/audio/prep-moment-music.py`).
- `npm run private:status`: local changes, and how far behind or ahead of the repository.

`EVREN_PRIVATE_REPO` points the scripts at another repository.

## Layout

```
private-assets/
  unreal/EvrenHumans/         Unreal 5.8 project (MetaHuman Creator, Animator, IK Retargeter, exports)
  metahuman/<character-id>/   exported characters (source) + runtime LOD exports
  mixamo/<clip>.fbx           source clips (without skin)
  build/                      retargeted, packed runtime files (per runtime)
  audio/moments/              processed US-risky moment pieces: <id>.opus / .m4a (default) and <id>.raw.opus / .raw.m4a,
                              plus manifest.json (same format as public/audio/music/manifest.json, src paths "private/…")
```

The raw originals of these recordings are in the gitignored `assets-src/audio/78rpm/<id>/` like every archived 78
(`node scripts/data/fetch-assets.mjs --kind=recording --no-docs` re-downloads them and checks their sha256); the
moment pieces are rebuilt with `python3 scripts/audio/prep-moment-music.py` (target `private` in
`tools/assets/moment-pieces.json`).

## How private assets reach builds

- **Music (US-risky historic recordings).** `vite.config.ts` serves `private-assets/audio/moments/` at
  `/audio/music/private/` on the dev server and copies its `.opus`, `.m4a` and `manifest.json` files to
  `dist/audio/music/private/` at the end of `vite build`, when the folder exists. The game loads
  `audio/music/private/manifest.json` next to the public manifest and merges its phrases (`mergePrivatePhrases` in
  `src/audio/music/manifest.ts`: only `private/…` files, never replacing a public id; the public manifest rejects
  `public-domain-tr` pieces and `private/` paths). A checkout or build without the folder simply lacks those pieces: a
  moment that names one (`musicId`) falls back to the mood choice. `EVREN_PRIVATE_ASSETS=0` leaves them out of a dev
  server or build, e.g. for a build that is published openly.
- **MetaHuman.** Exported runtime files under `build/` (per runtime), wired when that pipeline lands.
- **Mixamo (the rider's body clips).** The owner downloads the clips below into `private-assets/mixamo/` (subfolders
  allowed; FBX Binary, "Without Skin", 30 fps, no keyframe reduction; the travelling clips with "In Place" off).
  `python3 tools/humans/mixamo_names.py` renames the downloads to lowercase snake_case: our clip name for ours
  ("Breathing Idle (1).fbx" -> `idle.fbx`), the title otherwise ("Great Sword Slash.fbx" -> `great_sword_slash.fbx`);
  the retarget also accepts the Mixamo titles unrenamed. Any other
  FBX is retargeted too, as an extra clip `x_<slug>` (loop and travel measured) with a category guessed from its name;
  `private-assets/build/rider/report.md` lists every clip with its measurements, to decide where the extras go in the
  game (the bench plays any of them: `sandbox/human.html?clip=x_<slug>`).
  `tools/humans/build_rider.py` retargets them onto the rider skeleton (`tools/humans/mixamo.py`: world rotation changes
  from each rest pose, hips travel scaled by leg length, root motion measured and removed) and writes
  `private-assets/build/rider/clips.glb` + `clips.json` (durations, speeds, take-off and landing times). `vite.config.ts`
  serves that folder at `/private/rider/` in dev and copies it to `dist/private/rider/` on `vite build`; the game loads it
  after the character (`loadPrivateClips` in `src/dragon/model/rider/human.ts`) and the captured clips replace the
  procedural ones of the same name. Without the folder the procedural clips stay.

  | File | Mixamo animation |
  |---|---|
  | `idle.fbx` | Breathing Idle |
  | `idle_look.fbx` | Looking Around |
  | `idle_warrior.fbx` | Warrior Idle |
  | `walk.fbx` | Walking |
  | `run.fbx` | Running |
  | `run_stop.fbx` | Run To Stop |
  | `crouch_idle.fbx` | Crouching Idle |
  | `crouch_walk.fbx` | Crouched Walking |
  | `jump_start.fbx` | Jumping Up |
  | `jump_fall.fbx` | Falling Idle |
  | `jump_land.fbx` | Falling To Landing |
  | `jump_land_hard.fbx` | Hard Landing |
  | `run_jump.fbx` | Running Jump |
  | `turn_left.fbx` | Left Turn |
  | `turn_right.fbx` | Right Turn |

  The owner's additional picks (2026-09-27), also wired into the controller:

  | File | Mixamo animation | In the game |
  |---|---|---|
  | `jog.fbx` | Running (a bit slower) | the fast gait up to its own speed, then the run |
  | `run_stop_quick.fbx` | Run To Stop (a faster stop) | stopping from a jog |
  | `turn_left_wary.fbx`, `turn_right_wary.fbx` | Left / Right Turn (a more hesitant one) | walking off at a right angle from standing |
  | `walk_turn_180.fbx`, `run_turn_180.fbx` | Walking / Running Turn 180 | walking or running off the other way from standing; turning round mid-run |
  | `jump_land_heavy.fbx` | Hard Landing (from higher) | landing from a great height |
  | `fall_flail.fbx` | Falling | a long fall that is not a jump (off a roof, off the dragon without the wings) |
  | `run_flip.fbx` | Running Forward Flip | F while running |
  | `run_roll.fbx` | a forward dive roll while running | landing fast while running |
  | `run_slide.fbx` | Running Slide | crouch pressed while running |
  | `idle_look_2.fbx` | Looking Around (another) | an idle variation |
  | `walk_start.fbx` | Start Walking | setting off ahead after standing a while |
  | `walk_turn_left.fbx`, `run_turn_right.fbx` | Walking Left Turn, Running Right Turn | a sharp turn on the move; the other side of each (`walk_turn_right`, `run_turn_left`) is the same clip mirrored unless its own file is there (Walking Right Turn, Running Left Turn) |
  | `crouch_to_stand.fbx` | Crouch Turn To Stand | standing up from a crouch to go the other way |

  Turning clips have their heading change taken out and recorded (`turn`, `turn_curve` in clips.json; the controller
  turns the body by it); take-off clips lose their own rise in the air (the jump physics carries the body) and record
  their flight time (`air`), which the controller stretches over the physical one. Travelling clips record their ground
  speed over time (`speed_curve`): the first steps and the turns on the move travel at it. A clip that starts facing well off
  to the side (the roll) is turned to face ahead, and the roll skips its lead-in steps (`start`).

## US-risky moment pieces (full attribution)

| Piece | Recording | Performers | Label, catalogue / matrix | Year | Archive | US status | Moments |
|---|---|---|---|---|---|---|---|
| `katibim-safiye-ayla-1949` | Kâtibim (Üsküdar'a Gider İken), 0:00.5–1:39 | Safiye Ayla, with violin, kanun, ud and clarinet | 78 rpm (label not stated by the upload) | 1949 | [Internet Archive](https://archive.org/details/KatibimuskudaraGiderIken-SafiyeAyla) | protected until 1 Jan 2060 | `katibim-uskudar-yagmur` |
| `huseyni-taksim-hafiz-kemal` | Hüseyni Taksim (side 1), 0:00–1:27 | Hafız Kemal Bey (kemençe, 1884–1939) | Pathé, matrix N 11016 | c. 1927–1928 | [Gallica / BnF](https://gallica.bnf.fr/ark:/12148/bpt6k1310275k) (Archives de la Parole, AP-3029) | protected until 1 Jan 2028 or 2029 | `sinan-turbe-kitabesi` |
| `huzzam-taksim-resad-bey` | Hüzzam Taksim (side 2), 0:00.4–1:21 | Reşad Bey (violin) | Pathé, matrix N 11136 | c. 1927–1928 | [Gallica / BnF](https://gallica.bnf.fr/ark:/12148/bpt6k13102426) (Archives de la Parole, AP-2995) | protected until 1 Jan 2028 or 2029 | `hasim-bir-gunun-sonunda-arzu`, `kiz-kulesi-legend` |

Gallica files carry the BnF reuse conditions (credit "Source gallica.bnf.fr / BnF"; commercial reuse needs a BnF
licence). The other US-risky recordings (the rest of the Pathé discs, the Darülelhan and Hafız Burhan sides) are
archived only; see [archive-78rpm.md](archive-78rpm.md). Takedown contact for all of them: `<contact-email>`.

## Log

| Date | Asset | Source | Added by |
|---|---|---|---|
| 2026-09-26 | US-risky 78 rpm moment pieces `katibim-safiye-ayla-1949`, `huseyni-taksim-hafiz-kemal`, `huzzam-taksim-resad-bey` (owner approval 2026-09-26) | Internet Archive; Gallica / BnF | Claude (archive-78rpm pass) |
