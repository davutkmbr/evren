/**
 * Natural surface generators: forest canopy (mixed Istanbul broadleaf/pine forest seen from above), Muslim cemetery
 * (dense cypress, grave rows, gravel paths) and the near-camera detail materials (asphalt, pavers, grass, soil furrows,
 * sand ripples, rock, forest litter).
 */
export const TILE_NATURE_GLSL = /* glsl */ `
/* Forest canopy: one crown per jittered 4 m cell, max-of-domes height field. id = crown hash, mask = on crown. */
Gen genForest(vec2 q) {
  float cell = 4.0;
  float period = uTile / cell;
  vec2 c0 = floor(q / cell);
  float best = 0.35;
  float bestId = -1.0;
  float bestR = 1.0;
  vec2 bestD = vec2(0.0);
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 c = c0 + vec2(float(x), float(y));
      float h = hP(c, period, 3.0);
      if (h < 0.1 + 0.25 * step(0.72, tnoise(c * cell, 24.0, 2))) continue;
      vec2 ctr = (c + 0.5 + (h2P(c, period, 5.0) - 0.5) * 0.9) * cell;
      float r = 2.1 + 3.4 * pow(hP(c, period, 7.0), 1.6);
      float top = 9.0 + 12.0 * hP(c, period, 9.0) + r;
      vec2 d = q - ctr;
      float dome = crownDome(d, r, top);
      if (dome > best) {
        best = dome;
        bestId = h;
        bestR = r;
        bestD = d;
      }
    }
  }
  Gen g = genInit(vec3(0.03, 0.03, 0.02) * (0.7 + 0.6 * tnoise(q, 0.6, 2)), 0.4);
  if (bestId < 0.0) {
    g.id = 0.0;
    return g;
  }
  float s = fract(bestId * 7.31);
  vec3 col;
  if (s < 0.5) col = vec3(0.042, 0.072, 0.024);
  else if (s < 0.68) col = vec3(0.065, 0.095, 0.032);
  else if (s < 0.9) col = vec3(0.026, 0.043, 0.024);
  else if (s < 0.975) col = vec3(0.08, 0.085, 0.032);
  else col = vec3(0.09, 0.065, 0.03);
  bool pine = s >= 0.68 && s < 0.9;
  float clumps = tnoise(q + bestId * 50.0, pine ? 0.45 : 0.8, 3);
  float rn = length(bestD) / bestR;
  col *= (0.62 + 0.75 * clumps) * mix(1.1, 0.7, rn * rn);
  g.alb = col;
  g.h = best + (clumps - 0.5) * (pine ? 0.9 : 1.4);
  g.id = bestId;
  g.mask = 1.0;
  return g;
}

/* Cemetery (axis aligned; the terrain shader rotates it toward the qibla): grave plots, headstones, cypress, paths. */
Gen genCemetery(vec2 q) {
  vec3 earth = mix(vec3(0.12, 0.105, 0.07), vec3(0.055, 0.075, 0.03), tnoise(q, 4.0, 3));
  Gen g = genInit(earth * (0.8 + 0.4 * tnoise(q, 0.5, 2)), 0.1);
  vec4 pv = voronoiP(q, 25.0, 0.8, 61.0);
  if (pv.y - pv.x < 1.2) {
    g.alb = vec3(0.27, 0.25, 0.22) * (0.85 + 0.3 * tnoise(q, 0.3, 2));
    g.h = 0.05;
  } else {
    vec2 gs = vec2(uTile / 100.0, uTile / 54.0);
    float row = floor(q.y / gs.y);
    vec2 qq = vec2(q.x + hP(vec2(row, 0.0), 54.0, 62.0) * gs.x, q.y);
    vec2 gc = floor(qq / gs);
    vec2 gl = qq - (gc + 0.5) * gs;
    float gh = hP(gc, 100.0, 63.0);
    float occupied = step(gh, 0.5 + 0.45 * tnoise(q, 12.0, 2));
    vec2 jit = (h2P(gc, 100.0, 64.0) - 0.5) * 0.15;
    float db = sdBox(gl - jit, vec2(0.46, 0.98));
    if (occupied > 0.5 && db < 0.0) {
      float border = step(-0.07, db);
      float age = fract(gh * 7.0);
      vec3 stone = mix(vec3(0.46, 0.45, 0.42), vec3(0.22, 0.22, 0.2), smoothstep(0.3, 0.9, age));
      g.alb = mix(earth * 0.85, stone, border);
      g.h = 0.15 + border * 0.1;
      if (gl.y - jit.y < -0.75 && abs(gl.x - jit.x) < 0.22) {
        g.alb = stone * 1.05;
        g.h = 1.1;
      }
    }
  }
  float cluster = tnoise(q, 22.0, 2);
  vec4 bv = voronoiP(q, 16.0, 0.8, 71.0);
  if (bv.z < 0.35 && bv.x < 5.0) {
    g.h = crownDome(vec2(bv.x, 0.0), 5.0, 17.0) + (tnoise(q, 0.6, 2) - 0.5) * 1.2;
    g.alb = vec3(0.05, 0.075, 0.028) * (0.65 + 0.7 * tnoise(q, 0.7, 3)) * mix(1.1, 0.7, bv.x / 5.0);
    g.id = bv.z;
    g.mask = 1.0;
    return g;
  }
  vec4 cv = voronoiP(q, 3.4, 0.85, 67.0);
  if (cv.z < 0.3 + 0.55 * cluster) {
    float r = 1.1 + 0.7 * fract(cv.z * 5.3);
    if (cv.x < r) {
      float top = 12.0 + 8.0 * fract(cv.z * 9.1);
      g.h = crownDome(vec2(cv.x, 0.0), r, top) + (tnoise(q, 0.35, 2) - 0.5) * 0.8;
      g.alb = vec3(0.02, 0.034, 0.018) * (0.65 + 0.7 * tnoise(q + cv.z * 30.0, 0.4, 3)) * mix(1.1, 0.7, cv.x / r);
      g.id = cv.z;
      g.mask = 1.0;
    }
  }
  return g;
}

Gen genAsphalt(vec2 q) {
  float grain = hash12(floor(q * 40.0));
  float tone = tnoise(q, 3.0, 4);
  vec3 a = vec3(0.066, 0.066, 0.07) * (0.8 + 0.35 * tone) * (0.85 + 0.3 * grain);
  vec4 pv = voronoiP(q, 6.0, 1.0, 71.0);
  if (pv.z < 0.18) a *= 0.72;
  else if (pv.z > 0.9) a = a * 1.3 + 0.01;
  vec4 cr = voronoiP(q, 2.4, 1.0, 73.0);
  float crack = step(cr.y - cr.x, 0.035) * step(0.55, tnoise(q, 5.0, 2));
  a = mix(a, vec3(0.025), crack);
  float stain = smoothstep(0.72, 0.8, tnoise(q + 9.0, 1.6, 3));
  a *= 1.0 - 0.35 * stain;
  Gen g = genInit(a, 0.02 * grain - crack * 0.02);
  return g;
}

Gen genPavers(vec2 q) {
  vec2 sz = vec2(uTile / 66.0, uTile / 132.0);
  float row = floor(q.y / sz.y);
  vec2 p = vec2(q.x + mod(row, 2.0) * sz.x * 0.5, q.y);
  vec2 c = floor(p / sz);
  vec2 l = p - (c + 0.5) * sz;
  float h = hP(c + vec2(0.0, row * 0.0), uTile / sz.x, 79.0);
  float joint = sdBox(l, sz * 0.5 - 0.012);
  vec3 base = mix(vec3(0.26, 0.25, 0.23), vec3(0.3, 0.2, 0.15), step(0.8, h));
  base *= 0.82 + 0.3 * h;
  base *= 0.85 + 0.3 * tnoise(q, 2.0, 3);
  Gen g = genInit(joint > 0.0 ? base * 0.45 : base, joint > 0.0 ? 0.0 : 0.02 - joint * 0.2);
  return g;
}

Gen genGrass(vec2 q) {
  float blades = hash12(floor(q * 60.0));
  float tuft = tnoise(q, 0.25, 3);
  float patchy = tnoise(q, 1.8, 3);
  vec3 green = vec3(0.055, 0.095, 0.028);
  vec3 dry = vec3(0.19, 0.16, 0.08);
  vec3 c = mix(green, dry, smoothstep(0.5, 0.85, patchy) * 0.8);
  c *= 0.7 + 0.35 * tuft + 0.25 * blades;
  float soil = smoothstep(0.78, 0.86, tnoise(q + 4.0, 1.1, 3));
  c = mix(c, vec3(0.13, 0.1, 0.07), soil);
  Gen g = genInit(c, 0.03 * tuft + 0.02 * blades);
  return g;
}

Gen genSoil(vec2 q) {
  float furrow = sin(q.y * 6.2831853 * floor(uTile / 0.75) / uTile + tnoise(q, 3.0, 2) * 2.0);
  float clods = tnoise(q, 0.15, 3);
  vec3 c = mix(vec3(0.1, 0.07, 0.045), vec3(0.17, 0.125, 0.08), furrow * 0.5 + 0.5);
  c *= 0.8 + 0.4 * clods;
  float pebble = step(0.93, hash12(floor(q * 25.0)));
  c = mix(c, vec3(0.3, 0.27, 0.23), pebble);
  Gen g = genInit(c, 0.09 * furrow + 0.03 * clods);
  return g;
}

Gen genSand(vec2 q) {
  float warp = tnoise(q, 1.5, 2) * 0.6;
  float ripple = sin((q.x + warp + 0.25 * q.y) * 6.2831853 * 76.0 / uTile);
  float grain = hash12(floor(q * 50.0));
  vec3 c = vec3(0.47, 0.41, 0.3) * (0.9 + 0.15 * tnoise(q, 2.0, 3));
  c *= 0.93 + 0.1 * ripple;
  c = mix(c, vec3(0.2, 0.17, 0.13), step(0.965, grain));
  c = mix(c, vec3(0.7, 0.68, 0.62), step(grain, 0.02));
  Gen g = genInit(c, 0.012 * ripple);
  return g;
}

Gen genRock(vec2 q) {
  vec4 v = voronoiP(q, 2.6, 0.9, 83.0);
  float crack = smoothstep(0.08, 0.0, v.y - v.x);
  vec3 c = mix(vec3(0.23, 0.22, 0.2), vec3(0.3, 0.26, 0.2), v.z);
  c *= 0.75 + 0.45 * tnoise(q, 0.6, 4);
  c = mix(c, vec3(0.34, 0.24, 0.13), smoothstep(0.65, 0.8, tnoise(q + 7.0, 4.0, 3)) * 0.5);
  c = mix(c, vec3(0.38, 0.37, 0.25), step(0.82, tnoise(q + 3.0, 0.2, 2)) * 0.6);
  c *= 1.0 - 0.6 * crack;
  float strata = 0.5 + 0.5 * sin(q.y * 6.2831853 * 16.0 / uTile + tnoise(q, 2.0, 2) * 4.0);
  Gen g = genInit(c * (0.9 + 0.2 * strata), 0.25 * v.z + 0.12 * tnoise(q, 0.5, 3) - 0.15 * crack);
  return g;
}

Gen genForestFloor(vec2 q) {
  vec4 v = voronoiP(q, 0.09, 1.0, 89.0);
  float r = v.z;
  vec3 c;
  if (r < 0.35) c = vec3(0.1, 0.06, 0.028);
  else if (r < 0.6) c = vec3(0.075, 0.065, 0.03);
  else if (r < 0.75) c = vec3(0.16, 0.07, 0.02);
  else if (r < 0.9) c = vec3(0.045, 0.035, 0.022);
  else c = vec3(0.13, 0.11, 0.07);
  c *= 0.75 + 0.5 * tnoise(q, 0.5, 2);
  float moss = smoothstep(0.62, 0.75, tnoise(q, 1.2, 3));
  c = mix(c, vec3(0.04, 0.075, 0.02), moss);
  Gen g = genInit(c, 0.02 * (1.0 - smoothstep(0.0, 0.04, v.y - v.x)) + 0.02 * moss);
  return g;
}
`;
