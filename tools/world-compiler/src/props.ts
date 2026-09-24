/**
 * Props (format 1): models that tiles place as instances. Each prop is processed once per compile into
 * <out>/props/<id>.glb (plain glTF 2.0, external shared textures under ../textures/) and listed in index.props with
 * its variants (root node names), bounds, draw distance and per-instance light template.
 *
 * Sources: approved models (tools/assets/approved.json, cached in assets-src/model/<id>/; skipped while not
 * downloaded or while a condition is unmet, see textures.ts) and procedural stand-ins built here (neutral
 * mannequins until MetaHuman crowds exist, lamp masts of the Kadıköy street lighting classes).
 *
 * Conventions: metres, +Y up, the foot of the prop at the origin, the prop's front / reach along +Z (headingYaw()).
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Document, getBounds, type Material, NodeIO } from '@gltf-transform/core';
import type { PropRec, XYZ } from './format';
import { createMaterial, ExternalTextures, externalizeImages, GENERATOR_V1, TEXTURE_URI } from './gltf';
import { kelvinToRgb, lightRange, pointCandela, spotCandela } from './lights';
import { type EmissiveDef, linearRgb, type MaterialDef, type MaterialName } from './materials';
import { TileMesh, type Vec3 } from './mesh';
import { approvedAssets, assetDir, type AssetCredit, CACHE_DIR, conditionStatus, type TextureBaker } from './textures';

export interface PropLight {
  type: 'point' | 'spot';
  /** Prop-local position, or 'emissive': the centre of the parts with emissive materials. */
  position: XYZ | 'emissive';
  /** Prop-local direction (spot). */
  direction?: XYZ;
  kelvin: number;
  lumens: number;
  cone?: { inner: number; outer: number };
  night: boolean;
  source: 'lamp' | 'sign' | 'window' | 'interior' | 'other';
}

export interface PropBuilder {
  /** A variant (root node) made of registry-material meshes, emitted through a TileMesh at the origin. */
  variant(name: string, build: (mesh: TileMesh) => void): void;
}

export interface PropDef {
  id: string;
  /** Approved model (approved.json, kind 'model'). */
  asset?: string;
  /** Procedural prop. */
  build?: (b: PropBuilder) => void;
  /** Scale applied to the source model (e.g. 0.1 for one authored ten times too large). */
  unitScale?: number;
  /** The root nodes are alternatives laid out side by side in the source: move each to the origin. */
  variantsAtOrigin?: boolean;
  /** Turn (degrees about +Y) that brings the source's front to +Z (the prop convention). */
  yawOffset?: number;
  /** Instances are drawn within this distance (m). */
  drawDistance: number;
  castShadow?: boolean;
  /** Emissive overrides for source materials whose name matches. */
  emissive?: { match: RegExp; def: EmissiveDef }[];
  /** Light template of every instance. */
  lights?: PropLight[];
}

const registry = new Map<string, PropDef>();

export function defineProps(defs: readonly PropDef[]): void {
  for (const d of defs) {
    if (registry.has(d.id)) {
      throw new Error(`prop '${d.id}' is defined twice`);
    }
    registry.set(d.id, d);
  }
}

