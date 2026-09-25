/**
 * Per-object cascade selection for the cascaded sun shadow (render/sky/cascaded-shadow.ts). A gate limits the cascades
 * an object is drawn into by the view depth at which each cascade starts:
 * - `below`: only cascades that start nearer than this (m): small casters and full-detail near geometry,
 * - `from`: only cascades that start at or beyond this (m): simplified stand-ins for the far cascades.
 * An object gated with `{ below: d }` and its proxy gated with `{ from: d }` are never both drawn into one cascade.
 */
import type * as THREE from 'three';

export interface ShadowGate {
  below?: number;
  from?: number;
}

/** Frusta that apply shadow gates (the cascade frusta) carry this marker and their start depth. */
export interface GatedFrustum {
  readonly isCascadeFrustum: true;
  /** View depth (m) at which the cascade's receiver range starts (-Infinity for the first cascade). */
  readonly depthMin: number;
}

export function shadowGatePasses(object: THREE.Object3D, depthMin: number): boolean {
  const gate = object.userData.shadowGate as ShadowGate | undefined;
  if (!gate) {
    return true;
  }
  if (gate.below !== undefined && !(depthMin < gate.below)) {
    return false;
  }
  return gate.from === undefined || depthMin >= gate.from;
}

/**
 * Sets (or with null clears) the gate of `object`. Objects that do their own culling (frustumCulled = false, e.g.
 * instanced or batched meshes) would skip the cascade test altogether, so they switch to a frustum hook that applies
 * only the gate and accepts every other frustum.
 */
export function setShadowGate(object: THREE.Object3D, gate: ShadowGate | null): void {
  if (!gate) {
    delete object.userData.shadowGate;
    return;
  }
  object.userData.shadowGate = gate;
  if (!object.frustumCulled && !object.userData.shadowGateHook) {
    object.userData.shadowGateHook = true;
    object.frustumCulled = true;
    (object as THREE.Mesh).intersectsFrustum = (frustum: unknown): boolean => {
      const f = frustum as Partial<GatedFrustum>;
      return f.isCascadeFrustum ? shadowGatePasses(object, f.depthMin as number) : true;
    };
  }
}
