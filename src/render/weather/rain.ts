import * as THREE from 'three';

/** Drops in the full-intensity box around the camera (instanced camera-facing streaks). */
const MAX_DROPS = 14000;
/** Edge of the repeating box of drops that follows the camera (m). */
const BOX = 44;
/** Shutter time that turns each drop into a streak along its motion relative to the camera (s). */
const SHUTTER = 0.022;
/** Real drop width (m); thinner streaks are widened to ~1 px and dimmed to keep their energy. */
const DROP_WIDTH = 0.004;

const VERTEX = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uFall;
uniform vec3 uCamVel;
uniform float uPixelAngle;
varying float vAlpha;
varying float vSide;
varying float vAlong;
const float BOX = ${BOX.toFixed(1)};
void main() {
  float speed = 0.85 + 0.3 * aSeed.w;
  vec3 fall = uFall * speed;
  // Each drop falls through a lattice that repeats every BOX metres; the box follows the camera.
  vec3 local = mod(aSeed.xyz * BOX + fall * uTime - cameraPosition, BOX) - 0.5 * BOX;
  vec3 head = cameraPosition + local;
  vec3 rel = fall - uCamVel;
  // Motion streak over the shutter time, capped at ~12° of view so a drop brushing past the lens stays a short dash.
  vec3 streak = rel * ${SHUTTER.toFixed(4)};
  float headDist = length(head - cameraPosition);
  float maxLen = 0.22 * headDist;
  float sLen = length(streak);
  if (sLen > maxLen) streak *= maxLen / sLen;
  vec3 tail = head - streak;
  vec3 p = mix(head, tail, aCorner.x);
  vec3 axis = tail - head;
  float len = length(axis);
  axis = len > 1e-4 ? axis / len : vec3(0.0, 1.0, 0.0);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = cross(axis, toCam);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  float dist = length(cameraPosition - p);
  float width = max(${DROP_WIDTH.toFixed(4)}, dist * uPixelAngle * 1.1);
  p += side * aCorner.y * width * 0.5;
  float r = length(local) / (0.5 * BOX);
  vAlpha = (${DROP_WIDTH.toFixed(4)} / width) * smoothstep(1.2, 3.0, headDist) * (1.0 - smoothstep(0.55, 1.0, r));
  vSide = aCorner.y;
  vAlong = aCorner.x;
  // A streak whose tail reaches behind the camera would project across the whole screen: drop it.
  float zHead = (viewMatrix * vec4(head, 1.0)).z;
  float zTail = (viewMatrix * vec4(tail, 1.0)).z;
  if (max(zHead, zTail) > -0.3) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform sampler2D tDepth;
varying float vAlpha;
varying float vSide;
varying float vAlong;
void main() {
  // Drawn after the weather composite without a depth buffer: occlusion against the scene depth (reversed-Z).
  if (gl_FragCoord.z < texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r) discard;
  float a = vAlpha * uOpacity * (1.0 - vSide * vSide) * (1.0 - 0.6 * vAlong);
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, min(a * 3.0, 0.85));
}
`;

/**
 * Rain as camera-facing streaks of real drops falling through a box that follows the camera. Streak direction and
 * length come from the drop's velocity relative to the camera, so rain slants into the wind and rushes at the rider
 * when flying fast. Drawn by the weather pass over the finished image and occluded by the scene depth (the dragon
 * shelters what is behind it), so the aerial blur and the fog never smear it.
 */
export class RainStreaks {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly lastCam = new THREE.Vector3();
  private readonly camVel = new THREE.Vector3();
  private hasLast = false;
  private time = 0;

  constructor(depth: THREE.IUniform<THREE.Texture | null>) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0], 3));
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute([0, -1, 1, -1, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(MAX_DROPS * 4);
    let s = 1234567;
    const rand = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < seeds.length; i++) {
      seeds[i] = rand();
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      name: 'weather.rain',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uFall: { value: new THREE.Vector3(0, -9, 0) },
        uCamVel: { value: new THREE.Vector3() },
        uPixelAngle: { value: 0.001 },
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 1 },
        tDepth: depth,
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      // Camera-facing ribbons: their winding depends on the view, never cull them.
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
      // Colour blends over the image; the target's alpha is left untouched.
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'weather-rain';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /**
   * `intensity` 0..1, `wind` world m/s, `color` drop radiance (linear HDR). Call from preRender with the final camera.
   */
  update(dt: number, camera: THREE.PerspectiveCamera, intensity: number, wind: THREE.Vector3, color: THREE.Color): void {
    const count = Math.round(MAX_DROPS * Math.min(Math.max(intensity, 0), 1));
    this.mesh.visible = count > 0;
    this.geometry.instanceCount = count;
    const pos = camera.position;
    if (dt > 0) {
      if (this.hasLast) {
        const v = this.lastCam.subVectors(pos, this.lastCam).divideScalar(dt);
        // Teleports and camera cuts: ignore the jump.
        if (v.lengthSq() < 150 * 150) {
          this.camVel.lerp(v, 1 - Math.exp(-dt / 0.08));
        }
      }
      this.lastCam.copy(pos);
      this.hasLast = true;
      this.time += dt;
    }
    if (!this.mesh.visible) {
      return;
    }
    const u = this.material.uniforms;
    u.uTime.value = this.time % 1000;
    (u.uFall.value as THREE.Vector3).set(wind.x * 0.7, -9 - 1.5 * intensity, wind.z * 0.7);
    (u.uCamVel.value as THREE.Vector3).copy(this.camVel);
    u.uPixelAngle.value = THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / Math.max(1, window.innerHeight);
    (u.uColor.value as THREE.Color).copy(color);
    u.uOpacity.value = 0.55 + 0.45 * intensity;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
