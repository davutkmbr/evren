/**
 * Sockets of an exported vessel (empty `SOCKET_*` nodes, also listed in the manifest): navigation lights from the web
 * model, wake and spray emitters where the hull meets the water, and propeller positions estimated from the hull
 * (the web models have none).
 */
import type * as THREE from 'three';
import { Sector } from '../../../src/world/life/lights/nav-lights';
import { PASSENGER, STYLES, WORK_LAMPS } from '../../../src/world/life/lights/vessel-lights';
import { HULL_FOAM } from '../../../src/world/water/foam/config';
import type { SocketOut, Vec3 } from './mesh';
import type { DesignSource } from './sources';

const SECTOR_NAMES: Record<number, string> = Object.fromEntries(Object.entries(Sector).map(([k, v]) => [v, k.replace(/^./, (c) => c.toLowerCase())]));

/** When the web switches a light on (vessel-lights.ts), by kind, for a vessel of `kind`. */
function lightRule(light: string, kind: string): string {
  switch (light) {
    case 'anchor':
      return 'at anchor';
    case 'deck':
      if (WORK_LAMPS.has(kind)) return 'at anchor (working over the nets)';
      return PASSENGER.has(kind) ? 'always (passenger vessel)' : 'unless underway';
    case 'red':
      return 'always';
    default:
      return 'underway';
  }
}

/** Points (x, z) where the geometry's edges cross the plane y = h, in the export frame. */
function crossings(g: THREE.BufferGeometry, h: number, turn: boolean): number[] {
  const pos = g.getAttribute('position');
  const index = g.getIndex();
  const n = index ? index.count : pos.count;
  const at = (k: number): number => (index ? index.getX(k) : k);
  const s = turn ? -1 : 1;
  const out: number[] = [];
  for (let t = 0; t < n; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = at(t + e);
      const b = at(t + ((e + 1) % 3));
      const ya = pos.getY(a) - h;
      const yb = pos.getY(b) - h;
      if ((ya < 0) === (yb < 0) || ya === yb) continue;
      const f = ya / (ya - yb);
      out.push(s * (pos.getX(a) + (pos.getX(b) - pos.getX(a)) * f), s * (pos.getZ(a) + (pos.getZ(b) - pos.getZ(a)) * f));
    }
  }
  return out;
}

/** Extreme crossing along z (sign -1: forward end, +1: aft end) among those accepted by `keep`. */
function extreme(pts: readonly number[], sign: number, keep: (x: number) => boolean): [number, number] | null {
  let best: [number, number] | null = null;
  for (let i = 0; i < pts.length; i += 2) {
    if (!keep(pts[i])) continue;
    if (!best || pts[i + 1] * sign > best[1] * sign) best = [pts[i], pts[i + 1]];
  }
  return best;
}

export function socketsOf(d: DesignSource, g: THREE.BufferGeometry): SocketOut[] {
  const out: SocketOut[] = [];
  const count = new Map<string, number>();
  for (const l of d.lights) {
    const n = count.get(l.kind) ?? 0;
    count.set(l.kind, n + 1);
    const st = STYLES[l.kind];
    out.push({
      name: `light_${l.kind}_${n}`,
      position: [l.x, l.y, l.z],
      extras: { socket: 'light', light: l.kind, sector: SECTOR_NAMES[st.sector], color: st.color, radius: st.radius, on: lightRule(l.kind, d.kind) },
    });
  }

  // Wake: bow and stern where the hull crosses the waterline (per demihull on a catamaran).
  const wl = crossings(g, 0, d.turn);
  const sides: [string, (x: number) => boolean][] = d.catamaran
    ? [
        ['_port', (x) => x < 0],
        ['_stbd', (x) => x > 0],
      ]
    : [['', () => true]];
  for (const [suffix, keep] of sides) {
    const bow = extreme(wl, -1, keep);
    const stern = extreme(wl, 1, keep);
    // A demihull's centreline: the mean of its waterline points (the hull is symmetric about it).
    let cx = 0;
    if (d.catamaran) {
      let n = 0;
      for (let i = 0; i < wl.length; i += 2) {
        if (keep(wl[i])) {
          cx += wl[i];
          n++;
        }
      }
      cx = n ? cx / n : 0;
    }
    if (bow) out.push({ name: `wake_bow${suffix}`, position: [cx, 0, bow[1]], extras: { socket: 'wake', end: 'bow', bowRoll: { length: HULL_FOAM.bowLength, width: HULL_FOAM.bowWidth, widthPerSpeed: HULL_FOAM.bowWidthSpeed, froude: HULL_FOAM.frBow } } });
    if (stern) out.push({ name: `wake_stern${suffix}`, position: [cx, 0, stern[1]], extras: { socket: 'wake', end: d.doubleEnded ? 'bow (double-ended: the ends swap with the heading)' : 'stern', turbulenceRadius: HULL_FOAM.sternRadius, washWidth: HULL_FOAM.washWidth, washSpread: HULL_FOAM.washSpread } });
  }
  if (d.planing) {
    for (const [name, side] of [
      ['spray_chine_port', -1],
      ['spray_chine_stbd', 1],
    ] as const) {
      out.push({ name, position: [(side * d.beam) / 2, 0, -(0.5 - HULL_FOAM.chineFrom) * d.length], extras: { socket: 'spray', runsTo: 'the stern', note: 'planing craft: spray sheets off the aft chines' } });
    }
  }

  // Propellers (estimated): below the hull's aft end, clear of the keel line.
  const pr = d.propulsion;
  if (pr) {
    const D = pr.diameter * d.draft;
    const y = -d.draft + 0.5 * D + 0.1 * d.draft;
    const at = crossings(g, y, d.turn);
    const xs = pr.count === 1 ? [0] : [(-pr.spread * d.beam) / 2, (pr.spread * d.beam) / 2];
    const ends = pr.bothEnds ? [1, -1] : [1];
    let k = 0;
    for (const end of ends) {
      for (const x of xs) {
        const near = Math.max(0.6 * D, 0.12 * d.beam);
        const hit = extreme(at, end, (cx) => Math.abs(cx - x) < near) ?? extreme(at, end, () => true);
        if (!hit) continue;
        const inset = pr.type === 'outboard' ? 0.3 * D : 0.7 * D;
        const position: Vec3 = [x, y, hit[1] - end * inset];
        out.push({
          name: `propeller_${k++}`,
          position,
          extras: { socket: 'propeller', type: pr.type, diameter: Math.round(D * 100) / 100, axis: [0, 0, end], spin: x < 0 ? -1 : 1, estimated: true },
        });
      }
    }
  }
  return out;
}
