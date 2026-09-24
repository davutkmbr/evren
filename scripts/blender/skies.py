"""
HDRI skies for the S1 reference renders: CC0 Poly Haven "pure sky" HDRIs (tools/assets/approved.json, cached by
scripts/data/fetch-assets.mjs in assets-src/hdri/<id>/), one per camera and time of day, chosen to match the
reference photo (scripts/blender/skies.json).

Why pure skies: the compiled tiles already hold the city, so an urban HDRI would paint a foreign street into every
gap between tiles and add its ground bounce twice. A pure sky only adds what the scene lacks: the sky dome.

Per sky (lighting.apply calls build_world):
- Sun extraction. The sun of an unclipped HDRI is a few pixels holding most of the light. It is cut out (every pixel
  within SUN_REGION_DEG of the peak and brighter than SUN_CORE x the surrounding sky gets the ring's sky level) and
  replaced by a Sun lamp: crisp shadows, little noise, and a sun direction that can follow the photo.
- Orientation. The HDRI is turned about the vertical so that its sun sits at the azimuth of the target sun (the
  photo's capture time and place, lighting.solar_position); the lamp uses the target elevation.
- Calibration. Poly Haven HDRIs are not absolute, so each is scaled to a physical horizontal illuminance: clear and
  broken-cloud skies to the physical sky model (lighting's multiple-scattering sky) at the target sun, overcast
  skies to 300 + 21000 sin(sun elevation) lux (diffuse illuminance of an overcast sky, Krochmann & Seidl), night skies
  to the record's lux (urban skyglow), keeping the HDRI's own sun-to-sky ratio.
- Night skies are tinted (city light reflected by cloud) and dimmed; they carry no sun.
- The horizon radiance in the camera's direction is measured for the aerial-perspective haze (post.py).

Equirectangular convention (Cycles direction_to_equirectangular): u = 0.5 - atan2(y, x) / 2 pi (u = 0.5 looks
along +X = east, u = 0.25 along +Y = north), v = 0.5 + elevation / pi; Blender image rows run bottom to top.
"""

import json
import math
import os

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get('EVREN_ROOT') or os.path.abspath(os.path.join(HERE, '..', '..'))
SKIES_JSON = os.path.join(HERE, 'skies.json')
HDRI_DIR = os.path.join(ROOT, 'assets-src', 'hdri')
LUMENS_PER_WATT = 683.0
SUN_REGION_DEG = 3.5
SUN_RING_DEG = (4.0, 7.0)
SUN_CORE = 12.0          # a pixel is sun (not sky) above this multiple of the ring's sky luminance
SUN_MIN_PEAK = 150.0     # peak / ring luminance below this: the HDRI has no usable sun (overcast)
SUN_ANGLE_DEG = 0.53     # the real sun's angular diameter (crisp shadows, like the photos)
HORIZON_BAND_DEG = (0.5, 4.0)
OVERCAST_LUX = (300.0, 21000.0)

_analysis = {}
_doc = None


def log(*args):
    print('[evren:sky]', *args, flush=True)


