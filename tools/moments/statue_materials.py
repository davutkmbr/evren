"""
Materials of the Aya Yorgi statue, baked into texture atlases (Cycles, CPU):

- Bronze: a cast figure a century outdoors: a dark brown oxide patina over the metal, bright bronze where hands and
  weather wear the high edges, verdigris gathering in the hollows, in rain streaks down the vertical faces and on the
  upward faces; a fine casting grain everywhere, and per part surface work in the bump (horsehair strands on the crest,
  a weave on the cloth, grain on the leather, hammer marks on the plates, a crust on the verdigris).
- Plinth: dressed limestone with chipped arrises, weathering streaks under the cornice, grime at the foot and a little
  lichen on the top.

Each material becomes albedo, ORM (R occlusion, G roughness, B metallic) and a tangent-space normal map on one UV set.
"""
import math
import os

import bpy
import numpy as np

# Part ids (face attribute 'part') set by the builder: what surface work the bump gets.
PART = {"skin": 0, "cloth": 1, "plate": 2, "leather": 3, "hair": 4, "wood": 5}


def classify(name):
    n = name.lower()
    if n.startswith(("human", "high-poly")):
        return PART["skin"]
    if n.startswith(("tunic", "skirt", "cloak", "sash")):
        return PART["cloth"]
    if n.startswith(("pteruges", "shoulder_", "baldric", "boots", "shield_strap", "scabbard", "grip")):
        return PART["leather"]
    if n.startswith("crest") and not n.startswith("crest_holder"):
        return PART["hair"]
    if n.startswith("spear_shaft"):
        return PART["wood"]
    return PART["plate"]


def tag_parts(objs):
    for o in objs:
        me = o.data
        a = me.attributes.get("part") or me.attributes.new("part", "INT", "FACE")
        pid = classify(o.name)
        a.data.foreach_set("value", [pid] * len(me.polygons))


# ------------------------------------------------------------------ node helpers


class Nodes:
    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.x = 0

    def n(self, kind, **inputs):
        node = self.nt.nodes.new(kind)
        node.location = (self.x, 0)
        self.x += 180
        for k, v in inputs.items():
            if k.startswith("_"):
                setattr(node, k[1:], v)
            else:
                self.set(node, k, v)
        return node

    def set(self, node, key, v):
        sock = node.inputs[key] if not isinstance(key, int) else node.inputs[key]
        if hasattr(v, "outputs") or hasattr(v, "is_output"):
            out = v if hasattr(v, "is_output") else v.outputs[0]
            self.nt.links.new(out, sock)
        else:
            sock.default_value = v

    def math(self, op, a, b=0.0, clamp=False):
        m = self.n("ShaderNodeMath", _operation=op, _use_clamp=clamp)
        self.set(m, 0, a)
        self.set(m, 1, b)
        return m

    def mix(self, fac, a, b):
        m = self.n("ShaderNodeMix", _data_type="RGBA")
        self.set(m, "Factor", fac)
        self.set(m, 6, a)
        self.set(m, 7, b)
        return m.outputs[2]

    def mixf(self, fac, a, b):
        m = self.n("ShaderNodeMix", _data_type="FLOAT")
        self.set(m, "Factor", fac)
        self.set(m, 2, a)
        self.set(m, 3, b)
        return m.outputs[0]

    def ramp(self, v, lo, hi):
        m = self.n("ShaderNodeMapRange", _clamp=True)
        self.set(m, "Value", v)
        self.set(m, "From Min", lo)
        self.set(m, "From Max", hi)
        return m.outputs[0]

    def noise(self, vec, scale, detail=4.0, rough=0.55, out="Fac"):
        t = self.n("ShaderNodeTexNoise", Scale=scale, Detail=detail, Roughness=rough)
        if vec is not None:
            self.set(t, "Vector", vec)
        return t.outputs[out]

    def is_part(self, part_attr, pid):
        d = self.math("SUBTRACT", part_attr, float(pid))
        a = self.math("ABSOLUTE", d)
        return self.math("LESS_THAN", a, 0.5)


