/**
 * Shader patches for the shared life material (vessels, piers). Attribute layout: see util/mesh-builder.ts.
 * BatchedMesh instance colour: rgb = hull paint (aSurf.x = 1 surfaces), a = palette/weathering seed
 * (palette = floor(a * 8), weathering = fract(a * 8)).
 */

export const LIFE_VERTEX_PARS = /* glsl */ `
attribute vec4 aSurf;
attribute float aDetail;
varying vec4 vLifeSurf;
varying float vLifeDetail;
varying vec3 vLifeObjPos;
varying vec3 vLifeObjNormal;
varying float vLifeSeed;

vec3 lifeAccent(float seed) {
  int i = int(floor(seed * 8.0));
  // Funnel / accent liveries (linear).
  if (i == 0) return vec3(0.62, 0.035, 0.025);
  if (i == 1) return vec3(0.02, 0.06, 0.20);
  if (i == 2) return vec3(0.78, 0.52, 0.04);
  if (i == 3) return vec3(0.55, 0.56, 0.57);
  if (i == 4) return vec3(0.03, 0.18, 0.09);
  if (i == 5) return vec3(0.05, 0.22, 0.42);
  if (i == 6) return vec3(0.80, 0.78, 0.74);
  return vec3(0.35, 0.05, 0.08);
}
`;

export const LIFE_COLOR_VERTEX = /* glsl */ `
  vColor = vec4(1.0);
#ifdef USE_COLOR
  vColor.rgb = color;
#endif
  vLifeSeed = 0.0;
#ifdef USE_BATCHING_COLOR
  vec4 lifeInst = getBatchingColor( getIndirectIndex( gl_DrawID ) );
  vLifeSeed = lifeInst.a;
  if (aSurf.x > 1.5) {
    vColor.rgb *= lifeAccent(lifeInst.a);
  } else {
    vColor.rgb = mix(vColor.rgb, lifeInst.rgb * vColor.rgb, clamp(aSurf.x, 0.0, 1.0));
  }
#else
  if (aSurf.x > 1.5) vColor.rgb *= lifeAccent(0.1);
#endif
  vLifeSurf = aSurf;
  vLifeDetail = aDetail;
  vLifeObjPos = position;
  vLifeObjNormal = normal;
`;

