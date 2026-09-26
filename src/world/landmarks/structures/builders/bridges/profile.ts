/**
 * Vertical alignment of a bridge deck (road surface height vs. axis station s): a parabolic crest over the main
 * span, cubic Hermite side spans down to the end abutments and straight-grade approach viaducts that run on until
 * the road surface meets the ground. `terrain` is the visible ground (the OSM street ground where it exists, see
 * site-planner.ts), so abutments on land and approach ends meet the street exactly.
 */
import type { BridgeFrame } from '../../build/bridge-frame';
import type { HeightSampler } from '../../build/height-sampler';

interface Side {
  /** Station of the tower (signed) and of the end abutment. */
  sTower: number;
  sEnd: number;
  sApproach: number;
  hEnd: number;
  gEnd: number;
}

export interface ProfileSpec {
  /** Road surface height at midspan. */
  hMid: number;
  /** Vertical crest radius over the main span (m). */
  crestRadius: number;
  /** Tower stations (signed, A < 0 < B). */
  sTowerA: number;
  sTowerB: number;
  sEndA: number;
  sEndB: number;
  /** Maximum approach length beyond each end (m). */
  maxApproach: number;
  maxGrade: number;
  /** Deck depth below the road surface (for terrain clearance). */
  depth: number;
  /** Lowest allowed road height at the end abutments (quays). */
  minEnd?: number;
  /** Half width of the deck (m): hillside landings prefer a gentle slope across it. */
  halfWidth?: number;
}

/** The approach ends where the road surface is at most this far (m) above the ground on the axis. */
const APPROACH_FLUSH = 0.01;
/** Ground height (m) above which an abutment stands on land (sea floor is negative, quays about 1 m). */
const LAND_MIN = 0.3;
/** Distance (m) beyond a deck's nominal end within which an abutment on land is looked for. */
const ABUTMENT_SEARCH = 30;
/** Share of a side span (from its nominal end inward) searched for a hillside landing. */
const HILL_SEARCH = 0.6;
/** Largest climb of a side span landing on a hillside, as a share of maxGrade x its length. */
const HILL_RISE = 0.85;
/** A hillside landing is taken as soon as the ground across the deck stays within this (m) of its axis height. */
const HILL_CROSS = 1;

export class DeckProfile {
  readonly hMid: number;
  readonly crest: number;
  private a: Side;
  private b: Side;

  constructor(
    private readonly spec: ProfileSpec,
    frame: BridgeFrame,
    terrain: HeightSampler,
  ) {
    this.hMid = spec.hMid;
    this.crest = spec.crestRadius;
    this.a = this.solveSide(spec.sTowerA, spec.sEndA, frame, terrain);
    this.b = this.solveSide(spec.sTowerB, spec.sEndB, frame, terrain);
  }

  get startS(): number {
    return this.a.sApproach;
  }

  get endS(): number {
    return this.b.sApproach;
  }

  get endA(): number {
    return this.a.sEnd;
  }

  get endB(): number {
    return this.b.sEnd;
  }

  private mainHeight(s: number): number {
    return this.hMid - (s * s) / (2 * this.crest);
  }

