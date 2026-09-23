/**
 * Traffic signal controllers (main thread). The streets layer draws the signal poles and cycles their lamps in its
 * props shader (streets/materials.ts PROPS_GLOW): a 40 s cycle, phase = fract(uTime / 40 + cell hash of the pole),
 * green below 0.45, amber below 0.52, red after. The traffic follows the same clock so cars stop at the red lamps
 * that are drawn: the main phase group of a controller (the approach axis with the highest road rank, or the only
 * one at pedestrian signals) uses exactly that window, cross streets get their green while the main axis is red.
 */
import { MAX_GROUPS, type TrafficNet } from './protocol';

/** Head state bits. */
export const Lamp = { Red: 1, Amber: 2, Green: 4 } as const;

/** Cycle (s) and phase windows of the streets' signal lamps. */
const CYCLE = 40;
const MAIN_GREEN = 0.45;
const MAIN_AMBER = 0.52;
/** Cross-street window (fraction of the cycle) after the main amber plus an all-red gap. */
const CROSS_START = 0.56;
const CROSS_END = 0.97;
const AMBER_S = 2.8;

/** The streets layer's per-pole phase offset (same expression as its vertex shader). */
function poleOffset(x: number, z: number): number {
  const v = Math.floor(x / 40) * 0.137 + Math.floor(z / 40) * 0.071;
  return v - Math.floor(v);
}

export class Signals {
  /** Current state bits per head. */
  readonly state: Uint8Array;
  private readonly ctrlOffset: Float32Array;
  /** Per controller and group: rank order (0 = main group, 1.. = cross groups, 255 unused). */
  private readonly order: Uint8Array;
  private readonly crossCount: Uint8Array;
  private readonly groupState: Uint8Array;

  constructor(private readonly net: TrafficNet) {
    const H = net.headController.length;
    const C = net.ctrlGroups.length;
    this.state = new Uint8Array(H);
    this.ctrlOffset = new Float32Array(C);
    this.order = new Uint8Array(C * MAX_GROUPS).fill(255);
    this.crossCount = new Uint8Array(C);
    this.groupState = new Uint8Array(C * MAX_GROUPS);
    const rank = new Float32Array(C * MAX_GROUPS).fill(-1);
    const heads = new Uint16Array(C * MAX_GROUPS);
    for (let h = 0; h < H; h++) {
      const k = net.headController[h] * MAX_GROUPS + net.headGroup[h];
      rank[k] = Math.max(rank[k], net.headRank[h]);
      heads[k]++;
    }
    for (let c = 0; c < C; c++) {
      const groups: number[] = [];
      for (let g = 0; g < MAX_GROUPS; g++) {
        if (heads[c * MAX_GROUPS + g]) {
          groups.push(g);
        }
      }
      groups.sort((a, b) => rank[c * MAX_GROUPS + b] - rank[c * MAX_GROUPS + a] || heads[c * MAX_GROUPS + b] - heads[c * MAX_GROUPS + a]);
      groups.forEach((g, i) => {
        this.order[c * MAX_GROUPS + g] = i;
      });
      this.crossCount[c] = Math.max(0, groups.length - 1);
    }
    const mainHead = new Int32Array(C).fill(-1);
    for (let h = 0; h < H; h++) {
      const c = net.headController[h];
      if (mainHead[c] < 0 && this.order[c * MAX_GROUPS + net.headGroup[h]] === 0) {
        mainHead[c] = h;
      }
    }
    for (let c = 0; c < C; c++) {
      const h = mainHead[c];
      this.ctrlOffset[c] = h >= 0 ? poleOffset(net.headPos[h * 3], net.headPos[h * 3 + 2]) : 0;
    }
  }

  /** Recomputes every head for simulation time `t` (s, the engine's elapsed time = the shaders' uTime). */
  update(t: number): void {
    const net = this.net;
    const C = this.ctrlOffset.length;
    for (let c = 0; c < C; c++) {
      let phase = t / CYCLE + this.ctrlOffset[c];
      phase -= Math.floor(phase);
      const cross = this.crossCount[c];
      for (let g = 0; g < MAX_GROUPS; g++) {
        const o = this.order[c * MAX_GROUPS + g];
        let st: number = Lamp.Red;
        if (o === 0) {
          st = phase < MAIN_GREEN ? Lamp.Green : phase < MAIN_AMBER ? Lamp.Amber : Lamp.Red;
        } else if (o !== 255 && cross > 0) {
          const span = (CROSS_END - CROSS_START) / cross;
          const a = CROSS_START + (o - 1) * span;
          const amber = AMBER_S / CYCLE;
          if (phase >= a && phase < a + span - amber) {
            st = Lamp.Green;
          } else if (phase >= a + span - amber && phase < a + span) {
            st = Lamp.Amber;
          }
        }
        this.groupState[c * MAX_GROUPS + g] = st;
      }
    }
    const H = this.state.length;
    for (let h = 0; h < H; h++) {
      this.state[h] = this.groupState[net.headController[h] * MAX_GROUPS + net.headGroup[h]];
    }
  }

  /** True when a vehicle `dist` m before head `h`'s stop line at speed v must stop. */
  mustStop(h: number, dist: number, v: number): boolean {
    const st = this.state[h];
    if (st & Lamp.Green) {
      return false;
    }
    if (st === Lamp.Amber) {
      // stop only when the braking distance allows it; otherwise clear the junction
      return dist > (v * v) / (2 * 3.2) - 0.5;
    }
    return true;
  }
}
