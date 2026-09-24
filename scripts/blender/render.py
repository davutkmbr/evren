"""
Renders the S1 reference cameras (tools/world-compiler/s1/cameras.json) from the compiled area with Cycles. The
scene is imported once (import_area.py) and every camera / time is rendered from it.

Device: EVREN_CYCLES_DEVICE=CPU|GPU; without it, previews (--scale < 100) render on the CPU (7 threads when Blender
runs without -t; blender-run's -t, default 4, takes precedence, so use `blender-run --threads 7`) and full-size renders
on the Metal GPU, which pins the GPU and can freeze the desktop (import_area.use_cycles_device).

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
      --sky hdri|physical     hdri (default): each camera and time gets the sky of scripts/blender/skies.json (the
                              reference photo's weather, sun at the photo's capture time; skies.py); physical: the
                              preset's physical sky for every camera (the previous look)
      --weather <preset|auto> atmosphere for every camera: none (no atmosphere, no camera effects), clear, haze
                              (humid seaside haze), overcast, wet (after rain), mist (volumetric night mist); auto
                              (default): each camera's own preset in scripts/blender/skies.json (atmosphere.py)
      --no-post               write the render straight to PNG (no haze, bloom, lens, vignette, grade or grain)
      --match <0..1>          how far post.py moves the grade towards the reference photo's statistics (default 0.6)
      --fstop <f>             depth of field of eye-level cameras (default 4; 0 turns it off)

Interior views come from the interior records of the compiled strip tiles (extra.interiors[].views, hero lane):
'<kind>' from the sidewalk through the open door, '<kind>-in' from inside, '<kind>-counter' at the counter.
Pose overrides (scripts/blender/camera-overrides.json): 'cameras' replace cameras.json poses (import_area.py),
'interiorViews' the views of the interior records (the café street view stands 2 m further out and 1.7 m aside,
out from under the parasol). Exposure of the interior views: INTERIOR_EV (fixed EV100 per view and time: inside by
day the room sits under the daylight at the open front; at night the pendants and walls keep their texture); a
view / time not listed there (the street view) is metered like a street camera, so the café interior sits under
the shaded street by day.

Output: <out>/<camera>-<time>.png (8-bit sRGB, AgX) and <out>/<camera>-<time>.json (settings, timings, preset,
sky, post-process and grade statistics); <out>/raw/<camera>-<time>.exr (scene-linear image and depth before the
post-process; post.py re-runs the post on it without rendering); <out>/look/surfaces.json (the flat-roughness
materials that got render-time micro detail, for the runtimes).
Look (the realism pass): per-camera HDRI sky and sun (skies.py), an atmosphere preset (atmosphere.py: wet ground,
aerial perspective, volumetric night mist), micro roughness (surface.py), subtle depth of field at eye level, then
post.py: aerial perspective, bloom, halation, lens dirt, lens distortion and chromatic aberration, vignette, a grade
matched to the reference photo, grain that grows with the exposure.
Samples are denoised with OpenImageDenoise (albedo + normal, on the GPU when rendering there). AO is render-time: Cycles path traces full
global illumination, so contact shadows in corners, reveals and under soffits come from the geometry itself.
"""

import argparse
import json
import math
import os
import sys
import time
import zlib

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atmosphere  # noqa: E402
import import_area  # noqa: E402
import lighting  # noqa: E402
import post  # noqa: E402
import skies  # noqa: E402
import surface  # noqa: E402

ROOT = import_area.ROOT
CLAMP_DISPLAY = 10.0  # indirect samples are clamped at 10x display white (scaled by the exposure: fireflies at night)
INTERIOR_VIEWS = (('street', ''), ('inside', '-in'), ('counter', '-counter'))
INTERIOR_DEFAULT_VIEWS = ('street', 'inside')
INTERIOR_EV = {('inside', 'day'): 9.5, ('counter', 'day'): 9.5, ('inside', 'night'): 9.0, ('counter', 'night'): 9.0}
DOF_NEAR_SKIP_M = 3.5   # focus on the first surface beyond this distance on the optical axis (not a passer-by)
DOF_FAR_M = 80.0


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
    gpu = import_area.use_cycles_device(scene, default_gpu=scale >= 100) == 'GPU'
    c = scene.cycles
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


