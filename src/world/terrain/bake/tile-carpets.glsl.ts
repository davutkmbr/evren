/**
 * City "carpet" generators: top-down urban fabric used beyond the city module's building radius so the far city reads
 * as a dense city. Blocks come from a periodic jittered lattice (irregular street grid); streets carry parked cars and
 * lamps (night light channels), blocks carry perimeter apartment rows with terracotta hip roofs or flat roofs with
 * water tanks / solar heaters (typical Istanbul rooftops), courtyards, gardens, parking lots and sheds.
 */
export const TILE_CARPETS_GLSL = /* glsl */ `
struct Blk {
  vec2 cell;
  float t1;
  float t2;
  float s1;
  float hw1;
  float edgeHash1;
  float blockHash;
  float along;
  float across;
  float cornerIdx;
};

vec2 latticePoint(vec2 c, float P, float B, float jit, float seed) {
  return c * B + (h2P(c, P, seed) - 0.5) * jit * B;
}

/* Street half width of the lattice edge starting at lattice point c (type 0 = along +x, 1 = along +z). */
float edgeHalfWidth(vec2 c, float type, float P, float seed, float hwBase, float hwVar, float mainChance, float mainHw) {
  float h = hP(c, P, seed + 10.0 + type * 3.0);
  float m = hP(c, P, seed + 20.0 + type * 3.0);
  return m < mainChance ? mainHw : hwBase + hwVar * h;
}

Blk findBlock(vec2 q, float B, float P, float jit, float seed, float hwBase, float hwVar, float mainChance, float mainHw) {
  Blk b;
  b.t1 = -1e3;
  vec2 g = floor(q / B);
  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      vec2 c = g + vec2(float(ox), float(oy));
      vec2 v0 = latticePoint(c, P, B, jit, seed);
      vec2 v1 = latticePoint(c + vec2(1.0, 0.0), P, B, jit, seed);
      vec2 v2 = latticePoint(c + vec2(1.0, 1.0), P, B, jit, seed);
      vec2 v3 = latticePoint(c + vec2(0.0, 1.0), P, B, jit, seed);
      vec2 d0 = normalize(v1 - v0);
      vec2 d1 = normalize(v2 - v1);
      vec2 d2 = normalize(v3 - v2);
      vec2 d3 = normalize(v0 - v3);
      float e0 = dot(q - v0, vec2(-d0.y, d0.x));
      float e1 = dot(q - v1, vec2(-d1.y, d1.x));
      float e2 = dot(q - v2, vec2(-d2.y, d2.x));
      float e3 = dot(q - v3, vec2(-d3.y, d3.x));
      if (min(min(e0, e1), min(e2, e3)) < 0.0) continue;
      float w0 = edgeHalfWidth(c, 0.0, P, seed, hwBase, hwVar, mainChance, mainHw);
      float w1 = edgeHalfWidth(c + vec2(1.0, 0.0), 1.0, P, seed, hwBase, hwVar, mainChance, mainHw);
      float w2 = edgeHalfWidth(c + vec2(0.0, 1.0), 0.0, P, seed, hwBase, hwVar, mainChance, mainHw);
      float w3 = edgeHalfWidth(c, 1.0, P, seed, hwBase, hwVar, mainChance, mainHw);
      float t[4];
      t[0] = e0 - w0;
      t[1] = e1 - w1;
      t[2] = e2 - w2;
      t[3] = e3 - w3;
      int i1 = 0;
      for (int k = 1; k < 4; k++) if (t[k] < t[i1]) i1 = k;
      int i2 = i1 == 0 ? 1 : 0;
      for (int k = 0; k < 4; k++) if (k != i1 && t[k] < t[i2]) i2 = k;
      b.cell = c;
      b.t1 = t[i1];
      b.t2 = t[i2];
      b.blockHash = hP(c, P, seed + 40.0);
      // Canonical frame of the nearest street (same along/across from both blocks sharing it).
      vec2 cs;
      vec2 cd;
      float hw;
      float type;
      vec2 eid;
      if (i1 == 0) { cs = v0; cd = d0; hw = w0; type = 0.0; eid = c; }
      else if (i1 == 1) { cs = v1; cd = d1; hw = w1; type = 1.0; eid = c + vec2(1.0, 0.0); }
      else if (i1 == 2) { cs = v3; cd = -d2; hw = w2; type = 0.0; eid = c + vec2(0.0, 1.0); }
      else { cs = v0; cd = -d3; hw = w3; type = 1.0; eid = c; }
      b.hw1 = hw;
      b.edgeHash1 = hP(eid, P, seed + 60.0 + type * 7.0);
      b.along = dot(q - cs, cd);
      b.across = dot(q - cs, vec2(-cd.y, cd.x));
      b.s1 = b.along;
      b.cornerIdx = float(min(i1, i2) * 4 + max(i1, i2));
      return b;
    }
  }
  b.cell = g;
  b.t1 = -1.0;
  b.t2 = 50.0;
  b.s1 = q.x;
  b.hw1 = 4.0;
  b.edgeHash1 = 0.5;
  b.blockHash = 0.5;
  b.along = q.x;
  b.across = 0.0;
  b.cornerIdx = 0.0;
  return b;
}

/* Street lamps along the nearest street (canonical frame => consistent across the street). */
void streetLamps(inout Gen g, Blk b, float spacing, float warmChance, float strength) {
  float phase = b.edgeHash1 * spacing;
  float side = fract(b.edgeHash1 * 7.3) < 0.5 ? -1.0 : 1.0;
  float k = floor((b.along - phase) / spacing + 0.5);
  float ds = b.along - (phase + k * spacing);
  float lampAcross = side * max(b.hw1 - 0.6, 0.5);
  float da = b.across - lampAcross;
  float d2 = ds * ds + da * da;
  float pool = exp(-d2 / (2.0 * 7.0 * 7.0)) * 0.16 + exp(-d2 / (2.0 * 2.2 * 2.2)) * 0.22;
  float core = smoothstep(0.9, 0.25, sqrt(d2));
  float e = (pool + core) * strength;
  if (fract(b.edgeHash1 * 31.7) < warmChance) g.warm += e; else g.cool += e;
}

/* Parked cars along the curb band of a street pixel (across = 0 at the curb, positive toward the centre). */
void parkedCars(inout Gen g, Blk b, float occupancy) {
  float across = -b.t1;
  if (across < 0.2 || across > 2.25) return;
  float slot = floor(b.s1 / 5.5);
  float u = b.s1 - (slot + 0.5) * 5.5;
  float seed = hash12(vec2(slot, b.edgeHash1 * 977.0 + b.blockHash * 131.0));
  if (seed > occupancy) return;
  vec3 a = g.alb;
  float h = g.h;
  if (carTopDown(vec2(u + (seed - 0.5) * 0.6, across - 1.2), seed, a, h) > 0.0) {
    g.alb = a;
    g.h = h;
  }
}

/* Roof of a building lot. u, v: local metres inside the lot of size (w, d). */
void roofShape(inout Gen g, float u, float v, float w, float d, float base, float seed, float terracottaChance, float historic) {
  float edge = min(min(u, w - u), min(v, d - v));
  float r = fract(seed * 17.13);
  float r2 = fract(seed * 5.71);
  float r3 = fract(seed * 91.3);
  float grime = tnoise(vec2(u, v) + seed * 40.0, 3.0, 3);
  if (r < terracottaChance) {
    float rise = min(edge * 0.5, 3.2);
    vec3 tile;
    if (r2 < 0.4) tile = vec3(0.33, 0.13, 0.075);
    else if (r2 < 0.7) tile = vec3(0.27, 0.12, 0.078);
    else if (r2 < 0.9) tile = vec3(0.22, 0.13, 0.095);
    else tile = vec3(0.38, 0.17, 0.09);
    // Weathering: soot/moss darkening, dusty greying.
    tile = mix(tile, vec3(0.14, 0.1, 0.08), smoothstep(0.55, 0.9, grime) * 0.5);
    tile = mix(tile, vec3(0.26, 0.23, 0.2), smoothstep(0.7, 1.0, r3) * 0.45);
    float rows = 0.9 + 0.1 * step(0.5, fract(edge / 0.33));
    tile *= rows * (0.9 + 0.2 * tnoise(vec2(u, v) + seed * 40.0, 0.9, 3));
    tile *= mix(0.72, 1.0, smoothstep(0.0, 0.5, edge));
    g.alb = tile;
    g.h = base + rise;
    return;
  }
  // Flat roof: parapet, stair/lift house, water tanks, solar heaters, dishes.
  vec3 slab;
  if (r2 < 0.3) slab = vec3(0.3, 0.29, 0.27);
  else if (r2 < 0.5) slab = vec3(0.23, 0.225, 0.21);
  else if (r2 < 0.66) slab = vec3(0.43, 0.39, 0.32);
  else if (r2 < 0.78) slab = vec3(0.58, 0.58, 0.56);
  else if (r2 < 0.9) slab = vec3(0.075, 0.075, 0.08);
  else slab = vec3(0.2, 0.12, 0.085);
  slab *= 0.82 + 0.3 * grime;
  slab = mix(slab, slab * 0.6, smoothstep(0.75, 0.95, tnoise(vec2(u, v) * 1.7 + seed * 13.0, 1.5, 3)) * 0.6);
  g.alb = slab;
  g.h = base;
  if (edge < 0.35) {
    g.alb = min(slab * 1.2 + 0.04, vec3(0.7));
    g.h = base + 0.9;
    return;
  }
  vec2 sp = vec2(w * (0.3 + 0.4 * r3), d * (0.35 + 0.3 * fract(seed * 2.9)));
  if (sdBox(vec2(u, v) - sp, vec2(1.3, 1.7)) < 0.0 && w > 6.0) {
    g.alb = vec3(0.34, 0.33, 0.31);
    g.h = base + 2.7;
    return;
  }
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 tp = vec2(1.4 + (w - 2.8) * fract(seed * (3.1 + fi * 1.7)), 1.4 + (d - 2.8) * fract(seed * (7.9 + fi * 2.3)));
    float kind = fract(seed * (11.3 + fi * 5.1));
    if (kind < 0.5) {
      float tr = 0.55 + 0.2 * fract(seed * (19.0 + fi));
      if (length(vec2(u, v) - tp) < tr) {
        float c = fract(seed * (23.0 + fi * 3.0));
        g.alb = c < 0.55 ? vec3(0.62, 0.62, 0.6) : c < 0.8 ? vec3(0.05) : vec3(0.3, 0.36, 0.42);
        g.h = base + 1.3;
        return;
      }
    } else if (kind < 0.85) {
      vec2 lp = vec2(u, v) - tp;
      if (sdBox(lp, vec2(1.0, 0.95)) < 0.0) {
        bool tank = lp.y > 0.55;
        g.alb = tank ? vec3(0.55, 0.55, 0.53) : vec3(0.02, 0.03, 0.06) + 0.02 * step(0.5, fract(lp.x * 3.0));
        g.h = base + (tank ? 1.4 : 0.9 - lp.y * 0.4);
        return;
      }
    } else if (length(vec2(u, v) - tp) < 0.4) {
      g.alb = vec3(0.6);
      g.h = base + 0.8;
      return;
    }
  }
}

/* Window glow on the street-facing band of a building (reads as the city's facade lights from far away). */
void facadeGlow(inout Gen g, float v, float along, float seed, float warmChance, float strength) {
  if (v > 1.6) return;
  float bay = floor(along / 3.2);
  float lit = hash12(vec2(bay, seed * 311.0));
  if (lit > 0.55) return;
  float e = strength * (0.5 + lit) * smoothstep(1.6, 0.4, v);
  if (fract(lit * 13.7) < warmChance) g.warm += e; else g.cool += e;
}

/* Dense apartment fabric (Fatih, Beyoğlu, Kadıköy, Şişli...): small irregular blocks built out to the street in
 * attached rows ("bitişik nizam"), light wells or small courtyards. historic > 0.5 => lower, more tile roofs, lanes. */
Gen genDenseCarpet(vec2 q, float historic) {
  float B = historic > 0.5 ? 42.667 : 48.0;
  float P = uTile / B;
  Blk b = findBlock(q, B, P, historic > 0.5 ? 0.62 : 0.5, historic > 0.5 ? 3.0 : 1.0, historic > 0.5 ? 2.4 : 2.8, 1.8, 0.1, 6.5);
  vec3 asphalt = vec3(0.075, 0.074, 0.076) * (0.8 + 0.4 * tnoise(q, 5.0, 3));
  Gen g = genInit(asphalt, 0.0);
  float sw = 1.1 + 1.0 * fract(b.edgeHash1 * 3.1);
  float D = 13.0 + 9.0 * fract(b.blockHash * 5.3);
  if (b.t1 < 0.0) {
    parkedCars(g, b, historic > 0.5 ? 0.5 : 0.8);
    if (b.hw1 > 5.5 && abs(b.across) < 0.09 && fract(b.along / 9.0) < 0.4) {
      g.alb = vec3(0.45);
    }
  } else if (b.t1 < sw) {
    g.alb = vec3(0.26, 0.25, 0.23) * (0.85 + 0.3 * tnoise(q, 1.5, 2));
    g.h = 0.15;
    if (b.t1 < 0.2) g.alb = vec3(0.36, 0.35, 0.33);
  } else if (b.t1 < sw + D) {
    float v = b.t1 - sw;
    bool corner = b.t2 < sw + D;
    float lotW = 6.0 + 8.0 * fract(b.edgeHash1 * 13.1);
    float lotIdx = floor(b.along / lotW);
    float u = b.along - lotIdx * lotW;
    float w = lotW;
    float d = D;
    float seed = hash12(vec2(lotIdx, b.edgeHash1 * 733.0));
    if (corner) {
      u = b.t2 - sw;
      w = D;
      seed = hash12(b.cell * 3.1 + b.cornerIdx);
    }
    float floors = historic > 0.5 ? 2.0 + floor(4.0 * fract(seed * 3.7)) : 3.0 + floor(6.0 * pow(fract(seed * 3.7), 0.9));
    float base = floors * 3.05 + 0.5;
    if (fract(seed * 41.3) < 0.035) {
      g.alb = fract(seed * 7.0) < 0.5 ? vec3(0.05, 0.075, 0.025) : vec3(0.2, 0.15, 0.1);
      g.h = 0.3;
    } else {
      // Light well in deep buildings.
      if (d > 17.0 && sdBox(vec2(u - w * 0.5, v - d * 0.6), vec2(1.2, 1.5)) < 0.0 && w > 8.0) {
        g.alb = vec3(0.04);
        g.h = base * 0.3;
      } else {
        roofShape(g, u, v, w, d, base, seed, historic > 0.5 ? 0.75 : 0.42, historic);
      }
      facadeGlow(g, v, b.along, seed, historic > 0.5 ? 0.85 : 0.7, 0.22);
    }
  } else {
    // Block interior: small courtyards partly filled with low annexes and a few trees.
    g.alb = vec3(0.13, 0.12, 0.11) * (0.8 + 0.4 * tnoise(q, 3.0, 2));
    g.h = 0.2;
    vec4 vt = voronoiP(q, 7.0, 0.9, 5.0);
    if (vt.z < 0.3 && vt.x < 2.5) {
      g.alb = vec3(0.04, 0.07, 0.025) * (0.7 + 0.6 * tnoise(q, 0.8, 2));
      g.h = crownDome(vec2(vt.x, 0.0), 2.5, 7.0 + 3.0 * vt.z);
    } else if (vt.z > 0.55) {
      float seed = vt.z * 13.7;
      vec2 lp = vec2(vt.x, vt.y - vt.x);
      roofShape(g, 2.0 + vt.x, 2.0 + (vt.y - vt.x), 6.0, 6.0, 3.5 + 3.0 * fract(seed), seed, 0.5, historic);
    }
  }
  if (b.t1 < sw) {
    streetLamps(g, b, 24.0, historic > 0.5 ? 0.85 : 0.62, 1.0);
  }
  return g;
}

/* Modern residential superblocks ("site"s): slab and point blocks, lawns, parking lots, boulevards. */
Gen genModernCarpet(vec2 q) {
  float B = 128.0;
  float P = uTile / B;
  Blk b = findBlock(q, B, P, 0.16, 7.0, 6.0, 3.0, 0.3, 10.0);
  vec3 asphalt = vec3(0.06, 0.06, 0.064) * (0.8 + 0.4 * tnoise(q, 6.0, 3));
  Gen g = genInit(asphalt, 0.0);
  float sw = 3.0;
  if (b.t1 < 0.0) {
    parkedCars(g, b, 0.5);
    if (abs(b.across) < 0.12 && fract(b.along / 9.0) < 0.4) g.alb = vec3(0.5);
    if (b.hw1 > 9.0 && abs(b.across) < 1.4) {
      g.alb = vec3(0.07, 0.1, 0.035);
      g.h = 0.3;
      float k = fract(b.along / 11.0);
      if (abs(k - 0.5) * 11.0 < 2.4) { g.alb = vec3(0.035, 0.065, 0.02); g.h = 6.0; }
    }
    streetLamps(g, b, 30.0, 0.3, 1.2);
    return g;
  }
  if (b.t1 < sw) {
    g.alb = vec3(0.27, 0.26, 0.24) * (0.9 + 0.2 * tnoise(q, 1.5, 2));
    g.h = 0.15;
    streetLamps(g, b, 30.0, 0.3, 1.2);
    return g;
  }
  // Plot grid inside the superblock, aligned with the lattice cell (approximate: world axes).
  vec2 plotSize = vec2(B * 0.5);
  vec2 pc = floor(q / plotSize);
  vec2 pl = q - (pc + 0.5) * plotSize;
  float seed = hP(pc, uTile / plotSize.x, 13.0);
  float kind = fract(seed * 7.7);
  // Ground: lawn / parking / plaza
  float gn = tnoise(q, 7.0, 3);
  vec3 lawn = mix(vec3(0.075, 0.1, 0.035), vec3(0.16, 0.14, 0.07), smoothstep(0.35, 0.75, tnoise(q, 30.0, 2)));
  g.alb = lawn * (0.85 + 0.3 * gn);
  g.h = 0.1;
  vec2 bsz;
  float rotq = step(0.5, fract(seed * 3.3));
  if (kind < 0.55) bsz = vec2(17.0 + 10.0 * fract(seed * 5.0), 7.5 + 2.0 * fract(seed * 9.0));
  else bsz = vec2(9.0 + 3.0 * fract(seed * 5.0));
  if (rotq > 0.5) bsz = bsz.yx;
  vec2 off = (h2P(pc, uTile / plotSize.x, 17.0) - 0.5) * (plotSize * 0.5 - bsz - 6.0) * 0.8;
  vec2 lp = pl - off;
  float db = sdBox(lp, bsz);
  // Parking lot beside the building.
  vec2 pp = pl - vec2(-off.x, off.y + (off.y > 0.0 ? -1.0 : 1.0) * (bsz.y + 10.0));
  if (sdBox(pp, vec2(18.0, 7.0)) < 0.0 && db > 3.0) {
    g.alb = asphalt * 1.1;
    float bay = floor((pp.x + 18.0) / 2.6);
    float row = step(0.0, pp.y);
    float bu = pp.x + 18.0 - (bay + 0.5) * 2.6;
    if (abs(bu) > 1.22) g.alb = vec3(0.5);
    float cs = hash12(vec2(bay, row + seed * 91.0));
    if (cs < 0.7) {
      vec3 a = g.alb;
      float h = g.h;
      if (carTopDown(vec2(abs(pp.y) - 3.5, bu), cs, a, h) > 0.0) { g.alb = a; g.h = h; }
    }
    float lamp = length(vec2(fract(pp.x / 12.0) - 0.5, 0.0) * 12.0) + abs(pp.y);
    g.cool += exp(-lamp * lamp / 50.0) * 0.12;
  }
  if (db < 0.0) {
    float floors = 6.0 + floor(12.0 * pow(fract(seed * 13.1), 1.3));
    float base = floors * 2.95 + 1.0;
    vec2 u = lp + bsz;
    roofShape(g, u.x, u.y, bsz.x * 2.0, bsz.y * 2.0, base, seed, 0.22, 0.0);
    float v = min(min(u.x, 2.0 * bsz.x - u.x), min(u.y, 2.0 * bsz.y - u.y));
    facadeGlow(g, v, u.x + u.y, seed, 0.45, 0.3);
  } else if (db < 2.5) {
    g.alb = vec3(0.28, 0.27, 0.25);
    g.h = 0.15;
  } else {
    vec4 vt = voronoiP(q, 10.0, 0.9, 21.0);
    if (vt.z < 0.3 && vt.x < 2.8) {
      g.alb = vec3(0.04, 0.07, 0.025) * (0.7 + 0.6 * tnoise(q, 0.8, 2));
      g.h = crownDome(vec2(vt.x, 0.0), 2.8, 7.5);
    }
  }
  return g;
}

/* Detached houses with gardens, trees and pools (villa / yalı / suburban). */
Gen genVillaCarpet(vec2 q) {
  float B = 64.0;
  float P = uTile / B;
  Blk b = findBlock(q, B, P, 0.5, 11.0, 3.0, 1.0, 0.06, 5.0);
  Gen g = genInit(vec3(0.07, 0.07, 0.072) * (0.8 + 0.4 * tnoise(q, 5.0, 3)), 0.0);
  if (b.t1 < 0.0) {
    parkedCars(g, b, 0.3);
    streetLamps(g, b, 32.0, 0.75, 0.8);
    return g;
  }
  // Lots: 2 x 2 per block via the along/depth frame of the nearest street.
  float lotW = 20.0 + 8.0 * fract(b.edgeHash1 * 5.3);
  float lotIdx = floor(b.along / lotW);
  float u = b.along - lotIdx * lotW;
  float v = b.t1;
  float seed = hash12(vec2(lotIdx, b.edgeHash1 * 419.0));
  vec3 grass = mix(vec3(0.06, 0.1, 0.03), vec3(0.14, 0.13, 0.06), smoothstep(0.3, 0.8, tnoise(q, 25.0, 2)));
  g.alb = grass * (0.8 + 0.4 * tnoise(q, 2.0, 3));
  g.h = 0.1;
  // Hedges on lot lines.
  float lotLine = min(u, lotW - u);
  if (lotLine < 0.6 || (v > 0.0 && v < 0.7)) {
    g.alb = vec3(0.03, 0.055, 0.02);
    g.h = 1.6;
  }
  vec2 hc = vec2(lotW * 0.5 + (fract(seed * 3.0) - 0.5) * 4.0, 7.0 + 5.0 * fract(seed * 7.0));
  vec2 hs = vec2(5.0 + 2.0 * fract(seed * 11.0), 4.5 + 1.5 * fract(seed * 13.0));
  vec2 hp = vec2(u, v) - hc;
  if (sdBox(hp, hs) < 0.0 && b.t2 - b.t1 > hs.y * 2.0 + 2.0) {
    float floors = 2.0 + floor(2.0 * fract(seed * 17.0));
    roofShape(g, hp.x + hs.x, hp.y + hs.y, hs.x * 2.0, hs.y * 2.0, floors * 3.0 + 0.4, seed, 0.72, 0.0);
    float edge = min(min(hp.x + hs.x, hs.x - hp.x), min(hp.y + hs.y, hs.y - hp.y));
    facadeGlow(g, edge, hp.x, seed, 0.85, 0.2);
  } else if (fract(seed * 23.0) < 0.28 && sdRoundBox(vec2(u, v) - vec2(hc.x, hc.y + hs.y + 6.0), vec2(4.0, 2.0), 0.4) < 0.0) {
    g.alb = vec3(0.06, 0.33, 0.42);
    g.h = -0.3;
    g.cool += 0.1;
  } else if (u > hc.x - 1.5 && u < hc.x + 1.5 && v < hc.y - hs.y) {
    g.alb = vec3(0.3, 0.28, 0.25);
  } else {
    vec4 vt = voronoiP(q, 8.0, 0.9, 31.0);
    if (vt.z < 0.45 && vt.x < 3.2) {
      float r = 2.2 + 1.2 * fract(vt.z * 7.0);
      if (vt.x < r) {
        g.alb = mix(vec3(0.035, 0.065, 0.022), vec3(0.03, 0.045, 0.03), step(0.7, fract(vt.z * 13.0))) * (0.7 + 0.6 * tnoise(q, 0.7, 2));
        g.h = crownDome(vec2(vt.x, 0.0), r, 6.0 + 6.0 * vt.z);
      }
    }
  }
  if (b.t1 < 3.0) streetLamps(g, b, 32.0, 0.75, 0.8);
  return g;
}

/* Industrial estates: large sheds, yards with trucks and containers. */
Gen genIndustrialCarpet(vec2 q) {
  float B = 160.0;
  float P = uTile / B;
  Blk b = findBlock(q, B, P, 0.12, 17.0, 7.0, 2.0, 0.2, 9.0);
  vec3 asphalt = vec3(0.07, 0.07, 0.072) * (0.8 + 0.4 * tnoise(q, 8.0, 3));
  Gen g = genInit(asphalt, 0.0);
  if (b.t1 < 0.0) {
    parkedCars(g, b, 0.35);
    streetLamps(g, b, 36.0, 0.8, 1.2);
    return g;
  }
  vec3 yard = vec3(0.24, 0.23, 0.21) * (0.75 + 0.5 * tnoise(q, 12.0, 3));
  yard = mix(yard, vec3(0.2, 0.16, 0.11), smoothstep(0.6, 0.8, tnoise(q, 40.0, 2)) * 0.6);
  g.alb = yard;
  g.h = 0.1;
  vec2 sc = floor(q / 80.0);
  vec2 sl = q - (sc + 0.5) * 80.0;
  float seed = hP(sc, uTile / 80.0, 43.0);
  vec2 ss = vec2(24.0 + 12.0 * fract(seed * 3.0), 14.0 + 10.0 * fract(seed * 5.0));
  if (fract(seed * 9.0) < 0.5) ss = ss.yx;
  vec2 off = (h2P(sc, uTile / 80.0, 47.0) - 0.5) * (80.0 - 2.0 * ss - 10.0);
  vec2 lp = sl - off;
  float db = sdBox(lp, ss);
  if (db < 0.0 && fract(seed * 29.0) > 0.12) {
    float r = fract(seed * 13.0);
    vec3 roof = r < 0.35 ? vec3(0.36, 0.37, 0.37) : r < 0.55 ? vec3(0.13, 0.17, 0.23) : r < 0.75 ? vec3(0.55, 0.55, 0.53) : r < 0.87 ? vec3(0.22, 0.11, 0.07) : vec3(0.2, 0.26, 0.2);
    float ribAxis = ss.x > ss.y ? lp.y : lp.x;
    float rib = 0.93 + 0.07 * step(0.5, fract(ribAxis / 0.9));
    float sky = step(0.8, fract((ss.x > ss.y ? lp.x : lp.y) / 8.0));
    roof = mix(roof * rib, vec3(0.5, 0.52, 0.5), sky * 0.6);
    roof *= 0.9 + 0.2 * tnoise(q, 6.0, 2);
    float saw = fract(seed * 31.0) < 0.3 ? fract((ss.x > ss.y ? lp.x : lp.y) / 9.0) * 2.2 : 0.0;
    g.alb = roof;
    g.h = 9.0 + 6.0 * fract(seed * 17.0) + saw;
    if (min(abs(lp.x) - ss.x, abs(lp.y) - ss.y) > -0.5) g.h += 0.6;
    g.warm += 0.03 * step(fract(seed * 37.0), 0.4);
  } else {
    // Trucks and containers in the yard.
    vec2 tq = q;
    vec2 tc = floor(tq / vec2(16.0, 5.0));
    vec2 tl = tq - (tc + 0.5) * vec2(16.0, 5.0);
    float th = hP(tc, uTile / 16.0, 51.0);
    if (th < 0.09 && sdBox(tl, vec2(6.2, 1.25)) < 0.0 && db > 4.0 && tnoise(q, 30.0, 2) > 0.5) {
      float cr = fract(th * 37.0);
      g.alb = cr < 0.3 ? vec3(0.55) : cr < 0.5 ? vec3(0.3, 0.05, 0.03) : cr < 0.7 ? vec3(0.04, 0.1, 0.25) : cr < 0.85 ? vec3(0.08, 0.2, 0.08) : vec3(0.35, 0.18, 0.06);
      g.alb *= 0.9 + 0.1 * step(0.5, fract(tl.x / 0.6));
      g.h = 2.6;
    }
    vec2 lamp = fract(q / 40.0) - 0.5;
    g.warm += exp(-dot(lamp, lamp) * 40.0 * 40.0 / 60.0) * 0.35;
  }
  if (b.t1 < 4.0) streetLamps(g, b, 36.0, 0.8, 1.2);
  return g;
}
`;
