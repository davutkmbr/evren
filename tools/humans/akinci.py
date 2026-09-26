"""
Akıncı outfit on the standing (rest) body: a dolama whose skirt opens at the front and is slit at the sides and the back
for riding, gilt piping on every hem, a mail vest and sleeves, steel vambraces, a wide sash with hanging ends, şalvar,
boots, gloves, a mirror plate on the chest and the fluted çiçak helmet with a sorguç plume and a mail curtain. No cape:
it is not part of the akıncı's dress. Every part is skinned from the body and gets a named material (rider_<id>, see
src/dragon/model/rider/human.ts); ambient occlusion is baked into a vertex colour attribute.
"""
import math

import bpy
from mathutils import Vector

from garments import BODY, add_primitive, apply_all, bake_ao, bone_weights, cloth_settle, grow, material, pin_group, piping, region, skin, smooth_shade

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
    "feather": (0.8, 0.76, 0.66),
}


def mat(obj, key, rough=0.8, metal=0.0):
    material(obj, "rider_" + key, COL[key], rough, metal)


def pipe(obj, radius=0.005, key="accent"):
    """Gilt cord along the open edges of a garment."""
    return piping(obj, radius, "rider_" + key, color=COL[key])


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


def body_extent(pts, z, band=0.012):
    """Centre and half extents (x, y) of the cross-section of the points at height z (world)."""
    sl = [p for p in pts if abs(p.z - z) < band]
    xs = [p.x for p in sl]
    ys = [p.y for p in sl]
    return Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, z)), (max(xs) - min(xs)) / 2, (max(ys) - min(ys)) / 2


