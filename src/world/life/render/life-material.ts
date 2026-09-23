import * as THREE from 'three';
import { patchMaterial } from '../../../core/uniforms';
import { LIFE_COLOR_VERTEX, LIFE_FRAGMENT_PARS, LIFE_VERTEX_PARS } from './life-material.glsl';

function replaceOnce(src: string, search: string, replacement: string): string {
  if (!src.includes(search)) {
    console.warn(`[life] shader chunk "${search}" not found`);
    return src;
  }
  return src.replace(search, replacement);
}

/**
 * Shared PBR material for vessels and piers: vertex colours + per-instance hull paint, procedural plating, rust,
 * corrugation and planking detail, and night-lit windows/lamps (emissive classes).
 */
export function createLifeMaterial(name: string): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1, vertexColors: true });
  material.name = name;
  patchMaterial(material, 'life-vessel-v1', (shader) => {
    let vs = shader.vertexShader;
    vs = replaceOnce(vs, '#include <common>', `#include <common>\n${LIFE_VERTEX_PARS}`);
    vs = replaceOnce(vs, '#include <color_vertex>', LIFE_COLOR_VERTEX);
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    fs = replaceOnce(fs, '#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${LIFE_FRAGMENT_PARS}`);
    fs = replaceOnce(
      fs,
      '#include <color_fragment>',
      `#include <color_fragment>
  vec3 lifeAlbedo = diffuseColor.rgb;
  LifeSurf lifeS = lifeSurface(lifeAlbedo);
  diffuseColor.rgb = lifeAlbedo;`,
    );
    fs = replaceOnce(fs, '#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n  roughnessFactor = clamp(lifeS.rough, 0.04, 1.0);`);
    fs = replaceOnce(fs, '#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n  metalnessFactor = clamp(lifeS.metal, 0.0, 1.0);`);
    fs = replaceOnce(
      fs,
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
  {
    vec2 lifeDH = vec2(dFdx(lifeS.bump), dFdy(lifeS.bump));
    if (dot(lifeDH, lifeDH) > 0.0) normal = lifeBump(-vViewPosition, normal, lifeDH, faceDirection);
  }`,
    );
    fs = replaceOnce(fs, '#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n  totalEmissiveRadiance += lifeS.emissive;`);
    shader.fragmentShader = fs;
  });
  return material;
}
