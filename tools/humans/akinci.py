"""
Akıncı outfit on the rest-posed (riding) body: dolama with a draped skirt, mail vest and sleeves, steel vambraces,
a wide sash, şalvar, boots, gloves, a mirror plate on the chest, the çiçak helmet with its mail curtain and plume, and a
cape. Every part is skinned from the body and gets a named material (rider_<id>, see src/dragon/model/rider/).
"""
import math

import bpy
from mathutils import Vector

from garments import BODY, add_primitive, trim, apply_all, bone_weights, cloth_settle, grow, material, pin_group, region, skin, smooth_shade

COL = {
    "primary": (0.24, 0.035, 0.03),
    "secondary": (0.035, 0.03, 0.028),
    "accent": (0.3, 0.2, 0.07),
    "linen": (0.7, 0.66, 0.58),
    "leather": (0.12, 0.06, 0.03),
    "darkLeather": (0.04, 0.025, 0.018),
    "mail": (0.25, 0.25, 0.26),
    "iron": (0.45, 0.45, 0.47),
    "metal": (0.75, 0.55, 0.25),
    "fur": (0.2, 0.14, 0.09),
}


def mat(obj, key, rough=0.8, metal=0.0):
    material(obj, "rider_" + key, COL[key], rough, metal)


class Body:
    """Joint positions (world) and helpers to measure along limbs."""

    def __init__(self, rig, body):
        self.rig = rig
        self.body = body
        self.j = {}
        for pb in rig.pose.bones:
            self.j[pb.name.replace("mixamorig:", "")] = rig.matrix_world @ pb.head
        self.w = bone_weights(body)

    def along(self, co, a, b):
        """Parameter of co projected on the segment joint a -> joint b (0 at a, 1 at b)."""
        pa, pb = self.j[a], self.j[b]
        d = pb - pa
        return (co - pa).dot(d) / max(d.length_squared, 1e-9)


def dominant(w):
    return max(w.items(), key=lambda kv: kv[1])[0] if w else ""


