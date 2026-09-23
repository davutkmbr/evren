/**
 * Trams on the OSM tracks (main thread).
 *
 * - T1: Alstom Citadis X04 coupled pairs (2 x 33 m, each unit cab - 2 intermediate - cab module) running one way per
 *   track at a regular headway, following each other, dwelling at the tram stops, entering and leaving at the edges
 *   of the build rect. Modules are articulated: each is posed from its two bogie points on the track.
 * - T2: two İstiklal nostalgic trams shuttling Taksim - Tünel in anti-phase on the main track and the passing-loop
 *   variant, so they meet in the Galatasaray loop.
 * Trams mark the tram crossings they approach or occupy so road traffic waits.
 */
import { MODEL_LENGTH, Model, paintOf } from './catalog';
import { VehicleState } from './materials';
import { SAMPLE_STRIDE, TrackLine, TRAM_CROSSING_STRIDE, type TrafficNet, type TramTrack } from './protocol';
import type { VehicleRenderer } from './render';

const CITADIS_UNIT: readonly { model: number; reverse: boolean }[] = [
  { model: Model.CitadisEnd, reverse: false },
  { model: Model.CitadisMid, reverse: false },
  { model: Model.CitadisMid, reverse: false },
  { model: Model.CitadisEnd, reverse: true },
];
const COUPLER = 0.7;
/** Distance of the bogie pivots from the module ends (m). */
const PIVOT = 1.3;
/** T1 headway (s) and the mean speed (m/s, stops included) that turns it into the initial spacing. */
const T1_HEADWAY = 150;
const T1_MEAN_SPEED = 6;
const T1_VMAX = 11;
const T2_VMAX = 4.2;

interface Tram {
  track: number;
  line: number;
  /** Front position (m along the track path); for T2 the position of the leading end in the travel direction. */
  s: number;
  v: number;
  dir: 1 | -1;
  dwell: number;
  nextStop: number;
  length: number;
  modules: { slot: number; model: number; reverse: boolean; offset: number; length: number; paint: [number, number, number]; state: number }[];
  alive: boolean;
}

export class TramSim {
  private readonly trams: Tram[] = [];
  private readonly spawnTimer: number[] = [];
  private lightsOn = false;
  decksReady = false;
  /** Tram crossings that are closed for road traffic (1) - shared with the car simulation. */
  readonly crossing: Uint8Array;

  constructor(
    private readonly net: TrafficNet,
    private readonly tracks: readonly TramTrack[],
    private readonly renderer: VehicleRenderer,
  ) {
    this.crossing = new Uint8Array(net.tramCrossing.length / TRAM_CROSSING_STRIDE);
    for (let t = 0; t < tracks.length; t++) {
      this.spawnTimer.push(T1_HEADWAY * (0.3 + 0.2 * t));
    }
  }

  private len(t: number): number {
    return this.net.pathLength[this.tracks[t].path];
  }

  private create(track: number, s: number, dir: 1 | -1): Tram {
    const line = this.tracks[track].line;
    const modules: Tram['modules'] = [];
    let offset = 0;
    const units = line === TrackLine.T1 ? [CITADIS_UNIT, CITADIS_UNIT] : [[{ model: Model.Nostalgic, reverse: false }]];
    units.forEach((unit, u) => {
      if (u > 0) {
        offset += COUPLER;
      }
      for (const m of unit) {
        const length = MODEL_LENGTH[m.model];
        const paint = paintOf(m.model, 0.5, 0.5);
        modules.push({ slot: this.renderer.allocate(m.model, paint, 0), model: m.model, reverse: m.reverse, offset, length, paint, state: 0 });
        offset += length;
      }
    });
    const tram: Tram = { track, line, s, v: 0, dir, dwell: 0, nextStop: 0, length: offset, modules, alive: true };
    this.seekStop(tram);
    this.trams.push(tram);
    return tram;
  }