export const LIFE_FRAGMENT_PARS = /* glsl */ `
varying vec4 vLifeSurf;
varying float vLifeDetail;
varying vec3 vLifeObjPos;
varying vec3 vLifeObjNormal;
varying float vLifeSeed;

/* Screen-space bump (same maths as three's perturbNormalArb). */
vec3 lifeBump(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = dFdx(surfPos);
  vec3 sy = dFdy(surfPos);
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}

/* Distance (m) to the nearest line of a 1D lattice with the given period. */
float lifeLine(float x, float period) {
  return abs(fract(x / period + 0.5) - 0.5) * period;
}

struct LifeSurf {
  float rough;
  float metal;
  float bump;
  vec3 emissive;
};

LifeSurf lifeSurface(inout vec3 albedo) {
  LifeSurf s;
  s.rough = vLifeSurf.y;
  s.metal = vLifeSurf.z;
  s.bump = 0.0;
  s.emissive = vec3(0.0);
  vec3 op = vLifeObjPos;
  vec3 on = normalize(vLifeObjNormal);
  float seed = vLifeSeed;
  float weather = fract(seed * 8.0);
  int det = int(vLifeDetail + 0.5);
  // Along-surface coordinate: z for side walls, x for end walls.
  float along = abs(on.x) > abs(on.z) ? op.z : op.x;
  float px = max(fwidth(op.y), fwidth(along));
  float fine = 1.0 - smoothstep(0.03, 0.18, px);

  float grime = fbm2(vec2(along * 0.45, op.y * 0.9) + seed * 13.0, 3);

  if (det == 1) {
    // Steel plating: seams, rust streaks from the deck edge and scuppers, waterline slime, antifouling.
    float seamH = 1.0 - smoothstep(0.012, 0.04, lifeLine(op.y - 0.35, 2.6));
    float seamV = 1.0 - smoothstep(0.012, 0.04, lifeLine(along, 8.5));
    s.bump = (seamH + seamV) * 0.004 * fine;
    float streak = pow(vnoise2(vec2(along * 1.7, op.y * 0.05) + seed * 7.0), 4.0);
    streak *= smoothstep(-0.2, 6.0, op.y) * (0.35 + 1.4 * weather);
    vec3 rust = vec3(0.16, 0.055, 0.02);
    albedo = mix(albedo, rust, clamp(streak * 1.6, 0.0, 0.75));
    float blotch = smoothstep(0.62, 0.8, fbm2(vec2(along * 0.25, op.y * 0.5) + seed * 3.1, 4)) * weather;
    albedo = mix(albedo, rust * 1.2, blotch * 0.7);
    albedo *= 0.9 + 0.2 * grime;
    float wl = smoothstep(1.1, 0.0, op.y) * smoothstep(-0.25, 0.1, op.y);
    albedo = mix(albedo, albedo * vec3(0.45, 0.5, 0.38), wl * (0.35 + 0.5 * vnoise2(vec2(along * 0.8, 3.0))));
    float af = smoothstep(0.03, -0.03, op.y);
    vec3 antifoul = vec3(0.26, 0.05, 0.035) * (0.8 + 0.35 * grime);
    albedo = mix(albedo, antifoul, af);
    s.rough = mix(s.rough + (grime - 0.5) * 0.25 + streak * 0.3, 0.75, af);
    s.metal = mix(s.metal, 0.0, max(af, streak));
  } else if (det == 2) {
    // Corrugated container walls: trapezoid ribs every 0.28 m (sides) / 0.3 m (doors), dents and dirt.
    float period = 0.28;
    float r = lifeLine(along + 0.07, period) / period;
    float h = smoothstep(0.18, 0.3, r);
    s.bump = on.y > 0.7 ? 0.0 : h * 0.02 * fine;
    float dirt = smoothstep(0.35, 0.95, grime) * 0.4 + smoothstep(0.8, 0.0, op.y - floor(op.y / 2.59) * 2.59) * 0.08;
    albedo *= (1.0 - dirt * 0.5) * (0.92 + 0.12 * vnoise2(op.xz * 0.6 + op.y));
    s.rough = clamp(s.rough + dirt * 0.2, 0.3, 0.95);
  } else if (det == 3) {
    // Deck: plate lines + worn paint + oily patches.
    float plate = 1.0 - smoothstep(0.01, 0.035, min(lifeLine(op.x, 2.2), lifeLine(op.z, 6.0)));
    s.bump = plate * 0.003 * fine;
    float wear = smoothstep(0.55, 0.85, fbm2(op.xz * 0.35 + seed * 5.0, 4));
    albedo = mix(albedo, vec3(0.09, 0.075, 0.06), wear * 0.55);
    albedo *= 0.85 + 0.3 * vnoise2(op.xz * 1.7);
    s.rough = clamp(s.rough + wear * 0.1 - 0.05, 0.2, 1.0);
  } else if (det == 4) {
    // Painted superstructure: rain streaks under openings, gentle chalking.
    float streak = pow(vnoise2(vec2(along * 2.3, op.y * 0.12) + seed * 11.0), 5.0) * (0.25 + weather);
    albedo *= 1.0 - streak * 0.3;
    albedo *= 0.94 + 0.08 * grime;
    s.rough = clamp(s.rough + (grime - 0.5) * 0.15, 0.2, 1.0);
  } else if (det == 5) {
    // Planked wooden hull: strakes every 0.17 m, paint wear on the edges.
    float strake = lifeLine(op.y, 0.17);
    s.bump = (1.0 - smoothstep(0.004, 0.015, strake)) * 0.003 * fine;
    float wear = smoothstep(0.6, 0.85, fbm2(vec2(along * 1.5, op.y * 4.0) + seed * 9.0, 3));
    albedo = mix(albedo, vec3(0.2, 0.13, 0.07), wear * 0.6);
    float af = smoothstep(0.03, -0.03, op.y);
    albedo = mix(albedo, vec3(0.25, 0.06, 0.04), af);
    albedo *= 0.9 + 0.2 * grime;
  } else if (det == 6) {
    // Glass: mullions, tint variation; lit panes are handled by the emissive class.
    float mull = 1.0 - smoothstep(0.02, 0.05, min(lifeLine(along, 1.1), lifeLine(op.y, 1.9)));
    albedo = mix(albedo * (0.8 + 0.4 * hash12(floor(vec2(along / 1.1, op.y / 1.9)) + seed)), vec3(0.05), mull * 0.8 * fine);
    s.rough = mix(s.rough, 0.5, mull);
  } else if (det == 7) {
    albedo *= 0.85 + 0.3 * vnoise2(op.xz * 3.0 + op.y * 2.0);
  } else {
    albedo *= 0.95 + 0.08 * grime;
  }

  float cls = vLifeSurf.w;
  if (cls > 0.5) {
    float lightsOn = smoothstep(0.1, 0.42, uNight);
    vec3 cell = floor(op / vec3(1.35, 2.2, 1.35));
    float hsh = hash13(cell + seed * 37.1 + 3.7);
    vec3 e = vec3(0.0);
    if (cls < 1.5) {
      e = mix(vec3(1.0, 0.78, 0.52), vec3(0.92, 0.95, 1.0), step(0.75, hsh)) * (2.6 + 1.6 * hsh) * step(0.07, hsh);
    } else if (cls < 2.5) {
      e = mix(vec3(1.0, 0.8, 0.56), vec3(0.8, 0.88, 1.0), step(0.8, hsh)) * 3.0 * step(0.58, hsh);
    } else if (cls < 3.5) {
      e = vec3(1.0, 0.86, 0.66) * 24.0;
    } else {
      e = vec3(0.85, 0.93, 1.0) * 7.0;
      lightsOn = smoothstep(0.02, 0.3, uNight);
    }
    s.emissive = e * lightsOn;
    albedo = mix(albedo, albedo * 0.35, lightsOn * step(cls, 2.5));
  }
  return s;
}
`;
