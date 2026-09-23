import * as THREE from 'three';

/**
 * Procedural albedo + relief of the lunar near side (orthographic, selenographic north up, IAU east to the right),
 * rendered once on the GPU. RGB = normal albedo, A = height (moon radii, exaggerated) for terminator relief.
 * Maria, walled plains and rayed craters sit at their real selenographic coordinates (lat, lon, diameter km); crater
 * fields, mare flow textures and albedo breakup are procedural.
 */
const MARIA: Array<[number, number, number, number]> = [
  // lat, lon, diameter km, darkness 0..1
  [33, -16, 1146, 0.95], // Imbrium
  [28, 17.5, 707, 0.85], // Serenitatis
  [8.5, 31.4, 873, 1.0], // Tranquillitatis
  [17, 59.1, 556, 0.95], // Crisium
  [-7.8, 51.3, 909, 0.8], // Fecunditatis
  [-15.2, 35.5, 333, 0.9], // Nectaris
  [-21.3, -16.6, 715, 0.8], // Nubium
  [-24.4, -38.6, 389, 0.9], // Humorum
  [-10, -23.1, 376, 0.75], // Cognitum
  [7.5, -30.9, 513, 0.75], // Insularum
  [13.3, 3.6, 245, 0.75], // Vaporum
  [2.4, 1.7, 335, 0.6], // Sinus Medii
  [11, -8, 290, 0.7], // Sinus Aestuum
  [38, 29, 384, 0.55], // Lacus Somniorum
  [25, -55, 1500, 0.95], // Procellarum (north)
  [5, -52, 1100, 0.9], // Procellarum (centre)
  [42, -56, 850, 0.8], // Procellarum (north-west)
  [-8, -60, 700, 0.75], // Procellarum (south)
  [44, -31, 236, 0.8], // Sinus Iridum
  [57, -18, 420, 0.75], // Frigoris (west)
  [56, 2, 430, 0.8], // Frigoris (centre)
  [56, 25, 380, 0.7], // Frigoris (east)
  [-32, -28, 286, 0.55], // Palus Epidemiarum
  [13, 86, 420, 0.65], // Marginis
  [1.3, 87, 373, 0.7], // Smythii
  [-39, 88, 603, 0.5], // Australe
  [57, 81, 273, 0.65], // Humboldtianum
  [6.8, 68.4, 243, 0.7], // Undarum
  [1.1, 65.1, 139, 0.7], // Spumans
  [-5.2, -68.6, 173, 1.0], // Grimaldi floor
  [51.6, -9.4, 101, 1.0], // Plato floor
];

/** Large walled plains / complex craters: lat, lon, diameter km, floor darkening 0..1 (lava flooded floors). */
const WALLED: Array<[number, number, number, number]> = [
  [-9.3, -1.9, 153, 0.25], // Ptolemaeus
  [-13.4, -3.2, 108, 0.1], // Alphonsus
  [-18.2, -1.9, 96, 0.0], // Arzachel
  [-11.2, 4.0, 130, 0.1], // Albategnius
  [-5.1, 5.2, 138, 0.15], // Hipparchus
  [-58.4, -14.4, 231, 0.05], // Clavius
  [-50.0, -6.2, 194, 0.0], // Maginus
  [-49.6, -21.8, 145, 0.0], // Longomontanus
  [-44.3, -54.6, 206, 0.35], // Schickard
  [-18.0, 23.6, 99, 0.0], // Catharina
  [-13.2, 24.0, 98, 0.05], // Cyrillus
  [-11.4, 26.4, 100, 0.0], // Theophilus
  [31.8, 29.9, 95, 0.2], // Posidonius
  [14.5, -11.3, 58, 0.0], // Eratosthenes
  [29.7, -4.0, 81, 0.6], // Archimedes
  [50.2, 17.4, 87, 0.0], // Aristoteles
  [44.3, 16.3, 67, 0.0], // Eudoxus
  [-17.6, -40.1, 110, 0.35], // Gassendi
  [-20.7, -22.2, 61, 0.0], // Bullialdus
  [53.6, 56.5, 123, 0.7], // Endymion
  [-44.9, 40.8, 199, 0.0], // Janssen
  [-41.1, 6.0, 126, 0.1], // Stoefler
  [-33.0, 0.7, 132, 0.05], // Walter
  [-32.5, -5.2, 256, 0.05], // Deslandres
  [-25.5, -1.9, 118, 0.05], // Purbach
  [-25.1, 60.4, 177, 0.1], // Petavius
  [-8.9, 61.0, 132, 0.05], // Langrenus
  [-16.4, 61.6, 131, 0.0], // Vendelinus
  [-36.0, 60.4, 125, 0.0], // Furnerius
  [2.2, -67.6, 115, 0.35], // Hevelius
  [-3.0, -74.3, 139, 0.5], // Riccioli
  [-29.9, -13.5, 106, 0.3], // Pitatus
  [9.6, -20.1, 93, 0.0], // Copernicus
  [-43.3, -11.2, 85, 0.0], // Tycho
];

