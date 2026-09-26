/**
 * CPU port of the foam field shaders (phase 21 stage 7c) for the headless foam check: FOAM_SIM_FRAG and the stamp pass
 * (FOAM_STAMP_VERT / FRAG) evaluated per texel in doubles, driven by the real FoamWindow bookkeeping, the real step
 * parameters (foam/params.ts), the real sea (SeaState uniforms + the water service's group weights, coast and current)
 * and the real wave particles. Keep in step with src/world/water/foam/shaders.glsl.ts.
 *
 * Speed: the Gerstner slots are evaluated from per-texel sin/cos tables of the spatial phase (rebuilt when the window
 * moves or the shading origin changes), sin(a + b) = sin a cos b + cos a sin b with the slot's phase of the moment;
 * `ambientExact` evaluates the same texel through WaveQuery.lagrangianAt (the parity check between the two).
 */
import type { WaterDynamicSample } from '../../src/core/contracts';
import { GRAVITY, MAX_WAVES } from '../../src/world/water/config';
import { breakCell, crestEdge, crestZ, localBreakProbability } from '../../src/world/water/foam/whitecaps';
import type { FoamStepParams } from '../../src/world/water/foam/params';
import type { FoamWindow } from '../../src/world/water/foam/foam-window';
import type { SeaStateUniforms } from '../../src/world/water/sea-state';
import type { WaveQuery } from '../../src/world/water/wave-query';
import type { WaveParticles } from '../../src/world/water/particles/wave-particles';