def lathe(name, rings, seg, keep_face=None):
    """Mesh from rings of points [[Vector]*seg]; keep_face(ring, k) False leaves a quad out (openings, slits)."""
    import bmesh
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in ring] for ring in rings]
    for i in range(len(vs) - 1):
        for k in range(seg):
            if keep_face is None or keep_face(i, k):
                bm.faces.new((vs[i][k], vs[i][(k + 1) % seg], vs[i + 1][(k + 1) % seg], vs[i + 1][k]))
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def build(rig, body, colliders):
    B = Body(rig, body)
    BODY["obj"] = body
    j = B.j
    hips_z = j["Hips"].z
    neck_z = j["Neck"].z
    waist_z = hips_z + 0.12
    parts = []
    garments = []
    weights = {}  # part -> authored skin weights (the rest take the nearest body surface's)
    mw = body.matrix_world
    trunk = [mw @ v.co for i, v in enumerate(body.data.vertices) if dominant(B.w[i]) in ("Hips", "Spine", "Spine1", "Spine2", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg")]

    def smoothstep(a, b, x):
        t = min(1.0, max(0.0, (x - a) / (b - a)))
        return t * t * (3 - 2 * t)

    def side_of(name):
        return "Left" if name.startswith("Left") else "Right"

    # --- Dolama: torso and 3/4 sleeves, a gilt cord round the collar and the cuffs.
    def dolama_top(co, w, i):
        d = dominant(w)
        if d in ("Spine", "Spine1", "Spine2", "LeftShoulder", "RightShoulder", "LeftArm", "RightArm", "Neck"):
            return co.z < neck_z + 0.04  # the collar trim plane below cuts the neckline
        if d.endswith("ForeArm"):
            s_ = side_of(d)
            return B.along(co, s_ + "ForeArm", s_ + "Hand") < 0.55
        if d == "Hips":
            return co.z > hips_z - 0.02
        return False

    top = region(body, "dolama", dolama_top)
    cuts = [(j["Neck"] + Vector((0, 0.0, -0.035)), (0, -0.3, 1))]
    for s_ in ("Left", "Right"):
        e, w_ = j[s_ + "ForeArm"], j[s_ + "Hand"]
        cuts.append((e.lerp(w_, 0.5), (w_ - e).normalized()))
    grow(top, 0.018, 0.005, smooth=4, loose=30, subdiv=1, folds=0.006, noise=0.004, noise_scale=0.05, trims=cuts, rim=False)
    mat(top, "primary")
    parts.append(top)
    garments.append(top)
    parts += pipe(top, 0.006)

    # --- Dolama skirt: a robe from the waist to below the knee, open at the front, slit at the sides and the back so
    # it parts over the saddle; draped by cloth simulation on the standing body.
    seg = 96
    z_top, z_hem = waist_z, j["LeftLeg"].z - 0.1
    rows = 26
    rings = []
    rx = ry = 0.0
    cen0 = None
    for r in range(rows + 1):
        t = r / rows
        z = z_top + (z_hem - z_top) * t
        c, ex, ey = body_extent(trunk, z)
        cen0 = cen0 or c
        rx = max(rx, ex + 0.035 + 0.05 * t)
        ry = max(ry, ey + 0.035 + 0.03 * t)
        rings.append([Vector((cen0.x + math.cos(2 * math.pi * k / seg) * rx, cen0.y + math.sin(2 * math.pi * k / seg) * ry, z)) for k in range(seg)])
    slit_z = hips_z - 0.06

    def skirt_face(i, k):
        a = math.degrees(2 * math.pi * (k + 0.5) / seg) % 360
        z = z_top + (z_hem - z_top) * (i + 0.5) / rows

        def near(deg, half):
            return abs((a - deg + 180) % 360 - 180) < half
        if near(270, 3):  # front opening (-Y)
            return False
        if z < slit_z and (near(0, 2) or near(180, 2) or near(90, 2)):  # riding slits: sides and back
            return False
        return True

    skirt = lathe("dolama_skirt", rings, seg, skirt_face)
    sd = skirt.modifiers.new("subd", "SUBSURF")
    sd.levels = 1
    apply_all(skirt)
    pin_group(skirt, "pin", lambda co: 1.0 if co.z > z_top - 0.05 else max(0.0, 1.0 - (z_top - 0.05 - co.z) / 0.04))
    cloth_settle(skirt, colliders, pin_group="pin", frames=40, mass=0.4, stiffness=6)
    so = skirt.modifiers.new("thick", "SOLIDIFY")
    so.thickness = 0.004
    so.offset = -1
    so.use_rim = False
    apply_all(skirt)
    smooth_shade(skirt)
    mat(skirt, "primary")
    parts.append(skirt)
    garments.append(skirt)

    def skirt_weights(co):
        # The waist rides with the hips; lower down the front panels follow the thighs (they lie on them when seated),
        # the back panels mostly stay with the hips and hang over the saddle.
        rel = co - cen0
        h = math.hypot(rel.x, rel.y) or 1.0
        front = max(0.0, -rel.y / h)
        back = max(0.0, rel.y / h)
        t = (z_top - co.z) / (z_top - z_hem)
        leg = smoothstep(0.05, 0.75, t) * min(1.0, max(0.0, 0.35 + 0.65 * front - 0.25 * back))
        side = "Left" if rel.x > 0 else "Right"
        return {"Hips": 1.0 - leg, side + "UpLeg": leg}
    weights[skirt] = skirt_weights
    for pp in pipe(skirt, 0.006):
        parts.append(pp)
        weights[pp] = skirt_weights

    # --- Şalvar: loose over the thighs and knees.
    def salvar_keep(co, w, i):
        d = dominant(w)
        if d.endswith("UpLeg"):
            return True
        if d.endswith("Leg") and not d.endswith("UpLeg"):
            s_ = side_of(d)
            return B.along(co, s_ + "Leg", s_ + "Foot") < 0.45
        return d == "Hips" and co.z < hips_z
    salvar = region(body, "salvar", salvar_keep)
    # Full and baggy, bloused over the boot tops.
    grow(salvar, 0.034, 0.004, smooth=4, loose=30, subdiv=1, folds=0.009, noise=0.006, noise_scale=0.05)
    mat(salvar, "secondary")
    parts.append(salvar)
    garments.append(salvar)

    # --- Boots: from below the knee over the foot.
    ankle_z = max(j["LeftFoot"].z, j["RightFoot"].z) + 0.02

    def boot_keep(co, w, i):
        d = dominant(w)
        if co.z < ankle_z:  # the foot is a separate shoe (below)
            return False
        if d.endswith("Foot") or "Toe" in d:
            return True
        if d.endswith("Leg") and not d.endswith("UpLeg"):
            s_ = side_of(d)
            return B.along(co, s_ + "Leg", s_ + "Foot") > 0.15
        return False
    boots = region(body, "boots", boot_keep)
    grow(boots, 0.012, 0.004, smooth=6, loose=90, subdiv=1, noise=0.0015, noise_scale=0.05, rim=False)
    mat(boots, "leather", 0.55)
    parts.append(boots)
    garments.append(boots)
    parts += pipe(boots, 0.007, "darkLeather")
    for sg in (1, -1):
        shoe = foot_shoe(body, ankle_z + 0.025, sg)
        mat(shoe, "leather", 0.55)
        parts.append(shoe)
        garments.append(shoe)

    # --- Mail vest over the dolama, mail sleeves under the cuffs.
    def vest_keep(co, w, i):
        d = dominant(w)
        if d in ("Spine", "Spine1", "Spine2"):
            return co.z < neck_z - 0.03 and co.z > waist_z - 0.05
        if d in ("LeftShoulder", "RightShoulder"):
            return co.z < neck_z - 0.03
        return False
    vest = region(body, "mail_vest", vest_keep)
    grow(vest, 0.03, 0.004, smooth=6, loose=30, subdiv=1, trims=[(j["Neck"] + Vector((0, 0, -0.06)), (0, -0.4, 1)), (Vector((0, 0, waist_z - 0.03)), (0, 0, -1))], rim=False)
    mat(vest, "mail", 0.45, 1.0)
    parts.append(vest)
    garments.append(vest)
    parts += pipe(vest, 0.006, "leather")

    def fore_keep(lo, hi):
        def k(co, w, i):
            d = dominant(w)
            if d.endswith("ForeArm"):
                s_ = side_of(d)
                return lo < B.along(co, s_ + "ForeArm", s_ + "Hand") < hi
            return False
        return k

    sleeves = region(body, "mail_sleeves", fore_keep(0.45, 1.02))
    grow(sleeves, 0.008, 0.003, smooth=4, loose=10, subdiv=1)
    mat(sleeves, "mail", 0.45, 1.0)
    parts.append(sleeves)
    garments.append(sleeves)
    vamb = region(body, "vambraces", fore_keep(0.5, 0.95))
    grow(vamb, 0.018, 0.004, smooth=6, loose=20, subdiv=1, rim=False)
    mat(vamb, "iron", 0.35, 1.0)
    parts.append(vamb)
    parts += pipe(vamb, 0.004, "metal")

    # --- Gloves.
    def glove_keep(co, w, i):
        d = dominant(w)
        if "Hand" in d:
            return True
        if d.endswith("ForeArm"):
            s_ = side_of(d)
            return B.along(co, s_ + "ForeArm", s_ + "Hand") > 0.88
        return False
    gloves = region(body, "gloves", glove_keep)
    grow(gloves, 0.003, 0.0015, smooth=2, subdiv=0)
    mat(gloves, "leather", 0.6)
    parts.append(gloves)
    garments.append(gloves)

    # --- Sash: a wide band at the waist, its two ends knotted at the left hip and hanging (they will take the wind).
    def sash_keep(co, w, i):
        d = dominant(w)
        return d in ("Hips", "Spine", "Spine1") and waist_z - 0.06 < co.z < waist_z + 0.04
    sash = region(body, "sash", sash_keep)
    grow(sash, 0.05, 0.008, smooth=6, loose=30, subdiv=1, noise=0.004, noise_scale=0.025)
    mat(sash, "accent")
    parts.append(sash)
    c, ex, ey = body_extent(trunk, waist_z)
    knot_at = Vector((c.x + ex * 0.55, c.y - ey - 0.045, waist_z - 0.01))  # in front of the left hip, outside the skirt
    knot = add_primitive("sphere", "sash_knot", knot_at + Vector((0.012, -0.018, 0)), scale=(0.035, 0.03, 0.03))
    mat(knot, "accent")
    parts.append(knot)
    weights[knot] = lambda co: {"Hips": 1.0}
    for n, (dx, length, width) in enumerate(((-0.02, 0.36, 0.07), (0.025, 0.3, 0.06))):
        bpy.ops.mesh.primitive_grid_add(x_subdivisions=6, y_subdivisions=24, size=1.0)
        tail = bpy.context.active_object
        tail.name = f"sash_tail{n}"
        for v in tail.data.vertices:
            u, t = v.co.x, v.co.y + 0.5  # t: 1 at the knot
            v.co = Vector((u * width * (0.85 + 0.25 * (1 - t)), 0.0, -(1 - t) * length))
        tail.location = knot_at + Vector((dx, -0.03, -0.01))
        tail.rotation_euler = (0, 0, math.radians(-35 + 20 * n))
        bpy.ops.object.transform_apply(location=True, rotation=True)
        pin_group(tail, "pin", lambda co, z0=knot_at.z - 0.01: 1.0 if co.z > z0 - 0.015 else 0.0)
        cloth_settle(tail, colliders + [skirt], pin_group="pin", frames=30, mass=0.2, stiffness=5)
        so = tail.modifiers.new("thick", "SOLIDIFY")
        so.thickness = 0.003
        sd = tail.modifiers.new("subd", "SUBSURF")
        sd.levels = 1
        apply_all(tail)
        smooth_shade(tail)
        mat(tail, "accent")
        parts.append(tail)
        weights[tail] = lambda co: {"Hips": 1.0}

    # --- Mirror plate (ayna) on the chest: a slightly domed steel disc with a gilt rim.
    cc, cex, cey = body_extent(trunk, j["Spine2"].z + 0.05)
    chest = Vector((0, cc.y - cey - 0.035, j["Spine2"].z + 0.05))
    plate = add_primitive("cylinder", "mirror_plate", chest, scale=(0.075, 0.075, 0.006), rot=(math.radians(90 - 8), 0, 0), vertices=48)
    mat(plate, "iron", 0.3, 1.0)
    rim = add_primitive("torus", "mirror_rim", chest + Vector((0, -0.006, 0)), rot=(math.radians(90 - 8), 0, 0), major=0.075, minor=0.006)
    mat(rim, "metal", 0.35, 1.0)
    boss = add_primitive("sphere", "mirror_boss", chest + Vector((0, -0.01, 0)), scale=(0.018, 0.012, 0.018))
    mat(boss, "metal", 0.35, 1.0)
    parts += [plate, rim, boss]

    # --- Çiçak helmet, measured on the head: a fluted onion dome turned on a lathe, a gilt band at the rim, cheek
    # plates, a gilt finial, a sorguç (jewelled plume holder) at the front with heron feathers sweeping back.
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
    prof = [(1.06, 0.0), (1.08, 0.025), (1.06, 0.05), (0.98, 0.075), (0.85, 0.097), (0.67, 0.114), (0.47, 0.128), (0.29, 0.14), (0.13, 0.153), (0.0, 0.166)]
    hseg = 96
    flutes = 16
    rings = []
    for i, (r, z) in enumerate(prof):
        fade = math.sin(math.pi * min(1.0, max(0.0, (i - 1.5) / (len(prof) - 2.5)))) if 1.5 < i < len(prof) - 1 else 0.0
        ring = []
        for k in range(hseg):
            a = 2 * math.pi * k / hseg
            fl = 1.0 + 0.045 * fade * abs(math.cos(a * flutes / 2)) ** 0.5
            ring.append(Vector((cx + math.cos(a) * r * fl * (half_w + 0.012), cy + math.sin(a) * r * fl * (half_d * 0.92 + 0.012), brow + z)))
        rings.append(ring)
    dome = lathe("helmet_dome", rings, hseg)
    sd = dome.modifiers.new("subd", "SUBSURF")
    sd.levels = 1
    so = dome.modifiers.new("thick", "SOLIDIFY")
    so.thickness = 0.004
    apply_all(dome)
    smooth_shade(dome)
    mat(dome, "iron", 0.4, 1.0)
    apex = Vector((cx, cy, brow + 0.166))
    finial = add_primitive("cone", "helmet_finial", apex + Vector((0, 0, 0.03)), r1=0.011, r2=0.0, depth=0.06, vertices=16)
    mat(finial, "metal", 0.3, 1.0)
    knob = add_primitive("sphere", "helmet_knob", apex + Vector((0, 0, 0.002)), scale=(0.013, 0.013, 0.01))
    mat(knob, "metal", 0.3, 1.0)
    band = add_primitive("torus", "helmet_band", Vector((cx, cy, brow + 0.014)), major=1.0, minor=0.012, scale=(half_w * 1.1 + 0.014, half_d * 1.01 + 0.014, 0.9))
    mat(band, "metal", 0.35, 1.0)
    parts += [dome, finial, knob, band]
    for sg in (1, -1):
        cheek = add_primitive("sphere", "helmet_cheek", Vector((cx + sg * (half_w + 0.004), cy - half_d * 0.45, brow - 0.05)), scale=(0.004, 0.026, 0.042), rot=(math.radians(8), math.radians(-6 * sg), math.radians(-20 * sg)))
        mat(cheek, "iron", 0.35, 1.0)
        parts.append(cheek)
    # Sorguç: a gilt socket on the front of the dome, a jewel, and three feathers curving up and back.
    front = Vector((cx, cy - half_d * 0.78, brow + 0.085))
    socket = add_primitive("cylinder", "sorguc_socket", front + Vector((0, 0, 0.02)), scale=(0.009, 0.009, 0.03), rot=(math.radians(-25), 0, 0), vertices=16)
    mat(socket, "metal", 0.3, 1.0)
    jewel = add_primitive("sphere", "sorguc_jewel", front + Vector((0, -0.012, 0.0)), scale=(0.012, 0.008, 0.015))
    mat(jewel, "primary", 0.2)
    parts += [socket, jewel]
    for n, (yaw, lean, length) in enumerate(((0, 18, 0.2), (-12, 26, 0.17), (12, 26, 0.17))):
        bpy.ops.mesh.primitive_grid_add(x_subdivisions=4, y_subdivisions=20, size=1.0)
        f = bpy.context.active_object
        f.name = f"sorguc_feather{n}"
        for v in f.data.vertices:
            u, t = v.co.x, v.co.y + 0.5  # t 0 at the socket, 1 at the tip
            width = 0.028 * math.sin(math.pi * min(1.0, 0.15 + t)) * (1 - 0.6 * t)
            bend = (t * t) * length * 0.55  # curls back
            v.co = Vector((u * width, bend, t * length - 0.25 * bend))
        f.location = front + Vector((0, 0.01, 0.045))
        f.rotation_euler = (math.radians(-lean), math.radians(yaw), 0)
        bpy.ops.object.transform_apply(location=True, rotation=True)
        so = f.modifiers.new("thick", "SOLIDIFY")
        so.thickness = 0.0015
        apply_all(f)
        smooth_shade(f)
        mat(f, "feather", 0.9)
        parts.append(f)

    # Mail curtain (aventail): continues the rim down over the nape and the sides of the neck, flaring a little.
    import bmesh
    bm = bmesh.new()
    aseg = 40
    arows = []
    for dz, fl in [(0.0, 1.0), (-0.04, 1.02), (-0.08, 1.06), (-0.12, 1.12), (-0.15, 1.17)]:
        row = []
        for k in range(aseg + 1):
            # From beside the right cheek (-X) round the back (+Y) to beside the left cheek (+X).
            a_ = math.radians(200) - math.radians(220) * k / aseg
            row.append(bm.verts.new((cx + math.cos(a_) * (half_w + 0.014) * fl, cy + math.sin(a_) * (half_d + 0.012) * fl, brow + 0.004 + dz)))
        arows.append(row)
    for r in range(len(arows) - 1):
        for k in range(aseg):
            bm.faces.new((arows[r][k], arows[r][k + 1], arows[r + 1][k + 1], arows[r + 1][k]))
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

    head_parts = [o for o in parts if o.name.startswith(("helmet", "sorguc", "aventail"))]
    for o in head_parts:
        weights[o] = lambda co: {"Head": 1.0}
    bake_ao(parts)
    for p in parts:
        skin(p, body, rig, weights.get(p))
    # After skinning: the garments take their weights from the full body (gloves from the fingers).
    hide_covered_body(body, garments)
    return parts


def foot_shoe(body, top_z, sg):
    """
    The foot of a boot: the convex hull of the body's foot below top_z (no toes, a flat sole), rebuilt as an even mesh,
    rounded and pushed out to the leather's thickness.
    """
    import bmesh
    mw = body.matrix_world
    bm = bmesh.new()
    for v in body.data.vertices:
        p = mw @ v.co
        if p.z < top_z and p.x * sg > 0:
            bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts[:])
    me = bpy.data.meshes.new("boot_foot")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("boot_foot", me)
    bpy.context.scene.collection.objects.link(o)
    rm = o.modifiers.new("remesh", "REMESH")
    rm.mode = "VOXEL"
    rm.voxel_size = 0.006
    sm = o.modifiers.new("round", "SMOOTH")
    sm.factor = 0.8
    sm.iterations = 12
    d = o.modifiers.new("thick", "DISPLACE")
    d.strength = 0.01
    d.mid_level = 0.0
    apply_all(o)
    smooth_shade(o)
    return o


def hide_covered_body(body, garments, reach=0.06):
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
    nm = mw.to_3x3().inverted().transposed()
    covered = []
    for v in body.data.vertices:
        # Covered when a garment lies right over the skin along its normal (and near it anyway): skin beyond a hem or
        # a neckline stays, so the cut in the body never shows.
        p = mw @ v.co
        n = (nm @ v.normal).normalized()
        covered.append(any(t.ray_cast(p - n * 0.002, n, reach)[0] is not None for t in trees))
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    doomed = [f for f in bm.faces if all(covered[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
