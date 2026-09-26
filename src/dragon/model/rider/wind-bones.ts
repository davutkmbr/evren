/**
 * Secondary motion for the loose parts of the rider's dress (skirt panels, sash ends): the Blender pipeline adds bone
 * chains named `wind_<Part>_<n>` (n = 1 at the root). Each frame, after the pose, every chain is bent as a whole towards
 * where the air pushes it (the relative airflow, harder with speed) plus a flutter, through a damped spring so it
 * lags and settles; the bend is spread over the chain's bones so it curls rather than hinging at the root.
 */
import * as THREE from 'three';

export interface WindChainTuning {
  /** How far the airflow can swing the chain (radians at full speed). */
  swing: number;
  /** Flutter amplitude (radians at full speed) and frequency (Hz). */
  flutter: number;
  flutterHz: number;
  /** Spring stiffness (1/s²) and damping ratio. */
  stiffness: number;
  damping: number;
}

const DEFAULT: WindChainTuning = { swing: 0.5, flutter: 0.12, flutterHz: 2.2, stiffness: 60, damping: 0.45 };

/** Per part: the skirt panels are heavy wool and lie on the thighs; the sash ends are light silk. */
const TUNING: Record<string, Partial<WindChainTuning>> = {
  SkirtFL: { swing: 0.28, flutter: 0.06, flutterHz: 1.6, stiffness: 45 },
  SkirtFR: { swing: 0.28, flutter: 0.06, flutterHz: 1.7, stiffness: 45 },
  SkirtBL: { swing: 0.75, flutter: 0.1, flutterHz: 1.9, stiffness: 40 },
  SkirtBR: { swing: 0.75, flutter: 0.1, flutterHz: 2.0, stiffness: 40 },
  Sash0: { swing: 1.25, flutter: 0.3, flutterHz: 3.1, stiffness: 30, damping: 0.3 },
  Sash1: { swing: 1.2, flutter: 0.32, flutterHz: 3.6, stiffness: 30, damping: 0.3 },
};

/** Airspeed (m/s) at which the parts stream out fully. */
const FULL_SPEED = 30;

interface Chain {
  bones: THREE.Bone[];
  rest: THREE.Quaternion[];
  tuning: WindChainTuning;
  phase: number;
  /** Spring state: the chain's current bend (world-space rotation vector, radians) and its velocity. */
  bend: THREE.Vector3;
  vel: THREE.Vector3;
}

const _root = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _push = new THREE.Vector3();
const _target = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _pqi = new THREE.Quaternion();
const _side = new THREE.Vector3();

export class WindBones {
  readonly chains: Chain[] = [];
  private time = 0;

  constructor(bones: Map<string, THREE.Bone>) {
    const groups = new Map<string, THREE.Bone[]>();
    for (const [name, bone] of bones) {
      const m = /^wind_(\w+?)_(\d+)$/.exec(name);
      if (!m) {
        continue;
      }
      const list = groups.get(m[1]) ?? [];
      list[Number(m[2]) - 1] = bone;
      groups.set(m[1], list);
    }
    let k = 0;
    for (const [part, list] of groups) {
      const chainBones = list.filter(Boolean);
      if (chainBones.length === 0) {
        continue;
      }
      this.chains.push({
        bones: chainBones,
        rest: chainBones.map((b) => b.quaternion.clone()),
        tuning: { ...DEFAULT, ...TUNING[part] },
        phase: k++ * 1.7,
        bend: new THREE.Vector3(),
        vel: new THREE.Vector3(),
      });
    }
  }

  /** Captures the current (posed) local rotations as the rest the wind bends from (call after changing the pose). */
  captureRest(): void {
    for (const c of this.chains) {
      c.bones.forEach((b, i) => c.rest[i].copy(b.quaternion));
    }
  }

  /**
   * `airflow` = where the air goes relative to the rider (world, unit), `airspeed` in m/s. Call after the skeleton's
   * pose for the frame is set.
   */
  update(dt: number, airspeed: number, airflow: THREE.Vector3): void {
    if (this.chains.length === 0) {
      return;
    }
    const step = Math.min(dt, 1 / 20);
    this.time += step;
    const q = THREE.MathUtils.clamp(airspeed / FULL_SPEED, 0, 1.4);
    for (const c of this.chains) {
      const t = c.tuning;
      c.bones.forEach((b, i) => b.quaternion.copy(c.rest[i]));
      const first = c.bones[0];
      const last = c.bones[c.bones.length - 1];
      first.parent?.updateMatrixWorld(true);
      first.updateMatrixWorld(true);
      first.getWorldPosition(_root);
      // The chain's direction: root head to the last bone's head (glTF bones carry no tails).
      last.updateMatrixWorld(true);
      last.getWorldPosition(_tip);
      _dir.subVectors(_tip, _root).normalize();
      // Air pushes the chain toward the airflow, only the part across the chain's direction bends it.
      _push.copy(airflow).addScaledVector(_dir, -airflow.dot(_dir));
      _target.crossVectors(_dir, _push).multiplyScalar(t.swing * q * q);
      // Flutter: across the airflow, two detuned sines.
      _side.crossVectors(airflow, _dir).normalize();
      const w = 2 * Math.PI * t.flutterHz * (0.6 + 0.4 * q);
      const f = t.flutter * q * (Math.sin(this.time * w + c.phase) * 0.7 + Math.sin(this.time * w * 1.73 + c.phase * 2.3) * 0.3);
      _target.addScaledVector(_dir, f * 0.5).addScaledVector(_side, f * 0.2);
      // Damped spring on the bend.
      const k = t.stiffness;
      const d = 2 * t.damping * Math.sqrt(k);
      _acc.subVectors(_target, c.bend).multiplyScalar(k).addScaledVector(c.vel, -d);
      c.vel.addScaledVector(_acc, step);
      c.bend.addScaledVector(c.vel, step);
      const angle = c.bend.length();
      if (angle < 1e-5) {
        continue;
      }
      _axis.copy(c.bend).divideScalar(angle);
      // Spread over the bones: each adds an equal share of the rotation, in world space about the bend axis.
      _q.setFromAxisAngle(_axis, angle / c.bones.length);
      for (const b of c.bones) {
        b.parent!.getWorldQuaternion(_pq);
        _pqi.copy(_pq).invert();
        // local' = P⁻¹ · R · P · local
        b.quaternion.premultiply(_pq).premultiply(_q).premultiply(_pqi);
        b.updateMatrixWorld(true);
      }
    }
  }
}
