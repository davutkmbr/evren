"""
Builds a Blender scene from a compiled Evren area (world compiler format 1, public/world/<area>/).

    node scripts/blender-run.mjs scripts/blender/import_area.py -- [options]
      --area <id>            area folder under public/world (default kadikoy)
      --cameras <ids|all>    comma-separated camera ids of tools/world-compiler/s1/cameras.json, or "all"
                             (default: all); tiles are chosen around these cameras
      --camera <id>          make this camera the scene camera (default: the first selected one)
      --time day|dusk|night  apply a lighting preset (scripts/blender/lighting.py)
      --radius <m>           greybox / LOD1 tiles within this distance of a camera (default 700)
      --no-sea               leave out the sea stand-in plane
      --save <file.blend>    save the scene

What it builds:
- The strip tiles (index.strip.tiles, detail "full") at LOD0; every other tile within --radius of a camera and in
  front of it (or within 150 m) at LOD1 (greybox tiles have one glb for both levels).
- Props: every prop glb used by the imported tiles is imported once into the excluded collection "props_src"; each
  root node (variant) becomes a collection "prop:<id>:<variant>". Every manifest instance becomes a collection
  instance (an instanced, linked duplicate) at T(position) R(rotation) S(scale), converted to Blender axes.
- Lights: every manifest light becomes a Blender light (point / spot / area), power from candela or nits with the
  colour's luminance divided out, so the light delivers the manifest's lumens. Custom properties: night, source, ref.
- Emissive materials (extras.emissive: nits, night) get a Value node "evren_emission" driving the emission strength
  (nits / 683); lamp fixtures glow for camera rays only, because their light already has a light record.
- The sea: tiles contain no water (the runtime draws its own ocean), so a plane at y = 0 stands in for it.
- The camera: position / target of cameras.json, fovDeg as the vertical FOV, resolution at the camera's aspect
  inside a 1600 x 900 box (900 x 1600 for portrait frames). scripts/blender/camera-overrides.json can replace a
  pose for the renders (a critique fix waiting for the spec or hero lane; render.py applies its interiorViews); with
  `snapGround` the eye is re-snapped to the compiled ground + eyeHeight and the target moves by the same dy.
- Day-lit night fixtures (DAY_ON_LIGHT_REFS / DAY_ON_MATERIALS): market-stall bulbs burn by day too (c10 photo);
  the compiled records still say night: true, so the renders switch them on by day here.
- Weathering (format 1.1): materials with extras.weather get the shared node group "evren_weather"
  (scripts/blender/weather.py), which blends their dirt, streak, edge and damp layers by the `_WEATHER` vertex
  attribute; materials without weather data are unchanged.

Axes: Evren (x, y, z) -> Blender (x, -z, y); Evren quaternion [x, y, z, w] -> Blender (w, x, -z, y). The glTF
importer converts the tile and prop glbs itself.

Cycles device (use_cycles_device, used by render.py and bake_ao.py): EVREN_CYCLES_DEVICE=CPU|GPU picks it; without
it, previews (render.py --scale < 100) run on the CPU and full-size renders and AO bakes on the Metal GPU. A Cycles
job pins the GPU at ~97 % and starves the desktop (WindowServer), while CPU threads under blender-run's `nice` share
fairly. CPU jobs use EVREN_CYCLES_THREADS threads (default 7) when Blender runs without -t; blender-run passes -t
(default 4), which takes precedence, so pass `--threads 7` to blender-run for faster CPU previews.
"""

import argparse
import json
import math
import os
import re
import sys
import time

import bpy
from mathutils import Quaternion, Vector

ROOT = os.environ.get('EVREN_ROOT') or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
CAMERAS_JSON = os.path.join(ROOT, 'tools', 'world-compiler', 's1', 'cameras.json')
LUMENS_PER_WATT = 683.0
FRAME_BOX = (1600, 900)
NEAR_KEEP_M = 150.0
VIEW_MARGIN_DEG = 20.0
OVERRIDES_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'camera-overrides.json')
# Night-only fixtures that are lit by day as well (covered market stalls: the c10 day photo shows burning bulbs).
DAY_ON_LIGHT_REFS = ('/stall-bulb',)
DAY_ON_MATERIALS = ('fac_bulb',)


CPU_THREADS = 7


def log(*args):
    print('[evren]', *args, flush=True)


