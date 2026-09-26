/**
 * Clearance check, headless (no browser, no GPU): the real FlightSim flown hands-off (no input, auto-flap as in normal
 * play) through the real colliders of Boğaziçi (15 Temmuz Şehitler), Galata and Haliç bridges and the Levent towers,
 * built in Node by their structures builders, and over real rolling terrain.
 *
 *   npx tsx tools/headless/clearance-check.ts            # before/after table, exits 1 when a scenario fails
 *   CLEARANCE_TRACE=1 npx tsx tools/headless/clearance-check.ts   # also print every flight each 0.5 s
 *
 * Every scenario is flown twice: "before" with the near look-ahead only (sim.farLookahead = false: 0.8 / 1.7 / 2.8 s
 * along the track) and "after" with the far look-ahead as well. Only "after" is judged:
 *   - under: passes under the deck without climbing toward it (max climb <= 3 m near the deck), keeps >= 3 m between
 *     the top of the body and the deck underside, no structure contact;
 *   - over: climbs over in time (lowest body point above the structure top while over it), no structure contact;
 *   - avoid: a tower too tall to simply hop over: no structure contact, gets past it, climbs at most 120 m and turns
 *     at most 100° (over or around, whichever the assist picks);
 *   - land: an assisted landing under a bridge deck settles on the ground below, not on the deck;
 *   - cruise: rolling terrain, no ground contact, mean height above ground at most 15 % (and 5 m) above "before".
 */
import { PHYSICS_DT } from '../../src/dragon/flight/params';
import { FlightSim } from '../../src/dragon/flight/sim';
import { clearPilotEdges, createPilotCommand } from '../../src/dragon/flight/types';
import { buildStructure, createWorld, type BuiltStructure } from './clearance-scene';
import { buildHeadlessGeo } from './geo';
import { LiftEnv } from './lift-sim';

const TRACE = !!process.env.CLEARANCE_TRACE;
const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : '-');

type Kind = 'under' | 'over' | 'avoid' | 'land' | 'cruise';

interface Scenario {
  name: string;
  kind: Kind;
  /** Start (center of mass) and horizontal direction of flight. */
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  speed: number;
  seconds: number;
  /** Crossing point of the structure and its half depth along the flight direction. */
  tx: number;
  tz: number;
  halfDepth: number;
  /** Seconds of a held dive (Shift) at the start, then hands-off. */
  diveSeconds?: number;
}

interface Result {
  contacts: number;
  /** Least distance between the top of the body and a ceiling overhead (m, Infinity when never under one). */
  minCeilingGap: number;
  /** Largest climb while approaching (from 150 m before; from the start for avoid) and passing the structure (m). */
  maxClimb: number;
  /** Largest heading change from the start direction (deg). */
  maxTurn: number;
  /** Mean height of the center of mass above the surface below while airborne (m). */
  meanAgl: number;
  /** Least height of the lowest body point above the surface below while airborne (m). */
  minFeetAgl: number;
  /** Terrain / water contact steps (cruise). */
  groundContacts: number;
  /** Least height of the lowest body point above the structure top while over it (m, Infinity when never). */
  minOverTop: number;
  /** Distance past the crossing point at the end (m). */
  along: number;
  mode: string;
  /** Height of the feet above the ground (terrain / water) at the end (m). */
  feetAboveGround: number;
  /** Height of the feet above the deck top at the end (m). */
  feetAboveDeck: number;
}

const t0 = Date.now();
const geo = buildHeadlessGeo();
const env = new LiftEnv(12, 'calm');
const structures: BuiltStructure[] = ['bogazici-koprusu', 'galata-koprusu', 'halic-koprusu', 'levent-kuleleri'].map((id) => buildStructure(geo, id));
console.log(`geo + structures built in ${Date.now() - t0} ms`);
// One world for every flight and for the measurements.
const metric = createWorld(geo, structures);
const column = { floor: 0, ceiling: Infinity };

function deckFrame(id: string): { ox: number; oz: number; ax: number; az: number } {
  const d = structures.find((s) => s.id === id)!.decks[0];
  return { ox: d.ox, oz: d.oz, ax: d.ax, az: d.az };
}

