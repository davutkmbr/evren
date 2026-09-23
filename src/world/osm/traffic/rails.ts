/**
 * Tram tracks of the slice (worker side): the T1 double track (Eminönü - Galata Köprüsü - Karaköy - Tophane -
 * Fındıklı) and the İstiklal nostalgic tram T2 (Taksim - Tünel, single track with the Galatasaray passing loop).
 *
 * OSM tram ways are chained end to end per line, clipped to the build rect and oriented for right-hand running
 * (each T1 track has the other one on its left). Bridge sections on a rendered deck move onto the deck's tracks with
 * Hermite transitions at the bridge heads. T2 gets a second track variant through the passing-loop siding.
 */
import type { WorldBounds } from '../../../core/contracts';
import type { OsmData, OsmPoint, OsmRail } from '../data';
import { clipPolyline, hermite, PathFlag, type PathPool, pointAt, polyLength, project, reversePolyline, subPolyline } from './paths';
import { TrackLine, TRAM_CROSSING_STRIDE, type DeckSpec, type TramTrack } from './protocol';

const JOIN = 1.2;
/** Length (m) of the Hermite transition between ground track and deck track at each bridge head. */
const DECK_BLEND = 34;

interface Chain {
  pts: number[];
  /** Per vertex: deck index or -1. */
  deck: number[];
}

function endpoints(p: number[]): [number, number, number, number] {
  return [p[0], p[1], p[p.length - 2], p[p.length - 1]];
}

function near(ax: number, az: number, bx: number, bz: number): boolean {
  return Math.abs(ax - bx) < JOIN && Math.abs(az - bz) < JOIN;
}

function onDeck(x: number, z: number, decks: readonly DeckSpec[]): number {
  for (let i = 0; i < decks.length; i++) {
    const d = decks[i];
    const dx = x - d.ox;
    const dz = z - d.oz;
    const s = dx * d.ax + dz * d.az;
    const l = -dx * d.az + dz * d.ax;
    if (s > d.s0 - 4 && s < d.s1 + 4 && Math.abs(l) < d.halfWidth + 6) {
      return i;
    }
  }
  return -1;
}

/** Chains ways that meet end to end (straightest continuation first). */
function chainWays(ways: OsmRail[], decks: readonly DeckSpec[]): Chain[] {
  const used = new Set<number>();
  const order = ways.map((_, i) => i).sort((a, b) => polyLength(ways[b].pts) - polyLength(ways[a].pts));
  const out: Chain[] = [];
  const flags = (w: OsmRail, pts: number[]): number[] => {
    const f: number[] = [];
    for (let k = 0; k < pts.length; k += 2) {
      f.push(w.bridge ? onDeck(pts[k], pts[k + 1], decks) : -1);
    }
    return f;
  };
  for (const start of order) {
    if (used.has(start)) {
      continue;
    }
    used.add(start);
    let pts = ways[start].pts.slice();
    let deck = flags(ways[start], pts);
    for (const atEnd of [true, false]) {
      for (;;) {
        const n = pts.length;
        const [ex, ez] = atEnd ? [pts[n - 2], pts[n - 1]] : [pts[0], pts[1]];
        const hx = atEnd ? pts[n - 2] - pts[n - 4] : pts[0] - pts[2];
        const hz = atEnd ? pts[n - 1] - pts[n - 3] : pts[1] - pts[3];
        const hl = Math.hypot(hx, hz) || 1;
        let best = -1;
        let bestDot = 0.3;
        let bestRev = false;
        ways.forEach((w, wi) => {
          if (used.has(wi)) {
            return;
          }
          const [sx, sz, tx, tz] = endpoints(w.pts);
          for (const rev of [false, true]) {
            const [jx, jz] = rev ? [tx, tz] : [sx, sz];
            if (!near(ex, ez, jx, jz)) {
              continue;
            }
            const p = rev ? reversePolyline(w.pts) : w.pts;
            // direction leaving the joint along w
            const dx = p[2] - p[0];
            const dz = p[3] - p[1];
            const dl = Math.hypot(dx, dz) || 1;
            const dot = (dx * hx + dz * hz) / (dl * hl);
            if (dot > bestDot) {
              bestDot = dot;
              best = wi;
              bestRev = rev;
            }
          }
        });
        if (best < 0) {
          break;
        }
        used.add(best);
        const w = ways[best];
        let p = bestRev ? reversePolyline(w.pts) : w.pts.slice();
        let f = flags(w, p);
        if (atEnd) {
          pts = pts.concat(p.slice(2));
          deck = deck.concat(f.slice(1));
        } else {
          p = reversePolyline(p);
          f = f.slice().reverse();
          pts = p.slice(0, p.length - 2).concat(pts);
          deck = f.slice(0, f.length - 1).concat(deck);
        }
      }
    }
    out.push({ pts, deck });
  }
  return out;
}

