/**
 * The character's face life on the morph targets the pipeline keeps (ARKit-style face units, see tools/humans/face.py)
 * and the eye bones: natural blinking (irregular, now and then a double blink, the lids closing faster than they
 * open), eyes that hold a target or wander with small saccades, and a handful of eased expressions the game sets
 * (smile, laugh, shout, effort, focus).
 */
import * as THREE from 'three';
import type { HumanRider } from './human';

export interface FaceExpression {
  /** 0..1 each. */
  smile?: number;
  laugh?: number;
  shout?: number;
  effort?: number;
  focus?: number;
}

type Morphs = Record<string, number>;

/** Face unit weights per expression at full strength. */
const EXPRESSIONS: Record<keyof FaceExpression, Morphs> = {
  smile: { mouthSmileLeft: 0.55, mouthSmileRight: 0.55, eyeSquintLeft: 0.2, eyeSquintRight: 0.2 },
  laugh: { mouthSmileLeft: 0.8, mouthSmileRight: 0.8, jawOpen: 0.28, eyeSquintLeft: 0.45, eyeSquintRight: 0.45, browInnerUp: 0.2 },
  shout: { jawOpen: 0.75, browDownLeft: 0.5, browDownRight: 0.5, noseSneerLeft: 0.35, noseSneerRight: 0.35, mouthStretchLeft: 0.3, mouthStretchRight: 0.3 },
  effort: { browDownLeft: 0.45, browDownRight: 0.45, eyeSquintLeft: 0.4, eyeSquintRight: 0.4, mouthPressLeft: 0.5, mouthPressRight: 0.5, noseSneerLeft: 0.2, noseSneerRight: 0.2 },
  focus: { browDownLeft: 0.3, browDownRight: 0.3, eyeSquintLeft: 0.3, eyeSquintRight: 0.3, mouthPressLeft: 0.2, mouthPressRight: 0.2 },
};

