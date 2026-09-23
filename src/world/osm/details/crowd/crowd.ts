/**
 * The slice's pedestrians: event-driven walkers on the walk graph (crowd/graph.ts) plus stationary people, drawn as
 * two instanced LOD meshes (crowd/people.ts). The GPU extrapolates every walker along its current straight segment;
 * the CPU only touches a walker when it reaches a vertex (a few dozen per frame). The far mesh draws every instance
 * from the shared buffer with a light body; the detailed near mesh only gets the instances around the camera, copied
 * into its own small buffer each frame.
 *
 * Walkers do a weighted random walk (edges weighted by their lane density, preferring to keep straight), sometimes
 * pause to look around and sometimes turn back. Friends and families walk in groups: followers replay their leader's
 * segments a moment later and a little to the side.
 */
import * as THREE from 'three';
import { hash } from '../../shared/geometry';
import { Pose, STANDER_STRIDE, VERT_STRIDE, type WalkGraph } from '../protocol';
import { PERSON_COLOR_STRIDE, PERSON_STRIDE, Style, createPeopleMaterial, createPeopleMesh, personGeometry } from './people';

/** Near LOD / draw distance (m). */
const NEAR_LOD = 95;
const DRAW_DISTANCE = 620;
/** Most instances the near mesh holds. */
const NEAR_CAPACITY = 3000;
/** Most walkers a frame may advance (bounds the CPU after long frames). */
const EVENT_BUDGET = 600;
const MAX_WALKERS = 12000;

const TOPS = [0x1b1b1d, 0xe6e4df, 0x6f7275, 0x1f2a44, 0x2f3b2c, 0xc2b08e, 0x9fb6cc, 0x8e2424, 0xb88a2e, 0x5b4232, 0xd49aa6, 0x5d5d3a, 0x4a6285, 0x9a8a62, 0x5e1f2a, 0x2b2b2e, 0xf0efe9, 0x33475e];
const BOTTOMS = [0x2f4668, 0x3d5a82, 0x23324b, 0x1a1a1c, 0x55585c, 0xb5a27f, 0x8a7c5a, 0x3b2e25, 0x2a2c30, 0x1f2d45];
const ACCENTS = [0xcdbb9a, 0x1f2a44, 0x16161a, 0x6a1f2c, 0xb9a3c9, 0x9fb9d3, 0xe7dfcf, 0x5f6b45, 0x8a6a8e, 0x2c3e50, 0xa33a2a, 0x4d4d4d];

function rgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** Binary min-heap of walker ids keyed by event time. */
class EventHeap {
  private ids: Int32Array;
  private size = 0;

  constructor(
    capacity: number,
    private readonly key: Float64Array,
  ) {
    this.ids = new Int32Array(capacity);
  }

  get length(): number {
    return this.size;
  }

  peekKey(): number {
    return this.size ? this.key[this.ids[0]] : Infinity;
  }

  push(id: number): void {
    let i = this.size++;
    const ids = this.ids;
    const key = this.key;
    ids[i] = id;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (key[ids[p]] <= key[ids[i]]) {
        break;
      }
      [ids[p], ids[i]] = [ids[i], ids[p]];
      i = p;
    }
  }

  pop(): number {
    const ids = this.ids;
    const key = this.key;
    const top = ids[0];
    ids[0] = ids[--this.size];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < this.size && key[ids[l]] < key[ids[m]]) m = l;
      if (r < this.size && key[ids[r]] < key[ids[m]]) m = r;
      if (m === i) {
        break;
      }
      [ids[m], ids[i]] = [ids[i], ids[m]];
      i = m;
    }
    return top;
  }
}

export interface CrowdStats {
  walkers: number;
  standers: number;
  groups: number;
  /** Instances in the near LOD this frame. */
  near: number;
}

