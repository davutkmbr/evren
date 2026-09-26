/**
 * Ghost of the best run: a soft violet glowing orb with a short fading trail, time-synced to the race clock. Drawn in
 * RingPass's scene with the rings' marker material (after the clouds, manual depth test), on RenderLayers.NoReflection.
 */
import * as THREE from 'three';
import { RenderLayers } from '../../core/contracts';
import type { GhostTrack } from '../ghost';
import type { Vec3 } from '../race';
import { createMarkerMaterial } from '../ring-pass';

/** Trail spheres behind the orb. */
const TRAIL = 22;
/** Seconds between trail spheres. */
const TRAIL_STEP = 0.055;
const CORE_RADIUS = 1.7;
const HALO_RADIUS = 4.2;
const TRAIL_RADIUS = 1.25;

// Linear HDR violet (distinct from the amber / cyan / white / green rings).
const CORE = new THREE.Color(1.5, 0.95, 2.6);
const HALO = new THREE.Color(0.28, 0.16, 0.5);
const TRAIL_COLOR = new THREE.Color(0.9, 0.55, 1.6);

export class GhostOrb {
  readonly group = new THREE.Group();
  private readonly core: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly trail: THREE.InstancedMesh;
  private readonly sphere = new THREE.SphereGeometry(1, 16, 12);
  private track: GhostTrack | null = null;
  private readonly p: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor() {
    this.group.name = 'race-ghost';
    this.core = new THREE.Mesh(this.sphere, createMarkerMaterial(CORE));
    this.core.scale.setScalar(CORE_RADIUS);
    this.halo = new THREE.Mesh(this.sphere, createMarkerMaterial(HALO));
    this.halo.scale.setScalar(HALO_RADIUS);
    this.trail = new THREE.InstancedMesh(this.sphere, createMarkerMaterial(TRAIL_COLOR), TRAIL);
    this.trail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < TRAIL; i++) {
      const f = 1 - i / TRAIL;
      this.trail.setColorAt(i, this.c.setRGB(f * f, f * f, f * f));
    }
    for (const o of [this.core, this.halo, this.trail]) {
      o.frustumCulled = false;
      o.renderOrder = 7;
      o.layers.set(RenderLayers.NoReflection);
    }
    this.group.add(this.trail, this.halo, this.core);
    this.group.visible = false;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  /** The track to replay (null: no ghost). Hidden until update(). */
  setTrack(track: GhostTrack | null): void {
    this.track = track && track.valid ? track : null;
    this.group.visible = false;
  }

  get hasTrack(): boolean {
    return this.track !== null;
  }

  /** Places the ghost at race time `t` (s); hidden past the ghost's finish time or without a track. */
  update(t: number, pulseTime: number): void {
    const track = this.track;
    if (!track || t > track.finishTime) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    track.positionAt(t, this.p);
    this.core.position.set(this.p.x, this.p.y, this.p.z);
    this.halo.position.copy(this.core.position);
    this.halo.scale.setScalar(HALO_RADIUS * (0.9 + 0.1 * Math.sin(pulseTime * 4)));
    for (let i = 0; i < TRAIL; i++) {
      const tt = t - (i + 1) * TRAIL_STEP;
      const f = 1 - i / TRAIL;
      if (tt < 0) {
        this.s.setScalar(1e-4);
      } else {
        track.positionAt(tt, this.p);
        this.s.setScalar(TRAIL_RADIUS * (0.35 + 0.65 * f));
      }
      this.v.set(this.p.x, this.p.y, this.p.z);
      this.trail.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
    }
    this.trail.instanceMatrix.needsUpdate = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    this.sphere.dispose();
    (this.core.material as THREE.Material).dispose();
    (this.halo.material as THREE.Material).dispose();
    (this.trail.material as THREE.Material).dispose();
    this.trail.dispose();
    this.group.removeFromParent();
  }
}