function smoothstep(e0: number, e1: number, x: number): number {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface FoamPortEnv {
  /** The sea's wave uniforms (the slot table the shaders read) and the shading origin they are relative to. */
  uniforms: Pick<SeaStateUniforms, 'uWaveDir' | 'uWaveAmp'> | null;
  originX: number;
  originZ: number;
  /** Group weights (short, long, swell, chop) at a point (WaveQuery.groupWeightsAt), null = open water, no waves. */
  waves: WaveQuery | null;
  /** Signed coast distance (m, negative over water). */
  coast: (x: number, z: number) => number;
  /** Surface current (m/s). */
  current: (x: number, z: number, out: { x: number; z: number }) => void;
  /** Wave particles (the splat the GPU reads), or null. */
  particles: WaveParticles | null;
}

const newDyn = (): WaterDynamicSample => ({ height: 0, slopeX: 0, slopeZ: 0, vx: 0, vy: 0, vz: 0 });

export class FoamPort {
  size = 0;
  texel = 1;
  cur = new Float64Array(0);
  nxt = new Float64Array(0);
  /** Per texel static data: group weights (4), coast, current x/z. */
  private stat = new Float64Array(0);
  private sinT = new Float32Array(0);
  private cosT = new Float32Array(0);
  private tableKey = '';
  private readonly gw = new Float64Array(4);
  private readonly cxz = { x: 0, z: 0 };
  private readonly dyn = newDyn();
  /** Last step's diagnostics: breaking texels, particle-breaking texels, surf texels. */
  lastBreaking = 0;
  lastParticle = 0;
  lastSurf = 0;

  constructor(private readonly win: FoamWindow) {
    this.resize();
  }

  private resize(): void {
    if (this.size === this.win.size && this.texel === this.win.texel) {
      return;
    }
    this.size = this.win.size;
    this.texel = this.win.texel;
    const n = this.size * this.size * 4;
    this.cur = new Float64Array(n);
    this.nxt = new Float64Array(n);
    this.tableKey = '';
  }

  /** World centre of texel (i, j) of the current window. */
  texelX(i: number): number {
    return this.win.minX + (i + 0.5) * this.texel;
  }

  texelZ(j: number): number {
    return this.win.minZ + (j + 0.5) * this.texel;
  }

  private buildTables(env: FoamPortEnv): void {
    const key = `${this.win.originX},${this.win.originZ},${env.originX},${env.originZ},${this.size},${this.texel},${env.uniforms ? 1 : 0}`;
    if (key === this.tableKey) return;
    this.tableKey = key;
    const n = this.size * this.size;
    this.stat = new Float64Array(n * 7);
    this.sinT = new Float32Array(env.uniforms ? n * MAX_WAVES : 0);
    this.cosT = new Float32Array(env.uniforms ? n * MAX_WAVES : 0);
    const dirs = env.uniforms?.uWaveDir.value;
    for (let j = 0; j < this.size; j++) {
      const z = this.texelZ(j);
      for (let i = 0; i < this.size; i++) {
        const x = this.texelX(i);
        const t = j * this.size + i;
        const o = t * 7;
        if (env.waves) {
          env.waves.groupWeightsAt(x, z, this.gw);
        } else {
          this.gw.fill(0);
        }
        this.stat[o] = this.gw[0];
        this.stat[o + 1] = this.gw[1];
        this.stat[o + 2] = this.gw[2];
        this.stat[o + 3] = this.gw[3];
        this.stat[o + 4] = env.coast(x, z);
        env.current(x, z, this.cxz);
        this.stat[o + 5] = this.cxz.x;
        this.stat[o + 6] = this.cxz.z;
        if (dirs) {
          const xo = x - env.originX;
          const zo = z - env.originZ;
          for (let s = 0; s < MAX_WAVES; s++) {
            const d = dirs[s];
            const ph = d.z * (d.x * xo + d.y * zo);
            this.sinT[t * MAX_WAVES + s] = Math.sin(ph);
            this.cosT[t * MAX_WAVES + s] = Math.cos(ph);
          }
        }
      }
    }
  }

  /** The previous state with zero outside the window (foamPrev). */
  private prev(i: number, j: number, c: number): number {
    const n = this.size;
    if (i < 0 || j < 0 || i >= n || j >= n) return 0;
    return this.cur[(j * n + i) * 4 + c];
  }

  /** Runs one GPU frame's worth: the window's steps (scroll + clear in the first) and then its stamps. */
  frame(env: FoamPortEnv, p: FoamStepParams): void {
    this.resize();
    const w = this.win;
    if (!w.enabled) return;
    const steps = w.steps > 0 ? w.steps : w.needsClear ? 1 : 0;
    for (let s = 0; s < steps; s++) {
      const first = s === 0;
      this.step(env, p, first ? w.shiftX : 0, first ? w.shiftZ : 0, first && w.needsClear, w.steps > 0);
    }
    this.stamps();
    w.consumed();
  }

  /** FOAM_SIM_FRAG over the whole window. */
  step(env: FoamPortEnv, p: FoamStepParams, shiftX: number, shiftZ: number, clear: boolean, advance: boolean): void {
    this.buildTables(env);
    const n = this.size;
    const texel = this.texel;
    const out = this.nxt;
    const amps = env.uniforms?.uWaveAmp.value;
    const dirs = env.uniforms?.uWaveDir.value;
    // Per slot of this step: cos / sin of the phase at the origin, amplitude, Q k A, group, fade, drift factor.
    const slotC = new Float64Array(MAX_WAVES);
    const slotS = new Float64Array(MAX_WAVES);
    const slotA = new Float64Array(MAX_WAVES);
    const slotQ = new Float64Array(MAX_WAVES);
    const slotG = new Int32Array(MAX_WAVES);
    const slotF = new Float64Array(MAX_WAVES);
    const slotW = new Float64Array(MAX_WAVES);
    const slotO = new Float64Array(MAX_WAVES);
    let slots = 0;
    const idx = new Int32Array(MAX_WAVES);
    if (amps && dirs) {
      for (let s = 0; s < MAX_WAVES; s++) {
        const a = amps[s];
        if (!(a.x > 0)) continue;
        const d = dirs[s];
        idx[slots] = s;
        slotC[slots] = Math.cos(a.z);
        slotS[slots] = Math.sin(a.z);
        slotA[slots] = a.x;
        slotQ[slots] = a.y;
        slotG[slots] = a.w < 0.5 ? 0 : a.w < 1.5 ? 1 : a.w < 2.5 ? 2 : 3;
        slotF[slots] = smoothstep(p.fadeFrom * texel, p.fadeTo * texel, d.w);
        slotW[slots] = Math.sqrt(GRAVITY * d.z) * d.z;
        slotO[slots] = Math.sqrt(GRAVITY * d.z);
        slots++;
      }
    }
    let breaking = 0;
    let pb = 0;
    let sf = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const t = j * n + i;
        const o4 = t * 4;
        if (!advance) {
          for (let c = 0; c < 4; c++) out[o4 + c] = clear ? 0 : this.prev(i + shiftX, j + shiftZ, c);
          continue;
        }
        const so = t * 7;
        const coast = this.stat[so + 4];
        const land = smoothstep(0, 25, coast);
        const keep = 1 - land;
        let jxx = 0;
        let jxz = 0;
        let jzz = 0;
        let h = 0;
        let var2 = 0;
        let m1 = 0;
        let q2 = 0;
        let q4 = 0;
        let stx = 0;
        let stz = 0;
        for (let k = 0; k < slots; k++) {
          const g = this.stat[so + slotG[k]];
          if (g <= 0) continue;
          const s0 = idx[k];
          const d = dirs![s0];
          // sin(k D.xo + phase) from the spatial table.
          const s = this.sinT[t * MAX_WAVES + s0] * slotC[k] + this.cosT[t * MAX_WAVES + s0] * slotS[k];
          const A = slotA[k] * g;
          h += A * s;
          var2 += A * A;
          m1 += A * A * slotO[k];
          const dr = A * A * slotW[k];
          stx += d.x * dr;
          stz += d.y * dr;
          const f = slotF[k];
          if (f <= 0) continue;
          const qf = slotQ[k] * g * f;
          const qq = qf * qf;
          q2 += qq;
          q4 += qq * qq;
          const qs = qf * s;
          jxx += d.x * d.x * qs;
          jxz += d.x * d.y * qs;
          jzz += d.y * d.y * qs;
        }
        const ja = 1 - jxx * keep;
        const jc = 1 - jzz * keep;
        const jb = jxz * keep;
        const J = ja * jc - jb * jb;
        h = h * keep - land * 1.5;
        const hs = 4 * Math.sqrt(var2 * 0.5) * keep;
        stx *= keep;
        stz *= keep;
        const vx = this.stat[so + 5] + stx + p.driftX;
        const vz = this.stat[so + 6] + stz + p.driftZ;
        const srcX = i + 0.5 + shiftX - vx * (p.dt / texel);
        const srcZ = j + 0.5 + shiftZ - vz * (p.dt / texel);
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        if (!clear) {
          const sx = srcX - 0.5;
          const sz = srcZ - 0.5;
          const bx = Math.floor(sx);
          const bz = Math.floor(sz);
          const wx = sx - bx;
          const wz = sz - bz;
          const v = [0, 0, 0, 0];
          for (let c = 0; c < 4; c++) {
            const v00 = this.prev(bx, bz, c);
            const v10 = this.prev(bx + 1, bz, c);
            const v01 = this.prev(bx, bz + 1, c);
            const v11 = this.prev(bx + 1, bz + 1, c);
            v[c] = (v00 + (v10 - v00) * wx) * (1 - wz) + (v01 + (v11 - v01) * wx) * wz;
          }
          r = v[0] * p.keepR;
          g = v[1] * p.keepG;
          b = v[2] * p.keepB;
          a = v[3] * p.keepA;
        }
        let brk = 0;
        const sigL = Math.sqrt(0.5 * q2) * keep;
        if (p.capProb > 0 && sigL > 1e-5 && m1 > 0) {
          const omL = m1 / var2;
          const jth = 1 - crestZ((q2 * q2) / Math.max(q4, 1e-20)) * sigL;
          const edge = crestEdge(sigL);
          const crestMask = 1 - smoothstep(jth - edge, jth + edge, J);
          if (crestMask > 0) {
            const prob = localBreakProbability(p.capProb, p.omegaOpen, omL);
            brk = crestMask * (breakCell(this.texelX(i), this.texelZ(j), p.capTime, p.windX, p.windZ, GRAVITY / omL, prob) ? 1 : 0);
          }
        }
        let pBrk = 0;
        let hp = 0;
        if (env.particles && env.particles.count > 0) {
          const x = this.texelX(i);
          const z = this.texelZ(j);
          env.particles.sample(x, z, this.dyn);
          hp = this.dyn.height;
          pBrk = smoothstep(p.particleBreak - p.particleEdge, p.particleBreak + p.particleEdge, Math.hypot(this.dyn.slopeX, this.dyn.slopeZ)) * (hp >= 0 ? 1 : 0);
        }
        const offshore = -coast;
        const band = (1 - smoothstep(p.surfBand * 0.4, p.surfBand, offshore)) * smoothstep(-4, 1, offshore);
        const crest = smoothstep(p.surfCrest, p.surfCrest * 2.5, (h + hp) / Math.max(hs + 2 * Math.abs(hp), 0.05));
        const surf = band * crest * smoothstep(0.05, 0.6, hs + 2 * Math.abs(hp));
        const fc = p.fillCap * brk;
        const fp = p.fillParticle * pBrk;
        const fs = p.fillSurf * surf;
        if (brk > 0.5) breaking++;
        if (pBrk > 0.5) pb++;
        if (surf > 0.5) sf++;
        r += (1 - r) * clamp01(fc + fp + fs);
        g += (1 - g) * clamp01(fc * p.capToWake + fp * p.particleToWake + fs * 0.3);
        b += (1 - b) * clamp01(fc + fp + fs * 0.6);
        const sea = 1 - smoothstep(0, 4, coast);
        out[o4] = clamp01(r * sea);
        out[o4 + 1] = clamp01(g * sea);
        out[o4 + 2] = clamp01(b * sea);
        out[o4 + 3] = clamp01(a * sea);
      }
    }
    this.lastBreaking = breaking;
    this.lastParticle = pb;
    this.lastSurf = sf;
    const tmp = this.cur;
    this.cur = this.nxt;
    this.nxt = tmp;
  }

  /** The stamp pass (max blend) with the window's queued stamps. */
  stamps(): void {
    const w = this.win;
    const n = this.size;
    const texel = this.texel;
    for (let k = 0; k < w.count; k++) {
      const s = w.stamps[k];
      const ax = s.x0 - w.minX;
      const az = s.z0 - w.minZ;
      const bx = s.x1 - w.minX;
      const bz = s.z1 - w.minZ;
      const r = Math.max(s.r0, s.r1) + s.ring + texel;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r) / texel));
      const i1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + r) / texel));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - r) / texel));
      const j1 = Math.min(n - 1, Math.ceil((Math.max(az, bz) + r) / texel));
      const bax = bx - ax;
      const baz = bz - az;
      const bb = Math.max(bax * bax + baz * baz, 1e-6);
      for (let j = j0; j <= j1; j++) {
        const pz = (j + 0.5) * texel;
        for (let i = i0; i <= i1; i++) {
          const px = (i + 0.5) * texel;
          const pax = px - ax;
          const paz = pz - az;
          const t = clamp01((pax * bax + paz * baz) / bb);
          const d = Math.hypot(pax - bax * t, paz - baz * t);
          const rr = s.r0 + (s.r1 - s.r0) * t;
          const wgt = s.ring > 0 ? 1 - smoothstep(0.5 * s.ring, 0.5 * s.ring + texel, Math.abs(d - rr)) : 1 - smoothstep(rr * 0.55, rr, d);
          if (wgt <= 0) continue;
          const o = (j * n + i) * 4;
          this.cur[o] = Math.max(this.cur[o], s.foam * wgt);
          this.cur[o + 1] = Math.max(this.cur[o + 1], s.wake * wgt);
          this.cur[o + 2] = Math.max(this.cur[o + 2], s.bubbles * wgt);
          this.cur[o + 3] = Math.max(this.cur[o + 3], s.slick * wgt);
        }
      }
    }
  }

  /** Field value (channel c) at a world point, bilinear like the water shader's lookup (no edge fade). */
  at(x: number, z: number, c: number): number {
    const sx = (x - this.win.minX) / this.texel - 0.5;
    const sz = (z - this.win.minZ) / this.texel - 0.5;
    const bx = Math.floor(sx);
    const bz = Math.floor(sz);
    const wx = sx - bx;
    const wz = sz - bz;
    const n = this.size;
    const g = (i: number, j: number): number => (i < 0 || j < 0 || i >= n || j >= n ? 0 : this.cur[(j * n + i) * 4 + c]);
    return (g(bx, bz) * (1 - wx) + g(bx + 1, bz) * wx) * (1 - wz) + (g(bx, bz + 1) * (1 - wx) + g(bx + 1, bz + 1) * wx) * wz;
  }

  /** Sum of a channel over the window (texel units). */
  sum(c: number): number {
    let s = 0;
    for (let t = c; t < this.cur.length; t += 4) s += this.cur[t];
    return s;
  }

  max(c: number): number {
    let m = 0;
    for (let t = c; t < this.cur.length; t += 4) m = Math.max(m, this.cur[t]);
    return m;
  }

  /** Any non-finite value. */
  bad(): boolean {
    for (let t = 0; t < this.cur.length; t++) if (!Number.isFinite(this.cur[t])) return true;
    return false;
  }

  clear(): void {
    this.cur.fill(0);
    this.nxt.fill(0);
  }

  /**
   * The same texel through WaveQuery.lagrangianAt (exact path): Jacobian, height, Hs, Stokes drift — the fast tables'
   * parity reference.
   */
  ambientTexel(env: FoamPortEnv, i: number, j: number, p: FoamStepParams): { J: number; h: number; hs: number; stx: number; stz: number; sigma: number; nEff: number; omega: number } {
    this.buildTables(env);
    const n = this.size;
    const t = j * n + i;
    const so = t * 7;
    const amps = env.uniforms!.uWaveAmp.value;
    const dirs = env.uniforms!.uWaveDir.value;
    const coast = this.stat[so + 4];
    const land = smoothstep(0, 25, coast);
    const keep = 1 - land;
    let jxx = 0;
    let jxz = 0;
    let jzz = 0;
    let h = 0;
    let var2 = 0;
    let m1 = 0;
    let q2 = 0;
    let q4 = 0;
    let stx = 0;
    let stz = 0;
    for (let s0 = 0; s0 < MAX_WAVES; s0++) {
      const a = amps[s0];
      if (!(a.x > 0)) continue;
      const d = dirs[s0];
      const gi = a.w < 0.5 ? 0 : a.w < 1.5 ? 1 : a.w < 2.5 ? 2 : 3;
      const g = this.stat[so + gi];
      if (g <= 0) continue;
      const s = this.sinT[t * MAX_WAVES + s0] * Math.cos(a.z) + this.cosT[t * MAX_WAVES + s0] * Math.sin(a.z);
      const A = a.x * g;
      h += A * s;
      var2 += A * A;
      m1 += A * A * Math.sqrt(GRAVITY * d.z);
      const dr = A * A * Math.sqrt(GRAVITY * d.z) * d.z;
      stx += d.x * dr;
      stz += d.y * dr;
      const f = smoothstep(p.fadeFrom * this.texel, p.fadeTo * this.texel, d.w);
      if (f <= 0) continue;
      q2 += (a.y * g * f) ** 2;
      q4 += (a.y * g * f) ** 4;
      const qs = a.y * g * f * s;
      jxx += d.x * d.x * qs;
      jxz += d.x * d.y * qs;
      jzz += d.y * d.y * qs;
    }
    const ja = 1 - jxx * keep;
    const jc = 1 - jzz * keep;
    const jb = jxz * keep;
    return { J: ja * jc - jb * jb, h: h * keep - land * 1.5, hs: 4 * Math.sqrt(var2 * 0.5) * keep, stx: stx * keep, stz: stz * keep, sigma: Math.sqrt(0.5 * q2) * keep, nEff: q4 > 0 ? (q2 * q2) / q4 : 1, omega: var2 > 0 ? m1 / var2 : 0 };
  }
}