export class Crowd {
  readonly group = new THREE.Group();
  readonly stats: CrowdStats;
  private readonly buf: Float32Array;
  private readonly colors: Uint8Array;
  private readonly count: number;
  private readonly ib: THREE.InstancedInterleavedBuffer;
  private readonly nearBuf: Float32Array;
  private readonly nearColors: Uint8Array;
  private readonly nearIb: THREE.InstancedInterleavedBuffer;
  private readonly nearCb: THREE.InstancedInterleavedBuffer;
  private readonly materials: THREE.MeshStandardMaterial[];
  private readonly geometries: THREE.InstancedBufferGeometry[];
  private readonly v: Float32Array;
  // Leader (group) state.
  private readonly from: Int32Array;
  private readonly to: Int32Array;
  private readonly endT: Float64Array;
  private readonly startT: Float64Array;
  private readonly speed: Float32Array;
  private readonly lateral: Float32Array;
  private readonly paused: Uint8Array;
  /** First instance index and member count of each group (members are contiguous, leader first). */
  private readonly first: Int32Array;
  private readonly members: Uint8Array;
  private readonly memberLat: Float32Array;
  private readonly memberDelay: Float32Array;
  private readonly heap: EventHeap;
  private readonly dirty: number[] = [];
  private seedCounter = 1;