/** A straight crossing of a bridge perpendicular to its deck at station s. */
function crossBridge(id: string, s: number, before: number): Pick<Scenario, 'x' | 'z' | 'dx' | 'dz' | 'tx' | 'tz'> {
  const f = deckFrame(id);
  const tx = f.ox + f.ax * s;
  const tz = f.oz + f.az * s;
  // Lateral direction of the deck (to the right of the axis): across the bridge.
  const dx = -f.az;
  const dz = f.ax;
  return { x: tx - dx * before, z: tz - dz * before, dx, dz, tx, tz };
}

/** A spot under a bridge viaduct over land with at least `gap` metres between ground and deck underside. */
function underViaduct(id: string, gap: number): { x: number; z: number; ground: number; ceiling: number; ax: number; az: number } {
  const f = deckFrame(id);
  for (let s = -1100; s <= 1100; s += 5) {
    const x = f.ox + f.ax * s;
    const z = f.oz + f.az * s;
    const ground = geo.heightAt(x, z);
    if (ground < 3) {
      continue;
    }
    metric.columnAt(x, z, ground + 4, column);
    if (column.ceiling < Infinity && column.ceiling - column.floor > gap && column.floor - ground < 0.5) {
      return { x, z, ground, ceiling: column.ceiling, ax: f.ax, az: f.az };
    }
  }
  throw new Error(`no viaduct spot on ${id}`);
}

const levent = structures.find((s) => s.id === 'levent-kuleleri')!;
// A tower of the cluster with a clear approach from the east (no other tower on the line), flown at mid height.
const tower = levent.colliders
  .filter((c): c is Extract<typeof c, { kind: 'cylinder' }> => c.kind === 'cylinder')
  .reduce((a, b) => (Math.hypot(b.base.x + 608, b.base.z + 4159) < Math.hypot(a.base.x + 608, a.base.z + 4159) ? b : a));
const towerMid = tower.base.y + tower.height * 0.5;
const towerTop = tower.base.y + tower.height;
function towerRun(y: number, speed = 24, start = 800): Omit<Scenario, 'name' | 'kind'> {
  return { x: tower.base.x + start, y, z: tower.base.z, dx: -1, dz: 0, speed, seconds: 45, tx: tower.base.x, tz: tower.base.z, halfDepth: tower.radius };
}
/** A straight run over rolling land (no structures on it): start, direction, length (m). */
function terrainRun(x: number, z: number, deg: number, length: number, speed: number): Omit<Scenario, 'name' | 'kind'> {
  const dx = Math.cos((deg * Math.PI) / 180);
  const dz = Math.sin((deg * Math.PI) / 180);
  return { x, y: geo.heightAt(x, z) + 30, z, dx, dz, speed, seconds: length / speed, tx: x + dx * length, tz: z + dz * length, halfDepth: 0 };
}
const viaduct = underViaduct('bogazici-koprusu', 25);