const RAYED: Array<[number, number, number, number, number]> = [
  // lat, lon, diameter km, brightness, ray length km
  [-43.3, -11.2, 85, 1.0, 1500], // Tycho
  [9.6, -20.1, 93, 0.8, 800], // Copernicus
  [8.1, -38.0, 32, 0.65, 400], // Kepler
  [23.7, -47.4, 40, 1.0, 250], // Aristarchus
  [16.1, 46.8, 28, 0.6, 400], // Proclus
  [-8.9, 61.0, 132, 0.45, 250], // Langrenus
  [-11.4, 26.4, 100, 0.35, 150], // Theophilus
  [-25.1, 60.4, 177, 0.3, 150], // Petavius
  [-32.5, 54.2, 75, 0.45, 350], // Stevinus
  [73.4, -10.1, 50, 0.55, 450], // Anaxagoras
  [16.3, 16.0, 26, 0.6, 180], // Menelaus
  [-24.5, -63.7, 19, 0.5, 300], // Byrgius A
  [8.4, -77.6, 40, 0.5, 350], // Glushko (Olbers A)
  [-1.9, 47.6, 11, 0.45, 150], // Messier A
];

function toVec4Array(rows: number[][]): THREE.Vector4[] {
  return rows.map((r) => {
    const lat = THREE.MathUtils.degToRad(r[0]);
    const lon = THREE.MathUtils.degToRad(r[1]);
    return new THREE.Vector4(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon), r[2] / 2 / 1737.4);
  });
}