  constructor(
    private readonly graph: WalkGraph,
    standers: Float32Array,
    scale: number,
    now: number,
  ) {
    this.v = graph.verts;
    const edges = this.edgeTable();
    const total = Math.min(MAX_WALKERS, Math.round(edges.expected * scale));
    const standing = standers.length / STANDER_STRIDE;
    // Groups until the walker budget is spent.
    const sizes: number[] = [];
    for (let n = 0, g = 0; n < total; g++) {
      const r = hash(g * 0.713 + 0.2);
      const s = Math.min(total - n, r < 0.62 ? 1 : r < 0.89 ? 2 : r < 0.97 ? 3 : 4);
      sizes.push(s);
      n += s;
    }
    const groups = sizes.length;
    const walkers = sizes.reduce((a, b) => a + b, 0);
    const count = standing + walkers;
    this.stats = { walkers, standers: standing, groups, near: 0 };
    this.count = count;
    this.buf = new Float32Array(Math.max(1, count) * PERSON_STRIDE);
    const colors = new Uint8Array(Math.max(1, count) * PERSON_COLOR_STRIDE);
    this.colors = colors;
    this.from = new Int32Array(groups);
    this.to = new Int32Array(groups);
    this.endT = new Float64Array(groups);
    this.startT = new Float64Array(groups);
    this.speed = new Float32Array(groups);
    this.lateral = new Float32Array(groups);
    this.paused = new Uint8Array(groups);
    this.first = new Int32Array(groups);
    this.members = new Uint8Array(groups);
    this.memberLat = new Float32Array(walkers);
    this.memberDelay = new Float32Array(walkers);
    this.heap = new EventHeap(Math.max(1, groups), this.endT);

    for (let i = 0; i < standing; i++) {
      const o = i * STANDER_STRIDE;
      const b = i * PERSON_STRIDE;
      const x = standers[o];
      const y = standers[o + 1];
      const z = standers[o + 2];
      const yaw = standers[o + 3];
      const seed = standers[o + 5];
      const kid = hash(seed * 0.37) < 0.04 && standers[o + 4] !== Pose.Fish;
      this.buf.set([x, y, z, now - hash(seed) * 100, 0, 0, 0, hash(seed * 1.3) * 6.28, yaw, yaw, standers[o + 4], kid ? 0.65 : 0.92 + 0.14 * hash(seed * 2.1)], b);
      this.look(colors, i, x, z, seed, kid);
    }
    let inst = standing;
    let m = 0;
    for (let g = 0; g < groups; g++) {
      this.first[g] = inst;
      this.members[g] = sizes[g];
      const r = hash(g * 1.931 + 0.4);
      const elderly = r > 0.93;
      this.speed[g] = elderly ? 0.8 + 0.15 * hash(g * 3.1) : 1.05 + 0.45 * hash(g * 5.3) - (sizes[g] > 2 ? 0.2 : 0);
      this.lateral[g] = (hash(g * 7.7) * 2 - 1) * 0.85;
      for (let k = 0; k < sizes[g]; k++, inst++, m++) {
        const kid = k > 0 && sizes[g] > 2 && hash(g + k * 3.3) < 0.5;
        this.memberLat[m] = k === 0 ? 0 : (k % 2 ? 1 : -1) * (0.28 + 0.1 * k);
        this.memberDelay[m] = k === 0 ? 0 : 0.15 + 0.35 * hash(g * 2 + k) + (k > 1 ? 0.5 : 0);
        const b = inst * PERSON_STRIDE;
        this.buf[b + 7] = hash(inst * 0.77) * 6.28;
        this.buf[b + 11] = kid ? 0.62 + 0.1 * hash(inst) : 0.92 + 0.15 * hash(inst * 1.7);
        this.buf[b + 10] = Pose.Walk;
      }
      // Spawn on a random edge (weighted by expected people), mid-segment.
      const e = edges.pick(hash(g * 0.3719 + 0.9));
      const flip = hash(g * 4.3) < 0.5;
      const a = flip ? edges.b[e] : edges.a[e];
      const bv = flip ? edges.a[e] : edges.b[e];
      const len = this.segLength(a, bv, this.lateral[g]);
      const t0 = now - hash(g * 9.1) * (len / this.speed[g]);
      this.startSegment(g, a, bv, t0, false);
      const lx = this.v[a * VERT_STRIDE];
      const lz = this.v[a * VERT_STRIDE + 2];
      for (let k = 0; k < sizes[g]; k++) {
        this.look(colors, this.first[g] + k, lx, lz, g * 17 + k * 5, this.buf[(this.first[g] + k) * PERSON_STRIDE + 11] < 0.8);
      }
      this.heap.push(g);
    }
    this.dirty.length = 0;

    this.ib = new THREE.InstancedInterleavedBuffer(this.buf, PERSON_STRIDE);
    this.ib.setUsage(THREE.DynamicDrawUsage);
    const cb = new THREE.InstancedInterleavedBuffer(colors, PERSON_COLOR_STRIDE);
    this.nearBuf = new Float32Array(NEAR_CAPACITY * PERSON_STRIDE);
    this.nearColors = new Uint8Array(NEAR_CAPACITY * PERSON_COLOR_STRIDE);
    this.nearIb = new THREE.InstancedInterleavedBuffer(this.nearBuf, PERSON_STRIDE).setUsage(THREE.DynamicDrawUsage);
    this.nearCb = new THREE.InstancedInterleavedBuffer(this.nearColors, PERSON_COLOR_STRIDE).setUsage(THREE.DynamicDrawUsage);
    this.materials = [createPeopleMaterial(0, NEAR_LOD, DRAW_DISTANCE), createPeopleMaterial(1, NEAR_LOD, DRAW_DISTANCE)];
    this.geometries = [personGeometry(0), personGeometry(1)];
    this.geometries.forEach((geo, lod) => {
      const ib = lod ? this.ib : this.nearIb;
      const colorBuf = lod ? cb : this.nearCb;
      geo.setAttribute('iP', new THREE.InterleavedBufferAttribute(ib, 4, 0));
      geo.setAttribute('iV', new THREE.InterleavedBufferAttribute(ib, 4, 4));
      geo.setAttribute('iY', new THREE.InterleavedBufferAttribute(ib, 4, 8));
      geo.setAttribute('iC1', new THREE.InterleavedBufferAttribute(colorBuf, 4, 0, true));
      geo.setAttribute('iC2', new THREE.InterleavedBufferAttribute(colorBuf, 4, 4, true));
      geo.setAttribute('iC3', new THREE.InterleavedBufferAttribute(colorBuf, 4, 8, true));
      geo.instanceCount = lod ? count : 0;
      this.group.add(createPeopleMesh(geo, this.materials[lod], `osm-people-${lod ? 'far' : 'near'}`));
    });
    this.group.name = 'osm-crowd';
  }

