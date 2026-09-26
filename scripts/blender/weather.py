"""
Weathering blend of compiled materials (world compiler format 1.1; tools/world-compiler/README.md,
"Format 1.1 - weathering").

A material whose glTF extras carry `weather` gets one shared node group, "evren_weather", between its own maps and its
Principled BSDF. The group blends up to four layers over the base colour, roughness and normal, in this order:

    layer   _WEATHER   typical use
    dirt    x (R)      grime in corners and reveals, soot
    streak  y (G)      rain streaks under sills, cornices and balconies
    edge    z (B)      chipped paint / worn edges; gated by a convex-edge estimate (bevel normal and local AO)
    damp    w (A)      splash and rising damp at wall bases (darker, glossier)

Per layer (the runtime contract of the README): coverage m = clamp(channel x strength) x layer alpha x
mix(1, convexity, curvature); colour = mix(base, layer, m) or base x mix(1, layer, m) ('multiply'), then
x mix(1, darken, m); roughness = mix(base, layer, m); normal = normalize(mix(base, layer, m)). Layer maps are sampled
at UV0 x (material tiling / layer tiling). A material without `weather` is left untouched.

    import weather
    weather.setup_weather_materials(os.path.join(area_dir, 'textures'))

Tuning knobs for the look lane: the group inputs "Edge Radius" (bevel radius, m), "Curvature Gain" and "Cavity AO"
(the local AO below which an edge counts as concave), "Macro Variation" and "Streak Break", and the per-layer inputs
the materials set.

Macro variation (look lane, S1 round 2): with coverage from vertex data and tiled layer maps alone, every wall of a
material weathers the same amount and the streak map repeats as one even band. Two world-space noises break that up:
- every layer's coverage is scaled by a slow noise (features of about 4 m) between 0.35 and 1.65 x, mixed in by
  "Macro Variation" (default 0.6): one bay of a facade is dirtier than the next, as in the photos;
- streak coverage is also scaled by a noise stretched vertically (about 0.25 m across, 2.5 m down): drips of varying
  length and strength instead of a uniform curtain ("Streak Break", default 0.7).
Runtimes reproduce this with the same world-position noise (or a tiling noise texture sampled in world space).
"""

import os

import bpy

GROUP = 'evren_weather'
GROUP_VERSION = 2
ATTRIBUTE = '_WEATHER'
UV0 = 'UVMap'
LAYERS = ('dirt', 'streak', 'edge', 'damp')
LAYER_FIELDS = (
    # name, socket type, default
    ('Color', 'NodeSocketColor', (1.0, 1.0, 1.0, 1.0)),
    ('Alpha', 'NodeSocketFloat', 1.0),
    ('Roughness', 'NodeSocketFloat', 0.9),
    ('Normal', 'NodeSocketVector', (0.0, 0.0, 1.0)),
    ('Strength', 'NodeSocketFloat', 0.0),
    ('Multiply', 'NodeSocketFloat', 0.0),
    ('Darken', 'NodeSocketFloat', 1.0),
    ('Curvature', 'NodeSocketFloat', 0.0),
)


def log(*args):
    print('[evren:weather]', *args, flush=True)


def plain(v):
    """IDProperty groups and arrays (glTF extras imported as custom properties) -> dicts and lists."""
    if hasattr(v, 'to_dict'):
        return {k: plain(x) for k, x in v.to_dict().items()}
    if isinstance(v, dict):
        return {k: plain(x) for k, x in v.items()}
    if hasattr(v, 'to_list'):
        return v.to_list()
    if isinstance(v, (list, tuple)):
        return [plain(x) for x in v]
    return v


def _sock(sockets, ident):
    return next(s for s in sockets if s.identifier == ident or s.name == ident)


class _Builder:
    """Small helpers to wire nodes of one node tree."""

    def __init__(self, tree):
        self.t = tree

    def node(self, kind, **props):
        n = self.t.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def feed(self, sock, value):
        if isinstance(value, bpy.types.NodeSocket):
            self.t.links.new(value, sock)
        elif value is not None:
            sock.default_value = value

    def math(self, op, a, b=None, clamp=False):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.feed(n.inputs[0], a)
        if b is not None:
            self.feed(n.inputs[1], b)
        return n.outputs[0]

    def mix(self, kind, fac, a, b, blend='MIX'):
        """kind: 'FLOAT', 'VECTOR' or 'RGBA'."""
        n = self.node('ShaderNodeMix', data_type=kind)
        if kind == 'RGBA':
            n.blend_type = blend
        suffix = {'FLOAT': 'Float', 'VECTOR': 'Vector', 'RGBA': 'Color'}[kind]
        self.feed(_sock(n.inputs, 'Factor_Float'), fac)
        self.feed(_sock(n.inputs, 'A_' + suffix), a)
        self.feed(_sock(n.inputs, 'B_' + suffix), b)
        return _sock(n.outputs, 'Result_' + suffix)

    def vmath(self, op, a, b=None, c=None, scale=None):
        n = self.node('ShaderNodeVectorMath', operation=op)
        self.feed(n.inputs[0], a)
        if b is not None:
            self.feed(n.inputs[1], b)
        if c is not None:
            self.feed(n.inputs[2], c)
        if scale is not None:
            self.feed(_sock(n.inputs, 'Scale'), scale)
        return n.outputs['Value'] if op in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE') else n.outputs['Vector']


