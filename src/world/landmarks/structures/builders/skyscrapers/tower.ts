/**
 * Generic skyscraper generator: glass curtain-wall shaft extruded from a floor plan (optional taper, setbacks and a
 * slanted roof plane), podium, rooftop plant, and crowns (vertical fins, pyramid, spire). The curtain wall goes into
 * the glass batch (procedural mullions/spandrels/lit offices in the shader), everything else is opaque.
 */
import * as THREE from 'three';
import type { StructureBuild } from '../../build/context';
import type { MeshBuilder, SurfaceState } from '../../build/mesh-builder';
import { Emit, LedGroup, Surf } from '../../build/surfaces';
import { Color, glassMat, mat, withEmit } from '../palette';
import { makePlan, planExtent, type Plan, type PlanShape } from './plans';

export type CrownSpec =
  | { kind: 'flat'; plant?: boolean }
  | { kind: 'slant'; /** roof height at the low end as a fraction of the roof height */ low: number }
  | { kind: 'fins'; height: number; spacing: number; depth: number; light?: 'glow' | 'led'; ledGroup?: number }
  | { kind: 'pyramid'; height: number }
  | { kind: 'stepped'; steps: number; stepHeight: number; inset: number };

export interface TowerSpec {
  /** Total architectural height (including crown and spire). */
  height: number;
  plan: PlanShape;
  /** Plan rotation (degrees, compass-like: 0 = plan x axis points east, positive clockwise from above). */
  rotation: number;
  /** Plan scale at the roof (1 = prismatic). */
  taper?: number;
  facade: number;
  tint: number;
  floor?: number;
  bay?: number;
  crown: CrownSpec;
  spire?: number;
  /** Crown lighting on the glass (Emit.Crown): colour index, intensity, height below the roof where it starts. */
  crownLight?: { color: number; intensity: number; depth: number };
  podium?: { w: number; d: number; h: number };
}

const PODIUM = mat(0x9d9a92, Surf.Concrete, 0.8, 0, 4.5);
const PLANT = mat(0x8b8f90, Surf.Steel, 0.6, 0.2, 3);
const SPIRE = mat(0xb9bec0, Surf.Steel, 0.35, 0.8, 0);

