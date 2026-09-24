"""
Renders the S1 reference cameras (tools/world-compiler/s1/cameras.json) from the compiled area with Cycles on the
Metal GPU. The scene is imported once (import_area.py) and every camera / time is rendered from it.

    node scripts/blender-run.mjs --timeout 3600 scripts/blender/render.py -- [options]
      --area <id>             default kadikoy
      --cameras <ids|all>     comma-separated camera ids or id prefixes (c01, c04-haldun-taner), interior view ids
                              (cafe, cafe-in, cafe-counter), "interiors", or hero lane views (h01, h03, h04 of
                              scripts/blender/hero/cameras.json); default all = every camera of cameras.json plus the
                              street and inside views of every interior
      --times <auto|list>     auto (default) = each camera's own times; a list (day,dusk,night) is intersected with
                              each camera's times unless --any-time is given
      --samples <n>           max samples per pixel by day (adaptive, default 128)
      --night-samples <n>     max samples per pixel at dusk and night (many small lights, default 384)
      --interior-night-samples <n>  interior street views at night (the dim, indirectly lit parasol underside
                              came out blotchy at 384; default 1024)
      --threshold <x>         adaptive sampling noise threshold (default 0.02)
      --scale <pct>           resolution percentage for quick tests (default 100)
      --radius <m>            LOD1 tiles within this distance of a camera (default 700)
      --exposure auto|preset  auto (default): each camera is metered from a 160 px pre-render (log-average
                              luminance to middle grey; centre-weighted by day) within -1..+5 stops (day), +-1.5
                              (dusk) or -1.5..+1 (night) of the preset's exposure, and at dusk and night held down so
                              the brightest 3 % of the frame (lit shop windows, interiors) stay below white
                              (lighting.HIGHLIGHT_CAP); preset: the preset's exposure only
      --ev <EV100>            fixed exposure (turns metering off); --bias <stops> bias on the preset's exposure
      --wb <kelvin>           view white balance instead of the preset's (lighting.WHITE_BALANCE)
      --interior-ev <EV100>   one fixed exposure for every interior view by day instead of INTERIOR_EV
      --out <dir>             default .shots/s1/renders
      --no-sea                leave out the sea stand-in
      --save-blend <file>     save the scene after rendering (for inspection)

Interior views come from the interior records of the compiled strip tiles (extra.interiors[].views, hero lane):
'<kind>' from the sidewalk through the open door, '<kind>-in' from inside, '<kind>-counter' at the counter.
Pose overrides (scripts/blender/camera-overrides.json): 'cameras' replace cameras.json poses (import_area.py),
'interiorViews' the views of the interior records (the café street view stands 2 m further out and 1.7 m aside,
out from under the parasol). Exposure of the interior views: INTERIOR_EV (fixed EV100 per view and time: inside by
day the room sits under the daylight at the open front; at night the pendants and walls keep their texture); a
view / time not listed there (the street view) is metered like a street camera, so the café interior sits under
the shaded street by day.

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
INTERIOR_VIEWS = (('street', ''), ('inside', '-in'), ('counter', '-counter'))
INTERIOR_DEFAULT_VIEWS = ('street', 'inside')
INTERIOR_EV = {('inside', 'day'): 9.5, ('counter', 'day'): 9.5, ('inside', 'night'): 9.0, ('counter', 'night'): 9.0}


def log(*args):
    print('[evren:render]', *args, flush=True)


def interior_cameras(area):
    """{id: camera record} from the interior records of the strip tiles (extra.interiors[].views)."""
    out, kinds = {}, {}
    strip = set((area.index.get('strip') or {}).get('tiles', []))
    for tile in area.index['tiles']:
        if tile['id'] not in strip:
            continue
        try:
            manifest = area.tile_manifest(tile)
        except (OSError, ValueError):
            continue
        for rec in (manifest.get('extra') or {}).get('interiors') or []:
            views = rec.get('views') or {}
            kind = rec.get('kind') or 'interior'
            kinds[kind] = kinds.get(kind, 0) + 1
            base = kind if kinds[kind] == 1 else f'{kind}{kinds[kind]}'
            for key, suffix in INTERIOR_VIEWS:
                v = views.get(key)
                if not v:
                    continue
                cid = base + suffix
                out[cid] = {
                    'id': cid,
                    'label': f"{rec.get('name') or base} ({key} view, {rec.get('building', '')})",
                    'position': list(v['position']),
                    'target': list(v['target']),
                    'fovDeg': v['fovDeg'],
                    'aspect': v.get('aspect', 1.5),
                    'times': ['day', 'night'],
                    'eyeHeight': 1.6,
                    'interior': True,
                    'interiorView': key,
                    'interiorRecord': rec.get('id'),
                }
    for cid, o in (import_area.load_overrides().get('interiorViews') or {}).items():
        if cid in out:
            import_area.apply_pose_override(out[cid], o)
    return out


def hero_cameras():
    """{id: camera record} of the hero lane's extra views (scripts/blender/hero/cameras.json, read only)."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hero', 'cameras.json')
    if not os.path.exists(path):
        return {}
    with open(path, 'r', encoding='utf-8') as f:
        return {c['id']: dict(c, eyeHeight=c.get('eyeHeight', 1.6)) for c in json.load(f).get('cameras', [])}


