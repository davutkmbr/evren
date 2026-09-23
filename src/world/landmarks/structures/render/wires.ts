/**
 * Anti-aliased thin cylinders (main cables, hangers, stays, railings, masts) in ONE instanced draw.
 * Each segment is a camera-facing ribbon that is never thinner than ~1 px; when the real diameter is sub-pixel
 * the ribbon keeps its minimum width and its opacity drops to the true coverage (radius / drawn radius), the
 * "phone-wire AA" technique, so a 60 mm hanger 3 km away fades instead of shimmering. Shading treats the ribbon
 * as a lit cylinder (key light, sky ambient, a tight specular lobe) and adds the LED show at night.
 */
import * as THREE from 'three';
import { SHARED_GLSL } from '../../../../render/shaders';
import { globalUniforms } from '../../../../core/uniforms';
import { WIRE_STRIDE } from '../types';
import { LED_GLSL } from './glsl/led.glsl';

const VERTEX = /* glsl */ `
${SHARED_GLSL}
attribute vec2 corner;
attribute vec3 iA;
attribute vec3 iB;
attribute float iRadius;
attribute vec3 iColor;
attribute vec4 iLed;
attribute vec2 iFade;
uniform float uPixelAngle;
uniform float uMinPixels;
varying vec3 vPos;
varying vec3 vDir;
varying vec3 vSide;
varying float vAcross;
varying float vCoverage;
varying vec3 vAlbedo;
varying vec4 vLed;

void main() {
  vec3 d = iB - iA;
  float len = length(d);
  vec3 dir = d / max(len, 1e-5);
  vec3 P = mix(iA, iB, corner.x);
  vec3 toCam = cameraPosition - P;
  float dist = max(length(toCam), 1e-3);
  float fade = 1.0 - smoothstep(iFade.x, iFade.y, dist);
  if (fade <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 side = cross(dir, toCam / dist);
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : normalize(cross(dir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
  float pix = dist * uPixelAngle;
  float halfW = max(iRadius, pix * uMinPixels);
  vCoverage = iRadius / halfW * fade;
  P += side * halfW * corner.y;
  vPos = P;
  vDir = dir;
  vSide = side;
  vAcross = corner.y;
  vAlbedo = iColor;
  vLed = vec4(iLed.x, mix(iLed.y, iLed.z, corner.x), iLed.w, corner.x);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
${SHARED_GLSL}
${LED_GLSL}
varying vec3 vPos;
varying vec3 vDir;
varying vec3 vSide;
varying float vAcross;
varying float vCoverage;
varying vec3 vAlbedo;
varying vec4 vLed;

void main() {
  float x = clamp(vAcross, -1.0, 1.0);
  // distance to the ribbon edge in pixels -> 1 px wide analytic edge (no double fade on ~1 px ribbons)
  float fw = max(fwidth(vAcross), 1e-4);
  float edge = clamp((1.0 - abs(x)) / fw + 0.35, 0.0, 1.0);
  float alpha = clamp(vCoverage, 0.0, 1.0) * edge;
  if (alpha < 0.004) discard;
  vec3 V = normalize(cameraPosition - vPos);
  vec3 facing = normalize(V - vDir * dot(V, vDir) + 1e-5);
  // a sub-pixel wire integrates the whole cylinder: fade the across-profile normal toward the mean
  float xs = x * clamp(vCoverage, 0.0, 1.0);
  vec3 N = normalize(normalize(vSide) * xs + facing * sqrt(max(1.0 - xs * xs, 0.0)));
  vec3 L = uKeyLightDir;
  vec3 E = keyLightAt(vPos) * cloudShadow(vPos);
  float ndl = max(dot(N, L), 0.0);
  // wrap term: the lit half of a cylinder seen edge-on still averages ~1/PI of the irradiance
  float wrap = mix(ndl, max(dot(L, N) * 0.5 + 0.5, 0.0) * 0.6, 1.0 - clamp(vCoverage, 0.0, 1.0));
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 48.0) * step(0.0, dot(N, L));
  vec3 amb = uAmbient * (0.55 + 0.45 * N.y);
  vec3 col = vAlbedo * (E * wrap + amb) / PI + E * spec * 0.04;
  if (vLed.x > 0.5) {
    col += structLed(vLed.x, vLed.y, vPos.y / 170.0) * vLed.z * structLightsOn();
  }
  col = applyAtmosphere(col, vPos);
  gl_FragColor = vec4(col, alpha);
}
`;

export class WireRenderer {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly uniforms = {
    uPixelAngle: { value: 0.001 },
    uMinPixels: { value: 0.7 },
  };

  constructor() {
    const corners = new Float32Array([0, -1, 1, -1, 1, 1, 0, 1]);
    this.geometry.setAttribute('corner', new THREE.BufferAttribute(corners, 2));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      name: 'structures.wires',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { ...globalUniforms, ...this.uniforms },
      transparent: true,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'structures.wires';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
  }

  get count(): number {
    return this.geometry.instanceCount;
  }

  setData(data: Float32Array): void {
    const n = Math.floor(data.length / WIRE_STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(data, WIRE_STRIDE, 1);
    for (const name of ['iA', 'iB', 'iRadius', 'iColor', 'iLed', 'iFade']) {
      this.geometry.deleteAttribute(name);
    }
    this.geometry.setAttribute('iA', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    this.geometry.setAttribute('iB', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
    this.geometry.setAttribute('iRadius', new THREE.InterleavedBufferAttribute(buffer, 1, 6));
    this.geometry.setAttribute('iColor', new THREE.InterleavedBufferAttribute(buffer, 3, 7));
    this.geometry.setAttribute('iLed', new THREE.InterleavedBufferAttribute(buffer, 4, 10));
    this.geometry.setAttribute('iFade', new THREE.InterleavedBufferAttribute(buffer, 2, 14));
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
  }

  /** Pixel footprint at unit distance for the minimum-width rule. */
  setPixelAngle(value: number): void {
    this.uniforms.uPixelAngle.value = value;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
