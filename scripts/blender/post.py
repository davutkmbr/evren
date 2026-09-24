"""
Camera and atmosphere post-process of the S1 reference renders, in the Blender compositor, applied to the raw render
(a multilayer EXR with the scene-linear image, its depth and world position) without rendering again. render.py
writes the raw EXR, then calls run(); the same chain can be re-run on saved EXRs (grade experiments cost seconds):

    node scripts/blender-run.mjs --no-slot scripts/blender/post.py -- [--renders .shots/s1/renders] [--only c02,c11]
                                                  [--match 0.6] [--no-match] [--wb <K>] [--out <dir>]

Chain (scene-linear, in this order; DEFAULTS per time of day, overridden by the atmosphere preset and the camera's
"post" block in scripts/blender/skies.json, see atmosphere.py):
1. Aerial perspective: Beer-Lambert haze from the depth and position passes. Extinction 3.912 / visibility
   (Koschmieder) at the camera's height, thinning exponentially with height (scale hazeHeightM): along a ray from
   height z_c to z_p over distance d the optical depth is sigma(z_c) d (1 - exp(-x)) / x with x = (z_p - z_c) / H.
   The in-scattered colour is the sky's horizon radiance in each pixel's direction (hazeColumns, from the HDRI), so
   the haze is brighter and warmer towards the sun; sky pixels keep their own radiance.
2. Exposure (the metered exposure of render.py; the view transform then runs at exposure 0).
3. Bloom (Glare 'Bloom'): light scattered in the lens and on the sensor around lamps, signs and bright sky.
4. Halation: a small, red-orange glow around the brightest highlights (light reflected back from behind the sensor).
5. Lens dirt: a wide glare of the brightest sources, seen through smudges and specks on the front element (a fixed,
   generated dirt pattern: the same "lens" for every camera).
6. Lens: mild barrel distortion and lateral chromatic aberration (dispersion grows towards the frame edges), fitted.
7. Vignette: natural cos^4 fall-off of the field angle, partly corrected as phones and DSLRs do.
8. Grade (per camera, matched to the reference photo), keeping chromaticity: veiling glare (a small offset that lifts
   or, negative, crushes the black level), contrast and an exposure trim on luminance (C (Y / 0.18)^(gamma - 1)
   2^trim, a power curve pivoting on middle grey), saturation as a mix around luminance. The trim stays within 0.7
   stop: a photo's median also depends on its content (bright water, sky).
9. Grain: photon-like noise (sigma proportional to sqrt(signal)), mostly luminance, slightly clumped; its amount
   grows with the exposure (a night shot is a high-ISO shot): grain x 2^(grainPerStop (exposure - GRAIN_REF)).
10. Optional hand shake (directional blur, off by default: the scene is static).
Then AgX with the preset's look and white balance (the view settings) and an 8-bit sRGB PNG.
With camera: False (atmosphere 'none') steps 3-10 are off and there is no haze (a plain render).

Grade matching: the display statistics of the render (luma median, black level = 1st percentile, contrast = 10-90
percentile spread, saturation = mean HSV saturation of mid-tone pixels) are moved `match` of the way (default 0.6)
towards the reference photo's, with bounded controls, in two refinement passes. Photos with other content (people,
cars) must not dictate the grade, hence the partial match and the bounds.
"""

import argparse
import glob
import json
import math
import os
import sys
import zlib

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get('EVREN_ROOT') or os.path.abspath(os.path.join(HERE, '..', '..'))
POST_SCENE = 'evren_post'
POST_TREE = 'evren_post'
POST_VERSION = 3
MIDDLE_GREY = 0.18
SKY_DEPTH = 5.0e4
MATCH = 0.6
GRAIN_REF = -4.5          # a bright day exposure (base ISO)
BOUNDS = {'contrast': (0.85, 1.45), 'saturation': (0.7, 1.3), 'veil': (-0.006, 0.012), 'trim': (-0.7, 0.7)}
_CAMERA = {'bloomThreshold': 1.2, 'bloomStrength': 0.05, 'bloomSize': 0.55, 'halation': 0.03, 'lensDirt': 0.15,
           'dirtThreshold': 6.0, 'distortion': 0.012, 'dispersion': 0.006, 'vignette': 0.5, 'grain': 0.007,
           'grainPerStop': 0.2, 'grainMax': 0.03, 'shakePx': 0.0}
