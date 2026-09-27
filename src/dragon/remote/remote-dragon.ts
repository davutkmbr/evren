/**
 * One remote dragon: its own skeleton and procedural animator on the kit's shared geometry and materials, driven by
 * the snapshots of its SnapshotBuffer. Level of detail by camera distance (LOD_BANDS): the animation runs less often,
 * shadows go off, and past the last band the dragon is hidden.
 */
import * as THREE from 'three';
import type { DragonPose, DragonState } from '../../core/contracts';
import { buildBoneSpecs } from '../model/anatomy';
import { buildSkeleton, type RigSkeleton } from '../model/skeleton';
import { DEFAULT_POSE } from '../model/constants';
import { DragonAnimator } from '../model/animation/animator';
import { createSnapshot, decodeSnapshot, fieldsToPose, type DragonSnapshot } from '../../net/snapshot';
import { SnapshotBuffer } from './buffer';
import type { DragonMaterials, RemoteDragonKit } from './kit';

/** Distance bands (m): animation every `every` frames, shadows on or off; beyond the last band: hidden. */
export const LOD_BANDS: readonly { maxDistance: number; every: number; shadows: boolean }[] = [
  { maxDistance: 350, every: 1, shadows: true },
  { maxDistance: 1200, every: 2, shadows: false },
  { maxDistance: 4000, every: 4, shadows: false },
  { maxDistance: 9000, every: 8, shadows: false },
];

const BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0, 0.8), 15);
const _prevInv = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _axis = new THREE.Vector3();

export class RemoteDragon {
  readonly object = new THREE.Group();
  readonly buffer = new SnapshotBuffer();
  /** Last sampled state (render time). */
  readonly current: DragonSnapshot = createSnapshot();
  private readonly skel: RigSkeleton;
  private readonly meshes: THREE.SkinnedMesh[] = [];
  private readonly animator: DragonAnimator;
  private readonly materials: DragonMaterials;
  private readonly pose: DragonPose = { ...DEFAULT_POSE };
  private readonly velocity = new THREE.Vector3();
  private readonly angularVelocity = new THREE.Vector3();
  private readonly lastQuaternion = new THREE.Quaternion();
  private readonly state: DragonState;
  private readonly decoded = createSnapshot();
  private animDt = 0;
  private hasPose = false;
  /** Current LOD band index, -1 when hidden. */
  band = 0;

  constructor(
    readonly id: string,
    kit: RemoteDragonKit,
  ) {
    this.object.name = `remote-dragon:${id}`;
    const root = new THREE.Group();
    this.skel = buildSkeleton(buildBoneSpecs());
    root.add(this.skel.rootBone);
    this.materials = kit.createMaterials();
    kit.geometries.forEach((g, i) => {
      const mesh = new THREE.SkinnedMesh(g.geometry, this.materials.parts[i].material);
      mesh.name = g.name;
      mesh.bind(this.skel.skeleton, new THREE.Matrix4());
      mesh.customDepthMaterial = this.materials.parts[i].depthMaterial;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.boundingSphere = BOUNDS.clone();
      this.meshes.push(mesh);
      root.add(mesh);
    });
    this.object.add(root);
    this.animator = new DragonAnimator(this.skel);
    this.state = {
      object: this.object,
      position: this.object.position,
      quaternion: this.object.quaternion,
      velocity: this.velocity,
      angularVelocity: this.angularVelocity,
      mode: 'flying',
      airspeed: 0,
      altitude: 0,
      agl: 0,
      headingDeg: 0,
      gForce: 1,
      stamina: 1,
      flapEffort: 0,
      firing: false,
      touchingWater: false,
    };
    this.object.visible = false;
  }

  /** A snapshot as received (SNAPSHOT_BYTES at `offset`). */
  pushBytes(data: ArrayBuffer, offset = 0): void {
    this.buffer.push(decodeSnapshot(data, offset, this.decoded));
  }

