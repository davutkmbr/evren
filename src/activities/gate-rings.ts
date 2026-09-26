/**
 * Glowing race rings: one additive InstancedMesh of tori (one instance per gate) plus a light beacon column above the
 * next gate so it can be found from far away. Both live on RenderLayers.NoReflection (kept out of the water mirror).
 */
import * as THREE from 'three';
import { RenderLayers } from '../core/contracts';
import type { CompiledCourse } from './courses';

const MAX_GATES = 32;
/** Tube radius relative to the ring radius. */
const TUBE = 0.06;
const BEACON_HEIGHT = 420;
const BEACON_RADIUS = 4;

// Linear HDR colours (> 1 feeds bloom where the pipeline has it).
const NEXT = new THREE.Color(3.2, 2.1, 0.55);
const AFTER = new THREE.Color(0.55, 1.3, 1.7);
const LATER = new THREE.Color(0.18, 0.45, 0.6);
const FINISH = new THREE.Color(1.4, 1.4, 1.4);
const DONE = new THREE.Color(0.25, 0.9, 0.35);

export class GateRings {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly beacon: THREE.Mesh;
  private readonly beaconMat: THREE.MeshBasicMaterial;
  private course: CompiledCourse | null = null;
  private next = 0;
  private finished = false;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private static readonly Z = new THREE.Vector3(0, 0, 1);

  constructor() {
    this.group.name = 'race-gates';
    const torus = new THREE.TorusGeometry(1, TUBE, 10, 72);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(torus, mat, MAX_GATES);
    this.mesh.name = 'race-gate-rings';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, LATER);
    this.mesh.layers.set(RenderLayers.NoReflection);

    // Beacon: open cylinder with a vertical fade (vertex colours: bright at the bottom, black at the top).
    const cyl = new THREE.CylinderGeometry(BEACON_RADIUS, BEACON_RADIUS, 1, 12, 1, true);
    cyl.translate(0, 0.5, 0);
    const pos = cyl.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const f = 1 - pos.getY(i);
      colors[i * 3] = f;
      colors[i * 3 + 1] = f;
      colors[i * 3 + 2] = f;
    }
    cyl.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.beaconMat = new THREE.MeshBasicMaterial({
      color: NEXT.clone().multiplyScalar(0.35),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      side: THREE.DoubleSide,
    });
    this.beacon = new THREE.Mesh(cyl, this.beaconMat);
    this.beacon.name = 'race-gate-beacon';
    this.beacon.frustumCulled = false;
    this.beacon.renderOrder = 6;
    this.beacon.layers.set(RenderLayers.NoReflection);

    this.group.add(this.mesh, this.beacon);
    this.group.visible = false;
  }

  /** Shows a course (null hides the rings). */
  setCourse(course: CompiledCourse | null): void {
    this.course = course;
    this.next = 0;
    this.finished = false;
    this.group.visible = !!course;
    if (!course) {
      return;
    }
    const count = Math.min(MAX_GATES, course.gates.length);
    this.mesh.count = count;
    for (let i = 0; i < count; i++) {
      const g = course.gates[i];
      this.n.set(g.nx, g.ny, g.nz);
      this.q.setFromUnitVectors(GateRings.Z, this.n);
      this.p.set(g.x, g.y, g.z);
      this.s.setScalar(g.radius);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.setNext(0);
  }

  /** Highlights gate `next`; gates before it are hidden. `finished` shows every ring in the finish colour. */
  setNext(next: number, finished = false): void {
    const course = this.course;
    if (!course) {
      return;
    }
    this.next = next;
    this.finished = finished;
    const count = this.mesh.count;
    for (let i = 0; i < count; i++) {
      const g = course.gates[i];
      const passed = i < next && !finished;
      this.p.set(g.x, g.y, g.z);
      this.n.set(g.nx, g.ny, g.nz);
      this.q.setFromUnitVectors(GateRings.Z, this.n);
      this.s.setScalar(passed ? 1e-4 : g.radius);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      const col = finished ? DONE : i === next ? NEXT : i === next + 1 ? AFTER : i === count - 1 ? FINISH : LATER;
      this.mesh.setColorAt(i, col);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
    this.beacon.visible = !finished && next < count;
    if (this.beacon.visible) {
      // A column of light rising from the top of the ring, fading upward: seen against the sky from far away.
      const g = course.gates[next];
      this.beacon.position.set(g.x, g.y + g.radius, g.z);
      this.beacon.scale.set(1, BEACON_HEIGHT, 1);
    }
  }

  /** Pulses the next ring (call every frame with the simulation clock). */
  animate(time: number): void {
    const course = this.course;
    if (!course || this.finished || this.next >= this.mesh.count) {
      return;
    }
    const k = 0.75 + 0.25 * Math.sin(time * 5);
    this.mesh.setColorAt(this.next, this.c.copy(NEXT).multiplyScalar(k));
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
    this.beaconMat.opacity = 0.7 + 0.3 * k;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
    this.beacon.geometry.dispose();
    this.beaconMat.dispose();
    this.group.removeFromParent();
  }
}