DEFAULTS = {
    'day': dict(_CAMERA, visibilityKm=20.0, hazeHeightM=400.0, hazeStart=10.0),
    'dusk': dict(_CAMERA, visibilityKm=12.0, hazeHeightM=300.0, hazeStart=10.0, bloomThreshold=1.0, bloomStrength=0.1,
                 bloomSize=0.6, halation=0.05, lensDirt=0.2, dirtThreshold=5.0, dispersion=0.007),
    'night': dict(_CAMERA, visibilityKm=8.0, hazeHeightM=200.0, hazeStart=8.0, bloomThreshold=1.5, bloomStrength=0.05,
                  bloomSize=0.32, halation=0.04, lensDirt=0.15, dirtThreshold=6.0, dispersion=0.008, vignette=0.55,
                  grainMax=0.022),
}
OFF = {'bloomStrength': 0.0, 'halation': 0.0, 'lensDirt': 0.0, 'distortion': 0.0, 'dispersion': 0.0, 'vignette': 0.0,
       'grain': 0.0, 'shakePx': 0.0, 'visibilityKm': 0.0}


def log(*args):
    print('[evren:post]', *args, flush=True)


# ---------------------------------------------------------------------------------------------------------------
# Generated images: vignette factor, grain noise, lens dirt, haze colour per column


def _float_image(name, arr, colorspace='Non-Color'):
    h, w = arr.shape[:2]
    img = bpy.data.images.get(name)
    if img is not None and tuple(img.size) != (w, h):
        bpy.data.images.remove(img)
        img = None
    if img is None:
        img = bpy.data.images.new(name, w, h, alpha=True, float_buffer=True)
    img.colorspace_settings.name = colorspace
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[:, :, :arr.shape[2]] = arr
    img.pixels.foreach_set(rgba.ravel())
    img.update()
    return img


def vignette_image(w, h, vfov_deg, strength):
    """cos^4 of the field angle (natural vignetting), mixed with 1 by (1 - strength). Rows bottom to top."""
    ty = math.tan(math.radians(vfov_deg) / 2.0)
    tx = ty * w / h
    x = (np.arange(w, dtype=np.float32) + 0.5) / w * 2.0 - 1.0
    y = (np.arange(h, dtype=np.float32) + 0.5) / h * 2.0 - 1.0
    t2 = (x[None, :] * tx) ** 2 + (y[:, None] * ty) ** 2
    cos4 = 1.0 / (1.0 + t2) ** 2
    f = 1.0 + strength * (cos4 - 1.0)
    return _float_image('evren_post_vignette', np.repeat(f[:, :, None], 3, axis=2))


def _blur(a, passes):
    k = (0.25, 0.5, 0.25)
    for _ in range(passes):
        a = k[0] * np.roll(a, 1, 0) + k[1] * a + k[2] * np.roll(a, -1, 0)
        a = k[0] * np.roll(a, 1, 1) + k[1] * a + k[2] * np.roll(a, -1, 1)
    return a


def grain_image(w, h, seed):
    """Unit-variance noise: 85 % shared by the channels (luminance grain), clumped over about a pixel."""
    rng = np.random.default_rng(seed)
    n = 0.85 * rng.standard_normal((h, w, 1)).astype(np.float32) + 0.35 * rng.standard_normal((h, w, 3)).astype(np.float32)
    n = 0.5 * n + 0.5 * _blur(n, 1)
    n /= max(float(n.std()), 1e-6)
    return _float_image('evren_post_grain', n)


