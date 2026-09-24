"""
Preview renders of the hero pieces (hero lane): the 1926 pier and the café interior seen through its open door. The
scene import, lighting presets and exposure metering are the Blender lane's (scripts/blender/import_area.py,
lighting.py); this script only adds the hero cameras.

    node scripts/blender-run.mjs --timeout 1800 scripts/blender/hero/render_hero.py -- [options]
      --area <id>          compiled area under public/world (default kadikoy)
      --cams <list>        comma-separated: a camera id (prefix) of tools/world-compiler/s1/cameras.json, a camera
                           of scripts/blender/hero/cameras.json, or "cafe" / "cafe-in" (built from the interior
                           record of the compiled tiles: from the sidewalk through the open door, or from inside)
      --times <list>       day,night (default day)
      --samples <n>        default 48
      --scale <pct>        resolution percentage (default 60)
      --radius <m>         LOD1 tiles within this distance of a camera (default 300)
      --out <dir>          default .shots/s1/hero
      --bias <stops>       exposure bias on the preset
      --ev <EV100>         fixed exposure (interiors: about 6)
"""

import argparse
import glob
import json
import math
import os
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import import_area  # noqa: E402
import lighting  # noqa: E402

ROOT = import_area.ROOT


def log(*args):
    print('[evren:hero]', *args, flush=True)


def setup_cycles(samples, scale):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    gpu = False
    for d in prefs.devices:
        d.use = d.type == 'METAL'
        gpu = gpu or d.use
    c = scene.cycles
    c.device = 'GPU' if gpu else 'CPU'
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.03
    c.use_denoising = True
    c.denoiser = 'OPENIMAGEDENOISE'
    c.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    c.denoising_use_gpu = gpu
    c.use_light_tree = True
    c.max_bounces = 6
    c.diffuse_bounces = 3
    c.glossy_bounces = 2
    c.transparent_max_bounces = 8
    c.sample_clamp_indirect = 8.0
    c.seed = 0
    scene.render.use_persistent_data = True
    scene.render.resolution_percentage = scale
    s = scene.render.image_settings
    s.file_format = 'PNG'
    s.color_mode = 'RGB'
    s.color_depth = '8'
    return c.device


def cafe_cameras(area_dir):
    """Cameras built from the interior records: from the sidewalk through the open door, and from inside."""
    out = []
    for path in sorted(glob.glob(os.path.join(area_dir, 'tiles', '*.json'))):
        with open(path, encoding='utf-8') as f:
            m = json.load(f)
        for rec in (m.get('extra') or {}).get('interiors') or []:
            v = rec.get('views') or {}
            for key, cid in (('street', 'cafe'), ('inside', 'cafe-in'), ('counter', 'cafe-counter')):
                cam = v.get(key)
                if cam:
                    out.append({'id': cid, 'label': f"{rec.get('name')} ({key})", 'position': cam['position'], 'target': cam['target'], 'fovDeg': cam['fovDeg'], 'aspect': cam.get('aspect', 1.5), 'times': ['day', 'night']})
    return out


def main():
    p = argparse.ArgumentParser(prog='render_hero.py')
    p.add_argument('--area', default='kadikoy')
    p.add_argument('--cams', default='c01')
    p.add_argument('--times', default='day')
    p.add_argument('--samples', type=int, default=48)
    p.add_argument('--scale', type=int, default=60)
    p.add_argument('--radius', type=float, default=300.0)
    p.add_argument('--out', default=os.path.join(ROOT, '.shots', 's1', 'hero'))
    p.add_argument('--bias', type=float, default=None)
    p.add_argument('--ev', type=float, default=None, help='fixed EV100 (no metering), e.g. 6 for an interior')
    a = p.parse_args(import_area.script_args())

    area = import_area.Area(a.area)
    own = {}
    own_path = os.path.join(HERE, 'cameras.json')
    if os.path.exists(own_path):
        with open(own_path, encoding='utf-8') as f:
            for c in json.load(f)['cameras']:
                own[c['id']] = c
    for c in cafe_cameras(area.dir):
        own[c['id']] = c
    cams = []
    for cid in [x.strip() for x in a.cams.split(',') if x.strip()]:
        cams.append(own[cid] if cid in own else area.select_cameras(cid)[0])
    times = [t.strip() for t in a.times.split(',')]
    area, stats = import_area.build(a.area, cams, a.radius, sea=True)
    device = setup_cycles(a.samples, a.scale)
    os.makedirs(a.out, exist_ok=True)
    results = []
    for t in times:
        preset = lighting.apply(t, ev=a.ev, bias=a.bias)
        for cam in cams:
            obj = import_area.setup_camera(cam)
            scene = bpy.context.scene
            scene.render.resolution_percentage = a.scale
            exp = lighting.auto_exposure(t, preset['exposure']) if a.ev is None else {'final': preset['exposure']}
            name = f"{cam['id']}-{t}"
            scene.render.filepath = os.path.join(os.path.abspath(a.out), name + '.png')
            t0 = time.time()
            bpy.ops.render.render(write_still=True)
            secs = round(time.time() - t0, 1)
            results.append({'name': name, 'seconds': secs, 'exposure': exp.get('final'), 'clip': round(obj.data.clip_start, 2)})
            log(name, secs, 's')
    with open(os.path.join(a.out, 'last-run.json'), 'w', encoding='utf-8') as f:
        json.dump({'area': a.area, 'device': device, 'samples': a.samples, 'scale': a.scale, 'import': stats, 'renders': results}, f, indent=1)
    log('done', json.dumps(results))


main()
