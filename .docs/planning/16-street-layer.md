# Street track (S0–S8) — walkable Kadıköy

Milestone: G · On foot · Effort: L×many · Depends on: 01 (bug fixes only)

Full research, critiques and evidence: `.docs/research/direction-street-layer.json`.

## Goal

Land, dismount and walk through Kadıköy as a human; every place gets very detailed as you approach, so it
genuinely feels like walking there. Enter cafés and shops, talk to NPCs, later drive cars, and build a story on top.

## Decision

- The street is a **separate layer**, not the flight city seen up close. Shipped games split their flight/driving
  scale from their street scale (Starfield, Zelda TotK, Spider-Man); Flight Simulator 2024 shows what happens without
  the split (photogrammetry built to be seen from the air).
- An **offline world compiler** (Node + Blender command line) reuses the game's OSM and façade code and emits plain
  glTF 2.0 tiles plus JSON manifests (doors, POIs, lights, spawn points, seats, NPC slots) that any runtime loads.
  Compiled tiles stay out of git (release assets, later R2).
- The **runtime is chosen by measurement** (S2): the same compiled strip is rendered in three.js r186
  WebGPURenderer, Godot 4.7 Forward+ and Unreal Engine 5.8, next to Blender reference renders, against one street-level test.
  three.js WebGL2 is ruled out for street level (no reprojection TAA, AO/SSR need a second scene pass, per-object
  diffuse probes, no clustered lights or local reflection probes — checked in `node_modules/three` 0.186.0).
- Rejected: Unreal 5 (binary assets, experimental editor-only MCP, M2 Max below the recommended spec, no web),
  Unity 6.6 on WebGPU (baked GI only on web, YAML/GUID scenes, paid MCP on Personal), Bevy (no editor, IK, navmesh,
  streaming), walking on the flight world everywhere, photogrammetry / Google 3D Tiles, runtime-generated street detail,
  LLM-driven NPCs.

## World layers

- **L0 flight world** (existing three.js code): far field beyond ~600 m when on foot.
- **L1 city tiles**: the OSM city re-emitted as ~250 m chunks with building IDs, 3 LODs and entrances; mid-distance
  view on foot and the view from the air.
- **L2 street layer** (Kadıköy first, Galata–Karaköy second): ~100 m tiles streamed within ~300 m of the player —
  façades with real depth (wall thickness, window reveals, çıkma balconies, railings, shutters, AC units, cornices),
  shopfronts from OSM POIs with fictional Turkish signs, sidewalks, kerbs and cobbles, instanced furniture, a light
  list, true-footprint colliders, door records, baked AO and probes/lightmaps at 4 times of day.
- **L3 interior cells**: parametric shells (café, shop/meyhane, apartment stairwell, han/pasaj) fitted to their
  building by the compiler; a short fade at the door first, seamless once one fitted example passes the test.

## Gameplay systems (three.js | Godot)

- Entity layer, possession and an input context stack (ui > dialogue > vehicle > on foot > flight).
- Walking: Rapier KinematicCharacterController | CharacterBody3D on Jolt.
- Cars (S7): Rapier raycast vehicle | VehicleBody3D; the player's car joins the IDM traffic simulation as a leader.
- Navigation and crowds: recast-navigation-js + DetourCrowd | NavigationServer3D with avoidance.
- Humans (decided 2026-09-24): **MetaHuman** characters (free under $1 M revenue, usable in any engine since mid-2025)
  for the player, hero NPCs and the crowd (low LODs), faces animated with MetaHuman Animator (video or audio to face,
  incl. Turkish lip-sync, quality untested); **Mixamo** mocap clips for body animation, retargeted with Unreal's IK
  Retargeter; faces baked to plain joint keys (Character DNA in Blender) so runtimes need no RigLogic. Pipeline:
  `.docs/assets/humans-pipeline.md`.
  Neither licence allows redistributing raw files, so they live in a private asset store (`private-assets/`, gitignored)
  and only ship inside game builds; the public repo keeps code, manifests and CC0/CC-BY assets. The free CC0 candidates
  (Rocketbox, MPFB2, Quaternius) looked dated or lacked animations (`.docs/assets/candidates/humans.md`).