def setup_dof(cam_obj, cam_rec, fstop):
    """Subtle depth of field for eye-level cameras (full-frame equivalent: the sensor is 24 mm high): focus on the
    first surface beyond DOF_NEAR_SKIP_M on the optical axis. Returns the settings or None."""
    data = cam_obj.data
    data.dof.use_dof = False
    if not fstop or not cam_rec.get('eyeHeight'):
        return None
    scene = bpy.context.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()
    m = cam_obj.matrix_world
    origin = m.translation.copy()
    forward = (m.to_3x3() @ Vector((0.0, 0.0, -1.0))).normalized()
    start, travelled, focus = origin + forward * DOF_NEAR_SKIP_M, DOF_NEAR_SKIP_M, DOF_FAR_M
    hit, loc, *_ = scene.ray_cast(depsgraph, start, forward, distance=DOF_FAR_M - DOF_NEAR_SKIP_M)
    if hit:
        focus = travelled + (loc - start).length
    data.dof.use_dof = True
    data.dof.focus_distance = focus
    data.dof.aperture_fstop = fstop
    data.dof.aperture_blades = 7
    return {'fstop': fstop, 'focusDistance': round(focus, 2), 'lensMm': round(data.lens, 1)}


def raw_output(scene, on):
    """Render output: a multilayer float EXR with depth (for post.py) or the display PNG (--no-post)."""
    s = scene.render.image_settings
    scene.view_layers[0].use_pass_z = on
    scene.view_layers[0].use_pass_position = on
    scene.render.use_compositing = False
    if hasattr(s, 'media_type'):  # Blender 5: multilayer EXR is a media type
        s.media_type = 'MULTI_LAYER_IMAGE' if on else 'IMAGE'
    if on:
        s.file_format = 'OPEN_EXR_MULTILAYER'
        s.color_depth = '32'
        s.exr_codec = 'ZIP'
        s.color_mode = 'RGBA'
    else:
        s.file_format = 'PNG'
        s.color_mode = 'RGB'
        s.color_depth = '8'
        s.compression = 30


HAZE_COLUMNS = 48
HAZE_SUN_CAP = 2.0


