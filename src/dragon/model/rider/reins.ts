/**
 * The reins' free spans as simulated leather straps: from where each rein leaves the dragon's neck to the rider's fist,
 * and the buckled bight hanging between the fists. Verlet in world space (so the dragon's own motion swings them),
 * gravity and air drag (they trail back in flight), ends pinned: the neck anchor (skinned like the body there) and the
 * rope's path through each fist, carried by the rig's fist bones (riderReinR / riderHandL; the right rein passes to the
 * left fist when the right hand is busy). A strap longer than the span sags when the hands give and runs straight when
 * they pull; the path inside the fist is rigid.
 */
import * as THREE from 'three';
import type { RigSkeleton } from '../skeleton';
import type { TackParts } from '../geometry/tack';
import { rigTransform } from '../animation/kinematics';

type Side = 'L' | 'R';
const SIDES: Side[] = ['L', 'R'];
const FIST_BONE: Record<Side, string> = { R: 'riderReinR', L: 'riderHandL' };
/** Strap section (m): width and thickness; radial segments of the section. */
const WIDTH = 0.014;
const THICK = 0.006;
const RADIAL = 6;
/** Slack at rest (share of the rest span), bight length (m). */
const SLACK = 0.06;
const BIGHT = 0.6;
/** Air drag (1/s) and velocity damping per step. */
const DRAG = 0.15;
const DAMP = 0.97;
/** Largest node speed (m/s), and an end jump (m per frame) that re-lays a strand instead of whipping it. */
const MAX_SPEED = 12;
const TELEPORT = 0.2;
const ITER = 14;

interface Strand {
  nodes: THREE.Vector3[];
  prev: THREE.Vector3[];
  restLen: number;
  /** Ends last frame (teleport check). */
  lastA?: THREE.Vector3;
  lastB?: THREE.Vector3;
}

interface SideRig {
  anchor: THREE.Vector3;
  skin: { bones: THREE.Bone[]; heads: THREE.Vector3[]; weights: number[] };
  fist: THREE.Vector3[];
  fistBone: THREE.Bone;
  fistHead: THREE.Vector3;
  strand: Strand;
  mesh: THREE.Mesh;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _bn = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _g = new THREE.Vector3(0, -9.81, 0);

function strand(from: THREE.Vector3, to: THREE.Vector3, count: number, length: number, sag: number): Strand {
  const nodes: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    nodes.push(from.clone().lerp(to, t).add(new THREE.Vector3(0, -sag * Math.sin(Math.PI * t), 0)));
  }
  return { nodes, prev: nodes.map((n) => n.clone()), restLen: length };
}

