import { mat, withFlood, type Mat } from '../mesh-builder';
import { edgeNormal, obb, type V2 } from '../geom';
import { Facade, Palette, Surf, type RGB } from '../surfaces';
import type { SiteContext } from '../site';
import { samplePath, curtainWall, type WallSample } from '../prims/fort';
import { alem, balustrade, dome, lampPost } from '../prims/details';
import { lathe } from '../prims/basic';
import { building, type BuildingSpec } from '../prims/building';

/** Shared material presets (surface, tint, weathering, floodlight). */
export const M = {
  marble: mat(Surf.Marble, Palette.marbleWhite, 0.3, 1),
  marbleWarm: mat(Surf.Marble, Palette.marbleWarm, 0.35, 1),
  stucco: mat(Surf.Stucco, Palette.marbleWhite, 0.3, 0.9),
  ashlar: mat(Surf.Ashlar, Palette.limestone, 0.5, 0.9),
  ashlarLight: mat(Surf.Ashlar, Palette.limestoneLight, 0.45, 0.9),
  ashlarGrey: mat(Surf.Ashlar, Palette.limestoneGrey, 0.6, 0.8),
  rubble: mat(Surf.Rubble, Palette.rubbleGrey, 0.6, 1),
  byzantine: mat(Surf.Byzantine, Palette.byzantineStone, 0.6, 0.8),
  brick: mat(Surf.Brick, Palette.brick, 0.5, 0.7),
  plasterWhite: mat(Surf.Plaster, Palette.plasterWhite, 0.4, 0.85),
  plasterCream: mat(Surf.Plaster, Palette.plasterCream, 0.45, 0.85),
  plasterOchre: mat(Surf.Plaster, Palette.plasterOchre, 0.5, 0.85),
  lead: mat(Surf.Lead, Palette.lead, 0.5, 0.12),
  slate: mat(Surf.Slate, Palette.slate, 0.4, 0.1),
  tile: mat(Surf.Tile, Palette.tile, 0.5, 0.1),
  wood: mat(Surf.Wood, Palette.woodBrown, 0.5, 0.35),
  woodDark: mat(Surf.Wood, Palette.woodDark, 0.5, 0.3),
  gold: mat(Surf.Gold, Palette.gold, 0.1, 0.6),
  bronze: mat(Surf.Bronze, Palette.bronze, 0.5, 0.6),
  iron: mat(Surf.Iron, Palette.iron, 0.4, 0.3),
  railing: mat(Surf.Railing, Palette.iron, 0.3, 0.3),
  void: mat(Surf.Void, Palette.voidDark, 0, 0),
  paving: mat(Surf.Paving, Palette.paving, 0.5, 0.2),
  earth: mat(Surf.Earth, Palette.earth, 0.5, 0),
  lamp: mat(Surf.Lamp, Palette.lamp, 0, 0),
  balustrade: mat(Surf.Balustrade, Palette.marbleWhite, 0.3, 0.9),
  granite: mat(Surf.Granite, Palette.granitePink, 0.3, 1),
  glass: mat(Surf.Glass, [0.04, 0.045, 0.05], 0.2, 0),
  clock: mat(Surf.Clock, Palette.white, 0.2, 0.2),
} as const;

export function tint(m: Mat, color: RGB, flood = m.flood): Mat {
  return { ...m, color, flood };
}

export function dim(m: Mat, flood: number): Mat {
  return withFlood(m, flood);
}

/** Heading (compass degrees) of the long axis of a ring. */
export function ringHeading(ring: readonly V2[]): number {
  const b = obb(ring);
  return ((Math.atan2(Math.cos(b.angle), -Math.sin(b.angle)) * 180) / Math.PI + 360) % 360;
}

/**
 * Coastline runs within `radius` of (cx, cz), each a polyline with the water on its right-hand side
 * (land rings are counter-clockwise).
 */
