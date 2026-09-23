import * as THREE from 'three';
import { latLonToLocal } from '../../../core/geo-coords';
import { COMMON_GLSL } from '../../../render/shaders';
import { EXT_SIZE, ROOT_SIZE, WORLD_HALF } from '../config';
import { bakeMaterial, type GpuBaker } from '../bake/gpu-baker';
import { glslFloat } from '../glsl/height.glsl';
import { ANATOLIA_RING, LAKE_RINGS, RELIEF_BUMPS, THRACE_RING, TOWNS } from './horizon-data';

const MAX_BUMPS = 40;
const MAX_TOWNS = 48;

const HORIZON_FRAG = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D uEdges;
uniform int uEdgeCount;
uniform vec4 uBumps[${MAX_BUMPS}];
uniform int uBumpCount;
uniform vec4 uTowns[${MAX_TOWNS}];
uniform int uTownCount;
uniform sampler2D uGeoHeight;
varying vec2 vUv;

#define ROOT_SIZE ${glslFloat(ROOT_SIZE)}
#define WORLD_HALF ${glslFloat(WORLD_HALF)}

void main() {
  vec2 p = (vUv - 0.5) * ROOT_SIZE;
  float dmin = 1e9;
  bool inside = false;
  for (int i = 0; i < 1024; i++) {
    if (i >= uEdgeCount) break;
    vec4 e = texelFetch(uEdges, ivec2(i, 0), 0);
    vec2 a = e.xy;
    vec2 b = e.zw;
    vec2 pa = p - a;
    vec2 ba = b - a;
    float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-3), 0.0, 1.0);
    dmin = min(dmin, length(pa - ba * t));
    if ((a.y > p.y) != (b.y > p.y)) {
      float xc = a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y);
      if (p.x < xc) inside = !inside;
    }
  }
  float coast = inside ? dmin : -dmin;

  float base = 35.0;
  for (int i = 0; i < ${MAX_BUMPS}; i++) {
    if (i >= uBumpCount) break;
    vec4 b = uBumps[i];
    float d = length(p - b.xy) / b.w;
    base += b.z * exp(-d * d * 1.3);
  }
  // Rolling hills and dissected valleys scaled with the regional relief.
  float n1 = fbm2(p * 0.00011 + vec2(7.3, 1.9), 5);
  float n2 = fbm2(p * 0.00042 + vec2(-3.1, 5.7), 4);
  float valleys = 1.0 - abs(n2 * 2.0 - 1.0);
  float hills = base * (0.72 + 0.56 * n1) + (18.0 + base * 0.25) * (valleys - 0.55);
  float h;
  if (coast >= 0.0) {
    float ramp = 1.0 - exp(-coast / 900.0);
    h = 1.4 + max(hills - 1.4, 0.0) * ramp;
  } else {
    float d = -coast;
    h = -(2.0 + min(d * 0.035, 90.0) + min(d * 0.004, 60.0));
  }

  float urban = 0.0;
  for (int i = 0; i < ${MAX_TOWNS}; i++) {
    if (i >= uTownCount) break;
    vec4 t = uTowns[i];
    float d = length(p - t.xy) / (t.z * (0.75 + 0.5 * fbm2(p * 0.0012 + t.xy * 0.001, 3)));
    urban = max(urban, t.w * (1.0 - smoothstep(0.55, 1.0, d)));
  }
  urban *= step(0.0, coast) * smoothstep(0.0, 120.0, coast);
  urban *= 1.0 - smoothstep(180.0, 420.0, h);

  float forest = 0.0;
  forest += smoothstep(18000.0, 30000.0, p.x) * (1.0 - smoothstep(4000.0, 22000.0, p.y)) * 0.9;
  forest += (1.0 - smoothstep(-30000.0, -18000.0, p.x)) * (1.0 - smoothstep(-26000.0, -12000.0, p.y)) * 0.75;
  forest += smoothstep(220.0, 420.0, h) * 0.95;
  forest *= 0.55 + 0.9 * fbm2(p * 0.00035 + vec2(11.0, -4.0), 4);
  forest = clamp(forest - urban * 1.5, 0.0, 1.0) * step(0.0, coast);

  vec2 q = abs(p) - WORLD_HALF;
  if (max(q.x, q.y) < 0.0) {
    h = texture2D(uGeoHeight, (p + WORLD_HALF) / (2.0 * WORLD_HALF)).r;
  }
  gl_FragColor = vec4(h, urban, forest, clamp(coast, -6000.0, 6000.0));
}
`;

function ringToEdges(ll: readonly number[], out: number[]): void {
  const n = ll.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = latLonToLocal(ll[i * 2], ll[i * 2 + 1]);
    const b = latLonToLocal(ll[j * 2], ll[j * 2 + 1]);
    out.push(a.x, a.z, b.x, b.z);
  }
}

/**
 * Bakes the horizon extension (EXT_SIZE² RGBA32F over the root square): R = elevation (m), G = town cover,
 * B = forest cover, A = signed coast distance (m, land positive).
 */
export function bakeHorizon(baker: GpuBaker, geoHeight: THREE.Texture): THREE.WebGLRenderTarget {
  const edges: number[] = [];
  ringToEdges(THRACE_RING, edges);
  ringToEdges(ANATOLIA_RING, edges);
  for (const lake of LAKE_RINGS) {
    ringToEdges(lake, edges);
  }
  const edgeCount = edges.length / 4;
  const edgeTex = new THREE.DataTexture(new Float32Array(edges), edgeCount, 1, THREE.RGBAFormat, THREE.FloatType);
  edgeTex.needsUpdate = true;

  const bumps: THREE.Vector4[] = [];
  for (let i = 0; i < RELIEF_BUMPS.length && bumps.length < MAX_BUMPS; i += 4) {
    const p = latLonToLocal(RELIEF_BUMPS[i], RELIEF_BUMPS[i + 1]);
    bumps.push(new THREE.Vector4(p.x, p.z, RELIEF_BUMPS[i + 2], RELIEF_BUMPS[i + 3] * 1000));
  }
  const towns: THREE.Vector4[] = [];
  for (let i = 0; i < TOWNS.length && towns.length < MAX_TOWNS; i += 4) {
    const p = latLonToLocal(TOWNS[i], TOWNS[i + 1]);
    towns.push(new THREE.Vector4(p.x, p.z, TOWNS[i + 2] * 1000, TOWNS[i + 3]));
  }
  while (bumps.length < MAX_BUMPS) {
    bumps.push(new THREE.Vector4());
  }
  while (towns.length < MAX_TOWNS) {
    towns.push(new THREE.Vector4());
  }

  const target = new THREE.WebGLRenderTarget(EXT_SIZE, EXT_SIZE, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });
  target.texture.name = 'terrain-horizon';
  const material = bakeMaterial(HORIZON_FRAG, {
    uEdges: { value: edgeTex },
    uEdgeCount: { value: edgeCount },
    uBumps: { value: bumps },
    uBumpCount: { value: RELIEF_BUMPS.length / 4 },
    uTowns: { value: towns },
    uTownCount: { value: TOWNS.length / 4 },
    uGeoHeight: { value: geoHeight },
  });
  baker.render(material, target);
  material.dispose();
  edgeTex.dispose();
  return target;
}