def weather_group():
    """The shared blend group (built once per file; rebuilt when GROUP_VERSION changes)."""
    ng = bpy.data.node_groups.get(GROUP)
    if ng is not None and ng.get('version') == GROUP_VERSION:
        return ng
    if ng is not None:
        bpy.data.node_groups.remove(ng)
    ng = bpy.data.node_groups.new(GROUP, 'ShaderNodeTree')
    ng['version'] = GROUP_VERSION
    iface = ng.interface

    def socket(name, kind, default=None, in_out='INPUT', lo=None, hi=None):
        s = iface.new_socket(name=name, in_out=in_out, socket_type=kind)
        if default is not None and in_out == 'INPUT':
            s.default_value = default
        if lo is not None:
            s.min_value = lo
        if hi is not None:
            s.max_value = hi
        return s

    socket('Base Color', 'NodeSocketColor', (0.8, 0.8, 0.8, 1.0))
    socket('Roughness', 'NodeSocketFloat', 0.9, lo=0.0, hi=1.0)
    socket('Normal', 'NodeSocketVector', (0.0, 0.0, 1.0))
    socket('Weather', 'NodeSocketColor', (0.0, 0.0, 0.0, 1.0))
    socket('Damp', 'NodeSocketFloat', 0.0)
    socket('Edge Radius', 'NodeSocketFloat', 0.03, lo=0.0)
    socket('Curvature Gain', 'NodeSocketFloat', 4.0, lo=0.0)
    socket('Cavity AO', 'NodeSocketFloat', 0.85, lo=0.0, hi=1.0)
    socket('Macro Variation', 'NodeSocketFloat', 0.6, lo=0.0, hi=1.0)
    socket('Streak Break', 'NodeSocketFloat', 0.7, lo=0.0, hi=1.0)
    for layer in LAYERS:
        for field, kind, default in LAYER_FIELDS:
            socket(f'{layer.capitalize()} {field}', kind, default)
    socket('Base Color', 'NodeSocketColor', in_out='OUTPUT')
    socket('Roughness', 'NodeSocketFloat', in_out='OUTPUT')
    socket('Normal', 'NodeSocketVector', in_out='OUTPUT')

    b = _Builder(ng)
    gi = b.node('NodeGroupInput')
    go = b.node('NodeGroupOutput')
    I = gi.outputs

    # Convex-edge estimate: how far the bevelled normal turns away from the shading normal (any edge), kept only where
    # the local AO says the surface is open (convex, not a concave corner).
    geo = b.node('ShaderNodeNewGeometry')
    bevel = b.node('ShaderNodeBevel', samples=8)
    b.feed(bevel.inputs['Radius'], I['Edge Radius'])
    turn = b.math('SUBTRACT', 1.0, b.vmath('DOT_PRODUCT', bevel.outputs['Normal'], geo.outputs['Normal']))
    edge = b.math('MULTIPLY', turn, I['Curvature Gain'], clamp=True)
    ao = b.node('ShaderNodeAmbientOcclusion', samples=8, only_local=True)
    b.feed(ao.inputs['Distance'], 0.25)
    open_ = b.node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
    b.feed(open_.inputs['Value'], ao.outputs['AO'])
    b.feed(open_.inputs['From Min'], I['Cavity AO'])
    b.feed(open_.inputs['From Max'], 0.98)
    convex = b.math('MULTIPLY', edge, open_.outputs['Result'])

    macro_noise = b.node('ShaderNodeTexNoise', noise_dimensions='3D')
    b.feed(macro_noise.inputs['Vector'], geo.outputs['Position'])
    macro_noise.inputs['Scale'].default_value = 0.25
    macro_noise.inputs['Detail'].default_value = 3.0
    macro_noise.inputs['Roughness'].default_value = 0.55
    macro_range = b.node('ShaderNodeMapRange', clamp=True)
    b.feed(macro_range.inputs['Value'], macro_noise.outputs['Fac'])
    macro_range.inputs['From Min'].default_value = 0.3
    macro_range.inputs['From Max'].default_value = 0.7
    macro_range.inputs['To Min'].default_value = 0.35
    macro_range.inputs['To Max'].default_value = 1.65
    macro = b.mix('FLOAT', I['Macro Variation'], 1.0, macro_range.outputs['Result'])
    drip_coord = b.vmath('MULTIPLY', geo.outputs['Position'], (4.0, 4.0, 0.4))
    drip_noise = b.node('ShaderNodeTexNoise', noise_dimensions='3D')
    b.feed(drip_noise.inputs['Vector'], drip_coord)
    drip_noise.inputs['Scale'].default_value = 1.0
    drip_noise.inputs['Detail'].default_value = 2.0
    drip_range = b.node('ShaderNodeMapRange', clamp=True)
    b.feed(drip_range.inputs['Value'], drip_noise.outputs['Fac'])
    drip_range.inputs['From Min'].default_value = 0.35
    drip_range.inputs['From Max'].default_value = 0.65
    drip_range.inputs['To Min'].default_value = 0.3
    drip_range.inputs['To Max'].default_value = 1.7
    drip = b.mix('FLOAT', I['Streak Break'], 1.0, drip_range.outputs['Result'])

    sep = b.node('ShaderNodeSeparateColor')
    b.feed(sep.inputs['Color'], I['Weather'])
    channels = {'dirt': sep.outputs[0], 'streak': sep.outputs[1], 'edge': sep.outputs[2], 'damp': I['Damp']}

    col, rough, nrm = I['Base Color'], I['Roughness'], I['Normal']
    for layer in LAYERS:
        L = layer.capitalize()
        cov = b.math('MULTIPLY', channels[layer], macro)
        if layer == 'streak':
            cov = b.math('MULTIPLY', cov, drip)
        m = b.math('MULTIPLY', cov, I[f'{L} Strength'], clamp=True)
        m = b.math('MULTIPLY', m, I[f'{L} Alpha'])
        gate = b.mix('FLOAT', I[f'{L} Curvature'], 1.0, convex)
        m = b.math('MULTIPLY', m, gate)
        mixed = b.mix('RGBA', m, col, I[f'{L} Color'], 'MIX')
        multiplied = b.mix('RGBA', m, col, I[f'{L} Color'], 'MULTIPLY')
        col = b.mix('RGBA', I[f'{L} Multiply'], mixed, multiplied, 'MIX')
        dark = b.mix('FLOAT', m, 1.0, I[f'{L} Darken'])
        col = b.vmath('SCALE', col, scale=dark)
        rough = b.mix('FLOAT', m, rough, I[f'{L} Roughness'])
        nrm = b.vmath('NORMALIZE', b.mix('VECTOR', m, nrm, I[f'{L} Normal']))
    b.feed(go.inputs['Base Color'], col)
    b.feed(go.inputs['Roughness'], rough)
    b.feed(go.inputs['Normal'], nrm)
    return ng


