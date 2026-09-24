"""
Atmosphere presets for the S1 reference renders (scripts/blender/skies.json "atmospheres"; render.py --weather picks
one for every camera, otherwise each camera and time uses its own). A preset sets:

- wet (0..1): wet ground in the render (surface.py): darker, glossier, standing water above 0.35;
- aerial perspective (post.py): visibility (Koschmieder: extinction 3.912 / visibility), a height scale (the haze
  thins exponentially above the sea: a ray climbing a facade crosses less of it than one along the street), a start
  distance; the haze takes the colour of the sky's horizon in each pixel's direction, so it is brighter and warmer
  towards the sun and never a uniform grey veil;
- fog (night mist): a volume around the camera in Cycles (single scattering, forward-scattering phase function), whose
  density falls exponentially with height above the ground at the camera and drifts in patches, with fine
  "dust" variation; the lamps light it (halos, cones under lanterns), which a post effect cannot fake;
- camera (bool): False turns every camera effect of post.py off (the plain A of an A/B/C comparison).
A camera's own keys in skies.json (wet, fog, post values) override its preset (a fog block is merged into the
preset's), unless --weather forces another.
"""

import math

import bpy

FOG_OBJECT = 'evren_fog'
FOG_MATERIAL = 'evren_fog'
EYE_HEIGHT = 1.6
POST_KEYS = ('visibilityKm', 'hazeHeightM', 'hazeStart', 'camera')


def log(*args):
    print('[evren:atmosphere]', *args, flush=True)


def resolve(cam_id, time_of_day, override=None):
    """The atmosphere of a camera and time: {name, wet, fog, visibilityKm, hazeHeightM, hazeStart, camera, post}."""
    import skies

    d = skies.doc()
    presets = d.get('atmospheres') or {}
    own = dict((d.get('defaults') or {}).get(time_of_day) or {})
    own.update(((d.get('cameras') or {}).get(cam_id) or {}).get(time_of_day) or {})
    name = override or own.get('atmosphere') or 'haze'
    if name not in presets:
        raise SystemExit(f"unknown atmosphere '{name}'; known: {', '.join(presets)}")
    out = {k: v for k, v in presets[name].items() if k != 'note'}
    if not override:
        for k in ('wet', 'fog', *POST_KEYS):
            if k not in own:
                continue
            if k == 'fog' and isinstance(own[k], dict) and isinstance(out.get('fog'), dict):
                out['fog'] = dict(out['fog'], **own[k])
            else:
                out[k] = own[k]
        out['post'] = dict(own.get('post') or {})
    out.setdefault('post', {})
    out.setdefault('wet', 0.0)
    out.setdefault('camera', True)
    out['name'] = name
    return out


def post_params(atm):
    """post.py overrides from an atmosphere (haze, camera switch, the camera's post block)."""
    out = {k: atm[k] for k in POST_KEYS if k in atm}
    out.update(atm.get('post') or {})
    return out


