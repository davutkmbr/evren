"""
Hezarfen's wind wings: a pair of bird-like wings on light wooden spars, fabric stretched between the spar and a
scalloped trailing edge (feather-like tips over batten "primaries"), stowed in a carved case on the back.

Modelled spread, in the glide pose's frame (arms raised to the sides, hands on the spars; the chord runs down the body). Each wing hangs on its own
bone chain (wing_L_1..3 / wing_R_1..3, under Spine2, the root at the case); the game stows a wing by scaling its root
bone toward the case and deploys it by scaling back to 1 (the fabric unfurls from the case).
Blender axes: +X the character's left, -Y forward, +Z up.
"""
import math

import bmesh
import bpy
from mathutils import Vector

from garments import add_chain, apply_all, chain_weights, material, smooth_shade

SPAN = 1.78  # m, root to tip on each side (outer x)
ROOT_X = 0.12


def spar_point(sg, x, hand_z):
    """
    Leading edge at lateral distance x. The wing spans the body's side axis and its chord runs down the body, toward the
    feet: gliding, the body lies along the flight line, so the chord trails behind and the wing's upper side is the
    back (+Y). Beyond the hands the spar sweeps back (toward the feet) and rises a little (toward +Y, dihedral).
    """
    u = (x - ROOT_X) / (SPAN - ROOT_X)
    y = 0.1 - 0.12 * min(1.0, u / 0.45) + 0.16 * max(0.0, u - 0.45) ** 1.3
    z = hand_z + 0.04 - 0.02 * math.sin(math.pi * min(1.0, u / 0.45)) - 0.3 * max(0.0, u - 0.45) ** 1.3
    return Vector((sg * x, y, z))


def chord(x):
    u = (x - ROOT_X) / (SPAN - ROOT_X)
    return 0.78 * (1 - u) ** 0.8 + 0.2


FEATHERS = 7


def trailing(sg, x, hand_z):
    """Trailing edge: down the body from the spar by the chord, scalloped into feather tips over the outer two thirds."""
    p = spar_point(sg, x, hand_z)
    u = (x - ROOT_X) / (SPAN - ROOT_X)
    scallop = 0.0
    if u > 0.3:
        k = (u - 0.3) / 0.7 * FEATHERS
        scallop = 0.09 * (1 - abs((k % 1.0) * 2 - 1)) ** 1.5 * (0.6 + 0.4 * u)
    return p + Vector((0, 0.05 + 0.04 * u, -(chord(x) + scallop)))


