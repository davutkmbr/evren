"""
The rider's face life: a set of ARKit-style face units (the approved CC0 MakeHuman "face units 01" pack) kept as morph
targets (blink, brows, squint, jaw, smile, frown, press, sneer), eye bones for gaze. The body and face targets are baked
into the mesh, the face units stay as shape keys; the eyelashes and eyebrows (separate meshes) get the same keys by
following the nearest skin vertex, so they close with the lids.
"""
import os
import tempfile
import zipfile

import bmesh
import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree

PACK = os.environ.get("RIDER_FACEUNITS", "/home/user/tools/mh-assets/faceunits01.zip")

UNITS = [
    "eyeBlinkLeft", "eyeBlinkRight", "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
    "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
    "jawOpen", "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight",
    "mouthPressLeft", "mouthPressRight", "noseSneerLeft", "noseSneerRight", "mouthStretchLeft", "mouthStretchRight",
]


def load_units(basemesh, target_service):
    """Adds the face units as shape keys (value 0) to the MakeHuman base mesh (full topology, before masking)."""
    out = tempfile.mkdtemp(prefix="faceunits")
    with zipfile.ZipFile(PACK) as z:
        for u in UNITS:
            name = f"targets/faceunits/{u}.target"
            try:
                z.extract(name, out)
            except KeyError:
                print("FACE UNIT MISSING", u)
                continue
            target_service.load_target(basemesh, os.path.join(out, name), weight=0.0, name=u)
    return [u for u in UNITS if basemesh.data.shape_keys and u in basemesh.data.shape_keys.key_blocks]


def bake_keeping(obj, keep):
    """Bakes every shape key's current value into the mesh except `keep`, which stay as keys (deltas preserved)."""
    me = obj.data
    if not me.shape_keys:
        return
    kb = me.shape_keys.key_blocks
    basis = kb[0]
    n = len(me.vertices)
    base = [basis.data[i].co.copy() for i in range(n)]
    mixed = [c.copy() for c in base]
    deltas = {}
    for k in kb[1:]:
        if k.name in keep:
            deltas[k.name] = [k.data[i].co - base[i] for i in range(n)]
            continue
        if abs(k.value) < 1e-6:
            continue
        rel = k.relative_key
        for i in range(n):
            mixed[i] += (k.data[i].co - rel.data[i].co) * k.value
    obj.shape_key_clear()
    for i in range(n):
        me.vertices[i].co = mixed[i]
    obj.shape_key_add(name="Basis", from_mix=False)
    for name in keep:
        if name not in deltas:
            continue
        k = obj.shape_key_add(name=name, from_mix=False)
        d = deltas[name]
        for i in range(n):
            k.data[i].co = mixed[i] + d[i]
        k.value = 0.0
    me.update()


def apply_masks(obj):
    """Applies MASK modifiers by deleting the masked vertices (bmesh keeps the shape keys; the modifier would not)."""
    for m in list(obj.modifiers):
        if m.type != "MASK":
            continue
        g = obj.vertex_groups.get(m.vertex_group)
        if g is None:
            obj.modifiers.remove(m)
            continue
        member = set()
        for v in obj.data.vertices:
            for ge in v.groups:
                if ge.group == g.index and ge.weight > 0.0:
                    member.add(v.index)
        drop_members = m.invert_vertex_group
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.verts.ensure_lookup_table()
        doomed = [v for v in bm.verts if (v.index in member) == drop_members]
        bmesh.ops.delete(bm, geom=doomed, context="VERTS")
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()
        obj.modifiers.remove(m)


def transfer_keys(body, targets, keys, reach=0.03):
    """Gives each target mesh the body's face keys: every vertex moves like its nearest skin vertex (within reach)."""
    kb = body.data.shape_keys.key_blocks if body.data.shape_keys else None
    if kb is None:
        return
    mw = body.matrix_world
    tree = KDTree(len(body.data.vertices))
    for v in body.data.vertices:
        tree.insert(mw @ v.co, v.index)
    tree.balance()
    basis = kb[0]
    for t in targets:
        tmw = t.matrix_world
        inv = tmw.inverted().to_3x3()
        near = []
        for v in t.data.vertices:
            co, idx, dist = tree.find(tmw @ v.co)
            near.append(idx if dist < reach else None)
        if all(i is None for i in near):
            continue
        if not t.data.shape_keys:
            t.shape_key_add(name="Basis", from_mix=False)
        for name in keys:
            k = kb.get(name)
            if k is None:
                continue
            tk = t.shape_key_add(name=name, from_mix=False)
            for vi, bi in enumerate(near):
                if bi is None:
                    continue
                d = (mw.to_3x3() @ (k.data[bi].co - basis.data[bi].co))
                tk.data[vi].co = t.data.vertices[vi].co + inv @ d
            tk.value = 0.0


