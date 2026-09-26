import * as THREE from 'three';
import type { NavLightKind } from '../vessels/model-types';
import type { Vessel } from '../vessels/agents';
import { LightPoints, Sector } from './nav-lights';

interface LightStyle {
  sector: number;
  color: [number, number, number];
  radius: number;
}

const STYLES: Record<NavLightKind, LightStyle> = {
  mast: { sector: Sector.Masthead, color: [16, 14.6, 12.8], radius: 0.35 },
  port: { sector: Sector.Port, color: [15, 0.9, 0.45], radius: 0.3 },
  stbd: { sector: Sector.Starboard, color: [1.2, 12, 4.8], radius: 0.3 },
  stern: { sector: Sector.Stern, color: [12, 11, 9.6], radius: 0.3 },
  anchor: { sector: Sector.AllRound, color: [12, 11, 9.6], radius: 0.3 },
  deck: { sector: Sector.AllRound, color: [7, 5, 2.9], radius: 1.1 },
  red: { sector: Sector.AllRound, color: [14, 0.8, 0.4], radius: 0.3 },
};

const PASSENGER = new Set(['vapur', 'ferry', 'seabus', 'tour']);
/** Working lamps that are only lit while working (fishing boats drifting over their nets), with a smaller glow. */
const WORK_LAMPS = new Set(['fishing', 'seiner']);

/** Keeps every vessel's navigation / anchor / deck lights in the shared light pool, switching them by vessel mode. */
export class VesselLights {
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly pool: LightPoints,
    private readonly vessels: readonly Vessel[],
  ) {
    for (const v of vessels) {
      v.lightBase = pool.alloc(v.model.lights.length);
    }
  }

  update(): void {
    const pool = this.pool;
    for (const v of this.vessels) {
      if (v.lightBase < 0) continue;
      const fx = -Math.sin(v.yaw);
      const fz = -Math.cos(v.yaw);
      const mode = v.state.mode;
      const passenger = PASSENGER.has(v.model.kind);
      const lights = v.model.lights;
      for (let k = 0; k < lights.length; k++) {
        const def = lights[k];
        const st = STYLES[def.kind];
        let on: boolean;
        switch (def.kind) {
          case 'anchor':
            on = mode === 'anchored';
            break;
          case 'deck':
            on = WORK_LAMPS.has(v.model.kind) ? mode === 'anchored' : passenger || mode !== 'underway';
            break;
          case 'red':
            on = true;
            break;
          default:
            on = mode === 'underway';
        }
        this.tmp.set(def.x, def.y, def.z).applyMatrix4(v.matrix);
        const i = v.lightBase + k;
        const radius = def.kind === 'deck' && v.model.length < 30 ? st.radius * 0.45 : st.radius;
        pool.set(i, this.tmp.x, this.tmp.y, this.tmp.z, fx, fz, st.sector, on ? st.color[0] : 0, on ? st.color[1] : 0, on ? st.color[2] : 0, radius);
      }
    }
  }
}
