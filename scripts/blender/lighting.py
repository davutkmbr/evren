"""
Lighting presets for the Seventeen Skies reference renders (imported by render.py and import_area.py; Blender units: 1 W = 683 lm).

- day:   Kadıköy, a September afternoon (default 2026-09-19 16:00 +03:00). Physical multiple-scattering sky
         (Blender's successor of the Nishita model) without its sun disc, plus a Sun lamp whose direction, colour and
         strength are measured from the same sky model, so sky and sun stay consistent and shadows stay clean.
- dusk:  blue hour on the same day (sun 5° below the horizon, after sunset); the same sky model, lamps, signs and
         windows on.
- night: 22:00, a dark urban sky with warm skyglow at the horizon; lamps, signs and windows on.

Exposure (AgX view transform, 'Medium High Contrast' look):
- Preset exposure. Day and dusk are metered like an incident-light meter on the horizontal illuminance of the sky
  (+ sun): EV100 = log2(E_lux * 100 / 250), Blender exposure = log2(0.18 * 683 / (12.5 * 2^EV / 100)) + bias (dusk
  -1.5 stops for the blue-hour look). Night uses EV100 3.5 (a surface under ~24 lx reads middle grey).
- Per camera (render.py --exposure auto, the default): the log-average luminance of a 160 px pre-render is mapped to
  middle grey, clamped to -1..+5 stops (day), +-1.5 (dusk) or -1.5..+1 (night) around the preset, like a camera's
  matrix meter in a narrow lane or a dark square. By day the meter is centre-weighted (the outer 20 % of the frame on
  every side is ignored), so a bright near wall at the frame edge does not darken a shaded lane. At dusk and night the
  result is also capped so the brightest 3 % of the frame (lit shop windows and interiors) sit 3.5 (dusk) or 4.5
  (night, lower-contrast look) stops over middle grey instead of burning out (HIGHLIGHT_CAP).
White balance (WHITE_BALANCE): the view transform is balanced like the phone photos, 6500 K by day, 5000 K at night
(the 2700-3300 K lamps and floodlights read golden as in the night photos, sodium orange, LED shop light neutral), 9000 K at dusk (the blue-hour sky light is 10000 K+; a
lower setting such as 5500 K makes the frame colder, not warmer). Light colours are unchanged.
Manifest lights and emissive materials with `night: true` are off by day (except import_area.DAY_ON_*).
"""

import datetime as dt
import math
import os
import tempfile

import bpy
from mathutils import Vector

LUMENS_PER_WATT = 683.0
KADIKOY_LAT = 40.991
KADIKOY_LON = 29.024
TZ = dt.timezone(dt.timedelta(hours=3))

PRESETS = {
    'day': {'when': dt.datetime(2026, 9, 19, 16, 0, tzinfo=TZ), 'bias': 0.0},
    'dusk': {'when': dt.datetime(2026, 9, 19, 18, 0, tzinfo=TZ), 'sunElevation': -5.0, 'bias': -1.5},
    'night': {'when': dt.datetime(2026, 9, 19, 22, 0, tzinfo=TZ), 'ev': 3.5, 'bias': 0.0},
}
VIEW_TRANSFORM = 'AgX'
LOOK = 'AgX - Medium High Contrast'
# Night uses the lower-contrast look (like a phone's night mode: lifted shadows, softer highlight shoulder). Tested on
# c11 / c10 / c01 at night: one stop more exposure with this look clips no more than the high-contrast look did at
# the old exposure (0.07 % against 0.08 % of c11's pixels) and lifts the lamp-lit pavement by about a stop.
LOOKS = {'night': 'AgX - Medium Low Contrast'}
SKY_ALTITUDE_M = 30.0


def log(*args):
    print('[evren:light]', *args, flush=True)


