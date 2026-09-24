"""
Renders the S1 reference cameras (tools/world-compiler/s1/cameras.json) from the compiled area with Cycles on the
Metal GPU. The scene is imported once (import_area.py) and every camera / time is rendered from it.

    node scripts/blender-run.mjs --timeout 3600 scripts/blender/render.py -- [options]
      --area <id>             default kadikoy
      --cameras <ids|all>     comma-separated camera ids or id prefixes (c01, c04-haldun-taner), default all
      --times <auto|list>     auto (default) = each camera's own times; a list (day,dusk,night) is intersected with
                              each camera's times unless --any-time is given
      --samples <n>           max samples per pixel by day (adaptive, default 128)
      --night-samples <n>     max samples per pixel at dusk and night (many small lights, default 384)
      --threshold <x>         adaptive sampling noise threshold (default 0.02)
      --scale <pct>           resolution percentage for quick tests (default 100)
      --radius <m>            LOD1 tiles within this distance of a camera (default 700)
      --exposure auto|preset  auto (default): each camera is metered from a 160 px pre-render (log-average
                              luminance to middle grey) within -1..+2 stops (day), +-1.5 (dusk)
                              or -1.5..+1 (night) of the preset's exposure; preset: the preset's exposure only
      --ev <EV100>            fixed exposure (turns metering off); --bias <stops> bias on the preset's exposure
      --out <dir>             default .shots/s1/renders
      --no-sea                leave out the sea stand-in
      --save-blend <file>     save the scene after rendering (for inspection)

Output: <out>/<camera>-<time>.png (8-bit sRGB, AgX) and <out>/<camera>-<time>.json (settings, timings, preset).
Samples are denoised with OpenImageDenoise (albedo + normal, on the GPU). AO is render-time: Cycles path traces full
global illumination, so contact shadows in corners, reveals and under soffits come from the geometry itself.
"""

import argparse
import json
import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import import_area  # noqa: E402
import lighting  # noqa: E402

ROOT = import_area.ROOT
CLAMP_DISPLAY = 10.0  # indirect samples are clamped at 10x display white (scaled by the exposure: fireflies at night)


def log(*args):
    print('[evren:render]', *args, flush=True)


def setup_cycles(samples, threshold, scale):
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
    c.adaptive_threshold = threshold
    c.use_denoising = True
    c.denoiser = 'OPENIMAGEDENOISE'
    c.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    c.denoising_prefilter = 'ACCURATE'
    c.denoising_quality = 'HIGH'
    c.denoising_use_gpu = gpu
    c.use_light_tree = True
    c.max_bounces = 8
    c.diffuse_bounces = 3
    c.glossy_bounces = 3
    c.transmission_bounces = 6
    c.transparent_max_bounces = 12
    c.volume_bounces = 0
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.sample_clamp_direct = 0.0
    c.sample_clamp_indirect = 0.0  # set per camera from the exposure
    c.blur_glossy = 1.0
    c.seed = 0
    scene.render.use_persistent_data = True
    scene.render.resolution_percentage = scale
    scene.render.film_transparent = False
    s = scene.render.image_settings
    s.file_format = 'PNG'
    s.color_mode = 'RGB'
    s.color_depth = '8'
    s.compression = 30
    return c.device