  private solveSide(sTower: number, sEnd: number, frame: BridgeFrame, terrain: HeightSampler): Side {
    const dir = Math.sign(sEnd - sTower) || 1;
    const side = Math.abs(sEnd - sTower);
    const hT = this.mainHeight(sTower);
    const groundAt = (d: number): number => {
      const p = frame.point(sEnd + dir * d, 0, 0);
      return terrain.heightAt(p.x, p.z);
    };
    const g = this.spec.maxGrade;
    // Abutment on land (at the nominal end or within ABUTMENT_SEARCH beyond it, e.g. behind a quay wall): when the
    // deck can come down to the ground there, it lands flush on it and ends, so it meets the street exactly. The chord
    // slope as end tangent keeps the side span monotone (no dip under the ground just before the joint).
    for (let d = 0; d <= ABUTMENT_SEARCH; d++) {
      const ground = groundAt(d);
      if (ground <= LAND_MIN) {
        continue;
      }
      const e = sEnd + dir * d;
      const len = Math.abs(e - sTower);
      if (ground > hT + g * len * 0.4) {
        break;
      }
      if (ground >= hT - g * len * 0.85 - APPROACH_FLUSH) {
        return { sTower, sEnd: e, sApproach: e, hEnd: ground, gEnd: Math.max(-g, Math.min(g, (ground - hT) / len)) };
      }
    }
    // A hillside above anything the side span can climb to at its nominal end (the European ends of the upper
    // Bosphorus bridges, where the approach road runs in on the slope): the deck lands where the slope comes down to
    // a height it can reach, inward from the nominal end, so the road meets the ground instead of ending inside it.
    // Of the stations it can reach, the one where the slope across the deck is gentlest wins (the joint twists the
    // deck into the ground across its width; a steep cross-fall would leave its edges in or above the slope).
    if (groundAt(0) > hT + g * side * 0.4) {
      const hw = this.spec.halfWidth ?? 0;
      let best: Side | null = null;
      let bestCross = Infinity;
      for (let d = -1; d > -side * HILL_SEARCH; d--) {
        const ground = groundAt(d);
        const e = sEnd + dir * d;
        const len = Math.abs(e - sTower);
        if (!(ground > LAND_MIN && ground <= hT + g * len * HILL_RISE && ground >= hT - g * len * 0.85)) {
          continue;
        }
        let cross = 0;
        for (const x of [-hw, -hw / 2, hw / 2, hw]) {
          const p = frame.point(e, x, 0);
          cross = Math.max(cross, Math.abs(terrain.heightAt(p.x, p.z) - ground));
        }
        if (cross < bestCross - 1e-3) {
          bestCross = cross;
          best = { sTower, sEnd: e, sApproach: e, hEnd: ground, gEnd: Math.max(-g, Math.min(g, (ground - hT) / len)) };
        }
        if (cross <= HILL_CROSS) {
          break;
        }
      }
      if (best) {
        return best;
      }
    }
    const ground = groundAt(0);
    const hEnd = Math.max(Math.min(Math.max(ground + 0.8, hT - g * side * 0.85), hT + g * side * 0.4), this.spec.minEnd ?? -Infinity);
    let gEnd = (hEnd - hT) / side;
    gEnd = Math.max(-g, Math.min(g, gEnd * 1.25));
    // The approach viaduct runs on until the terrain reaches the road surface, so the road meets the ground flush
    // (the girder below ends buried in the slope).
    const above = (d: number): number => {
      const p = frame.point(sEnd + dir * d, 0, 0);
      return hEnd + gEnd * d - terrain.heightAt(p.x, p.z);
    };
    let reach = 0;
    const step = 4;
    for (let d = step; d <= this.spec.maxApproach; d += step) {
      reach = d;
      if (above(d) <= APPROACH_FLUSH) {
        let lo = d - step;
        let hi = d;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          if (above(mid) <= APPROACH_FLUSH) {
            hi = mid;
          } else {
            lo = mid;
          }
        }
        reach = hi;
        break;
      }
    }
    return { sTower, sEnd, sApproach: sEnd + dir * reach, hEnd, gEnd };
  }

  /** Road surface height at station s. */
  height(s: number): number {
    if (s >= this.spec.sTowerA && s <= this.spec.sTowerB) {
      return this.mainHeight(s);
    }
    const side = s < 0 ? this.a : this.b;
    const dir = Math.sign(side.sEnd - side.sTower);
    const d = (s - side.sTower) * dir;
    const len = Math.abs(side.sEnd - side.sTower);
    if (d <= len) {
      const t = d / len;
      const h0 = this.mainHeight(side.sTower);
      const m0 = (-side.sTower / this.crest) * dir * len;
      const m1 = side.gEnd * len;
      const t2 = t * t;
      const t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * h0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * side.hEnd + (t3 - t2) * m1;
    }
    return side.hEnd + side.gEnd * (d - len);
  }

  /** dy/ds at station s (numerical). */
  grade(s: number): number {
    return (this.height(s + 0.5) - this.height(s - 0.5)) / 1;
  }
}
