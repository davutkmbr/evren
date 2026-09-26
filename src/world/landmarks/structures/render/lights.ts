/**
 * Emissive light sprites of every structure in ONE additive instanced draw: street lamps, aviation obstruction
 * lights (blinking), LED show points, lanterns, vehicle light streams. Sprites keep a minimum on-screen size and
 * scale their radiance by (true size / drawn size)^2 so a distant lamp keeps its flux instead of vanishing or
 * turning into a large blob. Visible in the planar water reflection (default layer) for the Bosphorus glitter.
 */
import * as THREE from 'three';
import { SHARED_GLSL } from '../../../../render/shaders';
import { globalUniforms } from '../../../../core/uniforms';
import { LightMode } from '../build/surfaces';
import { LIGHT_STRIDE } from '../types';
import { LED_GLSL } from './glsl/led.glsl';

const VERTEX = /* glsl */ `
${SHARED_GLSL}
${LED_GLSL}
attribute vec2 corner;
attribute vec3 iPos;
attribute vec3 iColor;
attribute vec4 iMode;   // size, mode, p0, p1
attribute vec2 iP;      // p2, p3
attribute vec4 iAux;    // a0..a3
uniform float uPixelAngle;
varying vec2 vQ;
varying vec3 vCol;

void main() {
  vec3 P = iPos;
  float mode = iMode.y;
  float on = structLightsOn();
  vec3 col = iColor;
  if (abs(mode - ${LightMode.Blink}.0) < 0.5) {
    float ph = fract(uTime / max(iMode.z, 0.1) + iMode.w);
    float duty = iP.x > 0.0 ? iP.x : 0.3;
    // obstruction lights run day and night (daytime ones are brighter white/red; keep them red and dimmer)
    float lvl = mix(0.25, 1.0, on);
    on = lvl * smoothstep(0.0, 0.03, ph) * (1.0 - smoothstep(duty, duty + 0.06, ph));
  } else if (abs(mode - ${LightMode.Led}.0) < 0.5) {
    col = structLed(iMode.z, iMode.w, iP.x) * iColor.r;
  } else if (abs(mode - ${LightMode.Always}.0) < 0.5) {
    on = 1.0;
  } else if (abs(mode - ${LightMode.Traffic}.0) < 0.5) {
    float laneLen = max(length(iAux.xyz), 1.0);
    float f = fract(iMode.w + uTime * iMode.z / laneLen);
    P += iAux.xyz * f + vec3(0.0, 4.0 * iAux.w * f * (1.0 - f), 0.0);
    float facing = dot(iAux.xyz / laneLen, normalize(cameraPosition - P));
    col = mix(vec3(1.0, 0.025, 0.01) * 0.35, vec3(1.0, 0.9, 0.75), smoothstep(-0.2, 0.3, facing)) * iColor.r;
    on = mix(0.1, 1.0, on) * smoothstep(0.0, 0.02, f) * smoothstep(1.0, 0.98, f);
  } else if (abs(mode - ${LightMode.Beacon}.0) < 0.5) {
    on *= 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 6.2831853 / max(iMode.z, 0.5)), 3.0);
  }
  vec3 toCam = cameraPosition - P;
  float dist = max(length(toCam), 1e-3);
  float pix = dist * uPixelAngle;
  float size = iMode.x;
  float s = max(size, pix * 1.2);
  float k = size / s;
  col *= on * k * k * atmoTransmittance(P);
  vCol = col;
  vQ = corner;
  if (dot(col, vec3(1.0)) < 1e-5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // pull the sprite toward the camera so its own lamp housing does not clip it
  P += toCam / dist * min(size * 2.5 + 0.3, dist * 0.3);
  vec4 mv = viewMatrix * vec4(P, 1.0);
  mv.xy += corner * s * 3.0;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vQ;
varying vec3 vCol;
void main() {
  float r2 = dot(vQ, vQ) * 9.0;
  float core = exp(-r2 * 1.6);
  float halo = exp(-r2 * 0.35) * 0.05;
  float g = core + halo;
  if (g < 0.002) discard;
  gl_FragColor = vec4(vCol * g, 1.0);
}
`;

export class LightRenderer {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly uniforms = { uPixelAngle: { value: 0.001 } };

  constructor() {
    const corners = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
    this.geometry.setAttribute('corner', new THREE.BufferAttribute(corners, 2));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      name: 'structures.lights',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { ...globalUniforms, ...this.uniforms },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'structures.lights';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  get count(): number {
    return this.geometry.instanceCount;
  }

  setData(data: Float32Array): void {
    const n = Math.floor(data.length / LIGHT_STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(data, LIGHT_STRIDE, 1);
    // Rebuilds (joint refinement) replace the instance buffer: dispose() frees the GPU buffers of the old one (deleting
    // the attributes alone left them allocated); the geometry uploads again on its next draw.
    this.geometry.dispose();
    for (const name of ['iPos', 'iColor', 'iMode', 'iP', 'iAux']) {
      this.geometry.deleteAttribute(name);
    }
    this.geometry.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    this.geometry.setAttribute('iColor', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
    this.geometry.setAttribute('iMode', new THREE.InterleavedBufferAttribute(buffer, 4, 6));
    this.geometry.setAttribute('iP', new THREE.InterleavedBufferAttribute(buffer, 2, 10));
    this.geometry.setAttribute('iAux', new THREE.InterleavedBufferAttribute(buffer, 4, 12));
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
  }

  setPixelAngle(value: number): void {
    this.uniforms.uPixelAngle.value = value;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