  private seekStop(t: Tram): void {
    const stops = this.tracks[t.track].stops;
    const centre = t.s - (t.dir * t.length) / 2;
    t.nextStop = t.dir > 0 ? stops.findIndex((s) => s > centre + 1) : findLast(stops, (s) => s < centre - 1);
  }

  /** Initial trams spread along the tracks. */
  populate(): void {
    this.tracks.forEach((tr, ti) => {
      const L = this.len(ti);
      if (tr.line === TrackLine.T1) {
        const spacing = T1_HEADWAY * T1_MEAN_SPEED;
        for (let s = L - 150 - (ti * spacing) / 2.5; s > 80; s -= spacing) {
          const t = this.create(ti, s, 1);
          t.v = 6;
        }
      }
    });
    // T2: one tram at each end of the paired tracks
    const t2 = this.tracks.findIndex((t) => t.line === TrackLine.T2);
    if (t2 >= 0) {
      const a = this.create(t2, 0, 1);
      a.s = a.length;
      a.dwell = 20;
      const b0 = this.tracks[t2].pair >= 0 ? this.tracks[t2].pair : t2;
      const b = this.create(b0, this.len(b0), -1);
      b.s = this.len(b0) - b.length;
      b.dwell = 20;
      this.seekStop(a);
      this.seekStop(b);
    }
  }

  private capAt(track: number, s: number): number {
    const net = this.net;
    const p = this.tracks[track].path;
    const n = net.pathCount[p];
    const i = Math.min(n - 1, Math.max(0, Math.round(s / net.pathStep[p])));
    return net.samples[(net.pathStart[p] + i) * SAMPLE_STRIDE + 4] * 0.7;
  }

  update(dt: number, night: number): void {
    this.lightsOn = night > 0.28;
    if (dt > 0) {
      for (const t of this.trams) {
        if (t.alive) {
          this.step(t, dt);
        }
      }
      // T1 spawns at the track starts
      this.tracks.forEach((tr, ti) => {
        if (tr.line !== TrackLine.T1) {
          return;
        }
        this.spawnTimer[ti] -= dt;
        if (this.spawnTimer[ti] > 0) {
          return;
        }
        const clear = !this.trams.some((t) => t.alive && t.track === ti && t.s - t.length < 90);
        if (clear) {
          const t = this.create(ti, 0, 1);
          t.v = 7;
          this.spawnTimer[ti] = T1_HEADWAY * (0.85 + 0.3 * Math.random());
        }
      });
      for (let k = this.trams.length - 1; k >= 0; k--) {
        if (!this.trams[k].alive) {
          this.trams.splice(k, 1);
        }
      }
    }
    // crossings: closed while a tram is within 32 m before it or on it
    const tc = this.net.tramCrossing;
    this.crossing.fill(0);
    for (let c = 0; c < this.crossing.length; c++) {
      for (let k = 0; k < TRAM_CROSSING_STRIDE; k += 2) {
        const track = tc[c * TRAM_CROSSING_STRIDE + k];
        if (track < 0) {
          continue;
        }
        const sc = tc[c * TRAM_CROSSING_STRIDE + k + 1];
        for (const t of this.trams) {
          if (t.track !== track || !t.alive) {
            continue;
          }
          const ahead = (sc - t.s) * t.dir;
          const behind = (t.s - t.dir * t.length - sc) * t.dir;
          if (ahead < 32 && behind < 3) {
            this.crossing[c] = 1;
          }
        }
      }
    }
  }

