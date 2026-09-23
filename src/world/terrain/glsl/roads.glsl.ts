import { ROAD_GRID_SIZE, ROAD_LAMP_SPACING, ROAD_MARGIN } from '../config';
import { glslFloat } from './height.glsl';

/**
 * Analytic road shading from the segment index (see bake/road-index.ts): exact carriageway edges, lane markings,
 * medians, sidewalks / shoulders and street-light pools, always lying exactly on the terrain surface.
 * Lamp heads are drawn only beyond the city module's radius (inside it the city renders them as sprites).
 */
export const ROADS_GLSL = /* glsl */ `
uniform sampler2D uRoadData;
uniform vec4 uRoadLayout;

#define ROAD_N ${glslFloat(ROAD_GRID_SIZE)}
#define ROAD_MARGIN ${glslFloat(ROAD_MARGIN)}
#define ROAD_LAMP_SPACING ${glslFloat(ROAD_LAMP_SPACING)}

struct RoadHit {
  /* Signed distance to the carriageway edge (m, negative on the road). */
  float edge;
  /* Distance to the centreline (m). */
  float center;
  float hw;
  float kind;
  float along;
  float id;
};

vec4 roadTexel(int index) {
  int w = int(uRoadLayout.x);
  return texelFetch(uRoadData, ivec2(index % w, index / w), 0);
}

float roadComponent(vec4 v, int i) {
  return i == 0 ? v.x : i == 1 ? v.y : i == 2 ? v.z : v.w;
}

bool roadQuery(vec2 p, out RoadHit hit) {
  hit.edge = 1e9;
  hit.center = 0.0;
  hit.hw = 0.0;
  hit.kind = 0.0;
  hit.along = 0.0;
  hit.id = 0.0;
  vec2 g = (p + WORLD_HALF) / (2.0 * WORLD_HALF) * ROAD_N;
  if (g.x < 0.0 || g.y < 0.0 || g.x >= ROAD_N || g.y >= ROAD_N) return false;
  ivec2 c = ivec2(g);
  int cell = c.y * int(ROAD_N) + c.x;
  int header = int(roadComponent(roadTexel(cell / 4), cell % 4) + 0.5);
  int count = header % 16;
  if (count == 0) return false;
  int start = header / 16;
  int w = int(uRoadLayout.x);
  int listBase = int(uRoadLayout.y) * w;
  int segBase = int(uRoadLayout.z) * w;
  for (int k = 0; k < 15; k++) {
    if (k >= count) break;
    int li = start + k;
    int seg = int(roadComponent(roadTexel(listBase + li / 4), li % 4) + 0.5);
    vec4 s0 = roadTexel(segBase + seg * 2);
    vec4 s1 = roadTexel(segBase + seg * 2 + 1);
    vec2 a = s0.xy;
    vec2 ab = s0.zw - a;
    float len = max(s1.w, 1e-3);
    float t = clamp(dot(p - a, ab) / (len * len), 0.0, 1.0);
    float dc = length(p - a - ab * t);
    float de = dc - s1.x;
    if (de < hit.edge) {
      hit.edge = de;
      hit.center = dc;
      hit.hw = s1.x;
      hit.kind = s1.y;
      hit.along = s1.z + t * len;
      hit.id = float(seg);
    }
  }
  return hit.edge < ROAD_MARGIN;
}

/* Anti-aliased line coverage |x| < halfWidth; thin lines fade to their average coverage instead of aliasing. */
float roadLine(float x, float halfWidth, float fp) {
  float fw = max(fp * 0.7, 1e-3);
  return clamp((halfWidth - abs(x)) / fw + 0.5, 0.0, 1.0) * clamp(halfWidth * 2.0 / fw, 0.0, 1.0);
}

float dashed(float along, float on, float period, float fp) {
  float fw = max(fp, 1e-3);
  float u = mod(along, period);
  float c = clamp(min(u, on - u) / fw + 0.5, 0.0, 1.0);
  return mix(c, on / period, clamp(fw / period * 1.5, 0.0, 1.0));
}

struct RoadShade {
  vec3 alb;
  float rough;
  float cover;
  vec3 emit;
};

/* kind: 0 highway, 1 avenue, 2 street, 3 coastal (see bake/road-index.ts). */
RoadShade shadeRoad(RoadHit r, Px px, float urban, vec3 asphalt, float night) {
  RoadShade s;
  s.emit = vec3(0.0);
  s.cover = 0.0;
  s.rough = 0.9;
  int kind = int(r.kind + 0.5);
  float a = r.center;
  float fp = px.fp;
  float roadHash = hash11(r.id * 0.137 + floor(r.along / 900.0) * 0.61);
  vec3 col = asphalt * mix(0.86, 1.14, roadHash);
  float laneW = 3.6;
  if (r.edge < 0.0) {
    s.cover = clamp(-r.edge / max(fp, 0.3) + 0.5, 0.0, 1.0);
    float marks = 0.0;
    float wheel;
    if (kind == 0) {
      // Concrete New-Jersey barrier in the median, solid edge lines, dashed lane lines.
      float barrier = roadLine(a, 0.35, fp);
      col = mix(col, vec3(0.33, 0.32, 0.3), barrier);
      float inner = a - 1.3;
      marks += roadLine(inner, 0.08, fp);
      marks += roadLine(a - (r.hw - 0.9), 0.08, fp);
      for (int k = 1; k <= 3; k++) {
        float x = inner - laneW * float(k);
        if (a < r.hw - 1.5) marks += roadLine(x, 0.07, fp) * dashed(r.along, 4.5, 12.0, fp);
      }
      wheel = abs(fract(inner / laneW) - 0.5);
    } else {
      float center = roadLine(a, kind == 1 ? 0.2 : 0.07, fp);
      if (kind == 1) {
        col = mix(col, vec3(0.3, 0.3, 0.28), center);
        marks += roadLine(a - 0.35, 0.07, fp);
      } else {
        marks += center * dashed(r.along, 3.0, 9.0, fp);
      }
      if (r.hw > 7.5) marks += roadLine(a - (0.35 + laneW), 0.07, fp) * dashed(r.along, 3.0, 9.0, fp);
      marks += roadLine(a - (r.hw - 0.5), 0.07, fp) * step(8.5, r.hw);
      wheel = abs(fract(a / laneW) - 0.5);
    }
    // Polished wheel paths are slightly lighter, the oil strip between them darker.
    col *= mix(0.93, 1.04, smoothstep(0.1, 0.3, wheel));
    col = mix(col, vec3(0.52, 0.52, 0.49), clamp(marks, 0.0, 1.0) * 0.85);
    s.rough = mix(0.88, 0.7, clamp(marks, 0.0, 1.0));
  } else if (kind == 0) {
    // Highway verge: gravel shoulder then dry grass; guard rail at the edge.
    s.cover = (1.0 - smoothstep(2.5, 6.0, r.edge)) * 0.85;
    col = mix(vec3(0.21, 0.19, 0.15), vec3(0.14, 0.13, 0.075), smoothstep(1.0, 4.5, r.edge));
    col = mix(col, vec3(0.42, 0.43, 0.43), roadLine(r.edge - 0.7, 0.1, fp));
    s.rough = 0.9;
  } else {
    // Sidewalk with a light curb.
    float sw = kind == 3 ? 4.0 : 2.8;
    s.cover = (1.0 - smoothstep(sw, sw + 0.6, r.edge)) * mix(0.55, 1.0, urban);
    col = vec3(0.25, 0.24, 0.22);
    col = mix(col, vec3(0.36, 0.35, 0.33), roadLine(r.edge - 0.15, 0.15, fp));
    s.rough = 0.85;
  }
  s.alb = col;

  if (night > 0.0) {
    // Lamps every ROAD_LAMP_SPACING m on both curbs (plus the median of wide roads), like the city's road lights.
    float warm = kind == 0 ? 0.25 : step(0.45, roadHash);
    vec3 lampColor = mix(LAMP_COOL, LAMP_SODIUM, warm);
    float k = floor(r.along / ROAD_LAMP_SPACING + 0.5);
    float ds = r.along - k * ROAD_LAMP_SPACING;
    float curb = r.hw + 1.2;
    float dNear = a - curb;
    float dFar = a + curb;
    float sig2 = 2.0 * 9.0 * 9.0;
    float pool = exp(-(ds * ds + dNear * dNear) / sig2) + exp(-(ds * ds + dFar * dFar) / sig2);
    if (r.hw > 10.0) pool += exp(-(ds * ds + a * a) / sig2) * 0.8;
    // Pools light the asphalt: more on the carriageway, less on the verge.
    float groundLit = mix(0.35, 1.0, s.cover);
    s.emit = lampColor * pool * 0.09 * groundLit;
    // Lamp heads beyond the city radius (energy of a ~0.6 m head exaggerated to ~1 px like the city's sprites).
    float heads = smoothstep(uTerrainRanges.x * 0.95, uTerrainRanges.x * 1.1, px.dist);
    if (heads > 0.0) {
      float rr = max(0.6, fp * 0.75);
      float e = pow(0.6 / rr, 1.6);
      float I = 16.0 * mix(0.35, 1.0, e);
      float g = exp(-(ds * ds + dNear * dNear) / (rr * rr)) + exp(-(ds * ds + dFar * dFar) / (rr * rr));
      s.emit += lampColor * I * g * heads;
    }
    s.emit *= night;
  }
  return s;
}
`;
