"""
The Aya Yorgi knight statue (moment 'aya-yorgi-challenge'): a bronze statue of a Byzantine-style soldier saint on a
limestone plinth, built from the rider's CC0 MakeHuman body (public/models/rider/akinci.glb) and exported as
public/models/moments/aya-yorgi-statue.glb. Everything is generated; nothing is edited by hand.

    node scripts/blender-run.mjs tools/moments/knight_statue.py -- <out.glb | -> [preview-dir]

Stages: the body is posed (contrapposto, spear upright in the right hand, shield on the left forearm) and the pose
becomes the rest pose; the armour and clothes are grown from the posed body (tools/humans/garments.py); the props are
modelled; one bronze material (verdigris in the hollows, rain streaks, worn bright on the edges) is baked into an
albedo / roughness / metallic / normal atlas; the plinth gets its own limestone set. The skeleton keeps only the bones
the game animates (./src/moments/aya-yorgi/pose.ts).

Blender axes: +X the figure's left, -Y forward, +Z up (metres, figure scale 1; the game scales the figure).
"""
import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.environ.get("EVREN_ROOT", os.getcwd())
sys.path.insert(0, os.path.join(ROOT, "tools", "humans"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import garments as G  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGS[0] if ARGS else "-"
PREVIEW = ARGS[1] if len(ARGS) > 1 else os.path.join(ROOT, ".shots", "moments", "aya-yorgi", "blender")
STAGE = os.environ.get("STATUE_STAGE", "all")
SRC = os.path.join(ROOT, "public", "models", "rider", "akinci.glb")


def log(*a):
    print("[statue]", *a, flush=True)


# ------------------------------------------------------------------ body


def load_body():
    """A full heroic MakeHuman body (MPFB 2, the approved CC0 system assets), the mixamo rig and the eyes; no hair."""
    from mpfb import enable_mpfb, mpfb

    enable_mpfb()
    HumanService = mpfb("mpfb.services.humanservice", "HumanService")
    AssetService = mpfb("mpfb.services.assetservice", "AssetService")
    TargetService = mpfb("mpfb.services.targetservice", "TargetService")
    targets = mpfb("mpfb.services.locationservice", "LocationService").get_mpfb_data("targets")
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    body = HumanService.create_human(macro_detail_dict=PHENOTYPE)
    for rel, w in FACE:
        path = os.path.join(targets, rel + ".target.gz")
        if os.path.exists(path):
            TargetService.load_target(body, path, weight=w)
        else:
            log("MISSING TARGET", rel)
    rig = HumanService.add_builtin_rig(body, "mixamo")
    bpy.context.view_layer.update()
    path = AssetService.find_asset_absolute_path("high-poly.mhclo", asset_subdir="eyes")
    HumanService.add_mhclo_asset(path, body, asset_type="Eyes", subdiv_levels=0, material_type="MAKESKIN")
    for o in bpy.data.objects:
        if o.type == "MESH":
            bpy.context.view_layer.objects.active = o
            if o.data.shape_keys:
                bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
            for m in list(o.modifiers):
                if m.type == "MASK":
                    bpy.ops.object.modifier_apply(modifier=m.name)
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    bpy.context.view_layer.update()
    return rig, body


# A young soldier saint of the icons: tall, athletic, idealised (a statue's canon), a calm strong face.
PHENOTYPE = {
    "gender": 1.0, "age": 0.45, "muscle": 0.8, "weight": 0.5, "height": 0.7, "proportions": 1.0,
    "cupsize": 0.5, "firmness": 0.5,
    "race": {"caucasian": 0.75, "asian": 0.1, "african": 0.15},
}
FACE = [
    ("chin/chin-prominent-incr", 0.3), ("chin/chin-width-incr", 0.2), ("cheek/l-cheek-bones-incr", 0.35),
    ("cheek/r-cheek-bones-incr", 0.35), ("nose/nose-hump-decr", 0.2), ("nose/nose-width1-decr", 0.25),
    ("eyebrows/eyebrows-trans-down", 0.3), ("head/head-oval", 0.2),
]


def bone_head(rig, name):
    return rig.matrix_world @ rig.pose.bones["mixamorig:" + name].head


def empty(name, loc):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
    return e


# The statue's pose (figure's left +X, forward -Y, up +Z; metres at scale 1). IK targets are offsets from a rest-pose
# bone head, so they follow the body's proportions. Contrapposto: the weight on the right leg (straight), the left knee
# eased forward; the spear forearm forward at the waist, the fist round the upright shaft (the spear stands on the
# plinth), the shield forearm across the body at waist height; chest up, the head turned a little toward the shield
# side.
SPINE = {"Spine": (-2, 0, -3), "Spine1": (-3, 0, -3), "Spine2": (-2, 0, -2), "Neck": (4, 0, 5), "Head": (-3, 0, 9)}
HIPS = (0, -3, 2)
POSE_IK = {
    # bone: (reference bone, target offset, pole offset from the same reference)
    "RightForeArm": ("RightArm", (-0.06, -0.25, -0.33), (-0.1, 0.6, -0.8)),
    "LeftForeArm": ("LeftArm", (0.06, -0.26, -0.36), (0.6, 0.5, -0.3)),
    "RightLeg": ("RightFoot", (0.07, 0.0, 0.0), (0.0, -1.0, 0.5)),
    "LeftLeg": ("LeftFoot", (-0.03, -0.18, 0.04), (0.1, -1.0, 0.5)),
}


# The spear's axis through the right fist (leaning a little forward) and the finger curls, (x, y, z) degrees per joint.
GRIP_AXIS = Vector((0.0, -0.06, 1.0)).normalized()
CURL = {
    "Index": ((0, 0, 62), (0, 0, 80), (0, 0, 45)), "Middle": ((0, 0, 66), (0, 0, 82), (0, 0, 45)),
    "Ring": ((0, 0, 70), (0, 0, 80), (0, 0, 45)), "Pinky": ((0, 0, 74), (0, 0, 76), (0, 0, 42)),
    "Thumb": ((0, -55, 25), (0, 0, 45), (0, 0, 40)),
}


def pose_body(rig, body):
    from mathutils import Euler, Matrix

    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    rest = {n: bone_head(rig, n) for n in ("RightArm", "LeftArm", "RightFoot", "LeftFoot")}
    for name, (x, y, z) in SPINE.items():
        pb = rig.pose.bones["mixamorig:" + name]
        pb.rotation_quaternion = Euler((math.radians(x), math.radians(y), math.radians(z)), "XYZ").to_quaternion()
    rig.pose.bones["mixamorig:Hips"].rotation_quaternion = Euler([math.radians(a) for a in HIPS], "XYZ").to_quaternion()
    bpy.context.view_layer.update()
    helpers = []
    for bone, (ref, tgt, pole) in POSE_IK.items():
        base = rest[ref]
        if "Arm" in ref:
            base = bone_head(rig, ref)  # the shoulder after the spine's pose
        t = empty("ik_" + bone, base + Vector(tgt))
        p = empty("pole_" + bone, base + Vector(pole))
        helpers += [t, p]
        c = rig.pose.bones["mixamorig:" + bone].constraints.new("IK")
        c.target = t
        c.pole_target = p
        c.pole_angle = math.radians(-90 if "Arm" in bone else 90)
        c.chain_count = 2
    bpy.context.view_layer.update()
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.visual_transform_apply()
    for pb in rig.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
    for h in helpers:
        bpy.data.objects.remove(h, do_unlink=True)
    # The right wrist turns so the knuckle line (pinky -> index) stands along the spear: the fist's tunnel is upright.
    bpy.context.view_layer.update()
    hand = rig.pose.bones["mixamorig:RightHand"]
    knuckles = bone_head(rig, "RightHandIndex1") - bone_head(rig, "RightHandPinky1")
    inv = rig.matrix_world.inverted().to_3x3()
    turn = (inv @ knuckles).normalized().rotation_difference((inv @ GRIP_AXIS).normalized()).to_matrix().to_4x4()
    h = hand.head.copy()
    hand.matrix = Matrix.Translation(h) @ turn @ Matrix.Translation(-h) @ hand.matrix
    bpy.context.view_layer.update()
    # Hands: the fingers curl about the bones' local Z on this rig (the palm side); the right fist closes round the
    # shaft with the thumb over the fingers, the left grips the shield's strap.
    for side in ("Left", "Right"):
        for finger, angles in CURL.items():
            for k, a in enumerate(angles):
                pb = rig.pose.bones.get(f"mixamorig:{side}Hand{finger}{k + 1}")
                if pb:
                    pb.rotation_quaternion = Euler([math.radians(d) for d in a], "XYZ").to_quaternion()
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()


def apply_pose_as_rest(rig, meshes):
    """Bakes the posed mesh and makes the pose the rig's rest pose, so garments grow on the statue's pose."""
    for m in meshes:
        bpy.context.view_layer.objects.active = m
        for mod in list(m.modifiers):
            if mod.type == "ARMATURE":
                bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    for m in meshes:
        mod = m.modifiers.new("Armature", "ARMATURE")
        mod.object = rig


# ------------------------------------------------------------------ preview


def preview(tag, views=("front", "side", "three"), res=900, focus=None):
    os.makedirs(PREVIEW, exist_ok=True)
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_WORKBENCH"
    scn.display.shading.light = "STUDIO"
    scn.display.shading.color_type = "MATERIAL"
    scn.display.shading.show_cavity = True
    scn.display.shading.cavity_type = "BOTH"
    scn.render.resolution_x = res
    scn.render.resolution_y = int(res * 1.25)
    objs = [o for o in bpy.data.objects if o.type == "MESH" and o.visible_get()]
    lo = Vector((min((o.matrix_world @ Vector(c)).x for o in objs for c in o.bound_box), min((o.matrix_world @ Vector(c)).y for o in objs for c in o.bound_box), min((o.matrix_world @ Vector(c)).z for o in objs for c in o.bound_box)))
    hi = Vector((max((o.matrix_world @ Vector(c)).x for o in objs for c in o.bound_box), max((o.matrix_world @ Vector(c)).y for o in objs for c in o.bound_box), max((o.matrix_world @ Vector(c)).z for o in objs for c in o.bound_box)))
    ctr = (lo + hi) / 2
    size = max(hi - lo) * 1.15
    if focus:
        ctr, size = Vector(focus[0]), focus[1]
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size
    cam = bpy.data.objects.new("cam", cam_data)
    scn.collection.objects.link(cam)
    scn.camera = cam
    dirs = {"front": Vector((0, -1, 0)), "side": Vector((1, 0, 0)), "three": Vector((0.7, -0.7, 0.25)).normalized(), "back": Vector((0, 1, 0))}
    for v in views:
        d = dirs[v]
        cam.location = ctr + d * size * 3
        cam.rotation_euler = (d * -1).to_track_quat("-Z", "Y").to_euler()
        scn.render.filepath = os.path.join(PREVIEW, f"{tag}{v}.png")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    log("preview", tag, PREVIEW)


# ------------------------------------------------------------------ main

rig, body = load_body()
log("body", body.name, len(body.data.vertices), "verts")
pose_body(rig, body)
if STAGE == "pose":
    preview("pose-")
    _hand = rig.matrix_world @ rig.pose.bones["mixamorig:RightHand"].tail
    preview("hand-", views=("front", "side", "three"), res=600, focus=(_hand, 0.3))
    sys.exit(0)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
apply_pose_as_rest(rig, meshes)
import knight_outfit  # noqa: E402

OUTFIT = knight_outfit.build(rig, body)
log("outfit", len(OUTFIT["parts"]), "parts")
preview("outfit-", views=("front", "side", "three", "back"))
_h = rig.matrix_world @ rig.pose.bones["mixamorig:Head"].head
_c = rig.matrix_world @ rig.pose.bones["mixamorig:Spine1"].head
preview("head-", views=("front", "three"), res=700, focus=(_h + Vector((0, 0, 0.1)), 0.45))
preview("torso-", views=("front", "three"), res=700, focus=(_c, 0.9))
if STAGE == "outfit":
    sys.exit(0)

# ------------------------------------------------------------------ skin, join, plinth, bake

import statue_materials as SM  # noqa: E402

PLINTH_H = 0.76  # figure units; the game's PLINTH_H / FIGURE_SCALE
FOUNDATION = 0.85  # figure units buried below the plinth's foot (the game's FOUNDATION_DEPTH / FIGURE_SCALE)


def build_plinth():
    """Stepped limestone plinth under the figure (top at z = 0): foundation, a step, the die with base and cap
    mouldings, the top slab; the inscription in bronze letters on the front."""
    import bmesh

    def slab(name, w, z0, z1, bevel=0.012, seg=3):
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        o = bpy.context.active_object
        o.name = name
        o.scale = (w, w, z1 - z0)
        o.location = (0, 0, (z0 + z1) / 2)
        bpy.ops.object.transform_apply(location=True, scale=True)
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = seg
        G.apply_all(o)
        return o

    z = -PLINTH_H
    parts = [
        slab("plinth_foundation", 1.52, z - FOUNDATION, z + 0.1, 0.02, 2),  # buried below the foot on a slope
        slab("plinth_step", 1.36, z + 0.1, z + 0.18),
        slab("plinth_base_moulding", 1.2, z + 0.18, z + 0.24, 0.025, 4),
        slab("plinth_die", 1.08, z + 0.24, z + 0.62, 0.008),
        slab("plinth_cap_moulding", 1.2, z + 0.62, z + 0.68, 0.025, 4),
        slab("plinth_top", 1.26, z + 0.68, 0.0),
    ]
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    plinth = bpy.context.active_object
    plinth.name = "plinth"
    plinth.data.name = "plinth"
    # a little irregularity: the blocks are hand-dressed, not machined
    me = plinth.data
    import random
    rnd = random.Random(7)
    for v in me.vertices:
        v.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * 0.0015
    G.smooth_shade(plinth)
    # inscription on the front of the die
    bpy.ops.object.text_add(location=(0, -0.54 - 0.004, z + 0.43), rotation=(math.radians(90), 0, 0))
    t = bpy.context.active_object
    t.data.body = "Ο ΑΓΙΟΣ ΓΕΩΡΓΙΟΣ"
    t.data.align_x = "CENTER"
    t.data.align_y = "CENTER"
    t.data.size = 0.075
    t.data.extrude = 0.004
    t.data.bevel_depth = 0.0012
    t.data.space_character = 1.15
    bpy.ops.object.convert(target="MESH")
    t.name = "inscription"
    return plinth, t


def skin_parts(rig, body, outfit):
    for o in outfit["parts"]:
        bone = outfit["rigid"].get(o)
        if bone:
            G.skin(o, body, rig, weights=lambda co, b=bone: {b: 1.0})
        else:
            G.skin(o, body, rig)


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    return o


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def beauty(tag, focus=None, res=(1000, 1250)):
    """Cycles render under the approved CC0 clear-sky HDRI with a low sun: how the bronze reads in daylight."""
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    SM.use_gpu(scn)
    scn.cycles.samples = 96
    scn.view_settings.exposure = -0.7  # a clear noon sky: keep the stone's value readable
    scn.render.resolution_x, scn.render.resolution_y = res
    w = bpy.data.worlds.new("sky")
    w.use_nodes = True
    nt = w.node_tree
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    hdr = os.path.join(ROOT, "..", "..", "..", "assets-src", "hdri", "kloofendal_43d_clear_puresky")
    hdr_dir = hdr if os.path.isdir(hdr) else "/Users/davut/Code/davutkmbr/ejderha-istanbul/assets-src/hdri/kloofendal_43d_clear_puresky"
    f = next((x for x in os.listdir(hdr_dir) if x.endswith((".hdr", ".exr"))), None)
    env.image = bpy.data.images.load(os.path.join(hdr_dir, f))
    nt.links.new(env.outputs[0], nt.nodes["Background"].inputs[0])
    scn.world = w
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4.0
    sun.data.angle = math.radians(1.0)
    sun.rotation_euler = (math.radians(55), 0, math.radians(35))
    scn.collection.objects.link(sun)
    ground = bpy.data.objects.new("ground", bpy.data.meshes.new("ground"))
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=12)
    bm.to_mesh(ground.data)
    bm.free()
    ground.location.z = -PLINTH_H
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.25, 0.23, 0.18, 1)
    ground.data.materials.append(gm)
    scn.collection.objects.link(ground)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 50
    scn.collection.objects.link(cam)
    scn.camera = cam
    shots = focus or {
        "full": (Vector((1.9, -4.6, 0.7)), Vector((0, 0, 0.55))),
        "bust": (Vector((0.55, -1.25, 1.75)), Vector((0.02, 0, 1.55))),
        "low": (Vector((-1.2, -2.6, -0.3)), Vector((0, 0, 1.1))),
    }
    os.makedirs(PREVIEW, exist_ok=True)
    for k, (loc, at) in shots.items():
        cam.location = loc
        cam.rotation_euler = (at - loc).to_track_quat("-Z", "Y").to_euler()
        scn.render.filepath = os.path.join(PREVIEW, f"{tag}{k}.png")
        bpy.ops.render.render(write_still=True)
    for o in (sun, ground, cam):
        bpy.data.objects.remove(o, do_unlink=True)
    log("beauty", tag)