def bronze_material():
    mat = bpy.data.materials.new("statue_bronze")
    N = Nodes(mat)
    geo = N.n("ShaderNodeNewGeometry")
    coords = N.n("ShaderNodeTexCoord").outputs["Object"]
    part = N.n("ShaderNodeAttribute", _attribute_name="part", _attribute_type="GEOMETRY").outputs["Fac"]
    ao = N.n("ShaderNodeAmbientOcclusion", _samples=16, _only_local=True, Distance=0.035)
    cavity = N.ramp(N.math("SUBTRACT", 1.0, ao.outputs["AO"]), 0.08, 0.55)
    edges = N.ramp(geo.outputs["Pointiness"], 0.515, 0.56)
    nz = N.n("ShaderNodeSeparateXYZ")
    N.set(nz, 0, geo.outputs["Normal"])
    up = N.ramp(nz.outputs["Z"], 0.35, 0.9)
    vertical = N.math("SUBTRACT", 1.0, N.ramp(N.math("ABSOLUTE", nz.outputs["Z"]), 0.3, 0.8))
    # rain streaks: noise stretched down the height
    streak_vec = N.n("ShaderNodeVectorMath", _operation="MULTIPLY")
    N.set(streak_vec, 0, coords)
    N.set(streak_vec, 1, (70.0, 70.0, 3.5))
    streaks = N.ramp(N.noise(streak_vec, 1.0, detail=3.0), 0.52, 0.68)
    big = N.noise(coords, 3.5, detail=5.0)
    mid = N.noise(coords, 18.0, detail=6.0)
    # verdigris amount
    v1 = N.math("MULTIPLY", cavity, 1.3)
    v2 = N.math("MULTIPLY", N.math("MULTIPLY", streaks, vertical), 0.8)
    v3 = N.math("MULTIPLY", N.math("MULTIPLY", up, N.ramp(big, 0.4, 0.62)), 0.9)
    verd = N.math("ADD", N.math("ADD", v1, v2), v3)
    verd = N.math("MULTIPLY", verd, N.ramp(mid, 0.3, 0.7))
    verd = N.ramp(verd, 0.18, 0.7)
    # worn bright bronze on the high edges (not where the verdigris sits)
    worn = N.math("MULTIPLY", N.ramp(N.math("ADD", edges, N.math("MULTIPLY", N.ramp(mid, 0.55, 0.75), 0.4)), 0.35, 0.9), N.math("SUBTRACT", 1.0, verd), clamp=True)
    bronze = (0.62, 0.40, 0.2, 1.0)
    patina = N.mix(N.ramp(big, 0.3, 0.7), (0.085, 0.056, 0.036, 1.0), (0.16, 0.1, 0.058, 1.0))
    verd_col = N.mix(N.ramp(mid, 0.35, 0.65), (0.2, 0.36, 0.3, 1.0), (0.36, 0.55, 0.44, 1.0))
    col = N.mix(worn, patina, bronze)
    col = N.mix(verd, col, verd_col)
    rough = N.mixf(worn, 0.5, 0.26)
    rough = N.mixf(verd, rough, 0.88)
    metal = N.mixf(worn, 0.72, 1.0)
    metal = N.mixf(verd, metal, 0.05)
    # surface work (bump heights)
    grain = N.math("MULTIPLY", N.noise(coords, 900.0, detail=2.0), 0.25)
    hair = N.math("MULTIPLY", N.is_part(part, PART["hair"]), N.n("ShaderNodeTexWave", _wave_type="BANDS", _bands_direction="X", Scale=180.0, Distortion=6.0, Detail=3.0).outputs["Fac"])
    cloth = N.math("MULTIPLY", N.is_part(part, PART["cloth"]), N.math("MULTIPLY", N.noise(coords, 2200.0, detail=1.0), 0.35))
    leather = N.math("MULTIPLY", N.is_part(part, PART["leather"]), N.math("MULTIPLY", N.n("ShaderNodeTexVoronoi", Scale=420.0).outputs["Distance"], 0.45))
    vor = N.n("ShaderNodeTexVoronoi", Scale=90.0)
    N.set(vor, "Vector", coords)
    hammer = N.math("MULTIPLY", N.is_part(part, PART["plate"]), N.math("MULTIPLY", vor.outputs["Distance"], 0.35))
    crust = N.math("MULTIPLY", verd, N.math("MULTIPLY", N.noise(coords, 520.0, detail=3.0), 0.8))
    h = N.math("ADD", grain, hair)
    h = N.math("ADD", h, cloth)
    h = N.math("ADD", h, leather)
    h = N.math("ADD", h, hammer)
    h = N.math("ADD", h, crust)
    bump = N.n("ShaderNodeBump", Strength=0.35, Distance=0.0015)
    N.set(bump, "Height", h)
    bsdf = N.n("ShaderNodeBsdfPrincipled")
    N.set(bsdf, "Base Color", col)
    N.set(bsdf, "Roughness", rough)
    N.set(bsdf, "Metallic", metal)
    N.set(bsdf, "Normal", bump.outputs["Normal"])
    out = N.n("ShaderNodeOutputMaterial")
    N.set(out, "Surface", bsdf)
    mat["metal_socket"] = 0
    return mat, (N, bsdf, metal, rough)


