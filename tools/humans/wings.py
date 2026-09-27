"""
Hezarfen's wind wings, after the 17th-century flight of Hezarfen Ahmed Çelebi: a pair of articulated wooden wings
on a back harness. Each wing is a jointed spar (shoulder, grip, wrist: the hands hold it at the grip), six ribs fanning
back from it and waxed canvas stretched between them, its edge scalloped between the rib tips (bat-like, so a rib
carries each lobe), a painted crimson border, brass fittings at the joints, leather straps at the grip.

Modelled spread, in the glide pose's frame (body upright here, arms out to the sides; the chord runs down the body, so
gliding with the body along the flight line the canvas trails behind). Bones (under Spine2):
  wing_<S>_1  root → grip        wing_<S>_2  grip → wrist        wing_<S>_3  wrist → tip
  wing_<S>_r0..r5  one per rib, from its hinge on the spar to its tip (children of the spar bone they hinge on)
The game folds the spar and closes the fan of ribs onto the back (the canvas gathers between them), opens it to glide
and flaps it (src/dragon/model/rider/human.ts, Wings). Blender axes: +X the character's left, -Y forward, +Z up.
"""
import math

import bmesh
import bpy
from mathutils import Vector

from garments import apply_all, material, smooth_shade

# Spar stations along the span (m from the spine, outward): root, grip (the hand), wrist, tip.
STATIONS = (0.13, 0.78, 1.32, 2.05)
# Ribs: (hinge station index, hinge fraction along the next segment, length (m), sweep (rad back from straight down,
# toward the tip)). The last rib is the leading spar's own tip lobe.
RIBS = (
    (0, 0.0, 0.78, 0.02),
    (0, 0.6, 0.86, 0.2),
    (1, 0.3, 0.9, 0.42),
    (2, 0.0, 0.9, 0.7),
    (2, 0.5, 0.8, 0.98),
    (2, 1.0, 0.6, 1.28),
)
SAG = 0.12  # scallop depth between rib tips (fraction of their distance)


def spar(sg, x, hand_z):
    """Point on the leading spar at lateral distance x: a gentle dihedral and sweep beyond the wrist."""
    u = max(0.0, x - STATIONS[2]) / (STATIONS[3] - STATIONS[2])
    y = 0.14 - 0.1 * min(1.0, x / STATIONS[1]) + 0.12 * u * u
    z = hand_z + 0.03 + 0.12 * u * u
    return Vector((sg * x, y, z))


def station(sg, i, hand_z):
    return spar(sg, STATIONS[i], hand_z)


def hinge(sg, rib, hand_z):
    i, f, _len, _sweep = rib
    if i >= len(STATIONS) - 1:
        return station(sg, i, hand_z)
    x = STATIONS[i] + (STATIONS[i + 1] - STATIONS[i]) * f
    return spar(sg, x, hand_z)


def rib_tip(sg, rib, hand_z):
    """Rib tip: down the body from the hinge, swept outward by `sweep`, a little behind the spar (camber)."""
    _i, _f, length, sweep = rib
    h = hinge(sg, rib, hand_z)
    d = Vector((sg * math.sin(sweep), 0.06, -math.cos(sweep))).normalized()
    return h + d * length


def _edit_bone(rig, name, head, tail, parent, connect=False):
    eb = rig.data.edit_bones.new(name)
    eb.head, eb.tail = head, tail
    eb.parent = rig.data.edit_bones[parent]
    eb.use_connect = connect
    eb.use_deform = True
    return eb


def _tube(name, pts, r0, r1, key, cols, rough=0.6, metal=0.0):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 1.0
    cu.bevel_resolution = 2
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for n, p in enumerate(pts):
        sp.points[n].co = (p.x, p.y, p.z, 1.0)
        sp.points[n].radius = r0 + (r1 - r0) * n / max(1, len(pts) - 1)
    co = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(co)
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(co.evaluated_get(deps))
    mo = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(mo)
    bpy.data.objects.remove(co, do_unlink=True)
    smooth_shade(mo)
    material(mo, "rider_" + key, cols[key], rough, metal)
    return mo


