/**
 * Grip point resolution: derives each perch's world position from the inputs the landmark builders use, mirroring
 * their placement math (the builder constants repeated here are marked). tools/headless/perches-check.ts runs the
 * real builders in Node and verifies every resolved point against the built geometry.
 */
import type { GeoQuery, LandmarkDef, PerchPoint } from '../../core/contracts';
import { latLonToLocal } from '../../core/geo-coords';
import { RUMELI_GREAT_TOWERS } from '../landmarks/heritage/data/fortresses';
import { LANDMARK_SPECS } from '../landmarks/mosques/gen/specs';
import type { ImperialSpec } from '../landmarks/mosques/gen/styles/imperial';
import { BOGAZICI, FSM, YSS } from '../landmarks/structures/builders/bridges/bosphorus-specs';
import type { SuspensionSpec } from '../landmarks/structures/builders/bridges/suspension';
import { catalogFor } from '../landmarks/structures/builders/skyscrapers/catalog';
import { makePlan, planExtent } from '../landmarks/structures/builders/skyscrapers/plans';
import type { PerchData, PerchPlacement } from './data';

const DEG = Math.PI / 180;

const BRIDGE_SPECS: Record<string, SuspensionSpec> = {
  'bogazici-koprusu': BOGAZICI,
  'fsm-koprusu': FSM,
  'yss-koprusu': YSS,
};

interface Grip {
  x: number;
  y: number;
  z: number;
}

function landmark(geo: GeoQuery, id: string): LandmarkDef {
  const def = geo.landmark(id);
  if (!def) {
    throw new Error(`landmark "${id}" not found`);
  }
  return def;
}

/** Mirrors buildSuspensionBridge (structures/builders/bridges/suspension.ts): tower station, base and top. */
function bridgeTower(geo: GeoQuery, id: string, tower: 0 | 1): Grip {
  const def = landmark(geo, id);
  const spec = BRIDGE_SPECS[id];
  const anchors = def.anchors ?? [];
  if (!spec || anchors.length < 4) {
    throw new Error(`"${id}" is not a suspension bridge with tower anchors`);
  }
  // BridgeFrame.fromPoints(towerA, towerB): origin at the midpoint, axis toward tower B
  const ox = (anchors[0].x + anchors[1].x) / 2;
  const oz = (anchors[0].z + anchors[1].z) / 2;
  const len = Math.hypot(anchors[1].x - ox, anchors[1].z - oz) || 1;
  const ax = (anchors[1].x - ox) / len;
  const az = (anchors[1].z - oz) / len;
  const rx = -az;
  const rz = ax;
  const at = (s: number, x: number): { x: number; z: number } => ({ x: ox + ax * s + rx * x, z: oz + az * s + rz * x });

  const s = (tower === 0 ? -1 : 1) * (spec.mainSpan / 2);
  const tw = spec.tower;
  // tower base: lowest ground under the leg footprint, never below the sea, plus the 2.5 m pier cap
  const hw = tw.xBase + tw.dtBase;
  let lo = Infinity;
  for (const x of [-hw, 0, hw]) {
    for (const ds of [-tw.daBase / 2, 0, tw.daBase / 2]) {
      const q = at(s + ds, x);
      lo = Math.min(lo, geo.heightAt(q.x, q.z));
    }
  }
  const yBase = Math.max(lo, 0) + 2.5;
  // DeckProfile main span: parabolic crest through hMid
  const hMid = spec.clearance + spec.section.depth + 0.1;
  const deck = hMid - (s * s) / (2 * spec.crestRadius);
  const hv = tw.height.values[tower];
  const top = tw.height.ref === 'base' ? yBase + hv : tw.height.ref === 'deck' ? deck + hv : hv;
  const c = at(s, 0);
  // portal towers: the top portal beam is centred 3.5 m below the top with a 6.5 m depth (builder constants),
  // so its upper face is at top - 0.25; A towers: the concrete apex of the head
  const y = tw.kind === 'portal' ? top - 3.5 + 6.5 / 2 : top;
  return { x: c.x, y, z: c.z };
}

/** Mirrors buildGalataTower: y0 = lowest ground on the shaft circle - 0.5, cone tip 65.6 m above y0. */
function galataCap(geo: GeoQuery): Grip {
  const def = landmark(geo, 'galata-kulesi');
  const R = 8.225;
  let ground = Infinity;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ground = Math.min(ground, geo.heightAt(def.x + Math.cos(a) * R, def.z + Math.sin(a) * R));
  }
  return { x: def.x, y: ground - 0.5 + 65.6, z: def.z };
}

/** Mirrors buildKizKulesi: terrace paving at a fixed 2.1 m, local frame u along the heading, v to the right. */
function kizTerrace(geo: GeoQuery, u: number, v: number): Grip {
  const def = landmark(geo, 'kiz-kulesi');
  const h = def.headingDeg * DEG;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const rx = -fz;
  const rz = fx;
  return { x: def.x + fx * u + rx * v, y: 2.1, z: def.z + fz * u + rz * v };
}

/**
 * Mirrors buildImperial (mosques/gen/styles/imperial.ts) for the main dome: drum base, springing and crown, the
 * whole plan shifted along the qibla axis to centre prayer hall + courtyard, then leadDome's 'raised' profile.
 */