def stone_material():
    mat = bpy.data.materials.new("statue_stone")
    N = Nodes(mat)
    geo = N.n("ShaderNodeNewGeometry")
    coords = N.n("ShaderNodeTexCoord").outputs["Object"]
    nz = N.n("ShaderNodeSeparateXYZ")
    N.set(nz, 0, geo.outputs["Normal"])
    pos = N.n("ShaderNodeSeparateXYZ")
    N.set(pos, 0, coords)
    ao = N.n("ShaderNodeAmbientOcclusion", _samples=16, _only_local=True, Distance=0.05)
    cavity = N.ramp(N.math("SUBTRACT", 1.0, ao.outputs["AO"]), 0.05, 0.5)
    big = N.noise(coords, 2.5, detail=6.0)
    fine = N.noise(coords, 60.0, detail=8.0)
    base = N.mix(N.ramp(big, 0.35, 0.65), (0.6, 0.56, 0.48, 1.0), (0.72, 0.68, 0.59, 1.0))
    base = N.mix(N.math("MULTIPLY", N.ramp(fine, 0.45, 0.75), 0.35), base, (0.52, 0.49, 0.43, 1.0))
    # grime: at the foot and in the hollows; streaks below the cornice
    foot = N.ramp(pos.outputs["Z"], 0.25, -0.02)
    sv = N.n("ShaderNodeVectorMath", _operation="MULTIPLY")
    N.set(sv, 0, coords)
    N.set(sv, 1, (40.0, 40.0, 2.0))
    streaks = N.math("MULTIPLY", N.ramp(N.noise(sv, 1.0, detail=3.0), 0.5, 0.7), N.math("SUBTRACT", 1.0, N.ramp(N.math("ABSOLUTE", nz.outputs["Z"]), 0.3, 0.8)))
    grime = N.ramp(N.math("ADD", N.math("ADD", N.math("MULTIPLY", foot, 0.8), N.math("MULTIPLY", cavity, 0.9)), N.math("MULTIPLY", streaks, 0.6)), 0.1, 0.9)
    col = N.mix(N.math("MULTIPLY", grime, 0.8), base, (0.3, 0.28, 0.24, 1.0))
    # lichen on the top faces
    lichen = N.math("MULTIPLY", N.ramp(nz.outputs["Z"], 0.6, 0.95), N.ramp(N.noise(coords, 14.0, detail=4.0), 0.62, 0.7))
    col = N.mix(N.math("MULTIPLY", lichen, 0.85), col, (0.52, 0.5, 0.3, 1.0))
    rough = N.mixf(grime, 0.78, 0.9)
    chips = N.n("ShaderNodeTexVoronoi", Scale=38.0)
    N.set(chips, "Vector", coords)
    h = N.math("ADD", N.math("MULTIPLY", fine, 0.6), N.math("MULTIPLY", chips.outputs["Distance"], 0.5))
    h = N.math("ADD", h, N.math("MULTIPLY", N.noise(coords, 400.0, detail=2.0), 0.25))
    bump = N.n("ShaderNodeBump", Strength=0.6, Distance=0.004)
    N.set(bump, "Height", h)
    bsdf = N.n("ShaderNodeBsdfPrincipled")
    N.set(bsdf, "Base Color", col)
    N.set(bsdf, "Roughness", rough)
    N.set(bsdf, "Metallic", 0.0)
    N.set(bsdf, "Normal", bump.outputs["Normal"])
    out = N.n("ShaderNodeOutputMaterial")
    N.set(out, "Surface", bsdf)
    return mat, (N, bsdf, 0.0, rough)


