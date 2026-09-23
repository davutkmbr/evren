import * as THREE from 'three';
import { patchMaterial } from '../../../../core/uniforms';
import { MQ_FRAGMENT_PARS, MQ_FRAGMENT_REPLACEMENTS, MQ_VERTEX_MAIN, MQ_VERTEX_PARS } from './glsl';

export interface MosqueMaterialUniforms {
  /** Floodlight master intensity (1 = default). */
  uMqFlood: THREE.IUniform<number>;
  /** Interior window glow intensity. */
  uMqWindowGlow: THREE.IUniform<number>;
}

function replaceOnce(src: string, search: string, replacement: string): string {
  if (!src.includes(search)) {
    console.warn(`[mosques] shader chunk "${search}" not found`);
    return src;
  }
  return src.replace(search, replacement);
}

/**
 * The single mosque uber-material: a patched MeshStandardMaterial (so lighting, cascaded shadows, IBL and aerial
 * perspective stay consistent with the rest of the world) whose inputs come from per-vertex material ids.
 */
export function createMosqueMaterial(uniforms: MosqueMaterialUniforms, cacheKey: string): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0 });
  material.name = `mosques-${cacheKey}`;
  patchMaterial(material, `mosques-uber-v3-${cacheKey}`, (shader) => {
    shader.uniforms.uMqFlood = uniforms.uMqFlood;
    shader.uniforms.uMqWindowGlow = uniforms.uMqWindowGlow;
    shader.vertexShader = replaceOnce(shader.vertexShader, '#include <common>', `#include <common>\n${MQ_VERTEX_PARS}`);
    shader.vertexShader = replaceOnce(shader.vertexShader, '#include <worldpos_vertex>', `#include <worldpos_vertex>\n${MQ_VERTEX_MAIN}`);
    shader.fragmentShader = replaceOnce(shader.fragmentShader, 'void main() {', `${MQ_FRAGMENT_PARS}\nvoid main() {`);
    for (const [search, replacement] of MQ_FRAGMENT_REPLACEMENTS) {
      shader.fragmentShader = replaceOnce(shader.fragmentShader, search, replacement);
    }
  });
  return material;
}