  /** Samples the buffer, places the dragon and animates it per its LOD band (distance to `eye`). */
  update(dt: number, eye: THREE.Vector3, frame: number, index: number): void {
    const s = this.current;
    if (!this.buffer.sample(dt, s)) {
      this.object.visible = false;
      return;
    }
    this.object.position.fromArray(s.position);
    this.object.quaternion.fromArray(s.quaternion);
    this.velocity.fromArray(s.velocity);
    const distance = this.object.position.distanceTo(eye);
    this.band = LOD_BANDS.findIndex((b) => distance <= b.maxDistance);
    this.object.visible = this.band >= 0;
    this.animDt += dt;
    if (this.band < 0) {
      this.lastQuaternion.copy(this.object.quaternion);
      return;
    }
    const lod = LOD_BANDS[this.band];
    for (const m of this.meshes) {
      m.castShadow = lod.shadows;
    }
    // Stagger the skipped frames across dragons (index) so they do not all animate on the same frame.
    if (this.hasPose && (frame + index) % lod.every !== 0) {
      return;
    }
    this.estimateAngularVelocity(this.animDt);
    fieldsToPose(s.pose, this.pose);
    this.pose.groundY = s.groundY;
    this.pose.groundNx = s.groundNx;
    this.pose.groundNz = s.groundNz;
    this.state.mode = s.mode;
    this.state.firing = s.firing;
    this.state.airspeed = this.velocity.length();
    this.state.altitude = s.position[1];
    this.animator.setAngularVelocity(this.angularVelocity);
    this.animator.update(this.pose, this.hasPose ? this.animDt : 0, this.state);
    this.animDt = 0;
    this.hasPose = true;
    this.writeUniforms();
  }

  /** World direction toward the key light (membrane translucency). */
  setKeyLight(dir: THREE.Vector3): void {
    if (dir.lengthSq() > 1e-8) {
      this.materials.membrane.uKeyLightDir.value.copy(dir).normalize();
    }
  }

  /** Body-frame angular velocity from the orientation change since the last animation step (tail and neck lag). */
  private estimateAngularVelocity(dt: number): void {
    if (dt <= 0) {
      return;
    }
    _prevInv.copy(this.lastQuaternion).invert();
    _dq.multiplyQuaternions(_prevInv, this.object.quaternion);
    if (_dq.w < 0) {
      _dq.set(-_dq.x, -_dq.y, -_dq.z, -_dq.w);
    }
    const angle = 2 * Math.acos(Math.min(1, _dq.w));
    const sin = Math.sqrt(Math.max(0, 1 - _dq.w * _dq.w));
    if (sin > 1e-6) {
      _axis.set(_dq.x / sin, _dq.y / sin, _dq.z / sin).multiplyScalar(angle / dt);
    } else {
      _axis.set(0, 0, 0);
    }
    this.angularVelocity.lerp(_axis, Math.min(1, dt * 8));
    this.lastQuaternion.copy(this.object.quaternion);
  }

  /** This dragon's animator outputs into its materials. */
  private writeUniforms(): void {
    const o = this.animator.outputs;
    const m = this.materials;
    m.body.uBreath.value = o.breath;
    m.body.uEyeLid.value = THREE.MathUtils.clamp(this.pose.eyeLid ?? 0, 0, 1);
    m.body.uPupil.value = THREE.MathUtils.clamp(this.pose.pupil ?? 0.3, 0, 1);
    m.membrane.uBillow.value.set(o.billowLeft, o.billowRight);
    m.membrane.uFlutter.value = o.flutter;
    m.membrane.uFlutterFreq.value = o.flutterFreq;
    m.membrane.uFoldSlack.value = o.foldSlack;
    m.rider.uAirspeed.value = o.airspeed;
    m.rider.uAirflow.value.copy(o.airflow);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.materials.dispose();
    this.skel.skeleton.dispose();
  }
}