  private step(t: Tram, dt: number): void {
    const L = this.len(t.track);
    const stops = this.tracks[t.track].stops;
    const T2 = t.line === TrackLine.T2;
    const vmax = T2 ? T2_VMAX : T1_VMAX;
    const a = T2 ? 0.55 : 1.0;
    const b = T2 ? 0.75 : 1.2;
    if (t.dwell > 0) {
      t.dwell -= dt;
      t.v = 0;
      if (t.dwell <= 0 && T2) {
        // reverse at a terminus: the leading end is now the other end of the car
        const atEnd = t.dir > 0 ? t.s >= L - 0.5 : t.s <= 0.5;
        if (atEnd) {
          t.dir = t.dir > 0 ? -1 : 1;
          t.s = t.dir > 0 ? t.length : L - t.length;
          this.seekStop(t);
        }
      }
      return;
    }
    // stopping target: next stop (tram centre at the stop), a terminus (T2), or the tram ahead
    let gap = Infinity;
    if (t.nextStop >= 0 && t.nextStop < stops.length) {
      const stopFront = stops[t.nextStop] + (t.dir * t.length) / 2;
      gap = (stopFront - t.s) * t.dir;
      if (gap < 0.4 && t.v < 0.3) {
        t.dwell = T2 ? 12 : 18 + Math.random() * 10;
        t.nextStop = t.dir > 0 ? t.nextStop + 1 : t.nextStop - 1;
        if (t.nextStop >= stops.length) {
          t.nextStop = -1;
        }
        return;
      }
    }
    if (T2) {
      const end = t.dir > 0 ? L : 0;
      const d = (end - t.s) * t.dir;
      if (d < gap) {
        gap = d;
      }
      if (d < 0.4 && t.v < 0.3) {
        t.s = end;
        t.dwell = 50;
        return;
      }
    }
    if (T2) {
      gap = Math.min(gap, this.singleTrackGap(t));
    }
    for (const o of this.trams) {
      if (o === t || !o.alive || o.track !== t.track || o.dir !== t.dir) {
        continue;
      }
      const d = ((o.s - t.dir * o.length - t.s) * t.dir);
      if (d > -1 && d < gap) {
        gap = d - 4;
      }
    }
    const cap = Math.min(vmax, this.capAt(t.track, t.s));
    const r = t.v / Math.max(cap, 0.5);
    let acc = a * (1 - r * r * r * r);
    if (gap < 200) {
      const sStar = 0.3 + Math.max(0, t.v * 1.2 + (t.v * t.v) / (2 * Math.sqrt(a * b)));
      const q = sStar / Math.max(gap, 0.05);
      acc -= a * q * q;
    }
    acc = Math.max(-3, Math.min(a, acc));
    t.v = Math.max(0, t.v + acc * dt);
    t.s += t.dir * t.v * dt;
    if (!T2 && t.s - t.length > L) {
      this.despawn(t);
    }
  }

  /** Distance to the entry of the next single-track section while the paired tram occupies it (T2 passing loop). */
  private singleTrackGap(t: Tram): number {
    const tr = this.tracks[t.track];
    const single = tr.single;
    if (tr.pair < 0 || !single) {
      return Infinity;
    }
    const other = this.trams.find((o) => o !== t && o.alive && o.track === tr.pair);
    const otherSingle = this.tracks[tr.pair].single;
    if (!other || !otherSingle) {
      return Infinity;
    }
    const span = (m: Tram): [number, number] => {
      const rear = m.s - m.dir * m.length;
      return [Math.min(m.s, rear), Math.max(m.s, rear)];
    };
    const [lo, hi] = span(t);
    const [olo, ohi] = span(other);
    let gap = Infinity;
    single.forEach(([a, b], k) => {
      if (hi > a && lo < b) {
        return;
      }
      const d = ((t.dir > 0 ? a : b) - t.s) * t.dir;
      const [oa, ob] = otherSingle[k];
      if (d > -0.1 && ohi > oa && olo < ob) {
        gap = Math.min(gap, d - 3);
      }
    });
    return gap;
  }

  private despawn(t: Tram): void {
    for (const m of t.modules) {
      this.renderer.release(m.slot);
    }
    t.alive = false;
  }

  private readonly pt = new Float32Array(8);