- Dialogue: ink (`story/*.ink`, inkjs | godot-ink), external functions for game actions, tags for camera/animation,
  Ink-Localiser line IDs (Turkish first, English), rule-matched barks for passers-by. No LLM NPCs.
- Save: one versioned SaveDoc (context, district, interior, position, controlled entity, world flags, ink state),
  IndexedDB with export/import | JSON in `user://`; autosave at every transition.

## Phases

| # | Phase | Deliverable | Effort |
|---|---|---|---|
| S0 | Kadıköy data and compiler skeleton | Multi-area OSM (`area.ts` becomes a list, `entrance=*` fetched); greybox Kadıköy tiles (true-footprint blocks with doorways, sidewalks, kerbs, POI/entrance manifest) walked by a scripted 1.7 m camera on a sandbox page; `walk-test.mjs`; median/p99 frame times in `snap.mjs` | M |
| S1 | One strip, content only | ~200 m from the Rıhtım into the çarşı at walking scale: façade kit for the 1950–70s balconied apartment type, shopfronts, cobbles, kerbs, furniture, ≥ 32 night lights, AO and probe bakes, 200 CC0 pedestrians, a greybox café behind an open door; 10 Blender shots paired with reference photos | L |
| S2 | Runtime comparison (go/no-go) | The same strip in three.js WebGPU and Godot 4.7 vs Blender: 10 shots each, walking captures, performance table, agent change-and-verify time; decision recorded | M–L |
| S3 | Walk | Step off the ferry, walk/jog/run over kerbs and steps; save v0 | M |
| S4 | Step inside and talk | Enter the café, sit, order çay in a Turkish ink conversation that sets a flag; a passer-by comments; save/reload keeps both | L |
| S5 | The heart of Kadıköy | ~0.4 km² (Rıhtım, çarşı, Altıyol, Bahariye up to Süreyya), 2 more façade types, walking-scale hero spots, the nostalgic tram, 5 enterable places from 3 shells, 8–10 hero NPCs with schedules, full night pass | L×3 |
| S6 | From sky to street | Flight and street in one runtime; L1 tiles; landing pads (Rıhtım, Moda Burnu) that preload on approach; walking within 3 s of landing with no hitch over 50 ms | L×3–4 |
| S7 | Drive | Take a parked taxi on Rıhtım Cd, drive a loop while AI traffic yields, park, walk into the çarşı | M |
| S8 | Chapter one | Quest journal and 3–5 ink quests mixing flying, walking and driving; Galata–Karaköy as the second street district | L+ |

## The street-level test (S2, identical in both runtimes, M2 Max)

- Scenes: day, dusk, night with ≥ 32 local lights; 200 animated pedestrians in view and one NPC at 2–3 m; a lit shop
  window; an open café door with the interior visible; a walking capture at 1.4 m/s.
- Performance: "high" at 1600×900 — median ≥ 60 fps, p99 ≤ 25 ms, render scale ≥ 90 %, no streaming hitch > 50 ms;
  "medium" at 1280×720 — median ≥ 60 fps; web first-visit street data ≤ 150 MB.
- Visuals: 10 shots paired with reference photos pass the checklist (façade depth visible, shopfront density and
  signage, kerbs and sidewalks, furniture and people, AO in corners, no visible LOD swap within 30 m, no flicker on
  railings, shutters, cables or signs); the user signs off.
- Co-op readiness (added 2026-09-24 for [17 — Hamallar](17-hamallar-coop.md)): for each runtime, a short spike and a
  written assessment of (a) host-authoritative networking for 4 players carrying shared physics objects, (b) Steam
  integration — lobbies, invites, friends, achievements (GodotSteam for Godot; Electron/Tauri + steamworks.js for a
  three.js build), (c) proximity voice chat, (d) a streamer mode (muted licensed audio, hidden join codes). Streamers
  play co-op games on Steam, so a desktop Steam build is expected for the co-op game whichever runtime wins.