/** Eye rotation limits (rad) about the head's up and side axes. */
const EYE_YAW = 0.45;
const EYE_PITCH = 0.3;

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _hq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export class FaceLife {
  private readonly meshes: THREE.Mesh[] = [];
  private readonly eyes: { bone: THREE.Bone; rest: THREE.Quaternion }[] = [];
  private readonly head?: THREE.Bone;
  private readonly current = new Map<string, number>();
  private readonly expr: Required<FaceExpression> = { smile: 0, laugh: 0, shout: 0, effort: 0, focus: 0 };
  private blinkIn = 1.5;
  private blinkT = -1;
  private doubleBlink = false;
  private saccadeIn = 0.5;
  private readonly saccade = new THREE.Vector2();
  private readonly gaze = new THREE.Vector2();
  private time = 0;
  /** Seeded so screenshots repeat. */
  private seed = 12345;

  constructor(human: HumanRider) {
    for (const m of human.meshes) {
      if (m.morphTargetDictionary && m.morphTargetInfluences) {
        this.meshes.push(m);
      }
    }
    for (const n of ['LeftEye', 'RightEye']) {
      const b = human.bones.get(n);
      if (b) {
        this.eyes.push({ bone: b, rest: b.quaternion.clone() });
      }
    }
    this.head = human.bones.get('Head');
  }

  get hasFace(): boolean {
    return this.meshes.length > 0;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** `lookAt` = world point the eyes hold (else ahead, wandering); expressions ease in and out. */
  update(dt: number, expression: FaceExpression = {}, lookAt?: THREE.Vector3 | null): void {
    this.time += dt;
    // --- expressions ---
    const k = 1 - Math.exp(-6 * dt);
    for (const key of Object.keys(this.expr) as (keyof FaceExpression)[]) {
      this.expr[key] += ((expression[key] ?? 0) - this.expr[key]) * k;
    }
    const target: Morphs = {};
    const add = (m: Morphs, w: number): void => {
      for (const [n, v] of Object.entries(m)) {
        target[n] = Math.min(1, (target[n] ?? 0) + v * w);
      }
    };
    for (const key of Object.keys(this.expr) as (keyof FaceExpression)[]) {
      if (this.expr[key] > 1e-3) {
        add(EXPRESSIONS[key], this.expr[key]);
      }
    }
    // A laugh shakes the jaw.
    if (this.expr.laugh > 0.05) {
      target.jawOpen = (target.jawOpen ?? 0) + 0.12 * this.expr.laugh * (0.5 + 0.5 * Math.sin(this.time * 2 * Math.PI * 5.5));
    }
    // --- blink: close 70 ms, hold, open 130 ms; every 2-6 s, sometimes twice ---
    this.blinkIn -= dt;
    if (this.blinkT < 0 && this.blinkIn <= 0) {
      this.blinkT = 0;
    }
    let lid = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const t = this.blinkT;
      lid = t < 0.07 ? t / 0.07 : t < 0.1 ? 1 : Math.max(0, 1 - (t - 0.1) / 0.13);
      if (t > 0.23) {
        this.blinkT = -1;
        if (!this.doubleBlink && this.rand() < 0.15) {
          this.doubleBlink = true;
          this.blinkIn = 0.12;
        } else {
          this.doubleBlink = false;
          this.blinkIn = 2 + this.rand() * 4 - this.expr.effort * 1.2;
        }
      }
    }
    // Squinting lids sit lower; the blink closes what is left.
    const squint = Math.max(target.eyeSquintLeft ?? 0, target.eyeSquintRight ?? 0);
    target.eyeBlinkLeft = Math.min(1, lid + squint * 0.25);
    target.eyeBlinkRight = Math.min(1, lid + squint * 0.25);
    this.applyMorphs(target, dt);
    this.updateEyes(dt, lookAt ?? null);
  }

  private applyMorphs(target: Morphs, dt: number): void {
    // Blinks are set directly (already shaped); everything else eases.
    const k = 1 - Math.exp(-12 * dt);
    const names = new Set([...this.current.keys(), ...Object.keys(target)]);
    for (const n of names) {
      const want = target[n] ?? 0;
      const cur = this.current.get(n) ?? 0;
      const v = n.startsWith('eyeBlink') ? want : cur + (want - cur) * k;
      this.current.set(n, v);
    }
    for (const m of this.meshes) {
      const dict = m.morphTargetDictionary!;
      const inf = m.morphTargetInfluences!;
      for (const [n, v] of this.current) {
        const i = dict[n];
        if (i !== undefined) {
          inf[i] = v;
        }
      }
    }
  }

  private updateEyes(dt: number, lookAt: THREE.Vector3 | null): void {
    if (this.eyes.length === 0 || !this.head) {
      return;
    }
    // Saccades: a new small fixation offset every 0.4-2 s.
    this.saccadeIn -= dt;
    if (this.saccadeIn <= 0) {
      this.saccade.set((this.rand() - 0.5) * 0.16, (this.rand() - 0.5) * 0.08);
      this.saccadeIn = 0.4 + this.rand() * 1.6;
    }
    let yaw = this.saccade.x;
    let pitch = this.saccade.y;
    if (lookAt) {
      // Target in the head's frame (the character looks along +Z of its bind pose).
      this.head.getWorldPosition(_p);
      this.head.getWorldQuaternion(_hq);
      _d.subVectors(lookAt, _p).applyQuaternion(_hq.invert()).normalize();
      yaw += Math.atan2(_d.x, _d.z);
      pitch += -Math.asin(THREE.MathUtils.clamp(_d.y, -1, 1));
    }
    yaw = THREE.MathUtils.clamp(yaw, -EYE_YAW, EYE_YAW);
    pitch = THREE.MathUtils.clamp(pitch, -EYE_PITCH, EYE_PITCH);
    // Eyes jump (saccade), they do not glide: a fast approach.
    const k = 1 - Math.exp(-35 * dt);
    this.gaze.x += (yaw - this.gaze.x) * k;
    this.gaze.y += (pitch - this.gaze.y) * k;
    for (const e of this.eyes) {
      // Rotation about the head's own axes, expressed in the eye's parent (the head).
      this.head.getWorldQuaternion(_hq);
      e.bone.parent!.getWorldQuaternion(_pq);
      _q.setFromEuler(_e.set(this.gaze.y, this.gaze.x, 0, 'YXZ'));
      // world delta = H · q · H⁻¹; local' = P⁻¹ · delta · P · rest
      const delta = _hq.clone().multiply(_q).multiply(_hq.clone().invert());
      e.bone.quaternion.copy(_pq.clone().invert().multiply(delta).multiply(_pq).multiply(e.rest));
    }
  }
}