def select(area, spec):
    """Camera records for --cameras: cameras.json ids / prefixes, interior view ids, 'interiors', hero view ids /
    prefixes (h01, h03-loggia-close; not part of 'all') or 'all'."""
    interiors = interior_cameras(area)
    heroes = hero_cameras()
    defaults = [c for c in interiors.values() if c['interiorView'] in INTERIOR_DEFAULT_VIEWS]
    if not spec or spec == 'all':
        return area.select_cameras('all') + defaults
    out, rest = [], []
    for token in [t.strip() for t in spec.split(',') if t.strip()]:
        hero = heroes.get(token) or next((c for k, c in heroes.items() if k.startswith(token + '-')), None)
        if token == 'all':
            out += area.select_cameras('all') + defaults
        elif token == 'interiors':
            out += defaults
        elif token in interiors:
            out.append(interiors[token])
        elif hero is not None:
            out.append(hero)
        else:
            rest.append(token)
    if rest:
        out += area.select_cameras(','.join(rest))
    seen, unique = set(), []
    for c in out:
        if c['id'] not in seen:
            seen.add(c['id'])
            unique.append(c)
    return unique


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
    p.add_argument('--interior-night-samples', type=int, default=1024)
    p.add_argument('--threshold', type=float, default=0.02)
    p.add_argument('--scale', type=int, default=100)
    p.add_argument('--radius', type=float, default=700.0)
    p.add_argument('--ev', type=float, default=None)
    p.add_argument('--bias', type=float, default=None)
    p.add_argument('--exposure', choices=['auto', 'preset'], default='auto')
    p.add_argument('--interior-ev', type=float, default=None)
    p.add_argument('--wb', type=float, default=None)
    p.add_argument('--out', default=os.path.join(ROOT, '.shots', 's1', 'renders'))
    p.add_argument('--no-sea', action='store_true')
    p.add_argument('--save-blend', default=None)
    a = p.parse_args(import_area.script_args())

    area = import_area.Area(a.area)
    cams = select(area, a.cameras)
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
            preset = lighting.apply(t, ev=a.ev, bias=a.bias, wb_kelvin=a.wb)
            current = t
        samples = a.samples if t == 'day' else (a.interior_night_samples if cam.get('interiorView') == 'street' else a.night_samples)
        bpy.context.scene.cycles.samples = samples
        cam_obj = import_area.setup_camera(cam)
        scene = bpy.context.scene
        scene.render.resolution_percentage = a.scale
        clip = round(cam_obj.data.clip_start, 2)
        if clip > 0.1:
            log(f"{cam['id']}: camera starts inside geometry; near clip moved to {clip} m")
        exposure = {'preset': preset['exposure'], 'final': preset['exposure'], 'mode': a.exposure}
        t_meter = time.time()
        interior_ev = None
        if cam.get('interior') and a.ev is None:
            interior_ev = a.interior_ev if (a.interior_ev is not None and t == 'day') else INTERIOR_EV.get((cam.get('interiorView'), t))
        if interior_ev is not None:
            fixed = round(lighting.exposure_for_ev(interior_ev), 2)
            exposure.update({'mode': 'interior', 'ev100': interior_ev, 'final': fixed})
            scene.view_settings.exposure = fixed
        elif a.exposure == 'auto' and a.ev is None:
            exposure.update(lighting.auto_exposure(t, preset['exposure']))
        else:
            scene.view_settings.exposure = preset['exposure']
        meter_secs = round(time.time() - t_meter, 1)
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
            'meterSeconds': meter_secs,
            'device': device,
            'samples': bpy.context.scene.cycles.samples,
            'adaptiveThreshold': a.threshold,
            'clampIndirect': round(scene.cycles.sample_clamp_indirect, 4),
            'resolution': res,
            'fovDeg': cam['fovDeg'],
            'clipStart': clip,
            'aspect': cam.get('aspect'),
            'position': (cam.get('snapped') or {}).get('position') or cam['position'],
            'target': (cam.get('snapped') or {}).get('target') or cam['target'],
            'poseOverride': cam.get('poseOverride'),
            'groundSnap': cam.get('snapped'),
            'interior': bool(cam.get('interior')),
            'dayOn': list(import_area.DAY_ON_LIGHT_REFS + import_area.DAY_ON_MATERIALS) if t == 'day' else [],
            'preset': preset,
            'exposure': exposure,
            'indexHash': area.index.get('hash'),
            'import': stats,
        }
        with open(os.path.join(out_dir, name + '.json'), 'w', encoding='utf-8') as f:
            json.dump(meta, f, indent=1)
        results.append({'name': name, 'seconds': secs, 'meterSeconds': meter_secs, 'resolution': res})
        log(f"{name}: {secs} s at {res[0]}x{res[1]}, exposure {exposure['final']}")
    if a.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.save_blend), compress=True)
    log('done', json.dumps(results))


main()