def use_cycles_device(scene, default_gpu):
    """Sets the Cycles device from EVREN_CYCLES_DEVICE (CPU | GPU), else GPU when `default_gpu`. Returns 'CPU' or
    'GPU' (GPU falls back to CPU when no Metal device is found)."""
    want = (os.environ.get('EVREN_CYCLES_DEVICE') or '').strip().upper()
    gpu = want == 'GPU' if want in ('CPU', 'GPU') else bool(default_gpu)
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    found = False
    for d in prefs.devices:
        d.use = (d.type == 'METAL') if gpu else (d.type == 'CPU')
        found = found or (gpu and d.use)
    device = 'GPU' if found else 'CPU'
    scene.cycles.device = device
    if device == 'CPU':
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = max(1, int(os.environ.get('EVREN_CYCLES_THREADS') or CPU_THREADS))
    return device


def script_args(argv=None):
    argv = sys.argv if argv is None else argv
    return argv[argv.index('--') + 1:] if '--' in argv else []


def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def to_blender(p):
    """Evren (x, y, z) -> Blender (x, -z, y)."""
    return Vector((p[0], -p[2], p[1]))


def dir_to_blender(d):
    return Vector((d[0], -d[2], d[1])).normalized()


def quat_to_blender(q):
    """Evren unit quaternion [x, y, z, w] -> Blender Quaternion (w, x, y, z)."""
    return Quaternion((q[3], q[0], -q[2], q[1]))


def scale_to_blender(s):
    if s is None:
        return (1.0, 1.0, 1.0)
    if isinstance(s, (int, float)):
        return (float(s),) * 3
    return (s[0], s[2], s[1])