def build(rig, j, cols):
    """Builds both wings; returns (parts, weights) for skinning (weights: part -> fn(world co) -> {bone: w})."""
    hand_z = j["LeftArm"].z - 0.07
    parts = []
    weights = {}
    for side, sg in (("L", 1), ("R", -1)):
        # --- Bones.
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = rig
        rig.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        inv = rig.matrix_world.inverted()
        spar_bones = []
        parent = "mixamorig:Spine2"
        for k in range(3):
            nm = f"wing_{side}_{k + 1}"
            _edit_bone(rig, nm, inv @ station(sg, k, hand_z), inv @ station(sg, k + 1, hand_z), parent, connect=k > 0)
            spar_bones.append(nm)
            parent = nm
        rib_bones = []
        for n, rib in enumerate(RIBS):
            seg = min(rib[0], 2)
            nm = f"wing_{side}_r{n}"
            _edit_bone(rig, nm, inv @ hinge(sg, rib, hand_z), inv @ rib_tip(sg, rib, hand_z), spar_bones[seg])
            rib_bones.append(nm)
        bpy.ops.object.mode_set(mode="OBJECT")

        def spar_weights(x, spar_bones=spar_bones):
            # Along the spar: each segment's bone, blended over a short span at the joints.
            ws = {}
            for k in range(3):
                a, b = STATIONS[k], STATIONS[k + 1]
                w = 1.0 if a <= x <= b else max(0.0, 1.0 - min(abs(x - a), abs(x - b)) / 0.06)
                if w > 0:
                    ws[spar_bones[k]] = w
            return ws or {spar_bones[0]: 1.0}

        # --- Canvas: a patch between each pair of neighbouring ribs, scalloped between their tips.
        nu, nv = 10, 12
        bm = bmesh.new()
        vert_w = {}
        for r in range(len(RIBS) - 1):
            ra, rb = RIBS[r], RIBS[r + 1]
            ha, hb = hinge(sg, ra, hand_z), hinge(sg, rb, hand_z)
            ta, tb = rib_tip(sg, ra, hand_z), rib_tip(sg, rb, hand_z)
            grid = []
            for i in range(nu + 1):
                u = i / nu
                lead = spar(sg, abs(ha.x) + (abs(hb.x) - abs(ha.x)) * u, hand_z)
                trail = ta.lerp(tb, u)
                # The scallop: the edge pulls in toward the spar between the tips.
                trail = trail.lerp(lead, SAG * math.sin(math.pi * u))
                row = []
                for k in range(nv + 1):
                    v = k / nv
                    p = lead.lerp(trail, v)
                    # Camber: the canvas bellies behind (toward +Y) between spar and edge, and between the ribs.
                    p.y += 0.05 * math.sin(math.pi * v) * (0.4 + 0.6 * math.sin(math.pi * u))
                    vt = bm.verts.new(p)
                    # Weights: the two ribs by position across the patch, the spar near the leading edge.
                    ws = {rib_bones[r]: (1 - u) * v, rib_bones[r + 1]: u * v}
                    for bn, w in spar_weights(abs(lead.x)).items():
                        ws[bn] = ws.get(bn, 0.0) + w * (1 - v)
                    vert_w[vt] = ws
                    row.append(vt)
                grid.append(row)
            for i in range(nu):
                for k in range(nv):
                    f = (grid[i][k], grid[i + 1][k], grid[i + 1][k + 1], grid[i][k + 1])
                    bm.faces.new(f if sg > 0 else tuple(reversed(f)))
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
        me = bpy.data.meshes.new(f"wing_canvas_{side}")
        bm.verts.index_update()
        wlist = [(v.co.copy(), vert_w.get(v)) for v in bm.verts]
        bm.to_mesh(me)
        bm.free()
        canvas = bpy.data.objects.new(f"wing_canvas_{side}", me)
        bpy.context.scene.collection.objects.link(canvas)
        so = canvas.modifiers.new("thick", "SOLIDIFY")
        so.thickness = 0.004
        so.offset = 0
        apply_all(canvas)
        smooth_shade(canvas)
        material(canvas, "rider_wing", cols["wing"], 0.8)
        parts.append(canvas)

        # Skin weights by nearest authored point (solidify duplicated the surface).
        from mathutils.kdtree import KDTree
        tree = KDTree(len(wlist))
        for n, (co, _w) in enumerate(wlist):
            tree.insert(co, n)
        tree.balance()

        def canvas_weights(co, tree=tree, wlist=wlist):
            _c, n, _d = tree.find(co)
            ws = wlist[n][1]
            return ws if ws else {spar_bones[0]: 1.0}
        weights[canvas] = canvas_weights

        # --- Painted border along the scalloped edge (crimson) and along the spar (the canvas' hem).
        edge = []
        for r in range(len(RIBS) - 1):
            ta, tb = rib_tip(sg, RIBS[r], hand_z), rib_tip(sg, RIBS[r + 1], hand_z)
            ha, hb = hinge(sg, RIBS[r], hand_z), hinge(sg, RIBS[r + 1], hand_z)
            for i in range(8):
                u = i / 8
                lead = spar(sg, abs(ha.x) + (abs(hb.x) - abs(ha.x)) * u, hand_z)
                edge.append(ta.lerp(tb, u).lerp(lead, SAG * math.sin(math.pi * u)) + Vector((0, 0.004, 0)))
        edge.append(rib_tip(sg, RIBS[-1], hand_z))
        border = _tube(f"wing_border_{side}", edge, 0.007, 0.007, "primary", cols)
        parts.append(border)
        weights[border] = canvas_weights

        # --- Wood: the spar (thick at the root, tapering), the ribs; brass fittings at the joints; leather grip.
        spar_pts = [spar(sg, STATIONS[0] + (STATIONS[3] - STATIONS[0]) * t / 40, hand_z) for t in range(41)]
        sp = _tube(f"wing_spar_{side}", spar_pts, 0.022, 0.008, "wood", cols, 0.55)
        parts.append(sp)
        weights[sp] = lambda co, sw=spar_weights: sw(abs(co.x))
        for n, rib in enumerate(RIBS):
            a, b = hinge(sg, rib, hand_z), rib_tip(sg, rib, hand_z)
            rb = _tube(f"wing_rib_{side}{n}", [a.lerp(b, t / 10) + Vector((0, 0.006, 0)) for t in range(11)], 0.011, 0.004, "wood", cols, 0.55)
            parts.append(rb)
            weights[rb] = lambda co, nm=rib_bones[n]: {nm: 1.0}
        for k in (1, 2):
            p = station(sg, k, hand_z)
            bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.03, location=p)
            fit = bpy.context.active_object
            fit.name = f"wing_fitting_{side}{k}"
            smooth_shade(fit)
            material(fit, "rider_metal", cols["metal"], 0.35, 1.0)
            parts.append(fit)
            weights[fit] = lambda co, nm=spar_bones[k - 1]: {nm: 1.0}
        g = station(sg, 1, hand_z)
        grip = _tube(f"wing_grip_{side}", [spar(sg, abs(g.x) + d, hand_z) for d in (-0.1, -0.05, 0.0, 0.05, 0.1)], 0.027, 0.027, "leather", cols)
        parts.append(grip)
        weights[grip] = lambda co, nm=spar_bones[0], nm2=spar_bones[1]: {nm: 0.5, nm2: 0.5}
    # The harness plate on the back where the wings hinge: a brass boss on a leather pad.
    back = Vector((0, j["Spine2"].y + 0.16, hand_z + 0.03))
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.1, depth=0.03, location=back, rotation=(math.radians(90), 0, 0))
    pad = bpy.context.active_object
    pad.name = "wing_harness"
    smooth_shade(pad)
    material(pad, "rider_darkLeather", cols["darkLeather"], 0.6)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.04, location=back + Vector((0, 0.02, 0)))
    boss = bpy.context.active_object
    boss.name = "wing_harness_boss"
    smooth_shade(boss)
    material(boss, "rider_metal", cols["metal"], 0.35, 1.0)
    for o in (pad, boss):
        parts.append(o)
        weights[o] = lambda co: {"Spine2": 1.0}
    return parts, weights
