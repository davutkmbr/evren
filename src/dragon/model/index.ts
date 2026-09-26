import * as THREE from 'three';
import type { System } from '../../core/contracts';
import { UpdateOrder } from '../../core/contracts';
import { globalUniforms } from '../../core/uniforms';
import { RiderBehavior } from './behavior/rider-behavior';
import { BondBehavior } from './behavior/bond/bond-behavior';
import { DragonRigImpl } from './rig';

function textureSizeFor(preset: string): number {
  return preset === 'low' ? 1024 : 2048;
}

const _lightDir = new THREE.Vector3();
const _targetPos = new THREE.Vector3();

/** World direction toward a directional-type light (position minus target), or false when unknown. */
function keyLightDirection(light: THREE.Object3D | undefined, out: THREE.Vector3): boolean {
  if (!light) {
    return false;
  }
  out.setFromMatrixPosition(light.matrixWorld);
  const target = (light as THREE.DirectionalLight).target as THREE.Object3D | undefined;
  if (target) {
    out.sub(_targetPos.setFromMatrixPosition(target.matrixWorld));
  }
  return out.lengthSq() > 1e-10;
}

/** Procedural dragon + rider model and rig. Provides the 'rig' service (DragonRig) and the 'bond' service. */
export function createDragonModelSystem(): System {
  let rig: DragonRigImpl | undefined;
  let rider: RiderBehavior | undefined;
  let bond: BondBehavior | undefined;
  let unsubscribe: (() => void) | undefined;
  let fallbackLight: THREE.Object3D | undefined;
  let scanCountdown = 0;
  return {
    name: 'dragon-model',
    order: UpdateOrder.Animation,
    init(ctx) {
      const t0 = performance.now();
      rig = new DragonRigImpl({ renderer: ctx.renderer, textureSize: textureSizeFor(ctx.quality.settings.preset) });
      const s = rig.stats;
      console.info(
        `[dragon] built in ${(performance.now() - t0).toFixed(0)} ms: ${s.bones} bones, ` +
          `tris body ${s.bodyTriangles} + membrane ${s.membraneTriangles} + rider ${s.riderTriangles}`,
      );
      ctx.services.provide('rig', rig);
      rider = new RiderBehavior(rig, ctx);
      bond = new BondBehavior(rig, rider, ctx);
      unsubscribe = ctx.quality.onChange((settings) => {
        rig?.setTextureQuality(textureSizeFor(settings.preset));
      });
    },
    update(dt, ctx) {
      if (!rig) {
        return;
      }
      const env = ctx.services.tryGet('env');
      let light: THREE.Object3D | undefined = env?.light;
      if (!light) {
        // Sandboxes without the sky system: use the scene's shadow-casting directional light.
        if (!fallbackLight && scanCountdown-- <= 0) {
          scanCountdown = 60;
          ctx.scene.traverse((o) => {
            if (!fallbackLight && (o as THREE.DirectionalLight).isDirectionalLight && o.castShadow) {
              fallbackLight = o;
            }
          });
        }
        light = fallbackLight;
      }
      if (!keyLightDirection(light, _lightDir)) {
        _lightDir.copy(env ? env.sunDirection : (globalUniforms.uSunDir.value as THREE.Vector3));
      }
      const wind = env ? env.wind : (globalUniforms.uWind.value as THREE.Vector3);
      // Rider actions, then the bond (gaze, mood, reactions, phase 06) go on top of this frame's flight pose; the debug
      // handle's forced cues last.
      rider?.update(dt, ctx);
      bond?.update(dt, ctx);
      rider?.applyOverrides();
      rig.applyPose(dt, ctx.services.tryGet('dragon'), _lightDir, wind);
    },
    dispose() {
      unsubscribe?.();
      bond?.dispose();
      rider?.dispose();
      rig?.dispose();
    },
  };
}