def luminance(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


# ---------------------------------------------------------------------------------------------------------------
# Area, cameras and tile choice


class Area:
    def __init__(self, area_id):
        self.id = area_id
        self.dir = os.path.join(ROOT, 'public', 'world', area_id)
        self.index = load_json(os.path.join(self.dir, 'index.json'))
        self.cameras_doc = load_json(CAMERAS_JSON) if os.path.exists(CAMERAS_JSON) else {'cameras': []}
        self.cameras = {c['id']: c for c in self.cameras_doc.get('cameras', [])}
        for cid, o in (load_overrides().get('cameras') or {}).items():
            if cid in self.cameras:
                apply_pose_override(self.cameras[cid], o)

    def select_cameras(self, spec):
        if not spec or spec == 'all':
            return list(self.cameras.values())
        out = []
        for cid in spec.split(','):
            cid = cid.strip()
            match = self.cameras.get(cid) or next((c for k, c in self.cameras.items() if k.startswith(cid + '-') or k == cid), None)
            if not match:
                raise SystemExit(f'unknown camera {cid}; known: {", ".join(self.cameras)}')
            out.append(match)
        return out

    def tile_manifest(self, tile):
        return load_json(os.path.join(self.dir, tile['manifest']))


def load_overrides():
    """scripts/blender/camera-overrides.json: {cameras: {id: pose}, interiorViews: {id: pose}} ({} when missing)."""
    return load_json(OVERRIDES_JSON) if os.path.exists(OVERRIDES_JSON) else {}


def apply_pose_override(cam, o):
    """Replaces a camera record's pose with an override entry (position, target, optional fovDeg, snapGround)."""
    cam['poseOverride'] = {'from': {'position': list(cam['position']), 'target': list(cam['target']), 'fovDeg': cam.get('fovDeg')}, 'why': o.get('why', '')}
    cam['position'], cam['target'] = list(o['position']), list(o['target'])
    if o.get('fovDeg'):
        cam['fovDeg'] = o['fovDeg']
    cam['snapGround'] = bool(o.get('snapGround'))
    return cam


def camera_heading_deg(cam):
    p, t = cam['position'], cam['target']
    return math.degrees(math.atan2(t[0] - p[0], -(t[2] - p[2]))) % 360.0


def camera_hfov_deg(cam):
    v = math.radians(cam['fovDeg'])
    return math.degrees(2.0 * math.atan(math.tan(v / 2.0) * cam.get('aspect', 1.5)))


def square_distance(b, x, z):
    dx = max(b['minX'] - x, 0.0, x - b['maxX'])
    dz = max(b['minZ'] - z, 0.0, z - b['maxZ'])
    return math.hypot(dx, dz)


def square_in_view(b, cam):
    px, pz = cam['position'][0], cam['position'][2]
    heading = camera_heading_deg(cam)
    half = camera_hfov_deg(cam) / 2.0 + VIEW_MARGIN_DEG
    xs = (b['minX'], (b['minX'] + b['maxX']) / 2.0, b['maxX'])
    zs = (b['minZ'], (b['minZ'] + b['maxZ']) / 2.0, b['maxZ'])
    for x in xs:
        for z in zs:
            bearing = math.degrees(math.atan2(x - px, -(z - pz)))
            if abs((bearing - heading + 180.0) % 360.0 - 180.0) <= half:
                return True
    return False


def select_tiles(area, cams, radius):
    """[(tile entry, lod entry)]: strip tiles at LOD0, other tiles near / in front of a camera at LOD1."""
    strip = set((area.index.get('strip') or {}).get('tiles', []))
    out = []
    for t in area.index['tiles']:
        lods = t.get('lods') or [{'level': 0, 'glb': t['glb']}]
        full = t['id'] in strip or t.get('detail') == 'full'
        if not full:
            if cams:
                keep = False
                for c in cams:
                    d = square_distance(t['bounds'], c['position'][0], c['position'][2])
                    if d <= NEAR_KEEP_M or (d <= radius and square_in_view(t['bounds'], c)):
                        keep = True
                        break
                if not keep:
                    continue
        level = 0 if full else 1
        lod = next((l for l in lods if l['level'] == level), lods[-1])
        out.append((t, lod))
    return out


# ---------------------------------------------------------------------------------------------------------------
# Import


def ensure_collection(name, parent=None):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(coll)
    return coll


def layer_collection(name, lc=None):
    lc = lc or bpy.context.view_layer.layer_collection
    if lc.collection.name == name:
        return lc
    for child in lc.children:
        found = layer_collection(name, child)
        if found:
            return found
    return None


def import_glb(path, collection):
    """Imports one glb and moves its new objects into `collection`. Returns the new objects."""
    before = set(bpy.data.objects)
    for attempt in range(2):
        try:
            bpy.ops.import_scene.gltf(filepath=path, import_shading='NORMALS', merge_vertices=False, import_scene_extras=True, loglevel=40)
            break
        except Exception as e:  # a lane may be rewriting the file right now
            if attempt:
                log(f'WARNING import failed, skipped: {path}: {e}')
                return []
            time.sleep(2.0)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        collection.objects.link(o)
    return new


def material_signature(m):
    if not m.use_nodes or not m.node_tree:
        return ('flat',)
    parts = []
    for n in m.node_tree.nodes:
        img = getattr(n, 'image', None)
        parts.append((n.bl_idname, img.name if img else ''))
    return tuple(sorted(parts))


def dedupe_materials():
    """The importer makes one material per glb; merge 'wall.001' into 'wall' when the node trees are equal."""
    merged = 0
    for m in list(bpy.data.materials):
        mm = re.match(r'^(.*)\.\d{3,}$', m.name)
        if not mm:
            continue
        base = bpy.data.materials.get(mm.group(1))
        if base is None or base == m or material_signature(base) != material_signature(m):
            continue
        m.user_remap(base)
        bpy.data.materials.remove(m)
        merged += 1
    return merged


class PropLibrary:
    def __init__(self, area):
        self.area = area
        self.src = ensure_collection('props_src')
        lc = layer_collection('props_src')
        if lc:
            lc.exclude = True
        self.props = {}

    def get(self, prop_id, variant=None):
        if prop_id not in self.props:
            self.props[prop_id] = self._load(prop_id)
        entry = self.props[prop_id]
        if entry is None:
            return None
        whole, variants = entry
        if variant:
            return variants.get(variant)
        return whole

    def _load(self, prop_id):
        info = (self.area.index.get('props') or {}).get(prop_id)
        if not info:
            log(f'WARNING prop {prop_id} is not in index.props')
            return None
        path = os.path.join(self.area.dir, info['glb'])
        whole = bpy.data.collections.new(f'prop:{prop_id}')
        self.src.children.link(whole)
        new = import_glb(path, whole)
        variants = {}
        for r in [o for o in new if o.parent is None]:
            vname = re.sub(r'\.\d{3,}$', '', r.name)
            vc = bpy.data.collections.new(f'prop:{prop_id}:{vname}')
            whole.children.link(vc)
            for o in [r, *r.children_recursive]:
                whole.objects.unlink(o)
                vc.objects.link(o)
            variants[vname] = vc
        whole['castShadow'] = bool(info.get('castShadow', True))
        return whole, variants


def add_instances(manifest, props, coll, stats):
    for k, inst in enumerate(manifest.get('instances') or []):
        target = props.get(inst['asset'], inst.get('variant'))
        if target is None:
            stats['instancesSkipped'] += 1
            continue
        e = bpy.data.objects.new(inst.get('ref') or f"{manifest['id']}/i{k}", None)
        e.instance_type = 'COLLECTION'
        e.instance_collection = target
        e.location = to_blender(inst['position'])
        e.rotation_mode = 'QUATERNION'
        e.rotation_quaternion = quat_to_blender(inst.get('rotation') or [0, 0, 0, 1])
        e.scale = scale_to_blender(inst.get('scale'))
        e['asset'] = inst['asset']
        if inst.get('seed') is not None:
            e['seed'] = inst['seed']
        coll.objects.link(e)
        stats['instances'] += 1


def add_light(rec, coll):
    kind = rec['type']
    color = rec.get('color') or [1.0, 1.0, 1.0]
    y = max(luminance(color), 1e-3)
    if kind == 'area':
        data = bpy.data.lights.new(rec['id'], 'AREA')
        size = rec.get('size') or 1.0
        if isinstance(size, (list, tuple)):
            data.shape = 'RECTANGLE'
            data.size, data.size_y = size[0], size[1]
            area_m2 = size[0] * size[1]
        else:
            data.shape = 'SQUARE'
            data.size = size
            area_m2 = size * size
        nits = rec.get('intensity') or 0.0
        watts = math.pi * nits * area_m2 / LUMENS_PER_WATT / y
    else:
        data = bpy.data.lights.new(rec['id'], 'SPOT' if kind == 'spot' else 'POINT')
        cd = rec.get('intensity')
        if cd is None:
            cd = (rec.get('lumens') or 0.0) / (4.0 * math.pi)
        watts = cd * 4.0 * math.pi / LUMENS_PER_WATT / y
        data.shadow_soft_size = 0.08
        if kind == 'spot':
            cone = rec.get('cone') or {'inner': 30, 'outer': 45}
            data.spot_size = math.radians(2.0 * cone['outer'])
            data.spot_blend = max(0.0, min(1.0, 1.0 - cone['inner'] / max(cone['outer'], 1e-3)))
    data.color = color[:3]
    data.energy = watts
    data.use_shadow = bool(rec.get('castShadow', True))
    obj = bpy.data.objects.new(rec['id'], data)
    obj.location = to_blender(rec['position'])
    if kind in ('spot', 'area'):
        d = dir_to_blender(rec.get('direction') or [0, -1, 0])
        obj.rotation_mode = 'QUATERNION'
        obj.rotation_quaternion = (-d).to_track_quat('Z', 'Y')
    obj.visible_camera = False
    obj['night'] = bool(rec.get('night'))
    obj['dayOn'] = any((rec.get('ref') or '').endswith(suffix) for suffix in DAY_ON_LIGHT_REFS)
    obj['source'] = rec.get('source') or 'other'
    obj['energy'] = watts
    if rec.get('ref'):
        obj['ref'] = rec['ref']
    coll.objects.link(obj)
    return obj


def setup_emissive_materials():
    """Emission strength = Value node 'evren_emission' (set by the lighting presets). Lamp fixtures glow for camera
    and transmission rays only: their light (and its highlights) is already a manifest light, and a tiny 20000-nit
    glass seen by rough glossy bounces is a firefly source."""
    count = 0
    for m in bpy.data.materials:
        e = m.get('emissive')
        if not e or not m.use_nodes:
            continue
        e = e.to_dict() if hasattr(e, 'to_dict') else dict(e)
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
        if bsdf is None:
            continue
        if nt.nodes.get('evren_emission') is None:
            col = bsdf.inputs['Emission Color']
            y = 1.0 if col.is_linked else max(luminance(col.default_value), 1e-3)
            value = nt.nodes.new('ShaderNodeValue')
            value.name = value.label = 'evren_emission'
            value['nits'] = float(e.get('nits') or 0.0)
            value['night'] = bool(e.get('night'))
            value['dayOn'] = re.sub(r'\.\d{3,}$', '', m.name) in DAY_ON_MATERIALS
            value['luminance'] = y
            value.outputs[0].default_value = 0.0
            src = value.outputs[0]
            if (e.get('source') or '') == 'lamp':
                path = nt.nodes.new('ShaderNodeLightPath')
                a = nt.nodes.new('ShaderNodeMath')
                a.operation = 'MAXIMUM'
                nt.links.new(path.outputs['Is Camera Ray'], a.inputs[0])
                nt.links.new(path.outputs['Is Transmission Ray'], a.inputs[1])
                mul = nt.nodes.new('ShaderNodeMath')
                mul.operation = 'MULTIPLY'
                nt.links.new(a.outputs[0], mul.inputs[0])
                nt.links.new(value.outputs[0], mul.inputs[1])
                src = mul.outputs[0]
                m.cycles.emission_sampling = 'NONE'
            nt.links.new(src, bsdf.inputs['Emission Strength'])
            count += 1
    return count


def setup_weather(area_dir):
    """Weathering node group on every material with extras.weather (scripts/blender/weather.py)."""
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    import weather

    return weather.setup_weather_materials(os.path.join(area_dir, 'textures'))


def set_emission(night_on):
    """Sets every 'evren_emission' node: nits / 683 / luminance of the emission colour, 0 for night-only
    materials by day (except DAY_ON_MATERIALS)."""
    for m in bpy.data.materials:
        if not m.use_nodes or not m.node_tree:
            continue
        v = m.node_tree.nodes.get('evren_emission')
        if v is None:
            continue
        on = night_on or not v.get('night', False) or v.get('dayOn', False)
        v.outputs[0].default_value = (v['nits'] / LUMENS_PER_WATT / v['luminance']) if on else 0.0


# Sea stand-in: wind waves as three layered bump normals (wavelength, bump distance in m). Slopes of ~0.1-0.2 break
# the mirror into the glitter path and soft streaks of a real harbour; a blue-green body colour for the water seen
# from above. Waves are stretched across the (north-easterly) wind.
SEA_WAVES = ((4.0, 0.30), (1.4, 0.10), (0.5, 0.035))
SEA_WAVE_STRENGTH = 0.6
SEA_ROUGHNESS = 0.12
SEA_COLOR = (0.018, 0.058, 0.062, 1.0)


def add_sea(area, coll):
    b = area.index.get('rect') or area.index['areaBounds']
    cx, cz = (b['minX'] + b['maxX']) / 2.0, (b['minZ'] + b['maxZ']) / 2.0
    size = 12000.0
    mesh = bpy.data.meshes.new('sea')
    h = size / 2.0
    mesh.from_pydata([(-h, -h, 0), (h, -h, 0), (h, h, 0), (-h, h, 0)], [], [(0, 1, 2, 3)])
    obj = bpy.data.objects.new('sea_standin', mesh)
    obj.location = to_blender([cx, 0.0, cz])
    mat = bpy.data.materials.new('sea_standin')
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = SEA_COLOR
    bsdf.inputs['Roughness'].default_value = SEA_ROUGHNESS
    bsdf.inputs['IOR'].default_value = 1.333
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Rotation'].default_value = (0.0, 0.0, math.radians(35.0))
    mapping.inputs['Scale'].default_value = (1.0, 0.45, 1.0)
    nt.links.new(coord.outputs['Object'], mapping.inputs['Vector'])
    normal = None
    for k, (wavelength, distance) in enumerate(SEA_WAVES):
        noise = nt.nodes.new('ShaderNodeTexNoise')
        noise.noise_dimensions = '4D'
        noise.inputs['Scale'].default_value = 1.0 / wavelength
        noise.inputs['Detail'].default_value = 2.0
        noise.inputs['Roughness'].default_value = 0.5
        w = next((i for i in noise.inputs if i.name == 'W'), None)
        if w is not None:
            w.default_value = 1.7 * k
        nt.links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = SEA_WAVE_STRENGTH
        bump.inputs['Distance'].default_value = distance
        nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
        if normal is not None:
            nt.links.new(normal, bump.inputs['Normal'])
        normal = bump.outputs['Normal']
    nt.links.new(normal, bsdf.inputs['Normal'])
    mesh.materials.append(mat)
    obj['standIn'] = 'sea: tiles carry no water; the runtime draws its own ocean'
    coll.objects.link(obj)
    return obj


def build(area_id='kadikoy', cameras=None, radius=700.0, sea=True, picks=None, lights=True):
    """Imports the area around `cameras` (camera records) into the current (emptied) scene, or the given
    [(tile entry, lod entry)] `picks`. Returns (area, summary)."""
    t0 = time.time()
    scene = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    area = Area(area_id)
    if area.index.get('format') != 1:
        raise SystemExit(f"{area.dir}/index.json is format {area.index.get('format')}; compile format 1 first")
    if picks is None:
        picks = select_tiles(area, cameras or [], radius)
    tiles_coll = ensure_collection('tiles')
    inst_coll = ensure_collection('instances')
    light_coll = ensure_collection('lights')
    misc_coll = ensure_collection('standins')
    props = PropLibrary(area)
    stats = {'tiles': 0, 'lod0': 0, 'lod1': 0, 'instances': 0, 'instancesSkipped': 0, 'lights': 0, 'triangles': 0}
    for tile, lod in picks:
        path = os.path.join(area.dir, lod['glb'])
        if not os.path.exists(path):
            log(f'WARNING missing {path}')
            continue
        objs = import_glb(path, tiles_coll)
        for o in objs:
            o['tile'] = tile['id']
            o['lodLevel'] = lod['level']
        stats['tiles'] += 1
        stats['lod0' if lod['level'] == 0 else 'lod1'] += 1
        stats['triangles'] += lod.get('triangles') or 0
        try:
            manifest = area.tile_manifest(tile)
        except Exception as e:
            log(f"WARNING manifest {tile['manifest']}: {e}")
            continue
        add_instances(manifest, props, inst_coll, stats)
        for rec in (manifest.get('lights') or []) if lights else []:
            add_light(rec, light_coll)
            stats['lights'] += 1
    stats['materialsMerged'] = dedupe_materials()
    stats['emissiveMaterials'] = setup_emissive_materials()
    stats['weatheredMaterials'] = setup_weather(area.dir)
    stats['props'] = sorted(k for k, v in props.props.items() if v)
    if sea:
        add_sea(area, misc_coll)
    scene['evren_area'] = area_id
    scene['evren_index_hash'] = area.index.get('hash', '')
    scene['evren_tiles'] = ','.join(t['id'] for t, _ in picks)
    stats['seconds'] = round(time.time() - t0, 1)
    log('import', json.dumps(stats))
    return area, stats


# ---------------------------------------------------------------------------------------------------------------
# Camera


def frame_size(aspect, box=FRAME_BOX):
    w, h = box if aspect >= 1.0 else (box[1], box[0])
    if w / h > aspect:
        w = round(h * aspect)
    else:
        h = round(w / aspect)
    return int(w), int(h)


def setup_camera(cam_rec, box=FRAME_BOX):
    scene = bpy.context.scene
    name = cam_rec['id']
    obj = bpy.data.objects.get(name)
    if obj is None:
        data = bpy.data.cameras.new(name)
        obj = bpy.data.objects.new(name, data)
        ensure_collection('cameras').objects.link(obj)
    data = obj.data
    data.sensor_fit = 'VERTICAL'
    data.sensor_height = 24.0
    data.lens = 12.0 / math.tan(math.radians(cam_rec['fovDeg']) / 2.0)
    data.clip_start = 0.1
    data.clip_end = 6000.0
    pos = to_blender(cam_rec['position'])
    tgt = to_blender(cam_rec['target'])
    if cam_rec.get('snapGround'):
        ground = ground_below(pos)
        if ground is not None:
            dz = ground + cam_rec.get('eyeHeight', 1.6) - pos.z
            pos.z += dz
            tgt.z += dz
            cam_rec['snapped'] = {'groundY': round(ground, 3), 'dy': round(dz, 3), 'position': [round(pos.x, 3), round(pos.z, 3), round(-pos.y, 3)], 'target': [round(tgt.x, 3), round(tgt.z, 3), round(-tgt.y, 3)]}
    obj.location = pos
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (tgt - pos).to_track_quat('-Z', 'Y')
    scene.camera = obj
    w, h = frame_size(cam_rec.get('aspect', 1.5), box)
    scene.render.resolution_x, scene.render.resolution_y = w, h
    data.clip_start = clip_out_of_enclosure(obj)
    return obj


def ground_below(pos, above=1.0, depth=12.0):
    """Height (Blender z) of the first upward-facing tile surface under `pos` (props, people and awnings skipped)."""
    scene = bpy.context.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()
    start = Vector((pos.x, pos.y, pos.z + above))
    down = Vector((0.0, 0.0, -1.0))
    left = depth
    for _ in range(16):
        hit, loc, normal, _i, obj, _m = scene.ray_cast(depsgraph, start, down, distance=left)
        if not hit:
            return None
        if obj is not None and obj.get('tile') is not None and normal.z > 0.5:
            return loc.z
        left -= (start.z - loc.z) + 0.01
        start = loc + down * 0.01
        if left <= 0.0:
            return None
    return None


ENCLOSED_MIN_DIRS = 20


def eye_enclosure(origin, scene=None, depsgraph=None):
    """How many of 26 directions (cube corners, edges and faces) first hit a back face within 60 m of `origin`."""
    scene = scene or bpy.context.scene
    depsgraph = depsgraph or bpy.context.evaluated_depsgraph_get()
    count = 0
    for x in (-1, 0, 1):
        for y in (-1, 0, 1):
            for z in (-1, 0, 1):
                if x == y == z == 0:
                    continue
                d = Vector((x, y, z)).normalized()
                hit, _loc, normal, *_ = scene.ray_cast(depsgraph, origin, d, distance=60.0)
                if hit and normal.dot(d) > 0.0:
                    count += 1
    return count


def clip_out_of_enclosure(cam_obj, grid=5, max_layers=4):
    """Near clip distance that gets a camera out of geometry enclosing it. A pose fitted to a photo taken from a
    window or a passage can sit a metre or two inside a compiled block; a ray whose first hit is a back face starts
    inside a volume. For a grid of rays over the frame, the depth (along the view axis) at which each such ray leaves
    the volume is found; the near clip is the largest of them plus 5 cm (0.1 m when no ray starts inside).
    Only an eye inside a closed volume (at least ENCLOSED_MIN_DIRS of 26 directions first hit a back face) counts:
    single-sided awnings, umbrellas and open shopfronts seen from below or behind also return back faces, and must not
    push the near clip through the foreground."""
    scene = bpy.context.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()
    m = cam_obj.matrix_world
    origin = m.translation.copy()
    if eye_enclosure(origin, scene, depsgraph) < ENCLOSED_MIN_DIRS:
        return 0.1
    forward = (m.to_3x3() @ Vector((0, 0, -1))).normalized()
    frame = cam_obj.data.view_frame(scene=scene)
    best = 0.0
    for i in range(grid):
        for j in range(grid):
            u, v = i / (grid - 1), j / (grid - 1)
            top = frame[0].lerp(frame[3], u)
            bottom = frame[1].lerp(frame[2], u)
            local = bottom.lerp(top, v)
            d = (m.to_3x3() @ local).normalized()
            start, travelled, exit_at = origin.copy(), 0.0, 0.0
            for _ in range(max_layers):
                hit, loc, normal, *_ = scene.ray_cast(depsgraph, start, d, distance=60.0)
                if not hit or normal.dot(d) < 0.0:
                    break
                step = (loc - start).length + 0.02
                travelled += step
                exit_at = travelled
                start = loc + d * 0.02
            if exit_at > 0.0:
                best = max(best, exit_at * d.dot(forward))
    return best + 0.05 if best > 0.0 else 0.1


def main():
    p = argparse.ArgumentParser(prog='import_area.py')
    p.add_argument('--area', default='kadikoy')
    p.add_argument('--cameras', default='all')
    p.add_argument('--camera', default=None)
    p.add_argument('--time', choices=['day', 'dusk', 'night'], default=None)
    p.add_argument('--radius', type=float, default=700.0)
    p.add_argument('--no-sea', action='store_true')
    p.add_argument('--save', default=None)
    a = p.parse_args(script_args())
    area = Area(a.area)
    cams = area.select_cameras(a.cameras)
    area, _ = build(a.area, cams, a.radius, sea=not a.no_sea)
    cam = area.select_cameras(a.camera)[0] if a.camera else (cams[0] if cams else None)
    if cam:
        setup_camera(cam)
    if a.time:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import lighting
        lighting.apply(a.time)
    if a.save:
        path = os.path.abspath(a.save)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
        log('saved', path)


if __name__ == '__main__':
    main()
