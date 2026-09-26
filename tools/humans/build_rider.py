"""
Builds a rider human with MPFB 2 from the approved CC0 MakeHuman assets, poses it in the riding pose, applies that
pose as the rest pose and exports a glTF binary (mesh, skin weights, mixamo-named skeleton, textures).

  node scripts/blender-run.mjs --no-slot tools/humans/build_rider.py -- <out.glb> [preview-dir]
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
from mpfb import args, enable_mpfb, mpfb  # noqa: E402

enable_mpfb()
HumanService = mpfb("mpfb.services.humanservice", "HumanService")
AssetService = mpfb("mpfb.services.assetservice", "AssetService")
TargetService = mpfb("mpfb.services.targetservice", "TargetService")

OUT = args()[0] if args() else "/tmp/rider.glb"
PREVIEW = args()[1] if len(args()) > 1 else None

# Heroic male: idealised proportions, muscular, tall, about 35; Anatolian / Central Asian mix.
PHENOTYPE = {
    "gender": 1.0, "age": 0.56, "muscle": 0.78, "weight": 0.56, "height": 0.66, "proportions": 1.0,
    "cupsize": 0.5, "firmness": 0.5,
    "race": {"caucasian": 0.6, "asian": 0.28, "african": 0.12},
}

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

basemesh = HumanService.create_human(macro_detail_dict=PHENOTYPE)

# Face: a stronger jaw and chin, higher cheekbones, a straight nose, a firmer brow.
targets = mpfb("mpfb.services.locationservice", "LocationService").get_mpfb_data("targets")
FACE = [
    ("chin/chin-prominent-incr", 0.35), ("chin/chin-width-incr", 0.3), ("chin/chin-height-decr", 0.15),
    ("cheek/l-cheek-bones-incr", 0.4), ("cheek/r-cheek-bones-incr", 0.4),
    ("cheek/l-cheek-inner-decr", 0.3), ("cheek/r-cheek-inner-decr", 0.3),
    ("nose/nose-hump-incr", 0.25), ("nose/nose-width1-decr", 0.2),
    ("eyebrows/eyebrows-trans-down", 0.35), ("eyebrows/eyebrows-angle-down", 0.2),
    ("mouth/mouth-scale-horiz-incr", 0.1),
    ("head/head-square", 0.25),
]
for rel, w in FACE:
    path = os.path.join(targets, rel + ".target.gz")
    if os.path.exists(path):
        TargetService.load_target(basemesh, path, weight=w)
    else:
        print("MISSING TARGET", rel)

rig = HumanService.add_builtin_rig(basemesh, "mixamo")
bpy.context.view_layer.update()

# Assets after the rig, so MPFB transfers the body's skin weights onto them.
def asset(subdir, fname, atype):
    path = AssetService.find_asset_absolute_path(fname, asset_subdir=subdir)
    if path is None:
        raise RuntimeError(f"asset not found: {subdir}/{fname}")
    return HumanService.add_mhclo_asset(path, basemesh, asset_type=atype, subdiv_levels=0, material_type="MAKESKIN")

HAIR = os.environ.get("RIDER_HAIR", "")
for sub, f, t in [("eyes", "high-poly.mhclo", "Eyes"), ("eyebrows", "eyebrow008.mhclo", "Eyebrows"), ("eyelashes", "eyelashes01.mhclo", "Eyelashes"),
                  ("teeth", "teeth_base.mhclo", "Teeth"), ("tongue", "tongue01.mhclo", "Tongue")] + ([("hair", HAIR + ".mhclo", "Hair")] if HAIR else []):
    asset(sub, f, t)
skin = AssetService.find_asset_absolute_path("middleage_caucasian_male.mhmat", asset_subdir="skins")
HumanService.set_character_skin(skin, basemesh, skin_type="MAKESKIN")



# --- Riding pose. The spine leans forward a little; arms and legs are solved with Blender's IK toward the reins and
# the stirrups (positions relative to the hips, Blender axes: +X the rider's left, -Y forward, +Z up), then baked.
SPINE = {"Spine": 7, "Spine1": 4, "Spine2": 2, "Neck": -5, "Head": -4}
ARM_TARGET = (0.16, -0.56, 0.28)
ARM_POLE = (0.6, 0.3, -0.15)
LEG_TARGET = (0.45, -0.04, -0.52)
LEG_POLE = (0.5, -0.9, 0.15)

bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
for name, deg in SPINE.items():
    pb = rig.pose.bones["mixamorig:" + name]
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = Euler((math.radians(deg), 0, 0), "XYZ")
bpy.context.view_layer.update()
hips = rig.matrix_world @ rig.pose.bones["mixamorig:Hips"].head

def empty(name, loc):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
    return e

helpers = []
for side, sg in (("Left", 1), ("Right", -1)):
    for bone, tgt, pole in (("ForeArm", ARM_TARGET, ARM_POLE), ("Leg", LEG_TARGET, LEG_POLE)):
        t = empty(f"ik_{side}{bone}", hips + Vector((tgt[0] * sg, tgt[1], tgt[2])))
        p = empty(f"pole_{side}{bone}", hips + Vector((pole[0] * sg, pole[1], pole[2])))
        helpers += [t, p]
        c = rig.pose.bones[f"mixamorig:{side}{bone}"].constraints.new("IK")
        c.target = t
        c.pole_target = p
        c.pole_angle = math.radians(-90 if bone == "ForeArm" else float(os.environ.get("LEG_POLE_ANGLE", "90")))
        c.chain_count = 2
bpy.context.view_layer.update()
bpy.ops.pose.select_all(action="SELECT")
bpy.ops.pose.visual_transform_apply()
for pb in rig.pose.bones:
    for c in list(pb.constraints):
        pb.constraints.remove(c)
for h in helpers:
    bpy.data.objects.remove(h, do_unlink=True)
# Fingers closed around the reins (curl per joint, degrees about the bone's local X), the thumb over the index.
CURL = {"Index": (40, 55, 35), "Middle": (48, 58, 38), "Ring": (55, 60, 40), "Pinky": (62, 60, 40), "Thumb": (10, 25, 20)}
CURL_AXIS = os.environ.get("CURL_AXIS", "X")
for side in ("Left", "Right"):
    for finger, angles in CURL.items():
        for k, deg in enumerate(angles):
            pb = rig.pose.bones.get(f"mixamorig:{side}Hand{finger}{k + 1}")
            if pb is None:
                continue
            pb.rotation_mode = "XYZ"
            e = [0.0, 0.0, 0.0]
            e["XYZ".index(CURL_AXIS[-1])] = math.radians(deg) * (-1 if CURL_AXIS.startswith("-") else 1)
            pb.rotation_euler = Euler(e, "XYZ")
bpy.ops.object.mode_set(mode="OBJECT")
bpy.context.view_layer.update()

def dump():
    for n in ["Hips", "Spine2", "Head", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftArm", "LeftForeArm", "LeftHand"]:
        pb = rig.pose.bones["mixamorig:" + n]
        h = rig.matrix_world @ pb.head
        t = rig.matrix_world @ pb.tail
        print(f"BONE {n:12s} head {h.x:+.3f} {h.y:+.3f} {h.z:+.3f}  tail {t.x:+.3f} {t.y:+.3f} {t.z:+.3f}")
dump()

def preview(tag_prefix=""):
    """Workbench renders (orthographic): front, side, a close-up of the left hand and of the head."""
    if not PREVIEW:
        return
    os.makedirs(PREVIEW, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 600
    scene.render.resolution_y = 800
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = os.environ.get("RIDER_COLOR", "TEXTURE")
    cam = scene.camera
    if cam is None:
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        scene.collection.objects.link(cam)
        scene.camera = cam
    cam.data.type = "ORTHO"
    hand = rig.matrix_world @ rig.pose.bones["mixamorig:LeftHand"].head
    head = rig.matrix_world @ rig.pose.bones["mixamorig:Head"].head
    views = os.environ.get("RIDER_VIEWS", "front,side").split(",")
    shots = {
        "front": ((0, -5, 0.8), (90, 0, 0), 2.0),
        "side": ((5, 0, 0.8), (90, 0, 90), 2.0),
        "back": ((0, 5, 0.9), (90, 0, 180), 2.0),
        "hand": ((hand.x + 2, hand.y, hand.z), (90, 0, 90), 0.35),
        "handtop": ((hand.x, hand.y, hand.z + 2), (0, 0, 0), 0.35),
        "head": ((head.x, head.y - 2, head.z + 0.1), (90, 0, 0), 0.45),
        "headside": ((head.x + 2, head.y, head.z + 0.1), (90, 0, 90), 0.45),
    }
    for tag in views:
        loc, rot, ortho = shots[tag]
        cam.data.ortho_scale = ortho
        cam.location = loc
        cam.rotation_euler = Euler([math.radians(a) for a in rot], "XYZ")
        scene.render.filepath = os.path.join(PREVIEW, f"{tag_prefix}{tag}.png")
        bpy.ops.render.render(write_still=True)


preview()
if OUT == "-":
    sys.exit(0)

# --- Apply the riding pose as the rest pose (the game binds in it), then export.
bpy.context.view_layer.objects.active = rig
meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.parent == rig or o == basemesh]
for o in bpy.data.objects:
    if o.type == "MESH":
        bpy.context.view_layer.objects.active = o
        if o.data.shape_keys:
            # Bake the body / face targets into the mesh (runtime morphs come later).
            bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
        for m in list(o.modifiers):
            if m.type == "MASK":
                bpy.ops.object.modifier_apply(modifier=m.name)
        for m in list(o.modifiers):
            if m.type == "ARMATURE":
                # Bake the posed shape, then re-add the armature modifier for the new rest.
                bpy.ops.object.modifier_copy(modifier=m.name)
                bpy.ops.object.modifier_apply(modifier=m.name)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode="OBJECT")
# --- Outfit (built on the rest-posed body).
OUTFIT = os.environ.get("RIDER_OUTFIT", "akinci")
if OUTFIT == "akinci":
    import akinci
    # The dragon under the rider, for the cloth to rest on: a long rounded body along the neck, below the seat.
    hips_w = rig.matrix_world @ rig.pose.bones["mixamorig:Hips"].head
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.34, depth=3.0, location=(0, hips_w.y + 0.4, hips_w.z - 0.46), rotation=(math.radians(90), 0, 0))
    dragon_proxy = bpy.context.active_object
    dragon_proxy.name = "dragon_proxy"
    akinci.build(rig, basemesh, [basemesh, dragon_proxy])
    bpy.data.objects.remove(dragon_proxy, do_unlink=True)
    preview("outfit-")

bpy.ops.object.select_all(action="DESELECT")
for o in [rig] + list(rig.children_recursive):
    o.select_set(True)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_skins=True, export_animations=False,
                          export_morph=False, export_apply=False, export_yup=True, export_image_format="JPEG", export_jpeg_quality=88)
print("EXPORTED", OUT, os.path.getsize(OUT))
