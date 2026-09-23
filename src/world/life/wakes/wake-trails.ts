import * as THREE from 'three';
import { RenderLayers } from '../../../core/contracts';
import { WAKE_FRAGMENT, WAKE_VERTEX } from './wake-shaders';

const SAMPLES = 40;

interface Trail {
  length: number;
  beam: number;
  spacing: number;
  head: number;
  count: number;
  s: number;
  lastX: number;
  lastZ: number;
  active: boolean;
}

/**
 * Kelvin wake / bow wave / propeller wash ribbons for every moving vessel, drawn in one call.
 * Trail history lives in a float texture (one row per trail) so the CPU only writes the live bow sample per frame.
 */
export class WakeTrails {
  readonly mesh: THREE.Mesh;
  private readonly tex: THREE.DataTexture;
  private readonly data: Float32Array;
  private readonly trails: Trail[] = [];
  private readonly material: THREE.ShaderMaterial;
  private readonly timeU = { value: 0 };

  constructor(readonly capacity: number) {
    const w = SAMPLES + 1;
    this.data = new Float32Array(w * capacity * 4);
    this.tex = new THREE.DataTexture(this.data, w, capacity, THREE.RGBAFormat, THREE.FloatType);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;

    const verts = capacity * SAMPLES * 2;
    const aTrail = new Float32Array(verts * 3);
    const index: number[] = [];
    let k = 0;
    for (let r = 0; r < capacity; r++) {
      for (let i = 0; i < SAMPLES; i++) {
        for (const side of [-1, 1]) {
          aTrail[k * 3] = r;
          aTrail[k * 3 + 1] = i;
          aTrail[k * 3 + 2] = side;
          k++;
        }
        if (i < SAMPLES - 1) {
          const a = (r * SAMPLES + i) * 2;
          const b = a + 2;
          index.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('aTrail', new THREE.BufferAttribute(aTrail, 3));
    // A position attribute is required by three; the vertex shader ignores it.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    geo.setIndex(verts > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
    this.material = new THREE.ShaderMaterial({
      name: 'life-wake',
      vertexShader: WAKE_VERTEX,
      fragmentShader: WAKE_FRAGMENT,
      uniforms: { uTrail: { value: this.tex }, uLifeTime: this.timeU },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'life-wakes';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.layers.set(RenderLayers.NoReflection);
  }

  /** Registers a trail; returns its index or -1 when the pool is full. */
  add(length: number, beam: number): number {
    if (this.trails.length >= this.capacity) return -1;
    this.trails.push({ length, beam, spacing: Math.max(8, Math.min(length / 2.5, 80)), head: 0, count: 0, s: 0, lastX: 0, lastZ: 0, active: false });
    return this.trails.length - 1;
  }

  clear(): void {
    this.trails.length = 0;
    this.data.fill(0);
    this.tex.needsUpdate = true;
  }

  /** Feeds the current bow position of a trail. */
  feed(index: number, bowX: number, bowZ: number, time: number): void {
    const t = this.trails[index];
    if (!t) return;
    const w = SAMPLES + 1;
    const row = index * w * 4;
    if (!t.active) {
      t.active = true;
      t.head = 0;
      t.count = 1;
      t.s = 0;
      t.lastX = bowX;
      t.lastZ = bowZ;
    }
    let d = Math.hypot(bowX - t.lastX, bowZ - t.lastZ);
    if (d > t.spacing * 12) {
      // Teleport (lane respawn): restart the trail instead of drawing a ribbon across the map.
      t.head = 0;
      t.count = 1;
      t.s = 0;
      t.lastX = bowX;
      t.lastZ = bowZ;
      d = 0;
    }
    const live = row + t.head * 4;
    this.data[live] = bowX;
    this.data[live + 1] = bowZ;
    this.data[live + 2] = t.s + d;
    this.data[live + 3] = time;
    if (d >= t.spacing) {
      t.s += d;
      t.lastX = bowX;
      t.lastZ = bowZ;
      t.head = (t.head + 1) % SAMPLES;
      t.count = Math.min(t.count + 1, SAMPLES);
      const nl = row + t.head * 4;
      this.data[nl] = bowX;
      this.data[nl + 1] = bowZ;
      this.data[nl + 2] = t.s;
      this.data[nl + 3] = time;
    }
    const prm = row + SAMPLES * 4;
    this.data[prm] = t.length;
    this.data[prm + 1] = t.beam;
    this.data[prm + 2] = t.head;
    this.data[prm + 3] = t.count;
  }

  /** Keeps the time stamp of a stationary trail's head fresh (no new samples). */
  commit(time: number): void {
    this.timeU.value = time;
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.tex.dispose();
  }
}
