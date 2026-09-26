/**
 * Hull descriptions for the floating vessel bodies (phase 21 stage 7b).
 *
 * Every vessel kind gets a design record (form coefficients, freeboard, metacentric height, radii of gyration, added
 * mass, damping ratios, propulsion and steering sizing). `buildHullBody` turns it plus the model's length, beam and
 * draft into the numbers the rigid body integrates with: a set of buoyancy columns (hull slices, two per station at
 * the port and starboard quarter-beam lines that reproduce the waterplane's second moment exactly), mass from the
 * displaced volume at the equilibrium draft, the centre of gravity from the design metacentric height, inertias,
 * stiffnesses, damping coefficients and the linear natural periods.
 *
 * Column model: a column of waterplane area A has, below the design waterline, a cross-section that grows like
 * (z / T)^p from the keel (p = 1 / Cvp - 1), so its volume is A T Cvp (d / T)^(1 / Cvp) for an immersion d <= T
 * (the vertical prismatic coefficient Cvp and the centre of buoyancy KB = T / (1 + Cvp) come out right) and wall-sided
 * above it up to the deck edge (no buoyancy once the deck edge is under).
 *
 * Frames: model space as everywhere in the fleet (origin midship on the design waterline, forward = -Z,
 * starboard = +X). Roll > 0 lifts the starboard side, pitch > 0 lifts the bow (the Euler angles the fleet renders).
 */
import type { VesselKind } from '../model-types';

export const RHO_SEA = 1025;
export const GRAVITY = 9.81;

export interface PlaningDesign {
  /** Speed through the water where planing lift starts / is complete (m/s). */
  vOn: number;
  vFull: number;
  /** Share of the weight carried by dynamic lift at full planing. */
  lift: number;
  /** Bow-up trim at full planing (degrees). */
  trimDeg: number;
}

export interface HullDesign {
  /** Deck edge above the design waterline, midship (m). */
  freeboard: number;
  /** Waterplane area coefficient (area / (L B)); for the catamaran the two demihulls together. */
  cw: number;
  /** Vertical prismatic coefficient (Cb / Cw). */
  cvp: number;
  /** Design transverse metacentric height at the design draft (m); sets the centre of gravity KG = KM - GM. */
  gm: number;
  /** Roll radius of gyration / beam, pitch and yaw radius of gyration / length. */
  kxx: number;
  kyy: number;
  /** Hull slices (two buoyancy columns each). */
  stations: number;
  /** Added mass / inertia as a fraction of the dry value (heave, roll, pitch, sway). */
  addHeave: number;
  addRoll: number;
  addPitch: number;
  addSway: number;
  /** Damping ratios (fraction of critical) in heave, roll and pitch. */
  zetaHeave: number;
  zetaRoll: number;
  zetaPitch: number;
  /** Quadratic roll damping (bilge keels, eddies): equivalent damping ratio per radian of roll amplitude. */
  rollQuad: number;
  /** Speed the propulsion is sized for (m/s, above anything its navigation asks for). */
  vmax: number;
  /** Acceleration from rest with full thrust, roughly (m/s²). */
  accel: number;
  /** Largest yaw rate the steering controller asks for (rad/s). */
  yawRate: number;
  /** Low-speed yaw and sway authority (bow thrusters, azimuth drives, outboard / tiller steering), 0..1. */
  thrusters: number;
  /** Lateral / longitudinal drag ratio per unit length-to-beam (the lateral drag is much higher). */
  lateralDrag: number;
  planing?: PlaningDesign;
  /** Both ends are bows: the hull may swap its heading by half a turn while stopped. */
  doubleEnded?: boolean;
  /** Two demihulls: the buoyancy columns sit further out (roll stiffness of a catamaran). */
  catamaran?: boolean;
}

