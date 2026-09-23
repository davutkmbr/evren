import * as THREE from 'three';
import { createRng } from '../../core/math/noise';
import { MEDIUM_GLSL } from './glsl/medium.glsl';
import { EQUATORIAL_TO_GALACTIC } from './milky-way';
import { BRIGHT_STARS } from './star-catalog';

const PROCEDURAL_STARS = 5200;

/** B-V colour index -> linear RGB (Ballesteros temperature + Planckian locus approximation), max component 1. */
function starColor(bv: number): [number, number, number] {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const k = t / 100;
  let r: number;
  let g: number;
  let b: number;
  if (k <= 66) {
    r = 1;
    g = THREE.MathUtils.clamp((99.47 * Math.log(k) - 161.12) / 255, 0, 1);
    b = k <= 19 ? 0 : THREE.MathUtils.clamp((138.52 * Math.log(k - 10) - 305.04) / 255, 0, 1);
  } else {
    r = THREE.MathUtils.clamp((329.7 * Math.pow(k - 60, -0.1332)) / 255, 0, 1);
    g = THREE.MathUtils.clamp((288.12 * Math.pow(k - 60, -0.0755)) / 255, 0, 1);
    b = 1;
  }
  const lin = (c: number): number => Math.pow(c, 2.2);
  const out: [number, number, number] = [lin(r), lin(g), lin(b)];
  const m = Math.max(...out);
  // Desaturate: stars look much whiter than their blackbody colour to the eye.
  return out.map((c) => THREE.MathUtils.lerp(1, c / m, 0.55)) as [number, number, number];
}

