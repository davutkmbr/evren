/**
 * Stamps prop templates (props/models.ts) into one merged, vertex-coloured mesh in the worker: static furniture
 * costs a single draw call however many pieces the slice has.
 */
import type * as THREE from 'three';
import { type StandGround, StandLog, type StandRule, standFault } from '../../../placement/stand';
import { MeshBuf } from '../../shared/buffers';
import type { MeshArrays } from '../../shared/protocol';
import { propTemplates, type PropKind } from './models';

/**
 * Stand rule per prop (src/world/placement/stand.ts): everything stands on land with its base on the ground; the quay
 * edge furniture (mooring posts, lifebuoys) may stand right at the water's edge.
 */
const RULES: Partial<Record<PropKind, StandRule>> = {
  mooring: { shore: 0.3, building: false },
  lifebuoy: { shore: 0.3, building: false },
};
const DEFAULT_RULE: StandRule = { building: false };

/**
 * Feature kits the compiled street tiles have no twin for (props/features.ts): stamped into `kits`, which is drawn
 * through the street layer's hole, so they stand in the landing spots too. Shopfront kits (awnings, pharmacy signs,
 * ATMs, market stalls) stay with `mesh`: the compiled façades carry their own.
 */
export const THROUGH_HOLE: ReadonlySet<PropKind> = new Set<PropKind>([
  'fuelCanopy',
  'fuelPump',
  'fuelShop',
  'fuelSign',
  'goal',
  'basketHoop',
  'swing',
  'slide',
  'climber',
  'shrub',
  'flowers',
  'rock',
  'cesme',
  'fountainBasin',
  'statue',
  'hydrant',
  'tombstone',
  'fitness',
  'hedge',
  'telescope',
  'recycling',
  'bikeRack',
  'metroEntrance',
  'taxiStand',
  'gsmMast',
  'latticeTower',
  'sunbed',
  'beachUmbrella',
  'picnicTable',
  'kameriye',
  'streetClock',
  'infoBoard',
  'billboard',
]);

interface Template {
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
  glow: Float32Array;
  count: number;
}

function flatten(g: THREE.BufferGeometry): Template {
  const src = g.index ? g.toNonIndexed() : g;
  const count = src.getAttribute('position').count;
  return {
    pos: src.getAttribute('position').array as Float32Array,
    nrm: src.getAttribute('normal').array as Float32Array,
    col: src.getAttribute('color').array as Float32Array,
    glow: src.getAttribute('aGlow').array as Float32Array,
    count,
  };
}

export class PropStamper {
  private readonly templates: Record<PropKind, Template>;
  readonly mesh = new MeshBuf({ position: 3, normal: 3, color: 3, aGlow: 1 });
  /** The THROUGH_HOLE kits. */
  readonly kits = new MeshBuf({ position: 3, normal: 3, color: 3, aGlow: 1 });
  readonly counts: Partial<Record<PropKind, number>> = {};
  /** Stand outcomes per kind (build stats). */
  readonly log = new StandLog();

  /** `ground`: every prop must stand on it (RULES); absent, props are taken as placed. */
  constructor(private readonly ground?: StandGround) {
    const t = propTemplates();
    this.templates = {} as Record<PropKind, Template>;
    for (const k of Object.keys(t) as PropKind[]) {
      this.templates[k] = flatten(t[k]);
    }
  }

  /**
   * Places one prop: base at (x, y, z), front (+Z) turned to yaw (world direction (sin yaw, cos yaw)), uniform
   * `scale` (vertical `sy` when given). White template vertices take `tint` (parasol canopies).
   */
  add(kind: PropKind, x: number, y: number, z: number, yaw: number, scale = 1, tint?: [number, number, number], sy = scale): boolean {
    if (this.ground) {
      const fault = standFault(this.ground, x, z, RULES[kind] ?? DEFAULT_RULE, y);
      this.log.note(kind, fault ?? 'kept');
      if (fault) {
        return false;
      }
    }
    const t = this.templates[kind];
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const m = THROUGH_HOLE.has(kind) ? this.kits : this.mesh;
    for (let v = 0; v < t.count; v++) {
      const o = v * 3;
      const px = t.pos[o] * scale;
      const py = t.pos[o + 1] * sy;
      const pz = t.pos[o + 2] * scale;
      const nx = t.nrm[o];
      const ny = t.nrm[o + 1];
      const nz = t.nrm[o + 2];
      let r = t.col[o];
      let g = t.col[o + 1];
      let b = t.col[o + 2];
      if (tint && r > 0.99 && g > 0.99 && b > 0.99) {
        [r, g, b] = tint;
      }
      m.vertex(x + px * c + pz * s, y + py, z - px * s + pz * c, nx * c + nz * s, ny, -nx * s + nz * c, r, g, b, t.glow[v]);
    }
    const base = m.count - t.count;
    for (let v = 0; v < t.count; v += 3) {
      m.tri(base + v, base + v + 1, base + v + 2);
    }
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
    return true;
  }

  take(): MeshArrays | null {
    return this.mesh.count ? this.mesh.take('color') : null;
  }

  takeKits(): MeshArrays | null {
    return this.kits.count ? this.kits.take('color') : null;
  }
}