const scenarios: Scenario[] = [
  { name: '1 Boğaziçi under, ample headroom (COM 35 m)', kind: 'under', y: 35, speed: 24, seconds: 40, halfDepth: 17, ...crossBridge('bogazici-koprusu', 0, 700) },
  { name: '1b Boğaziçi under, just below the band (COM 54 m)', kind: 'under', y: 54, speed: 24, seconds: 40, halfDepth: 17, ...crossBridge('bogazici-koprusu', 0, 700) },
  { name: '2 Boğaziçi at deck height (COM 66 m)', kind: 'over', y: 66, speed: 24, seconds: 40, halfDepth: 17, ...crossBridge('bogazici-koprusu', 0, 700) },
  { name: '3 Galata low pass (COM 8 m, gap 4 m)', kind: 'over', y: 8, speed: 24, seconds: 35, halfDepth: 21, ...crossBridge('galata-koprusu', 100, 600) },
  { name: '3b Haliç under, deck underside 22 m (COM 9 m)', kind: 'under', y: 9, speed: 24, seconds: 35, halfDepth: 16, ...crossBridge('halic-koprusu', 54, 600) },
  {
    name: `4 Levent tower, near the top (COM ${(towerTop - 12).toFixed(0)} m, top ${towerTop.toFixed(0)} m)`,
    kind: 'over',
    ...towerRun(towerTop - 12),
  },
  {
    name: `4b Levent tower, upper part (COM ${(towerTop - 30).toFixed(0)} m, top ${towerTop.toFixed(0)} m)`,
    kind: 'avoid',
    ...towerRun(towerTop - 30),
  },
  {
    name: `4c Levent tower at mid height (COM ${towerMid.toFixed(0)} m, top ${towerTop.toFixed(0)} m)`,
    kind: 'avoid',
    ...towerRun(towerMid),
  },
  {
    name: `4d Levent tower head-on at 45 m/s, mid height (COM ${towerMid.toFixed(0)} m)`,
    kind: 'avoid',
    ...towerRun(towerMid, 45, 1100),
  },
  {
    name: `4e Levent tower after a dive (Shift 2.5 s from ${(towerTop + 60).toFixed(0)} m, then hands-off)`,
    kind: 'avoid',
    diveSeconds: 2.5,
    ...towerRun(towerTop + 60, 32, 1000),
  },
  {
    name: `4f Levent tower close ahead and low (350 m out, COM ${(tower.base.y + 25).toFixed(0)} m, top ${towerTop.toFixed(0)} m)`,
    kind: 'avoid',
    ...towerRun(tower.base.y + 25, 24, 350),
  },
  {
    name: `4g Levent tower close ahead near its base (260 m out, COM ${(tower.base.y + 12).toFixed(0)} m, top ${towerTop.toFixed(0)} m)`,
    kind: 'avoid',
    ...towerRun(tower.base.y + 12, 24, 260),
  },
  {
    name: `5 landing under the Boğaziçi viaduct (ground ${viaduct.ground.toFixed(0)} m, deck underside ${viaduct.ceiling.toFixed(0)} m)`,
    kind: 'land',
    x: viaduct.x,
    y: viaduct.ground + 10,
    z: viaduct.z,
    dx: viaduct.ax,
    dz: viaduct.az,
    speed: 0,
    seconds: 15,
    tx: viaduct.x,
    tz: viaduct.z,
    halfDepth: 0,
  },
  { name: '6 cruise up a long hillside, European side (24 m/s)', kind: 'cruise', ...terrainRun(7000, -15000, 90, 2000, 24) },
  { name: '6b cruise across a valley and a ridge (32 m/s)', kind: 'cruise', ...terrainRun(-12000, -18000, 45, 2000, 32) },
  { name: '6c cruise over rolling hills (28 m/s)', kind: 'cruise', ...terrainRun(6000, -11000, 0, 2000, 28) },
];