- Third candidate (added 2026-09-24): **Unreal Engine 5.8** (Lumen, Nanite, MetaHumans native) runs the same strip
  from the same glTF output. Its original rejection rested on agent-unfriendliness, no web build and the M2 Max being
  below spec; the first reason no longer holds (agents drive the open editor through tools/unreal's Python job runner),
  the user accepts desktop, and co-op needs Steam anyway. Measure it with the same test; its web gap and Mac
  performance are part of the result.
- Target hardware (decided 2026-09-24): a PC that runs CS2 at 60 fps must run the game at 60 fps with good graphics.
  Tiers: **Medium** = GTX 1060/1650 / RX 580 class at 1080p, 60 fps (baked lighting at 4 times of day, cheap haze,
  AO, lens effects, crowd impostors); **High** = RTX 3060 class at 1080p, 60 fps (dynamic GI, volumetric fog, denser
  crowd). Development is Mac-only (M2 Max, no Windows PC), so the test uses proxy thresholds on the M2 Max (its GPU is
  roughly RTX 3060 class, ~3× a GTX 1060): **High ≥ 60 fps and Medium ≥ 150 fps at 1080p** on the M2 Max, with extra
  margin for Metal-vs-Windows driver differences.
- Windows builds (decided 2026-09-24): streamers and most Steam players are on Windows. Godot and three.js can build
  Windows versions from the Mac and smoke-test them on GitHub's free Windows runners (no GPU, so no fps). Unreal can only
  package Windows builds on a Windows host and does not fit the free runners, so Unreal stays in S2 as the visual
  reference but can only be chosen if a Windows machine (a PC or a paid cloud VM) becomes available.
- Decision rule: Blender fails → fix the kit, not the engine. Both pass → three.js WebGPU (keeps the web link and the
  flight game) unless Godot is clearly better side by side **or clearly better for co-op readiness**. Only one passes
  → that one. Neither passes while Blender does → rerun once at lower density, then take the closer one.

## Keep / change / stop

- **Keep:** the live flight game and web demo; the engine skeleton and the tsc + snap.mjs loop; phase-01 bug fixes;
  the Galata slice frozen (always on since 24 September 2026; its generators become compiler inputs); the Kadıköy research as the hero list
  (piers, Haldun Taner, İskele Camii, Şehremaneti, Osmanağa, Surp Takavor, the Boğa, Süreyya and Bahariye at walking
  scale; stadium, marina, lighthouse and parks stay flight-scale landmarks).
- **Change:** build Kadıköy once, at walking scale (its low-detail tiles are the view from the air); phases 08/09
  tiling and landing pads move behind the S2 decision; driving comes after walk, enter and talk.
- **Stop:** new GLSL / onBeforeCompile / WebGL2 post passes for street content; more detail on the flight-scale slice
  or a city-wide rollout before L1 tiling; runtime generation of anything seen at eye level; porting the flight world
  to TSL before S2 picks the web; phases 11, 12, 14 and 15 until the Kadıköy slice ships.

## Not built on purpose

Walking the whole city, entering every building, photoreal faces, voice acting, car damage, mobile support.

## Decisions taken

- 2026-09-24, web or desktop: the user prefers the web but accepts desktop. S2 decides: if the street test passes on
  the web with good performance, the game stays on the web (three.js WebGPU); otherwise the walking game moves to
  Godot on desktop and the flight demo stays on the web as a teaser.

## Open decisions for the user

- Look: grounded realism (real proportions, CC0 photo-scanned materials, CC0 humans at medium framing), judged on S2 renders.
- Asset approvals before S1: Poly Haven / ambientCG materials and café/street props (shortlists in `.docs/assets/candidates/`).
- Story premise and tone (Turkish first, real streets and landmarks named, all businesses fictional).
