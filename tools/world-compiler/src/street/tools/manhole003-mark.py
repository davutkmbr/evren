#!/usr/bin/env python3
"""
Removes the foundry name ("BEGU" plate and the small emblem plate next to it) from the rim of ambientCG
ManholeCover003 (approval condition in tools/assets/approved.json), in every map of the 1K set.

The cover is round, so the marked rim sector (about 99-136 degrees, radius 376-486 px at 1K, image angles with y down)
is replaced by the same rim rotated from DELTA degrees further on (a multiple of the 4-degree rib spacing, so the ribs
stay in phase), with feathered edges. Normal maps get their tangent-space XY rotated with the content. The original
files are kept in _original/ (not read by the compiler), and conditions.json records the condition as met.

Usage: python3 manhole003-mark.py <assets-src/decal/ManholeCover003>   (PIL only)
"""
import json
import math
import os
import shutil
import sys

from PIL import Image

A0, A1 = 99.0, 136.0
R0, R1 = 376.0, 486.0
FEATHER_DEG = 2.5
FEATHER_PX = 5.0
DELTA = 44.0
CONDITION = "Before shipping, check the rim in the full-size colour and height maps for a foundry name and remove it if present"


def weight(r, a):
    def ramp(v, lo, hi, f):
        if v < lo - f or v > hi + f:
            return 0.0
        if v < lo:
            return (v - (lo - f)) / f
        if v > hi:
            return ((hi + f) - v) / f
        return 1.0

    return ramp(a, A0, A1, FEATHER_DEG) * ramp(r, R0, R1, FEATHER_PX)


def sample(px, w, h, x, y):
    x0 = max(0, min(w - 2, int(math.floor(x))))
    y0 = max(0, min(h - 2, int(math.floor(y))))
    tx = min(1.0, max(0.0, x - x0))
    ty = min(1.0, max(0.0, y - y0))
    a, b, c, d = px[x0, y0], px[x0 + 1, y0], px[x0, y0 + 1], px[x0 + 1, y0 + 1]
    return [a[k] * (1 - tx) * (1 - ty) + b[k] * tx * (1 - ty) + c[k] * (1 - tx) * ty + d[k] * tx * ty for k in range(3)]


def process(src, dst, normal=None):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    s = w / 1024.0
    px = im.load()
    out = im.copy()
    op = out.load()
    cx, cy = w / 2.0, h / 2.0
    d = math.radians(DELTA)
    cd, sd = math.cos(d), math.sin(d)
    for y in range(h):
        for x in range(w):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            r = math.hypot(dx, dy) / s
            a = math.degrees(math.atan2(dy, dx)) % 360.0
            wt = weight(r, a)
            if wt <= 0:
                continue
            # Source: the same radius, DELTA degrees further (image angles, y down).
            sx = cx + dx * cd - dy * sd - 0.5
            sy = cy + dx * sd + dy * cd - 0.5
            v = sample(px, w, h, sx, sy)
            if normal:
                # Tangent-space XY in image axes (x right, y down); GL green is +Y up, DX green is +Y down.
                nx = v[0] / 127.5 - 1.0
                ny = v[1] / 127.5 - 1.0
                if normal == "gl":
                    ny = -ny
                # Content moves by -DELTA: rotate the vector by -DELTA.
                rx = nx * cd + ny * sd
                ry = -nx * sd + ny * cd
                if normal == "gl":
                    ry = -ry
                v = [(rx + 1.0) * 127.5, (ry + 1.0) * 127.5, v[2]]
            o = px[x, y]
            op[x, y] = tuple(int(round(o[k] * (1 - wt) + v[k] * wt)) for k in range(3))
    out.save(dst, quality=95)


def main():
    folder = sys.argv[1]
    orig = os.path.join(folder, "_original")
    os.makedirs(orig, exist_ok=True)
    maps = [f for f in os.listdir(folder) if f.endswith(".jpg") and "_1K-JPG_" in f]
    for f in sorted(maps):
        keep = os.path.join(orig, f)
        if not os.path.exists(keep):
            shutil.copy2(os.path.join(folder, f), keep)
        kind = "gl" if "NormalGL" in f else "dx" if "NormalDX" in f else None
        process(keep, os.path.join(folder, f), kind)
        print("edited", f)
    cj = os.path.join(folder, "conditions.json")
    data = json.load(open(cj)) if os.path.exists(cj) else {}
    met = set(data.get("met", []))
    met.add(CONDITION)
    data["met"] = sorted(met)
    data["notes"] = {
        CONDITION: "Foundry name 'BEGU' and an emblem plate found on the rim (about 99-136 degrees); replaced in every map by the "
        "rim rotated 44 degrees (tools/world-compiler/src/street/tools/manhole003-mark.py). Originals in _original/. "
        "Standard marks (DIN 19584, D400, EN 124) and the generic words KANAL / GUSS stay."
    }
    json.dump(data, open(cj, "w"), indent=2, ensure_ascii=False)
    print("conditions.json updated")


if __name__ == "__main__":
    main()
