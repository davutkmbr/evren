"""
Evren MetaHuman batch generator: the part that runs inside the Unreal editor (UE 5.8, MetaHumanCharacter plugin).

Driven by tools/unreal/metahumans/generate.mjs through the file-based job runner (tools/unreal/run-job.mjs). Every
public step_* function is one short job; the driver calls them in order per character:

    step_cache_preset   read a preset's face model coefficients once (opens the preset, never saves it)
    step_create         duplicate the base preset into /Game/Evren/Characters/<id>/<id> (skipped when it exists)
    step_edit           face blend, body, skin, eyes, makeup and wardrobe selection; saves the asset
    step_open           reopen an existing character for editing (to re-stage and re-render without editing)
    step_stage          assemble, spawn the transient preview actor in the studio level, re-apply colours
    step_prime          make the level viewport draw the actor once (hair strands need a main view, see below)
    step_render         SceneCapture2D portrait + full body PNGs
    step_close          stop editing (destroys the preview actor) and save

Rules learned the hard way (see the report in the batch log):
  * never delete or unload an asset in a job that created or edited it;
  * iterating an unreal.Array yields struct copies: edited body constraints must be passed back as a new list;
  * the clothing hidden-face masks reach the preview actor only through an instance update after it is spawned;
  * grooms render in a SceneCapture2D only after the level viewport has drawn them once (strand guides are
    interpolated in main views only), and the editor does not draw viewports while its window is minimized.

All edits are deterministic: every value comes from the spec, the cached preset data and a per-character seed.
"""
import hashlib
import json
import math
import os
import random
import time

import unreal

PRESET_PATH = "/MetaHumanCharacter/Optional/Presets"
GROOM_PATH = "/MetaHumanCharacter/Optional/Grooms/Bindings"
OUTFIT_PATH = "/MetaHumanCharacter/Optional/Clothing"
STUDIO_LEVEL = "/Game/Evren/Review/L_Studio"
STUDIO_SUBLEVELS = (
    "/MetaHumanCharacter/LightingEnvironments/Studio",
    "/MetaHumanCharacter/LightingEnvironments/L_BaseEnvironment",
)
GROOM_SLOTS = ("Hair", "Eyebrows", "Beard", "Mustache", "Eyelashes", "Peachfuzz")
GROOM_FOLDERS = {"Hair": "Hair", "Eyebrows": "Eyebrows", "Beard": "Beards", "Mustache": "Mustaches",
                 "Eyelashes": "Eyelashes", "Peachfuzz": "Peachfuzz"}

# Iris colour-chart coordinates (primary u, v, secondary u, v, blend) sampled from Epic's presets.
EYE_COLOURS = {
    "dark-brown": (0.90, 0.10, 0.85, 0.12, 0.55),
    "brown": (0.90, 0.56, 0.98, 0.40, 0.60),
    "light-brown": (0.83, 0.50, 0.83, 0.40, 0.60),
    "hazel": (0.71, 0.68, 0.37, 0.55, 0.85),
    "green-grey": (0.45, 0.60, 0.30, 0.42, 0.63),
    "blue": (0.34, 0.79, 0.17, 0.44, 0.60),
}

# Parametric body targets per build: (Fat, Muscularity). The solver fills in every other measurement.
BUILDS = {
    "slim": (-1.2, -0.4),
    "average": (-0.3, 0.0),
    "athletic": (-0.9, 0.9),
    "stocky": (0.5, 0.6),
    "heavy": (1.3, 0.1),
}

MAKEUP = {
    "none": {},
    "subtle": {"lips": ("NATURAL", 0.35), "eyes": ("THIN_LINER", 0.3), "blush": 0.12},
    "light": {"lips": ("NATURAL", 0.5), "eyes": ("SOFT_SMOKEY", 0.3), "blush": 0.18},
}


def _sub():
    return unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)


def _seed(batch_seed, char_id, salt=""):
    digest = hashlib.sha1(f"{batch_seed}:{char_id}:{salt}".encode()).hexdigest()
    return int(digest[:12], 16)


def _load_spec(spec_path, char_id):
    with open(spec_path, encoding="utf-8") as f:
        spec = json.load(f)
    for c in spec["characters"]:
        if c["id"] == char_id:
            return spec, c
    raise KeyError(f"character {char_id} not in {spec_path}")


def _asset_path(spec, c):
    return f"{spec['assetRoot']}/{c['id']}/{c['id']}"


