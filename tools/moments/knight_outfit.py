"""
The Aya Yorgi statue's dress and arms, grown on the posed body (tools/humans/garments.py) in the manner of the soldier
saints of the icons: a knee-length tunic with a pleated skirt, a muscle cuirass with pteruges at the hips and the
shoulders, a sash knotted at the front, a sword on a baldric, a chlamys pinned at the right shoulder and falling down
the back, laced boots with greaves, a crested helmet, a round shield with a cross in relief, a spear with a leaf blade.

Everything is one bronze casting (material 'bronze'); the parts are skinned to the rig so the game can move the spear
arm, the shoulders and the head (src/moments/aya-yorgi/pose.ts).
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import garments as G
from akinci import Body, body_extent, dominant, lathe

BRONZE = (0.36, 0.24, 0.12)


def mat(obj, name="bronze", color=BRONZE):
    G.material(obj, name, color, 0.5, 1.0)


def solid_box(name, size, bevel=0.0, seg=2):
    """Box mesh centred on the origin (size x, y, z), optionally bevelled."""
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = seg
        G.apply_all(o)
    return o


def place(o, loc, x_axis, y_axis):
    """Moves an object built along its local axes to `loc`, with local X / Y mapped to the given world directions."""
    x = x_axis.normalized()
    y = (y_axis - x * y_axis.dot(x)).normalized()
    z = x.cross(y)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = loc
    o.matrix_world = m
    bpy.context.view_layer.update()
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)


def revolve(name, profile, seg=48, axis_loc=Vector(), axis=Vector((0, 0, 1)), cap=True):
    """Surface of revolution: profile [(r, h)] around `axis` through `axis_loc` (h along the axis)."""
    a = axis.normalized()
    u = a.orthogonal().normalized()
    v = a.cross(u)
    rings = []
    for r, h in profile:
        rings.append([axis_loc + a * h + (u * math.cos(2 * math.pi * k / seg) + v * math.sin(2 * math.pi * k / seg)) * r for k in range(seg)])
    o = lathe(name, rings, seg)
    if cap:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.holes_fill(bm, edges=bm.edges, sides=seg)
        bm.to_mesh(o.data)
        bm.free()
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(o.data)
    bm.free()
    G.smooth_shade(o)
    return o


def tube(name, pts, radius, profile=None, closed=False):
    """A cord / strap along points; profile (w, h) makes a flat strap instead of a round cord."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    if profile:
        bpy.ops.curve.primitive_bezier_circle_add(radius=1.0)
        prof = bpy.context.active_object
        prof.scale = (profile[0] / 2, profile[1] / 2, 1)
        bpy.ops.object.transform_apply(scale=True)
        cu.bevel_mode = "OBJECT"
        cu.bevel_object = prof
    else:
        cu.bevel_depth = radius
        cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (p.x, p.y, p.z, 1.0)
    sp.use_cyclic_u = closed
    co = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(co)
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(co.evaluated_get(deps))
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    bpy.data.objects.remove(co, do_unlink=True)
    if profile:
        bpy.data.objects.remove(prof, do_unlink=True)
    G.smooth_shade(o)
    return o


def ribbon(name, pts, normals, width, thick):
    """A flat strap along pts lying on a surface (normals): width across the path, thickness along the normal."""
    bm = bmesh.new()
    rows = []
    n = len(pts)
    for i, (p_, nr) in enumerate(zip(pts, normals)):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        side = t.cross(nr).normalized() * (width / 2)
        up = nr.normalized() * thick
        rows.append([bm.verts.new(p_ - side), bm.verts.new(p_ + side), bm.verts.new(p_ + side + up), bm.verts.new(p_ - side + up)])
    for a, b in zip(rows, rows[1:]):
        for k in range(4):
            bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    bv = o.modifiers.new("bevel", "BEVEL")
    bv.width = min(width, thick) * 0.3
    bv.segments = 2
    G.apply_all(o)
    G.smooth_shade(o)
    return o


def on_surface(obj, pts, gap):
    """Points projected onto obj's surface (nearest point) and lifted by `gap`; returns (points, normals)."""
    out, nrs = [], []
    for p_ in pts:
        ok, hit, nr, _ = obj.closest_point_on_mesh(p_)
        if ok:
            out.append(hit + nr * gap)
            nrs.append(nr.copy())
    return out, nrs


def smooth_path(pts, n=6):
    for _ in range(n):
        pts = [pts[0]] + [pts[i] * 0.5 + (pts[i - 1] + pts[i + 1]) * 0.25 for i in range(1, len(pts) - 1)] + [pts[-1]]
    return pts


