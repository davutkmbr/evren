"""
Mixamo clips onto the rider skeleton (approved for humans in CLAUDE.md; private: never committed, shipped only inside
builds, see .docs/assets/private-assets.md).

Input: every private-assets/mixamo/**/*.fbx, downloaded by the owner ("Without Skin", 30 fps, no keyframe reduction; the
locomotion clips with "In Place" off). A file named after one of our clips (walk.fbx) or after its Mixamo title
("Breathing Idle.fbx", "Breathing Idle (1).fbx") fills that clip; any other file is kept as an extra clip named
x_<slug> (e.g. "Sword And Shield Slash.fbx" -> x_sword_and_shield_slash): whether it loops and travels is measured, and
report.md lists every clip with its measurements and a guessed category, to decide where the extras go in the game. Our skeleton carries the Mixamo bone names, so each clip maps bone to bone: every
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

from mixamo_names import CLIPS, TURNING, category, resolve, slug  # noqa: E402  (bpy-free: also a command-line renamer)


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
    """Bakes one FBX (or an armature already in the scene, `src`) onto `rig` as action `name`; returns its clip info.
    `loop` / `root_motion` None: measured (an extra clip)."""
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
    # Turning clips: the body's heading change (the hips' yaw) is taken out, so the clip plays facing ahead and the game
    # turns the character by the recorded curve; the hips' travel is then measured in the body's own frame.
    # A clip that starts facing off to the side (some Mixamo clips do) is turned to face ahead.
    y0 = _yaw(samples[0][0]["Hips"]) if "Hips" in samples[0][0] else 0.0
    if abs(y0) > 1.2:
        q0 = Matrix.Rotation(-y0, 3, "Z")
        p0 = samples[0][1]
        samples = [({n: q0 @ r for n, r in rots.items()}, p0 + q0 @ (hp - p0)) for rots, hp in samples]
        print("MIXAMO", name, "faces ahead (turned by", round(-y0, 3), "rad)")
    turn_curve = None
    if name.startswith(TURNING):
        samples, turn_curve = _unturn(samples)
    # Root motion: the horizontal travel from the first to the last frame is removed along a straight line (loops
    # close), its rate is the clip's speed.
    dur = (len(frames) - 1) / fps
    travel = (samples[-1][1] - samples[0][1]) * k
    travel.z = 0.0
    measured = _measure(samples, k, src_rest_hips, dur)
    if root_motion is None:
        root_motion = travel.length > 0.4
    if loop is None:
        loop = measured["loop_error"] < 0.35 and dur > 0.6
    speed = travel.length / dur if root_motion and dur > 0 else 0.0
    # Events from the hips' height: take-off (fastest rise) and landing contact (fastest stop after the fall).
    hz = [s[1].z * k for s in samples]
    vz = [(hz[i + 1] - hz[i]) * fps for i in range(len(hz) - 1)] or [0.0]
    events = {}
    if name in ("jump_start", "run_jump", "run_flip"):
        events["takeoff"] = max(range(len(vz)), key=lambda i: vz[i]) / fps
    if name.startswith("jump_land"):
        dv = [vz[i + 1] - vz[i] for i in range(len(vz) - 1)] or [0.0]
        events["contact"] = max(range(len(dv)), key=lambda i: dv[i]) / fps
    if name == "run_roll":
        # The roll proper starts where the hips drop (the clip leads in with steps): a little before they are down.
        low = min(hz)
        i = next((i for i, h in enumerate(hz) if h < hz[0] + 0.35 * (low - hz[0])), 0)
        events["start"] = max(0.0, i / fps - 0.2)
    if "takeoff" in events:
        # In the air the game's jump physics carries the body: the hips' own rise and fall from take-off until they are
        # back at take-off height is taken out, and that flight time is kept (the game plays it over its own).
        i0 = int(round(events["takeoff"] * fps))
        peak = max(range(i0, len(hz)), key=lambda i: hz[i])
        i1 = next((i for i in range(peak, len(hz)) if hz[i] <= hz[i0]), len(hz) - 1)
        z0 = samples[i0][1].z
        for i in range(i0, i1 + 1):
            rots, hp = samples[i]
            hp = hp.copy()
            hp.z = min(hp.z, z0)
            samples[i] = (rots, hp)
        events["air"] = (i1 - i0) / fps
    # Pass 2: pose ours and key.
    # The procedural clip of the same name (already exported with the character) makes way, or the new action would be
    # renamed "walk.001".
    old = bpy.data.actions.get(name)
    if old is not None:
        bpy.data.actions.remove(old)
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
    if turn_curve:
        info["turn"] = round(turn_curve[-1], 4)
        # Heading (rad, from the start) at 24 even steps over the clip.
        n = len(turn_curve) - 1
        info["turn_curve"] = [round(turn_curve[min(n, round(j * n / 23))], 4) for j in range(24)]
    info["measured"] = measured
    print("MIXAMO", name, info)
    return info


def _yaw(r):
    """Heading (rad about world +Z) of a world rotation change: where it swings the side axis (+X) to."""
    import math
    v = r @ Vector((1.0, 0.0, 0.0))
    return math.atan2(v.y, v.x)


def _unturn(samples):
    """Takes the heading change out of every frame: returns the samples as if facing the first frame's heading (hips
    positions re-accumulated in the body's frame) and the heading curve (rad from the start, unwrapped)."""
    import math
    yaws, prev, acc = [], None, 0.0
    for rots, _hp in samples:
        y = _yaw(rots["Hips"]) if "Hips" in rots else 0.0
        if prev is not None:
            d = (y - prev + math.pi) % (2 * math.pi) - math.pi
            acc += d
        prev = y
        yaws.append(acc)
    out = []
    pos = samples[0][1].copy()
    for i, (rots, hp) in enumerate(samples):
        q = Matrix.Rotation(-yaws[i], 3, "Z")
        if i > 0:
            step = hp - samples[i - 1][1]
            step_z = step.z
            step = q @ Vector((step.x, step.y, 0.0))
            pos = pos + Vector((step.x, step.y, step_z))
        out.append(({n: q @ r for n, r in rots.items()}, pos.copy()))
    return out, yaws