def _load_character(spec, c):
    path = _asset_path(spec, c)
    ch = unreal.load_asset(path)
    if ch is None:
        raise RuntimeError(f"{path} does not exist: run the create step first")
    return ch


def _colour(hex_or_list):
    if isinstance(hex_or_list, str):
        h = hex_or_list.lstrip("#")
        srgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    else:
        srgb = list(hex_or_list)
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return unreal.LinearColor(lin[0], lin[1], lin[2], 1.0)


def _cache_file(cache_dir, preset):
    return os.path.join(cache_dir, f"{preset}.json")


def _read_cache(cache_dir, preset):
    path = _cache_file(cache_dir, preset)
    if not os.path.exists(path):
        raise RuntimeError(f"preset {preset} is not cached ({path}): run the cache step first")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# --------------------------------------------------------------------------------------------------------------------
# Steps
# --------------------------------------------------------------------------------------------------------------------

def step_cache_preset(cache_dir, preset):
    """Store a preset's face model coefficients (the only data that needs the preset open for editing)."""
    os.makedirs(cache_dir, exist_ok=True)
    path = _cache_file(cache_dir, preset)
    if os.path.exists(path):
        return {"preset": preset, "cached": True, "skipped": True}
    sub = _sub()
    p = unreal.load_asset(f"{PRESET_PATH}/{preset}.{preset}")
    if not sub.try_add_object_to_edit(p):
        raise RuntimeError(f"cannot open preset {preset} for editing")
    try:
        coefficients = list(sub.get_face_model_coefficients(p))
    finally:
        if sub.is_object_added_for_editing(p):
            sub.remove_object_to_edit(p)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"preset": preset, "faceCoefficients": coefficients}, f)
    return {"preset": preset, "cached": True, "count": len(coefficients)}


def step_create(spec_path, char_id):
    spec, c = _load_spec(spec_path, char_id)
    dst = _asset_path(spec, c)
    if unreal.EditorAssetLibrary.does_asset_exist(dst):
        return {"asset": dst, "created": False}
    base = c["face"]["base"]
    ch = unreal.EditorAssetLibrary.duplicate_asset(f"{PRESET_PATH}/{base}.{base}", dst)
    if ch is None:
        raise RuntimeError(f"duplicating preset {base} to {dst} failed")
    unreal.EditorAssetLibrary.save_loaded_asset(ch, False)
    return {"asset": dst, "created": True}


def step_open(spec_path, char_id):
    """Open an already generated character for editing (re-staging and re-rendering without a new edit)."""
    spec, c = _load_spec(spec_path, char_id)
    sub = _sub()
    ch = _load_character(spec, c)
    t0 = time.time()
    if not sub.is_object_added_for_editing(ch) and not sub.try_add_object_to_edit(ch):
        raise RuntimeError(f"cannot open {char_id} for editing")
    return {"open": round(time.time() - t0, 2)}


def _blend_face(spec, c, cache_dir):
    """Base preset coefficients + weighted pull towards donor presets + seeded noise scaled by the preset spread."""
    face = c["face"]
    base = _read_cache(cache_dir, face["base"])["faceCoefficients"]
    n = len(base)
    result = list(base)
    for donor, weight in face.get("blend", {}).items():
        d = _read_cache(cache_dir, donor)["faceCoefficients"]
        if len(d) != n:
            raise RuntimeError(f"donor {donor} has {len(d)} coefficients, base has {n}")
        for i in range(n):
            result[i] += weight * (d[i] - base[i])
    noise = float(face.get("noise", 0.0))
    if noise > 0:
        pool = []
        for name in sorted(os.listdir(cache_dir)):
            if name.endswith(".json"):
                with open(os.path.join(cache_dir, name), encoding="utf-8") as f:
                    v = json.load(f)["faceCoefficients"]
                if len(v) == n:
                    pool.append(v)
        rng = random.Random(_seed(spec["seed"], c["id"], "face"))
        for i in _shape_coefficient_indices(base):
            values = [v[i] for v in pool]
            mean = sum(values) / len(values)
            sd = math.sqrt(sum((x - mean) ** 2 for x in values) / len(values))
            result[i] += rng.gauss(0.0, 1.0) * sd * noise
    return result


