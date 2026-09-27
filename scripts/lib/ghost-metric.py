#!/usr/bin/env python3
"""TAA ghosting metric: mean luma difference to a reference run near a masked object vs elsewhere.

    python3 scripts/lib/ghost-metric.py <scene dir> <reference run> <run,run,...> <mask run>

Runs are flicker-audit.mjs --dump outputs; the mask run draws only the object (--only <name> --toggles pass:clouds).
Frames 16..47 (after the history has converged)."""
import sys
from PIL import Image, ImageFilter, ImageChops, ImageStat
d = sys.argv[1]; ref = sys.argv[2]; runs = sys.argv[3].split(','); maskrun = sys.argv[4]
def lum(p): return Image.open(p).convert('L')
tot = {r: [0, 0, 0, 0] for r in runs}
for f in range(16, 48):
    m = lum(f'{d}/{maskrun}/frames/{f:03d}.png').point(lambda v: 255 if v > 6 else 0)
    ring = m.filter(ImageFilter.MaxFilter(17))  # dragon + 8 px around it
    inv = ImageChops.invert(ring)
    a = lum(f'{d}/{ref}/frames/{f:03d}.png')
    for r in runs:
        b = lum(f'{d}/{r}/frames/{f:03d}.png')
        diff = ImageChops.difference(a, b)
        si = ImageStat.Stat(diff, ring); so = ImageStat.Stat(diff, inv)
        tot[r][0] += si.mean[0]; tot[r][1] += so.mean[0]; tot[r][2] += 1
for r, (i, o, n, _) in tot.items():
    print(f'{r:28s} near dragon {i/n:6.2f}   elsewhere {o/n:6.2f}   ratio {i/max(o,1e-6):5.2f}')
