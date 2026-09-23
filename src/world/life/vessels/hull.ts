import * as THREE from 'three';
import { Detail, MeshBuilder, surf, type SurfaceSpec } from '../util/mesh-builder';

/**
 * Parametric displacement hull. Model frame: origin at midship on the design (laden) waterline,
 * forward = -Z, starboard = +X. Station parameter t runs 0 (stern) .. 1 (bow), level v 0 (keel) .. 1 (deck edge).
 */
export interface HullSpec {
  length: number;
  beam: number;
  /** Keel to deck edge at midship (m). */
  depth: number;
  /** Design draft (m): the antifouling line sits at model y = 0. */
  draft: number;
  sheerFwd: number;
  sheerAft: number;
  /** Stem rake: horizontal set-back of the stem foot vs. the deck (m). */
  bowRake: number;
  /** Stern overhang: set-back of the keel end vs. the transom top (m). */
  sternOverhang: number;
  /** Transom half-width as a fraction of the half-beam (0 = pointed/cruiser stern). */
  transom: number;
  /** Fraction of the length over which the bow tapers. */
  entrance: number;
  /** Fraction of the length over which the stern tapers. */
  run: number;
  /** Bow waterline fullness exponent (1.3 fine .. 3 blunt). */
  bowFullness: number;
  /** Fraction of the depth over which the bottom turns into the side (0.05 boxy .. 0.6 round). */
  bilge: number;
  /** 0 flat bottom .. 1 deep V. */
  deadrise: number;
  /** Extra deck-level bow fullness (flare) 0..1. */
  flare: number;
  /** Bulbous bow protrusion (m), 0 = none. */
  bulb: number;
  /** Deck camber at the centreline (m). */
  camber: number;
  /** Double-ended (both ends shaped like the bow, e.g. ferries). */
  doubleEnded?: boolean;
  /** Rounded (cruiser) stern in plan instead of a transom. */
  roundStern?: boolean;
}

export interface HullSurfaces {
  side: SurfaceSpec;
  deck: SurfaceSpec;
  transom?: SurfaceSpec;
}

export class HullShape {
  constructor(readonly spec: HullSpec) {}

  sheer(t: number): number {
    const s = this.spec;
    const f = Math.max(0, (t - 0.5) / 0.5);
    const a = Math.max(0, (0.5 - t) / 0.5);
    return s.sheerFwd * f * f + s.sheerAft * a * a;
  }

  /** Deck-edge height (model y) at station t. */
  deckY(t: number): number {
    return -this.spec.draft + this.spec.depth + this.sheer(t);
  }

  /** Height of level v at station t. */
  levelY(t: number, v: number): number {
    return -this.spec.draft + v * (this.spec.depth + this.sheer(t));
  }

  /** Longitudinal position (model z) of station t at level v. */
  stationZ(t: number, v: number): number {
    const s = this.spec;
    const halfL = s.length / 2;
    const vv = THREE.MathUtils.clamp(v, 0, 1);
    let bowZ = -halfL + s.bowRake * Math.pow(1 - vv, 1.2);
    if (s.bulb > 0) {
      const y = this.levelY(1, vv);
      const b = Math.exp(-Math.pow((y + s.draft * 0.62) / (s.draft * 0.26), 2));
      bowZ -= s.bulb * b;
    }
    const sternZ = s.doubleEnded ? halfL - s.bowRake * Math.pow(1 - vv, 1.2) : halfL - s.sternOverhang * Math.pow(1 - vv, 1.6);
    return THREE.MathUtils.lerp(sternZ, bowZ, t);
  }

  /** Station parameter t for a model z at deck level (approximate inverse, deck line). */
  tAtZ(z: number): number {
    const halfL = this.spec.length / 2;
    return THREE.MathUtils.clamp((halfL - z) / this.spec.length, 0, 1);
  }

  /** Half-breadth at station t, level v. */
  halfBreadth(t: number, v: number): number {
    const s = this.spec;
    const hb = s.beam / 2;
    const vv = THREE.MathUtils.clamp(v, 0, 1);
    let plan = 1;
    const fwdStart = 1 - s.entrance;
    if (t > fwdStart) {
      const f = (1 - t) / s.entrance;
      const p = THREE.MathUtils.lerp(s.bowFullness, s.bowFullness + 1.4 * s.flare, THREE.MathUtils.smoothstep(vv, 0.35, 1));
      plan = 1 - Math.pow(1 - f, p);
    }
    const aftEnd = s.doubleEnded ? s.entrance : s.run;
    if (t < aftEnd) {
      const a = t / aftEnd;
      if (s.doubleEnded) {
        const p = THREE.MathUtils.lerp(s.bowFullness, s.bowFullness + 1.4 * s.flare, THREE.MathUtils.smoothstep(vv, 0.35, 1));
        plan = Math.min(plan, 1 - Math.pow(1 - a, p));
      } else if (s.roundStern) {
        plan = Math.min(plan, Math.pow(Math.max(1 - (1 - a) * (1 - a), 0), 0.5));
      } else {
        const tr = s.transom * THREE.MathUtils.smoothstep(vv, 0.25, 0.85);
        const shaped = 1 - Math.pow(1 - a, 2.2);
        plan = Math.min(plan, tr + (1 - tr) * shaped);
      }
    }
    const k = THREE.MathUtils.lerp(2.6, 1.0, s.deadrise);
    const section = 1 - Math.pow(1 - THREE.MathUtils.clamp(vv / Math.max(s.bilge, 1e-3), 0, 1), k);
    return hb * Math.max(plan, 0) * section;
  }