def _source(b, sock, fallback):
    """The socket feeding `sock` (its link is removed), or a constant node holding its value."""
    if sock.is_linked:
        link = sock.links[0]
        src = link.from_socket
        b.t.links.remove(link)
        return src
    return fallback(sock)


def _image(path, colorspace):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = colorspace
    if path.lower().endswith('.png'):
        img.alpha_mode = 'STRAIGHT'
    return img


def _wire_layer(b, grp, layer, rec, tiling, base_rough, base_nrm, textures_dir):
    L = layer.capitalize()
    inp = grp.inputs
    lt = rec.get('tiling') or tiling
    ku, kv = tiling[0] / max(lt[0], 1e-6), tiling[1] / max(lt[1], 1e-6)
    uvn = b.node('ShaderNodeUVMap', uv_map=UV0)
    # Blender stores v' = 1 - v; glTF-side layer v = k v, i.e. v'_layer = k v' + (1 - k).
    uv = b.vmath('MULTIPLY_ADD', uvn.outputs['UV'], (ku, kv, 1.0), (0.0, 1.0 - kv, 0.0))
    tint = tuple(rec.get('tint') or (1.0, 1.0, 1.0)) + (1.0,)

    def tex(uri, colorspace):
        path = os.path.join(textures_dir, os.path.basename(uri))
        if not os.path.exists(path):
            log(f'WARNING missing layer texture {path}')
            return None
        wrap = 'MIRROR' if rec.get('wrap') == 'mirror' else 'REPEAT'
        n = b.node('ShaderNodeTexImage', image=_image(path, colorspace), interpolation='Linear', extension=wrap)
        b.feed(n.inputs['Vector'], uv)
        return n

    color = tex(rec['baseColor'], 'sRGB') if rec.get('baseColor') else None
    if color is not None:
        b.feed(inp[f'{L} Color'], b.mix('RGBA', 1.0, color.outputs['Color'], tint, 'MULTIPLY'))
        if rec.get('alpha'):
            b.feed(inp[f'{L} Alpha'], color.outputs['Alpha'])
    else:
        inp[f'{L} Color'].default_value = tint
    r = rec.get('roughness')
    orm = tex(rec['orm'], 'Non-Color') if rec.get('orm') else None
    if r is None:
        b.feed(inp[f'{L} Roughness'], base_rough)
    elif orm is not None:
        sep = b.node('ShaderNodeSeparateColor')
        b.feed(sep.inputs['Color'], orm.outputs['Color'])
        b.feed(inp[f'{L} Roughness'], b.math('MULTIPLY', sep.outputs[1], float(r)))
    else:
        inp[f'{L} Roughness'].default_value = float(r)
    ns = float(rec.get('normalScale', 1.0))
    nmap_tex = tex(rec['normal'], 'Non-Color') if rec.get('normal') and ns > 0 else None
    if nmap_tex is not None:
        nm = b.node('ShaderNodeNormalMap', space='TANGENT', uv_map=UV0)
        nm.inputs['Strength'].default_value = ns
        b.feed(nm.inputs['Color'], nmap_tex.outputs['Color'])
        b.feed(inp[f'{L} Normal'], nm.outputs['Normal'])
    else:
        b.feed(inp[f'{L} Normal'], base_nrm)
    inp[f'{L} Strength'].default_value = float(rec.get('strength', 1.0))
    inp[f'{L} Multiply'].default_value = 1.0 if rec.get('blend') == 'multiply' else 0.0
    inp[f'{L} Darken'].default_value = float(rec.get('darken', 1.0))
    inp[f'{L} Curvature'].default_value = float(rec.get('curvature', 0.0))