def luminance(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def doc():
    global _doc
    if _doc is None:
        with open(SKIES_JSON, 'r', encoding='utf-8') as f:
            _doc = json.load(f)
    return _doc


def record(cam_id, time_of_day):
    """The sky record for a camera and time: defaults[time] overlaid with cameras[cam][time] and the sky's own
    definition ({id, hdri, kind, visibilityKm, ...} plus when, wet, grade, photo). None for the physical sky."""
    d = doc()
    rec = dict((d.get('defaults') or {}).get(time_of_day) or {})
    rec.update(((d.get('cameras') or {}).get(cam_id) or {}).get(time_of_day) or {})
    sky_id = rec.get('sky')
    if not sky_id or sky_id == 'physical':
        rec['id'] = 'physical'
        return rec
    sky = dict((d.get('skies') or {})[sky_id])
    sky.update({k: v for k, v in rec.items() if k != 'sky'})
    sky['id'] = sky_id
    return sky


def hdri_path(hdri_id):
    folder = os.path.join(HDRI_DIR, hdri_id)
    if not os.path.isdir(folder):
        return None
    files = sorted(f for f in os.listdir(folder) if f.lower().endswith(('.hdr', '.exr')))
    return os.path.join(folder, files[0]) if files else None


def _angles(w, h):
    el = (np.arange(h, dtype=np.float64) + 0.5) / h * math.pi - math.pi / 2.0
    phi = 2.0 * math.pi * (0.5 - (np.arange(w, dtype=np.float64) + 0.5) / w)
    return el, phi


def _unit(el, phi):
    el, phi = np.broadcast_arrays(el, phi)
    ce = np.cos(el)
    return np.stack([ce * np.cos(phi), ce * np.sin(phi), np.sin(el)], axis=-1)


def analyse(hdri_id):
    """Loads an HDRI, cuts its sun out into an in-memory image and measures it. Cached per session:
    {image, width, height, sun: {elevation, phi, irradiance[3]} | None, skyHorizontal[3], peakRatio, path}.
    Irradiances are in the HDRI's own units (radiance x steradian)."""
    if hdri_id in _analysis and bpy.data.images.get(_analysis[hdri_id]['image']) is not None:
        return _analysis[hdri_id]
    path = hdri_path(hdri_id)
    if path is None:
        raise FileNotFoundError(f'HDRI {hdri_id} is not cached in {HDRI_DIR} (node scripts/data/fetch-assets.mjs)')
    src = bpy.data.images.load(path, check_existing=True)
    w, h = src.size
    px = np.empty(w * h * 4, dtype=np.float32)
    src.pixels.foreach_get(px)
    bpy.data.images.remove(src)
    px = px.reshape(h, w, 4)
    rgb = px[:, :, :3].astype(np.float64)
    el, phi = _angles(w, h)
    d_omega = (2.0 * math.pi / w) * (math.pi / h) * np.cos(el)
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    upper = el > 0.0

    iy, ix = np.unravel_index(np.argmax(np.where(upper[:, None], lum, -1.0)), lum.shape)
    peak_dir = _unit(np.array(el[iy]), np.array(phi[ix]))
    band = np.nonzero(np.abs(el - el[iy]) <= math.radians(SUN_RING_DEG[1] + 1.0))[0]
    dirs = _unit(el[band][:, None], phi[None, :])
    ang = np.degrees(np.arccos(np.clip(dirs @ peak_dir, -1.0, 1.0)))
    ring = (ang >= SUN_RING_DEG[0]) & (ang <= SUN_RING_DEG[1])
    ring_rgb = np.median(rgb[band][ring], axis=0)
    ring_lum = max(luminance(ring_rgb), 1e-9)
    peak_ratio = float(lum[iy, ix] / ring_lum)
    sun = None
    if peak_ratio >= SUN_MIN_PEAK:
        region = (ang <= SUN_REGION_DEG) & (lum[band] > SUN_CORE * ring_lum)
        excess = np.clip(rgb[band] - ring_rgb, 0.0, None) * region[:, :, None] * d_omega[band][:, None, None]
        energy = excess.sum(axis=(0, 1))
        weight = excess @ np.array([0.2126, 0.7152, 0.0722])
        centre = (dirs * weight[:, :, None]).sum(axis=(0, 1))
        centre /= max(np.linalg.norm(centre), 1e-12)
        sub = rgb[band]
        sub[region] = ring_rgb
        rgb[band] = sub
        sun = {'elevation': math.degrees(math.asin(centre[2])), 'phi': math.degrees(math.atan2(centre[1], centre[0])),
               'irradiance': [float(x) for x in energy], 'pixels': int(region.sum())}
    sin_el = np.sin(np.clip(el, 0.0, None))
    sky_h = (rgb * (d_omega * sin_el)[:, None, None]).sum(axis=(0, 1))
    img = bpy.data.images.new(f'evren_hdri:{hdri_id}', w, h, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Linear Rec.709'
    out = np.empty((h, w, 4), dtype=np.float32)
    out[:, :, :3] = rgb
    out[:, :, 3] = 1.0
    img.pixels.foreach_set(out.ravel())
    img.update()
    hb = (el >= math.radians(HORIZON_BAND_DEG[0])) & (el <= math.radians(HORIZON_BAND_DEG[1]))
    res = {
        'image': img.name, 'width': w, 'height': h, 'sun': sun, 'skyHorizontal': [float(x) for x in sky_h],
        'peakRatio': round(peak_ratio, 1), 'path': os.path.relpath(path, ROOT),
        # horizon radiance per column (for the haze colour in a view direction), 1-degree bins of azimuth
        'horizon': _horizon_bins(rgb[hb], phi),
    }
    _analysis[hdri_id] = res
    log(hdri_id, json.dumps({k: v for k, v in res.items() if k != 'horizon'}))
    return res


def _horizon_bins(rows, phi, bins=360):
    """Mean radiance of the horizon band per 1-degree azimuth bin (math angle, bin k covers k..k+1 degrees)."""
    col = rows.mean(axis=0)
    deg = (np.degrees(phi) % 360.0).astype(int) % bins
    out = np.zeros((bins, 3))
    cnt = np.zeros(bins)
    np.add.at(out, deg, col)
    np.add.at(cnt, deg, 1)
    cnt[cnt == 0] = 1
    return (out / cnt[:, None]).tolist()


def free_except(keep_ids):
    """Removes the extracted images of HDRIs not in keep_ids (a 4k float image holds 128 MB)."""
    for hid in list(_analysis):
        if hid in keep_ids:
            continue
        img = bpy.data.images.get(_analysis[hid]['image'])
        if img is not None:
            bpy.data.images.remove(img)
        del _analysis[hid]


def compass_to_phi(azimuth_deg):
    """Compass azimuth (clockwise from north) -> math angle about +Z from +X (east), degrees."""
    return 90.0 - azimuth_deg


def build_world(world, sky, target_az, target_el, target_lux=None):
    """Builds `world` from the sky record: the extracted HDRI turned so its sun sits at `target_az`, scaled to
    `target_lux` (horizontal, sky + sun) or, for night skies, to the record's lux. Returns
    {scale, rotationDeg, sun: {energy, color, azimuth, elevation} | None, lux, skyLux, sunLux, horizonRgb(fn)}."""
    info = analyse(sky['hdri'])
    nt = world.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.name = 'evren_hdri'
    env.image = bpy.data.images[info['image']]
    env.interpolation = 'Linear'
    tint = nt.nodes.new('ShaderNodeMix')
    tint.data_type = 'RGBA'
    tint.blend_type = 'MULTIPLY'
    tint.inputs['Factor'].default_value = 1.0
    nt.links.new(coord.outputs['Generated'], mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], env.inputs['Vector'])
    nt.links.new(env.outputs['Color'], tint.inputs['A'])
    nt.links.new(tint.outputs['Result'], bg.inputs['Color'])
    nt.links.new(bg.outputs[0], out.inputs['Surface'])

    tint_rgb = sky.get('tint') or [1.0, 1.0, 1.0]
    ty = luminance(tint_rgb)
    tint_rgb = [c / ty for c in tint_rgb]
    tint.inputs['B'].default_value = (*tint_rgb, 1.0)
    sky_h = [a * b for a, b in zip(info['skyHorizontal'], tint_rgb)]
    sun = info['sun'] if sky.get('kind') == 'sun' else None
    if sun is not None:
        rotation = sun['phi'] - compass_to_phi(target_az)
    else:
        rotation = float(sky.get('rotationDeg', 0.0))
    mapping.inputs['Rotation'].default_value = (0.0, 0.0, math.radians(rotation))
    sin_t = math.sin(math.radians(max(target_el, 0.0))) if sun is not None else 0.0
    sun_h = [x * sin_t for x in sun['irradiance']] if sun is not None else [0.0, 0.0, 0.0]
    total = luminance(sky_h) + luminance(sun_h)
    if sky.get('kind') == 'night' or target_lux is None:
        target_lux = float(sky.get('lux', 0.15))
    scale = target_lux / LUMENS_PER_WATT / max(total, 1e-12)
    bg.inputs['Strength'].default_value = scale
    res = {'hdri': sky['hdri'], 'scale': scale, 'rotationDeg': round(rotation, 2), 'lux': round(target_lux, 3),
           'skyLux': round(luminance(sky_h) * scale * LUMENS_PER_WATT, 3), 'peakRatio': info['peakRatio'], 'sun': None}
    if sun is not None:
        e = [x * scale for x in sun['irradiance']]
        peak = max(e)
        res['sun'] = {'energy': peak, 'color': [x / peak for x in e], 'azimuth': target_az, 'elevation': target_el,
                      'hdriElevation': round(sun['elevation'], 2), 'lux': round(luminance(e) * sin_t * LUMENS_PER_WATT)}
    res['_horizon'] = [[c * t * scale for c, t in zip(row, tint_rgb)] for row in info['horizon']]
    res['_rotation'] = rotation
    return res


def horizon_rgb(world_info, heading_compass_deg, hfov_deg):
    """Mean horizon radiance (Blender units) of the sky over the camera's horizontal field of view."""
    bins = world_info.get('_horizon')
    if not bins:
        return None
    rot = world_info.get('_rotation', 0.0)
    centre = compass_to_phi(heading_compass_deg) + rot
    half = max(hfov_deg / 2.0, 1.0)
    acc = [0.0, 0.0, 0.0]
    n = 0
    k = centre - half
    while k <= centre + half:
        row = bins[int(math.floor(k)) % 360]
        acc = [a + b for a, b in zip(acc, row)]
        n += 1
        k += 1.0
    return [a / max(n, 1) for a in acc]


def overcast_lux(sun_elevation_deg):
    a, b = OVERCAST_LUX
    return a + b * math.sin(math.radians(max(sun_elevation_deg, 0.0)))