  /** Deck half-breadth at model z (for placing deck gear). */
  deckHalfBreadthAtZ(z: number): number {
    return this.halfBreadth(this.tAtZ(z), 1);
  }

  deckYAtZ(z: number): number {
    return this.deckY(this.tAtZ(z));
  }
}

function levels(count: number): number[] {
  const out: number[] = [];
  for (let j = 0; j <= count; j++) {
    const u = j / count;
    // Denser towards the bilge (bottom) where the section curves.
    out.push(Math.pow(u, 1.35));
  }
  return out;
}

/** Emits a closed hull (sides, deck, transom) into the builder. `stations`/`nLevels` control tessellation. */
export function buildHull(b: MeshBuilder, shape: HullShape, surfaces: HullSurfaces, stations = 28, nLevels = 7): void {
  const s = shape.spec;
  const vs = levels(nLevels);
  const nt = stations;
  const ts: number[] = [];
  for (let i = 0; i <= nt; i++) {
    // Denser at the ends where the plan curves.
    const u = i / nt;
    ts.push(THREE.MathUtils.lerp(u, 0.5 - 0.5 * Math.cos(u * Math.PI), 0.6));
  }
  ts[0] = 0;
  ts[nt] = 1;

  const P: THREE.Vector3[][] = [];
  for (let i = 0; i <= nt; i++) {
    const row: THREE.Vector3[] = [];
    for (let j = 0; j < vs.length; j++) {
      const t = ts[i];
      const v = vs[j];
      row.push(new THREE.Vector3(shape.halfBreadth(t, v), shape.levelY(t, v), shape.stationZ(t, v)));
    }
    P.push(row);
  }

  const normalAt = (i: number, j: number, out: THREE.Vector3): THREE.Vector3 => {
    const i0 = Math.max(i - 1, 0);
    const i1 = Math.min(i + 1, nt);
    const j0 = Math.max(j - 1, 0);
    const j1 = Math.min(j + 1, vs.length - 1);
    const du = new THREE.Vector3().subVectors(P[i1][j], P[i0][j]);
    const dv = new THREE.Vector3().subVectors(P[i][j1], P[i][j0]);
    // Starboard side: outward normal = du x dv (stations go forward = -Z, levels go up).
    out.crossVectors(du, dv);
    if (out.lengthSq() < 1e-10) out.set(1, 0, 0);
    return out.normalize();
  };

  const n = new THREE.Vector3();
  for (const side of [1, -1]) {
    const base = b.vertexCount;
    for (let i = 0; i <= nt; i++) {
      for (let j = 0; j < vs.length; j++) {
        const p = P[i][j];
        normalAt(i, j, n);
        b.vertex(p.x * side, p.y, p.z, n.x * side, n.y, n.z, surfaces.side);
      }
    }
    const w = vs.length;
    for (let i = 0; i < nt; i++) {
      for (let j = 0; j < w - 1; j++) {
        const a = base + i * w + j;
        const c = base + (i + 1) * w + j;
        if (side > 0) {
          b.tri(a, c, c + 1);
          b.tri(a, c + 1, a + 1);
        } else {
          b.tri(a, c + 1, c);
          b.tri(a, a + 1, c + 1);
        }
      }
    }
  }

  // Deck with camber: port edge -> centre -> starboard edge per station.
  const top = vs.length - 1;
  const deckBase = b.vertexCount;
  for (let i = 0; i <= nt; i++) {
    const p = P[i][top];
    b.vertex(-p.x, p.y, p.z, 0, 1, 0, surfaces.deck);
    b.vertex(0, p.y + s.camber * Math.min(1, p.x / (s.beam * 0.5)), p.z, 0, 1, 0, surfaces.deck);
    b.vertex(p.x, p.y, p.z, 0, 1, 0, surfaces.deck);
  }
  for (let i = 0; i < nt; i++) {
    const a = deckBase + i * 3;
    const c = a + 3;
    b.tri(a, a + 1, c + 1);
    b.tri(a, c + 1, c);
    b.tri(a + 1, a + 2, c + 2);
    b.tri(a + 1, c + 2, c + 1);
  }

  // Transom (stern face at t = 0).
  if (!s.doubleEnded && !s.roundStern && s.transom > 0) {
    const ts0 = surfaces.transom ?? surfaces.side;
    const tb = b.vertexCount;
    for (let j = 0; j < vs.length; j++) {
      const p = P[0][j];
      b.vertex(-p.x, p.y, p.z, 0, 0, 1, ts0);
      b.vertex(p.x, p.y, p.z, 0, 0, 1, ts0);
    }
    for (let j = 0; j < vs.length - 1; j++) {
      const a = tb + j * 2;
      b.tri(a, a + 1, a + 3);
      b.tri(a, a + 3, a + 2);
    }
  }
}

/** Standard steel hull surfaces: instance-painted plating and a coloured deck. */
export function steelHull(deckHex: number, deckRough = 0.8): HullSurfaces {
  return {
    side: surf(0xffffff, { paint: 1, roughness: 0.55, metalness: 0.15, detail: Detail.Hull }),
    deck: surf(deckHex, { roughness: deckRough, metalness: 0.1, detail: Detail.Deck }),
  };
}