function reverseChain(c: Chain): Chain {
  return { pts: reversePolyline(c.pts), deck: c.deck.slice().reverse() };
}

/** Replaces the deck part of an oriented chain by the deck track of its travel direction (Hermite transitions). */
function mapDeck(c: Chain, decks: readonly DeckSpec[]): { pts: number[]; deck: boolean } {
  const first = c.deck.findIndex((d) => d >= 0);
  if (first < 0) {
    return { pts: c.pts, deck: false };
  }
  let last = first;
  while (last + 1 < c.deck.length && c.deck[last + 1] === c.deck[first]) {
    last++;
  }
  const d = decks[c.deck[first]];
  const sOf = (k: number): number => (c.pts[k * 2] - d.ox) * d.ax + (c.pts[k * 2 + 1] - d.oz) * d.az;
  const sa = Math.max(d.s0, Math.min(d.s1, sOf(first)));
  const sb = Math.max(d.s0, Math.min(d.s1, sOf(last)));
  const dir = sb >= sa ? 1 : -1;
  const track = d.tracks.find((t) => t.dir === dir) ?? d.tracks[0];
  const pt = (s: number): [number, number] => [d.ox + d.ax * s - d.az * track.x, d.oz + d.az * s + d.ax * track.x];
  // cumulative arc lengths of the original chain
  const cum: number[] = [0];
  for (let k = 1; k < c.pts.length / 2; k++) {
    cum.push(cum[k - 1] + Math.hypot(c.pts[k * 2] - c.pts[k * 2 - 2], c.pts[k * 2 + 1] - c.pts[k * 2 - 1]));
  }
  const L = cum[cum.length - 1];
  const before = subPolyline(c.pts, 0, Math.max(0.1, cum[first] - DECK_BLEND * 0.5));
  const after = subPolyline(c.pts, Math.min(L - 0.1, cum[last] + DECK_BLEND * 0.5), L);
  const d0 = sa + dir * DECK_BLEND * 0.5;
  const d1 = sb - dir * DECK_BLEND * 0.5;
  const [ax0, az0] = pt(d0);
  const [ax1, az1] = pt(d1);
  const tx = d.ax * dir;
  const tz = d.az * dir;
  const out: number[] = before.slice();
  const bh = before.length >= 4 ? [before[before.length - 2] - before[before.length - 4], before[before.length - 1] - before[before.length - 3]] : [tx, tz];
  const bl = Math.hypot(bh[0], bh[1]) || 1;
  const h0 = hermite(before[before.length - 2], before[before.length - 1], bh[0] / bl, bh[1] / bl, ax0, az0, tx, tz, 0.55);
  out.push(...h0.slice(2));
  out.push(ax1, az1);
  const ah = after.length >= 4 ? [after[2] - after[0], after[3] - after[1]] : [tx, tz];
  const al = Math.hypot(ah[0], ah[1]) || 1;
  const h1 = hermite(ax1, az1, tx, tz, after[0], after[1], ah[0] / al, ah[1] / al, 0.55);
  out.push(...h1.slice(2));
  out.push(...after.slice(2));
  return { pts: out, deck: true };
}

/** Signed lateral side of point (x, z) relative to the chain near it (+ = right of travel). */
function sideOf(c: number[], x: number, z: number): number {
  const pr = project(c, x, z);
  const p = pointAt(c, pr.s);
  return (x - p[0]) * -p[3] + (z - p[1]) * p[2];
}

export interface TrackBuild {
  tracks: TramTrack[];
  /** Polylines of the tracks (for projections). */
  polylines: number[][];
}

