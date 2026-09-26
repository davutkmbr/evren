/**
 * Per-step parameters of the foam simulation (phase 21 stage 7c), shared by the GPU pass (foam-gpu.ts) and the CPU
 * port in the headless foam check, so both run the same numbers.
 */
import { FOAM_SIM, WHITECAPS } from './config';
import type { WhitecapSet } from './whitecaps';

export interface FoamStepParams {
  /** Step (s). */
  dt: number;
  /** Per-step keep factors of the four channels (fresh foam, wake foam, bubbles, slick). */
  keepR: number;
  keepG: number;
  keepB: number;
  keepA: number;
  /** Per-step fill of breaking crests, breaking particle crests and surf. */
  fillCap: number;
  fillParticle: number;
  fillSurf: number;
  /**
   * Whitecaps (see whitecaps.ts): breaking probability of a crest at the open sea (0: none), the open sea's mean
   * frequency, the soft edge cap, the cells' clock (s, wrapped) and the downwind direction the cells ride along.
   */
  capProb: number;
  omegaOpen: number;
  edge: number;
  capTime: number;
  windX: number;
  windZ: number;
  capToWake: number;
  particleToWake: number;
  /** Wind drift of the foam (m/s). */
  driftX: number;
  driftZ: number;
  particleBreak: number;
  particleEdge: number;
  surfBand: number;
  surfCrest: number;
  fadeFrom: number;
  fadeTo: number;
}

export function createFoamStepParams(): FoamStepParams {
  return {
    dt: FOAM_SIM.step,
    keepR: 1,
    keepG: 1,
    keepB: 1,
    keepA: 1,
    fillCap: 0,
    fillParticle: 0,
    fillSurf: 0,
    capProb: 0,
    omegaOpen: 1,
    capTime: 0,
    windX: 1,
    windZ: 0,
    edge: 0.02,
    capToWake: 0,
    particleToWake: 0,
    driftX: 0,
    driftZ: 0,
    particleBreak: FOAM_SIM.particleBreak,
    particleEdge: FOAM_SIM.particleEdge,
    surfBand: FOAM_SIM.surfBand,
    surfCrest: FOAM_SIM.surfCrest,
    fadeFrom: FOAM_SIM.minTexels,
    fadeTo: FOAM_SIM.fullTexels,
  };
}

/**
 * Fills `out` for one fixed step: decay from the channel lifetimes, fills from the source rates, the whitecap set
 * (WhitecapModel.sim with the open sea's mean frequency) at the field's clock `time`, and the wind drift (U10 along
 * the downwind direction).
 */
export function foamStepParams(caps: WhitecapSet, omegaOpen: number, time: number, u10: number, windX: number, windZ: number, out: FoamStepParams): FoamStepParams {
  const S = FOAM_SIM;
  const dt = S.step;
  out.dt = dt;
  out.keepR = Math.exp(-dt / S.capLife);
  out.keepG = Math.exp(-dt / S.wakeLife);
  out.keepB = Math.exp(-dt / S.bubbleLife);
  out.keepA = Math.exp(-dt / S.slickLife);
  out.fillCap = 1 - Math.exp(-S.capRate * dt);
  out.fillParticle = 1 - Math.exp(-S.capRate * dt);
  out.fillSurf = 1 - Math.exp(-S.surfRate * dt);
  out.capProb = Number.isFinite(caps.prob) ? caps.prob : 0;
  out.omegaOpen = omegaOpen;
  out.capTime = Number.isFinite(time) ? ((time % WHITECAPS.timeWrap) + WHITECAPS.timeWrap) % WHITECAPS.timeWrap : 0;
  out.edge = WHITECAPS.edge;
  out.capToWake = S.capToWake;
  out.particleToWake = S.particleToWake;
  const wl = Math.hypot(windX, windZ);
  const drift = Number.isFinite(u10) ? S.windDrift * Math.max(0, u10) : 0;
  out.windX = wl > 1e-6 ? windX / wl : 1;
  out.windZ = wl > 1e-6 ? windZ / wl : 0;
  out.driftX = out.windX * drift;
  out.driftZ = out.windZ * drift;
  out.particleBreak = S.particleBreak;
  out.particleEdge = S.particleEdge;
  out.surfBand = S.surfBand;
  out.surfCrest = S.surfCrest;
  out.fadeFrom = S.minTexels;
  out.fadeTo = S.fullTexels;
  return out;
}