function fly(sc: Scenario, far: boolean): Result {
  const sim = new FlightSim();
  sim.farLookahead = far;
  sim.world.collision = metric;
  sim.world.geo = geo;
  sim.world.env = env;
  sim.queueEvents = false;
  sim.teleport(sc.x, sc.y, sc.z, Math.atan2(-sc.dx, -sc.dz), 0, sc.speed);
  const cmd = createPilotCommand();
  const p = sim.body.position;
  const r: Result = {
    contacts: 0,
    minCeilingGap: Infinity,
    maxClimb: -Infinity,
    maxTurn: 0,
    meanAgl: NaN,
    groundContacts: 0,
    minFeetAgl: Infinity,
    minOverTop: Infinity,
    along: 0,
    mode: '',
    feetAboveGround: NaN,
    feetAboveDeck: NaN,
  };
  let entryY = NaN;
  let aglSum = 0;
  let aglCount = 0;
  const startHeading = Math.atan2(sc.dx, sc.dz);
  const steps = Math.round(sc.seconds / PHYSICS_DT);
  for (let i = 0; i < steps; i++) {
    cmd.pitch = 0;
    cmd.roll = 0;
    cmd.yaw = 0;
    cmd.flap = false;
    cmd.dive = i * PHYSICS_DT < (sc.diveSeconds ?? 0);
    cmd.brake = false;
    clearPilotEdges(cmd);
    if (sc.kind === 'land' && i === 0) {
      cmd.landPressed = true;
    }
    sim.step(PHYSICS_DT, cmd);
    if (sim.impact.touched && sim.impact.surface === 'structure') {
      r.contacts++;
    } else if (sim.impact.touched && sc.kind === 'cruise') {
      r.groundContacts++;
    }
    const v = sim.body.velocity;
    if (Math.hypot(v.x, v.z) > 3) {
      const turn = Math.atan2(Math.sin(Math.atan2(v.x, v.z) - startHeading), Math.cos(Math.atan2(v.x, v.z) - startHeading));
      r.maxTurn = Math.max(r.maxTurn, Math.abs((turn * 180) / Math.PI));
    }
    if (sim.airborne) {
      aglSum += sim.agl;
      aglCount++;
      r.minFeetAgl = Math.min(r.minFeetAgl, sim.footClearance);
    }
    const along = (p.x - sc.tx) * sc.dx + (p.z - sc.tz) * sc.dz;
    const top = p.y + sim.contacts.bellyDepth;
    const feet = p.y - sim.footDepth();
    metric.columnAt(p.x, p.z, top, column);
    if (column.ceiling < Infinity) {
      r.minCeilingGap = Math.min(r.minCeilingGap, column.ceiling - top);
    }
    const ground = metric.groundHeight(p.x, p.z);
    const structureTop = metric.surfaceHeight(p.x, p.z);
    if ((sc.kind === 'over' || sc.kind === 'avoid') && structureTop > ground + 1) {
      r.minOverTop = Math.min(r.minOverTop, feet - structureTop);
    }
    if ((along > -150 || sc.kind === 'avoid') && along < sc.halfDepth) {
      if (Number.isNaN(entryY)) {
        entryY = p.y;
      }
      r.maxClimb = Math.max(r.maxClimb, p.y - entryY);
    }
    r.along = along;
    if (TRACE && i % Math.round(0.5 / PHYSICS_DT) === 0) {
      console.log(
        `    t=${f1(i * PHYSICS_DT)} along=${f1(along)} side=${f1((p.x - sc.tx) * -sc.dz + (p.z - sc.tz) * sc.dx)} y=${f1(p.y)} agl=${f1(sim.agl)} V=${f1(sim.airspeed)} γ=${f1((sim.gamma * 180) / Math.PI)} bank=${f1((sim.bank * 180) / Math.PI)} mode=${sim.mode} surf=${f1(sim.surfaceY)} ceil=${f1(sim.ceilingY)} ahead=${sim.aheadSurface.map(f1).join('/')} ceilAhead=${sim.aheadCeiling.map(f1).join('/')} far=${f1((sim.farPath * 180) / Math.PI)}°@${f1(sim.farObstacleDistance)}/${f1(sim.farReach)} side=${sim.farSide} γmax=${f1((sim.controller.gammaMax * 180) / Math.PI)}`,
      );
    }
  }
  r.mode = sim.mode;
  r.meanAgl = aglCount > 0 ? aglSum / aglCount : NaN;
  const feet = p.y - sim.footDepth();
  r.feetAboveGround = feet - metric.groundHeight(p.x, p.z);
  metric.columnAt(p.x, p.z, -1e3, column);
  r.feetAboveDeck = column.ceiling < Infinity ? feet - metric.surfaceHeight(p.x, p.z) : NaN;
  return r;
}