export function coastRuns(ctx: SiteContext, cx: number, cz: number, radius: number): V2[][] {
  // Coastline vertices can lie hundreds of metres apart: resample every segment (COAST_STEP) before clipping to the
  // circle, so a quay follows the shore across the whole radius.
  const COAST_STEP = 6;
  const runs: V2[][] = [];
  const r2 = radius * radius;
  for (const line of ctx.coastlines) {
    let run: V2[] = [];
    const visit = (p: V2): void => {
      if ((p[0] - cx) ** 2 + (p[1] - cz) ** 2 <= r2) {
        run.push(p);
      } else if (run.length) {
        if (run.length > 1) {
          runs.push(run);
        }
        run = [];
      }
    };
    for (let i = 0; i < line.length; i++) {
      const a = line[i];
      visit(a);
      const b = line[i + 1];
      if (!b) {
        break;
      }
      const n = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / COAST_STEP);
      for (let k = 1; k < n; k++) {
        visit([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      }
    }
    if (run.length > 1) {
      runs.push(run);
    }
  }
  return runs;
}

export interface QuaySpec {
  /** Quay top above sea level (m). */
  top: number;
  thick: number;
  mat: Mat;
  topMat: Mat;
  /** Balustrade or railing on the quay edge. */
  rail?: 'balustrade' | 'railing' | null;
  railH?: number;
  lamps?: number;
}

/** Stone quay wall along the coastline runs (water side = right). */
export function quay(ctx: SiteContext, runs: readonly V2[][], q: QuaySpec): void {
  for (const run of runs) {
    const smp = samplePath(run, 6, () => 0);
    curtainWall(
      ctx.mb,
      smp,
      {
        thick: q.thick,
        height: (s: WallSample) => Math.max(q.top, ctx.groundOrSea(s.x - s.mx * 4, s.z - s.mz * 4) + 0.2) - s.ground,
        sink: 3,
        outer: q.mat,
        inner: q.mat,
        top: q.topMat,
        caps: true,
      },
      ctx.lod,
    );
    if (ctx.lod === 0 && q.rail) {
      const off = q.thick / 2 - 0.2;
      for (let i = 0; i < run.length - 1; i++) {
        const a = run[i];
        const b = run[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.5) {
          continue;
        }
        const nx = -(b[1] - a[1]) / len;
        const nz = (b[0] - a[0]) / len;
        const pa: V2 = [a[0] + nx * off, a[1] + nz * off];
        const pb: V2 = [b[0] + nx * off, b[1] + nz * off];
        if (q.rail === 'balustrade') {
          balustrade(ctx.mb, pa, pb, q.top, q.railH ?? 1.0, M.balustrade, M.marble);
        } else {
          balustrade(ctx.mb, pa, pb, q.top, q.railH ?? 1.1, M.railing, M.iron);
        }
      }
      if (q.lamps && q.lamps > 0) {
        for (const p of smp) {
          if (Math.round(p.s / q.lamps) !== Math.round((p.s - 6) / q.lamps)) {
            const off2 = q.thick / 2 - 0.5;
            lampPost(ctx.mb, p.x + p.mx * off2, p.z + p.mz * off2, q.top, 3.6, M.iron, M.lamp);
          }
        }
      }
    }
  }
}

export interface FootprintOptions extends Omit<BuildingSpec, 'ring' | 'base' | 'foundation'> {
  /** Fixed ground-floor level; default: highest ground under the footprint. */
  base?: number;
  /** Collider (default true). */
  collide?: boolean;
}

/** Building on a footprint ring standing on the terrain, with an OBB collider. Returns the roof top. */
export function footprintBuilding(ctx: SiteContext, ring: readonly V2[], o: FootprintOptions): number {
  const gr = ctx.groundRange(ring);
  const base = o.base ?? gr.max;
  const top = building(ctx.mb, { ...o, ring, base, foundation: Math.min(gr.min, base) - 1.5 }, ctx.lod);
  if (o.collide !== false) {
    const b = obb(ring);
    ctx.boxCollider(b.cx, b.cz, b.len, b.wid, b.angle, gr.min - 1, base + o.wallH);
  }
  return top;
}

/** Nearest point on the coast runs and the outward (water side) normal there. */
export function nearestOnRuns(runs: readonly V2[][], p: V2): [V2, V2] | null {
  let best: [V2, V2] | null = null;
  let bd = Infinity;
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) {
      const a = run[i];
      const b = run[i + 1];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
      const q: V2 = [a[0] + dx * t, a[1] + dz * t];
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
      if (d < bd) {
        bd = d;
        best = [q, edgeNormal(a, b)];
      }
    }
  }
  return best;
}

export interface DomeRowOptions {
  /** Number of domes along the long axis (and rows across). */
  count: number;
  rows?: number;
  /** Max dome radius (m). */
  rMax: number;
  /** Drum height (m). */
  drum?: number;
  drumMat?: Mat;
  mat?: Mat;
  alem?: number;
  /** Offset of the dome row across the building (fraction of the width, -0.5..0.5). */
  across?: number;
  rise?: number;
}