export function buildTracks(data: Pick<OsmData, 'rails' | 'points'>, pool: PathPool, rect: WorldBounds, decks: readonly DeckSpec[]): TrackBuild {
  const tracks: TramTrack[] = [];
  const polylines: number[][] = [];
  const stopPts = data.points.filter((p) => p.kind === 'railway=tram_stop');
  const addTrack = (pts: number[], line: number, deck: boolean): number => {
    const path = pool.add(pts, 2, deck ? PathFlag.Deck : 0);
    const L = pool.length[path];
    const stops: number[] = [];
    for (const sp of stopPts) {
      const pr = project(pts, sp.x, sp.z);
      if (pr.d < 14 && pr.s > 20 && pr.s < L - 20 && !stops.some((s) => Math.abs(s - pr.s) < 60)) {
        stops.push(pr.s);
      }
    }
    stops.sort((a, b) => a - b);
    tracks.push({ path, line, stops, pair: -1, deck });
    polylines.push(pts);
    return tracks.length - 1;
  };

  /* T1: double track, one direction per track. */
  const t1 = data.rails.filter((r) => r.kind === 'tram' && r.routes?.includes('T1') && !r.tunnel);
  const t1Chains: Chain[] = [];
  for (const c of chainWays(t1, decks)) {
    for (const piece of clipPolyline(c.pts, c.deck, rect)) {
      if (polyLength(piece.pts) > 150) {
        t1Chains.push({ pts: piece.pts, deck: piece.keep });
      }
    }
  }
  const oriented: Chain[] = t1Chains.map((c, i) => {
    // right-hand running: the nearest parallel track must lie on the left
    let side = 0;
    for (let j = 0; j < t1Chains.length; j++) {
      if (j === i) {
        continue;
      }
      const o = t1Chains[j].pts;
      for (let k = 0; k < c.pts.length; k += Math.max(2, (c.pts.length >> 4) * 2)) {
        const pr = project(o, c.pts[k], c.pts[k + 1]);
        if (pr.d < 12) {
          const q = pointAt(o, pr.s);
          side += sideOf(c.pts, q[0], q[1]);
        }
      }
    }
    return side > 0 ? reverseChain(c) : c;
  });
  for (const c of oriented) {
    const m = mapDeck(c, decks);
    addTrack(m.pts, TrackLine.T1, m.deck);
  }

  /* T2: single track shuttle plus the passing-loop variant. */
  const t2 = data.rails.filter((r) => r.kind === 'tram' && r.routes?.includes('T2') && !r.tunnel && !r.service);
  const sidings = data.rails.filter((r) => r.kind === 'tram' && r.service === 'siding');
  const t2Chains = chainWays(t2, decks)
    .flatMap((c) => clipPolyline(c.pts, c.deck, rect).map((p) => ({ pts: p.pts, deck: p.keep })))
    .filter((c) => polyLength(c.pts) > 200)
    .sort((a, b) => polyLength(b.pts) - polyLength(a.pts));
  if (t2Chains.length) {
    const main = t2Chains[0].pts;
    const a = addTrack(main, TrackLine.T2, false);
    for (const sd of sidings) {
      const pa = project(main, sd.pts[0], sd.pts[1]);
      const pb = project(main, sd.pts[sd.pts.length - 2], sd.pts[sd.pts.length - 1]);
      if (pa.d > JOIN * 2 || pb.d > JOIN * 2 || Math.abs(pa.s - pb.s) < 20) {
        continue;
      }
      const loop = pa.s < pb.s ? sd.pts : reversePolyline(sd.pts);
      const s0 = Math.min(pa.s, pb.s);
      const s1 = Math.max(pa.s, pb.s);
      const L = polyLength(main);
      const variant = subPolyline(main, 0, s0).concat(loop.slice(2, loop.length - 2), subPolyline(main, s1, L));
      const b = addTrack(variant, TrackLine.T2, false);
      tracks[a].pair = b;
      tracks[b].pair = a;
      const Lv = polyLength(variant);
      tracks[a].single = [
        [0, s0],
        [s1, L],
      ];
      tracks[b].single = [
        [0, s0],
        [Lv - (L - s1), Lv],
      ];
      break;
    }
  }
  return { tracks, polylines };
}

/** Positions of the tram crossings on the tracks (TRAM_CROSSING_STRIDE floats each). */
export function mapTramCrossings(points: readonly OsmPoint[], build: TrackBuild): Float32Array {
  const out = new Float32Array(points.length * TRAM_CROSSING_STRIDE).fill(-1);
  points.forEach((p, i) => {
    let slot = 0;
    build.polylines.forEach((pl, t) => {
      if (slot >= TRAM_CROSSING_STRIDE / 2) {
        return;
      }
      const pr = project(pl, p.x, p.z);
      if (pr.d < 4) {
        out[i * TRAM_CROSSING_STRIDE + slot * 2] = t;
        out[i * TRAM_CROSSING_STRIDE + slot * 2 + 1] = pr.s;
        slot++;
      }
    });
  });
  return out;
}