skin_parts(rig, body, OUTFIT)
statue_objs = [body] + [o for o in bpy.data.objects if o.type == "MESH" and o is not body]
plinth, letters = build_plinth()
G.skin(letters, body, rig, weights=lambda co: {"Hips": 1.0})
statue_objs = [o for o in statue_objs if o not in (plinth,)] + [letters]
SM.tag_parts(statue_objs)
statue = join(statue_objs, "statue")
log("statue", tris(statue), "tris before decimation")
MAX_TRIS = int(os.environ.get("STATUE_TRIS", "160000"))
if tris(statue) > MAX_TRIS:
    d = statue.modifiers.new("decimate", "DECIMATE")
    d.ratio = MAX_TRIS / tris(statue)
    bpy.context.view_layer.objects.active = statue
    bpy.ops.object.modifier_move_to_index(modifier="decimate", index=0)
    bpy.ops.object.modifier_apply(modifier="decimate")
log("statue", tris(statue), "tris")
SM.unwrap(statue)
SM.tag_parts([plinth])
SM.unwrap(plinth, margin=0.004)
SIZE = int(os.environ.get("STATUE_TEX", "4096"))
bm_mat, bm_h = SM.bronze_material()
bronze_imgs = SM.bake(statue, bm_mat, bm_h, SIZE, "statue_bronze", samples=int(os.environ.get("STATUE_SAMPLES", "16")))
st_mat, st_h = SM.stone_material()
stone_imgs = SM.bake(plinth, st_mat, st_h, SIZE // 2, "statue_stone", samples=int(os.environ.get("STATUE_SAMPLES", "16")))
SM.save_images(bronze_imgs, os.path.join(PREVIEW, "maps"))
SM.save_images(stone_imgs, os.path.join(PREVIEW, "maps"))
statue.data.materials.clear()
statue.data.materials.append(SM.export_material("statue_bronze", bronze_imgs))
plinth.data.materials.clear()
plinth.data.materials.append(SM.export_material("statue_stone", stone_imgs))
log("baked")
beauty("beauty-")
if OUT == "-":
    sys.exit(0)

# Origin at the foot of the plinth.
for o in (rig, plinth):
    o.location.z += PLINTH_H
bpy.ops.object.select_all(action="DESELECT")
for o in (rig, statue, plinth):
    o.select_set(True)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_skins=True, export_animations=False,
                          export_morph=False, export_apply=False, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                          export_yup=True, export_image_format="WEBP", export_image_quality=88, export_attributes=False)
log("EXPORTED", OUT, os.path.getsize(OUT))