def luminance(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


# ---------------------------------------------------------------------------------------------------------------
# Sun position (NOAA solar calculator equations)


def solar_position(when, lat=KADIKOY_LAT, lon=KADIKOY_LON):
    """(azimuth deg clockwise from north, elevation deg) of the sun at `when` (aware datetime)."""
    utc = when.astimezone(dt.timezone.utc)
    jd = utc.timestamp() / 86400.0 + 2440587.5
    jc = (jd - 2451545.0) / 36525.0
    l0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360.0
    m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc)
    ecc = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)
    rm = math.radians(m)
    ctr = math.sin(rm) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + math.sin(2 * rm) * (0.019993 - 0.000101 * jc) + math.sin(3 * rm) * 0.000289
    omega = math.radians(125.04 - 1934.136 * jc)
    app_long = l0 + ctr - 0.00569 - 0.00478 * math.sin(omega)
    obliq = 23.0 + (26.0 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60.0) / 60.0 + 0.00256 * math.cos(omega)
    decl = math.asin(math.sin(math.radians(obliq)) * math.sin(math.radians(app_long)))
    y = math.tan(math.radians(obliq / 2.0)) ** 2
    rl0 = math.radians(l0)
    eq_time = 4.0 * math.degrees(y * math.sin(2 * rl0) - 2 * ecc * math.sin(rm) + 4 * ecc * y * math.sin(rm) * math.cos(2 * rl0) - 0.5 * y * y * math.sin(4 * rl0) - 1.25 * ecc * ecc * math.sin(2 * rm))
    minutes = utc.hour * 60.0 + utc.minute + utc.second / 60.0
    tst = (minutes + eq_time + 4.0 * lon) % 1440.0
    ha = math.radians(tst / 4.0 - 180.0)
    rlat = math.radians(lat)
    cos_zen = math.sin(rlat) * math.sin(decl) + math.cos(rlat) * math.cos(decl) * math.cos(ha)
    zen = math.acos(max(-1.0, min(1.0, cos_zen)))
    elevation = 90.0 - math.degrees(zen)
    az_num = math.sin(rlat) * math.cos(zen) - math.sin(decl)
    az_den = math.cos(rlat) * math.sin(zen)
    a = math.degrees(math.acos(max(-1.0, min(1.0, az_num / az_den)))) if abs(az_den) > 1e-9 else 0.0
    azimuth = (a + 180.0) % 360.0 if ha > 0 else (540.0 - a) % 360.0
    return azimuth, elevation


def time_for_elevation(date_from, elevation_deg, hours=6.0):
    """First time after `date_from` (within `hours`) at which the setting sun reaches `elevation_deg`."""
    lo, hi = date_from, date_from + dt.timedelta(hours=hours)
    if solar_position(lo)[1] < elevation_deg:
        return lo
    for _ in range(40):
        mid = lo + (hi - lo) / 2
        if solar_position(mid)[1] > elevation_deg:
            lo = mid
        else:
            hi = mid
    return lo


def to_sun_vector(azimuth_deg, elevation_deg):
    """Unit vector towards the sun in Blender axes (+X east, +Y north, +Z up)."""
    az, el = math.radians(azimuth_deg), math.radians(elevation_deg)
    return Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))


# ---------------------------------------------------------------------------------------------------------------
# World


def _world():
    scene = bpy.context.scene
    w = bpy.data.worlds.get('evren_world') or bpy.data.worlds.new('evren_world')
    scene.world = w
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    nt.links.new(bg.outputs[0], out.inputs['Surface'])
    return w, nt, bg