function judge(sc: Scenario, r: Result, before: Result): string[] {
  const why: string[] = [];
  if (r.contacts > 0) {
    why.push(`${r.contacts} structure contact steps`);
  }
  if (sc.kind === 'under') {
    if (r.maxClimb > 3) {
      why.push(`climbed ${f1(r.maxClimb)} m toward the deck`);
    }
    if (!(r.minCeilingGap >= 3)) {
      why.push(`body top came within ${f1(r.minCeilingGap)} m of the deck underside`);
    }
    if (r.along < sc.halfDepth + 50) {
      why.push('did not get past the bridge');
    }
  } else if (sc.kind === 'over') {
    if (r.along < sc.halfDepth + 50) {
      why.push('did not get past the structure');
    }
    if (!(r.minOverTop > 0) && r.minOverTop !== Infinity) {
      why.push(`lowest body point ${f1(r.minOverTop)} m against the structure top`);
    }
    if (r.minOverTop === Infinity) {
      why.push('never flew over the structure');
    }
  } else if (sc.kind === 'avoid') {
    if (r.along < sc.halfDepth + 50) {
      why.push('did not get past the tower');
    }
    if (r.maxClimb > 120) {
      why.push(`climbed ${f1(r.maxClimb)} m`);
    }
    if (r.maxTurn > 100) {
      why.push(`turned ${f1(r.maxTurn)}°`);
    }
  } else if (sc.kind === 'cruise') {
    if (r.groundContacts > 0) {
      why.push(`${r.groundContacts} ground contact steps`);
    }
    if (r.meanAgl > Math.max(before.meanAgl * 1.15, before.meanAgl + 5)) {
      why.push(`mean height above ground ${f1(r.meanAgl)} m (before ${f1(before.meanAgl)} m)`);
    }
  } else {
    if (r.mode !== 'grounded') {
      why.push(`ended ${r.mode}, not grounded`);
    }
    if (!(Math.abs(r.feetAboveGround) < 1.5)) {
      why.push(`feet ${f1(r.feetAboveGround)} m above the ground (deck: ${f1(r.feetAboveDeck)})`);
    }
  }
  return why;
}

function endText(sc: Scenario, r: Result): string {
  if (sc.kind === 'land') {
    return `${r.mode}, feet→ground ${f1(r.feetAboveGround)}`;
  }
  return sc.kind === 'cruise' ? `along ${f1(r.along)}, lowest feet AGL ${f1(r.minFeetAgl)}` : `along ${f1(r.along)}`;
}

const failures: string[] = [];
const rows: string[][] = [];
for (const sc of scenarios) {
  console.log(`\n${sc.name}`);
  let before: Result | null = null;
  for (const far of [false, true]) {
    const label = far ? 'after' : 'before';
    if (TRACE) {
      console.log(`  ${label}:`);
    }
    const r = fly(sc, far);
    before ??= r;
    const why = judge(sc, r, before);
    const verdict = why.length === 0 ? 'PASS' : `FAIL (${why.join('; ')})`;
    console.log(
      `  ${label.padEnd(6)} contacts=${r.contacts} maxClimb=${f1(r.maxClimb)} maxTurn=${f1(r.maxTurn)} minBodyTop→ceiling=${f1(r.minCeilingGap)} minFeet→structureTop=${f1(r.minOverTop)} meanAgl=${f1(r.meanAgl)} along=${f1(r.along)} mode=${r.mode} feet→ground=${f1(r.feetAboveGround)}  ${verdict}`,
    );
    rows.push([sc.name, label, String(r.contacts + r.groundContacts), f1(r.maxClimb), f1(r.maxTurn), f1(r.minCeilingGap), f1(r.minOverTop), f1(r.meanAgl), endText(sc, r), far ? (why.length === 0 ? 'PASS' : 'FAIL') : why.length === 0 ? '(pass)' : '(fail)']);
    if (far && why.length > 0) {
      failures.push(`${sc.name}: ${why.join('; ')}`);
    }
  }
}

console.log('\n| scenario | look-ahead | contacts | max climb (m) | max turn (°) | min body top → ceiling (m) | min feet → structure top (m) | mean AGL (m) | end | verdict |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const row of rows) {
  console.log(`| ${row.join(' | ')} |`);
}
console.log(`\n${failures.length} failure(s) (${Math.round((Date.now() - t0) / 1000)} s)`);
for (const f of failures) {
  console.log(`FAIL ${f}`);
}
process.exit(failures.length > 0 ? 1 : 0);