const SHIP: HullDesign = {
  freeboard: 6.5,
  cw: 0.86,
  cvp: 0.88,
  gm: 2.4,
  kxx: 0.38,
  kyy: 0.25,
  stations: 6,
  addHeave: 1.0,
  addRoll: 0.15,
  addPitch: 1.0,
  addSway: 0.9,
  zetaHeave: 0.35,
  zetaRoll: 0.06,
  zetaPitch: 0.35,
  rollQuad: 0.6,
  vmax: 7.5,
  accel: 0.05,
  yawRate: 0.03,
  thrusters: 0.08,
  lateralDrag: 7,
};

/** One design record per vessel kind. Freeboard of the cargo ships is overridden per model (0.55 x draft). */
export const HULL_DESIGNS: Record<VesselKind, HullDesign> = {
  vapur: { freeboard: 2.4, cw: 0.8, cvp: 0.72, gm: 1.6, kxx: 0.4, kyy: 0.26, stations: 5, addHeave: 0.9, addRoll: 0.2, addPitch: 0.9, addSway: 0.9, zetaHeave: 0.3, zetaRoll: 0.07, zetaPitch: 0.3, rollQuad: 1.0, vmax: 9.5, accel: 0.1, yawRate: 0.07, thrusters: 0.7, lateralDrag: 7 },
  ferry: { freeboard: 2.0, cw: 0.8, cvp: 0.72, gm: 1.35, kxx: 0.4, kyy: 0.26, stations: 5, addHeave: 0.9, addRoll: 0.2, addPitch: 0.9, addSway: 0.9, zetaHeave: 0.3, zetaRoll: 0.07, zetaPitch: 0.3, rollQuad: 1.0, vmax: 8.5, accel: 0.12, yawRate: 0.09, thrusters: 1, lateralDrag: 7, doubleEnded: true },
  seabus: { freeboard: 2.2, cw: 0.55, cvp: 0.62, gm: 15.5, kxx: 0.45, kyy: 0.26, stations: 4, addHeave: 0.7, addRoll: 0.2, addPitch: 0.7, addSway: 0.8, zetaHeave: 0.3, zetaRoll: 0.1, zetaPitch: 0.3, rollQuad: 1.0, vmax: 16, accel: 0.32, yawRate: 0.11, thrusters: 1, lateralDrag: 7, catamaran: true, planing: { vOn: 6, vFull: 12, lift: 0.15, trimDeg: 0.8 } },
  tour: { freeboard: 1.6, cw: 0.78, cvp: 0.7, gm: 0.95, kxx: 0.4, kyy: 0.26, stations: 4, addHeave: 0.9, addRoll: 0.2, addPitch: 0.9, addSway: 0.9, zetaHeave: 0.3, zetaRoll: 0.08, zetaPitch: 0.3, rollQuad: 1.0, vmax: 6.5, accel: 0.25, yawRate: 0.1, thrusters: 0.3, lateralDrag: 7 },
  tug: { freeboard: 1.6, cw: 0.82, cvp: 0.7, gm: 1.5, kxx: 0.4, kyy: 0.26, stations: 4, addHeave: 0.9, addRoll: 0.2, addPitch: 0.9, addSway: 0.9, zetaHeave: 0.3, zetaRoll: 0.08, zetaPitch: 0.3, rollQuad: 1.0, vmax: 7, accel: 0.4, yawRate: 0.2, thrusters: 1, lateralDrag: 6 },
  pilot: { freeboard: 1.4, cw: 0.75, cvp: 0.62, gm: 1.2, kxx: 0.4, kyy: 0.25, stations: 3, addHeave: 0.8, addRoll: 0.2, addPitch: 0.8, addSway: 0.8, zetaHeave: 0.3, zetaRoll: 0.15, zetaPitch: 0.3, rollQuad: 2.0, vmax: 12, accel: 0.8, yawRate: 0.3, thrusters: 0.5, lateralDrag: 7, planing: { vOn: 5, vFull: 11, lift: 0.35, trimDeg: 2.8 } },
  motorboat: { freeboard: 0.9, cw: 0.75, cvp: 0.62, gm: 1.1, kxx: 0.4, kyy: 0.25, stations: 3, addHeave: 0.8, addRoll: 0.2, addPitch: 0.8, addSway: 0.8, zetaHeave: 0.3, zetaRoll: 0.15, zetaPitch: 0.3, rollQuad: 2.0, vmax: 16, accel: 1.2, yawRate: 0.45, thrusters: 0.6, lateralDrag: 7, planing: { vOn: 4, vFull: 10, lift: 0.5, trimDeg: 4.5 } },
  tanker: { ...SHIP, gm: 2.3 },
  container: { ...SHIP, cw: 0.82, cvp: 0.82, gm: 1.6 },
  bulk: { ...SHIP, gm: 2.8 },
  fishing: { freeboard: 0.7, cw: 0.72, cvp: 0.62, gm: 0.9, kxx: 0.4, kyy: 0.25, stations: 3, addHeave: 0.8, addRoll: 0.2, addPitch: 0.8, addSway: 0.8, zetaHeave: 0.3, zetaRoll: 0.15, zetaPitch: 0.3, rollQuad: 2.0, vmax: 5.5, accel: 0.4, yawRate: 0.3, thrusters: 0.5, lateralDrag: 7 },
  seiner: { freeboard: 1.3, cw: 0.8, cvp: 0.7, gm: 1.0, kxx: 0.4, kyy: 0.26, stations: 4, addHeave: 0.9, addRoll: 0.2, addPitch: 0.9, addSway: 0.9, zetaHeave: 0.3, zetaRoll: 0.08, zetaPitch: 0.3, rollQuad: 1.0, vmax: 6, accel: 0.35, yawRate: 0.15, thrusters: 0.3, lateralDrag: 7 },
  yacht: { freeboard: 1.8, cw: 0.75, cvp: 0.62, gm: 1.2, kxx: 0.4, kyy: 0.25, stations: 4, addHeave: 0.8, addRoll: 0.2, addPitch: 0.8, addSway: 0.8, zetaHeave: 0.3, zetaRoll: 0.09, zetaPitch: 0.3, rollQuad: 1.0, vmax: 14, accel: 0.5, yawRate: 0.22, thrusters: 0.5, lateralDrag: 7, planing: { vOn: 5, vFull: 12, lift: 0.25, trimDeg: 2.2 } },
  sailboat: { freeboard: 1.0, cw: 0.7, cvp: 0.55, gm: 1.6, kxx: 0.45, kyy: 0.25, stations: 3, addHeave: 0.8, addRoll: 0.25, addPitch: 0.8, addSway: 1.0, zetaHeave: 0.3, zetaRoll: 0.15, zetaPitch: 0.3, rollQuad: 2.0, vmax: 4.2, accel: 0.3, yawRate: 0.25, thrusters: 0.3, lateralDrag: 9 },
};