def _measure(samples, k, rest_hips, dur):
    """What the clip does, for the report: travel, hips height range, time off the ground, how well it loops."""
    hz = [(s[1].z - rest_hips.z) * k for s in samples]
    xy = [((s[1] - samples[0][1]) * k) for s in samples]
    fps = (len(samples) - 1) / dur if dur > 0 else 30.0
    # Loop error: the largest joint rotation difference (rad) between the first and last frames, plus the hips height
    # step (m, weighted).
    r0, r1 = samples[0][0], samples[-1][0]
    ang = 0.0
    for n, m in r0.items():
        if n in r1:
            q = (m.inverted() @ r1[n]).to_quaternion()
            ang = max(ang, q.angle if q.angle <= 3.1416 else 6.2832 - q.angle)
    loop_err = ang + abs(hz[-1] - hz[0]) * 3.0
    up = sum(1 for h in hz if h > 0.12) / fps
    path = sum(((xy[i + 1] - xy[i]).to_2d().length for i in range(len(xy) - 1)))
    return {
        "travel": round(((xy[-1]).to_2d()).length, 3),
        "path": round(path, 3),
        "hips_min": round(min(hz), 3),
        "hips_max": round(max(hz), 3),
        "hips_up_time": round(up, 3),
        "loop_error": round(loop_err, 3),
    }


def sources():
    """(name, path, loop, root_motion) for every FBX found: our clips first, then the extras."""
    if not os.path.isdir(SRC_DIR):
        return []
    files = []
    for dirpath, _dirs, names in os.walk(SRC_DIR):
        for f in sorted(names):
            if f.lower().endswith(".fbx"):
                files.append(os.path.join(dirpath, f))
    ours, extras, taken = [], [], set()
    for path in sorted(files):
        stem = os.path.splitext(os.path.basename(path))[0]
        name = resolve(stem)
        if name and name not in taken:
            taken.add(name)
            loop, rm = CLIPS[name]
            ours.append((name, path, loop, rm))
            continue
        x = "x_" + slug(stem)
        base, n = x, 2
        while x in taken:
            x = f"{base}_{n}"
            n += 1
        taken.add(x)
        extras.append((x, path, None, None))
    return ours + extras


def author(rig, fps=30):
    """Retargets every clip found; returns {name: info} (empty when there is no Mixamo folder)."""
    found = sources()
    if not found:
        return {}
    bpy.context.scene.render.fps = fps
    out = {}
    for name, path, loop, root_motion in found:
        try:
            info = retarget(rig, path, name, loop, root_motion, fps)
        except Exception as e:  # one bad file must not stop the rest
            print("MIXAMO FAIL", path, e)
            continue
        if info:
            info["source"] = os.path.relpath(path, SRC_DIR)
            if name.startswith("x_"):
                info["extra"] = True
                info["category"] = category(name[2:])
            out[name] = info
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    return out


def report(infos):
    """report.md next to the clips: every clip, what it measured, where it could go."""
    lines = ["# Rider clips (Mixamo, retargeted)", "",
             "| Clip | Source | Category | s | Loop | Speed m/s | Travel m | Hips min/max m | Airborne s | Loop err |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for name, i in sorted(infos.items(), key=lambda kv: (kv[1].get("extra", False), kv[1].get("category", ""), kv[0])):
        m = i.get("measured", {})
        lines.append(f"| {name} | {i.get('source', '')} | {i.get('category', 'core')} | {i['duration']:.2f} | "
                     f"{'yes' if i['loop'] else 'no'} | {i['speed']:.2f} | {m.get('travel', 0):.2f} | "
                     f"{m.get('hips_min', 0):+.2f} / {m.get('hips_max', 0):+.2f} | {m.get('hips_up_time', 0):.2f} | "
                     f"{m.get('loop_error', 0):.2f} |")
    missing = [n for n in CLIPS if n not in infos]
    if missing:
        lines += ["", "Missing core clips (procedural ones stay): " + ", ".join(missing)]
    with open(os.path.join(OUT_DIR, "report.md"), "w") as f:
        f.write("\n".join(lines) + "\n")


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
    report(infos)
    print("MIXAMO EXPORTED", path, os.path.getsize(path), sorted(infos))
    return path

