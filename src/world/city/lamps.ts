/**
 * Street lights, road lights and aviation beacons of every visible chunk, drawn as one additive point cloud
 * (one draw call). Chunks own contiguous ranges of a preallocated pool; ranges are uploaded incrementally.
 */
import * as THREE from 'three';
import { SHARED_GLSL } from '../../render/shaders';

const BLOCK = 64;

const VERTEX = /* glsl */ `
${SHARED_GLSL}
attribute vec4 aLamp;
varying vec3 vLampColor;
void main() {
  float type = floor(aLamp.w + 0.5);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 1.0);
  float lightsOn = smoothstep(0.08, 0.42, uNight);
  // Beacons (type 3) blink; everything else is steady.
  float blink = type > 2.5 ? step(0.45, fract(uTime * 0.55 + fract(position.x * 0.013 + position.z * 0.007))) : 1.0;
  float radius = type > 2.5 ? 0.9 : type > 1.5 ? 0.55 : 0.42;
  float pxScale = projectionMatrix[1][1] * uResolution.y * 0.5;
  float px = radius * pxScale / dist;
  float size = max(px, 1.6);
  float energy = pow(px / size, 1.6);
  float intensity = (type > 2.5 ? 34.0 : type > 1.5 ? 20.0 : 16.0) * lightsOn * blink * mix(0.35, 1.0, energy);
  vec3 col = pow(aLamp.rgb / 255.0, vec3(2.2));
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vLampColor = col * intensity * atmoTransmittance(wp);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * 2.2;
  if (intensity <= 0.0 || aLamp.w < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
  }
}
`;

const FRAGMENT = /* glsl */ `
${SHARED_GLSL}
varying vec3 vLampColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 9.0);
  float halo = exp(-r2 * 3.0) * 0.18;
  gl_FragColor = vec4(vLampColor * (core + halo), 1.0);
}
`;

export interface LampRange {
  start: number;
  count: number;
}

export class LampPool {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly colors: Uint8Array;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly used: Uint8Array;
  private highWater = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = Math.ceil(capacity / BLOCK) * BLOCK;
    this.positions = new Float32Array(this.capacity * 3);
    this.colors = new Uint8Array(this.capacity * 4);
    this.used = new Uint8Array(this.capacity / BLOCK);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colors, 4, false);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aLamp', this.colAttr);
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const mat = new THREE.ShaderMaterial({
      name: 'city-lamps',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = 'city-lamps';
  }

  add(pos: Float32Array, col: Uint8Array): LampRange | null {
    const count = pos.length / 3;
    if (count === 0) {
      return null;
    }
    const blocks = Math.ceil(count / BLOCK);
    let run = 0;
    let startBlock = -1;
    for (let b = 0; b < this.used.length; b++) {
      if (this.used[b]) {
        run = 0;
        continue;
      }
      run++;
      if (run === blocks) {
        startBlock = b - blocks + 1;
        break;
      }
    }
    if (startBlock < 0) {
      return null;
    }
    for (let b = startBlock; b < startBlock + blocks; b++) {
      this.used[b] = 1;
    }
    const start = startBlock * BLOCK;
    this.positions.set(pos, start * 3);
    this.colors.set(col, start * 4);
    const slack = blocks * BLOCK - count;
    if (slack > 0) {
      this.colors.fill(0, (start + count) * 4, (start + blocks * BLOCK) * 4);
    }
    this.markDirty(start, blocks * BLOCK);
    this.highWater = Math.max(this.highWater, start + blocks * BLOCK);
    this.points.geometry.setDrawRange(0, this.highWater);
    return { start, count };
  }

  remove(r: LampRange): void {
    const blocks = Math.ceil(r.count / BLOCK);
    const startBlock = r.start / BLOCK;
    for (let b = startBlock; b < startBlock + blocks; b++) {
      this.used[b] = 0;
    }
    this.colors.fill(0, r.start * 4, (r.start + blocks * BLOCK) * 4);
    this.colAttr.addUpdateRange(r.start * 4, blocks * BLOCK * 4);
    this.colAttr.needsUpdate = true;
    let hw = this.highWater;
    while (hw > 0 && !this.used[hw / BLOCK - 1]) {
      hw -= BLOCK;
    }
    this.highWater = hw;
    this.points.geometry.setDrawRange(0, this.highWater);
  }

  private markDirty(start: number, count: number): void {
    this.posAttr.addUpdateRange(start * 3, count * 3);
    this.posAttr.needsUpdate = true;
    this.colAttr.addUpdateRange(start * 4, count * 4);
    this.colAttr.needsUpdate = true;
  }

  get count(): number {
    return this.highWater;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
