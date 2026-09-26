/**
 * The dragon as a wave source (phase 21 stage 7a): reads the dragon's state and the low-flight model (both only read)
 * once per frame and feeds the wave particles:
 * - swimming: the body is a displacement hull moving through the water (bow and stern waves, a Kelvin wake);
 * - skimming: the contact patch under the belly is a small planing hull while the low-flight wake is on;
 * - each downstroke that reaches the water (a low-flight gust ring) starts a faint ring;
 * - splash events (skim contacts, plunges, breaches, swimming strokes) start ring trains; the nostril bubbles under
 *   water do not.
 */
import * as THREE from 'three';
import type { DragonState, WaterService } from '../../../core/contracts';
import type { LowFlightModel } from '../lowflight/low-flight';
import { DRAGON_WAVES, WATER_SOURCE } from './config';
import type { WaveParticles } from './wave-particles';

export class DragonWaves {
  private gusts = -1;
  private readonly current = new THREE.Vector3();

  constructor(private readonly particles: WaveParticles) {}

  update(dragon: DragonState | null | undefined, low: LowFlightModel, water: WaterService | null): void {
    const P = this.particles;
    const D = DRAGON_WAVES;
    if (!dragon) {
      this.gusts = -1;
      return;
    }
    const p = dragon.position;
    const v = dragon.velocity;
    if (dragon.mode === 'swimming') {
      let ux = v.x;
      let uz = v.z;
      if (water) {
        water.currentAt(p.x, p.z, this.current);
        ux -= this.current.x;
        uz -= this.current.z;
      }
      const u = Math.hypot(ux, uz);
      if (u > 0.3) {
        P.hull(WATER_SOURCE.dragon, p.x, p.z, ux / u, uz / u, u, D.swimLength, D.swimBeam, D.swimDraft);
      }
    } else if (low.wake > 0.05 && low.speed > 1) {
      const sp = low.surfacePoint;
      const h = low.heading;
      P.hull(WATER_SOURCE.dragonSkim, sp.x, sp.z, h.x, h.z, low.speed, D.skimLength, D.skimBeam * low.wake, D.skimDraft * low.wake);
    }
    // Downstrokes reaching the water: the low-flight model counts the gust rings it started.
    if (this.gusts >= 0 && low.gustsSpawned > this.gusts && low.downwashPulse > 0.02) {
      const sp = low.surfacePoint;
      P.ring(WATER_SOURCE.dragon, sp.x, sp.z, D.gustAmp * Math.min(1, low.downwashPulse), D.gustLambda);
    }
    this.gusts = low.gustsSpawned;
  }

  /** A splash event (fx strength units: ~0.05 a stroke, ~1 a skim contact, ~3 a plunge). */
  splash(x: number, z: number, strength: number, dragon: DragonState | null | undefined): void {
    const D = DRAGON_WAVES;
    if (!(strength >= D.splashMin) || !Number.isFinite(x + z)) {
      return;
    }
    // Bubbles reaching the surface from a dragon under water (stage 3/4 use tiny splashes for them).
    if (dragon && dragon.mode === 'underwater' && strength <= 0.08) {
      return;
    }
    const amp = Math.min(D.splashAmpMax, D.splashAmp * strength);
    this.particles.ring(WATER_SOURCE.splash, x, z, amp, D.splashLambda + D.splashLambdaPer * strength);
  }
}
