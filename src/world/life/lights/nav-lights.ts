import * as THREE from 'three';
import { SHARED_GLSL } from '../../../render/shaders';

/** Light sectors (COLREGs): 0 all-round, 1 masthead (225° ahead), 2 port, 3 starboard (112.5° each), 4 stern (135° aft). */
export const Sector = { AllRound: 0, Masthead: 1, Port: 2, Starboard: 3, Stern: 4 } as const;

const VERTEX = /* glsl */ `
${SHARED_GLSL}
attribute vec3 aColor;
attribute vec4 aSector;
varying vec3 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 1.0);
  float lightsOn = smoothstep(0.04, 0.32, uNight);
  vec2 f = aSector.xy;
  vec2 toCam = cameraPosition.xz - position.xz;
  float tl = length(toCam);
  toCam = tl > 1e-3 ? toCam / tl : vec2(0.0, 1.0);
  float c = dot(toCam, f);
  float sd = dot(toCam, vec2(-f.y, f.x));
  float kind = aSector.z;
  float vis = 1.0;
  const float C1125 = -0.3827;
  if (kind > 0.5 && kind < 1.5) vis = smoothstep(C1125 - 0.035, C1125 + 0.035, c);
  else if (kind > 1.5 && kind < 2.5) vis = smoothstep(C1125 - 0.035, C1125 + 0.035, c) * smoothstep(0.03, -0.03, sd);
  else if (kind > 2.5 && kind < 3.5) vis = smoothstep(C1125 - 0.035, C1125 + 0.035, c) * smoothstep(-0.03, 0.03, sd);
  else if (kind > 3.5) vis = smoothstep(C1125 + 0.035, C1125 - 0.035, c);
  float radius = aSector.w;
  float pxScale = projectionMatrix[1][1] * uResolution.y * 0.5;
  float px = radius * pxScale / dist;
  float size = max(px, 1.5);
  float energy = pow(px / size, 1.5);
  float intensity = lightsOn * vis * mix(0.45, 1.0, energy);
  vCol = aColor * intensity * atmoTransmittance(position);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * 2.4;
  if (intensity <= 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
  }
}
`;

const FRAGMENT = /* glsl */ `
${SHARED_GLSL}
varying vec3 vCol;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 10.0);
  float halo = exp(-r2 * 3.0) * 0.16;
  gl_FragColor = vec4(vCol * (core + halo), 1.0);
}
`;

/** Pool of sector-aware light points (navigation lights, deck and pier lamps), drawn additively in one call. */
export class LightPoints {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly sec: Float32Array;
  private readonly geo: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  count = 0;

  constructor(readonly capacity: number) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.sec = new Float32Array(capacity * 4);
    this.geo = new THREE.BufferGeometry();
    const p = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    const c = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    const s = new THREE.BufferAttribute(this.sec, 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', p);
    this.geo.setAttribute('aColor', c);
    this.geo.setAttribute('aSector', s);
    this.geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      name: 'life-nav-lights',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.name = 'life-lights';
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }

  /** Allocates `n` consecutive points; returns the first index (or -1 when full). */
  alloc(n: number): number {
    if (this.count + n > this.capacity) return -1;
    const base = this.count;
    this.count += n;
    this.geo.setDrawRange(0, this.count);
    return base;
  }

  reset(): void {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }

  set(i: number, x: number, y: number, z: number, fx: number, fz: number, sector: number, r: number, g: number, b: number, radius: number): void {
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
    this.sec[i * 4] = fx;
    this.sec[i * 4 + 1] = fz;
    this.sec[i * 4 + 2] = sector;
    this.sec[i * 4 + 3] = radius;
  }

  setPosition(i: number, x: number, y: number, z: number, fx: number, fz: number): void {
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.sec[i * 4] = fx;
    this.sec[i * 4 + 1] = fz;
  }

  setColor(i: number, r: number, g: number, b: number): void {
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
  }

  upload(): void {
    for (const name of ['position', 'aColor', 'aSector']) {
      const a = this.geo.getAttribute(name) as THREE.BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
