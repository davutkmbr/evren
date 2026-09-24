"""
Render-time surface detail for the S1 reference renders (called by render.py after import_area.build()).

1. Micro detail on flat-roughness materials. A material whose roughness is one constant (no roughness map: most
   procedural compiler materials, glass, metal, signs, awnings and the procedural props) reads as plastic: every
   highlight is the same size everywhere. Such materials get two-scale noise on the roughness (smudges at ~30 cm,
   grain at ~1.5 cm, relatively stronger on glossy surfaces) and a sub-millimetre bump. setup() lists them
   (render.py writes <out>/look/surfaces.json) for the runtimes, which need the same (a shared detail-roughness texture or a noise in the shader).
2. Wet ground. Materials with extras.surface == 'ground' get a value node 'evren_wet' (0..1, per camera from
   scripts/blender/skies.json): upward-facing ground darkens (wet porous stone and concrete absorb more light) and
   turns glossier, and above wet 0.35 standing water collects in world-fixed puddles (large flat patches plus small
   hollows) that mirror the lamps and the sky. The street lane's own puddle decal material (st_wet) is left alone.
"""

import bpy

WET_NODE = 'evren_wet'
MICRO_TAG = 'evren_micro'
SKIP_WET = ('st_wet',)
# Blender's own and the render's stand-in materials (not compiler output)
SKIP_MICRO = ('Material', 'Dots Stroke', 'sea_standin', 'evren_fog', 'evren_meter_white')
# relative roughness variation for glossy (< 0.5) and rough materials; bump strength per surface kind
MICRO_AMPLITUDE = {'glossy': 0.45, 'rough': 0.18}
MICRO_BUMP = {'glass': 0.01, 'metal': 0.05, 'default': 0.035}


def log(*args):
    print('[evren:surface]', *args, flush=True)


def _bsdf(mat):
    if not mat.use_nodes or mat.node_tree is None:
        return None
    return next((n for n in mat.node_tree.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)


def _base(name):
    import re

    return re.sub(r'\.\d{3,}$', '', name)


class _T:
    def __init__(self, mat):
        self.nt = mat.node_tree

    def node(self, kind, **props):
        n = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, a, b):
        self.nt.links.new(a, b)

    def math(self, op, a, b=None, clamp=False):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, bpy.types.NodeSocket):
                self.link(v, n.inputs[i])
            else:
                n.inputs[i].default_value = v
        return n.outputs[0]

    def noise(self, vector, scale, detail=2.0, rough=0.55):
        n = self.node('ShaderNodeTexNoise', noise_dimensions='3D')
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        self.link(vector, n.inputs['Vector'])
        return n.outputs['Fac']

    def smooth(self, value, lo, hi):
        n = self.node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP', clamp=True)
        self.link(value, n.inputs['Value'])
        n.inputs['From Min'].default_value = lo
        n.inputs['From Max'].default_value = hi
        return n.outputs['Result']

    def detach(self, sock):
        """The socket feeding `sock` (link removed), or None."""
        if not sock.is_linked:
            return None
        link = sock.links[0]
        src = link.from_socket
        self.nt.links.remove(link)
        return src