def fitted_shell(name, fit, target, zs, seg, offset, smooth=3, keep_face=None, squash=None):
    """
    A clean shell of `seg` columns over the height levels `zs` (bottom to top), each ring an ellipse fitted to the
    cross-section of the points `fit` at that height, then wrapped onto `target` at `offset` (nearest surface point,
    outside) and relaxed `smooth` times: the body's anatomy at a constant distance, with straight clean edges.
    keep_face(i, k) False leaves a quad out; squash(z) -> (sx, sy) scales a ring (default 1).
    """
    rings = []
    for z in zs:
        c, ex, ey = body_extent(fit, z, band=0.015)
        sx, sy = squash(z) if squash else (1.0, 1.0)
        rings.append([Vector((c.x + math.cos(2 * math.pi * k / seg) * (ex + offset) * sx, c.y + math.sin(2 * math.pi * k / seg) * (ey + offset) * sy, z)) for k in range(seg)])
    o = lathe(name, rings, seg, keep_face)
    sw = o.modifiers.new("wrap", "SHRINKWRAP")
    sw.target = target
    sw.wrap_method = "NEAREST_SURFACEPOINT"
    sw.wrap_mode = "OUTSIDE_SURFACE"
    sw.offset = offset
    if smooth:
        sm = o.modifiers.new("relax", "SMOOTH")
        sm.factor = 0.6
        sm.iterations = smooth
    sd = o.modifiers.new("subd", "SUBSURF")
    sd.levels = 1
    G.apply_all(o)
    return o


def _eased(keys, a):
    """Cosine interpolation in a closed table of (angle in degrees, value)."""
    a %= 360
    for (a0, v0), (a1, v1) in zip(keys, keys[1:]):
        if a0 <= a <= a1:
            t = (a - a0) / (a1 - a0)
            return v0 + (v1 - v0) * (1 - math.cos(math.pi * t)) / 2
    return keys[-1][1]