def _fog_material():
    mat = bpy.data.materials.get(FOG_MATERIAL)
    if mat is not None:
        return mat
    mat = bpy.data.materials.new(FOG_MATERIAL)
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    vol = nt.nodes.new('ShaderNodeVolumePrincipled')
    vol.name = 'volume'
    nt.links.new(vol.outputs[0], out.inputs['Volume'])
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Position'], sep.inputs[0])

    def value(name, v=0.0):
        n = nt.nodes.new('ShaderNodeValue')
        n.name = name
        n.outputs[0].default_value = v
        return n.outputs[0]

    def math(op, a, b=None):
        n = nt.nodes.new('ShaderNodeMath')
        n.operation = op
        for i, x in enumerate((a, b)):
            if x is None:
                continue
            if isinstance(x, bpy.types.NodeSocket):
                nt.links.new(x, n.inputs[i])
            else:
                n.inputs[i].default_value = x
        return n.outputs[0]

    def noise(scale_sock, detail):
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.noise_dimensions = '3D'
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = 0.55
        nt.links.new(geo.outputs['Position'], n.inputs['Vector'])
        nt.links.new(scale_sock, n.inputs['Scale'])
        return n.outputs['Fac']

    sigma = value('fog_sigma')
    ground = value('fog_ground')
    scale_h = value('fog_height_scale', 15.0)
    dust = value('fog_dust')
    dust_scale = value('fog_dust_scale', 0.6)
    patch_scale = value('fog_patch_scale', 0.04)
    h = math('MAXIMUM', math('SUBTRACT', sep.outputs['Z'], ground), 0.0)
    base = math('MULTIPLY', math('EXPONENT', math('DIVIDE', math('MULTIPLY', h, -1.0), scale_h)), sigma)
    patches = math('ADD', math('MULTIPLY', math('SUBTRACT', noise(patch_scale, 2.0), 0.5), 1.2), 1.0)
    grains = math('ADD', math('MULTIPLY', math('SUBTRACT', noise(dust_scale, 3.0), 0.5), math('MULTIPLY', dust, 2.0)), 1.0)
    density = math('MULTIPLY', math('MULTIPLY', base, math('MAXIMUM', patches, 0.0)), math('MAXIMUM', grains, 0.0))
    nt.links.new(density, vol.inputs['Density'])
    vol.inputs['Absorption Color'].default_value = (0.0, 0.0, 0.0, 1.0)
    return mat


def set_fog(fog, cam_obj):
    """Places (fog dict) or hides (None) the fog volume around the camera. Returns a summary or None."""
    obj = bpy.data.objects.get(FOG_OBJECT)
    if not fog:
        if obj is not None:
            obj.hide_render = True
        return None
    mat = _fog_material()
    if obj is None:
        me = bpy.data.meshes.new(FOG_OBJECT)
        me.from_pydata([(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)], [],
                       [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
        me.materials.append(mat)
        obj = bpy.data.objects.new(FOG_OBJECT, me)
        bpy.context.scene.collection.objects.link(obj)
        obj.visible_shadow = False
    obj.hide_render = False
    ground = cam_obj.matrix_world.translation.z - EYE_HEIGHT
    r = float(fog.get('radiusM', 140.0))
    top = float(fog.get('heightM', 45.0))
    c = cam_obj.matrix_world.translation
    obj.location = (c.x, c.y, ground - 3.0)
    obj.scale = (r, r, top + 3.0)
    nodes = mat.node_tree.nodes
    sigma = 3.912 / max(float(fog.get('visibilityM', 600.0)), 1.0)
    nodes['fog_sigma'].outputs[0].default_value = sigma
    nodes['fog_ground'].outputs[0].default_value = ground
    nodes['fog_height_scale'].outputs[0].default_value = float(fog.get('heightScaleM', 14.0))
    nodes['fog_dust'].outputs[0].default_value = float(fog.get('dust', 0.4))
    nodes['fog_dust_scale'].outputs[0].default_value = 1.0 / max(float(fog.get('dustScaleM', 1.6)), 0.05)
    nodes['fog_patch_scale'].outputs[0].default_value = 1.0 / max(float(fog.get('patchScaleM', 25.0)), 1.0)
    vol = nodes['volume']
    a = float(fog.get('albedo', 0.92))
    vol.inputs['Color'].default_value = (a, a, a, 1.0)
    vol.inputs['Anisotropy'].default_value = float(fog.get('anisotropy', 0.7))
    c = bpy.context.scene.cycles
    for attr, v in (('volume_bounces', 0), ('volume_step_rate', 1.0), ('volume_max_steps', 512)):
        if hasattr(c, attr):
            setattr(c, attr, v)
    return {'sigma': round(sigma, 5), 'groundZ': round(ground, 2), 'radiusM': r, 'heightM': top,
            'heightScaleM': float(fog.get('heightScaleM', 14.0)), 'anisotropy': vol.inputs['Anisotropy'].default_value,
            'dust': float(fog.get('dust', 0.4)), 'meanFreePathM': round(1.0 / sigma) if sigma > 0 else math.inf}
