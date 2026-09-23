/**
 * Vertical alignment of a bridge deck (road surface height vs. axis station s): a parabolic crest over the main
 * span, cubic Hermite side spans down to the end abutments and straight-grade approach viaducts that run on until
 * they meet the terrain.
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
}

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
    const ground = terrain.heightAt(frame.point(sEnd, 0, 0).x, frame.point(sEnd, 0, 0).z);
    const g = this.spec.maxGrade;
    const hEnd = Math.max(Math.min(Math.max(ground + 0.8, hT - g * side * 0.85), hT + g * side * 0.4), this.spec.minEnd ?? -Infinity);
    let gEnd = (hEnd - hT) / side;
    gEnd = Math.max(-g, Math.min(g, gEnd * 1.25));
    let sApproach = sEnd;
    const step = 8;
    for (let d = step; d <= this.spec.maxApproach; d += step) {
      const s = sEnd + dir * d;
      const h = hEnd + gEnd * d;
      const p = frame.point(s, 0, 0);
      const t = terrain.heightAt(p.x, p.z);
      sApproach = s;
      if (t > h - this.spec.depth * 0.5) {
        break;
      }
    }
    return { sTower, sEnd, sApproach, hEnd, gEnd };
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