def dirt_image(w, h, seed=7):
    """Smudges, specks and a few wipe streaks on the front element (0..1, faintly warm), the same lens for every
    camera: soft blobs of 2-12 % of the frame width, sharp specks, and arcs left by a cloth."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.zeros((h, w), dtype=np.float32)
    for _ in range(26):
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        r = rng.uniform(0.02, 0.12) * w
        d += rng.uniform(0.15, 0.6) * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2.0 * r * r))
    for _ in range(140):
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        r = rng.uniform(0.0015, 0.006) * w
        d += rng.uniform(0.3, 1.0) * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2.0 * r * r))
    for _ in range(5):
        cx, cy, rad = rng.uniform(-0.5, 1.5) * w, rng.uniform(-0.5, 1.5) * h, rng.uniform(0.4, 1.2) * w
        ring = np.abs(np.hypot(xx - cx, yy - cy) - rad)
        d += rng.uniform(0.1, 0.3) * np.exp(-(ring ** 2) / (2.0 * (0.004 * w) ** 2))
    d = np.clip(d / max(float(np.percentile(d, 99.5)), 1e-6), 0.0, 1.0) * 0.85 + 0.15
    rgb = np.stack([d * 1.0, d * 0.96, d * 0.9], axis=2)
    return _float_image('evren_post_dirt', rgb)


def haze_image(w, h, columns):
    """Haze colour per pixel column (the sky's horizon radiance in that column's direction), 0 when unknown."""
    cols = np.array(columns or [[0.0, 0.0, 0.0]], dtype=np.float32)
    xs = np.linspace(0.0, len(cols) - 1.0, w)
    lo = np.floor(xs).astype(int)
    hi = np.minimum(lo + 1, len(cols) - 1)
    f = (xs - lo)[:, None]
    row = cols[lo] * (1.0 - f) + cols[hi] * f
    return _float_image('evren_post_haze', np.repeat(row[None, :, :], h, axis=0), colorspace='Linear Rec.709')


# ---------------------------------------------------------------------------------------------------------------
# The compositor scene


def _math(tree, op, a, b=None):
    n = tree.nodes.new('ShaderNodeMath')
    n.operation = op
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, bpy.types.NodeSocket):
            tree.links.new(v, n.inputs[i])
        else:
            n.inputs[i].default_value = v
    return n.outputs[0]


def _value(tree, name, v=0.0):
    n = tree.nodes.new('ShaderNodeValue')
    n.name = name
    n.outputs[0].default_value = v
    return n.outputs[0]


def _set_menu(sock, *choices):
    for c in choices:
        try:
            sock.default_value = c
            return c
        except (TypeError, ValueError):
            continue
    raise ValueError(f'none of {choices} accepted by {sock.name}')


def _mix(tree, blend, a, b, fac=1.0, name=None, clamp=True):
    n = tree.nodes.new('ShaderNodeMix')
    if name:
        n.name = name
    n.data_type = 'RGBA'
    n.blend_type = blend
    n.clamp_factor = clamp
    for sock, v in (('Factor', fac), ('A', a), ('B', b)):
        if isinstance(v, bpy.types.NodeSocket):
            tree.links.new(v, n.inputs[sock])
        elif v is not None:
            n.inputs[sock].default_value = v
    return n.outputs['Result']


def post_scene():
    """The compositor-only scene (no Render Layers node, so rendering it only composites)."""
    sc = bpy.data.scenes.get(POST_SCENE)
    if sc is not None and sc.get('evren_post_version') == POST_VERSION:
        return sc
    if sc is not None:
        bpy.data.scenes.remove(sc)
    sc = bpy.data.scenes.new(POST_SCENE)
    sc['evren_post_version'] = POST_VERSION
    cam = bpy.data.objects.new('evren_post_cam', bpy.data.cameras.new('evren_post_cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.use_compositing = True
    sc.render.use_sequencer = False
    sc.render.resolution_percentage = 100
    s = sc.render.image_settings
    s.file_format = 'PNG'
    s.color_mode = 'RGB'
    s.color_depth = '8'
    s.compression = 30
    tree = bpy.data.node_groups.get(POST_TREE)
    if tree is not None:
        bpy.data.node_groups.remove(tree)
    tree = bpy.data.node_groups.new(POST_TREE, 'CompositorNodeTree')
    tree.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    sc.compositing_node_group = tree
    _build_chain(tree)
    return sc


def _glare(t, name, image_sock):
    g = t.nodes.new('CompositorNodeGlare')
    g.name = name
    _set_menu(g.inputs['Type'], 'Bloom', 'BLOOM')
    _set_menu(g.inputs['Quality'], 'High', 'HIGH')
    t.links.new(image_sock, g.inputs['Image'])
    return g


def _build_chain(t):
    L = t.links
    src = t.nodes.new('CompositorNodeImage')
    src.name = 'raw'
    # 1. haze. Inputs relinked by _bind: depth -> haze_depth (Math ADD 0), position z -> haze_zp (Math ADD 0)
    depth = t.nodes.new('ShaderNodeMath')
    depth.name = 'haze_depth'
    depth.operation = 'ADD'
    zp = t.nodes.new('ShaderNodeMath')
    zp.name = 'haze_zp'
    zp.operation = 'ADD'
    geo = _math(t, 'LESS_THAN', depth.outputs[0], SKY_DEPTH)
    dist = _math(t, 'MAXIMUM', _math(t, 'SUBTRACT', depth.outputs[0], _value(t, 'haze_start')), 0.0)
    x = _math(t, 'DIVIDE', _math(t, 'SUBTRACT', zp.outputs[0], _value(t, 'haze_zc')), _value(t, 'haze_height', 400.0))
    big = _math(t, 'GREATER_THAN', _math(t, 'ABSOLUTE', x), 1e-4)
    xs = _math(t, 'ADD', _math(t, 'MULTIPLY', x, big), _math(t, 'MULTIPLY', _math(t, 'SUBTRACT', 1.0, big), 1e-4))
    g = _math(t, 'DIVIDE', _math(t, 'SUBTRACT', 1.0, _math(t, 'EXPONENT', _math(t, 'MULTIPLY', xs, -1.0))), xs)
    tau = _math(t, 'MULTIPLY', _math(t, 'MULTIPLY', _math(t, 'MULTIPLY', g, dist), geo), _value(t, 'haze_sigma'))
    trans = _math(t, 'EXPONENT', _math(t, 'MULTIPLY', tau, -1.0))
    hcol = t.nodes.new('CompositorNodeImage')
    hcol.name = 'haze_colour'
    haze = t.nodes.new('ShaderNodeMix')
    haze.name = 'haze'
    haze.data_type = 'RGBA'
    L.new(trans, haze.inputs['Factor'])
    L.new(hcol.outputs['Image'], haze.inputs['A'])
    # 2. exposure
    expo = t.nodes.new('CompositorNodeExposure')
    expo.name = 'exposure'
    L.new(haze.outputs['Result'], expo.inputs['Image'])
    # 3. bloom, 4. halation
    bloom = _glare(t, 'bloom', expo.outputs['Image'])
    hal = _glare(t, 'halation', bloom.outputs['Image'])
    hal.inputs['Tint'].default_value = (1.0, 0.32, 0.12, 1.0)
    hal.inputs['Size'].default_value = 0.25
    # 5. lens dirt: a wide glare of the brightest sources, masked by the dirt pattern
    dg = _glare(t, 'dirt_glare', expo.outputs['Image'])
    dg.inputs['Size'].default_value = 0.75
    dg.inputs['Strength'].default_value = 1.0
    dirt = t.nodes.new('CompositorNodeImage')
    dirt.name = 'dirt'
    masked = _mix(t, 'MULTIPLY', dg.outputs['Glare'], dirt.outputs['Image'])
    amount = t.nodes.new('ShaderNodeVectorMath')
    amount.name = 'dirt_amount'
    amount.operation = 'SCALE'
    L.new(masked, amount.inputs[0])
    with_dirt = _mix(t, 'ADD', hal.outputs['Image'], amount.outputs['Vector'])
    # 6. lens
    lens = t.nodes.new('CompositorNodeLensdist')
    lens.name = 'lens'
    lens.inputs['Fit'].default_value = True
    lens.inputs['Jitter'].default_value = False
    L.new(with_dirt, lens.inputs['Image'])
    # 7. vignette
    vig = t.nodes.new('CompositorNodeImage')
    vig.name = 'vignette'
    vmul = _mix(t, 'MULTIPLY', lens.outputs['Image'], vig.outputs['Image'])
    # 8. grade
    veil = t.nodes.new('ShaderNodeVectorMath')
    veil.name = 'grade_veil'
    veil.operation = 'ADD'
    L.new(vmul, veil.inputs[0])
    floor = t.nodes.new('ShaderNodeVectorMath')
    floor.operation = 'MAXIMUM'
    floor.inputs[1].default_value = (0.0, 0.0, 0.0)
    L.new(veil.outputs['Vector'], floor.inputs[0])
    y0 = t.nodes.new('CompositorNodeRGBToBW')
    L.new(floor.outputs['Vector'], y0.inputs['Image'])
    rel = _math(t, 'MAXIMUM', _math(t, 'DIVIDE', y0.outputs[0], MIDDLE_GREY), 1e-6)
    ratio = _math(t, 'MULTIPLY', _math(t, 'POWER', rel, _value(t, 'grade_gamma_minus_one')), _value(t, 'grade_gain', 1.0))
    scaled_c = t.nodes.new('ShaderNodeVectorMath')
    scaled_c.operation = 'SCALE'
    L.new(floor.outputs['Vector'], scaled_c.inputs[0])
    L.new(ratio, scaled_c.inputs['Scale'])
    y1 = t.nodes.new('CompositorNodeRGBToBW')
    L.new(scaled_c.outputs['Vector'], y1.inputs['Image'])
    sat_out = _mix(t, 'MIX', y1.outputs[0], scaled_c.outputs['Vector'], fac=1.0, name='grade_saturation', clamp=False)
    # 9. grain: C + n * a * sqrt(max(luma(C), 0))
    grain = t.nodes.new('CompositorNodeImage')
    grain.name = 'grain'
    bw = t.nodes.new('CompositorNodeRGBToBW')
    L.new(sat_out, bw.inputs['Image'])
    amp = _math(t, 'MULTIPLY', _math(t, 'SQRT', _math(t, 'MAXIMUM', bw.outputs[0], 0.0)), _value(t, 'grain_amount'))
    scaled = t.nodes.new('ShaderNodeVectorMath')
    scaled.operation = 'SCALE'
    L.new(grain.outputs['Image'], scaled.inputs[0])
    L.new(amp, scaled.inputs['Scale'])
    grained = _mix(t, 'ADD', sat_out, scaled.outputs['Vector'])
    # 10. hand shake (muted unless shakePx > 0)
    out = t.nodes.new('NodeGroupOutput')
    try:
        shake = t.nodes.new('CompositorNodeDBlur')
        shake.name = 'shake'
        L.new(grained, shake.inputs['Image'])
        L.new(shake.outputs['Image'], out.inputs['Image'])
    except RuntimeError:
        L.new(grained, out.inputs['Image'])


def _relink(t, sock, src):
    for link in list(sock.links):
        t.links.remove(link)
    if src is not None:
        t.links.new(src, sock)


def _bind(sc, raw_img):
    """Points the chain at a raw EXR: its image, depth and position z. Returns (has depth, has position)."""
    t = sc.compositing_node_group
    src = t.nodes['raw']
    src.image = raw_img
    image = src.outputs.get('Combined') or src.outputs['Image']
    _relink(t, t.nodes['haze'].inputs['B'], image)
    depth = next((o for o in src.outputs if o.name in ('Depth', 'Z')), None)
    _relink(t, t.nodes['haze_depth'].inputs[0], depth)
    t.nodes['haze_depth'].inputs[1].default_value = 0.0 if depth is not None else 1e9
    pos = src.outputs.get('Position')
    zsock = None
    if pos is not None:
        sep = t.nodes.get('haze_position_xyz') or t.nodes.new('ShaderNodeSeparateXYZ')
        sep.name = 'haze_position_xyz'
        _relink(t, sep.inputs[0], pos)
        zsock = sep.outputs['Z']
    _relink(t, t.nodes['haze_zp'].inputs[0], zsock)
    return depth is not None, pos is not None


def grain_amount(params):
    a = float(params['grain'])
    if a <= 0.0:
        return 0.0
    a *= 2.0 ** (float(params.get('grainPerStop', 0.0)) * (float(params['exposure']) - GRAIN_REF))
    return max(float(params['grain']), min(a, float(params.get('grainMax', 0.03))))


def configure(sc, params):
    t = sc.compositing_node_group
    n = t.nodes
    vis = float(params.get('visibilityKm') or 0.0) * 1000.0
    n['haze_sigma'].outputs[0].default_value = 3.912 / vis if vis > 0.0 else 0.0
    n['haze_start'].outputs[0].default_value = float(params.get('hazeStart', 10.0))
    n['haze_height'].outputs[0].default_value = max(float(params.get('hazeHeightM', 400.0)), 1.0)
    n['haze_zc'].outputs[0].default_value = float(params.get('cameraZ', 0.0))
    n['exposure'].inputs['Exposure'].default_value = float(params['exposure'])
    b = n['bloom'].inputs
    b['Threshold'].default_value = float(params['bloomThreshold'])
    b['Strength'].default_value = float(params['bloomStrength'])
    b['Size'].default_value = float(params['bloomSize'])
    h = n['halation'].inputs
    h['Threshold'].default_value = float(params['bloomThreshold']) * 2.0
    h['Strength'].default_value = float(params['halation'])
    n['dirt_glare'].inputs['Threshold'].default_value = float(params['dirtThreshold'])
    n['dirt_amount'].inputs['Scale'].default_value = float(params['lensDirt'])
    lens = n['lens'].inputs
    lens['Distortion'].default_value = float(params['distortion'])
    lens['Dispersion'].default_value = float(params['dispersion'])
    gr = params['grade']
    v = float(gr['veil'])
    n['grade_veil'].inputs[1].default_value = (v, v, v)
    n['grade_gamma_minus_one'].outputs[0].default_value = float(gr['contrast']) - 1.0
    n['grade_gain'].outputs[0].default_value = 2.0 ** float(gr.get('trim', 0.0))
    n['grade_saturation'].inputs['Factor'].default_value = float(gr['saturation'])
    n['grain_amount'].outputs[0].default_value = grain_amount(params)
    shake = n.get('shake')
    if shake is not None:
        px = float(params.get('shakePx', 0.0))
        shake.mute = px <= 0.0
        for key, val in (('Samples', 8), ('Distance', px / max(sc.render.resolution_x, 1))):
            if key in shake.inputs:
                shake.inputs[key].default_value = val


def composite(sc, out_png):
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True, scene=sc.name)


# ---------------------------------------------------------------------------------------------------------------
# Statistics and grade matching


def image_array(path):
    """Display-encoded RGB in [0, 1] (as stored in the PNG / JPG)."""
    img = bpy.data.images.load(path, check_existing=False)
    try:
        w, h = img.size
        px = np.empty(w * h * img.channels, dtype=np.float32)
        img.pixels.foreach_get(px)
        return px.reshape(h, w, img.channels)[:, :, :3]
    finally:
        bpy.data.images.remove(img)


def stats(rgb):
    luma = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    mid = (luma > 0.06) & (luma < 0.94)
    sat = float(((mx - mn) / np.maximum(mx, 1e-4))[mid].mean()) if mid.any() else 0.0
    p = np.percentile(luma, [1, 10, 50, 90, 99])
    return {'black': float(p[0]), 'p10': float(p[1]), 'median': float(p[2]), 'p90': float(p[3]), 'white': float(p[4]),
            'spread': float(p[3] - p[1]), 'saturation': sat, 'mean': float(luma.mean())}


def _clamp(v, key):
    lo, hi = BOUNDS[key]
    return max(lo, min(hi, v))


def _srgb_to_linear(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def params_for(time_of_day, overrides=None):
    """Post parameters: the time's defaults, then `overrides` (atmosphere.post_params); camera: False = all off."""
    p = dict(DEFAULTS.get(time_of_day, DEFAULTS['day']))
    p.update(overrides or {})
    if p.get('camera') is False:
        p.update(OFF)
    p.setdefault('grade', {'trim': 0.0, 'veil': 0.0, 'contrast': 1.0, 'saturation': 1.0})
    return p


