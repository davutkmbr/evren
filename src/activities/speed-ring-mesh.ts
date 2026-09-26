/**
 * Speed rings (boost rings): teal-green additive markers, one instance per ring, drawn by RingPass after the clouds
 * like the gates. The unit model reads differently from a gate at a glance: a thinner main ring, a smaller inner ring
 * a few metres ahead (a funnel) and four chevrons on the rim pointing forward along the flight direction.
 * Used rings dim; the others pulse gently.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RenderLayers } from '../core/contracts';
import type { SpeedRing } from './courses';
import { createMarkerMaterial } from './ring-pass';

const MAX_RINGS = 16;
const READY = new THREE.Color(0.35, 2.6, 1.7);
const USED = new THREE.Color(0.05, 0.35, 0.25);
const INVALID = new THREE.Color(2.4, 0.25, 0.2);

/** Unit speed ring model: radius 1, facing +z. */
function buildUnitGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.TorusGeometry(1, 0.045, 8, 64));
  const inner = new THREE.TorusGeometry(0.62, 0.03, 6, 48);
  inner.translate(0, 0, 0.55);
  parts.push(inner);
  // Chevrons: a ">" in the plane of the radius and the facing, tip forward, on the rim at 0/90/180/270°.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    for (const side of [-1, 1]) {
      const bar = new THREE.BoxGeometry(0.035, 0.035, 0.42);
      // Each arm tilts 35° off the facing towards / away from the ring centre, meeting at the tip.
      bar.translate(0, 0, -0.21);
      bar.rotateX(side * 0.62);
      bar.translate(0, 0, 0.1);
      const radial = new THREE.Matrix4().makeRotationZ(a - Math.PI / 2);
      bar.translate(0, 1.18, 0);
      bar.applyMatrix4(radial);
      parts.push(bar);
    }
  }
  for (const p of parts) {
    p.deleteAttribute('uv');
    p.deleteAttribute('normal');
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) {
    p.dispose();
  }
  return merged;
}

export class SpeedRingMesh {
  readonly mesh: THREE.InstancedMesh;
  private rings: readonly SpeedRing[] = [];
  private used: boolean[] = [];
  private invalid: readonly boolean[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private static readonly Z = new THREE.Vector3(0, 0, 1);

  constructor() {
    this.mesh = new THREE.InstancedMesh(buildUnitGeometry(), createMarkerMaterial(new THREE.Color(1, 1, 1)), MAX_RINGS);
    this.mesh.name = 'race-speed-rings';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, READY);
    this.mesh.layers.set(RenderLayers.NoReflection);
  }

  /** Shows these rings (empty hides them). `invalid` marks editor placements that will be skipped on save. */
  set(rings: readonly SpeedRing[], invalid: readonly boolean[] = []): void {
    this.rings = rings;
    this.invalid = invalid;
    this.used = rings.map(() => false);
    const count = Math.min(MAX_RINGS, rings.length);
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    for (let i = 0; i < count; i++) {
      const r = rings[i];
      this.n.set(r.nx, r.ny, r.nz);
      this.q.setFromUnitVectors(SpeedRingMesh.Z, this.n);
      this.p.set(r.x, r.y, r.z);
      this.s.setScalar(r.radius);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.animate(0);
  }

  markUsed(index: number): void {
    if (index >= 0 && index < this.used.length) {
      this.used[index] = true;
    }
  }

  animate(time: number): void {
    const count = this.mesh.count;
    if (count === 0) {
      return;
    }
    for (let i = 0; i < count; i++) {
      const k = 0.8 + 0.2 * Math.sin(time * 4 + i * 1.3);
      const col = this.invalid[i] ? INVALID : this.used[i] ? USED : READY;
      this.mesh.setColorAt(i, this.c.copy(col).multiplyScalar(this.used[i] ? 1 : k));
    }
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  get visible(): boolean {
    return this.mesh.visible && this.mesh.count > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
    this.mesh.removeFromParent();
  }
}