/** A buoyancy column: position in model space (x starboard, z aft) and waterplane area at the design waterline. */
export interface HullColumn {
  lx: number;
  lz: number;
  area: number;
}

/** Hull dimensions the body is built from (VesselModel subset). */
export interface HullDims {
  kind: VesselKind;
  length: number;
  beam: number;
  draft: number;
}

/** Everything the rigid body integrates with, derived once per vessel. */
export interface HullBody {
  kind: VesselKind;
  design: HullDesign;
  length: number;
  beam: number;
  /** Design draft (keel below the design waterline, m) and the deck edge above it. */
  draft: number;
  freeboard: number;
  /** Ballast ships ride this much higher: equilibrium draft = draft - lift. */
  lift: number;
  eqDraft: number;
  cvp: number;
  /** 1 / Cvp: exponent of the column volume law. */
  volExp: number;
  columns: HullColumn[];
  /** The cheap LOD: three columns (bow centre, both quarters aft) carrying the same waterplane. */
  midColumns: HullColumn[];
  /** Displaced volume (m³) and mass (kg) at the equilibrium draft. */
  volume: number;
  mass: number;
  /** Centre of buoyancy and gravity above the keel, metacentric heights at the equilibrium draft (m). */
  kb: number;
  kg: number;
  gm: number;
  gmL: number;
  /** Effective masses and inertias (added mass included). */
  mHeave: number;
  mSurge: number;
  mSway: number;
  iRoll: number;
  iPitch: number;
  iYaw: number;
  /** Linear stiffnesses (N/m, N m/rad) and damping coefficients. */
  kHeave: number;
  kRoll: number;
  kPitch: number;
  cHeave: number;
  cRoll: number;
  cRoll2: number;
  cPitch: number;
  /** Surge drag (quadratic, linear), sway drag, yaw damping. */
  xuu: number;
  xu: number;
  yvv: number;
  yv: number;
  /** Sway lift per unit speed and sway velocity (slender body: pi rho T², N s² / m²). */
  yLift: number;
  nr: number;
  /** Largest forward thrust (N); astern is 60 % of it. */
  thrustMax: number;
  /** Yaw angular acceleration available from the rudder at `vRudder` and from thrusters at rest (rad/s²). */
  alphaRudder: number;
  alphaThrust: number;
  vRudder: number;
  /** Lateral force available from thrusters at rest (N). */
  swayThrust: number;
  /** Linear natural periods (s): heave, roll, pitch. */
  periods: { heave: number; roll: number; pitch: number };
}