def add_eye_bones(rig, eyes):
    """LeftEye / RightEye bones (Mixamo names) at the eyeball centres under the head; the eyes skinned to them."""
    mw = eyes.matrix_world
    sides = {"Left": [], "Right": []}
    for v in eyes.data.vertices:
        p = mw @ v.co
        sides["Left" if p.x > 0 else "Right"].append((v.index, p))
    centres = {}
    for s, pts in sides.items():
        if not pts:
            continue
        xs = [p.x for _, p in pts]
        ys = [p.y for _, p in pts]
        zs = [p.z for _, p in pts]
        centres[s] = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2))
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    inv = rig.matrix_world.inverted()
    head = rig.data.edit_bones["mixamorig:Head"]
    for s, c in centres.items():
        eb = rig.data.edit_bones.new(f"mixamorig:{s}Eye")
        eb.head = inv @ c
        eb.tail = inv @ (c + Vector((0, -0.03, 0)))
        eb.parent = head
        eb.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    for g in list(eyes.vertex_groups):
        eyes.vertex_groups.remove(g)
    for s, pts in sides.items():
        g = eyes.vertex_groups.new(name=f"mixamorig:{s}Eye")
        g.add([i for i, _ in pts], 1.0, "REPLACE")
    return list(centres)


# Face archetypes (runtime morphs): front-of-face features only, so the helmet, hair and eyeballs still fit.
ARCHETYPES = {
    "face_weathered": [("cheek/l-cheek-inner-decr", 0.55), ("cheek/r-cheek-inner-decr", 0.55), ("eyes/l-eye-bag-incr", 0.7),
                       ("eyes/r-eye-bag-incr", 0.7), ("eyebrows/eyebrows-trans-down", 0.3), ("nose/nose-hump-incr", 0.45),
                       ("chin/chin-prominent-incr", 0.2), ("mouth/mouth-scale-horiz-decr", 0.15)],
    "face_young": [("cheek/l-cheek-volume-incr", 0.45), ("cheek/r-cheek-volume-incr", 0.45), ("nose/nose-scale-vert-decr", 0.25),
                   ("chin/chin-prominent-decr", 0.25), ("eyes/l-eye-bag-decr", 0.6), ("eyes/r-eye-bag-decr", 0.6),
                   ("nose/nose-hump-decr", 0.3)],
    "face_broad": [("cheek/l-cheek-bones-incr", 0.5), ("cheek/r-cheek-bones-incr", 0.5), ("nose/nose-flaring-incr", 0.5),
                   ("nose/nose-scale-horiz-incr", 0.35), ("chin/chin-width-incr", 0.5), ("mouth/mouth-scale-horiz-incr", 0.3)],
    "face_sharp": [("nose/nose-hump-incr", 0.7), ("nose/nose-point-down", 0.35), ("nose/nose-scale-vert-incr", 0.25),
                   ("cheek/l-cheek-bones-incr", 0.35), ("cheek/r-cheek-bones-incr", 0.35), ("eyebrows/eyebrows-angle-down", 0.35),
                   ("chin/chin-height-incr", 0.25)],
}


# The listed weights read as nuance at game distance; scaled so each archetype is recognisable.
ARCHETYPE_STRENGTH = 1.6


def add_archetypes(basemesh, target_service, targets_dir):
    """Each archetype becomes one shape key (value 0): the weighted sum of its targets (loaded, combined, removed)."""
    made = []
    me = basemesh.data
    for name, parts in ARCHETYPES.items():
        loaded = []
        for rel, w in parts:
            path = os.path.join(targets_dir, rel + ".target.gz")
            if not os.path.exists(path):
                print("ARCHETYPE TARGET MISSING", rel)
                continue
            tmp = f"_arch_{len(loaded)}"
            target_service.load_target(basemesh, path, weight=0.0, name=tmp)
            loaded.append((tmp, w * ARCHETYPE_STRENGTH))
        if not loaded:
            continue
        kb = me.shape_keys.key_blocks
        basis = kb[0]
        n = len(me.vertices)
        key = basemesh.shape_key_add(name=name, from_mix=False)
        for i in range(n):
            d = Vector()
            for tmp, w in loaded:
                d += (kb[tmp].data[i].co - basis.data[i].co) * w
            key.data[i].co = basis.data[i].co + d
        key.value = 0.0
        for tmp, _ in loaded:
            basemesh.shape_key_remove(kb[tmp])
        made.append(name)
    return made