def build(rig, body, colliders):
    B = Body(rig, body)
    BODY["obj"] = body
    from collections import Counter
    print('DOMINANT', Counter(dominant(w) for w in B.w).most_common(12), 'verts', len(body.data.vertices))
    j = B.j
    hips_z = j["Hips"].z
    neck_z = j["Neck"].z
    waist_z = hips_z + 0.12
    parts = []

    def side_of(name):
        return "Left" if name.startswith("Left") else "Right"

    # --- Dolama: torso and 3/4 sleeves.
    def dolama_top(co, w, i):
        d = dominant(w)
        if d in ("Spine", "Spine1", "Spine2", "LeftShoulder", "RightShoulder", "LeftArm", "RightArm"):
            return co.z < neck_z - 0.005
        if d == "Neck":
            return co.z < neck_z - 0.02
        if d.endswith("ForeArm"):
            s = side_of(d)
            return B.along(co, s + "ForeArm", s + "Hand") < 0.55
        if d == "Hips":
            return co.z > hips_z - 0.02
        return False

    top = region(body, "dolama", dolama_top)
    cuts = [(j["Neck"] + Vector((0, 0, -0.03)), (0, -0.25, 1))]
    for s_ in ("Left", "Right"):
        e, w_ = j[s_ + "ForeArm"], j[s_ + "Hand"]
        cuts.append((e.lerp(w_, 0.5), (w_ - e).normalized()))
    grow(top, 0.018, 0.005, smooth=4, loose=30, subdiv=1, folds=0.007, noise=0.005, noise_scale=0.05, trims=cuts)
    mat(top, "primary")
    parts.append(top)

    # --- Dolama skirt: over the hips and thighs to above the knee, split at the crotch; draped by cloth.
    def skirt_keep(co, w, i):
        d = dominant(w)
        if d == "Hips":
            return co.z < hips_z + 0.06 and not (abs(co.x) < 0.07 and co.y < j["Hips"].y - 0.02 and co.z < hips_z - 0.03)
        if d.endswith("UpLeg"):
            s = side_of(d)
            t = B.along(co, s + "UpLeg", s + "Leg")
            inner = (co.x * (1 if s == "Left" else -1)) < 0.09 + 0.1 * t and co.z < hips_z - 0.02 and t > 0.12
            return t < 0.97 and not inner
        return False

    skirt = region(body, "dolama_skirt", skirt_keep)
    grow(skirt, 0.016, 0.0, smooth=10, subdiv=1, noise=0.003, noise_scale=0.08)
    pin_group(skirt, "pin", lambda co: 1.0 if co.z > hips_z + 0.04 else max(0.0, 1.0 - (hips_z + 0.04 - co.z) / 0.03))
    cloth_settle(skirt, colliders, pin_group="pin", frames=45, mass=0.35, stiffness=4)
    so = skirt.modifiers.new("thick", "SOLIDIFY")
    so.thickness = 0.004
    so.offset = -1
    apply_all(skirt)
    mat(skirt, "primary")
    parts.append(skirt)

    # --- Şalvar: thighs below the skirt and the knees, loose.
    def salvar_keep(co, w, i):
        d = dominant(w)
        if d.endswith("UpLeg"):
            return True
        if d.endswith("Leg") and not d.endswith("UpLeg"):
            s = side_of(d)
            return B.along(co, s + "Leg", s + "Foot") < 0.5
        return d == "Hips" and co.z < hips_z
    salvar = region(body, "salvar", salvar_keep)
    grow(salvar, 0.02, 0.004, smooth=4, loose=30, subdiv=1, folds=0.006, noise=0.004, noise_scale=0.05)
    mat(salvar, "secondary")
    parts.append(salvar)

    # --- Boots: from below the knee over the foot, a heel and sole.
    def boot_keep(co, w, i):
        d = dominant(w)
        if d.endswith("Foot") or d.endswith("ToeBase"):
            return True
        if d.endswith("Leg") and not d.endswith("UpLeg"):
            s = side_of(d)
            return B.along(co, s + "Leg", s + "Foot") > 0.15
        return False
    boots = region(body, "boots", boot_keep)
    grow(boots, 0.012, 0.004, smooth=6, loose=20, subdiv=1, noise=0.0015, noise_scale=0.05)
    mat(boots, "leather", 0.55)
    parts.append(boots)

    # --- Mail vest over the dolama (torso only, to the waist) and mail sleeves showing under the sleeves' end.
    def vest_keep(co, w, i):
        d = dominant(w)
        if d in ("Spine", "Spine1", "Spine2"):
            return co.z < neck_z - 0.03 and co.z > waist_z - 0.05
        if d in ("LeftShoulder", "RightShoulder"):
            return co.z < neck_z - 0.03
        return False
    vest = region(body, "mail_vest", vest_keep)
    grow(vest, 0.03, 0.004, smooth=6, loose=30, subdiv=1, trims=[(j["Neck"] + Vector((0, 0, -0.05)), (0, -0.4, 1)), (Vector((0, 0, waist_z - 0.03)), (0, 0, -1))])
    mat(vest, "mail", 0.45, 1.0)
    parts.append(vest)

    def fore_keep(lo, hi):
        def k(co, w, i):
            d = dominant(w)
            if d.endswith("ForeArm") or d.endswith("Hand") and False:
                s = side_of(d)
                t = B.along(co, s + "ForeArm", s + "Hand")
                return lo < t < hi
            return False
        return k

    sleeves = region(body, "mail_sleeves", fore_keep(0.45, 1.02))
    grow(sleeves, 0.008, 0.003, smooth=4, loose=10, subdiv=1)
    mat(sleeves, "mail", 0.45, 1.0)
    parts.append(sleeves)
    vamb = region(body, "vambraces", fore_keep(0.5, 0.95))
    grow(vamb, 0.018, 0.004, smooth=6, loose=20, subdiv=1)
    mat(vamb, "iron", 0.35, 1.0)
    parts.append(vamb)

    # --- Gloves.
    def glove_keep(co, w, i):
        d = dominant(w)
        if "Hand" in d:
            return True
        if d.endswith("ForeArm"):
            s = side_of(d)
            return B.along(co, s + "ForeArm", s + "Hand") > 0.88
        return False
    gloves = region(body, "gloves", glove_keep)
    grow(gloves, 0.003, 0.0015, smooth=2, subdiv=0)
    mat(gloves, "leather", 0.6)
    parts.append(gloves)

    # --- Sash: a wide band at the waist, over everything.
    def sash_keep(co, w, i):
        d = dominant(w)
        return d in ("Hips", "Spine", "Spine1") and waist_z - 0.06 < co.z < waist_z + 0.04
    sash = region(body, "sash", sash_keep)
    grow(sash, 0.042, 0.008, smooth=6, loose=30, subdiv=1, noise=0.004, noise_scale=0.025)
    mat(sash, "accent")
    parts.append(sash)

    # --- Mirror plate (ayna) on the chest: a slightly domed steel disc with a gilt rim.
    chest = j["Spine2"] + Vector((0, -0.16, 0.06))
    plate = add_primitive("cylinder", "mirror_plate", chest, scale=(0.075, 0.075, 0.006), rot=(math.radians(90 - 8), 0, 0), vertices=48)
    mat(plate, "iron", 0.3, 1.0)
    rim = add_primitive("torus", "mirror_rim", chest + Vector((0, -0.006, 0)), rot=(math.radians(90 - 8), 0, 0), major=0.075, minor=0.006)
    mat(rim, "metal", 0.35, 1.0)
    boss = add_primitive("sphere", "mirror_boss", chest + Vector((0, -0.01, 0)), scale=(0.018, 0.012, 0.018))
    mat(boss, "metal", 0.35, 1.0)
    parts += [plate, rim, boss]

    # --- Çiçak helmet: measured on the head, an onion-dome profile turned on a lathe, a gilt band at the rim, a peak
    # over the brow, a nasal, cheek plates; a gilt finial on top.
    head_pts = [body.matrix_world @ v.co for i, v in enumerate(body.data.vertices) if dominant(B.w[i]) == "Head"]
    hx = [p.x for p in head_pts]
    hy = [p.y for p in head_pts]
    hz = [p.z for p in head_pts]
    crown = max(hz)
    cx = (min(hx) + max(hx)) / 2
    cy = (min(hy) + max(hy)) / 2
    half_w = (max(hx) - min(hx)) / 2
    half_d = (max(hy) - min(hy)) / 2
    brow = crown - 0.1
    import bmesh
    prof = [(1.06, 0.0), (1.08, 0.025), (1.06, 0.05), (0.98, 0.075), (0.85, 0.097), (0.67, 0.114), (0.47, 0.128), (0.29, 0.14), (0.13, 0.153), (0.0, 0.166)]
    bm = bmesh.new()
    seg = 48
    rings = []
    for (r, z) in prof:
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            ring.append(bm.verts.new((cx + math.cos(a) * r * (half_w + 0.012), cy + math.sin(a) * r * (half_d * 0.92 + 0.012), brow + z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(seg):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]))
    me = bpy.data.meshes.new("helmet_dome")
    bm.to_mesh(me)
    bm.free()
    dome = bpy.data.objects.new("helmet_dome", me)
    bpy.context.scene.collection.objects.link(dome)
    sd = dome.modifiers.new("subd", "SUBSURF")
    sd.levels = 1
    so = dome.modifiers.new("thick", "SOLIDIFY")
    so.thickness = 0.004
    apply_all(dome)
    smooth_shade(dome)
    mat(dome, "iron", 0.28, 1.0)
    apex = Vector((cx, cy, brow + 0.166))
    finial = add_primitive("cone", "helmet_finial", apex + Vector((0, 0, 0.03)), r1=0.011, r2=0.0, depth=0.06, vertices=16)
    mat(finial, "metal", 0.3, 1.0)
    knob = add_primitive("sphere", "helmet_knob", apex + Vector((0, 0, 0.002)), scale=(0.013, 0.013, 0.01))
    mat(knob, "metal", 0.3, 1.0)
    band = add_primitive("torus", "helmet_band", Vector((cx, cy, brow + 0.012)), major=1.0, minor=0.01, scale=(half_w * 1.1 + 0.012, half_d * 1.01 + 0.012, 0.7))
    mat(band, "metal", 0.32, 1.0)
    front_y = cy - half_d - 0.01
    peak = add_primitive("sphere", "helmet_peak", Vector((cx, front_y - 0.01, brow + 0.004)), scale=(0.07, 0.04, 0.005), rot=(math.radians(-10), 0, 0))
    mat(peak, "iron", 0.3, 1.0)
    nasal = add_primitive("cube", "helmet_nasal", Vector((cx, front_y - 0.004, brow - 0.035)), scale=(0.005, 0.003, 0.05))
    mat(nasal, "iron", 0.3, 1.0)
    leaf = add_primitive("sphere", "helmet_nasal_tip", Vector((cx, front_y - 0.005, brow - 0.085)), scale=(0.009, 0.004, 0.012))
    mat(leaf, "metal", 0.3, 1.0)
    parts += [dome, finial, knob, band, peak, nasal, leaf]
    for sg in (1, -1):
        cheek = add_primitive("sphere", "helmet_cheek", Vector((cx + sg * (half_w + 0.004), cy - half_d * 0.45, brow - 0.05)), scale=(0.004, 0.026, 0.042), rot=(math.radians(8), math.radians(-6 * sg), math.radians(-20 * sg)))
        mat(cheek, "iron", 0.3, 1.0)
        parts.append(cheek)
    top_c = Vector((cx, cy, brow + 0.1))

    # Mail curtain (aventail): continues the rim down over the nape and the sides of the neck, flaring a little.
    bm = bmesh.new()
    seg = 40
    rows = []
    for r, (dz, fl) in enumerate([(0.0, 1.0), (-0.04, 1.02), (-0.08, 1.06), (-0.12, 1.12), (-0.15, 1.17)]):
        row = []
        for k in range(seg + 1):
            # From beside the right cheek (-X) round the back (+Y) to beside the left cheek (+X).
            a_ = math.radians(200) - math.radians(220) * k / seg
            row.append(bm.verts.new((cx + math.cos(a_) * (half_w + 0.014) * fl, cy + math.sin(a_) * (half_d + 0.012) * fl, brow + 0.004 + dz)))
        rows.append(row)
    for r in range(len(rows) - 1):
        for k in range(seg):
            bm.faces.new((rows[r][k], rows[r][k + 1], rows[r + 1][k + 1], rows[r + 1][k]))
    me = bpy.data.meshes.new("aventail")
    bm.to_mesh(me)
    bm.free()
    av = bpy.data.objects.new("aventail", me)
    bpy.context.scene.collection.objects.link(av)
    tex = bpy.data.textures.new("aventail_folds", "CLOUDS")
    tex.noise_scale = 0.03
    dp = av.modifiers.new("folds", "DISPLACE")
    dp.texture = tex
    dp.strength = 0.006
    sd = av.modifiers.new("subd", "SUBSURF")
    sd.levels = 1
    so = av.modifiers.new("thick", "SOLIDIFY")
    so.thickness = 0.004
    apply_all(av)
    smooth_shade(av)
    mat(av, "mail", 0.45, 1.0)
    parts.append(av)

    # --- Cape from the shoulders, over the back and down onto the saddle.
    sh_l, sh_r = j["LeftArm"], j["RightArm"]
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=28, y_subdivisions=40, size=1.0)
    cape = bpy.context.active_object
    cape.name = "cape"
    width = (sh_l - sh_r).length * 1.35
    for v in cape.data.vertices:
        u, t = v.co.x + 0.5, v.co.y + 0.5  # u across, t from top (1) to bottom (0)
        down = 1.0 - t
        x = (u - 0.5) * width * (1.0 + 0.35 * down)
        y = 0.06 + 0.75 * down + 0.05 * math.cos((u - 0.5) * math.pi) * (1 - down)
        z = -down * 0.7
        v.co = Vector((x, y, z))
    cape.location = (j["Neck"] + Vector((0, 0.05, -0.04)))
    bpy.ops.object.transform_apply(location=True)
    pin_group(cape, "pin", lambda co: 1.0 if co.z > j["Neck"].z - 0.06 else 0.0)
    cloth_settle(cape, colliders, pin_group="pin", frames=50, mass=0.3, stiffness=4)
    so = cape.modifiers.new("thick", "SOLIDIFY")
    so.thickness = 0.005
    apply_all(cape)
    smooth_shade(cape)
    mat(cape, "primary")
    parts.append(cape)

    hide_covered_body(body, [top, skirt, salvar, boots, vest, sleeves, gloves])
    for p in parts:
        skin(p, body, rig)
    return parts


def hide_covered_body(body, garments, reach=0.035):
    """Deletes body faces under the garments (nothing pokes through when the rider moves; fewer triangles)."""
    import bmesh
    from mathutils.bvhtree import BVHTree
    trees = []
    for g in garments:
        bm = bmesh.new()
        bm.from_mesh(g.data)
        bm.transform(g.matrix_world)
        trees.append(BVHTree.FromBMesh(bm))
        bm.free()
    mw = body.matrix_world
    covered = []
    for v in body.data.vertices:
        p = mw @ v.co
        covered.append(any(t.find_nearest(p, reach)[0] is not None for t in trees))
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    doomed = [f for f in bm.faces if all(covered[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