  /** Every usable edge once, with cumulative expected people for spawning. */
  private edgeTable(): { a: Int32Array; b: Int32Array; expected: number; pick: (u: number) => number } {
    const { start, nbr, weight } = this.graph;
    const n = start.length - 1;
    const a: number[] = [];
    const b: number[] = [];
    const cum: number[] = [];
    let sum = 0;
    for (let v = 0; v < n; v++) {
      if (!this.valid(v)) {
        continue;
      }
      for (let k = start[v]; k < start[v + 1]; k++) {
        const u = nbr[k];
        if (u <= v || !this.valid(u)) {
          continue;
        }
        const len = Math.hypot(this.v[u * VERT_STRIDE] - this.v[v * VERT_STRIDE], this.v[u * VERT_STRIDE + 2] - this.v[v * VERT_STRIDE + 2]);
        if (len < 0.3) {
          continue;
        }
        sum += len * weight[k];
        a.push(v);
        b.push(u);
        cum.push(sum);
      }
    }
    const cumA = Float64Array.from(cum);
    return {
      a: Int32Array.from(a),
      b: Int32Array.from(b),
      expected: sum,
      pick: (u) => {
        const target = u * sum;
        let lo = 0;
        let hi = cumA.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cumA[mid] < target) lo = mid + 1;
          else hi = mid;
        }
        return lo;
      },
    };
  }

  private valid(v: number): boolean {
    return Number.isFinite(this.v[v * VERT_STRIDE + 1]);
  }

  private px(v: number, f: number): number {
    const o = v * VERT_STRIDE;
    return this.v[o] + this.v[o + 3] * f * this.v[o + 5];
  }

  private pz(v: number, f: number): number {
    const o = v * VERT_STRIDE;
    return this.v[o + 2] + this.v[o + 4] * f * this.v[o + 5];
  }

  private segLength(a: number, b: number, f: number): number {
    return Math.hypot(this.px(b, f) - this.px(a, f), this.pz(b, f) - this.pz(a, f));
  }

  /** Clothing, skin, hair and style of one person; headscarves are more common towards Eminönü. */
  private look(colors: Uint8Array, i: number, x: number, z: number, seed: number, kid: boolean): void {
    const h = (k: number): number => hash(seed * 1.618 + k * 7.31 + this.seedCounter * 0.001);
    this.seedCounter++;
    const o = i * PERSON_COLOR_STRIDE;
    const female = h(1) < 0.5;
    const eminonu = z > 2750 ? 1 : 0;
    let style = 0;
    const scarf = female && !kid && h(2) < 0.22 + 0.22 * eminonu;
    if (scarf) {
      style |= Style.Headscarf;
      if (h(3) < 0.5) style |= Style.Coat;
    } else if (female) {
      style |= h(4) < 0.75 ? Style.LongHair | Style.ShortHair : Style.ShortHair;
    } else if (h(5) < 0.92) {
      style |= Style.ShortHair;
    }
    if (h(6) < 0.14) style |= Style.Backpack;
    if (female && !(style & Style.Backpack) && h(7) < 0.35) style |= Style.Handbag;
    if (h(8) < 0.45 || style & Style.Coat) style |= Style.LongSleeves;
    if (h(9) < 0.35) style |= Style.Sneakers;
    const top = rgb(TOPS[Math.floor(h(10) * TOPS.length)]);
    const bottom = rgb(female && h(11) < 0.3 ? TOPS[Math.floor(h(12) * TOPS.length)] : BOTTOMS[Math.floor(h(13) * BOTTOMS.length)]);
    const accent = rgb(ACCENTS[Math.floor(h(14) * ACCENTS.length)]);
    const skin = Math.round(Math.min(1, Math.max(0, 0.3 + (h(15) - 0.5) * 0.5 + (h(16) < 0.08 ? 0.45 : 0))) * 255);
    const hair = Math.round((h(17) < 0.08 ? 0.95 : h(18) * 0.8) * 255);
    colors.set([...top, skin, ...bottom, hair, ...accent, style], o);
  }

  /** Starts group g on a -> b at time t0 (leader and followers), writing the instance attributes. */
  private startSegment(g: number, a: number, b: number, t0: number, pause: boolean, pauseFor = 0): void {
    const f0 = this.lateral[g];
    this.from[g] = a;
    this.to[g] = b;
    this.paused[g] = pause ? 1 : 0;
    const speed = this.speed[g];
    const len = this.segLength(a, b, f0);
    this.startT[g] = t0;
    this.endT[g] = t0 + (pause ? pauseFor : Math.max(0.05, len / speed));
    const first = this.first[g];
    const walkerBase = first - (this.first[0] ?? first);
    for (let k = 0; k < this.members[g]; k++) {
      const i = first + k;
      const m = walkerBase + k;
      const f = Math.max(-1, Math.min(1, f0 + this.memberLat[m] / Math.max(0.5, this.v[a * VERT_STRIDE + 5])));
      const ax = this.px(a, f);
      const az = this.pz(a, f);
      const ay = this.v[a * VERT_STRIDE + 1];
      const bx = this.px(b, f);
      const bz = this.pz(b, f);
      const by = this.v[b * VERT_STRIDE + 1];
      const o = i * PERSON_STRIDE;
      const buf = this.buf;
      // Carry the walk phase over from the previous segment.
      const prevT = buf[o + 3];
      const prevSpeed = Math.hypot(buf[o + 4], buf[o + 6]);
      const hs = buf[o + 11] || 1;
      const phase = buf[o + 7] + (t0 - prevT) * prevSpeed * (Math.PI / (0.74 * hs));
      const dur = this.endT[g] - t0;
      const vx = pause ? 0 : (bx - ax) / dur;
      const vy = pause ? 0 : (by - ay) / dur;
      const vz = pause ? 0 : (bz - az) / dur;
      const yawPrev = buf[o + 8];
      const yaw = pause ? yawPrev : Math.atan2(bx - ax, bz - az);
      const delay = this.memberDelay[m];
      buf[o] = ax;
      buf[o + 1] = ay;
      buf[o + 2] = az;
      buf[o + 3] = t0 + delay;
      buf[o + 4] = vx;
      buf[o + 5] = vy;
      buf[o + 6] = vz;
      buf[o + 7] = Number.isFinite(phase) ? phase % 6283.18 : 0;
      buf[o + 8] = yaw;
      buf[o + 9] = Number.isFinite(yawPrev) ? yawPrev : yaw;
      this.dirty.push(i);
    }
  }

  /** Picks the next vertex after arriving at `b` from `a`: density-weighted, preferring straight on. */
  private next(g: number, a: number, b: number, r: number): number {
    const { start, nbr, weight } = this.graph;
    const v = this.v;
    const dx = v[b * VERT_STRIDE] - v[a * VERT_STRIDE];
    const dz = v[b * VERT_STRIDE + 2] - v[a * VERT_STRIDE + 2];
    const dl = Math.hypot(dx, dz) || 1;
    let sum = 0;
    for (let k = start[b]; k < start[b + 1]; k++) {
      const u = nbr[k];
      if (u === a || !this.valid(u)) {
        continue;
      }
      const ex = v[u * VERT_STRIDE] - v[b * VERT_STRIDE];
      const ez = v[u * VERT_STRIDE + 2] - v[b * VERT_STRIDE + 2];
      const c = (dx * ex + dz * ez) / (dl * (Math.hypot(ex, ez) || 1));
      sum += weight[k] * (0.35 + Math.max(0, c) * 1.6);
    }
    if (sum <= 0) {
      return a;
    }
    let t = r * sum;
    for (let k = start[b]; k < start[b + 1]; k++) {
      const u = nbr[k];
      if (u === a || !this.valid(u)) {
        continue;
      }
      const ex = v[u * VERT_STRIDE] - v[b * VERT_STRIDE];
      const ez = v[u * VERT_STRIDE + 2] - v[b * VERT_STRIDE + 2];
      const c = (dx * ex + dz * ez) / (dl * (Math.hypot(ex, ez) || 1));
      t -= weight[k] * (0.35 + Math.max(0, c) * 1.6);
      if (t <= 0) {
        return u;
      }
    }
    return a;
  }

  update(now: number, camera: THREE.Vector3): void {
    let budget = EVENT_BUDGET;
    while (budget-- > 0 && this.heap.length && this.heap.peekKey() <= now) {
      const g = this.heap.pop();
      const t = this.endT[g];
      const a = this.from[g];
      const b = this.to[g];
      const r = hash(t * 13.37 + g * 0.123);
      if (this.paused[g]) {
        // Resume: the pause kept (a -> b) as the segment still to walk from a.
        this.startSegment(g, a, b, t, false);
      } else if (r < 0.035) {
        this.startSegment(g, b, this.next(g, a, b, hash(r * 91.7)), t, true, 2 + 7 * hash(r * 53.1));
      } else if (r < 0.05) {
        this.startSegment(g, b, a, t, false);
      } else {
        this.startSegment(g, b, this.next(g, a, b, hash(r * 17.3 + 0.5)), t, false);
      }
      this.heap.push(g);
    }
    this.flush();
    this.gatherNear(now, camera);
  }

  /** Copies the instances within the near LOD range (plus a margin) into the near mesh's buffers. */
  private gatherNear(now: number, camera: THREE.Vector3): void {
    const r = NEAR_LOD + 4;
    const r2 = r * r;
    const cx = camera.x;
    const cy = camera.y;
    const cz = camera.z;
    const buf = this.buf;
    const out = this.nearBuf;
    const col = this.colors;
    const outCol = this.nearColors;
    let n = 0;
    for (let i = 0; i < this.count && n < NEAR_CAPACITY; i++) {
      const o = i * PERSON_STRIDE;
      const t = now - buf[o + 3];
      const dx = buf[o] + buf[o + 4] * t - cx;
      const dy = buf[o + 1] + buf[o + 5] * t - cy;
      const dz = buf[o + 2] + buf[o + 6] * t - cz;
      if (dx * dx + dy * dy + dz * dz > r2) {
        continue;
      }
      const q = n * PERSON_STRIDE;
      for (let k = 0; k < PERSON_STRIDE; k++) {
        out[q + k] = buf[o + k];
      }
      const c = i * PERSON_COLOR_STRIDE;
      const qc = n * PERSON_COLOR_STRIDE;
      for (let k = 0; k < PERSON_COLOR_STRIDE; k++) {
        outCol[qc + k] = col[c + k];
      }
      n++;
    }
    const geo = this.geometries[0];
    if (n || geo.instanceCount) {
      this.nearIb.clearUpdateRanges();
      this.nearIb.addUpdateRange(0, Math.max(1, n) * PERSON_STRIDE);
      this.nearIb.needsUpdate = true;
      this.nearCb.clearUpdateRanges();
      this.nearCb.addUpdateRange(0, Math.max(1, n) * PERSON_COLOR_STRIDE);
      this.nearCb.needsUpdate = true;
    }
    geo.instanceCount = n;
    this.stats.near = n;
  }

  /** Uploads the changed instances (sorted and merged into few ranges). */
  private flush(): void {
    const d = this.dirty;
    if (!d.length) {
      return;
    }
    d.sort((p, q) => p - q);
    let s = d[0];
    let e = d[0];
    for (let k = 1; k <= d.length; k++) {
      const i = k < d.length ? d[k] : Infinity;
      if (i - e <= 24) {
        e = i;
        continue;
      }
      this.ib.addUpdateRange(s * PERSON_STRIDE, (e - s + 1) * PERSON_STRIDE);
      s = e = i;
    }
    this.ib.needsUpdate = true;
    d.length = 0;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.group.removeFromParent();
  }
}