/** Domes laid out along the long axis of a footprint, standing on a flat roof at y. Returns the tallest crown. */
export function domeRow(ctx: SiteContext, ring: readonly V2[], y: number, o: DomeRowOptions): number {
  const b = obb(ring);
  const ax: V2 = [Math.cos(b.angle), Math.sin(b.angle)];
  const sd: V2 = [-ax[1], ax[0]];
  const rows = o.rows ?? 1;
  const cellL = b.len / o.count;
  const cellW = b.wid / rows;
  const r = Math.min(o.rMax, cellL / 2 - 0.4, cellW / 2 - 0.4);
  let top = y;
  if (r < 0.8) {
    return top;
  }
  for (let i = 0; i < o.count; i++) {
    for (let j = 0; j < rows; j++) {
      const l = -b.len / 2 + cellL * (i + 0.5);
      const s = -b.wid / 2 + cellW * (j + 0.5) + (o.across ?? 0) * b.wid;
      const x = b.cx + ax[0] * l + sd[0] * s;
      const z = b.cz + ax[1] * l + sd[1] * s;
      const crown = dome(
        ctx.mb,
        x,
        z,
        y,
        {
          r,
          rise: o.rise ?? r * 0.85,
          mat: o.mat ?? M.lead,
          drum: o.drum ? { h: o.drum, sides: r > 4 ? 12 : 8, mat: o.drumMat ?? M.plasterWhite } : null,
          alem: o.alem ?? 0,
          alemMat: M.gold,
        },
        ctx.lod,
      );
      top = Math.max(top, crown);
    }
  }
  return top;
}

export interface HallOptions {
  wallH: number;
  wall?: Mat;
  facade?: number | null;
  roof?: FootprintOptions['roof'];
  roofMat?: Mat;
  overhang?: number;
  pitch?: number;
  plinth?: number;
  base?: number;
}

/** Ottoman building: stone or plastered walls, lead hip roof with deep timber eaves. Returns the eave height. */
export function ottomanHall(ctx: SiteContext, ring: readonly V2[], o: HallOptions): number {
  const gr = ctx.groundRange(ring);
  const base = o.base ?? gr.max;
  footprintBuilding(ctx, ring, {
    base,
    wallH: o.wallH,
    wall: o.wall ?? M.ashlarLight,
    facade: o.facade === undefined ? Facade.OttomanHall : o.facade,
    plinth: o.plinth ?? 0.6,
    plinthMat: M.ashlar,
    roof: o.roof ?? 'hip',
    roofMat: o.roofMat ?? M.lead,
    pitchDeg: o.pitch ?? 21,
    overhang: o.overhang ?? 1.3,
    soffitMat: M.wood,
  });
  return base + o.wallH;
}

/** Slender Ottoman minaret (small mosques): shaft, şerefe balcony, lead cone. */
export function minaret(ctx: SiteContext, x: number, z: number, g: number, h: number, r: number): void {
  const mb = ctx.mb;
  lathe(mb, x, z, [[r * 1.25, g - 1], [r * 1.25, g + h * 0.18], [r, g + h * 0.2], [r * 0.92, g + h * 0.7]], M.ashlarLight, { seg: 12, flat: true, crease: 0.3 });
  lathe(mb, x, z, [[r * 0.92, g + h * 0.7], [r * 1.55, g + h * 0.73], [r * 1.55, g + h * 0.75], [r * 0.85, g + h * 0.76], [r * 0.8, g + h * 0.86]], M.stucco, { seg: 12, flat: true, crease: 0.3 });
  lathe(mb, x, z, [[r * 0.95, g + h * 0.86], [0, g + h]], M.lead, { seg: 12, flat: true });
  if (ctx.lod === 0) {
    alem(mb, x, z, g + h - 0.1, 1.2, M.gold);
  }
  ctx.collider({ kind: 'cylinder', x, y: g - 1, z, r: r * 1.3, h: h + 1 });
}

/**
 * The two front corners of a footprint facing `dir`: the ends of the side of its oriented bounding box whose outward
 * normal is closest to `dir` (rounded or chamfered corners in the outline do not matter), pulled `inset` m in along
 * that side.
 */
export function frontCorners(ring: readonly V2[], dir: V2, inset = 0): [V2, V2] {
  const b = obb(ring);
  const ax: V2 = [Math.cos(b.angle), Math.sin(b.angle)];
  const sd: V2 = [-ax[1], ax[0]];
  const sides: { n: V2; t: V2; depth: number; half: number }[] = [
    { n: ax, t: sd, depth: b.len / 2, half: b.wid / 2 },
    { n: [-ax[0], -ax[1]], t: sd, depth: b.len / 2, half: b.wid / 2 },
    { n: sd, t: ax, depth: b.wid / 2, half: b.len / 2 },
    { n: [-sd[0], -sd[1]], t: ax, depth: b.wid / 2, half: b.len / 2 },
  ];
  const f = sides.reduce((best, s) => (s.n[0] * dir[0] + s.n[1] * dir[1] > best.n[0] * dir[0] + best.n[1] * dir[1] ? s : best));
  const mx = b.cx + f.n[0] * f.depth;
  const mz = b.cz + f.n[1] * f.depth;
  const h = f.half - inset;
  return [
    [mx - f.t[0] * h, mz - f.t[1] * h],
    [mx + f.t[0] * h, mz + f.t[1] * h],
  ];
}