def run(raw_exr, out_png, params, view, photo=None, match=MATCH, vfov_deg=50.0, seed=0, size=None):
    """Post-processes one raw EXR into out_png. `params`: params_for() plus exposure, cameraZ and hazeColumns; `view`:
    {look, whiteBalance: {kelvin, tint}}. With a reference `photo` (and camera effects on), matches the grade.
    `size`: (width, height) of the render (a multilayer EXR reports no size before its buffer loads)."""
    sc = post_scene()
    main = bpy.context.scene
    raw = bpy.data.images.load(raw_exr, check_existing=False)
    try:
        has_depth, has_position = _bind(sc, raw)
        w, h = size or tuple(raw.size)
        sc.render.resolution_x, sc.render.resolution_y = w, h
        vs = sc.view_settings
        vs.view_transform = view.get('transform', 'AgX')
        vs.look = view['look']
        vs.exposure = 0.0
        vs.gamma = 1.0
        wb = view.get('whiteBalance') or {}
        vs.use_white_balance = bool(wb)
        if wb:
            vs.white_balance_temperature = wb['kelvin']
            vs.white_balance_tint = wb['tint']
        sc.display_settings.display_device = main.display_settings.display_device
        nodes = sc.compositing_node_group.nodes
        nodes['vignette'].image = vignette_image(w, h, vfov_deg, float(params['vignette']))
        nodes['grain'].image = grain_image(w, h, seed)
        nodes['dirt'].image = dirt_image(w, h)
        nodes['haze_colour'].image = haze_image(w, h, params.get('hazeColumns'))
        grade = dict(params.get('grade') or {'trim': 0.0, 'veil': 0.0, 'contrast': 1.0, 'saturation': 1.0})
        params = dict(params, grade=grade)
        configure(sc, params)
        composite(sc, out_png)
        first = stats(image_array(out_png))
        summary = {'depth': has_depth, 'position': has_position, 'grainAmount': round(grain_amount(params), 4),
                   'params': {k: v for k, v in params.items() if k != 'hazeColumns'}, 'renderStats': first}
        if photo and os.path.exists(photo) and match > 0.0 and params.get('camera', True) is not False:
            ref = stats(image_array(photo))
            target = {k: first[k] + match * (ref[k] - first[k]) for k in ('median', 'black', 'spread', 'saturation')}
            cur, history = first, []
            for _ in range(2):
                ratio = _srgb_to_linear(max(target['median'], 0.01)) / _srgb_to_linear(max(cur['median'], 0.01))
                grade['trim'] = _clamp(grade.get('trim', 0.0) + 0.7 * math.log2(ratio), 'trim')
                grade['contrast'] = _clamp(grade['contrast'] * target['spread'] / max(cur['spread'], 1e-3), 'contrast')
                grade['saturation'] = _clamp(grade['saturation'] * (target['saturation'] / max(cur['saturation'], 1e-3)) ** 0.8, 'saturation')
                dlin = _srgb_to_linear(max(target['black'], 0.0)) - _srgb_to_linear(max(cur['black'], 0.0))
                grade['veil'] = _clamp(grade['veil'] + 0.7 * dlin, 'veil')
                configure(sc, params)
                composite(sc, out_png)
                cur = stats(image_array(out_png))
                history.append(dict(grade))
            summary.update({'photo': os.path.relpath(photo, ROOT), 'photoStats': ref, 'target': target, 'finalStats': cur,
                            'match': match, 'grade': grade, 'gradeHistory': history})
        else:
            summary.update({'finalStats': first, 'grade': grade})
        return summary
    finally:
        bpy.data.images.remove(raw)