function buildGeometry(): THREE.BufferGeometry {
  const count = BRIGHT_STARS.length + PROCEDURAL_STARS;
  const positions = new Float32Array(count * 3);
  const magnitudes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const rng = createRng(0x5eed57a7);
  let n = 0;
  for (const [raH, dec, mag, bv] of BRIGHT_STARS) {
    const ra = THREE.MathUtils.degToRad(raH * 15);
    const d = THREE.MathUtils.degToRad(dec);
    positions.set([Math.cos(d) * Math.cos(ra), Math.cos(d) * Math.sin(ra), Math.sin(d)], n * 3);
    magnitudes[n] = mag;
    colors.set(starColor(bv), n * 3);
    seeds[n] = rng();
    n++;
  }
  const galToEq = EQUATORIAL_TO_GALACTIC.clone().transpose();
  const v = new THREE.Vector3();
  const k = 0.46;
  const m0 = 3.0;
  const m1 = 6.6;
  const span = Math.pow(10, k * (m1 - m0)) - 1;
  while (n < count) {
    const z = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const rxy = Math.sqrt(1 - z * z);
    v.set(rxy * Math.cos(phi), rxy * Math.sin(phi), z);
    // v is in galactic coordinates: concentrate stars toward the galactic plane.
    const weight = (1 + 2.2 * Math.exp(-((z / 0.22) ** 2))) / 3.2;
    if (rng() > weight) {
      continue;
    }
    v.applyMatrix3(galToEq);
    positions.set([v.x, v.y, v.z], n * 3);
    magnitudes[n] = m0 + Math.log10(1 + rng() * span) / k;
    const bv = THREE.MathUtils.clamp(0.62 + (rng() + rng() + rng() - 1.5) * 0.7, -0.3, 1.9);
    colors.set(starColor(bv), n * 3);
    seeds[n] = rng();
    n++;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aMag', new THREE.BufferAttribute(magnitudes, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return geometry;
}

const VERTEX = /* glsl */ `
#define USE_TRANSMITTANCE_LUT
${MEDIUM_GLSL}
uniform float uTime;
uniform vec4 uAtmoState;
uniform vec2 uResolution;
uniform mat3 uEquToLocal;
uniform float uStarBrightness;
uniform vec3 uMoonDirL;
uniform float uMoonCos;
uniform sampler2D uSkyView;
attribute float aMag;
attribute vec3 aColor;
attribute float aSeed;
varying vec3 vStarColor;

/* Same parameterisation as atmoSkyViewSample() (shared GLSL). */
vec3 skyBackground(vec3 dir, float alt) {
  float camKm = ATMO_RG + max(alt, 1.0) * 0.001;
  float vHorizon = sqrt(max(camKm * camKm - ATMO_RG * ATMO_RG, 0.0));
  float beta = acos(clamp(vHorizon / camKm, -1.0, 1.0));
  float zenithHorizon = PI - beta;
  float viewZenith = acos(clamp(dir.y, -1.0, 1.0));
  float v = viewZenith < zenithHorizon ? (1.0 - sqrt(max(1.0 - viewZenith / zenithHorizon, 0.0))) * 0.5 : 0.5;
  vec2 size = vec2(textureSize(uSkyView, 0));
  v = (v * (size.y - 1.0) + 0.5) / size.y;
  float u = atan(dir.x, -dir.z) * (0.5 / PI) + 0.5;
  return textureLod(uSkyView, vec2(u, v), 0.0).rgb;
}

void main() {
  vec3 dir = uEquToLocal * position;
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * dir, 1.0);
  gl_Position = vec4(clip.xy, 0.5 * clip.w, clip.w);
  float alt = max(uAtmoState.x, 1.0);
  float dip = sqrt(2.0 * alt / 6.36e6);
  if (dir.y < -dip || dot(dir, uMoonDirL) > uMoonCos || uStarBrightness <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vStarColor = vec3(0.0);
    return;
  }
  vec3 T = sampleTransmittance(ATMO_RG + alt * 0.001, dir.y);
  float airmass = min(1.0 / max(dir.y + 0.03, 0.03), 30.0);
  float scint = 0.12 + 0.05 * airmass;
  float tw = sin(uTime * (6.0 + aSeed * 11.0) + aSeed * 61.0) * sin(uTime * (2.3 + aSeed * 4.0) + aSeed * 17.0);
  float magApparent = aMag - 2.5 * log(max(dot(T, vec3(0.2126, 0.7152, 0.0722)), 1e-6)) / log(10.0);
  // Naked-eye limiting magnitude for the local sky brightness (Schaefer 1990 / Garstang form), calibrated so the
  // airglow-only sky (~3.7e-5) is 22 mag/arcsec^2: moonlit megacity sky -> ~3, dark site -> ~6.5.
  float bg = dot(skyBackground(dir, alt), vec3(0.2126, 0.7152, 0.0722));
  float mLim = 7.93 - 5.0 * log(135.5 * sqrt(max(bg, 0.0)) + 1.0) / log(10.0);
  float visible = 1.0 - smoothstep(mLim - 0.9, mLim + 0.3, magApparent);
  float flux = pow(10.0, -0.4 * aMag) * uStarBrightness * visible;
  if (flux < 1e-6) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vStarColor = vec3(0.0);
    return;
  }
  flux *= max(1.0 + scint * tw, 0.2);
  float pxScale = max(uResolution.y / 900.0, 0.75);
  float size = (2.1 + clamp(3.0 - aMag, 0.0, 4.5) * 0.6) * pxScale;
  gl_PointSize = size;
  vStarColor = aColor * T * flux * (3.5 / (size * size / (pxScale * pxScale)));
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vStarColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float fall = exp(-dot(c, c) * 12.0);
  gl_FragColor = vec4(vStarColor * fall, 1.0);
}
`;

export class StarField {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;

  constructor(transmittance: THREE.Texture, skyView: THREE.Texture, medium: Record<string, THREE.IUniform>) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        ...medium,
        uTransmittanceLUT: { value: transmittance },
        uSkyView: { value: skyView },
        uEquToLocal: { value: new THREE.Matrix3() },
        uStarBrightness: { value: 0 },
        uMoonDirL: { value: new THREE.Vector3(0, -1, 0) },
        uMoonCos: { value: 1 },
      },
      blending: THREE.AdditiveBlending,
      transparent: false,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.points = new THREE.Points(buildGeometry(), this.material);
    this.points.name = 'stars';
    this.points.frustumCulled = false;
    this.points.renderOrder = -1e9 + 1;
    this.points.matrixAutoUpdate = false;
  }

  update(equatorialToLocal: THREE.Matrix3, brightness: number, moonDir: THREE.Vector3, moonRadius: number): void {
    const u = this.material.uniforms;
    (u.uEquToLocal.value as THREE.Matrix3).copy(equatorialToLocal);
    u.uStarBrightness.value = brightness;
    (u.uMoonDirL.value as THREE.Vector3).copy(moonDir);
    u.uMoonCos.value = Math.cos(moonRadius * 1.05);
    this.points.visible = brightness > 1e-4;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