const FRAGMENT = /* glsl */ `
uniform vec4 uMaria[${MARIA.length}];
uniform float uMariaDark[${MARIA.length}];
uniform vec4 uWalled[${WALLED.length}];
uniform float uWalledFloor[${WALLED.length}];
uniform vec4 uRayed[${RAYED.length}];
uniform vec2 uRayedParams[${RAYED.length}];
uniform float uSize;

float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), u.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), u.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.07 + 5.1; a *= 0.5; } return s / 0.875; }
float ridged(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * (1.0 - abs(vnoise(p) * 2.0 - 1.0)); p = p * 2.1 + 3.7; a *= 0.5; } return s / 0.9375; }

/* Crater profile (d = distance / radius): bowl, raised rim, ejecta apron. Returns (albedo delta, height in radii). */
vec2 craterProfile(float d, float radius, float fresh) {
  float bowl = d < 1.0 ? (d * d - 1.0) * 0.55 : 0.0;
  float rim = exp(-pow((d - 1.0) * 4.5, 2.0)) * 0.3;
  float apron = d > 1.0 ? exp(-(d - 1.0) * 3.0) * 0.08 : 0.0;
  float albedo = rim * (0.08 + 0.9 * fresh) + apron * fresh * 1.2 - (d < 0.85 ? 0.025 : 0.0);
  return vec2(albedo, (bowl + rim + apron) * radius * 0.35);
}

/* Cellular crater field on the unit sphere; density = probability of a crater per cell. */
vec2 craterField(vec3 p, float scale, float density, float seed) {
  vec3 q = p * scale;
  vec3 cell = floor(q);
  vec2 acc = vec2(0.0);
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 c = cell + vec3(x, y, z);
    vec3 h = hash33(c + seed);
    if (h.z > density) continue;
    vec3 center = c + 0.2 + 0.6 * h;
    float radius = mix(0.14, 0.62, pow(hash13(c + 7.1 + seed), 2.2));
    float d = length(q - center) / radius;
    if (d > 2.2) continue;
    float fresh = step(0.86, hash13(c + 3.3 + seed));
    acc += craterProfile(d, radius / scale, fresh);
  }
  return acc;
}

void main() {
  vec2 p = (gl_FragCoord.xy / uSize) * 2.0 - 1.0;
  float rr = dot(p, p);
  if (rr > 1.03) { gl_FragColor = vec4(0.12, 0.12, 0.12, 0.0); return; }
  vec3 s = normalize(vec3(p.x, p.y, sqrt(max(1.0 - rr, 0.0))));

  // Mare outlines: strongly domain-warped discs (lava plains follow basin rims but spill irregularly).
  vec3 warp = vec3(fbm(s * 2.2), fbm(s * 2.2 + 5.2), fbm(s * 2.2 + 9.1)) - 0.5;
  vec3 sw = normalize(s + warp * 0.34);
  float edgeNoise = fbm(sw * 6.0 + 2.0) - 0.5;
  float edgeFine = fbm(sw * 19.0 + 7.0) - 0.5;
  float clear = 1.0;
  float mareTone = 0.0;
  for (int i = 0; i < ${MARIA.length}; i++) {
    float ang = acos(clamp(dot(sw, uMaria[i].xyz), -1.0, 1.0));
    float t = ang / uMaria[i].w + edgeNoise * 0.7 + edgeFine * 0.25;
    float m = (1.0 - smoothstep(0.8, 1.1, t)) * uMariaDark[i];
    if (m > 0.002) {
      // Per-mare composition: interior tone gradient + patchy flows.
      float tone = fbm3(sw * 4.0 + float(i) * 1.37) - 0.5;
      mareTone += m * clear * tone;
      clear *= 1.0 - m;
    }
  }
  float mare = clamp(1.0 - clear, 0.0, 1.0);

  float highland = 0.145 + (fbm(s * 8.0) - 0.5) * 0.05 + (fbm(s * 35.0) - 0.5) * 0.035;
  float flows = ridged(sw * 16.0 + 4.0);
  float mareAlbedo = 0.062 + mareTone * 0.03 + (fbm(s * 13.0 + 3.0) - 0.5) * 0.016 + (flows - 0.6) * 0.01;
  float albedo = mix(highland, mareAlbedo, mare);
  float height = (fbm(s * 22.0) - 0.5) * 0.004 * (1.0 - 0.7 * mare);
  // Wrinkle ridges in the maria.
  height += (flows - 0.55) * 0.0012 * mare;

  // Saturated crater population in the highlands, sparse on the younger maria.
  float highDensity = mix(0.75, 0.2, mare);
  vec2 cr = craterField(s, 22.0, highDensity * 0.3, 1.0) * 1.0
          + craterField(s, 48.0, highDensity * 0.6, 17.0) * 0.8
          + craterField(s, 105.0, highDensity, 41.0) * 0.6
          + craterField(s, 230.0, mix(0.85, 0.45, mare), 73.0) * 0.45;
  albedo *= 1.0 + cr.x * mix(1.0, 0.5, mare);
  height += cr.y;

  // Named walled plains and complex craters (rims, terraces, flooded floors, central peaks).
  for (int i = 0; i < ${WALLED.length}; i++) {
    vec3 c = uWalled[i].xyz;
    float ang = acos(clamp(dot(s, c), -1.0, 1.0));
    float d = ang / uWalled[i].w;
    if (d > 2.0) continue;
    float rimNoise = 1.0 + (vnoise(s * 60.0 + float(i) * 3.1) - 0.5) * 0.16;
    d *= rimNoise;
    vec2 prof = craterProfile(d, uWalled[i].w, 0.2);
    float peak = exp(-pow(d / 0.16, 2.0)) * 0.35;
    float flooded = uWalledFloor[i] * (1.0 - smoothstep(0.75, 0.95, d));
    albedo = mix(albedo * (1.0 + prof.x * 0.45), mareAlbedo, flooded);
    height += (prof.y + peak * uWalled[i].w * 0.35) * (1.0 - flooded * 0.8);
  }

  // Rayed craters: bright ejecta nimbus + discontinuous streaks of varying length.
  for (int i = 0; i < ${RAYED.length}; i++) {
    vec3 c = uRayed[i].xyz;
    float ang = acos(clamp(dot(s, c), -1.0, 1.0));
    float r = ang / uRayed[i].w;
    float bright = uRayedParams[i].x;
    albedo += bright * 0.1 * (1.0 - smoothstep(0.7, 1.9, r));
    float rayLen = uRayedParams[i].y / 1737.4;
    if (rayLen > 0.0 && r > 0.9) {
      vec3 t1 = normalize(cross(c, vec3(0.0, 1.0, 0.0001)));
      vec3 t2 = cross(c, t1);
      vec3 d = s - c * dot(s, c);
      float az = atan(dot(d, t2), dot(d, t1));
      float seed = float(i) * 3.3;
      float streak = pow(vnoise(vec3(az * 9.0, seed, 0.5)), 4.0) + 0.7 * pow(vnoise(vec3(az * 26.0, seed, 2.5)), 6.0)
                   + 0.5 * pow(vnoise(vec3(az * 61.0, seed, 4.5)), 8.0);
      float lenVar = rayLen * (0.35 + 0.9 * vnoise(vec3(az * 7.0, seed, 9.0)));
      float along = 0.55 + 0.45 * vnoise(vec3(az * 5.0, ang * 45.0, seed));
      float fall = exp(-ang / lenVar * 2.0) * smoothstep(0.9, 1.8, r) * along;
      albedo += bright * 0.2 * streak * fall;
    }
  }
  albedo = clamp(albedo, 0.035, 0.32);
  // Titanium-rich maria read slightly blue, highlands and iron-rich maria slightly warm.
  vec3 tint = mix(vec3(1.0, 0.975, 0.93), mix(vec3(0.93, 0.95, 1.0), vec3(1.0, 0.96, 0.92), clamp(mareTone * 3.0 + 0.5, 0.0, 1.0)), mare * 0.7);
  gl_FragColor = vec4(albedo * tint, height);
}
`;

export function createMoonTexture(renderer: THREE.WebGLRenderer, size = 1024): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
  });
  target.texture.name = 'moon-albedo-height';
  const material = new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: FRAGMENT,
    uniforms: {
      uMaria: { value: toVec4Array(MARIA) },
      uMariaDark: { value: MARIA.map((m) => m[3]) },
      uWalled: { value: toVec4Array(WALLED) },
      uWalledFloor: { value: WALLED.map((w) => w[3]) },
      uRayed: { value: toVec4Array(RAYED) },
      uRayedParams: { value: RAYED.map((r) => new THREE.Vector2(r[3], r[4])) },
      uSize: { value: size },
    },
    depthTest: false,
    depthWrite: false,
  });
  renderFullscreen(renderer, material, target);
  material.dispose();
  return target;
}

const fsGeometry = new THREE.BufferGeometry();
fsGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));

export function renderFullscreen(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget): void {
  const mesh = new THREE.Mesh(fsGeometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(prev);
}
