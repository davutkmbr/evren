"""
Mixamo clips onto the rider skeleton (approved for humans in CLAUDE.md; private: never committed, shipped only inside
builds, see .docs/assets/private-assets.md).

Input: private-assets/mixamo/<clip>.fbx, downloaded by the owner ("Without Skin", 30 fps, no keyframe reduction; the
locomotion clips with "In Place" off). Our skeleton carries the Mixamo bone names, so each clip maps bone to bone: every
bone takes the source's world rotation change from its own rest (retargeting across the different rest poses, Mixamo's
T pose vs. our A pose), the hips' translation is scaled by the leg length ratio. Travel (root motion) is measured and
removed: the clips play in place and the game moves the character at the measured speed (feet stay planted).

Output: private-assets/build/rider/clips.glb (the skeleton and these actions, no meshes) and clips.json (per clip:
duration, loop, speed, and event times: take-off, landing contact).
"""
import json
import os

import bpy
from mathutils import Matrix, Vector

import anim

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC_DIR = os.environ.get("RIDER_MIXAMO_DIR", os.path.join(ROOT, "private-assets", "mixamo"))
OUT_DIR = os.environ.get("RIDER_MIXAMO_OUT", os.path.join(ROOT, "private-assets", "build", "rider"))

# Our clip name: loop, root motion (strip the travel and measure the speed).
CLIPS = {
    "idle": (True, False),
    "idle_look": (False, False),
    "idle_warrior": (False, False),
    "walk": (True, True),
    "run": (True, True),
    "run_stop": (False, True),
    "crouch_idle": (True, False),
    "crouch_walk": (True, True),
    "jump_start": (False, False),
    "jump_fall": (True, False),
    "jump_land": (False, False),
    "jump_land_hard": (False, False),
    "run_jump": (False, True),
    "turn_left": (False, False),
    "turn_right": (False, False),
}


def _rot(m):
    """Rotation part of a 4x4 (scale removed)."""
    return m.to_quaternion().to_matrix()


def _import(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, ignore_leaf_bones=False, use_anim=True)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next((o for o in new if o.type == "ARMATURE"), None)
    return arm, new


def _bone_map(src):
    """Source bone name → our bone name (without the 'mixamorig:' prefix; tolerates 'mixamorig1:' and friends)."""
    out = {}
    for b in src.data.bones:
        n = b.name.split(":")[-1]
        out[b.name] = n
    return out


