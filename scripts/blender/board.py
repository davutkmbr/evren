#!/usr/bin/env python3
"""
Contact sheets for the S1 reference renders: each render next to its reference photo (CPU only, no Blender).

    python3 scripts/blender/board.py [--renders .shots/s1/renders] [--out .shots/s1/board] [--height 720]

Reads <renders>/<camera>-<time>.png with the sidecar <camera>-<time>.json written by render.py, the camera records of
tools/world-compiler/s1/cameras.json and the photo credits of .shots/s1/reference/sources.json. Writes:
- <out>/<camera>-<time>.jpg   photo (left) and render (right) at the same height, with a caption band;
- <out>/index.jpg             every pair on one sheet (two columns);
- <out>/board.json            the pairs, their files and the render settings.
A photo taken at another time of day than the render (or with another framing) is marked in the caption.
"""

import argparse
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
CAMERAS_JSON = os.path.join(ROOT, 'tools', 'world-compiler', 's1', 'cameras.json')
SOURCES_JSON = os.path.join(ROOT, '.shots', 's1', 'reference', 'sources.json')
TIME_ORDER = {'day': 0, 'dusk': 1, 'night': 2}
BG = (24, 24, 26)
FG = (232, 232, 228)
DIM = (150, 150, 146)
WARN = (240, 170, 80)
FONT_CANDIDATES = ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/SFNS.ttf', '/Library/Fonts/Arial Unicode.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf']


def font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default(size)


def load_json(path, default=None):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def fit_height(img, h):
    w = max(1, round(img.width * h / img.height))
    return img.resize((w, h), Image.LANCZOS)


def credit(sources, photo_path):
    name = os.path.basename(photo_path or '')
    for s in sources or []:
        if s.get('file') == name:
            return f"{s.get('author', '?')}, {s.get('licence', '?')}"
    return ''


def make_pair(meta, cam, sources, height):
    render_path = os.path.join(ROOT, meta['file'])
    render = Image.open(render_path).convert('RGB')
    t = meta['time']
    photos = (cam or {}).get('referencePhotos') or {}
    photo_rel = photos.get(t) or meta.get('referencePhoto') or (cam or {}).get('referencePhoto')
    same_time = t in photos
    photo = None
    if photo_rel and os.path.exists(os.path.join(ROOT, photo_rel)):
        photo = Image.open(os.path.join(ROOT, photo_rel)).convert('RGB')
    r = fit_height(render, height)
    p = fit_height(photo, height) if photo else Image.new('RGB', (round(height * 4 / 3), height), (40, 40, 44))
    gap, pad, head, foot = 16, 16, 70, 34
    w = pad + p.width + gap + r.width + pad
    h = head + height + foot
    sheet = Image.new('RGB', (w, h), BG)
    sheet.paste(p, (pad, head))
    sheet.paste(r, (pad + p.width + gap, head))
    d = ImageDraw.Draw(sheet)
    title = f"{meta['camera']}  ·  {t}"
    d.text((pad, 8), title, font=font(24), fill=FG)
    label = (cam or {}).get('label') or ''
    x0 = pad + d.textlength(title, font=font(24)) + 18
    room = w - pad - x0
    if label and room > 60:
        while label and d.textlength(label, font=font(17)) > room:
            label = label[:-2].rstrip() + '…'
        d.text((x0, 14), label, font=font(17), fill=DIM)
    ex = meta.get('exposure') or {}
    pr = meta.get('preset') or {}
    stats = f"Cycles {meta.get('device', '')} {meta.get('samples')} spp  ·  {meta.get('seconds')} s  ·  {meta['resolution'][0]}×{meta['resolution'][1]}  ·  EV {pr.get('ev100')}  ·  exposure {ex.get('final', pr.get('exposure'))} ({ex.get('mode', 'preset')})"
    if meta.get('clipStart', 0.1) > 0.1:
        stats += f"  ·  near clip {meta['clipStart']} m (camera inside geometry)"
    d.text((pad, 42), stats, font=font(15), fill=WARN if meta.get('clipStart', 0.1) > 0.1 else DIM)
    y = head + height + 8
    if photo:
        note = f"photo: {os.path.basename(photo_rel)} ({credit(sources, photo_rel)})"
        d.text((pad, y), note, font=font(15), fill=DIM)
        if not same_time:
            d.text((pad + d.textlength(note, font=font(15)) + 12, y), f'other time of day than the render', font=font(15), fill=WARN)
    else:
        d.text((pad, y), 'no reference photo', font=font(15), fill=WARN)
    notes = []
    if (cam or {}).get('poseFrom') and (cam or {}).get('poseFrom') != t and same_time:
        notes.append(f"pose fitted to the {cam['poseFrom']} photo")
    if (cam or {}).get('poseConfidence'):
        notes.append(f"pose {cam['poseConfidence']}")
    rtext = f"render: {os.path.basename(meta['file'])}" + (f"  ({', '.join(notes)})" if notes else '')
    d.text((pad + p.width + gap, y), rtext, font=font(15), fill=DIM)
    return sheet, photo_rel, same_time