/** A strap mesh along a polyline (positions rewritten every frame). */
function strapMesh(points: number, material: THREE.Material): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  const verts = points * RADIAL;
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  const idx: number[] = [];
  for (let i = 0; i < points - 1; i++) {
    for (let k = 0; k < RADIAL; k++) {
      const a = i * RADIAL + k;
      const b = i * RADIAL + ((k + 1) % RADIAL);
      const c = a + RADIAL;
      const d = b + RADIAL;
      idx.push(a, c, b, b, c, d);
    }
  }
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, material);
  m.frustumCulled = false;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export class DynamicReins {
  private readonly sides: SideRig[] = [];
  private readonly bight: Strand;
  private readonly bightMesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private ready = false;
  /** The rope's path through each fist on the character's own hands (world), when it has hands; else the rig's fists. */
  fistPath?: (side: Side, out: THREE.Vector3[]) => THREE.Vector3[];

  constructor(
    reins: NonNullable<TackParts['reins']>,
    private readonly skel: RigSkeleton,
    private readonly rigRoot: THREE.Object3D,
  ) {
    this.material = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.028, 0.017, 0.011), roughness: 0.72, metalness: 0 });
    for (const side of SIDES) {
      const r = reins[side];
      const fistBone = skel.bone(FIST_BONE[side]);
      const entry = r.fist[0];
      const span = r.anchor.distanceTo(entry);
      const s: SideRig = {
        anchor: r.anchor.clone(),
        skin: {
          bones: r.skin.bones.map((i) => skel.bones[i]),
          heads: r.skin.bones.map((i) => skel.restHeads[i].clone()),
          weights: [...r.skin.weights],
        },
        fist: r.fist.map((p) => p.clone()),
        fistBone,
        fistHead: skel.restHeads[skel.id(FIST_BONE[side])].clone(),
        strand: strand(r.anchor, entry, 16, span * (1 + SLACK), 0.05),
        mesh: strapMesh(16 + r.fist.length - 1, this.material),
      };
      s.mesh.name = `rein-${side}`;
      rigRoot.add(s.mesh);
      this.sides.push(s);
    }
    const eR = reins.R.fist[reins.R.fist.length - 1];
    const eL = reins.L.fist[reins.L.fist.length - 1];
    this.bight = strand(eR, eL, 18, BIGHT, 0.15);
    this.bightMesh = strapMesh(18, this.material);
    this.bightMesh.name = 'rein-bight';
    rigRoot.add(this.bightMesh);
  }

  /** The rig-space rest point `p` carried by bone `b` (rest rotation identity, rest head `head`) → world. */
  private carried(b: THREE.Bone, head: THREE.Vector3, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    rigTransform(b, this.rigRoot, _p, _q);
    return out.copy(p).sub(head).applyQuaternion(_q).add(_p).applyMatrix4(this.rigRoot.matrixWorld);
  }

  private anchorWorld(s: SideRig, out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    for (let i = 0; i < s.skin.bones.length; i++) {
      this.carried(s.skin.bones[i], s.skin.heads[i], s.anchor, _a);
      out.addScaledVector(_a, s.skin.weights[i]);
    }
    return out;
  }

  update(dt: number): void {
    this.rigRoot.updateMatrixWorld();
    const h = Math.min(Math.max(dt, 1e-4), 1 / 30) / 3;
    // Pinned ends this frame.
    const fistWorld = this.sides.map((s, i) => {
      const own = this.fistPath?.(SIDES[i], []);
      return own && own.length === s.fist.length ? own : s.fist.map((p) => this.carried(s.fistBone, s.fistHead, p, new THREE.Vector3()));
    });
    const anchors = this.sides.map((s) => this.anchorWorld(s, new THREE.Vector3()));
    if (!this.ready) {
      // First frame: lay the strands between their ends (no fall-in from the rest pose).
      this.sides.forEach((s, i) => this.lay(s.strand, anchors[i], fistWorld[i][0], 0.06));
      this.lay(this.bight, fistWorld[1].at(-1)!, fistWorld[0].at(-1)!, 0.18);
      this.ready = true;
    }
    // Ends that jumped (a pose snap, the character loading in) re-lay their strand.
    const relay = (st: Strand, a: THREE.Vector3, b: THREE.Vector3, sag: number): void => {
      if (st.lastA && st.lastB && (st.lastA.distanceTo(a) > TELEPORT || st.lastB.distanceTo(b) > TELEPORT)) {
        this.lay(st, a, b, sag);
      }
      st.lastA = (st.lastA ?? new THREE.Vector3()).copy(a);
      st.lastB = (st.lastB ?? new THREE.Vector3()).copy(b);
    };
    this.sides.forEach((s, i) => relay(s.strand, anchors[i], fistWorld[i][0], 0.06));
    relay(this.bight, fistWorld[1].at(-1)!, fistWorld[0].at(-1)!, 0.18);
    for (let step = 0; step < 3; step++) {
      this.sides.forEach((s, i) => this.simulate(s.strand, anchors[i], fistWorld[i][0], h));
      // The bight hangs from the right fist's exit to the left fist's exit.
      const exitR = fistWorld[this.sides.findIndex((s) => s.fistBone.name === FIST_BONE.R)].at(-1)!;
      const exitL = fistWorld[this.sides.findIndex((s) => s.fistBone.name === FIST_BONE.L)].at(-1)!;
      this.simulate(this.bight, exitR, exitL, h);
    }
    // Meshes (rig-local): strand + the rigid path through the fist.
    _inv.copy(this.rigRoot.matrixWorld).invert();
    this.sides.forEach((s, i) => this.writeStrap(s.mesh, [...s.strand.nodes, ...fistWorld[i].slice(1)]));
    this.writeStrap(this.bightMesh, this.bight.nodes);
  }

  private lay(st: Strand, a: THREE.Vector3, b: THREE.Vector3, sag: number): void {
    const n = st.nodes.length;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      st.nodes[i].copy(a).lerp(b, t);
      st.nodes[i].y -= sag * Math.sin(Math.PI * t);
      st.prev[i].copy(st.nodes[i]);
    }
  }

  private simulate(st: Strand, a: THREE.Vector3, b: THREE.Vector3, h: number): void {
    const n = st.nodes.length;
    // Integrate the free nodes: gravity, air drag against their own motion (still air), damping.
    for (let i = 1; i < n - 1; i++) {
      const p = st.nodes[i];
      const q = st.prev[i];
      _t.subVectors(p, q).multiplyScalar(DAMP);
      if (_t.length() > MAX_SPEED * h) {
        _t.setLength(MAX_SPEED * h);
      }
      const vel = _t.clone().divideScalar(h);
      _n.copy(_g).addScaledVector(vel, -DRAG);
      q.copy(p);
      p.add(_t).addScaledVector(_n, h * h);
    }
    st.nodes[0].copy(a);
    st.nodes[n - 1].copy(b);
    st.prev[0].copy(a);
    st.prev[n - 1].copy(b);
    // Segment length: the strap's own, or the span's when pulled tight (it cannot stretch, so it runs straight).
    const seg = Math.max(st.restLen, a.distanceTo(b)) / (n - 1);
    for (let it = 0; it < ITER; it++) {
      for (let i = 0; i < n - 1; i++) {
        const p0 = st.nodes[i];
        const p1 = st.nodes[i + 1];
        _a.subVectors(p1, p0);
        const d = _a.length() || 1e-9;
        const corr = (d - seg) / d;
        const w0 = i === 0 ? 0 : 1;
        const w1 = i + 1 === n - 1 ? 0 : 1;
        const sum = w0 + w1;
        if (sum === 0) {
          continue;
        }
        p0.addScaledVector(_a, (corr * w0) / sum);
        p1.addScaledVector(_a, (-corr * w1) / sum);
      }
      // Leather bends but does not kink: nodes two apart keep most of their straight distance.
      const minBend = seg * 1.82;
      for (let i = 0; i < n - 2; i++) {
        const p0 = st.nodes[i];
        const p2 = st.nodes[i + 2];
        _a.subVectors(p2, p0);
        const d = _a.length() || 1e-9;
        if (d >= minBend) {
          continue;
        }
        const w0 = i === 0 ? 0 : 1;
        const w2 = i + 2 === n - 1 ? 0 : 1;
        const sum = w0 + w2;
        if (sum === 0) {
          continue;
        }
        const corr = ((d - minBend) / d) * 0.5;
        p0.addScaledVector(_a, (corr * w0) / sum);
        p2.addScaledVector(_a, (-corr * w2) / sum);
      }
    }
  }

  /** Writes a flat strap through world points into a rig-local mesh (parallel-transported frame). */
  private writeStrap(mesh: THREE.Mesh, pts: THREE.Vector3[]): void {
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const nor = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const count = Math.min(pts.length, pos.count / RADIAL);
    const local = pts.map((p) => p.clone().applyMatrix4(_inv));
    const up = new THREE.Vector3(0, 1, 0);
    let normal = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const p = local[i];
      _t.subVectors(local[Math.min(i + 1, count - 1)], local[Math.max(i - 1, 0)]).normalize();
      if (i === 0) {
        normal.crossVectors(_t, up);
        if (normal.lengthSq() < 1e-6) {
          normal.set(1, 0, 0);
        }
        normal.normalize();
      } else {
        // Parallel transport: remove the tangent component, keep the twist.
        normal.addScaledVector(_t, -normal.dot(_t)).normalize();
      }
      _bn.crossVectors(_t, normal).normalize();
      for (let k = 0; k < RADIAL; k++) {
        const ang = (k / RADIAL) * Math.PI * 2;
        const cx = Math.cos(ang);
        const sy = Math.sin(ang);
        _b.copy(normal).multiplyScalar(cx * WIDTH * 0.5).addScaledVector(_bn, sy * THICK * 0.5);
        const vi = i * RADIAL + k;
        pos.setXYZ(vi, p.x + _b.x, p.y + _b.y, p.z + _b.z);
        _n.copy(normal).multiplyScalar(cx / WIDTH).addScaledVector(_bn, sy / THICK).normalize();
        nor.setXYZ(vi, _n.x, _n.y, _n.z);
      }
    }
    // Unused tail (if any) collapses onto the last point.
    for (let vi = count * RADIAL; vi < pos.count; vi++) {
      pos.setXYZ(vi, local[count - 1].x, local[count - 1].y, local[count - 1].z);
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    normal = normal.clone();
    void normal;
  }

  dispose(): void {
    for (const s of this.sides) {
      s.mesh.removeFromParent();
      s.mesh.geometry.dispose();
    }
    this.bightMesh.removeFromParent();
    this.bightMesh.geometry.dispose();
    this.material.dispose();
  }
}