function mosqueDome(geo: GeoQuery, id: string, offset: number, headingDeg: number): Grip {
  const def = landmark(geo, id);
  const spec = LANDMARK_SPECS[id];
  if (!spec || spec.style !== 'imperial') {
    throw new Error(`"${id}" has no imperial mosque spec`);
  }
  const s = spec as ImperialSpec;
  const R = s.dome.r;
  const Rs = R * 0.97;
  const archT = Math.max(0.8, R * 0.09);
  const semiBase = s.hall.h - 0.35;
  const semiBand = s.semiBand ?? Math.max(1.6, Rs * 0.2);
  const drumBase = s.semi !== 'none' ? semiBase + semiBand + Rs + archT * 0.6 : (s.dome.base ?? s.hall.h);
  const spring = drumBase + s.dome.drum;
  const rise = s.dome.rise ?? R * 1.04;
  const courtD = s.court?.d ?? 0;
  const porticoD = !s.court && s.portico ? s.portico.depth + 0.4 : 0;
  const zMin = -s.hall.d / 2;
  const zMax = s.hall.d / 2 + Math.max(courtD, porticoD);
  const shift = -(zMin + zMax) / 2;
  // model -> world (placementFromHeading, scale 1): yaw = -heading
  const yaw = -def.headingDeg * DEG;
  const cx = def.x + shift * Math.sin(yaw);
  const cz = def.z + shift * Math.cos(yaw);
  // 'raised' profile: r = R cos(phi) (1 - 0.05 sin^6 phi), y = spring + rise sin(phi); solve r = offset
  const d = Math.min(Math.max(offset, 0), R * 0.9);
  let lo = 0;
  let hi = Math.PI / 2;
  for (let i = 0; i < 40; i++) {
    const phi = (lo + hi) / 2;
    const r = R * Math.cos(phi) * (1 - 0.05 * Math.pow(Math.sin(phi), 6));
    if (r > d) {
      lo = phi;
    } else {
      hi = phi;
    }
  }
  const y = def.y + spring + rise * Math.sin((lo + hi) / 2);
  const h = headingDeg * DEG;
  return { x: cx + Math.sin(h) * d, y, z: cz - Math.cos(h) * d };
}

/**
 * Rumeli Hisarı great towers from heritage/data/fortresses.ts (ground at the tower centre + the recorded height).
 * The heritage module has no fortress builder yet; keep this in sync when one lands.
 */
function fortressTower(geo: GeoQuery, name: string): Grip {
  const t = RUMELI_GREAT_TOWERS.find((w) => w.name === name);
  if (!t) {
    throw new Error(`Rumeli Hisarı tower "${name}" not found`);
  }
  const p = latLonToLocal(t.lat, t.lon);
  return { x: p.x, y: geo.heightAt(p.x, p.z) + (t.h ?? 20), z: p.z };
}

/** Mirrors buildSkyscraperCluster + buildTower: ground, roof height and the slanted crown plane. */
function skyscraperRoof(geo: GeoQuery, id: string, anchor: number, along: number): Grip {
  const def = landmark(geo, id);
  const a = def.anchors?.[anchor];
  const placed = catalogFor(id)[anchor]?.[0];
  if (!a || !placed) {
    throw new Error(`"${id}" anchor ${anchor} has no catalogued tower`);
  }
  const spec = placed.spec;
  const x = a.x + (placed.dx ?? 0);
  const z = a.z + (placed.dz ?? 0);
  const extent = planExtent(makePlan(spec.plan, 1));
  let ground = Infinity;
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    ground = Math.min(ground, geo.heightAt(x + Math.cos(ang) * extent, z + Math.sin(ang) * extent));
  }
  ground = Math.min(ground, geo.heightAt(x, z));
  const y0 = ground - 1;
  const crown = spec.crown;
  const spire = spec.spire ?? 0;
  const crownH = crown.kind === 'fins' || crown.kind === 'pyramid' ? crown.height : 0;
  const roof = y0 + 1 + spec.height - spire - (crown.kind === 'fins' ? crown.height * 0.85 : crownH);
  const rot = spec.rotation * DEG;
  const ax = Math.cos(rot);
  const az = Math.sin(rot);
  const t = Math.max(-1, Math.min(1, along));
  const px = x + ax * t * extent;
  const pz = z + az * t * extent;
  const y = crown.kind === 'slant' ? roof - (roof - y0) * (1 - crown.low) * (0.5 - 0.5 * t) : roof;
  return { x: px, y, z: pz };
}

function resolveGrip(geo: GeoQuery, p: PerchPlacement, headingDeg: number): Grip {
  switch (p.kind) {
    case 'ground': {
      const q = latLonToLocal(p.lat, p.lon);
      return { x: q.x, y: geo.heightAt(q.x, q.z), z: q.z };
    }
    case 'bridge-tower':
      return bridgeTower(geo, p.landmarkId, p.tower);
    case 'galata-cap':
      return galataCap(geo);
    case 'kiz-terrace':
      return kizTerrace(geo, p.u, p.v);
    case 'mosque-dome':
      return mosqueDome(geo, p.landmarkId, p.offset, headingDeg);
    case 'fortress-tower':
      return fortressTower(geo, p.tower);
    case 'skyscraper-roof':
      return skyscraperRoof(geo, p.landmarkId, p.anchor, p.along);
  }
}

/** Resolves a catalogue entry to a PerchPoint (throws when its landmark or spec is missing). */
export function resolvePerch(geo: GeoQuery, d: PerchData): PerchPoint {
  const g = resolveGrip(geo, d.placement, d.headingDeg);
  const point: PerchPoint = {
    id: d.id,
    name: d.name,
    x: g.x,
    y: g.y,
    z: g.z,
    headingDeg: d.headingDeg,
    surface: d.surface,
    gripRadius: d.gripRadius,
    info: d.info,
  };
  if (d.landmarkId) {
    point.landmarkId = d.landmarkId;
  }
  return point;
}