  private sample(track: number, s: number, o: number): void {
    const net = this.net;
    const p = this.tracks[track].path;
    const n = net.pathCount[p];
    const L = net.pathLength[p];
    const d = net.samples;
    const clamped = Math.min(L, Math.max(0, s));
    const f = Math.min(n - 1.0001, clamped / net.pathStep[p]);
    const i = f | 0;
    const u = f - i;
    const a = (net.pathStart[p] + i) * SAMPLE_STRIDE;
    const b = a + SAMPLE_STRIDE;
    const out = this.pt;
    out[o] = d[a] + (d[b] - d[a]) * u;
    out[o + 1] = d[a + 1] + (d[b + 1] - d[a + 1]) * u;
    out[o + 2] = d[a + 2] + (d[b + 2] - d[a + 2]) * u;
    out[o + 3] = 0;
    if (s !== clamped) {
      // extrapolate straight beyond the track ends
      const k = s - clamped;
      const j = Math.min(n - 1, Math.max(0, s > L ? n - 2 : 1));
      const c = (net.pathStart[p] + j) * SAMPLE_STRIDE;
      const e = (net.pathStart[p] + (s > L ? n - 1 : 0)) * SAMPLE_STRIDE;
      const dx = (d[e] - d[c]) / net.pathStep[p];
      const dz = (d[e + 2] - d[c + 2]) / net.pathStep[p];
      out[o] += dx * (s > L ? k : -k);
      out[o + 2] += dz * (s > L ? k : -k);
    }
  }

  place(rect: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    for (const t of this.trams) {
      if (!t.alive) {
        continue;
      }
      const deck = this.tracks[t.track].deck;
      for (const m of t.modules) {
        const front = t.s - t.dir * (m.offset + PIVOT);
        const rear = t.s - t.dir * (m.offset + m.length - PIVOT);
        this.sample(t.track, front, 0);
        this.sample(t.track, rear, 4);
        const P = this.pt;
        const x = (P[0] + P[4]) / 2;
        const y = (P[1] + P[5]) / 2;
        const z = (P[2] + P[6]) / 2;
        let fx = P[0] - P[4];
        let fy = P[1] - P[5];
        let fz = P[2] - P[6];
        const fl = Math.hypot(fx, fy, fz) || 1;
        fx /= fl;
        fy /= fl;
        fz /= fl;
        if (m.reverse) {
          fx = -fx;
          fy = -fy;
          fz = -fz;
        }
        let rx = -fz;
        let rz = fx;
        const rl = Math.hypot(rx, rz) || 1;
        rx /= rl;
        rz /= rl;
        const ux = -rz * fy;
        const uy = rz * fx - rx * fz;
        const uz = rx * fy;
        const inside = Math.min(x - rect.minX, rect.maxX - x, z - rect.minZ, rect.maxZ - z);
        const scale = Math.min(1, Math.max(0, inside / 14));
        this.renderer.place(m.slot, x, y + (t.line === TrackLine.T1 ? 0.02 : 0.02), z, fx, fy, fz, rx, 0, rz, ux, uy, uz, scale, deck && !this.decksReady);
        let st = 0;
        if (this.lightsOn) {
          st |= VehicleState.Lights | VehicleState.Interior;
        }
        if (t.v < 0.2) {
          st |= VehicleState.Brake;
        }
        if (st !== m.state) {
          m.state = st;
          this.renderer.setState(m.slot, m.paint, st);
        }
      }
    }
  }

  /** Debug: track, line, front station, direction, speed and dwell of every tram. */
  describe(): { track: number; line: number; s: number; dir: number; v: number; dwell: number; len: number }[] {
    return this.trams.filter((t) => t.alive).map((t) => ({ track: t.track, line: t.line, s: Math.round(t.s), dir: t.dir, v: +t.v.toFixed(1), dwell: Math.round(t.dwell), len: Math.round(this.len(t.track)) }));
  }

  get count(): number {
    return this.trams.length;
  }

  dispose(): void {
    for (const t of this.trams) {
      if (t.alive) {
        this.despawn(t);
      }
    }
    this.trams.length = 0;
  }
}

function findLast(a: readonly number[], f: (v: number) => boolean): number {
  for (let i = a.length - 1; i >= 0; i--) {
    if (f(a[i])) {
      return i;
    }
  }
  return -1;
}