def _shape_coefficient_indices(v):
    """Indices of the per-region shape coefficients in a face model coefficient vector.

    Layout (UE 5.8, read from the presets): [region count, then per region: 8 values (flag + rigid transform),
    coefficient count k, k shape coefficients]. Noise goes only to shape coefficients, never to the region transforms,
    so neighbouring regions cannot drift apart.
    """
    indices = []
    i = 1
    for _ in range(int(v[0])):
        k = int(v[i + 8])
        indices.extend(range(i + 9, i + 9 + k))
        i += 9 + k
    if i != len(v):
        raise RuntimeError(f"unexpected face coefficient layout (parsed {i} of {len(v)} values)")
    return indices


def _apply_body(sub, ch, spec, c):
    rng = random.Random(_seed(spec["seed"], c["id"], "body"))
    fat, muscle = BUILDS[c.get("build", "average")]
    targets = {
        "Height": float(c["heightCm"]),
        "Fat": fat + rng.uniform(-0.15, 0.15),
        "Muscularity": muscle + rng.uniform(-0.15, 0.15),
    }
    # Iterating an unreal.Array yields struct copies: collect the edited copies into a new list (as Epic's example does).
    constraints = []
    for k in sub.get_body_constraints(ch):
        name = str(k.name)
        if name in targets:
            k.is_active = True
            k.target_measurement = max(k.min_measurement, min(k.max_measurement, targets[name]))
        else:
            k.is_active = False
        constraints.append(k)
    sub.set_body_constraints(ch, constraints)
    sub.commit_body_state(ch)
    measured = {str(k.name): round(k.target_measurement, 1) for k in sub.get_body_constraints(ch)
                if str(k.name) in ("Height", "Chest", "Waist", "Hip", "Fat", "Muscularity")}
    return {"targets": {k: round(v, 3) for k, v in targets.items()}, "measured": measured}


def _apply_skin(sub, ch, spec, c):
    skin = c["skin"]
    rng = random.Random(_seed(spec["seed"], c["id"], "skin"))
    tex_src = unreal.load_asset(f"{PRESET_PATH}/{skin['textureFrom']}.{skin['textureFrom']}")
    ss = ch.skin_settings
    props = ss.skin
    props.u = min(1.0, max(0.0, skin["tone"][0] + rng.uniform(-0.015, 0.015)))
    props.v = min(1.0, max(0.0, skin["tone"][1] + rng.uniform(-0.02, 0.02)))
    props.face_texture_index = tex_src.skin_settings.skin.face_texture_index
    props.body_texture_index = tex_src.skin_settings.skin.body_texture_index
    props.roughness = skin.get("roughness", tex_src.skin_settings.skin.roughness)
    props.show_top_underwear = False
    ss.skin = props
    ch.preview_material_type = unreal.MetaHumanCharacterSkinPreviewMaterial.EDITABLE
    sub.commit_skin_settings(ch, ss)
    return {"u": round(props.u, 3), "v": round(props.v, 3), "faceTexture": props.face_texture_index}


def _apply_eyes(sub, ch, c):
    pu, pv, su, sv, blend = EYE_COLOURS[c.get("eyes", "brown")]
    es = ch.eyes_settings
    for side in ("eye_left", "eye_right"):
        eye = getattr(es, side)
        iris = eye.iris
        iris.primary_color_u, iris.primary_color_v = pu, pv
        iris.secondary_color_u, iris.secondary_color_v = su, sv
        iris.color_blend = blend
        eye.iris = iris
        setattr(es, side, eye)
    sub.commit_eyes_settings(ch, es)


def _apply_makeup(sub, ch, c):
    style = MAKEUP[c.get("makeup", "none")]
    ms = unreal.MetaHumanCharacterMakeupSettings()
    lips = unreal.MetaHumanCharacterLipsMakeupProperties()
    lips.type = unreal.MetaHumanCharacterLipsMakeupType.NONE
    eyes = unreal.MetaHumanCharacterEyeMakeupProperties()
    eyes.type = unreal.MetaHumanCharacterEyeMakeupType.NONE
    blush = unreal.MetaHumanCharacterBlushMakeupProperties()
    blush.type = unreal.MetaHumanCharacterBlushMakeupType.NONE
    if "lips" in style:
        lips.type = getattr(unreal.MetaHumanCharacterLipsMakeupType, style["lips"][0])
        lips.opacity = style["lips"][1]
        lips.color = _colour("#8e4a4a")
        lips.roughness = 0.45
        lips.metalness = 0.0
    if "eyes" in style:
        eyes.type = getattr(unreal.MetaHumanCharacterEyeMakeupType, style["eyes"][0])
        eyes.opacity = style["eyes"][1]
        eyes.primary_color = _colour("#1b1411")
        eyes.secondary_color = _colour("#3a2a24")
        eyes.roughness = 0.7
    if "blush" in style:
        blush.type = unreal.MetaHumanCharacterBlushMakeupType.HIGH_CURVE
        blush.intensity = style["blush"]
        blush.color = _colour("#b0605a")
        blush.roughness = 0.6
    foundation = unreal.MetaHumanCharacterFoundationMakeupProperties()
    foundation.apply_foundation = False
    ms.lips, ms.eyes, ms.blush, ms.foundation = lips, eyes, blush, foundation
    sub.commit_makeup_settings(ch, ms)