def add_micro_detail(mat):
    """Two-scale roughness noise and a fine bump on a material with a constant roughness. Returns a report entry or
    None when the material already has roughness detail."""
    bsdf = _bsdf(mat)
    if bsdf is None or mat.node_tree.nodes.get(MICRO_TAG) is not None or _base(mat.name) in SKIP_MICRO:
        return None
    rough_in = bsdf.inputs['Roughness']
    if rough_in.is_linked:
        return None
    t = _T(mat)
    r0 = float(rough_in.default_value)
    surface = mat.get('surface') or ('glass' if bsdf.inputs['Transmission Weight'].default_value > 0.5 else 'other')
    coord = t.node('ShaderNodeTexCoord')
    obj = coord.outputs['Object']
    smudge = t.noise(obj, 3.0, detail=4.0, rough=0.6)
    grain = t.noise(obj, 65.0, detail=2.0, rough=0.5)
    var = t.math('ADD', t.math('MULTIPLY', t.math('SUBTRACT', smudge, 0.5), 1.2), t.math('MULTIPLY', t.math('SUBTRACT', grain, 0.5), 0.6))
    amp = MICRO_AMPLITUDE['glossy' if r0 < 0.5 else 'rough']
    rough = t.math('MULTIPLY', t.math('ADD', t.math('MULTIPLY', var, amp), 1.0), r0)
    rough = t.math('ADD', rough, t.math('MULTIPLY', smudge, 0.03 if r0 < 0.5 else 0.0))
    rough = t.math('MINIMUM', t.math('MAXIMUM', rough, 0.02), 1.0)
    tag = t.node('NodeReroute')
    tag.name = MICRO_TAG
    t.link(rough, tag.inputs[0])
    t.link(tag.outputs[0], rough_in)
    bump = t.node('ShaderNodeBump')
    bump.inputs['Strength'].default_value = MICRO_BUMP.get(surface, MICRO_BUMP['default'])
    bump.inputs['Distance'].default_value = 0.0006
    fine = t.noise(obj, 420.0, detail=1.0, rough=0.5)
    t.link(t.math('ADD', grain, t.math('MULTIPLY', fine, 0.5)), bump.inputs['Height'])
    prev = t.detach(bsdf.inputs['Normal'])
    if prev is not None:
        t.link(prev, bump.inputs['Normal'])
    t.link(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return {'roughness': round(r0, 3), 'surface': surface}


def add_wet(mat):
    """Wet-ground layer driven by the value node 'evren_wet'. Returns True when added."""
    bsdf = _bsdf(mat)
    if bsdf is None or mat.get('surface') != 'ground' or _base(mat.name) in SKIP_WET:
        return False
    if mat.node_tree.nodes.get(WET_NODE) is not None:
        return False
    t = _T(mat)
    wet = t.node('ShaderNodeValue')
    wet.name = wet.label = WET_NODE
    wet.outputs[0].default_value = 0.0
    geo = t.node('ShaderNodeNewGeometry')
    nz = t.node('ShaderNodeSeparateXYZ')
    t.link(geo.outputs['Normal'], nz.inputs[0])
    up = t.smooth(nz.outputs['Z'], 0.75, 0.95)
    damp = t.math('MULTIPLY', wet.outputs[0], up)
    pos = geo.outputs['Position']
    big = t.smooth(t.noise(pos, 0.16, detail=3.0, rough=0.55), 0.57, 0.62)
    small = t.smooth(t.noise(pos, 0.9, detail=2.0, rough=0.5), 0.63, 0.68)
    puddle = t.math('MAXIMUM', big, small)
    puddle = t.math('MULTIPLY', puddle, t.smooth(wet.outputs[0], 0.35, 0.85))
    puddle = t.math('MULTIPLY', puddle, up)

    col_in = bsdf.inputs['Base Color']
    col_src = t.detach(col_in)
    darken = t.node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
    t.link(damp, darken.inputs['Factor'])
    if col_src is not None:
        t.link(col_src, darken.inputs['A'])
    else:
        darken.inputs['A'].default_value = tuple(col_in.default_value)
    darken.inputs['B'].default_value = (0.62, 0.62, 0.62, 1.0)
    water = t.node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
    t.link(puddle, water.inputs['Factor'])
    t.link(darken.outputs['Result'], water.inputs['A'])
    water.inputs['B'].default_value = (0.85, 0.85, 0.85, 1.0)
    t.link(water.outputs['Result'], col_in)

    r_in = bsdf.inputs['Roughness']
    r_src = t.detach(r_in)
    if r_src is None:
        v = t.node('ShaderNodeValue')
        v.outputs[0].default_value = float(r_in.default_value)
        r_src = v.outputs[0]
    r_wet = t.math('ADD', t.math('MULTIPLY', r_src, 0.55), 0.05)
    mix_r = t.node('ShaderNodeMix', data_type='FLOAT')
    t.link(damp, mix_r.inputs['Factor'])
    t.link(r_src, mix_r.inputs['A'])
    t.link(r_wet, mix_r.inputs['B'])
    mix_p = t.node('ShaderNodeMix', data_type='FLOAT')
    t.link(puddle, mix_p.inputs['Factor'])
    t.link(mix_r.outputs['Result'], mix_p.inputs['A'])
    mix_p.inputs['B'].default_value = 0.02
    t.link(mix_p.outputs['Result'], r_in)

    n_in = bsdf.inputs['Normal']
    n_src = t.detach(n_in)
    if n_src is not None:
        mix_n = t.node('ShaderNodeMix', data_type='VECTOR')
        t.link(puddle, mix_n.inputs['Factor'])
        t.link(n_src, mix_n.inputs['A'])
        t.link(geo.outputs['Normal'], mix_n.inputs['B'])
        nrm = t.node('ShaderNodeVectorMath', operation='NORMALIZE')
        t.link(mix_n.outputs['Result'], nrm.inputs[0])
        t.link(nrm.outputs['Vector'], n_in)
    return True


def _prop_materials():
    names = set()
    src = bpy.data.collections.get('props_src')
    if src is None:
        return names
    for o in src.all_objects:
        for slot in getattr(o, 'material_slots', []):
            if slot.material is not None:
                names.add(slot.material.name)
    return names


def setup():
    """Adds the wet layer and the micro detail to every material. Returns the report for the runtimes."""
    props = _prop_materials()
    wet, micro = 0, {}
    for mat in bpy.data.materials:
        entry = add_micro_detail(mat)
        if entry is not None:
            entry['source'] = 'prop' if mat.name in props else 'tile'
            micro[_base(mat.name)] = entry
    for mat in bpy.data.materials:
        if add_wet(mat):
            wet += 1
    log(f'wet layer on {wet} ground materials, micro detail on {len(micro)} flat-roughness materials')
    return {'wetMaterials': wet, 'flatRoughness': dict(sorted(micro.items()))}


def set_wet(value):
    n = 0
    for mat in bpy.data.materials:
        if mat.use_nodes and mat.node_tree is not None:
            v = mat.node_tree.nodes.get(WET_NODE)
            if v is not None:
                v.outputs[0].default_value = float(value)
                n += 1
    return n
