# Humans pipeline: MetaHuman + MetaHuman Animator + Mixamo, outside Unreal

Research only, checked live on 2026-09-24. Nothing was installed, launched or downloaded. Local state was read
without changes: **UE 5.8.3 is already installed** (`/Users/Shared/Epic Games/UE_5.8`, 43 GB, MetaHuman plugins
present) and **Blender 5.2.1** is installed. The Mac is an M2 Max (8 performance + 4 efficiency cores, 30-core GPU,
32 GB) on macOS 27.0, with 268 GB free.
Context: plan 16 (street layer), `private-assets.md`. Numbers marked *est.* are my estimates. Everything else is
quoted from the linked source.

## Recommended pipeline

1. **Create** each character in **MetaHuman Creator inside UE 5.8** (the web app takes no new users and shuts down on
   2026-11-05). Auto-rig it as **joints-only** and download **2K textures** (4K for the player's head), using the
   Python API once you have signed in.
2. **Export** the **DCC Export** (`head.dna`, `body.dna`, `Maps/*.png`). Export the clothing and hair-card meshes
   from a **UE Optimized** assembly as FBX, because the DCC export does not contain them.
3. **Convert** in Blender 5.2 with **Character DNA** (Poly Hammer; free; GPLv3; bundles Epic's MIT OpenRigLogic;
   supports macOS arm64). It imports the DNA, lets you choose a LOD, attaches clothing and hair, bakes materials to
   glTF PBR and exports one GLB per LOD tier (hero, near, crowd). Then run `gltf-transform` / `gltfpack` for meshopt
   compression and KTX2 textures.
4. **Body clips:** download Mixamo FBX "without skin" and retarget them to the MetaHuman body with UE's
   **IK Retargeter**. Epic lists MetaHumans as a built-in template, and batch retargeting is available from Python.
   Export FBX, then bake the body's RBF correctives in Character DNA and export glTF actions.
   *This changes `private-assets.md`, which says the retarget happens in Blender.*
5. **Faces:** generate a MetaHuman Animator performance (audio-to-face, or mono video; both work on macOS in 5.8) and
   export the face-board curves. Import them in Character DNA, then **bake them to plain joint keys** (plus shape
   keys and wrinkle-mask values when the LOD has them). Export one glTF clip per dialogue line on the hero head LOD.
   RigLogic is not needed at runtime.
6. **Runtime:** both engines use standard skinned glTF. Heroes use head LOD1–2 and body LOD0–1. The crowd uses head
   LOD5–7, body LOD3 and hair mesh LOD5–7, with baked animation textures and instancing beyond about 15 m.
7. **Proof of concept before bulk work:** one hero speaking a Turkish line at 2 m, plus 200 crowd instances, run in
   both runtimes inside the S2 test.

---

## 1. Creating and exporting a MetaHuman for use outside Unreal

**Current state**

- The current engine is **UE 5.8**, released June 2026; **5.8.3** is installed here. MetaHuman 5.8 adds:
  - the experimental Crowd plugin;
  - MetaHuman Animator (MHA) facial solving on macOS and Linux;
  - OpenRigLogic (the RigLogic and DNA libraries) under **MIT**.
- **Web Creator:** since UE 5.6 (June 2025) the Creator lives inside UE, and the web app takes no new users. Support
  for UE 5.5 ends and the web app shuts down fully on **2026-11-05**, followed by a 90-day window to retrieve
  characters.
- **Licence:** since June 2025, MetaHumans are "non-engine products" under the standard UE EULA. They can be used in
  Unity, Godot or any other engine with no royalty. They are free under $1 M annual revenue; above that you need a
  $1,850/yr seat. Using them to train AI models is not allowed.

**Steps (UE 5.8)**

1. In the Epic Launcher, open the UE 5.8 **Options** and tick **MetaHuman Creator Core Data**. The local launcher
   manifest lists only the `templates` and `engine_source` install tags, so this is probably not installed yet.
2. Create a project and enable the **MetaHuman Creator** plugin (plus Python Editor Script, IK Rig and MetaHuman
   Animator).
3. In the Content Browser, create a **MetaHuman Character** asset and edit it. The options are presets, sculpting,
   parametric body, skin, eyes, makeup, and the wardrobe (grooms and outfits).
4. **Rig:** the auto-rig runs as a MetaHuman Cloud service and needs an Epic sign-in. The rig type is
   `JOINTS_ONLY` or `JOINTS_AND_BLENDSHAPES`. Use **joints-only**, because the 669 blend shapes exist only at LOD0.
5. **Download texture sources:** also a cloud service, at 2K, 4K or 8K. Assembly on 32 GB can run out of memory with
   large textures, so avoid 8K.
6. **Assemble or export:**
   - **Export > DCC Export:** a zip with `.dna`, `.png` and `.json` files.
   - **Geometry Export:** head, body or full-body skeletal meshes, into the project.
   - **DNA Export**
   - **Materials Export**
   - The **UE Optimized** High / Medium / Low assembly builds the clothing and hair-card assets.

**Export formats**

| Route | What you get | Use for Evren |
|---|---|---|
| DCC Export (5.8 Export tool) | `head.dna` and `body.dna` (meshes for all LODs, joints, skin weights, blend shapes, RigLogic and RBF data) plus textures (head and body colour, normal, SMRF, animated-map masks). **No clothing, no grooms.** | **Main route**, into Blender via Character DNA |
| MetaHuman for Maya / Houdini | Epic's official DCC plugins (DNA plus RigLogic; Maya 2026 supported). Paid DCCs. | Not needed |
| FBX from UE (Asset Actions > Export, or Python `AssetExportTask`) | Skeletal or static meshes with LODs and morph targets, and animation sequences. RigLogic is lost: you get the bind pose plus whatever animation was baked. | Clothing, hair cards, helmet meshes; retargeted clips |
| glTF from UE (GLTFExporter plugin, installed) | GLB of meshes and animations. Reported to strip morph names and to reach about 700 MB when all RigLogic morphs are included (sociofuture). | Fallback only |
| USD (UE USD exporter) | Meshes, skeletons and animation | Not needed |

**What an export contains** (Epic LOD specification; per-character values vary)

| Head LOD | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| Vertices | 24,000 | 12,000 | 6,000 | 2,500 | 1,300 | 560 | 270 | 130 |
| Triangles *est.* (≈2× vertices) | ~48k | ~24k | ~12k | ~5k | ~2.6k | ~1.1k | ~540 | ~260 |
| Face joints | 713 | 529 | 397 | 283 | 84 | 70 | 41 | 26 |
| Skin influences | 12 | 12 | 12 | 8 | 8 | 8 | 4 | 4 |
| Blend shapes / animated (wrinkle) maps | 669 / yes | – / yes | – | – | – | – | – | – |
| Hair | cards 30k v (strands 50k) | cards 15k v | cards 10k v | cards 3k v | cards 1.5k v | mesh 500 v | mesh 250 v | mesh 100 v |

- **Body:** LOD0–3 with 30,500 / 7,600 / 3,350 / 1,507 vertices. Correctives are active at LOD0–1, and the skin
  influences are 8 / 8 / 8 / 4. Head and body LODs are synced 2:1 by LODSync.
- **Skeletons:** there is one hierarchy. The body joints use UE5-Mannequin names (`root`, `pelvis`, `spine_01–05`
  and so on). There are about 64 core FK joints, plus twist and RBF-corrective helpers: the 5.8 archetype body DNA
  lists about 330 joint names (a rough count from the local file). Face joints sit under `head`. Mixamo has about 65
  bones.
- **Face rig:** RigLogic turns face-board control curves into joint transforms. At LOD0 it also drives blend shapes
  and wrinkle-map masks. Below LOD0 the face is **joint-driven only**.
- **Hair:** strands (grooms) are UE-only; Mac renders cards only, and strands need M2 or newer with SM6. Outside UE,
  use the **cards** (LOD0–4) and the **helmet meshes** (LOD5–7).
- **Textures:** the texture-source resolution you download (2K, 4K or 8K). Epic lists 8192 as the maximum on PC and
  Mac. An Optimized assembly is "under 100 MB" per character; UE Cine is 1–2 GB.

**This Mac**

- UE runs natively on Apple Silicon (a universal binary since 5.2).
  - UE 5.8 minimum: macOS 14.5, M1/M2, 16 GB.
  - UE 5.8 recommended: M3, 32 GB.
  - MetaHuman Creator and Animator recommend 16 performance cores and an M2 Ultra-class GPU with 32 GB.
  - The M2 Max is **supported but below the recommendation**, so expect slow assembly.
  - **macOS 27 is newer than any version Epic lists.** Confirm with one launch.
- **Disk:** the engine takes 43 GB (installed), and there are 268 GB free. The Creator Core Data size is not
  published. Budget about 20–40 GB for the project and derived data (*est.*).

## 2. Face animation outside Unreal (no RigLogic at runtime)

**What MHA produces**

- A **MetaHuman Performance** asset from audio, mono video, stereo or depth video. It exports as an **Animation
  Sequence of face-board control curves** on `Face_Archetype_Skeleton`, optionally with head rotation, or as a
  **Level Sequence** with a control-rig track.
- **Audio-to-face** has moods (Neutral, Happy, Sad, Disgust, Anger, Surprise, Fear, Auto), full-face or mouth-only
  output, and head movement.
- Epic's documentation names **no supported languages**, so **Turkish quality is unverified**. Test it in the POC.
- **macOS in 5.8:** "Offline and real-time facial MetaHuman Animator functionality available on Linux and macOS".
  The body solve and markerless mocap are Windows-only; Evren does not need them.

**Playing it in Godot or three.js**

| Option | How | Fidelity | Data | Verdict |
|---|---|---|---|---|
| **Baked joint curves** | Character DNA "Bake" writes the face-board action to "keyframes on the pose bones, shape key values, and Texture Logic node mask values". In UE, a Sequencer bake to an Anim Sequence (`SequencerTools.export_level_sequence_fbx`) does the same. | Equals UE at LOD1–7 (joint-only there). Wrinkle maps need a custom shader. | *est.* 397 joints × 7 floats × 30 fps ≈ 330 KB/s raw, much less after resampling and quantisation | **Recommended** for authored dialogue |
| ARKit-style morph targets | Bake the 52 ARKit poses from Epic's `AS_MetaHuman_ARKit_Mapping` (present in 5.8) into shape keys. Proven in both engines (MetaHumanGodot; sociofuture metahuman-to-glb: 51 shapes, about 40 MB GLB at 1K). | Lossy. MHA does not output ARKit weights, so they need a per-frame fit. | ~6 KB/s | Fallback if the web data budget breaks; also good for procedural blinks and expressions |
| RigLogic at runtime | OpenRigLogic (MIT C++) compiled as a Godot GDExtension or WASM for three.js | Exact | Curves only | No public port was found. Not now. |

**Working examples**

- **Godot:** [ibrews/MetaHumanGodot](https://github.com/ibrews/MetaHumanGodot) (Godot 4.6, glb with baked ARKit
  shape keys and groom cards; the UE→Godot automation is not public).
- **three.js:** [sociofuture/metahuman-to-glb](https://github.com/sociofuture/metahuman-to-glb) (MIT; UE 5.7 →
  Blender → Draco GLB → three.js; the scripts are PowerShell and Windows-oriented).
- Neither plays MHA performances. Both show only the rig and the ARKit poses.

## 3. Mixamo onto the MetaHuman body

**Most reliable route: the UE IK Retargeter**

- In "Retarget Animations", **Auto Generate Retargeter** builds the IK Rigs and the retargeter.
- MetaHumans are a listed template. Mixamo is not named, so check the chains and the T-pose-to-A-pose retarget pose
  once, save the assets and reuse them.
- Batch work runs from Python with `IKRetargetBatchOperation.duplicate_and_retarget()` and `IKRetargeterController`.
  Export the result as FBX.
- Import each Mixamo clip against one "with skin" Mixamo character (for example X Bot), which serves as the source
  mesh. Use "In Place" for locomotion, because Evren uses a kinematic controller.
- Cost: free, part of UE.

**Free Blender options**

- **Character DNA** (GPLv3): imports retargeted body animation and bakes the RBF correctives (a step in both routes).
- **Expy Kit** (GPLv3; has Mixamo and UE5-Mannequin presets; last pushed 2025-12).
- **Rokoko Studio Live** (LGPL-3.0, v1.4.3; needs a one-time Rokoko account sign-in).
- Built-in **Copy Transforms constraints plus an NLA bake**, which a script can drive.
- Paid options: Auto-Rig Pro, and UNAmedia's UE plugin.
- The tools' GPL/LGPL licences do not apply to the animation data you produce with them.

**Mixamo licence, as live on 2026-09-24**

- The FAQ says Mixamo "is available free for anyone with an Adobe ID", and that "You can use both characters and
  animations royalty free for personal, commercial, and non-profit projects including … Create video games."
- The [Mixamo Additional Terms](https://wwwimages2.adobe.com/content/dam/cc/en/legal/servicetou/Mixamo-Addl-Terms-en_US-20210623.pdf)
  (2021-06-23) add only an AI/ML training ban.
- The earlier FAQ wording, preserved in a community copy, barred "asset packages … which redistribute character or
  animation raw files as the product". The live FAQ no longer contains that sentence.
- **Conclusion:**
  - A public code repository is fine.
  - Raw and retargeted clip files (FBX and GLB) stay in `private-assets/` and ship only inside builds. This is the
    existing decision and remains the safe reading.
  - The web build should load them as game data, not from a browsable asset list.
  - Do not upload the raw files to AI services. Both the Mixamo and MetaHuman terms forbid AI training.

## 4. Runtime feasibility on the M2 Max

**Engine facts**

- **three.js r186** (checked in `node_modules/three`):
  - `GLTFLoader` reads only `JOINTS_0` / `WEIGHTS_0`, so **4 influences**. MetaHuman uses 8–12 at head LOD0–5.
    Either renormalise to 4 or write a TSL skinning node with 8 influences.
  - Bone matrices come from a buffer, so there is no hard bone cap.
  - `computeSkinning` exists (skin once and reuse the result across passes).
  - The `webgpu_skinning_instancing` example gives every instance **one shared pose**.
- **Godot 4.7:**
  - The glTF importer reads `JOINTS_1` / `WEIGHTS_1`, so **8 influences** (`ARRAY_FLAG_USE_8_BONE_WEIGHTS`, checked
    in the 4.7-stable source).
  - The CPU cost of Skeleton3D is the known crowd bottleneck (#99194).
  - MultiMesh has no skeletons. VAT plugins exist (antzGames, MIT), but MultiMesh does no per-instance culling or LOD.
- **three.js crowds in the field:** 300 skinned meshes with 25 bones each broke 60 fps on an older i7. Sharing
  skeletons reached 1,000 at 60 fps. Instancing plus animation LOD reached 2,000 at 144 fps.

**Budgets**

| | (a) Hero at 1–3 m | (b) Crowd of 200 |
|---|---|---|
| LODs | Head **LOD2** by default (6k v, 397 joints); LOD1 (12k v, 529 joints) for the player or close dialogue in Godot. Body LOD0–1. Hair cards LOD1–2. | 0–15 m: head LOD4–5, body LOD2–3, hair cards LOD3–4. Beyond: head LOD6–7, body LOD3, hair mesh LOD5–7. Cross-fade LODs, because the S2 test allows no visible swap within 30 m. |
| Triangles *est.* | 50–90k including clothing | 2.5–5k each, so 0.5–1 M in total. The GPU handles this easily; CPU and draw calls are the real limit. |
| Bones | About 400–600 (face plus about 100 body) | About 25–65 body joints with no correctives (Epic turns them off at LOD2–3); face ≤ 26–70 joints or static |
| Influences | Godot 8; three.js 4 unless a custom node is written | 4 |
| Textures *est.* | 2K KTX2/BC7 for colour, normal and ORM on head, body, clothes and hair: about 12 textures, ≈ 65 MB GPU. 4K player head in Godot only. | One atlas per look at 512–1K (colour, normal, ORM). For 30 looks: about 15–30 MB download, which must fit the 150 MB street budget. |
| Animation | Per-character mixer every frame | Within 15 m: the nearest 20–30 get full skinned updates, the rest throttled or sharing skeletons. Beyond 15 m: one instanced draw per look with a **baked bone-matrix texture** and a per-instance clip and time offset (a TSL node in three.js; MultiMesh plus a VAT/bone-texture shader in Godot). |

## 5. Automation: agent vs human

| Step | Agent-scriptable | Needs a human |
|---|---|---|
| Launcher install options, first UE launch on macOS 27 | – | Yes |
| Create the project (`.uproject` JSON with the plugins enabled) | Yes | – |
| Create and vary characters | Yes: `MetaHumanCharacterEditorSubsystem` (presets, sculpting, body constraints, skin, wardrobe; 19 example scripts ship in the plugin) | The artistic look of hero characters, and final approval |
| Auto-rig, texture download | Yes: `request_auto_rigging` / `request_texture_sources` with `blocking=True` ("the supported pattern for batch and commandlet contexts") | **Epic sign-in** on the first cloud call in a session |
| Assemble, DCC / DNA / Geometry export, FBX export | Yes: `build_meta_human`, `MetaHumanCharacterExportBlueprintLibrary`, `AssetExportTask` | – |
| MHA audio-to-face, export | Yes: the plugin ships `process_audio_performance.py` and `export_performance.py` | Recording the lines, and approving the result |
| Mixamo downloads | – (no API; Adobe login in a browser) | **Adobe ID** in the browser |
| IK retargeting, export | Yes: `IKRetargetBatchOperation`, `IKRetargeterController` | Checking the first clip |
| Blender DNA import, bake, glTF export | Probably: `blender -b -P script.py` calling the add-on's operators (headless use is not documented; verify) | Installing Character DNA needs a **Poly Hammer Portal** account |
| Packing (gltf-transform / gltfpack), runtime import, performance captures | Yes | Visual sign-off |

- **Headless UE:** `UnrealEditor-Cmd <proj> -run=pythonscript -script=…` works without the UI. For steps that need
  the GPU (assembly texture graphs, MHA solves), use `UnrealEditor <proj> -ExecutePythonScript=…`, which opens the
  editor, runs the script and quits. Whether the commandlet works for those steps is not verified.
- The binaries are in `/Users/Shared/Epic Games/UE_5.8/Engine/Binaries/Mac/`.

## User actions (one-time, in order)

- [ ] 1. Epic Games Launcher → Library → UE 5.8 → Options → tick **MetaHuman Creator Core Data** → Apply.
- [ ] 2. Launch UE 5.8.3 once on macOS 27 and open the project the agent created under `private-assets/unreal/`.
      Let the shaders compile, then confirm the editor runs.
- [ ] 3. Sign in with your **Epic account** when the first auto-rig or texture request opens the MetaHuman Cloud
      sign-in. Accept the MetaHuman terms if the editor asks.
- [ ] 4. Shape or approve the first hero MetaHuman in MetaHuman Creator (face, body, skin, hair, outfit).
- [ ] 5. Create a free **Poly Hammer Portal** account, link its Blender extension repository and install
      **Character DNA** in Blender 5.2.1.
- [ ] 6. Sign in to **mixamo.com with your Adobe ID** and download:
      - X Bot "with skin" (T-pose);
      - the clip list "without skin", as FBX Binary at 30 fps, using "In Place" for locomotion.
      Save them into `private-assets/mixamo/`. First clip set (Mixamo search terms; pick the closest match):
      Breathing Idle, Standing Idle, Walking, Jogging, Running (the three with "In Place"), Left Turn 90,
      Right Turn 90, Stand To Sit, Sitting Idle, Sit To Stand, Sitting Talking, Talking, Drinking, Talking On Phone,
      Looking Around, Opening Door, Waving.
- [ ] 7. Provide 2–3 Turkish dialogue lines as WAV files for the audio-to-face test.
- [ ] 8. Approve the POC (a hero speaking at 2 m, and 200 crowd instances in both runtimes) before bulk production.
      Add the log rows in `private-assets.md`.

## Verify in the POC

- UE 5.8.3 launches and runs the MetaHuman cloud steps on macOS 27.
- Character DNA works headless.
- The MHA → Character DNA curve import works on 5.8.
- Turkish audio-to-face quality.
- Mixamo auto-retarget chains.
- Clothing export through Geometry/FBX, because DCC export has no clothing.
- 4 vs 8 skin influences on lips and eyelids in three.js.

## Sources

- MetaHuman 5.8 release notes: https://dev.epicgames.com/documentation/metahuman/metahuman-5-8-release-notes-in-unreal-engine
- MetaHuman 5.8 announcement: https://forums.unrealengine.com/t/metahuman-5-8-released/2729288
- Web Creator discontinued: https://forums.unrealengine.com/t/metahuman-creator-web-application-is-being-discontinued/2695297
- MetaHuman Creator in UE: https://dev.epicgames.com/documentation/metahuman/metahuman-creator-in-unreal-engine
- Export tool: https://dev.epicgames.com/documentation/metahuman/metahuman-creator-export-tool-in-unreal-engine
- Assembly: https://dev.epicgames.com/documentation/en-us/metahuman/assembly
- Python API: https://dev.epicgames.com/documentation/metahuman/metahuman-creator-python-scripting-in-unreal-engine
- LOD specifications: https://dev.epicgames.com/documentation/metahuman/platform-support-and-lod-specifications-for-metahumans
- MetaHuman hardware: https://dev.epicgames.com/documentation/metahuman/hardware-requirements
- UE 5.8 macOS requirements: https://dev.epicgames.com/documentation/unreal-engine/macos-development-requirements-for-unreal-engine
- MHA process and export: https://dev.epicgames.com/documentation/metahuman/metahuman-animator-02-process-and-export-your-animation-in-unreal-engine
- Audio-driven animation: https://dev.epicgames.com/documentation/metahuman/audio-driven-animation
- MetaHuman Crowds: https://dev.epicgames.com/documentation/metahuman/metahuman-crowds-in-unreal-engine
- Devkit and OpenRigLogic: https://dev.epicgames.com/documentation/metahuman/metahuman-devkit-in-unreal-engine, https://github.com/EpicGames/OpenRigLogic
- Licence change: https://www.cgchannel.com/2025/06/you-can-now-sell-metahumans-or-use-them-in-unity-or-godot/
- Character DNA: https://github.com/poly-hammer/meta-human-dna-addon, https://docs.polyhammer.com/character-dna-addon/free-features/animation/, https://www.polyhammer.com/blog/free-character-dna-addon-openriglogic
- Examples: https://github.com/ibrews/MetaHumanGodot, https://github.com/sociofuture/metahuman-to-glb
- UE retargeting: https://dev.epicgames.com/documentation/en-us/unreal-engine/auto-retargeting-in-unreal-engine, https://dev.epicgames.com/documentation/unreal-engine/using-python-to-create-and-edit-ik-retargeter-assets-in-unreal-engine
- UE Python command line: https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python
- Mixamo: https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html, https://wwwimages2.adobe.com/content/dam/cc/en/legal/servicetou/Mixamo-Addl-Terms-en_US-20210623.pdf, https://community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-royalties-ownership-eula-and-tos/td-p/13234775
- Blender retarget tools: https://github.com/pKrime/Expy-Kit, https://github.com/Rokoko/rokoko-studio-live-blender (login: issue #74), https://www.unamedia.com/ue5-mixamo/docs/retarget-mixamo-to-metahuman/
- three.js: https://threejs.org/examples/webgpu_skinning_instancing.html, https://discourse.threejs.org/t/optimization-of-large-amounts-100-1000-of-skinned-meshes-cpu-bottlenecks/58196, https://github.com/agargaro/instanced-mesh
- Godot: https://godotengine.org/releases/4.7/, https://github.com/godotengine/godot/blob/4.7-stable/modules/gltf/gltf_document.cpp, https://github.com/godotengine/godot/issues/99194, https://github.com/antzGames/Godot_Vertex_Animation_Textures_Plugin