export function propDef(id: string): PropDef {
  const d = registry.get(id);
  if (!d) {
    throw new Error(`unknown prop '${id}': define it with defineProps() in a module listed in registry.ts`);
  }
  return d;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Procedural geometry                                                                                             */
/* ------------------------------------------------------------------------------------------------------------- */

const SEG = 10;
const RINGS = 4;

/** Capsule between a and b with an elliptic section (rx across, rz front-back in the prop frame). */
export function capsule(mesh: TileMesh, m: MaterialName, a: Vec3, b: Vec3, rx: number, rz = rx): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1e-6;
  const ax: Vec3 = [dx / len, dy / len, dz / len];
  // Section frame: s1 ~ prop X projected off the axis, s2 = ax x s1.
  let s1: Vec3 = Math.abs(ax[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const d = s1[0] * ax[0] + s1[1] * ax[1] + s1[2] * ax[2];
  s1 = [s1[0] - ax[0] * d, s1[1] - ax[1] * d, s1[2] - ax[2] * d];
  const l1 = Math.hypot(...s1);
  s1 = [s1[0] / l1, s1[1] / l1, s1[2] / l1];
  const s2: Vec3 = [ax[1] * s1[2] - ax[2] * s1[1], ax[2] * s1[0] - ax[0] * s1[2], ax[0] * s1[1] - ax[1] * s1[0]];
  const pos: number[] = [];
  const idx: number[] = [];
  const ring = (c: Vec3, along: number, scale: number): void => {
    for (let k = 0; k < SEG; k++) {
      const t = (k / SEG) * Math.PI * 2;
      const cx = Math.cos(t) * rx * scale;
      const cz = Math.sin(t) * rz * scale;
      pos.push(c[0] + s1[0] * cx + s2[0] * cz + ax[0] * along, c[1] + s1[1] * cx + s2[1] * cz + ax[1] * along, c[2] + s1[2] * cx + s2[2] * cz + ax[2] * along);
    }
  };
  const rMax = Math.max(rx, rz);
  const rows: [Vec3, number, number][] = [];
  for (let r = RINGS; r >= 1; r--) {
    const ang = (r / RINGS) * (Math.PI / 2);
    rows.push([a, -Math.sin(ang) * rMax, Math.cos(ang)]);
  }
  rows.push([a, 0, 1], [b, 0, 1]);
  for (let r = 1; r <= RINGS; r++) {
    const ang = (r / RINGS) * (Math.PI / 2);
    rows.push([b, Math.sin(ang) * rMax, Math.cos(ang)]);
  }
  for (const [c, along, s] of rows) {
    ring(c, along, Math.max(s, 0.001));
  }
  for (let r = 0; r + 1 < rows.length; r++) {
    for (let k = 0; k < SEG; k++) {
      const a0 = r * SEG + k;
      const a1 = r * SEG + ((k + 1) % SEG);
      const b0 = a0 + SEG;
      const b1 = a1 + SEG;
      idx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  // Fix the winding: faces must point away from the axis.
  const P = pos;
  for (let t = 0; t < idx.length; t += 3) {
    const [i, j, k] = [idx[t], idx[t + 1], idx[t + 2]];
    const ux = P[j * 3] - P[i * 3];
    const uy = P[j * 3 + 1] - P[i * 3 + 1];
    const uz = P[j * 3 + 2] - P[i * 3 + 2];
    const vx = P[k * 3] - P[i * 3];
    const vy = P[k * 3 + 1] - P[i * 3 + 1];
    const vz = P[k * 3 + 2] - P[i * 3 + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const cx = (P[i * 3] + P[j * 3] + P[k * 3]) / 3 - (a[0] + b[0]) / 2;
    const cy = (P[i * 3 + 1] + P[j * 3 + 1] + P[k * 3 + 1]) / 3 - (a[1] + b[1]) / 2;
    const cz = (P[i * 3 + 2] + P[j * 3 + 2] + P[k * 3 + 2]) / 3 - (a[2] + b[2]) / 2;
    if (n[0] * cx + n[1] * cy + n[2] * cz < 0) {
      idx[t + 1] = k;
      idx[t + 2] = j;
    }
  }
  mesh.addMesh(m, { positions: pos, indices: idx });
}

/** Axis-aligned box (flat faces) from min to max. */
export function box(mesh: TileMesh, m: MaterialName, min: Vec3, max: Vec3, skipBottom = true): void {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  mesh.flatPolygon(m, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0]);
  if (!skipBottom) {
    mesh.flatPolygon(m, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
  }
  mesh.flatPolygon(m, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
  mesh.flatPolygon(m, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1]);
  mesh.flatPolygon(m, [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0]);
  mesh.flatPolygon(m, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Core props                                                                                                      */
/* ------------------------------------------------------------------------------------------------------------- */

const LAMP_GLASS: Record<'sodium' | 'led' | 'warm', number> = { sodium: 2000, led: 4000, warm: 3000 };

/** Materials of the core props (listed in registry.ts). */
export const PROP_MATERIALS: MaterialDef[] = [
  { id: 'mannequin', color: 0xb8b2a8, roughness: 0.72, surface: 'other', castShadow: true },
  { id: 'lamp_pole', color: 0x5f6468, metallic: 0.6, roughness: 0.45, surface: 'metal', castShadow: true },
  ...(['sodium', 'led', 'warm'] as const).map(
    (k): MaterialDef => ({
      id: `lamp_glass_${k}`,
      color: 0xf2efe8,
      roughness: 0.2,
      surface: 'glass',
      emissive: { color: rgbHex(kelvinToRgb(LAMP_GLASS[k])), nits: 20000, night: true, source: 'lamp' },
    }),
  ),
];

function rgbHex(lin: [number, number, number]): number {
  const s = (c: number): number => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
  return (s(lin[0]) << 16) | (s(lin[1]) << 8) | s(lin[2]);
}

type Pose = 'standing' | 'walking' | 'sitting';

/** Neutral mannequin (1.75 m, facing +Z) in a pose: a placeholder for the MetaHuman crowd. */
function mannequin(mesh: TileMesh, pose: Pose): void {
  const m = 'mannequin';
  const hipY = pose === 'sitting' ? 0.47 : 0.92;
  const lift = hipY - 0.92;
  const up = (v: Vec3): Vec3 => [v[0], v[1] + lift, v[2]];
  // Head, neck, chest, pelvis.
  capsule(mesh, m, up([0, 1.6, 0.01]), up([0, 1.66, 0.01]), 0.085, 0.1);
  capsule(mesh, m, up([0, 1.44, 0]), up([0, 1.53, 0.005]), 0.05);
  capsule(mesh, m, up([0, 1.1, 0]), up([0, 1.36, 0]), 0.16, 0.1);
  capsule(mesh, m, up([0, 0.94, 0]), up([0, 1.04, 0]), 0.15, 0.1);
  for (const side of [-1, 1]) {
    const sx = side * 0.095;
    const swing = pose === 'walking' ? side * 0.18 : 0;
    // Legs.
    if (pose === 'sitting') {
      capsule(mesh, m, [sx, 0.47, 0.02], [sx, 0.47, 0.44], 0.075);
      capsule(mesh, m, [sx, 0.46, 0.44], [sx * 1.05, 0.08, 0.46], 0.055);
      capsule(mesh, m, [sx * 1.05, 0.04, 0.44], [sx * 1.05, 0.04, 0.6], 0.04);
    } else {
      const knee: Vec3 = [sx, 0.5, swing * 0.9];
      const ankle: Vec3 = [sx * 1.05, 0.08, swing * 1.3 - (pose === 'walking' ? side * 0.06 : 0)];
      capsule(mesh, m, [sx, 0.9, 0], knee, 0.075);
      capsule(mesh, m, knee, ankle, 0.055);
      capsule(mesh, m, [ankle[0], 0.04, ankle[2] - 0.03], [ankle[0], 0.04, ankle[2] + 0.13], 0.04);
    }
    // Arms (swing opposite to the legs when walking; hands on the lap when sitting).
    const shoulder: Vec3 = up([side * 0.2, 1.39, 0]);
    const armSwing = pose === 'walking' ? -side * 0.16 : 0;
    const elbow: Vec3 = pose === 'sitting' ? up([side * 0.23, 1.14, 0.06]) : up([side * 0.235, 1.12, armSwing * 0.6]);
    const wrist: Vec3 = pose === 'sitting' ? up([side * 0.2, 1.02, 0.3]) : up([side * 0.25, 0.86, armSwing]);
    capsule(mesh, m, shoulder, elbow, 0.045);
    capsule(mesh, m, elbow, wrist, 0.038);
    const hand: Vec3 = pose === 'sitting' ? [wrist[0], wrist[1] - 0.02, wrist[2] + 0.1] : [wrist[0] + side * 0.01, wrist[1] - 0.1, wrist[2] + 0.01];
    capsule(mesh, m, wrist, hand, 0.035, 0.022);
  }
}

/** Kerb mast with an arm reaching +Z (heights from the flight slice's LAMP_HEADS). */
function mast(mesh: TileMesh, height: number, reach: number, glass: string, double: boolean): void {
  const pole = 'lamp_pole';
  capsule(mesh, pole, [0, 0, 0], [0, height - 0.2, 0], 0.09);
  for (const dir of double ? [1, -1] : [1]) {
    capsule(mesh, pole, [0, height - 0.3, 0], [0, height, dir * reach * 0.55], 0.04);
    capsule(mesh, pole, [0, height, dir * reach * 0.55], [0, height + 0.05, dir * (reach - 0.25)], 0.04);
    const z0 = dir * (reach - 0.35);
    const z1 = dir * (reach + 0.35);
    box(mesh, pole, [-0.16, height - 0.02, Math.min(z0, z1)], [0.16, height + 0.1, Math.max(z0, z1)], true);
    mesh.flatPolygon(glass, [[-0.14, height - 0.03, Math.min(z0, z1) + 0.03], [0.14, height - 0.03, Math.min(z0, z1) + 0.03], [0.14, height - 0.03, Math.max(z0, z1) - 0.03], [-0.14, height - 0.03, Math.max(z0, z1) - 0.03]], [0, -1, 0]);
  }
}

const mastLights = (height: number, reach: number, double: boolean, lumens: number): PropLight[] =>
  (double ? [1, -1] : [1]).map((dir) => ({ type: 'spot', position: [0, height - 0.08, dir * reach] as XYZ, direction: [0, -1, 0] as XYZ, kelvin: 4000, lumens, cone: { inner: 45, outer: 70 }, night: true, source: 'lamp' }));

export const CORE_PROPS: PropDef[] = [
  { id: 'street_lamp_01', asset: 'street_lamp_01', drawDistance: 90, castShadow: true, emissive: [{ match: /bulb|glass/, def: { color: 0xffd9a8, nits: 20000, night: true, source: 'lamp' } }], lights: [{ type: 'point', position: 'emissive', kelvin: 3000, lumens: 2500, night: true, source: 'lamp' }] },
  { id: 'street_lamp_02', asset: 'street_lamp_02', drawDistance: 90, castShadow: true, emissive: [{ match: /bulb|glass/, def: { color: 0xffd9a8, nits: 20000, night: true, source: 'lamp' } }], lights: [{ type: 'point', position: 'emissive', kelvin: 3000, lumens: 1800, night: true, source: 'lamp' }] },
  { id: 'exterior_aircon_unit', asset: 'exterior_aircon_unit', variantsAtOrigin: true, drawDistance: 90, castShadow: true },
  { id: 'outdoor_table_chair_set_01', asset: 'outdoor_table_chair_set_01', drawDistance: 80, castShadow: true },
  { id: 'plastic_monobloc_chair_01', asset: 'plastic_monobloc_chair_01', yawOffset: 180, drawDistance: 70, castShadow: true },
  { id: 'standing_chalkboard_01', asset: 'standing_chalkboard_01', drawDistance: 70, castShadow: true },
  { id: 'potted_plant_04', asset: 'potted_plant_04', drawDistance: 50, castShadow: false },
  { id: 'planter_pot_clay', asset: 'planter_pot_clay', drawDistance: 50, castShadow: false },
  { id: 'steel_frame_shelves_01', asset: 'steel_frame_shelves_01', unitScale: 0.1, drawDistance: 40, castShadow: true },
  { id: 'modern_ceiling_lamp_01', asset: 'modern_ceiling_lamp_01', drawDistance: 40, castShadow: false, emissive: [{ match: /globe|glass/, def: { color: 0xffe2bd, nits: 8000, night: false, source: 'interior' } }], lights: [{ type: 'point', position: 'emissive', kelvin: 2900, lumens: 800, night: false, source: 'interior' }] },
  {
    id: 'mannequin',
    drawDistance: 150,
    castShadow: true,
    build: (b) => {
      for (const pose of ['standing', 'walking', 'sitting'] as const) {
        b.variant(pose, (mesh) => mannequin(mesh, pose));
      }
    },
  },
  ...(
    [
      ['lamp_mast', 8.3, 1.75, false, 8000],
      ['lamp_mast_low', 6.2, 1.2, false, 5000],
      ['lamp_mast_double', 9.3, 1.9, true, 8000],
    ] as const
  ).map(
    ([id, h, reach, double, lumens]): PropDef => ({
      id,
      drawDistance: 400,
      castShadow: true,
      build: (b) => {
        for (const k of ['sodium', 'led', 'warm'] as const) {
          b.variant(k, (mesh) => mast(mesh, h, reach, `lamp_glass_${k}`, double));
        }
      },
      lights: mastLights(h, reach, double, lumens),
    }),
  ),
];

/* ------------------------------------------------------------------------------------------------------------- */
/* Processing                                                                                                      */
/* ------------------------------------------------------------------------------------------------------------- */

const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex').slice(0, 16);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export interface PropOutput {
  rec: PropRec;
  credit: AssetCredit | null;
}

/** Processes props on first use into <outDir>/props/<id>.glb. */
export class PropBaker {
  private readonly done = new Map<string, Promise<PropOutput | null>>();
  readonly problems = new Map<string, string>();

  constructor(
    readonly outDir: string,
    readonly textures: TextureBaker,
  ) {
    mkdirSync(join(outDir, 'props'), { recursive: true });
  }

  /** The processed prop, or null when its source is not available (reason in `problems`). */
  get(id: string): Promise<PropOutput | null> {
    let p = this.done.get(id);
    if (!p) {
      p = this.process(propDef(id));
      this.done.set(id, p);
    }
    return p;
  }

  async all(): Promise<PropOutput[]> {
    return (await Promise.all(this.done.values())).filter((p): p is PropOutput => !!p);
  }

  private async process(def: PropDef): Promise<PropOutput | null> {
    let doc: Document;
    let credit: AssetCredit | null = null;
    if (def.asset) {
      const a = approvedAssets().get(def.asset);
      if (!a || a.kind !== 'model') {
        throw new Error(`prop '${def.id}': '${def.asset}' is not an approved model`);
      }
      const dir = assetDir(a);
      const gltf = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith('.gltf') || f.endsWith('.glb')) : undefined;
      if (!gltf) {
        this.problems.set(def.id, 'not downloaded (see .docs/assets/manual-downloads.md)');
        return null;
      }
      const cond = conditionStatus(a, dir);
      const unmet = cond.filter((c) => !c.met);
      if (unmet.length) {
        this.problems.set(def.id, `unmet conditions: ${unmet.map((c) => c.text).join('; ')}`);
        return null;
      }
      credit = { id: a.id, name: a.name, kind: a.kind, source: a.source, url: a.url, licence: a.licence, author: a.author, attribution: a.attribution, ...(cond.length ? { conditions: cond.map((c) => ({ text: c.text, met: c.met! })) } : {}) };
      doc = await new NodeIO().read(join(dir, gltf));
      this.adoptTextures(doc, def, dir);
    } else if (def.build) {
      doc = await this.buildProcedural(def);
    } else {
      throw new Error(`prop '${def.id}' has neither an asset nor a builder`);
    }
    const root = doc.getRoot();
    root.getAsset().generator = GENERATOR_V1;
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    if (def.variantsAtOrigin) {
      for (const n of scene.listChildren()) {
        n.setTranslation([0, 0, 0]);
      }
    }
    if (def.yawOffset) {
      const h = (def.yawOffset * Math.PI) / 180;
      const qy: [number, number, number, number] = [0, Math.sin(h / 2), 0, Math.cos(h / 2)];
      for (const n of scene.listChildren()) {
        const t = n.getTranslation();
        const r = n.getRotation();
        // q = qy * r (rotate the node about the prop origin).
        n.setRotation([qy[3] * r[0] + qy[1] * r[2], qy[3] * r[1] + qy[1] * r[3], qy[3] * r[2] - qy[1] * r[0], qy[3] * r[3] - qy[1] * r[1]]);
        n.setTranslation([t[0] * Math.cos(h) + t[2] * Math.sin(h), t[1], -t[0] * Math.sin(h) + t[2] * Math.cos(h)]);
      }
    }
    if (def.unitScale && def.unitScale !== 1) {
      const s = def.unitScale;
      for (const n of scene.listChildren()) {
        const t = n.getTranslation();
        const sc = n.getScale();
        n.setTranslation([t[0] * s, t[1] * s, t[2] * s]).setScale([sc[0] * s, sc[1] * s, sc[2] * s]);
      }
    }
    for (const m of root.listMaterials()) {
      for (const e of def.emissive ?? []) {
        if (e.match.test(m.getName())) {
          m.setEmissiveFactor(linearRgb(e.def.color));
          m.setExtras({ ...m.getExtras(), emissive: { nits: e.def.nits, night: e.def.night, source: e.def.source } });
        }
      }
    }
    // Buffers: GLB holds one.
    const buffers = root.listBuffers();
    for (const b of buffers.slice(1)) {
      for (const a of root.listAccessors()) {
        if (a.getBuffer() === b) {
          a.setBuffer(buffers[0]);
        }
      }
      b.dispose();
    }
    const bounds = getBounds(scene);
    const variants = scene.listChildren().map((n) => n.getName());
    let triangles = 0;
    for (const mesh of root.listMeshes()) {
      for (const p of mesh.listPrimitives()) {
        triangles += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3;
      }
    }
    const lights = this.lightTemplate(def, doc);
    scene.setExtras({ prop: def.id, variants });
    const glb = externalizeImages(await new NodeIO().writeBinary(doc), TEXTURE_URI);
    writeFileSync(join(this.outDir, 'props', `${def.id}.glb`), glb);
    const rec: PropRec = {
      id: def.id,
      glb: `props/${def.id}.glb`,
      hash: sha(glb),
      bytes: glb.byteLength,
      triangles,
      variants,
      bounds: { min: bounds.min.map(r3) as XYZ, max: bounds.max.map(r3) as XYZ },
      drawDistance: def.drawDistance,
      castShadow: def.castShadow ?? true,
      source: def.asset ?? 'procedural',
      ...(lights.length ? { lights } : {}),
    };
    return { rec, credit };
  }

  /** Re-routes the model's textures to shared processed files; opacity-as-colour maps become RGBA cut-outs. */
  private adoptTextures(doc: Document, def: PropDef, dir: string): void {
    const root = doc.getRoot();
    const usedAsBase = new Map<object, Material[]>();
    for (const m of root.listMaterials()) {
      const t = m.getBaseColorTexture();
      if (t) {
        usedAsBase.set(t, [...(usedAsBase.get(t) ?? []), m]);
      }
    }
    root.listTextures().forEach((t, k) => {
      const uri = t.getURI();
      let src = join(dir, uri);
      if (!uri) {
        // Embedded image: stage it for sips.
        src = join(CACHE_DIR, 'tmp', `${def.id}_${k}.${t.getMimeType() === 'image/png' ? 'png' : 'jpg'}`);
        writeFileSync(src, t.getImage()!);
      }
      const stem = uri ? basename(uri).replace(/\.(jpe?g|png)$/i, '') : `${t.getName() || 'image'}_${k}`;
      const users = usedAsBase.get(t) ?? [];
      const opacity = /_opacity_/i.test(uri) && users.length > 0;
      const out = opacity ? this.textures.alphaImage(`prop_${def.id}_${stem}`, [128, 130, 132], src, 1024) : this.textures.image(`prop_${def.id}_${stem}`, src, 1024);
      t.setImage(null).setURI('').setName(out.file).setMimeType(out.mimeType);
      if (opacity) {
        for (const m of users) {
          m.setAlphaMode('MASK').setAlphaCutoff(0.5);
        }
      }
    });
    for (const m of root.listMaterials()) {
      const base = m.getBaseColorTexture();
      if (m.getAlphaMode() === 'BLEND' && base && base.getMimeType() === 'image/jpeg') {
        // Glass exported with an opaque JPEG: keep it see-through.
        const f = m.getBaseColorFactor();
        m.setBaseColorFactor([f[0], f[1], f[2], Math.min(f[3], 0.35)]);
      }
    }
  }

  private async buildProcedural(def: PropDef): Promise<Document> {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const scene = doc.createScene(def.id);
    doc.getRoot().setDefaultScene(scene);
    const tex = new ExternalTextures(doc);
    const materials = new Map<MaterialName, Material>();
    const variants: { name: string; mesh: TileMesh }[] = [];
    def.build!({
      variant: (name, build) => {
        const mesh = new TileMesh(0, 0);
        build(mesh);
        variants.push({ name, mesh });
      },
    });
    for (const v of variants) {
      const res = v.mesh.takeLod(1, 256);
      const gm = doc.createMesh(`${def.id}_${v.name}`);
      for (const p of res.parts) {
        let mat = materials.get(p.material);
        if (!mat) {
          mat = createMaterial(doc, tex, p.material, await this.textures.material(p.material));
          materials.set(p.material, mat);
        }
        const n = p.position.length / 3;
        const index = n <= 65535 ? Uint16Array.from(p.index) : p.index;
        const acc = (s: string, type: 'VEC2' | 'VEC3' | 'SCALAR', a: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>) => doc.createAccessor(`${v.name}_${p.material}_${s}`).setType(type).setArray(a).setBuffer(buffer);
        gm.addPrimitive(
          doc
            .createPrimitive()
            .setAttribute('POSITION', acc('position', 'VEC3', p.position))
            .setAttribute('NORMAL', acc('normal', 'VEC3', p.normal))
            .setAttribute('TEXCOORD_0', acc('uv0', 'VEC2', p.uv0!))
            .setIndices(acc('index', 'SCALAR', index))
            .setMaterial(mat),
        );
      }
      scene.addChild(doc.createNode(v.name).setMesh(gm));
    }
    return doc;
  }

  /** Light template in prop space; 'emissive' positions resolve to the centre of the emissive primitives. */
  private lightTemplate(def: PropDef, doc: Document): NonNullable<PropRec['lights']> {
    const out: NonNullable<PropRec['lights']> = [];
    for (const l of def.lights ?? []) {
      let position: XYZ;
      if (l.position === 'emissive') {
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
        scene.traverse((node) => {
          const mesh = node.getMesh();
          if (!mesh) {
            return;
          }
          const mat = node.getWorldMatrix();
          for (const p of mesh.listPrimitives()) {
            const e = p.getMaterial()?.getEmissiveFactor() ?? [0, 0, 0];
            if (e[0] + e[1] + e[2] <= 0) {
              continue;
            }
            const pos = p.getAttribute('POSITION')!;
            const lo = pos.getMin([]);
            const hi = pos.getMax([]);
            for (const c of [lo, hi]) {
              const w = [0, 1, 2].map((r) => mat[r] * c[0] + mat[4 + r] * c[1] + mat[8 + r] * c[2] + mat[12 + r]);
              for (let k = 0; k < 3; k++) {
                min[k] = Math.min(min[k], w[k]);
                max[k] = Math.max(max[k], w[k]);
              }
            }
          }
        });
        if (!Number.isFinite(min[0])) {
          throw new Error(`prop '${def.id}': a light sits on its emissive parts but none are emissive`);
        }
        position = [r3((min[0] + max[0]) / 2), r3((min[1] + max[1]) / 2), r3((min[2] + max[2]) / 2)];
      } else {
        position = l.position;
      }
      const intensity = l.type === 'spot' ? spotCandela(l.lumens, l.cone?.outer ?? 60) : pointCandela(l.lumens);
      out.push({
        type: l.type,
        position,
        ...(l.direction ? { direction: l.direction } : {}),
        kelvin: l.kelvin,
        color: kelvinToRgb(l.kelvin),
        intensity: Math.round(intensity * 100) / 100,
        lumens: l.lumens,
        range: Math.round(lightRange(intensity) * 100) / 100,
        ...(l.cone ? { cone: l.cone } : {}),
        night: l.night,
        source: l.source,
      });
    }
    return out;
  }
}