def retarget(rig, path, name, loop, root_motion, fps, src=None):
    """Bakes one FBX (or an armature already in the scene, `src`) onto `rig` as action `name`; returns its clip info."""
    new_objs = []
    if src is None:
        src, new_objs = _import(path)
    if src is None or not src.animation_data or not src.animation_data.action:
        for o in new_objs:
            bpy.data.objects.remove(o, do_unlink=True)
        print("MIXAMO SKIP (no armature animation)", path)
        return None
    act_src = src.animation_data.action
    f0, f1 = (int(round(v)) for v in act_src.frame_range)
    names = _bone_map(src)
    sk = anim.Skel(rig)
    b = anim.Body(sk)
    ours = set(sk.bones)
    # Rest (world): the source in its bind pose (the armature's rest), ours from the data.
    mw = src.matrix_world
    src_rest = {bn: _rot(mw @ bone.matrix_local) for bn, bone in src.data.bones.items()}
    src_rest_hips = next((mw @ bone.matrix_local).translation for bn, bone in src.data.bones.items() if names[bn] == "Hips")
    our_hips = sk.rest_head("Hips")
    # Leg length ratio (hips height over the feet) scales the hips' travel.
    src_foot = next((mw @ bone.matrix_local).translation for bn, bone in src.data.bones.items() if names[bn] == "LeftFoot")
    k = (our_hips.z - sk.rest_head("LeftFoot").z) / max(1e-4, src_rest_hips.z - src_foot.z)
    scene = bpy.context.scene
    frames = list(range(f0, f1 + 1))
    # Pass 1: sample the source (world rotations, hips position).
    samples = []
    for f in frames:
        scene.frame_set(f)
        rots = {}
        for bn, pb in src.pose.bones.items():
            rots[names[bn]] = _rot(mw @ pb.matrix) @ src_rest[bn].inverted()
        hp = (mw @ src.pose.bones[next(bn for bn in names if names[bn] == "Hips")].matrix).translation.copy()
        samples.append((rots, hp))
    # Root motion: the horizontal travel from the first to the last frame is removed along a straight line (loops
    # close), its rate is the clip's speed.
    dur = (len(frames) - 1) / fps
    travel = (samples[-1][1] - samples[0][1]) * k
    travel.z = 0.0
    speed = travel.length / dur if root_motion and dur > 0 else 0.0
    # Events from the hips' height: take-off (fastest rise) and landing contact (fastest stop after the fall).
    hz = [s[1].z * k for s in samples]
    vz = [(hz[i + 1] - hz[i]) * fps for i in range(len(hz) - 1)] or [0.0]
    events = {}
    if name in ("jump_start", "run_jump"):
        events["takeoff"] = max(range(len(vz)), key=lambda i: vz[i]) / fps
    if name in ("jump_land", "jump_land_hard"):
        dv = [vz[i + 1] - vz[i] for i in range(len(vz) - 1)] or [0.0]
        events["contact"] = max(range(len(dv)), key=lambda i: dv[i]) / fps
    # Pass 2: pose ours and key.
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = act
    for i, (rots, hp) in enumerate(samples):
        b.start()
        for n in sk.order:
            if n not in ours:
                continue
            r = rots.get(n)
            if r is not None:
                sk.orient(n, r)
        off = (hp - samples[0][1] if root_motion else hp - src_rest_hips) * k
        if root_motion:
            t = i / max(1, len(samples) - 1)
            off -= travel * t
            off += (samples[0][1] - src_rest_hips) * k
        m = sk.pose("Hips").copy()
        m.translation = our_hips + Vector((off.x, off.y, off.z))
        sk.set_pose("Hips", m)
        b.key(i + 1)
    rig.animation_data.action = None
    for o in new_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        if a.users == 0 and a is not act and a.name.startswith(("Armature", "mixamo")):
            bpy.data.actions.remove(a)
    info = {"duration": round(dur, 4), "loop": loop, "speed": round(speed, 4)}
    info.update({k_: round(v, 4) for k_, v in events.items()})
    print("MIXAMO", name, info)
    return info


def author(rig, fps=30):
    """Retargets every clip found; returns {name: info} (empty when there is no Mixamo folder)."""
    if not os.path.isdir(SRC_DIR):
        return {}
    bpy.context.scene.render.fps = fps
    out = {}
    for name, (loop, root_motion) in CLIPS.items():
        path = os.path.join(SRC_DIR, name + ".fbx")
        if os.path.exists(path):
            info = retarget(rig, path, name, loop, root_motion, fps)
            if info:
                out[name] = info
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    return out


def export(rig, infos):
    """Writes clips.glb (the skeleton and the retargeted actions only) and clips.json."""
    if not infos:
        return None
    os.makedirs(OUT_DIR, exist_ok=True)
    keep = set(infos)
    for a in list(bpy.data.actions):
        if a.name not in keep:
            bpy.data.actions.remove(a)
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    path = os.path.join(OUT_DIR, "clips.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_skins=False, export_animations=True,
                              export_animation_mode="ACTIONS", export_force_sampling=True, export_optimize_animation_size=True,
                              export_morph=False, export_yup=True)
    with open(os.path.join(OUT_DIR, "clips.json"), "w") as f:
        json.dump(infos, f, indent=1)
    print("MIXAMO EXPORTED", path, os.path.getsize(path), sorted(infos))
    return path