def _item_key(collection, slot, wardrobe_item_path):
    wi = unreal.load_asset(wardrobe_item_path)
    if wi is None:
        raise RuntimeError(f"wardrobe item {wardrobe_item_path} not found")
    wanted = wardrobe_item_path.rsplit("/", 1)[-1].split(".")[0]
    for key in collection.get_item_keys_for_slot(slot):
        if key.to_asset_name_string() == wanted:
            return key
    key = collection.try_add_item_from_wardrobe_item(slot, wi)
    if key is None:
        raise RuntimeError(f"cannot add {wanted} to slot {slot}")
    return key


def _wardrobe_selection(c):
    """Slot -> wardrobe item path, or None to leave the slot empty."""
    sel = {}
    for slot in GROOM_SLOTS:
        key = slot[0].lower() + slot[1:]
        item = c.get("grooms", {}).get(key)
        if isinstance(item, dict):
            item = item.get("item")
        sel[slot] = f"{GROOM_PATH}/{GROOM_FOLDERS[slot]}/{item}.{item}" if item else None
    outfit = c.get("outfit", {}).get("item", "WI_DefaultGarment")
    sel["Outfits"] = f"{OUTFIT_PATH}/{outfit}.{outfit}" if outfit else None
    return sel


def step_edit(spec_path, char_id, cache_dir):
    spec, c = _load_spec(spec_path, char_id)
    sub = _sub()
    ch = _load_character(spec, c)
    t = {}
    t0 = time.time()
    if not sub.is_object_added_for_editing(ch):
        if not sub.try_add_object_to_edit(ch):
            raise RuntimeError(f"cannot open {char_id} for editing")
    t["open"] = round(time.time() - t0, 2)

    t0 = time.time()
    coefficients = _blend_face(spec, c, cache_dir)
    sub.set_face_model_coefficients(ch, coefficients)
    sub.commit_face_state(ch)
    t["face"] = round(time.time() - t0, 2)

    t0 = time.time()
    body = _apply_body(sub, ch, spec, c)
    t["body"] = round(time.time() - t0, 2)

    t0 = time.time()
    skin = _apply_skin(sub, ch, spec, c)
    _apply_eyes(sub, ch, c)
    _apply_makeup(sub, ch, c)
    t["looks"] = round(time.time() - t0, 2)

    t0 = time.time()
    pc = sub.get_preview_collection(ch)
    for slot, path in _wardrobe_selection(c).items():
        if path:
            pc.default_instance.set_single_slot_selection(slot, _item_key(pc, slot, path))
        else:
            pc.default_instance.set_single_slot_selection(slot, unreal.MetaHumanPaletteItemKey())
    sub.on_edit_preview_collection(ch)
    # Instance parameters (groom and outfit colours) exist only after an assembly. Setting them here, before the
    # stage step assembles again, makes every garment part pick them up on the first staging.
    sub.assemble_for_preview(character=ch)
    params = _apply_instance_params(sub, ch, spec, c)
    t["wardrobe"] = round(time.time() - t0, 2)

    unreal.EditorAssetLibrary.save_loaded_asset(ch, False)
    return {"asset": _asset_path(spec, c), "t": t, "body": body, "skin": skin, "params": params}


def _set_param(params, name, setter, value):
    p = next((x for x in params if str(x.name) == name), None)
    if p is None:
        return False
    getattr(p, setter)(value=value)
    return True