def main():
    p = argparse.ArgumentParser(prog='render.py')
    p.add_argument('--area', default='kadikoy')
    p.add_argument('--cameras', default='all')
    p.add_argument('--times', default='auto')
    p.add_argument('--any-time', action='store_true')
    p.add_argument('--samples', type=int, default=128)
    p.add_argument('--night-samples', type=int, default=384)
    p.add_argument('--threshold', type=float, default=0.02)
    p.add_argument('--scale', type=int, default=100)
    p.add_argument('--radius', type=float, default=700.0)
    p.add_argument('--ev', type=float, default=None)
    p.add_argument('--bias', type=float, default=None)
    p.add_argument('--exposure', choices=['auto', 'preset'], default='auto')
    p.add_argument('--out', default=os.path.join(ROOT, '.shots', 's1', 'renders'))
    p.add_argument('--no-sea', action='store_true')
    p.add_argument('--save-blend', default=None)
    a = p.parse_args(import_area.script_args())

    area = import_area.Area(a.area)
    cams = area.select_cameras(a.cameras)
    jobs = []
    for cam in cams:
        own = cam.get('times') or ['day']
        wanted = own if a.times == 'auto' else [t.strip() for t in a.times.split(',')]
        for t in wanted:
            if t in own or a.any_time:
                jobs.append((t, cam))
    if not jobs:
        raise SystemExit('nothing to render (check --cameras / --times against the cameras\' own times)')
    order = {'day': 0, 'dusk': 1, 'night': 2}
    jobs.sort(key=lambda j: (order.get(j[0], 9), j[1]['id']))
    log(f'{len(jobs)} renders:', ', '.join(f"{c['id']}-{t}" for t, c in jobs))

    area, stats = import_area.build(a.area, cams, a.radius, sea=not a.no_sea)
    device = setup_cycles(a.samples, a.threshold, a.scale)
    out_dir = os.path.abspath(a.out)
    os.makedirs(out_dir, exist_ok=True)
    results = []
    current = None
    preset = None
    for t, cam in jobs:
        if t != current:
            preset = lighting.apply(t, ev=a.ev, bias=a.bias)
            current = t
            bpy.context.scene.cycles.samples = a.samples if t == 'day' else a.night_samples
        cam_obj = import_area.setup_camera(cam)
        scene = bpy.context.scene
        scene.render.resolution_percentage = a.scale
        clip = round(cam_obj.data.clip_start, 2)
        if clip > 0.1:
            log(f"{cam['id']}: camera starts inside geometry; near clip moved to {clip} m")
        exposure = {'preset': preset['exposure'], 'final': preset['exposure'], 'mode': a.exposure}
        if a.exposure == 'auto' and a.ev is None:
            exposure.update(lighting.auto_exposure(t, preset['exposure']))
        else:
            scene.view_settings.exposure = preset['exposure']
        scene.cycles.sample_clamp_indirect = CLAMP_DISPLAY * 2.0 ** -scene.view_settings.exposure
        name = f"{cam['id']}-{t}"
        scene.render.filepath = os.path.join(out_dir, name + '.png')
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        secs = round(time.time() - t0, 1)
        res = [scene.render.resolution_x * scene.render.resolution_percentage // 100, scene.render.resolution_y * scene.render.resolution_percentage // 100]
        meta = {
            'camera': cam['id'],
            'label': cam.get('label'),
            'time': t,
            'file': os.path.relpath(scene.render.filepath, ROOT),
            'referencePhoto': (cam.get('referencePhotos') or {}).get(t) or cam.get('referencePhoto'),
            'referenceSameTime': t in (cam.get('referencePhotos') or {}),
            'seconds': secs,
            'device': device,
            'samples': bpy.context.scene.cycles.samples,
            'adaptiveThreshold': a.threshold,
            'clampIndirect': round(scene.cycles.sample_clamp_indirect, 4),
            'resolution': res,
            'fovDeg': cam['fovDeg'],
            'clipStart': clip,
            'aspect': cam.get('aspect'),
            'preset': preset,
            'exposure': exposure,
            'indexHash': area.index.get('hash'),
            'import': stats,
        }
        with open(os.path.join(out_dir, name + '.json'), 'w', encoding='utf-8') as f:
            json.dump(meta, f, indent=1)
        results.append({'name': name, 'seconds': secs, 'resolution': res})
        log(f"{name}: {secs} s at {res[0]}x{res[1]}, exposure {exposure['final']}")
    if a.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.save_blend), compress=True)
    log('done', json.dumps(results))


main()
