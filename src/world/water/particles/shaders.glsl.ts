/**
 * Wave particle GLSL (phase 21 stage 7a): the splat pass (one oriented quad per particle, additive into a half-float
 * RGBA window around the camera) and the water shaders' sampling of that window.
 *
 * The splat evaluates exactly the CPU kernel of wave-particles.ts at every texel centre:
 *   h = a Wf(f / l) Wq(q / s) cos(k q + phase), W(u) = (1 + cos(pi u)) / 2,
 * plus its analytic gradient, so the water surface and the CPU queries agree up to the texture's reconstruction.
 * Waves shorter than ~5 texels are faded out (the window cannot carry them).
 */

/** Splat vertex shader: `corner` spans the quad (-1..1)^2 across (front, wave vector) in units of (l, s). */
export const WAVE_SPLAT_VERT = /* glsl */ `
attribute vec2 corner;
attribute vec4 iA;   // centre relative to the window's min corner (m), unit direction
attribute vec4 iB;   // front half-width l (m), packet half-length s (m), wavenumber k, phase at the centre
attribute vec4 iC;   // amplitude (m)
uniform vec4 uWin;   // x = 1 / window extent (m), y = texel (m), z = shortest wavelength carried (m)
varying vec2 vLocal; // (f / l, q / s)
varying vec4 vWave;  // x = amplitude x wavelength filter, y = k, z = l, w = s
varying vec3 vDir;   // xy = direction, z = phase at the centre

void main() {
  vec2 d = iA.zw;
  vec2 perp = vec2(-d.y, d.x);
  // Half a texel of margin so thin kernels still cover the texel centres they touch.
  vec2 half_ = iB.xy + 0.5 * uWin.y;
  vec2 local = corner * half_;
  vec2 p = iA.xy + perp * local.x + d * local.y;
  gl_Position = vec4(p * uWin.x * 2.0 - 1.0, 0.0, 1.0);
  float lambda = 6.2831853 / max(iB.z, 1e-4);
  float filt = smoothstep(0.5 * uWin.z, uWin.z, lambda);
  vLocal = local / iB.xy;
  vWave = vec4(iC.x * filt, iB.z, iB.x, iB.y);
  vDir = vec3(d, iB.w);
}
`;

export const WAVE_SPLAT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vLocal;
varying vec4 vWave;
varying vec3 vDir;

void main() {
  if (abs(vLocal.x) >= 1.0 || abs(vLocal.y) >= 1.0) discard;
  const float PI_ = 3.14159265;
  float uf = PI_ * vLocal.x;
  float uq = PI_ * vLocal.y;
  float wf = 0.5 + 0.5 * cos(uf);
  float wq = 0.5 + 0.5 * cos(uq);
  float dwf = -0.5 * PI_ * sin(uf) / vWave.z;
  float dwq = -0.5 * PI_ * sin(uq) / vWave.w;
  float k = vWave.y;
  float ph = k * vLocal.y * vWave.w + vDir.z;
  float c = cos(ph);
  float s = sin(ph);
  float A = vWave.x;
  float h = A * wf * wq * c;
  float gq = A * wf * (dwq * c - wq * k * s);
  float gf = A * wq * dwf * c;
  vec2 d = vDir.xy;
  vec2 grad = d * gq + vec2(-d.y, d.x) * gf;
  gl_FragColor = vec4(h, grad, A * wf * wq);
}
`;

export const WAVE_CLEAR_FRAG = /* glsl */ `
precision highp float;
void main() {
  gl_FragColor = vec4(0.0);
}
`;

/** Water shader side (both stages): uniforms and the window lookup. */
export const WAVE_WATER_GLSL = /* glsl */ `
uniform sampler2D uWaveTex;          // wave particle splat: r = height (m), gb = height gradient, a = envelope
uniform vec4 uWaveRect;              // xy = window min corner relative to uOrigin (m), z = 1 / window extent (m), w = texel (m)
uniform vec4 uWaveParams;            // x = on (0 / 1)

/** Wave particles at xo (relative to uOrigin), faded out over the outer 6 % of the window. */
vec4 waveParticlesAt(vec2 xo) {
  vec2 uv = (xo - uWaveRect.xy) * uWaveRect.z;
  vec2 inner = min(uv, 1.0 - uv);
  float edge = smoothstep(0.0, 0.06, min(inner.x, inner.y));
  return edge > 0.0 ? textureLod(uWaveTex, uv, 0.0) * edge : vec4(0.0);
}
`;