def _apply_instance_params(sub, ch, spec, c):
    """Groom colours (melanin, redness, grey) and outfit colours on the assembled preview instance."""
    inst = sub.get_preview_collection(ch).default_instance
    selected = {str(s.selection.slot_name): s.selection.selected_item for s in inst.get_slot_selection_data()}
    rng = random.Random(_seed(spec["seed"], c["id"], "hair"))
    hair_colour = c.get("hairColour", {})
    applied = {}
    for slot in GROOM_SLOTS:
        if slot not in selected or slot == "Peachfuzz":
            continue
        params = inst.get_instance_parameters(item_path=unreal.MetaHumanPaletteItemPath(item_key=selected[slot]))
        melanin = hair_colour.get("melanin", 0.85) + rng.uniform(-0.03, 0.03)
        whiteness = hair_colour.get("whiteness", 0.0)
        if slot in ("Eyebrows", "Eyelashes"):
            whiteness *= 0.5
        values = {"Melanin": min(1.0, max(0.0, melanin)), "Redness": hair_colour.get("redness", 0.15),
                  "Whiteness": whiteness, "Lightness": hair_colour.get("lightness", 0.5)}
        applied[slot] = {k: round(v, 3) for k, v in values.items() if _set_param(params, k, "set_float", v)}
        # Presets may carry a dye (e.g. pink hair); spec colours are natural unless a dye is given.
        dye = hair_colour.get("dye")
        _set_param(params, "DyeColor", "set_color", _colour(dye) if dye else unreal.LinearColor(1, 1, 1, 1))
    outfit = c.get("outfit", {})
    if "Outfits" in selected and outfit.get("colours"):
        params = inst.get_instance_parameters(item_path=unreal.MetaHumanPaletteItemPath(item_key=selected["Outfits"]))
        applied["Outfits"] = [k for k, v in outfit["colours"].items() if _set_param(params, k, "set_color", _colour(v))]
    sub.on_edit_preview_collection(ch)
    return applied


def _studio_world():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    world = ues.get_editor_world()
    if not world.get_path_name().startswith(STUDIO_LEVEL):
        if unreal.EditorAssetLibrary.does_asset_exist(STUDIO_LEVEL):
            les.load_level(STUDIO_LEVEL)
        else:
            les.new_level(STUDIO_LEVEL, False)
            world = ues.get_editor_world()
            for sublevel in STUDIO_SUBLEVELS:
                unreal.EditorLevelUtils.add_level_to_world(world, sublevel, unreal.LevelStreamingAlwaysLoaded)
        world = ues.get_editor_world()
    # Spawned actors land in the current level; it must be ours, never an engine sublevel.
    les.set_current_level_by_name("L_Studio")
    if not les.get_current_level().get_path_name().startswith(STUDIO_LEVEL):
        raise RuntimeError("could not make L_Studio the current level")
    return world


def _preview_actors(world):
    return [a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor)
            if a.get_class().get_name() == "MetaHumanDefaultEditorPipelineActor"]


def step_stage(spec_path, char_id):
    spec, c = _load_spec(spec_path, char_id)
    sub = _sub()
    ch = _load_character(spec, c)
    if not sub.is_object_added_for_editing(ch):
        raise RuntimeError(f"{char_id} is not open for editing: run the edit step first")
    world = _studio_world()
    others = _preview_actors(world)
    if others:
        raise RuntimeError(f"another preview actor is staged ({others[0].get_name()}): close it first")
    t = {}
    t0 = time.time()
    sub.assemble_for_preview(character=ch)
    t["assemble"] = round(time.time() - t0, 2)
    t0 = time.time()
    actor = sub.spawn_meta_human_actor(ch, True)
    t["spawn"] = round(time.time() - t0, 2)
    # Re-applying the parameters after the spawn fires the instance-updated callback that applies the clothing
    # hidden-face masks to the preview actor's skin (no second assembly needed).
    applied = _apply_instance_params(sub, ch, spec, c)
    unreal.EditorAssetLibrary.save_loaded_asset(ch, False)
    o, e = actor.get_actor_bounds(False)
    return {"t": t, "actor": actor.get_name(), "params": applied, "bounds": [round(o.z - e.z, 1), round(o.z + e.z, 1)]}