def helmet_shell(head_obj, frame, pts, offset=0.018, seg=112, rows=34):
    """
    An Attic helmet as one shell, built in the head's frame (origin at the head joint; local Z up the skull, -Y out of
    the face, so a tilted or turned head wears it straight): a dome of `seg` columns (angle 0 = +X, 90 = back,
    270 = front) from a pole over the crown down to the outline edge(angle), wrapped onto the head at `offset`, the neck
    guard flared out, relaxed (the offset leaves room for the relaxing) and thickened inward. `pts` are the head's points in that frame.
    """
    origin, R = frame
    top = max(p_.z for p_ in pts)
    brow_z = top * 0.6
    c, ex, ey = body_extent(pts, brow_z, band=0.015)
    ear, nape, cheek, brow = brow_z + 0.006, -0.07, -0.02, brow_z + 0.016
    keys = [(0, ear), (28, nape + 0.03), (90, nape), (152, nape + 0.03), (180, ear), (204, cheek), (228, cheek),
            (246, brow), (294, brow), (312, cheek), (336, cheek), (360, ear)]
    crown = top + 0.03
    world = lambda x, y, z: origin + R @ Vector((x, y, z))  # noqa: E731
    bm = bmesh.new()
    pole = bm.verts.new(world(c.x, c.y, crown))
    grid = []
    for q in range(seg):
        a = 2 * math.pi * q / seg
        lo = _eased(keys, math.degrees(a))
        col = []
        for r in range(1, rows + 1):
            z = crown - (crown - lo) * r / rows
            s = math.sqrt(max(0.0, 1 - ((z - brow_z) / (crown - brow_z)) ** 2)) if z > brow_z else 1.0
            col.append(bm.verts.new(world(c.x + math.cos(a) * ex * s, c.y + math.sin(a) * ey * s, z)))
        grid.append(col)
    for q in range(seg):
        a_, b_ = grid[q], grid[(q + 1) % seg]
        bm.faces.new((pole, b_[0], a_[0]))
        for r in range(rows - 1):
            bm.faces.new((a_[r], b_[r], b_[r + 1], a_[r + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("helmet")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("helmet", me)
    bpy.context.scene.collection.objects.link(o)
    sw = o.modifiers.new("wrap", "SHRINKWRAP")
    sw.target = head_obj
    sw.wrap_method = "NEAREST_SURFACEPOINT"
    sw.wrap_mode = "OUTSIDE_SURFACE"
    sw.offset = offset
    G.apply_all(o)
    # the neck guard flares out over the nape; the cheek guards stand a little off the jaw like hinged plates
    Rt = R.transposed()
    for v in o.data.vertices:
        loc = Rt @ (v.co - origin)
        rel = Vector((loc.x - c.x, loc.y - c.y, 0))
        if rel.length < 1e-6:
            continue
        back = max(0.0, rel.normalized().y)
        drop = max(0.0, 0.01 - loc.z)
        v.co += R @ (rel.normalized() * (drop * (0.9 * back + 0.25 * (1 - back))))
    sm = o.modifiers.new("relax", "SMOOTH")
    sm.factor = 0.7
    sm.iterations = 12
    sd = o.modifiers.new("subd", "SUBSURF")
    sd.levels = 1
    so = o.modifiers.new("thick", "SOLIDIFY")
    so.thickness = 0.006
    so.offset = -1
    G.apply_all(o)
    G.smooth_shade(o)
    return o, (c, brow_z)


def helmet_midline(helmet, frame, c, brow_z, n=40):
    """(point, outward normal) pairs along the helmet's midline in the head's frame, from above the brow over the
    crown to the nape."""
    origin, R = frame
    out = []
    for k in range(n):
        th = math.radians(-58 + 150 * k / (n - 1))  # 0 = straight up the skull, - toward the brow, + toward the nape
        d = R @ Vector((0.0, math.sin(th), math.cos(th)))
        start = origin + R @ Vector((c.x, c.y, brow_z)) + d * 0.5
        ok, hit, nrm, _ = helmet.ray_cast(start, -d)
        if ok:
            out.append((hit, nrm.normalized()))
    pts = smooth_path([p_ for p_, _ in out], 2)
    return [(p_, nr) for p_, (_, nr) in zip(pts, out)]


def crest_strands(arc, side, count=320, seed=11):
    """
    The horsehair crest: `count` tapering strands rooted along the holder, standing up tallest over the crown and
    sweeping back, the last ones falling down the back of the neck as a tail. One curve object, converted to mesh.
    """
    import random
    rnd = random.Random(seed)
    cu = bpy.data.curves.new("crest", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 1.0
    cu.bevel_resolution = 1
    cu.use_fill_caps = True
    n = len(arc)
    for s in range(count):
        u = rnd.random() ** 0.9
        i = min(n - 1, int(u * (n - 1)))
        q, nr = arc[i]
        tang = (arc[min(i + 1, n - 1)][0] - arc[max(i - 1, 0)][0]).normalized()
        root = q + nr * 0.018 + side * rnd.uniform(-0.013, 0.013)
        h = 0.05 + 0.085 * math.sin(math.pi * min(1.0, 0.12 + 0.95 * u)) * rnd.uniform(0.92, 1.03)
        tail = max(0.0, (u - 0.62) / 0.38)
        lean = 0.35 + 0.5 * u
        fan = side * rnd.uniform(-0.012, 0.012)
        pts = []
        for k in range(12):
            t = k / 11
            p_ = root + nr * (h * math.sin(t * math.pi / 2) * (1 - 0.6 * tail)) + tang * (h * lean * t * t) + fan * t
            p_ += Vector((0, 0.05 * tail * t, -0.26 * tail * t ** 1.6))
            pts.append(p_)
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        r0 = rnd.uniform(0.005, 0.0072)
        for k, p_ in enumerate(pts):
            sp.points[k].co = (p_.x, p_.y, p_.z, 1.0)
            sp.points[k].radius = r0 * (1.0 - 0.75 * (k / 11) ** 1.5)
    co = bpy.data.objects.new("crest_curve", cu)
    bpy.context.scene.collection.objects.link(co)
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(co.evaluated_get(deps))
    o = bpy.data.objects.new("crest", me)
    bpy.context.scene.collection.objects.link(o)
    bpy.data.objects.remove(co, do_unlink=True)
    G.smooth_shade(o)
    return o


def temp_region(body, name, bones, B, extra=None):
    """A copy of the body faces whose vertices are dominated by `bones` (a shrinkwrap target)."""
    return G.region(body, name, lambda co, w, i: dominant(w) in bones and (extra is None or extra(co)))


def build(rig, body):
    """Builds every part on the posed (rest-applied) body; returns {'parts': [...], 'rigid': {obj: bone}}."""
    B = Body(rig, body)
    G.BODY["obj"] = body
    j = B.j
    hips_z = j["Hips"].z
    neck = j["Neck"]
    head = j["Head"]
    mw = body.matrix_world
    verts = [mw @ v.co for v in body.data.vertices]
    trunk = [verts[i] for i in range(len(verts)) if dominant(B.w[i]) in ("Hips", "Spine", "Spine1", "Spine2", "LeftUpLeg", "RightUpLeg")]
    parts, rigid = [], {}
    side = lambda n: "Left" if n.startswith("Left") else "Right"  # noqa: E731

    # --- Tunic: torso and sleeves to above the elbow (seen at the arms and under the cuirass's edges).
    def tunic_keep(co, w, i):
        d = dominant(w)
        if d in ("Spine", "Spine1", "Spine2", "LeftShoulder", "RightShoulder", "Neck"):
            return co.z < neck.z + 0.02
        if d.endswith("Arm") and not d.endswith("ForeArm"):
            s = side(d)
            return B.along(co, s + "Arm", s + "ForeArm") < 0.72
        if d == "Hips":
            return co.z > hips_z - 0.03
        return False

    tunic = G.region(body, "tunic", tunic_keep)
    cuts = [(neck + Vector((0, -0.01, -0.02)), (0, -0.35, 1))]
    for s in ("Left", "Right"):
        a, e = j[s + "Arm"], j[s + "ForeArm"]
        cuts.append((a.lerp(e, 0.7), (e - a).normalized()))
    G.grow(tunic, 0.012, 0.004, smooth=4, loose=18, subdiv=1, folds=0.006, noise=0.003, noise_scale=0.05, trims=cuts, rim=False)
    parts += [tunic] + G.piping(tunic, 0.005, "bronze")

    # --- Pleated skirt of the tunic: waist to just above the knee, flaring, settled by cloth.
    seg, rows = 120, 22
    z_top = hips_z + 0.06
    z_hem = (j["LeftLeg"].z + j["RightLeg"].z) / 2 + 0.07
    rings = []
    rx = ry = 0.0
    cen0 = None
    for r in range(rows + 1):
        t = r / rows
        z = z_top + (z_hem - z_top) * t
        c, ex, ey = body_extent(trunk, z)
        cen0 = cen0 or c
        rx = max(rx, ex + 0.02 + 0.07 * t)
        ry = max(ry, ey + 0.02 + 0.05 * t)
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            pleat = 1 + 0.035 * math.sin(a * 30) * t  # 30 pleats, deeper toward the hem
            ring.append(Vector((cen0.x + math.cos(a) * rx * pleat, cen0.y + math.sin(a) * ry * pleat, z)))
        rings.append(ring)
    skirt = lathe("skirt", rings, seg)
    G.pin_group(skirt, "pin", lambda co: 1.0 if co.z > z_top - 0.04 else max(0.0, 1.0 - (z_top - 0.04 - co.z) / 0.05))
    G.cloth_settle(skirt, [body], pin_group="pin", frames=36, mass=0.35, stiffness=10)
    so = skirt.modifiers.new("thick", "SOLIDIFY")
    so.thickness = 0.006
    so.offset = -1
    G.apply_all(skirt)
    G.smooth_shade(skirt)
    parts += [skirt] + G.piping(skirt, 0.006, "bronze")

    # --- Muscle cuirass: the torso's own anatomy (pectorals, the abdominal grid) at 2.5 cm, from the hips to the armpits,
    # a rolled rim at the top and the bottom, and a shaped plate over each shoulder (the humeral straps).
    trunk_obj = temp_region(body, "trunk_fit", ("Hips", "Spine", "Spine1", "Spine2", "LeftShoulder", "RightShoulder", "Neck"), B)
    armpit_z = min(j["LeftArm"].z, j["RightArm"].z) - 0.1
    top_z_c = neck.z - 0.02
    z0 = hips_z + 0.035
    zs = [z0 + (top_z_c - z0) * t / 40 for t in range(41)]

    def cuirass_face(i, k):
        z = (zs[i] + zs[i + 1]) / 2
        if z < armpit_z:
            return True
        # armholes widen from the armpit to the shoulder top; front and back plates meet under the humeral straps
        w = 75 * min(1.0, (z - armpit_z) / max(0.01, (top_z_c - 0.06 - armpit_z))) ** 0.6
        a_ = math.degrees(2 * math.pi * (k + 0.5) / 72) % 360
        return min(abs((a_ - 0 + 180) % 360 - 180), abs((a_ - 180 + 180) % 360 - 180)) > w

    cuirass = fitted_shell("cuirass", trunk + [verts[i] for i in range(len(verts)) if dominant(B.w[i]) in ("LeftShoulder", "RightShoulder")], trunk_obj, zs, 72, 0.025, smooth=2, keep_face=cuirass_face)
    so = cuirass.modifiers.new("thick", "SOLIDIFY")
    so.thickness = 0.01
    so.offset = -1
    G.apply_all(cuirass)
    G.smooth_shade(cuirass)
    parts += [cuirass] + G.piping(cuirass, 0.011, "bronze")
    cuirass_hem = z0
    for s in ("Left", "Right"):
        sh = j[s + "Shoulder"].lerp(j[s + "Arm"], 0.55)
        pts = []
        for i in range(17):
            a_ = math.pi * i / 16  # front (-Y) over the top to the back (+Y)
            pts.append(sh + Vector((0, -math.cos(a_) * 0.13, math.sin(a_) * 0.08 - 0.07)))
        for p_ in pts:
            ok, hit, nrm, _ = body.closest_point_on_mesh(p_)
            if ok:
                q = hit + nrm * 0.035
                p_.x, p_.y, p_.z = q.x, q.y, q.z
        strap = tube(f"humeral_{s}", smooth_path(pts, 3), 0, profile=(0.012, 0.085))
        parts.append(strap)
        parts += [revolve(f"humeral_stud_{s}_{e}", [(0.0, 0.016), (0.014, 0.01), (0.017, 0.0)], seg=14, axis_loc=pts[e], axis=(pts[e] - sh).normalized()) for e in (1, 15)]

    # --- Pteruges: two overlapping rows of rounded leather strips hanging from under the cuirass, a row over each
    # upper arm. Each strip: local X its width (along the row), local Y its thickness (outward), local Z up.
    Z = Vector((0, 0, 1))

    c, ex, ey = body_extent(trunk, cuirass_hem)
    for row, (n, length, grow_, phase) in enumerate(((28, 0.16, 0.032, 0.0), (28, 0.2, 0.042, 0.5))):
        for k in range(n):
            a_ = 2 * math.pi * (k + 0.5 + phase) / n
            out_dir = Vector((math.cos(a_) / (ex + grow_), math.sin(a_) / (ey + grow_), 0)).normalized()
            top = Vector((c.x + math.cos(a_) * (ex + grow_), c.y + math.sin(a_) * (ey + grow_), cuirass_hem + 0.012 - 0.01 * row))
            tilt = math.radians(8 + 3 * row)
            s_ = solid_box(f"pteruges_{row}_{k}", (0.05, 0.009, length), bevel=0.004, seg=2)
            s_.data.transform(Matrix.Translation((0, 0, -length / 2)))
            zl = (Z * math.cos(tilt) - out_dir * math.sin(tilt)).normalized()  # local up: the strip hangs out and down
            yl = (out_dir * math.cos(tilt) + Z * math.sin(tilt)).normalized()
            place(s_, top, yl.cross(zl), yl)
            parts.append(s_)
    for s in ("Left", "Right"):
        a0, e0 = j[s + "Arm"], j[s + "ForeArm"]
        axis = (e0 - a0).normalized()
        u = axis.orthogonal().normalized()
        v = axis.cross(u)
        top0 = a0 + axis * 0.02
        for k in range(10):
            ang = 2 * math.pi * k / 10
            out_dir = (u * math.cos(ang) + v * math.sin(ang))
            s_ = solid_box(f"shoulder_{s}_{k}", (0.045, 0.008, 0.14), bevel=0.004, seg=2)
            s_.data.transform(Matrix.Translation((0, 0, -0.07)))
            t_ = 0.18
            zl = (-axis * math.cos(t_) - out_dir * math.sin(t_)).normalized()  # local up points back to the shoulder
            yl = (out_dir * math.cos(t_) - axis * math.sin(t_)).normalized()
            place(s_, top0 + out_dir * 0.08, yl.cross(zl), yl)
            parts.append(s_)

    # --- Sash: a band round the cuirass at the waist, knotted at the front with two hanging ends.
    z_sash = hips_z + 0.13
    c, ex, ey = body_extent(trunk, z_sash)
    band = []
    for k in range(64):
        a = 2 * math.pi * k / 64
        band.append(Vector((c.x + math.cos(a) * (ex + 0.045), c.y + math.sin(a) * (ey + 0.045), z_sash + 0.006 * math.sin(a * 2))))
    sash = tube("sash", band, 0, profile=(0.012, 0.05), closed=True)
    front = Vector((c.x - 0.02, c.y - ey - 0.05, z_sash))
    knot = revolve("sash_knot", [(0.0, -0.03), (0.028, -0.02), (0.034, 0.0), (0.028, 0.02), (0.0, 0.03)], seg=16, axis_loc=front, axis=Vector((0, -1, 0)))
    ends = []
    for dx, sway in ((-0.03, -0.02), (0.02, 0.03)):
        pts = [front + Vector((dx * t + sway * t * t, -0.01 - 0.02 * t, -0.03 - 0.26 * t)) for t in [i / 8 for i in range(9)]]
        ends.append(tube(f"sash_end_{len(ends)}", pts, 0, profile=(0.006, 0.045)))
    parts += [sash, knot] + ends

    # --- Baldric from the right shoulder to the left hip, and the sword in its scabbard.
    p0 = j["RightShoulder"].lerp(j["RightArm"], 0.5) + Vector((0, 0, 0.03))
    p1 = Vector((c.x + ex * 0.7, c.y, z_sash - 0.06))
    front_pts, back_pts = [], []
    for i in range(32):
        t = i / 31
        q = p0.lerp(p1, t)
        front_pts.append(q + Vector((0, -0.3, 0)))
        back_pts.append(q + Vector((0, 0.3, 0)))
    for tag, raw in (("baldric", front_pts), ("baldric_back", back_pts)):
        pts, nrs = on_surface(cuirass, raw, 0.004)
        for _ in range(3):
            pts = smooth_path(pts, 6)
            pts, nrs = on_surface(cuirass, pts, 0.004)
        parts.append(ribbon(tag, pts, nrs, 0.04, 0.006))
    hilt = p1 + Vector((0.03, -0.1, 0.02))
    sdir = Vector((0.18, 0.45, -1)).normalized()
    parts.append(revolve("scabbard", [(0.0, 0.0), (0.024, 0.01), (0.026, 0.1), (0.024, 0.55), (0.02, 0.66), (0.012, 0.7), (0.0, 0.71)], seg=12, axis_loc=hilt, axis=sdir))
    parts.append(revolve("grip", [(0.0, 0.0), (0.016, 0.0), (0.017, -0.05), (0.016, -0.1), (0.0, -0.1)], seg=10, axis_loc=hilt, axis=sdir))
    guard = solid_box("guard", (0.16, 0.022, 0.016), bevel=0.004)
    place(guard, hilt + sdir * 0.005, sdir.cross(Vector((0, -1, 0))), sdir.cross(sdir.cross(Vector((0, -1, 0)))))
    parts.append(guard)
    parts.append(revolve("pommel", [(0.0, -0.13), (0.022, -0.12), (0.026, -0.105), (0.018, -0.095), (0.0, -0.095)], seg=12, axis_loc=hilt, axis=sdir))

    # --- Boots: calf-high, laced, the toes free; greaves over the shins.
    def boot_keep(co, w, i):
        d = dominant(w)
        if d.endswith("Foot") or d.endswith("ToeBase"):
            return True
        if d.endswith("Leg") and not d.endswith("UpLeg"):
            s_ = side(d)
            return B.along(co, s_ + "Leg", s_ + "Foot") > 0.28
        return False

    boots = G.region(body, "boots", boot_keep)
    G.grow(boots, 0.008, 0.004, smooth=4, loose=6, subdiv=1, noise=0.002, rim=False)
    parts += [boots] + G.piping(boots, 0.006, "bronze")

    def greave_keep(co, w, i):
        d = dominant(w)
        if d.endswith("Leg") and not d.endswith("UpLeg"):
            s_ = side(d)
            t = B.along(co, s_ + "Leg", s_ + "Foot")
            knee = j[s_ + "Leg"]
            return 0.08 < t < 0.8 and co.y < knee.y + 0.01
        return False

    greaves = G.region(body, "greaves", greave_keep)
    G.grow(greaves, 0.02, 0.006, smooth=8, loose=8, subdiv=2, rim=True)
    parts += [greaves] + G.piping(greaves, 0.005, "bronze")

    # --- Helmet (Attic type): one shell raised over the skull, its lower edge cut in the Attic outline (a brow band over
    # the eyes, cheek guards down to the jaw leaving the face open, open over the ears, a neck guard flaring over the
    # nape) with a rolled rim; a horsehair crest in a low holder from the brow to the nape.
    head_ids = [i for i in range(len(verts)) if dominant(B.w[i]) == "Head"]
    head_pts = [verts[i] for i in head_ids]
    head_obj = temp_region(body, "head_fit", ("Head", "Neck"), B)
    # the head's frame: up the head bone, -Y toward the nose tip (the head point furthest in front)
    up = (rig.matrix_world.to_3x3() @ rig.pose.bones["mixamorig:Head"].matrix.to_3x3()).col[1].normalized()
    nose = min(head_pts, key=lambda p_: p_.y)
    fwd = nose - head
    fwd = (fwd - up * fwd.dot(up)).normalized()
    R = Matrix(((-fwd).cross(up), -fwd, up)).transposed()
    frame = (head.copy(), R)
    local = [R.transposed() @ (p_ - head) for p_ in head_pts]
    helmet, (c_head, brow_z) = helmet_shell(head_obj, frame, local)
    parts += [helmet] + G.piping(helmet, 0.0065, "bronze")
    crest_arc = helmet_midline(helmet, frame, c_head, brow_z)
    parts.append(tube("crest_holder", [q + nr * 0.01 for q, nr in crest_arc], 0, profile=(0.022, 0.026)))
    parts.append(crest_strands(crest_arc, R.col[0].copy()))
    for o in (trunk_obj, head_obj):
        bpy.data.objects.remove(o, do_unlink=True)

    # --- Shield: dished round aspis with a rolled rim, a boss and a cross in relief, on the left forearm.
    fa, hd = j["LeftForeArm"], j["LeftHand"]
    mid = fa.lerp(hd, 0.45)
    out_n = Vector((0.9, -0.42, 0.06)).normalized()
    R = 0.36
    shield = revolve("shield", [(0.0, 0.035), (0.1, 0.034), (0.25, 0.024), (0.38, 0.008), (R, 0.0), (R + 0.012, -0.004), (R + 0.014, -0.014), (R, -0.02), (0.38, -0.012), (0.0, 0.0)], seg=72, axis_loc=mid + out_n * 0.055, axis=out_n, cap=False)
    boss = revolve("shield_boss", [(0.0, 0.09), (0.035, 0.085), (0.065, 0.06), (0.075, 0.04), (0.09, 0.036), (0.09, 0.03)], seg=36, axis_loc=mid + out_n * 0.055, axis=out_n)
    up = Vector((0, 0, 1))
    up = (up - out_n * up.dot(out_n)).normalized()
    rt = out_n.cross(up)
    cross_parts = []
    for ax in (up, rt):
        arm = solid_box("shield_cross", (0.07, 0.018, 0.68), bevel=0.008, seg=3)
        # local Z (the long side) along `ax`, local Y (the relief) along the shield's normal
        place(arm, mid + out_n * 0.09, out_n.cross(ax), out_n)
        cross_parts.append(arm)
    rivets = []
    for k in range(24):
        a = 2 * math.pi * k / 24
        p_ = mid + out_n * (0.055 + 0.002) + (up * math.cos(a) + rt * math.sin(a)) * (R - 0.035)
        rivets.append(revolve(f"rivet_{k}", [(0.0, 0.012), (0.009, 0.008), (0.011, 0.0)], seg=10, axis_loc=p_, axis=out_n))
    grip = tube("shield_strap", [fa.lerp(hd, 0.15) + out_n * 0.02 - up * 0.03, fa.lerp(hd, 0.15) - out_n * 0.03 - up * 0.02, fa.lerp(hd, 0.15) - out_n * 0.03 + up * 0.03, fa.lerp(hd, 0.15) + out_n * 0.02 + up * 0.03], 0, profile=(0.006, 0.03))
    shield_parts = [shield, boss, grip] + cross_parts + rivets
    for o in shield_parts:
        rigid[o] = "LeftForeArm"
    parts += shield_parts

    # --- Spear: upright in the right fist, the butt on the plinth by the right foot, a leaf blade above the head.
    # The shaft runs through the fist's tunnel: between the knuckles and the curled middle joints, along the knuckle
    # line (the pose stands it upright), down to the plinth.
    fingers = [f for f in ("Index", "Middle", "Ring", "Pinky") if f"RightHand{f}3" in j]
    k1 = sum((j[f"RightHand{f}1"] for f in fingers), Vector()) / len(fingers)
    k3 = sum((j[f"RightHand{f}3"] for f in fingers), Vector()) / len(fingers)
    fist = (k1 + k3) / 2
    axis = (j["RightHandIndex1"] - j["RightHandPinky1"]).normalized()
    if axis.z < 0:
        axis = -axis
    base = fist - axis * (fist.z / axis.z)
    shaft_top = 2.55
    spear = [
        revolve("spear_shaft", [(0.0, 0.0), (0.017, 0.0), (0.016, shaft_top * 0.5), (0.0145, shaft_top), (0.0, shaft_top)], seg=14, axis_loc=base, axis=axis),
        revolve("spear_ferrule", [(0.0, -0.02), (0.02, 0.0), (0.02, 0.1), (0.017, 0.12), (0.0, 0.12)], seg=14, axis_loc=base, axis=axis),
        revolve("spear_socket", [(0.0, shaft_top - 0.05), (0.02, shaft_top - 0.05), (0.018, shaft_top + 0.06), (0.012, shaft_top + 0.1), (0.0, shaft_top + 0.1)], seg=14, axis_loc=base, axis=axis),
    ]
    # the leaf blade, flattened across the figure's front, then stood on the shaft's axis
    blade = revolve("spear_blade", [(0.0, 0.0), (0.012, 0.0), (0.045, 0.08), (0.05, 0.13), (0.035, 0.22), (0.0, 0.34)], seg=4)
    blade.data.transform(Matrix.Diagonal((1, 0.22, 1, 1)))
    blade.data.transform(Matrix.Translation(base + axis * (shaft_top + 0.09)) @ Vector((0, 0, 1)).rotation_difference(axis).to_matrix().to_4x4())
    spear.append(blade)
    for o in spear:
        rigid[o] = "RightHand"
    parts += spear

    # --- Chlamys: a cloak over the shoulders and down the back, pinned at the right shoulder with a round brooch. It
    # starts as a curved sheet around the back (left shoulder -> back -> right shoulder) a little off the body, pinned
    # along the shoulder line, and settles onto the cuirass under gravity.
    sh_l, sh_r = j["LeftArm"], j["RightArm"]
    ctr = (sh_l + sh_r) / 2
    top_z = ctr.z + 0.06
    c_sh, ex_sh, ey_sh = body_extent(trunk + verts, ctr.z - 0.02, band=0.03)
    ra, rb = ex_sh + 0.025, ey_sh + 0.06
    cols, rws = 56, 46
    length = top_z - (j["LeftLeg"].z - 0.05)
    bm = bmesh.new()
    grid = []
    for r in range(rws + 1):
        t = r / rws
        row = []
        for q in range(cols + 1):
            # angle from the left shoulder (+X side, 14 deg) round the back (+Y, 90 deg) to the right shoulder (166 deg):
            # the cloak lies on the shoulders and the back, not out beside the arms
            a = math.radians(14 + 152 * q / cols)
            spread = 1.0 + 0.05 * t  # the cloak widens a little as it falls
            p_ = Vector((c_sh.x + math.cos(a) * ra * spread, c_sh.y + math.sin(a) * rb * spread + 0.03, top_z - t * length))
            row.append(bm.verts.new(p_))
        grid.append(row)
    for r in range(rws):
        for q in range(cols):
            bm.faces.new((grid[r][q], grid[r][q + 1], grid[r + 1][q + 1], grid[r + 1][q]))
    me = bpy.data.meshes.new("cloak")
    bm.to_mesh(me)
    bm.free()
    cloak = bpy.data.objects.new("cloak", me)
    bpy.context.scene.collection.objects.link(cloak)
    G.pin_group(cloak, "pin", lambda co: 1.0 if co.z > top_z - 0.02 else max(0.0, 1.0 - (top_z - 0.02 - co.z) / 0.06))
    G.cloth_settle(cloak, [body, cuirass], pin_group="pin", frames=70, mass=0.6, stiffness=5)
    # sculpted drapery: long vertical folds around the back, deeper and wider toward the hem
    me = cloak.data
    me.calc_normals_split() if hasattr(me, "calc_normals_split") else None
    for v in me.vertices:
        rel = v.co - c_sh
        th = math.atan2(rel.y, rel.x)
        t = max(0.0, min(1.0, (top_z - v.co.z) / length))
        amp = 0.006 + 0.05 * t ** 1.4
        d = 0.65 * math.sin(th * 9 + 0.6) + 0.35 * math.sin(th * 17 + 1.9 + 2.0 * t)
        v.co += v.normal * amp * d
    sd = cloak.modifiers.new("subd", "SUBSURF")
    sd.levels = 1
    so = cloak.modifiers.new("thick", "SOLIDIFY")
    so.thickness = 0.008
    so.offset = -1
    G.apply_all(cloak)
    G.smooth_shade(cloak)
    brooch = revolve("brooch", [(0.0, 0.03), (0.03, 0.024), (0.04, 0.012), (0.042, 0.0)], seg=24, axis_loc=sh_r + Vector((0.02, -0.07, 0.06)), axis=Vector((-0.3, -1, 0.3)))
    parts += [cloak, brooch] + G.piping(cloak, 0.006, "bronze")

    for o in parts:
        o.data.materials.clear()
        mat(o)
    return {"parts": parts, "rigid": rigid}
