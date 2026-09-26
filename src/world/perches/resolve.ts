/**
 * Grip point resolution: derives each perch's world position from the inputs the landmark builders use, mirroring
 * their placement math (the builder constants repeated here are marked). tools/headless/perches-check.ts runs the
 * real builders in Node and verifies every resolved point against the built geometry.
 */
import type { GeoQuery, LandmarkDef, PerchPoint } from '../../core/contracts';
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

/**
 * Round stone towers: the builder's base ring (radius on which it samples the lowest ground) and how far it sinks the
 * base below that (builder constants).
 */
const ROUND_TOWERS: Record<string, { ring: number; sink: number }> = {
  'galata-kulesi': { ring: 8.225, sink: 0.5 }, // buildGalataTower
};

/** Roof of a round tower: `height` m over the builder's base, `radius` m out from the axis along the heading. */
function towerRoof(geo: GeoQuery, id: string, height: number, radius: number, headingDeg: number): Grip {
  const def = landmark(geo, id);
  const base = ROUND_TOWERS[id];
  if (!base) {
    throw new Error(`"${id}" is not a round tower`);
  }
  let ground = Infinity;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ground = Math.min(ground, geo.heightAt(def.x + Math.cos(a) * base.ring, def.z + Math.sin(a) * base.ring));
  }
  const h = headingDeg * DEG;
  return { x: def.x + Math.sin(h) * radius, y: ground - base.sink + height, z: def.z - Math.cos(h) * radius };
}

/**
 * Mirrors buildKizKulesi: terrace paving at a fixed 2.1 m, the tower 6.75 m behind the islet centre along the heading,
 * its lead cupola springing at 20.6 m above the paving with a 2 m rise (the finial starts at the crown).
 */
function kizCupola(geo: GeoQuery): Grip {
  const def = landmark(geo, 'kiz-kulesi');
  const h = def.headingDeg * DEG;
  return { x: def.x - Math.sin(h) * 6.75, y: 2.1 + 22.6, z: def.z + Math.cos(h) * 6.75 };
}

/**
 * Mirrors buildImperial (mosques/gen/styles/imperial.ts) for the main dome: drum base, springing and crown, the
 * whole plan shifted along the qibla axis to centre prayer hall + courtyard, then leadDome's 'raised' profile.
 */
function mosqueDome(geo: GeoQuery, id: string, offset: number, headingDeg: number, side = 0): Grip {
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
  // 'raised' profile: r = R cos(phi) (1 - 0.05 sin^6 phi), y = spring + rise sin(phi); solve r = distance from the crown
  const d = Math.min(Math.hypot(Math.max(offset, 0), side), R * 0.9);
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
  // Along the heading by `offset`, to its right by `side` (right of the heading is (cos h, sin h)).
  const h = headingDeg * DEG;
  return { x: cx + Math.sin(h) * offset + Math.cos(h) * side, y, z: cz - Math.cos(h) * offset + Math.sin(h) * side };
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
    case 'bridge-tower':
      return bridgeTower(geo, p.landmarkId, p.tower);
    case 'tower-roof':
      return towerRoof(geo, p.landmarkId, p.height, p.radius, headingDeg);
    case 'kiz-cupola':
      return kizCupola(geo);
    case 'mosque-dome':
      return mosqueDome(geo, p.landmarkId, p.offset, headingDeg, p.side ?? 0);
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