def step_prime(spec_path, char_id, sentinel_path):
    """Makes the level viewport draw once with the staged actor in view.

    Hair strands are interpolated from their guides only in main views (FSceneView::AllowGPUParticleUpdate is false
    for scene captures), so grooms stay invisible in captures until the level viewport has drawn the actor once.
    The editor skips viewport drawing while all its windows are minimized or hidden. Saving the asset makes the editor
    show a transient notification window on the next frame, which lets that frame draw the invalidated viewport; the
    driver waits for the sentinel screenshot to know whether the draw happened.
    """
    spec, c = _load_spec(spec_path, char_id)
    world = _studio_world()
    actors = _preview_actors(world)
    if len(actors) != 1:
        raise RuntimeError(f"expected one staged preview actor, found {len(actors)}")
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    ues.set_level_viewport_camera_info(unreal.Vector(0, 330, 110), unreal.Rotator(pitch=-3.0, yaw=-90.0, roll=0.0))
    unreal.AutomationLibrary.take_high_res_screenshot(64, 64, sentinel_path)
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_invalidate_viewports()
    unreal.EditorAssetLibrary.save_loaded_asset(_load_character(spec, c), False)
    return {"primed": True}


def _capture_component(world):
    caps = [a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.SceneCapture2D)
            if a.get_actor_label() == "EvrenPreviewCapture"]
    if caps:
        cap = caps[0]
    else:
        cap = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).spawn_actor_from_class(
            unreal.SceneCapture2D, unreal.Vector(0, 300, 150))
        cap.set_actor_label("EvrenPreviewCapture")
    cc = cap.capture_component2d
    cc.set_editor_property("capture_every_frame", False)
    cc.set_editor_property("capture_on_movement", False)
    cc.set_editor_property("always_persist_rendering_state", True)
    cc.set_editor_property("capture_source", unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR)
    pps = cc.get_editor_property("post_process_settings")
    pps.override_auto_exposure_bias = True
    pps.auto_exposure_bias = 0.8
    cc.set_editor_property("post_process_settings", pps)
    cc.set_editor_property("post_process_blend_weight", 1.0)
    return cap, cc


def step_render(spec_path, char_id, out_dir):
    spec, c = _load_spec(spec_path, char_id)
    world = _studio_world()
    actors = _preview_actors(world)
    if len(actors) != 1:
        raise RuntimeError(f"expected one staged preview actor, found {len(actors)}")
    actor = actors[0]
    head = None
    for comp in actor.get_components_by_class(unreal.SkeletalMeshComponent):
        if comp.does_socket_exist("head"):
            head = comp.get_socket_location("head")
            break
    if head is None:
        raise RuntimeError("preview actor has no head socket")
    o, e = actor.get_actor_bounds(False)
    top = min(o.z + e.z, head.z + 40.0)
    cap, cc = _capture_component(world)
    os.makedirs(out_dir, exist_ok=True)
    shots = {}

    def shoot(name, width, height, frame_bottom, frame_top, vfov):
        rt = unreal.RenderingLibrary.create_render_target2d(world, width, height,
                                                            unreal.TextureRenderTargetFormat.RTF_RGBA8,
                                                            unreal.LinearColor(0, 0, 0, 1))
        cc.set_editor_property("texture_target", rt)
        cc.set_editor_property("fov_angle", math.degrees(2 * math.atan(math.tan(math.radians(vfov / 2)) * width / height)))
        half = (frame_top - frame_bottom) / 2
        distance = half / math.tan(math.radians(vfov / 2))
        cap.set_actor_location_and_rotation(unreal.Vector(head.x, head.y + distance, frame_bottom + half),
                                            unreal.Rotator(pitch=0.0, yaw=-90.0, roll=0.0), False, False)
        for _ in range(4):
            cc.capture_scene()
        filename = f"{c['id']}-{name}.png"
        unreal.RenderingLibrary.export_render_target(world, rt, out_dir, filename)
        shots[name] = filename

    shoot("portrait", 768, 960, head.z - 34.0, head.z + 30.0, 20.0)
    shoot("body", 640, 1280, -8.0, top + 12.0, 34.0)
    return {"images": shots, "headZ": round(head.z, 1), "topZ": round(top, 1)}


def step_close(spec_path, char_id):
    spec, c = _load_spec(spec_path, char_id)
    sub = _sub()
    ch = _load_character(spec, c)
    if sub.is_object_added_for_editing(ch):
        unreal.EditorAssetLibrary.save_loaded_asset(ch, False)
        sub.remove_object_to_edit(ch)
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    return {"closed": True, "previewActorsLeft": len(_preview_actors(world))}