/** Column volume (m³ per m² of waterplane) at immersion d of a column with design draft T. */
export function columnVolume(d: number, T: number, F: number, cvp: number, volExp: number): number {
  if (d <= 0) {
    return 0;
  }
  if (d <= T) {
    return T * cvp * Math.pow(d / T, volExp);
  }
  return T * cvp + (d > T + F ? F : d - T);
}

/** Waterline half-width shape along the length (t = -1 stern .. 1 bow): full amidships, fining toward the ends. */
function widthShape(u: number, q: number): number {
  return 1 - Math.pow(Math.abs(u), q);
}

export function buildHullBody(dims: HullDims, lift = 0): HullBody {
  const base = HULL_DESIGNS[dims.kind];
  const L = dims.length;
  const B = dims.beam;
  const T = dims.draft;
  const design: HullDesign = base === HULL_DESIGNS.tanker || base === HULL_DESIGNS.container || base === HULL_DESIGNS.bulk ? { ...base, freeboard: 0.55 * T } : base;
  const cvp = design.cvp;
  const volExp = 1 / cvp;
  const p = volExp - 1;
  const n = design.stations;
  // Waterplane: stations of equal length; the width law 1 - |u|^q has mean q / (q + 1) = Cw.
  const cw = design.catamaran ? Math.min(0.9, design.cw / 0.55) : design.cw;
  const q = cw / (1 - cw);
  const dl = L / n;
  const widths: number[] = [];
  let sumW = 0;
  for (let j = 0; j < n; j++) {
    const u = -1 + (2 * (j + 0.5)) / n;
    const w = widthShape(u, q);
    widths.push(w);
    sumW += w;
  }
  const areaTotal = design.cw * L * B;
  const columns: HullColumn[] = [];
  for (let j = 0; j < n; j++) {
    const u = -1 + (2 * (j + 0.5)) / n;
    // Station centre: u = 1 is the bow (model z = -L/2).
    const lz = -0.5 * L * u;
    const w = widths[j] / sumW;
    const area = areaTotal * w;
    const localBeam = B * widths[j];
    // Quarter-beam lines at w / (2 sqrt 3) reproduce the strip's second moment w³ dl / 12; a catamaran's demihulls
    // sit at ±0.36 B.
    const off = design.catamaran ? 0.36 * B : localBeam / (2 * Math.sqrt(3));
    columns.push({ lx: off, lz, area: area / 2 }, { lx: -off, lz, area: area / 2 });
  }
  const midColumns: HullColumn[] = [
    { lx: 0, lz: -L / 3, area: areaTotal / 3 },
    { lx: B / 4, lz: L / 6, area: areaTotal / 3 },
    { lx: -B / 4, lz: L / 6, area: areaTotal / 3 },
  ];

  const eqDraft = Math.max(T * 0.3, T - lift);
  // Effective waterplane at a draft d: the column cross-section there, A (d / T)^p.
  const second = (d: number): { area: number; it: number; il: number; vol: number } => {
    const shrink = Math.pow(d / T, p);
    let area = 0;
    let it = 0;
    let il = 0;
    let vol = 0;
    for (const c of columns) {
      const a = c.area * shrink;
      area += a;
      it += a * c.lx * c.lx;
      il += a * c.lz * c.lz;
      vol += c.area * columnVolume(d, T, design.freeboard, cvp, volExp);
    }
    return { area, it, il, vol };
  };
  const des = second(T);
  const kbDesign = T / (1 + cvp);
  const kg = kbDesign + des.it / des.vol - design.gm;
  const eq = second(eqDraft);
  const volume = eq.vol;
  const mass = RHO_SEA * volume;
  const kb = eqDraft / (1 + cvp);
  const gm = kb + eq.it / volume - kg;
  const gmL = kb + eq.il / volume - kg;

  const mHeave = mass * (1 + design.addHeave);
  const mSurge = mass * 1.05;
  const mSway = mass * (1 + design.addSway);
  const iRoll = mass * (design.kxx * B) ** 2 * (1 + design.addRoll);
  const iPitch = mass * (design.kyy * L) ** 2 * (1 + design.addPitch);
  const iYaw = mass * (design.kyy * L) ** 2 * 1.3;
  const kHeave = RHO_SEA * GRAVITY * eq.area;
  const kRoll = mass * GRAVITY * gm;
  const kPitch = mass * GRAVITY * gmL;
  const crit = (k: number, m: number): number => 2 * Math.sqrt(Math.max(k, 1) * m);

  const xuu = (mSurge * design.accel) / (design.vmax * design.vmax);
  const vRudder = 0.6 * design.vmax;
  return {
    kind: dims.kind,
    design,
    length: L,
    beam: B,
    draft: T,
    freeboard: design.freeboard,
    lift,
    eqDraft,
    cvp,
    volExp,
    columns,
    midColumns,
    volume,
    mass,
    kb,
    kg,
    gm,
    gmL,
    mHeave,
    mSurge,
    mSway,
    iRoll,
    iPitch,
    iYaw,
    kHeave,
    kRoll,
    kPitch,
    cHeave: design.zetaHeave * crit(kHeave, mHeave),
    cRoll: design.zetaRoll * crit(kRoll, iRoll),
    // Bilge-keel / eddy roll damping grows with the roll rate: M = cRoll2 φ'|φ'|, an equivalent damping ratio of
    // about rollQuad x the roll amplitude (rad) on top of the linear one.
    cRoll2: design.rollQuad * crit(kRoll, iRoll) * (2 * Math.sqrt(iRoll / Math.max(kRoll, 1))) * 0.6,
    cPitch: design.zetaPitch * crit(kPitch, iPitch),
    xuu,
    xu: 0.1 * xuu * design.vmax,
    yvv: xuu * (L / B) * design.lateralDrag,
    yv: mSway * 0.05,
    yLift: Math.PI * RHO_SEA * eqDraft * eqDraft * (design.catamaran ? 2 : 1),
    nr: iYaw / 6,
    thrustMax: 2 * mSurge * design.accel,
    alphaRudder: 0.5 * design.yawRate,
    alphaThrust: 0.35 * design.yawRate * design.thrusters,
    vRudder,
    swayThrust: 0.05 * mSway * design.thrusters,
    periods: {
      heave: 2 * Math.PI * Math.sqrt(mHeave / kHeave),
      roll: 2 * Math.PI * Math.sqrt(iRoll / Math.max(kRoll, 1)),
      pitch: 2 * Math.PI * Math.sqrt(iPitch / Math.max(kPitch, 1)),
    },
  };
}