# ---------------------------------------------------------------------------------------------------------------
# CLI: re-post saved raw EXRs (render.py writes <renders>/raw/<name>.exr and <renders>/<name>.json)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser(prog='post.py')
    p.add_argument('--renders', default=os.path.join(ROOT, '.shots', 's1', 'renders'))
    p.add_argument('--only', default=None)
    p.add_argument('--match', type=float, default=MATCH)
    p.add_argument('--no-match', action='store_true')
    p.add_argument('--wb', type=float, default=None, help='view white balance (K) instead of the render\'s')
    p.add_argument('--out', default=None, help='write the PNGs here instead of over the renders')
    a = p.parse_args(argv)
    raws = sorted(glob.glob(os.path.join(a.renders, 'raw', '*.exr')))
    only = [s.strip() for s in (a.only or '').split(',') if s.strip()]
    for raw in raws:
        name = os.path.splitext(os.path.basename(raw))[0]
        if only and not any(name.startswith(o) for o in only):
            continue
        meta_path = os.path.join(a.renders, name + '.json')
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
        old = meta.get('post') or {}
        params = params_for(meta['time'], (meta.get('atmosphere') or {}).get('postParams'))
        params.update({'exposure': meta['exposure']['final'], 'cameraZ': (old.get('params') or {}).get('cameraZ', 0.0),
                       'hazeColumns': meta.get('hazeColumns')})
        view = {'look': meta['preset']['view'].split(' / ')[1], 'whiteBalance': dict(meta['preset']['whiteBalance'])}
        if a.wb:
            view['whiteBalance']['kelvin'] = a.wb
        photo = os.path.join(ROOT, meta['referencePhoto']) if meta.get('referencePhoto') and meta.get('referenceSameTime') else None
        out_dir = a.out or a.renders
        os.makedirs(out_dir, exist_ok=True)
        summary = run(raw, os.path.join(out_dir, name + '.png'), params, view, photo=photo,
                      match=0.0 if a.no_match else a.match, vfov_deg=meta['fovDeg'], seed=zlib.crc32(name.encode()) & 0xFFFF,
                      size=tuple(meta['resolution']))
        meta['post'] = summary
        with open(os.path.join(out_dir, name + '.json') if a.out else meta_path, 'w', encoding='utf-8') as f:
            json.dump(meta, f, indent=1)
        log(name, json.dumps({k: summary.get(k) for k in ('grade', 'finalStats')}))


if __name__ == '__main__':
    main()