def haze_columns(cam_rec, preset):
    """Horizon radiance (Blender units) of the sky in the direction of HAZE_COLUMNS evenly spaced pixel columns: from
    the HDRI, or (physical sky) one colour estimated from the sky illuminance (horizon about 1.3x the mean radiance)."""
    info = lighting.world_info()
    heading = import_area.camera_heading_deg(cam_rec)
    half = math.radians(import_area.camera_hfov_deg(cam_rec) / 2.0)
    cols = []
    for i in range(HAZE_COLUMNS):
        xn = (i + 0.5) / HAZE_COLUMNS * 2.0 - 1.0
        az = heading + math.degrees(math.atan(xn * math.tan(half)))
        rgb = skies.horizon_rgb(info, az, 10.0) if info else None
        if rgb is None:
            lux = preset.get('skyLux') or (0.12 if preset.get('time') == 'night' else 0.0)
            k = 1.3 * lux / lighting.LUMENS_PER_WATT / math.pi
            rgb = [0.92 * k, 0.97 * k, 1.08 * k]
        cols.append(rgb)
    # The aureole round a low sun makes the horizon there tens of times brighter; haze within a few hundred metres
    # never reaches that radiance (a phone photo keeps the buildings under the sun as silhouettes), so no column may
    # exceed HAZE_SUN_CAP x the median column.
    lums = sorted(lighting.luminance(c) for c in cols)
    cap = HAZE_SUN_CAP * max(lums[len(lums) // 2], 1e-12)
    out = []
    for c in cols:
        y = lighting.luminance(c)
        k = min(1.0, cap / y) if y > 0 else 1.0
        out.append([round(v * k, 6) for v in c])
    return out


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
    p.add_argument('--sky', choices=['hdri', 'physical'], default='hdri')
    p.add_argument('--no-post', action='store_true')
    p.add_argument('--match', type=float, default=post.MATCH)
    p.add_argument('--fstop', type=float, default=4.0)
    p.add_argument('--weather', default='auto')
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

    def sky_of(t, cam):
        rec = skies.record(cam['id'], t)
        return rec if a.sky == 'hdri' else dict(rec, id='physical')

    jobs.sort(key=lambda j: (order.get(j[0], 9), sky_of(*j).get('hdri') or '', j[1]['id']))
    log(f'{len(jobs)} renders:', ', '.join(f"{c['id']}-{t}" for t, c in jobs))

    area, stats = import_area.build(a.area, cams, a.radius, sea=not a.no_sea)
    device = setup_cycles(a.samples, a.threshold, a.scale)
    out_dir = os.path.abspath(a.out)
    os.makedirs(out_dir, exist_ok=True)
    raw_dir = os.path.join(out_dir, 'raw')
    os.makedirs(raw_dir, exist_ok=True)
    surfaces = surface.setup()
    os.makedirs(os.path.join(out_dir, 'look'), exist_ok=True)
    with open(os.path.join(out_dir, 'look', 'surfaces.json'), 'w', encoding='utf-8') as f:
        json.dump(surfaces, f, indent=1)
    raw_output(bpy.context.scene, not a.no_post)
    results = []
    current = None
    preset = None
    for t, cam in jobs:
        sky = sky_of(t, cam)
        key = (t, json.dumps(sky, sort_keys=True))
        if key != current:
            if sky.get('hdri'):
                skies.free_except({sky['hdri']})
            preset = lighting.apply(t, ev=a.ev, bias=a.bias, wb_kelvin=a.wb, sky=sky)
            current = key
        atm = atmosphere.resolve(cam['id'], t, None if a.weather == 'auto' else a.weather)
        surface.set_wet(atm['wet'])
        samples = a.samples if t == 'day' else (a.interior_night_samples if cam.get('interiorView') == 'street' else a.night_samples)
        bpy.context.scene.cycles.samples = samples
        cam_obj = import_area.setup_camera(cam)
        fog = atmosphere.set_fog(atm.get('fog'), cam_obj)
        dof = setup_dof(cam_obj, cam, a.fstop if atm.get('camera', True) else 0.0)
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
        png = os.path.join(out_dir, name + '.png')
        raw = os.path.join(raw_dir, name + '.exr')
        scene.render.filepath = png if a.no_post else raw
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        secs = round(time.time() - t0, 1)
        post_summary = None
        if not a.no_post:
            t1 = time.time()
            photo_rel = (cam.get('referencePhotos') or {}).get(t)
            columns = haze_columns(cam, preset)
            params = post.params_for(t, atmosphere.post_params(atm))
            params.update({'exposure': scene.view_settings.exposure, 'cameraZ': round(cam_obj.matrix_world.translation.z, 3),
                           'hazeColumns': columns})
            view = {'look': scene.view_settings.look, 'whiteBalance': preset['whiteBalance']}
            post_summary = post.run(raw, png, params, view, photo=os.path.join(ROOT, photo_rel) if photo_rel else None,
                                    match=a.match, vfov_deg=cam['fovDeg'], seed=zlib.crc32(name.encode()) & 0xFFFF,
                                    size=(scene.render.resolution_x * scene.render.resolution_percentage // 100,
                                          scene.render.resolution_y * scene.render.resolution_percentage // 100))
            post_summary['seconds'] = round(time.time() - t1, 1)
        res = [scene.render.resolution_x * scene.render.resolution_percentage // 100, scene.render.resolution_y * scene.render.resolution_percentage // 100]
        meta = {
            'camera': cam['id'],
            'label': cam.get('label'),
            'time': t,
            'file': os.path.relpath(png, ROOT),
            'raw': None if a.no_post else os.path.relpath(raw, ROOT),
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
            'sky': {k: v for k, v in sky.items() if k not in ('post', 'atmosphere', 'fog')},
            'atmosphere': {'name': atm['name'], 'wet': atm['wet'], 'fog': fog, 'postParams': atmosphere.post_params(atm)},
            'hazeColumns': None if a.no_post else columns,
            'dof': dof,
            'post': post_summary,
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