def build(rig, j, cols):
    """Builds both wings and the case; returns (parts, weights) for skinning (weights: part -> fn(co) -> {bone: w})."""
    hand_z = j["LeftArm"].z - 0.07
    parts = []
    weights = {}
    for side, sg in (("L", 1), ("R", -1)):
        # Bones along the spar.
        xs = [ROOT_X, 0.62, 1.16, SPAN]
        names = add_chain(rig, f"wing_{side}", [spar_point(sg, x, hand_z) for x in xs], "mixamorig:Spine2")

        def wfn(co, names=names):
            s = (abs(co.x) - ROOT_X) / (SPAN - ROOT_X)
            return chain_weights(names, s)

        # Membrane: a grid from the spar back to the trailing edge.
        nu, nv = 40, 8
        bm = bmesh.new()
        grid = []
        for i in range(nu + 1):
            x = ROOT_X + (SPAN - ROOT_X) * i / nu
            a = spar_point(sg, x, hand_z)
            b = trailing(sg, x, hand_z)
            row = []
            for k in range(nv + 1):
                t = k / nv
                # A little camber: the fabric bellies upward mid-chord.
                p = a.lerp(b, t) + Vector((0, 0.035 * math.sin(math.pi * t) * (1 - 0.5 * i / nu), 0))
                row.append(bm.verts.new(p))
            grid.append(row)
        for i in range(nu):
            for k in range(nv):
                f = (grid[i][k], grid[i + 1][k], grid[i + 1][k + 1], grid[i][k + 1])
                bm.faces.new(f if sg > 0 else tuple(reversed(f)))
        me = bpy.data.meshes.new(f"wing_membrane_{side}")
        bm.to_mesh(me)
        bm.free()
        mem = bpy.data.objects.new(f"wing_membrane_{side}", me)
        bpy.context.scene.collection.objects.link(mem)
        so = mem.modifiers.new("thick", "SOLIDIFY")
        so.thickness = 0.004
        so.offset = 0
        apply_all(mem)
        smooth_shade(mem)
        material(mem, "rider_wing", cols["wing"], 0.8)
        parts.append(mem)
        weights[mem] = wfn

        # Spar and battens (feather shafts) as thin tubes.
        def tube(name, pts, r0, r1, key):
            cu = bpy.data.curves.new(name, "CURVE")
            cu.dimensions = "3D"
            cu.bevel_depth = 1.0
            cu.bevel_resolution = 2
            cu.use_fill_caps = True
            sp = cu.splines.new("POLY")
            sp.points.add(len(pts) - 1)
            for n_, p in enumerate(pts):
                sp.points[n_].co = (p.x, p.y, p.z, 1.0)
                sp.points[n_].radius = r0 + (r1 - r0) * n_ / max(1, len(pts) - 1)
            co = bpy.data.objects.new(name, cu)
            bpy.context.scene.collection.objects.link(co)
            deps = bpy.context.evaluated_depsgraph_get()
            me2 = bpy.data.meshes.new_from_object(co.evaluated_get(deps))
            mo = bpy.data.objects.new(name, me2)
            bpy.context.scene.collection.objects.link(mo)
            bpy.data.objects.remove(co, do_unlink=True)
            smooth_shade(mo)
            material(mo, "rider_" + key, cols[key], 0.6)
            return mo
        spar = tube(f"wing_spar_{side}", [spar_point(sg, ROOT_X + (SPAN - ROOT_X) * i / 30, hand_z) for i in range(31)], 0.016, 0.007, "darkLeather")
        parts.append(spar)
        weights[spar] = wfn
        for n in range(FEATHERS):
            u = 0.3 + 0.7 * (n + 0.5) / FEATHERS
            x = ROOT_X + (SPAN - ROOT_X) * u
            a = spar_point(sg, x, hand_z)
            b = trailing(sg, x + 0.02 * sg * 0, hand_z)
            bat = tube(f"wing_batten_{side}{n}", [a.lerp(b, t / 8) + Vector((0, 0.004, 0)) for t in range(9)], 0.006, 0.0025, "darkLeather")
            parts.append(bat)
            weights[bat] = wfn
        # Leather grip where the hand holds the spar, gilt ferrules at its ends.
        hx = abs(j["LeftArm"].x) + 0.54
        grip = tube(f"wing_grip_{side}", [spar_point(sg, hx + d, hand_z) for d in (-0.07, -0.03, 0.0, 0.03, 0.07)], 0.02, 0.02, "leather")
        parts.append(grip)
        weights[grip] = wfn
        for d in (-0.075, 0.075):
            p = spar_point(sg, hx + d, hand_z)
            bpy.ops.mesh.primitive_torus_add(major_radius=0.021, minor_radius=0.005, major_segments=20, minor_segments=8, location=p, rotation=(0, math.radians(90), 0))
            fe = bpy.context.active_object
            fe.name = f"wing_ferrule_{side}"
            smooth_shade(fe)
            material(fe, "rider_metal", cols["metal"], 0.35, 1.0)
            parts.append(fe)
            weights[fe] = wfn
    # The case on the back: carved wood, leather straps, gilt caps; the wings furl into it.
    top = Vector((0, 0.19, hand_z + 0.06))
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.075, depth=0.46, location=top - Vector((0, 0, 0.21)))
    case = bpy.context.active_object
    case.name = "wing_case"
    smooth_shade(case)
    material(case, "rider_darkLeather", cols["darkLeather"], 0.6)
    parts.append(case)
    for dz in (0.02, -0.44):
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.082, depth=0.03, location=top + Vector((0, 0, dz)))
        cap = bpy.context.active_object
        cap.name = "wing_case_cap"
        smooth_shade(cap)
        material(cap, "rider_metal", cols["metal"], 0.35, 1.0)
        parts.append(cap)
    for p in parts:
        if p.name.startswith("wing_case"):
            weights[p] = lambda co: {"Spine2": 1.0}
    return parts, weights