def main():
    ap = argparse.ArgumentParser(prog='board.py')
    ap.add_argument('--renders', default=os.path.join(ROOT, '.shots', 's1', 'renders'))
    ap.add_argument('--out', default=os.path.join(ROOT, '.shots', 's1', 'board'))
    ap.add_argument('--height', type=int, default=720)
    a = ap.parse_args()
    cams = {c['id']: c for c in (load_json(CAMERAS_JSON, {}) or {}).get('cameras', [])}
    sources = load_json(SOURCES_JSON, [])
    metas = []
    for f in sorted(os.listdir(a.renders)):
        if f.endswith('.json') and os.path.exists(os.path.join(a.renders, f[:-5] + '.png')):
            m = load_json(os.path.join(a.renders, f))
            if m and 'camera' in m:
                metas.append(m)
    if not metas:
        sys.exit(f'no renders with sidecars in {a.renders}')
    metas.sort(key=lambda m: (m['camera'], TIME_ORDER.get(m['time'], 9)))
    os.makedirs(a.out, exist_ok=True)
    pairs, entries = [], []
    for m in metas:
        sheet, photo, same_time = make_pair(m, cams.get(m['camera']), sources, a.height)
        name = f"{m['camera']}-{m['time']}.jpg"
        sheet.save(os.path.join(a.out, name), quality=88)
        pairs.append(sheet)
        entries.append({'pair': os.path.relpath(os.path.join(a.out, name), ROOT), 'render': m['file'], 'photo': photo, 'photoSameTime': same_time, 'seconds': m.get('seconds'), 'samples': m.get('samples'), 'exposure': (m.get('exposure') or {}).get('final')})
        print(f'board: {name}')
    # index sheet: two columns, each pair fitted into the same box
    box_w, box_h, gap = 1100, 560, 12
    thumbs = []
    for sh in pairs:
        k = min(box_w / sh.width, box_h / sh.height)
        thumbs.append(sh.resize((max(1, round(sh.width * k)), max(1, round(sh.height * k))), Image.LANCZOS))
    rows = [thumbs[i:i + 2] for i in range(0, len(thumbs), 2)]
    height = sum(max(t.height for t in row) for row in rows) + gap * (len(rows) + 1)
    index = Image.new('RGB', (box_w * 2 + gap * 3, height), (12, 12, 13))
    y = gap
    for row in rows:
        for k, t in enumerate(row):
            index.paste(t, (gap + k * (box_w + gap) + (box_w - t.width) // 2, y))
        y += max(t.height for t in row) + gap
    index.save(os.path.join(a.out, 'index.jpg'), quality=85)
    with open(os.path.join(a.out, 'board.json'), 'w', encoding='utf-8') as f:
        json.dump({'renders': os.path.relpath(a.renders, ROOT), 'pairs': entries}, f, indent=1)
    print(f"board: index.jpg ({index.width}x{index.height}), {len(entries)} pairs in {os.path.relpath(a.out, ROOT)}")


if __name__ == '__main__':
    main()
