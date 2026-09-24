import * as THREE from 'three';
import { SHARED_GLSL } from '../shaders';

/** Segments of the main channel (2^depth) and of a branch. */
const MAIN_DEPTH = 7;
const BRANCH_DEPTH = 5;
const MAX_SEGMENTS = (1 << MAIN_DEPTH) + 4 * (1 << BRANCH_DEPTH);
const SPEED_OF_SOUND = 343;

const VERTEX = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec2 aCorner;
attribute float aWidth;
attribute float aBright;
uniform float uPixelAngle;
varying float vBright;
varying float vSide;
varying vec3 vWorld;
void main() {
  vec3 p = mix(aStart, aEnd, aCorner.x);
  vec3 axis = normalize(aEnd - aStart);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = cross(axis, toCam);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  float dist = length(cameraPosition - p);
  float w = max(aWidth, dist * uPixelAngle * 1.6);
  p += side * aCorner.y * w;
  // Thin, far channels keep most of their brightness (the glow around a real channel is much wider than it).
  vBright = aBright * mix(1.0, aWidth / w, 0.35);
  vSide = aCorner.y;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
${SHARED_GLSL}
uniform vec3 uColor;
uniform vec2 uFog;
uniform sampler2D tDepth;
varying float vBright;
varying float vSide;
varying vec3 vWorld;
void main() {
  if (gl_FragCoord.z < texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r) discard;
  float core = 1.0 - vSide * vSide;
  // Ground fog between the camera and the channel (same exponential layer as the weather composite).
  vec3 d = vWorld - uCamPos;
  float dist = length(d);
  float dy = d.y / max(dist, 1e-3);
  float h0 = max(uCamPos.y, -2.0);
  float h1 = max(vWorld.y, -2.0);
  float od = abs(dy) > 1e-4 ? uFog.x * uFog.y * (exp(-h0 / uFog.y) - exp(-h1 / uFog.y)) / dy : uFog.x * exp(-h0 / uFog.y) * dist;
  vec3 c = uColor * vBright * core * core * atmoTransmittance(vWorld) * exp(-max(od, 0.0));
  gl_FragColor = vec4(c, 1.0);
}
`;

interface Pulse {
  at: number;
  peak: number;
}

export interface LightningStrike {
  /** World position of the ground contact and of the channel's upper third (where the cloud glows). */
  readonly ground: THREE.Vector3;
  readonly glow: THREE.Vector3;
  /** Distance from the camera at the strike (m). */
  distance: number;
}

/**
 * Thunderstorm lightning: random cloud-to-ground strikes around the camera (biased into view), a jagged channel with
 * branches drawn as camera-facing additive ribbons, a multi-pulse flash envelope and thunder delayed by the distance.
 */
export class Lightning {
  readonly mesh: THREE.Mesh;
  /** Current flash brightness 0..1 (already scaled by distance). */
  flash = 0;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly start: Float32Array;
  private readonly end: Float32Array;
  private readonly width: Float32Array;
  private readonly bright: Float32Array;
  private segments = 0;
  private timer = 6;
  private age = 99;
  private pulses: Pulse[] = [];
  private strength = 0;
  private readonly thunder: { at: number; strength: number }[] = [];
  private clock = 0;
  private readonly rng: () => number;
  readonly strike: LightningStrike = { ground: new THREE.Vector3(), glow: new THREE.Vector3(), distance: 0 };

  constructor(depth: THREE.IUniform<THREE.Texture | null>, seed = 97531) {
    let s = seed >>> 0;
    this.rng = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute([0, -1, 1, -1, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.start = new Float32Array(MAX_SEGMENTS * 3);
    this.end = new Float32Array(MAX_SEGMENTS * 3);
    this.width = new Float32Array(MAX_SEGMENTS);
    this.bright = new Float32Array(MAX_SEGMENTS);
    g.setAttribute('aStart', new THREE.InstancedBufferAttribute(this.start, 3));
    g.setAttribute('aEnd', new THREE.InstancedBufferAttribute(this.end, 3));
    g.setAttribute('aWidth', new THREE.InstancedBufferAttribute(this.width, 1));
    g.setAttribute('aBright', new THREE.InstancedBufferAttribute(this.bright, 1));
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      name: 'weather.lightning',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uPixelAngle: { value: 0.001 },
        uColor: { value: new THREE.Color() },
        uFog: { value: new THREE.Vector2(0, 70) },
        tDepth: depth,
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      // Camera-facing ribbons: their winding depends on the view, never cull them.
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'weather-lightning';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Ground fog of the weather composite (extinction at sea level 1/m, scale height m). */
  setFog(density: number, height: number): void {
    (this.material.uniforms.uFog.value as THREE.Vector2).set(density, Math.max(height, 1));
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  /**
   * Advances the storm. `storm` 0..1 sets the strike rate; `heightAt` gives the surface height below a strike.
   * Returns the thunder claps due this frame (strength 0..1 = loudness/closeness).
   */
  update(dt: number, storm: number, camera: THREE.PerspectiveCamera, heightAt: (x: number, z: number) => number, out: number[]): void {
    out.length = 0;
    this.clock += dt;
    if (storm > 0.02) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.trigger(camera, storm, heightAt);
        // Mean interval ~6 s in a full storm, ~25 s at the fringe.
        this.timer = (2 + this.rng() * 8) / Math.pow(storm, 0.8);
      }
    } else {
      this.timer = Math.min(this.timer, 4);
    }
    for (let i = this.thunder.length - 1; i >= 0; i--) {
      if (this.clock >= this.thunder[i].at) {
        out.push(this.thunder[i].strength);
        this.thunder.splice(i, 1);
      }
    }
    this.age += dt;
    let f = 0;
    for (const p of this.pulses) {
      const t = this.age - p.at;
      if (t >= 0) {
        f += p.peak * Math.exp(-t / 0.045) * (t < 0.012 ? t / 0.012 : 1);
      }
    }
    this.flash = Math.min(1.5, f * this.strength);
    this.mesh.visible = this.segments > 0 && this.age < 0.9 && f > 0.02;
    if (this.mesh.visible) {
      this.material.uniforms.uPixelAngle.value = THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / Math.max(1, window.innerHeight);
    }
  }

  /** Sets the channel brightness for this frame (linear HDR per unit flash, already divided by exposure). */
  setColor(color: THREE.Color): void {
    (this.material.uniforms.uColor.value as THREE.Color).copy(color).multiplyScalar(Math.min(1.2, this.flash + 0.15));
  }

  /** Forces a strike now (debug / screenshots). */
  trigger(camera: THREE.PerspectiveCamera, storm: number, heightAt: (x: number, z: number) => number): void {
    const rng = this.rng;
    const cam = camera.position;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const baseYaw = Math.atan2(forward.x, forward.z);
    // Two strikes out of three land inside the view cone so the player sees them.
    const yaw = rng() < 0.66 ? baseYaw + (rng() - 0.5) * 1.1 : rng() * Math.PI * 2;
    const distance = 1400 + Math.pow(rng(), 1.3) * 8500;
    const gx = cam.x + Math.sin(yaw) * distance;
    const gz = cam.z + Math.cos(yaw) * distance;
    const gy = Math.max(heightAt(gx, gz), 0);
    const top = new THREE.Vector3(gx + (rng() - 0.5) * 900, 1500 + rng() * 700, gz + (rng() - 0.5) * 900);
    const bottom = new THREE.Vector3(gx, gy, gz);
    this.segments = 0;
    const main = this.channel(top, bottom, MAIN_DEPTH, 0.22, 7, 1);
    for (let b = 0; b < 4; b++) {
      const i = Math.floor((0.08 + rng() * 0.55) * main.length);
      const from = main[Math.min(i, main.length - 1)];
      const remaining = from.y - gy;
      const to = from.clone().add(new THREE.Vector3((rng() - 0.5) * remaining * 0.8, -remaining * (0.25 + rng() * 0.3), (rng() - 0.5) * remaining * 0.8));
      this.channel(from, to, BRANCH_DEPTH, 0.3, 3, 0.45);
    }
    const g = this.geometry;
    g.instanceCount = this.segments;
    for (const name of ['aStart', 'aEnd', 'aWidth', 'aBright']) {
      const attr = g.getAttribute(name) as THREE.InstancedBufferAttribute;
      attr.needsUpdate = true;
    }
    this.age = 0;
    this.pulses = [];
    const n = 2 + Math.floor(rng() * 3);
    let at = 0;
    for (let i = 0; i < n; i++) {
      this.pulses.push({ at, peak: i === 0 ? 1 : 0.5 + rng() * 0.5 });
      at += 0.05 + rng() * 0.12;
    }
    // Closer strikes flash brighter; a weak storm has weaker strikes.
    this.strength = (0.45 + 0.55 * storm) * THREE.MathUtils.clamp(3500 / distance, 0.25, 1.4);
    this.strike.ground.copy(bottom);
    this.strike.glow.copy(bottom).lerp(top, 0.8);
    this.strike.distance = distance;
    this.thunder.push({ at: this.clock + distance / SPEED_OF_SOUND, strength: THREE.MathUtils.clamp(1.25 - distance / 7000, 0.12, 1) });
  }

  /** Midpoint-displaced polyline from a to b; appends its segments and returns its points. */
  private channel(a: THREE.Vector3, b: THREE.Vector3, depth: number, roughness: number, width: number, bright: number): THREE.Vector3[] {
    const rng = this.rng;
    let pts = [a.clone(), b.clone()];
    let amp = a.distanceTo(b) * roughness;
    for (let d = 0; d < depth; d++) {
      const next: THREE.Vector3[] = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i];
        const q = pts[i + 1];
        const mid = p.clone().lerp(q, 0.5);
        mid.x += (rng() - 0.5) * amp;
        mid.z += (rng() - 0.5) * amp;
        mid.y += (rng() - 0.5) * amp * 0.25;
        next.push(mid, q);
      }
      pts = next;
      amp *= 0.55;
    }
    const n = pts.length - 1;
    for (let i = 0; i < n && this.segments < MAX_SEGMENTS; i++) {
      const k = this.segments++;
      pts[i].toArray(this.start, k * 3);
      pts[i + 1].toArray(this.end, k * 3);
      const along = i / n;
      this.width[k] = width * (1 - 0.5 * along);
      this.bright[k] = bright * (0.75 + 0.25 * (1 - along));
    }
    return pts;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