# ------------------------------------------------------------------ baking


def unwrap(obj, margin=0.002):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name="UVMap")
    while len(obj.data.uv_layers) > 1:
        obj.data.uv_layers.remove(obj.data.uv_layers[-1])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(62), island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=margin, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")


def _image(name, size, non_color):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return img


def bake(obj, mat, handles, size, prefix, samples=24):
    """Bakes albedo, roughness, metallic, AO and normal; returns {name: image} with 'orm' packed."""
    N, bsdf, metal, rough = handles
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.render.bake.margin = 8
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    tex = N.nt.nodes.new("ShaderNodeTexImage")
    N.nt.nodes.active = tex
    out = next(n for n in N.nt.nodes if n.type == "OUTPUT_MATERIAL")
    imgs = {}

    def run(name, kind, non_color, **kw):
        img = _image(f"{prefix}_{name}", size, non_color)
        tex.image = img
        bpy.ops.object.bake(type=kind, **kw)
        imgs[name] = img
        return img

    run("albedo", "DIFFUSE", False, pass_filter={"COLOR"})
    run("normal", "NORMAL", True)
    run("rough", "ROUGHNESS", True)
    # metallic through an emission shader
    em = N.nt.nodes.new("ShaderNodeEmission")
    if isinstance(metal, float):
        em.inputs["Color"].default_value = (metal, metal, metal, 1)
    else:
        N.nt.links.new(metal, em.inputs["Color"])
    N.nt.links.new(em.outputs[0], out.inputs["Surface"])
    run("metal", "EMIT", True)
    N.nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    scene.cycles.samples = max(samples, 64)
    scene.world = scene.world or bpy.data.worlds.new("World")
    scene.world.light_settings.distance = 0.12
    run("ao", "AO", True)
    # ORM pack
    px = lambda im: np.array(im.pixels[:], dtype=np.float32).reshape(-1, 4)  # noqa: E731
    ao_, r_, m_ = px(imgs["ao"]), px(imgs["rough"]), px(imgs["metal"])
    orm = np.stack([ao_[:, 0], r_[:, 0], m_[:, 0], np.ones(len(ao_), np.float32)], axis=1)
    img = _image(f"{prefix}_orm", size, True)
    img.pixels.foreach_set(orm.ravel())
    imgs["orm"] = img
    N.nt.nodes.remove(tex)
    N.nt.nodes.remove(em)
    return imgs


def export_material(name, imgs):
    """The glTF material: albedo, ORM (occlusion + metallic-roughness) and normal map."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])

    def tex(img):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        return t

    nt.links.new(tex(imgs["albedo"]).outputs["Color"], bsdf.inputs["Base Color"])
    orm = tex(imgs["orm"])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tex(imgs["normal"]).outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    # occlusion for the glTF exporter
    grp = bpy.data.node_groups.get("glTF Material Output") or bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    if "Occlusion" not in [s.name for s in grp.interface.items_tree]:
        grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    g = nt.nodes.new("ShaderNodeGroup")
    g.node_tree = grp
    nt.links.new(sep.outputs["Red"], g.inputs["Occlusion"])
    return mat


def save_images(imgs, folder):
    os.makedirs(folder, exist_ok=True)
    for k, im in imgs.items():
        im.filepath_raw = os.path.join(folder, f"{im.name}.png")
        im.file_format = "PNG"
        im.save()