function rotated(p: Plan, rotDeg: number, cx: number, cz: number, scale = 1): Plan {
  const a = (rotDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return p.map(([x, z]) => [cx + (x * c - z * s) * scale, cz + (x * s + z * c) * scale]);
}

/** Wall ring at height y from a world-space plan. */
function ring(p: Plan, y: number | ((x: number, z: number) => number)): THREE.Vector3[] {
  return p.map(([x, z]) => new THREE.Vector3(x, typeof y === 'number' ? y : y(x, z), z));
}

export interface TowerResult {
  roof: number;
  top: number;
  radius: number;
}

/**
 * Builds one tower standing on the terrain at (x, z). Returns the absolute roof and top heights.
 */
export function buildTower(b: StructureBuild, x: number, z: number, spec: TowerSpec, seed: number): TowerResult {
  const basePlanDetail = makePlan(spec.plan, 1);
  const extent = planExtent(basePlanDetail);
  let ground = Infinity;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ground = Math.min(ground, b.ground(x + Math.cos(a) * extent, z + Math.sin(a) * extent));
  }
  ground = Math.min(ground, b.ground(x, z));
  const y0 = ground - 1;
  const crown = spec.crown;
  const spire = spec.spire ?? 0;
  const crownH = crown.kind === 'fins' ? crown.height : crown.kind === 'pyramid' ? crown.height : 0;
  const roofAbs = y0 + 1 + spec.height - spire - (crown.kind === 'fins' ? crown.height * 0.85 : crownH);
  const floor = spec.floor ?? 4.0;
  const bay = spec.bay ?? 1.5;
  const glass: SurfaceState = spec.crownLight
    ? { ...glassMat(spec.tint, spec.facade, floor, bay, seed), emit: Emit.Crown, ea: roofAbs - y0 - spec.crownLight.depth, eb: spec.crownLight.color, ec: spec.crownLight.intensity }
    : glassMat(spec.tint, spec.facade, floor, bay, seed);
  const taper = spec.taper ?? 1;
  const podiumH = spec.podium?.h ?? 0;

  // curtain wall
  b.glass(
    (mb, lod) => {
      const plan = makePlan(spec.plan, lod === 0 ? 1 : 0.35);
      const bottom = rotated(plan, spec.rotation, x, z);
      const topPlan = rotated(plan, spec.rotation, x, z, taper);
      mb.vBase = y0;
      mb.surface(glass);
      const curved = spec.plan.kind === 'rounded' || spec.plan.kind === 'ellipse' || spec.plan.kind === 'lens' || spec.plan.kind === 'triangle';
      let roofFn: number | ((px: number, pz: number) => number) = roofAbs;
      if (crown.kind === 'slant') {
        const a = (spec.rotation * Math.PI) / 180;
        const ax = Math.cos(a);
        const az = Math.sin(a);
        const hw = extent;
        roofFn = (px, pz) => {
          const t = ((px - x) * ax + (pz - z) * az) / hw;
          return roofAbs - (roofAbs - y0) * (1 - crown.low) * (0.5 - 0.5 * t);
        };
      }
      if (crown.kind === 'stepped') {
        let yA = y0 + podiumH * 0.5;
        const stepTotal = crown.steps * crown.stepHeight;
        const mainTop = roofAbs - stepTotal;
        mb.loft([ring(bottom, yA), ring(topPlan, mainTop)], { closed: true, smooth: curved, hardAngleDeg: 40, vMode: 'y' });
        yA = mainTop;
        for (let s = 1; s <= crown.steps; s++) {
          const sc = taper * (1 - crown.inset * s);
          const p = rotated(plan, spec.rotation, x, z, sc);
          const yB = yA + crown.stepHeight;
          mb.loft([ring(p, yA), ring(p, yB)], { closed: true, smooth: curved, hardAngleDeg: 40, vMode: 'y' });
          // setback terrace
          const prev = rotated(plan, spec.rotation, x, z, taper * (1 - crown.inset * (s - 1)));
          mb.surface(PLANT);
          mb.loft([ring(prev, yA), ring(p, yA)], { closed: true, vMode: 'length' });
          mb.surface(glass);
          yA = yB;
        }
        mb.surface(mat(0x7c8083, Surf.Plain, 0.7));
        mb.polygon(ring(rotated(plan, spec.rotation, x, z, taper * (1 - crown.inset * crown.steps)), yA), new THREE.Vector3(0, 1, 0));
      } else {
        const levels = taper !== 1 ? (lod === 0 ? 6 : 2) : 1;
        const rings: THREE.Vector3[][] = [];
        for (let i = 0; i <= levels; i++) {
          const t = i / levels;
          const sc = 1 + (taper - 1) * t;
          const p = rotated(plan, spec.rotation, x, z, sc);
          const yb = y0 + podiumH * 0.5;
          rings.push(
            ring(p, (px, pz) => {
              const top = typeof roofFn === 'number' ? roofFn : roofFn(px, pz);
              return yb + (top - yb) * t;
            }),
          );
        }
        mb.loft(rings, { closed: true, smooth: curved, hardAngleDeg: 40, vMode: 'y' });
        // roof slab (possibly slanted)
        mb.surface(mat(0x6e7275, Surf.Plain, 0.75));
        mb.polygonOutward(rings[rings.length - 1], new THREE.Vector3(x, y0, z));
      }
      mb.vBase = 0;
    },
    { detailScale: 1.3 },
  );

  // podium, plant, crown, spire
  b.opaque(
    (mb, lod) => {
      mb.vBase = y0;
      if (spec.podium) {
        const pp = rotated(makePlan({ kind: 'rect', w: spec.podium.w, d: spec.podium.d, chamfer: 2 }, 1), spec.rotation, x, z);
        mb.surface(PODIUM);
        mb.prismRing(pp, y0, y0 + podiumH, 0, false, true);
        if (lod === 0) {
          mb.surface({ ...mat(0x20282c, Surf.Window, 0.1), emit: Emit.Windows, ea: 2.5, eb: seed, ec: 0.8 });
          const band = rotated(makePlan({ kind: 'rect', w: spec.podium.w + 0.1, d: spec.podium.d + 0.1, chamfer: 2 }, 1), spec.rotation, x, z);
          mb.prismRing(band, y0 + 1.3, y0 + Math.min(podiumH - 1, 5.5), 0, false, false);
        }
      }
      const plan = makePlan(spec.plan, lod === 0 ? 1 : 0.35);
      const roofPlan = rotated(plan, spec.rotation, x, z, taper);
      if (crown.kind === 'flat' && crown.plant !== false) {
        const p = rotated(plan, spec.rotation, x, z, taper * 0.55);
        mb.surface(PLANT);
        mb.prismRing(p, roofAbs, roofAbs + 5.5, 0, false, true);
        const parapet = rotated(plan, spec.rotation, x, z, taper * 1.002);
        mb.surface(mat(0x9fa3a5, Surf.Steel, 0.45, 0.5, 0));
        mb.prismRing(parapet, roofAbs, roofAbs + 1.4, 0, false, false);
      }
      if (crown.kind === 'fins') {
        const light =
          crown.light === 'led'
            ? withEmit(mat(0xdfe3e4, Surf.Steel, 0.4, 0.3, 0), Emit.Led, crown.ledGroup ?? LedGroup.Skyland, 0.5, 1.4)
            : crown.light === 'glow'
              ? withEmit(mat(0xdfe3e4, Surf.Steel, 0.4, 0.3, 0), Emit.Glow, 4)
              : mat(0xcfd3d4, Surf.Steel, 0.4, 0.5, 0);
        mb.surface(light);
        // fins distributed along the roof perimeter
        const perim: number[] = [0];
        for (let i = 0; i < roofPlan.length; i++) {
          const [ax, az] = roofPlan[i];
          const [bx, bz] = roofPlan[(i + 1) % roofPlan.length];
          perim.push(perim[i] + Math.hypot(bx - ax, bz - az));
        }
        const total = perim[perim.length - 1];
        const n = Math.max(8, Math.round(total / crown.spacing));
        for (let k = 0; k < n; k++) {
          const d = (k / n) * total;
          let i = 0;
          while (perim[i + 1] < d) {
            i++;
          }
          const t = (d - perim[i]) / (perim[i + 1] - perim[i]);
          const [ax, az] = roofPlan[i];
          const [bx, bz] = roofPlan[(i + 1) % roofPlan.length];
          const px = ax + (bx - ax) * t;
          const pz = az + (bz - az) * t;
          const tx = bx - ax;
          const tz = bz - az;
          const yaw = Math.atan2(-tz, tx) + Math.PI / 2;
          const h = crown.height * (0.75 + 0.25 * Math.cos((k / n) * Math.PI * 4));
          mb.box(px, roofAbs - 2 + h / 2, pz, crown.depth / 2, h / 2, 0.18, yaw, true, false);
        }
        if (lod === 0) {
          mb.surface(PLANT);
          mb.prismRing(rotated(plan, spec.rotation, x, z, taper * 0.6), roofAbs, roofAbs + 7, 0, false, true);
        }
      }
      if (crown.kind === 'pyramid') {
        mb.surface(mat(0xa3b3b8, Surf.Steel, 0.3, 0.8, 0));
        const apex = new THREE.Vector3(x, roofAbs + crown.height, z);
        const inside = new THREE.Vector3(x, roofAbs + crown.height * 0.3, z);
        for (let i = 0; i < roofPlan.length; i++) {
          const [ax, az] = roofPlan[i];
          const [bx, bz] = roofPlan[(i + 1) % roofPlan.length];
          mb.polygonOutward([new THREE.Vector3(ax, roofAbs, az), new THREE.Vector3(bx, roofAbs, bz), apex], inside);
        }
      }
      if (spire > 0) {
        const base = crown.kind === 'pyramid' ? roofAbs + crown.height * 0.7 : crown.kind === 'fins' ? roofAbs : roofAbs + 5;
        const top = y0 + 1 + spec.height;
        mb.surface(SPIRE);
        mb.cylinder(x, base, z, Math.min(1.6, spire * 0.03 + 0.4), 0.12, top - base, lod === 0 ? 10 : 5, true, false);
      }
      mb.vBase = 0;
    },
    { detailScale: 1.3 },
  );

  const top = y0 + 1 + spec.height;
  // aviation obstruction lights (ICAO): flashing red on top, steady red at intermediate levels on tall towers
  const phase = (seed * 0.137) % 1;
  b.lights.aviation(new THREE.Vector3(x, top + 0.4, z), phase, 1.5, spec.height > 200 ? 1.3 : 1);
  if (spec.height > 150) {
    const corners = roofPlan4(makePlan(spec.plan, 0.35), spec.rotation, x, z, taper);
    for (const [cx, cz] of corners) {
      b.lights.obstruction(new THREE.Vector3(cx, roofAbs + 1.6, cz));
      b.lights.obstruction(new THREE.Vector3(x + (cx - x) * (1 + (1 - taper) * 0.5), y0 + (roofAbs - y0) * 0.5, z + (cz - z) * (1 + (1 - taper) * 0.5)));
    }
  }
  if (spire > 0) {
    b.wires.add(new THREE.Vector3(x, top - spire * 0.4, z), new THREE.Vector3(x, top, z), 0.08, Color.mast, { fade: [4000, 8000] });
  }
  // colliders: shaft as a vertical cylinder (or box for slabs), crown/spire as a thin cylinder
  const r = extent * (1 + taper) * 0.5;
  b.cylinderCollider(x, y0, z, r, roofAbs - y0);
  if (top - roofAbs > 3) {
    b.cylinderCollider(x, roofAbs, z, Math.max(1.2, crown.kind === 'fins' ? r : 2), top - roofAbs);
  }
  return { roof: roofAbs, top, radius: extent };
}

function roofPlan4(plan: Plan, rot: number, x: number, z: number, scale: number): Plan {
  const p = rotated(plan, rot, x, z, scale);
  const step = Math.max(1, Math.floor(p.length / 4));
  return [p[0], p[step % p.length], p[(2 * step) % p.length], p[(3 * step) % p.length]];
}