def sky_world(azimuth_deg, elevation_deg):
    w, nt, bg = _world()
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.name = 'evren_sky'
    sky.sky_type = 'MULTIPLE_SCATTERING'
    sky.sun_disc = False
    sky.sun_elevation = math.radians(elevation_deg)
    sky.sun_rotation = math.radians(azimuth_deg)
    sky.altitude = SKY_ALTITUDE_M
    nt.links.new(sky.outputs[0], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
    return w, sky


def night_world():
    """Urban night sky (Istanbul, measured city skyglow is 0.01-0.3 cd/m²): ~0.2 cd/m² warm skyglow in a band just
    above the horizon, fading to ~0.02 cd/m² grey-navy at the zenith; dark below the horizon. The sea stand-in reflects
    the band; the night photos (c01) show a dark grey, not a black, sky."""
    w, nt, bg = _world()

    def col(nits, rgb):
        k = nits / LUMENS_PER_WATT / luminance(rgb)
        return (rgb[0] * k, rgb[1] * k, rgb[2] * k, 1.0)

    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(coord.outputs['Generated'], sep.inputs[0])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -0.1
    mr.inputs['From Max'].default_value = 1.0
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    els = ramp.color_ramp.elements
    stops = [
        (0.0, 0.006, (0.3, 0.3, 0.3)),     # below the horizon
        (0.09, 0.2, (1.0, 0.62, 0.4)),     # horizon skyglow
        (0.16, 0.06, (0.55, 0.5, 0.5)),    # ~4 deg up
        (1.0, 0.02, (0.25, 0.3, 0.45)),    # zenith
    ]
    els[0].position, els[0].color = stops[0][0], col(stops[0][1], stops[0][2])
    els[1].position, els[1].color = stops[-1][0], col(stops[-1][1], stops[-1][2])
    for pos, nits, rgb in stops[1:-1]:
        e = els.new(pos)
        e.color = col(nits, rgb)
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    return w


# ---------------------------------------------------------------------------------------------------------------
# Metering: a tiny CPU render of a white horizontal plane under the current world


def _meter(world, disc):
    sky = world.node_tree.nodes.get('evren_sky')
    old_disc = sky.sun_disc
    sky.sun_disc = disc
    main = bpy.context.window.scene if bpy.context.window else bpy.context.scene
    sc = bpy.data.scenes.new('evren_meter')
    sc.world = world
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 64
    sc.cycles.use_denoising = False
    sc.cycles.use_adaptive_sampling = False
    sc.render.resolution_x = sc.render.resolution_y = 8
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.image_settings.color_depth = '32'
    mat = bpy.data.materials.new('evren_meter_white')
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (1, 1, 1, 1)
    b.inputs['Roughness'].default_value = 1.0
    b.inputs['Specular IOR Level'].default_value = 0.0
    me = bpy.data.meshes.new('evren_meter_plane')
    me.from_pydata([(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(mat)
    plane = bpy.data.objects.new('evren_meter_plane', me)
    sc.collection.objects.link(plane)
    cd = bpy.data.cameras.new('evren_meter_cam')
    cd.type = 'ORTHO'
    cd.ortho_scale = 1.0
    cam = bpy.data.objects.new('evren_meter_cam', cd)
    cam.location = (0, 0, 5)
    sc.collection.objects.link(cam)
    sc.camera = cam
    path = os.path.join(tempfile.gettempdir(), f'evren_meter_{os.getpid()}.exr')
    sc.render.filepath = path
    try:
        bpy.ops.render.render(write_still=True, scene=sc.name)
        img = bpy.data.images.load(path)
        px = list(img.pixels[:])
        bpy.data.images.remove(img)
    finally:
        sky.sun_disc = old_disc
        bpy.data.objects.remove(plane)
        bpy.data.objects.remove(cam)
        bpy.data.meshes.remove(me)
        bpy.data.cameras.remove(cd)
        bpy.data.materials.remove(mat)
        bpy.data.scenes.remove(sc)
        if os.path.exists(path):
            os.remove(path)
        if bpy.context.window:
            bpy.context.window.scene = main
    n = len(px) // 4
    rgb = [sum(px[i * 4 + c] for i in range(n)) / n for c in range(3)]
    return [math.pi * v for v in rgb]  # horizontal irradiance per channel (W/m², Blender units)


def exposure_for_lux(lux, bias=0.0):
    ev = math.log2(max(lux, 1e-4) * 100.0 / 250.0)
    return math.log2(0.18 * LUMENS_PER_WATT / (12.5 * 2.0 ** ev / 100.0)) + bias, ev


def exposure_for_ev(ev, bias=0.0):
    return math.log2(0.18 * LUMENS_PER_WATT / (12.5 * 2.0 ** ev / 100.0)) + bias


# Per-camera metering (like a camera's matrix meter): the log-average scene luminance of a small, fast pre-render
# is mapped to middle grey, within a range around the preset's exposure.
# Day allows +3.5 stops: in the shaded, awning-covered lanes (c09, c10) the frame is 5-6 stops under the sunlit
# incident reading, and at +2 those views rendered nearly black while the photos are exposed for the lane.
# Day allows +5: the fish-market lane (c10) under closed awnings sits 6-7 stops under the incident reading.
AUTO_RANGE = {'day': (-1.0, 5.0), 'dusk': (-1.5, 1.5), 'night': (-1.5, 1.0)}
AUTO_KEY = 0.18
# Centre-weighted metering: this fraction of the frame on every side is left out of the log-average.
AUTO_BORDER = {'day': 0.2}
METER_ZONE = 4
# View white balance per preset: (temperature K, tint). Tint 10 is Blender's D65 (daylight locus); tint 0 sits on the
# Planckian locus of the incandescent / sodium / LED sources that light the night.
# Dusk 9000 K: c05 dusk rendered at 5500 / 6500 / 8000 / 10000 K; the pavement's blue excess (B - R of the bottom
# fifth) was 78 / 59 / 45 / 33 against 11 in c05-dusk.jpg.
# Night 5000 K (S1 round 2): at 4000 K the 2700-3300 K floodlights and lanterns read neutral white, while the night
# photos (c01, c08, c09) show them golden; at 5000 K 2000 K sodium reads orange, 3000 K golden, 4000 K LED warm white
# and 5000-6500 K shop LEDs neutral to cool: the mixed colour temperatures of a real street at night.
WHITE_BALANCE = {'day': (6500.0, 10.0), 'dusk': (9000.0, 10.0), 'night': (5000.0, 0.0)}
# Highlight protection at dusk and night (a camera's highlight-weighted metering): the log-average of a night street
# is dominated by dark sky and shadow and asks for 7+ stops more, so the exposure sat at the top of its range and lit
# shop windows and interiors (hundreds of lux inside against 10-30 lx on the pavement) burnt out. The exposure is
# capped so that the luminance at this percentile of the frame lands this many stops above middle grey (AgX keeps
# colour and texture there; its white is about +6.5 stops). Point sources above the percentile (lamp globes) still clip.
# Night: +4.5 stops with the lower-contrast night look (LOOKS), which keeps about a stop more highlight detail.
HIGHLIGHT_CAP = {'dusk': (97.0, 3.5), 'night': (97.0, 4.5)}
# The cap may go below the metering range (a frame full of lit glass), down to this many stops under the preset.
HIGHLIGHT_FLOOR = {'dusk': -3.0, 'night': -2.0}


def meter_view(width_px=160, samples=16, percentile=None, border=0.0):
    """Log-average luminance (Blender units, exposure 0) of a small pre-render of the current camera (without the
    outer `border` fraction of the frame on every side), and with `percentile` also the luminance at that percentile
    of the whole frame. Sample clamping is off while metering: render.py scales the indirect clamp with the previous
    camera's exposure, which would otherwise dim a night meter by stops."""
    import numpy as np

    scene = bpy.context.scene
    r, c, img_s, vs = scene.render, scene.cycles, scene.render.image_settings, scene.view_settings
    saved = (r.resolution_percentage, c.samples, c.use_denoising, c.use_adaptive_sampling, img_s.file_format, img_s.color_depth, img_s.color_mode, r.filepath, vs.exposure, c.sample_clamp_indirect, c.sample_clamp_direct)
    media = getattr(img_s, 'media_type', None)
    path = os.path.join(tempfile.gettempdir(), f'evren_view_meter_{os.getpid()}.exr')
    try:
        if media is not None:
            img_s.media_type = 'IMAGE'
        r.resolution_percentage = max(1, min(100, round(100.0 * width_px / max(r.resolution_x, 1))))
        c.samples = samples
        c.sample_clamp_indirect = 0.0
        c.sample_clamp_direct = 0.0
        c.use_denoising = False
        c.use_adaptive_sampling = False
        img_s.file_format = 'OPEN_EXR'
        img_s.color_depth = '32'
        img_s.color_mode = 'RGB'
        vs.exposure = 0.0
        r.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        size = tuple(img.size)
        px = np.empty(len(img.pixels), dtype=np.float32)
        img.pixels.foreach_get(px)
        bpy.data.images.remove(img)
    finally:
        if media is not None:
            img_s.media_type = media
        (r.resolution_percentage, c.samples, c.use_denoising, c.use_adaptive_sampling, img_s.file_format, img_s.color_depth, img_s.color_mode, r.filepath, vs.exposure, c.sample_clamp_indirect, c.sample_clamp_direct) = saved
        if os.path.exists(path):
            os.remove(path)
    px = px.reshape(size[1], size[0], -1)[:, :, :3]
    y = np.maximum(px @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32), 0.0)
    core = y
    if border > 0.0:
        bx, by = int(round(size[0] * border)), int(round(size[1] * border))
        core = y[by:size[1] - by, bx:size[0] - bx]
    # Zones of METER_ZONE x METER_ZONE pixels (a matrix meter's cells): at 16 samples a dim, indirectly lit pixel is
    # often exactly 0, and single zero pixels would drag the log-average down by many stops (c10 by day).
    k = METER_ZONE
    hz, wz = core.shape[0] // k, core.shape[1] // k
    if hz and wz:
        core = core[:hz * k, :wz * k].reshape(hz, k, wz, k).mean(axis=(1, 3))
    log_avg = float(np.exp(np.mean(np.log(1e-7 + core))))
    if percentile is None:
        return log_avg
    return log_avg, float(np.percentile(y, percentile))


def auto_exposure(time_of_day, base_exposure):
    """Exposure for the current camera: base + clamp(metered - base, range of the preset); at dusk and night then
    no brighter than the highlight cap (HIGHLIGHT_CAP) and no darker than HIGHLIGHT_FLOOR under the preset."""
    rule = HIGHLIGHT_CAP.get(time_of_day)
    border = AUTO_BORDER.get(time_of_day, 0.0)
    if rule:
        log_avg, high = meter_view(percentile=rule[0], border=border)
    else:
        log_avg, high = meter_view(border=border), None
    metered = math.log2(AUTO_KEY / max(log_avg, 1e-9))
    lo, hi = AUTO_RANGE.get(time_of_day, (-1.0, 1.0))
    final = base_exposure + max(lo, min(hi, metered - base_exposure))
    info = {'logAverage': log_avg, 'metered': round(metered, 2), 'border': border, 'range': [lo, hi]}
    if rule:
        cap = math.log2(AUTO_KEY * 2.0 ** rule[1] / max(high, 1e-9))
        info.update({'highlightPercentile': rule[0], 'highlight': round(high, 5), 'highlightCap': round(cap, 2), 'uncapped': round(final, 2)})
        final = max(base_exposure + HIGHLIGHT_FLOOR.get(time_of_day, lo), min(final, cap))
    bpy.context.scene.view_settings.exposure = final
    info['final'] = round(final, 2)
    return info


# ---------------------------------------------------------------------------------------------------------------
# Presets


def _remove_sun():
    o = bpy.data.objects.get('evren_sun')
    if o is not None:
        data = o.data
        bpy.data.objects.remove(o)
        bpy.data.lights.remove(data)


def _add_sun(azimuth_deg, elevation_deg, irr_h, angle_rad):
    _remove_sun()
    s = math.sin(math.radians(elevation_deg))
    normal = [v / max(s, 1e-3) for v in irr_h]
    peak = max(normal)
    data = bpy.data.lights.new('evren_sun', 'SUN')
    data.energy = peak
    data.color = [v / peak for v in normal] if peak > 0 else (1, 1, 1)
    data.angle = angle_rad
    obj = bpy.data.objects.new('evren_sun', data)
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = to_sun_vector(azimuth_deg, elevation_deg).to_track_quat('Z', 'Y')
    bpy.context.scene.collection.objects.link(obj)
    return obj, peak


def set_manifest_lights(night_on):
    lit = 0
    coll = bpy.data.collections.get('lights')
    for o in (coll.objects if coll else []):
        on = night_on or not o.get('night', False) or o.get('dayOn', False)
        o.hide_render = not on
        lit += 1 if on else 0
    return lit


def white_balance(time_of_day, kelvin=None):
    """Sets the view white balance of the preset (or `kelvin`, tint of the preset). Returns {kelvin, tint}."""
    vs = bpy.context.scene.view_settings
    k, tint = WHITE_BALANCE.get(time_of_day, (6500.0, 10.0))
    k = k if kelvin is None else kelvin
    vs.use_white_balance = True
    vs.white_balance_temperature = k
    vs.white_balance_tint = tint
    return {'kelvin': k, 'tint': tint}


def _add_sun_normal(azimuth_deg, elevation_deg, energy, color, angle_rad):
    """Sun lamp from a normal irradiance (W/m², Blender units) and a colour whose largest channel is 1."""
    _remove_sun()
    data = bpy.data.lights.new('evren_sun', 'SUN')
    data.energy = energy
    data.color = color
    data.angle = angle_rad
    obj = bpy.data.objects.new('evren_sun', data)
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = to_sun_vector(azimuth_deg, elevation_deg).to_track_quat('Z', 'Y')
    bpy.context.scene.collection.objects.link(obj)
    return obj


_world_info = {}


def world_info():
    """The last applied HDRI world (skies.build_world result), {} for the physical sky."""
    return _world_info


def _hdri_sky(time_of_day, sky, when):
    """Lights the scene with an HDRI sky record (skies.py). Returns (info dict, lux) or None when the HDRI is not
    cached (the caller falls back to the physical sky)."""
    import skies  # sibling module

    global _world_info
    if skies.hdri_path(sky['hdri']) is None:
        log(f"WARNING HDRI {sky['hdri']} is not cached; physical sky instead")
        return None
    az, el = solar_position(when)
    info = {'sky': sky['id'], 'hdri': sky['hdri'], 'when': when.isoformat(), 'sunAzimuth': round(az, 1), 'sunElevation': round(el, 1)}
    kind = sky.get('kind', 'sun')
    if kind == 'sun' and el > 0.0:
        w, _sky_node = sky_world(az, el)
        tot = _meter(w, True)
        lux = luminance(tot) * LUMENS_PER_WATT * float(sky.get('luxFactor', 1.0))
        res = skies.build_world(w, sky, az, el, lux)
        if res['sun']:
            _add_sun_normal(az, el, res['sun']['energy'], res['sun']['color'], math.radians(skies.SUN_ANGLE_DEG))
        else:
            _remove_sun()
        info['physicalLux'] = round(luminance(tot) * LUMENS_PER_WATT)
    else:
        w, _nt, _bg = _world()
        _remove_sun()
        lux = skies.overcast_lux(el) if kind == 'overcast' else None
        res = skies.build_world(w, sky, az, el, lux)
        lux = res['lux']
    _world_info = res
    info.update({k: v for k, v in res.items() if not k.startswith('_')})
    return info, lux


def apply(time_of_day, when=None, ev=None, bias=None, wb_kelvin=None, sky=None):
    """Applies a preset to the current scene. `sky`: a skies.record() (HDRI sky, capture time, white balance and
    exposure bias of the camera's reference photo); None or id 'physical' keeps the physical sky of the preset.
    Returns a summary dict (sun position, illuminance, EV, exposure, white balance)."""
    import import_area  # sibling module (sys.path is set by the caller)

    global _world_info
    _world_info = {}
    preset = PRESETS[time_of_day]
    scene = bpy.context.scene
    sky = sky if sky and sky.get('id') not in (None, 'physical') else None
    if sky and sky.get('when') and when is None:
        when = dt.datetime.fromisoformat(sky['when'])
    if bias is None:
        bias = sky.get('bias', preset.get('bias', 0.0)) if sky else preset.get('bias', 0.0)
    when = when or preset['when']
    info = {'time': time_of_day}
    hdri = _hdri_sky(time_of_day, sky, when) if sky else None
    if hdri is not None:
        sky_info, lux = hdri
        info.update(sky_info)
        if time_of_day == 'night' or sky.get('kind') == 'night':
            ev_used = preset.get('ev', 3.5) if ev is None else ev
            exposure = exposure_for_ev(ev_used, bias)
        else:
            exposure, ev_used = exposure_for_lux(lux, bias) if ev is None else (exposure_for_ev(ev, bias), ev)
        night_on = time_of_day != 'day'
        if wb_kelvin is None and sky.get('whiteBalance'):
            wb_kelvin = float(sky['whiteBalance'])
    elif time_of_day == 'day':
        az, el = solar_position(when)
        w, sky = sky_world(az, el)
        sky_irr = _meter(w, False)
        tot_irr = _meter(w, True)
        sun_irr = [max(t - s, 0.0) for t, s in zip(tot_irr, sky_irr)]
        _, dni = _add_sun(az, el, sun_irr, sky.sun_size)
        lux = luminance(tot_irr) * LUMENS_PER_WATT
        exposure, ev_used = exposure_for_lux(lux, bias) if ev is None else (exposure_for_ev(ev, bias), ev)
        info.update({'when': when.isoformat(), 'sunAzimuth': round(az, 1), 'sunElevation': round(el, 1), 'skyLux': round(luminance(sky_irr) * LUMENS_PER_WATT), 'sunLuxHorizontal': round(luminance(sun_irr) * LUMENS_PER_WATT), 'sunStrengthWm2': round(dni, 2)})
        night_on = False
    elif time_of_day == 'dusk':
        target = preset.get('sunElevation', -5.0)
        start = when.replace(hour=17, minute=0) if when.hour < 17 else when
        when = time_for_elevation(start, target)
        az, el = solar_position(when)
        w, sky = sky_world(az, el)
        _remove_sun()
        sky_irr = _meter(w, False)
        lux = luminance(sky_irr) * LUMENS_PER_WATT
        exposure, ev_used = exposure_for_lux(lux, bias) if ev is None else (exposure_for_ev(ev, bias), ev)
        info.update({'when': when.isoformat(), 'sunAzimuth': round(az, 1), 'sunElevation': round(el, 1), 'skyLux': round(lux, 2)})
        night_on = True
    else:
        _remove_sun()
        night_world()
        ev_used = preset['ev'] if ev is None else ev
        exposure = exposure_for_ev(ev_used, bias)
        info.update({'when': when.isoformat()})
        night_on = True
    import_area.set_emission(night_on)
    info['lightsOn'] = set_manifest_lights(night_on)
    scene.view_settings.view_transform = VIEW_TRANSFORM
    scene.view_settings.look = LOOKS.get(time_of_day, LOOK)
    scene.view_settings.exposure = exposure
    scene.view_settings.gamma = 1.0
    wb = white_balance(time_of_day, wb_kelvin)
    info.update({'ev100': round(ev_used, 2), 'exposure': round(exposure, 2), 'bias': bias, 'view': f'{VIEW_TRANSFORM} / {LOOKS.get(time_of_day, LOOK)}', 'whiteBalance': wb})
    log('preset', info)
    return info