def setup_material(mat, textures_dir):
    """Inserts the weather group into one material with extras.weather. Returns True when it did."""
    w = mat.get('weather')
    if not w or not mat.use_nodes or mat.node_tree is None or mat.node_tree.nodes.get(GROUP) is not None:
        return False
    w = plain(w)
    layers = w.get('layers') or {}
    if not layers:
        return False
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
    if bsdf is None:
        return False
    b = _Builder(nt)

    def const_color(sock):
        n = b.node('ShaderNodeRGB')
        n.outputs[0].default_value = tuple(sock.default_value)
        return n.outputs[0]

    def const_value(sock):
        n = b.node('ShaderNodeValue')
        n.outputs[0].default_value = sock.default_value
        return n.outputs[0]

    base_col = _source(b, bsdf.inputs['Base Color'], const_color)
    base_rough = _source(b, bsdf.inputs['Roughness'], const_value)
    base_nrm = _source(b, bsdf.inputs['Normal'], lambda _s: b.node('ShaderNodeNewGeometry').outputs['Normal'])
    grp = b.node('ShaderNodeGroup')
    grp.node_tree = weather_group()
    grp.name = grp.label = GROUP
    b.feed(grp.inputs['Base Color'], base_col)
    b.feed(grp.inputs['Roughness'], base_rough)
    b.feed(grp.inputs['Normal'], base_nrm)
    attr = b.node('ShaderNodeAttribute', attribute_type='GEOMETRY', attribute_name=w.get('attribute') or ATTRIBUTE)
    b.feed(grp.inputs['Weather'], attr.outputs['Color'])
    b.feed(grp.inputs['Damp'], attr.outputs['Alpha'])
    tiling = plain(mat.get('tiling')) or [2.0, 2.0]
    for layer in LAYERS:
        if layer in layers:
            _wire_layer(b, grp, layer, layers[layer], tiling, base_rough, base_nrm, textures_dir)
    b.feed(bsdf.inputs['Base Color'], grp.outputs['Base Color'])
    b.feed(bsdf.inputs['Roughness'], grp.outputs['Roughness'])
    b.feed(bsdf.inputs['Normal'], grp.outputs['Normal'])
    mat['weatherLayers'] = ','.join(k for k in LAYERS if k in layers)
    return True


def keep_vertex_colors():
    """`_WEATHER` imports as a float colour attribute: keep COLOR_0 ('Color') the rendered colour attribute, since the
    importer's Color Attribute nodes read the rendered one."""
    for me in bpy.data.meshes:
        ca = me.color_attributes
        if ATTRIBUTE in ca and 'Color' in ca:
            names = [a.name for a in ca]
            ca.render_color_index = names.index('Color')
            ca.active_color_index = names.index('Color')


def setup_weather_materials(textures_dir):
    """Wires every material with extras.weather (layer maps from `textures_dir`). Returns the count."""
    keep_vertex_colors()
    count = 0
    for mat in bpy.data.materials:
        if setup_material(mat, textures_dir):
            count += 1
    if count:
        log(f'{count} weathered materials')
    return count
