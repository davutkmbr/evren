/**
 * Turkish flags on the details layer's flag poles: one instanced cloth that turns downwind (global uWind) and waves
 * in the vertex shader. The flag is drawn on a canvas (red field, white crescent and star; TS 2926 proportions).
 */
import * as THREE from 'three';
import { RenderLayers } from '../../../../core/contracts';
import { patchMaterial } from '../../../../core/uniforms';
import { FLAG_STRIDE } from '../protocol';

function flagTexture(): THREE.CanvasTexture {
  const w = 300;
  const h = 200;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e30a17';
  g.fillRect(0, 0, w, h);
  // TS 2926 geometry with G = h: outer crescent circle at 0.5G from the hoist, diameter 0.5G; inner 0.0625G offset.
  const G = h;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(0.5 * G, h / 2, 0.25 * G, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#e30a17';
  g.beginPath();
  g.arc(0.5 * G + 0.0625 * G, h / 2, 0.2 * G, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  const sx = 0.5 * G + 0.0625 * G + 0.2 * G + 0.0375 * G + 0.125 * G;
  const r = 0.125 * G;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI;
    const rr = i % 2 === 0 ? r : r * 0.382;
    const x = sx + Math.cos(a) * rr;
    const y = h / 2 + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Instanced waving flags at FLAG_STRIDE records (pole base + pole height). */
export function createFlags(records: Float32Array): { mesh: THREE.InstancedMesh; dispose(): void } | null {
  const n = records.length / FLAG_STRIDE;
  if (!n) {
    return null;
  }
  const geo = new THREE.PlaneGeometry(1.5, 1, 10, 4).translate(0.75, -0.5, 0);
  const tex = flagTexture();
  const mat = new THREE.MeshStandardMaterial({ name: 'osm-flag', map: tex, side: THREE.DoubleSide, roughness: 0.75 });
  patchMaterial(mat, 'osm-flag-v1', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uWind;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
{
  float u = transformed.x / 1.5;
  float ph = dot(instanceMatrix[3].xz, vec2(0.37, 0.61));
  float wind = clamp(length(uWind.xz) * 0.15, 0.35, 1.3);
  float wave = sin(u * 7.0 - uTime * 6.5 * wind + ph) * 0.12 * u + sin(u * 13.0 - uTime * 9.0 + ph * 2.0) * 0.04 * u;
  transformed.z += wave * wind;
  transformed.y -= (1.0 - wind) * 0.35 * u * u;
  vec2 wd = normalize(uWind.xz + vec2(0.001, 0.0));
  transformed = vec3(transformed.x * wd.x - transformed.z * wd.y, transformed.y, transformed.x * wd.y + transformed.z * wd.x);
}`,
      )
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n{ vec2 wd0 = normalize(uWind.xz + vec2(0.001, 0.0)); objectNormal = vec3(-wd0.y, 0.0, wd0.x); }');
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const o = i * FLAG_STRIDE;
    const h = records[o + 4];
    const s = h * 0.2;
    m.makeScale(s, s, s).setPosition(records[o], records[o + 1] + h - 0.05, records[o + 2]);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'osm-flags';
  mesh.castShadow = false;
  mesh.layers.set(RenderLayers.NoReflection);
  return {
    mesh,
    dispose() {
      geo.dispose();
      tex.dispose();
      mat.dispose();
    },
  };
}
