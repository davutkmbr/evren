/**
 * Building materials:
 * - facade: one MeshStandardMaterial for every wall, trim and flat roof, sampling the CC0 facade sets from texture
 *   arrays (plaster, painted plaster, sandstone blocks, concrete, brick) and running the procedural facade of
 *   facade-glsl.ts;
 * - roof: Marseille clay tiles (CC0 texture) with per-roof weathering, lead domes and flat lead roofs, metal and
 *   slate covers, ridge caps;
 * - prop: rooftop clutter and minarets (vertex colours);
 * - detail: near-LOD facade elements (anchored instancing, distance fade, shadows with matching depth material).
 */
import * as THREE from 'three';
import { patchMaterial, streetHole } from '../../../core/uniforms';
import { bindPbr, loadPbrArrays, maxAnisotropy, REPEAT_M, type TextureSet } from '../shared/textures';
import type { DetailKind } from './details';
import { FACADE_FRAGMENT_PARS, FACADE_LIGHT, FACADE_MAIN, FACADE_NORMAL, FACADE_VERTEX_MAIN, FACADE_VERTEX_PARS } from './facade-glsl';
import { RoofCover } from './plan';
import { RoofPart } from './roofs';
import { SIGN_GLSL } from './signs';

/** Facade texture array layers (archetypes.ts Layer order). */
export const FACADE_LAYERS: readonly TextureSet[] = ['plaster', 'plaster_painted', 'stone', 'concrete', 'brick'];
const ARRAY_SIZE = 1024;
/**
 * Facade-specific repeat sizes (m): the sandstone set reads as 60 cm ashlar courses at 3.4 m (Karaköy banks and hans),
 * as brick-sized blocks at its 2 m default.
 */
const LAYER_REPEAT: Partial<Record<TextureSet, number>> = { stone: 3.4 };
/** Normal-map strength per layer: dressed ashlar and render are smoother than the scans suggest at street distance. */
const LAYER_NORMAL: Partial<Record<TextureSet, number>> = { plaster: 0.7, plaster_painted: 0.8, stone: 0.45, concrete: 0.6, brick: 0.9 };

const f = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);

function makeFacadeMaterial(uniforms: Record<string, THREE.IUniform>): THREE.MeshStandardMaterial {
  const m = streetHole(new THREE.MeshStandardMaterial({ name: 'osm-facade', vertexColors: true, roughness: 1, metalness: 0 }));
  patchMaterial(m, 'osm-facade-v4', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${FACADE_VERTEX_PARS}`).replace('#include <project_vertex>', `#include <project_vertex>\n${FACADE_VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${FACADE_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FACADE_MAIN}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n  roughnessFactor = fRough;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FACADE_NORMAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n  totalEmissiveRadiance += fEmis;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FACADE_LIGHT}`);
  });
  return m;
}

const ROOF_VERTEX_PARS = /* glsl */ `
attribute vec4 aRoof;
varying vec4 vRoof;
varying vec3 vRW;
varying vec2 vRUv;
`;
const ROOF_VERTEX_MAIN = /* glsl */ `
vRoof = aRoof;
vRUv = uv;
vRW = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;
const ROOF_FRAGMENT_PARS = /* glsl */ `
varying vec4 vRoof;
varying vec3 vRW;
varying vec2 vRUv;
`;

/** Roof covers and weathering (after <color_fragment>; the tile texture is already in diffuseColor). */
const ROOF_MAIN = /* glsl */ `
float rRough = -1.0;
float rMetal = 0.0;
float rFlat = 0.0;
{
  float cover = floor(vRoof.x + 0.5);
  float seed = vRoof.y;
  float wear = vRoof.z;
  float part = floor(vRoof.w + 0.5);
  vec2 uvm = vRUv;
  vec3 wp = vRW;
  float n1 = vnoise2(wp.xz * 0.35 + seed * 11.0);
  float n2 = vnoise2(wp.xz * 1.9 + seed * 3.0);
  if (cover > ${f(RoofCover.Lead)} - 0.5 && cover < ${f(RoofCover.Lead)} + 0.5) {
    // Lead sheets with standing seams; pale patina streaks.
    float seam = part > ${f(RoofPart.Dome)} - 0.5 && part < ${f(RoofPart.Dome)} + 0.5 ? fract(uvm.x / 0.75) : fract(wp.x / 0.8);
    float ridge = 1.0 - smoothstep(0.0, 0.06, min(seam, 1.0 - seam));
    vec3 lead = mix(vec3(0.36, 0.37, 0.37), vec3(0.47, 0.48, 0.47), n1);
    lead = mix(lead, vec3(0.6, 0.6, 0.57), smoothstep(0.55, 0.85, vnoise2(vec2(uvm.x * 2.0, uvm.y * 0.3) + seed)) * 0.45);
    diffuseColor.rgb = lead * (1.0 + 0.2 * ridge);
    rRough = 0.68;
    rMetal = 0.12;
    rFlat = 0.9;
  } else if (cover > ${f(RoofCover.Metal)} - 0.5 && cover < ${f(RoofCover.Metal)} + 0.5) {
    float rib = 0.5 + 0.5 * cos(uvm.x * 6.2832 / 0.2);
    vec3 sheet = mix(vec3(0.46, 0.48, 0.5), vec3(0.42, 0.25, 0.16), smoothstep(0.5, 0.8, n1) * wear);
    diffuseColor.rgb = sheet * (0.85 + 0.2 * rib);
    rRough = 0.55;
    rMetal = 0.4;
    rFlat = 0.8;
  } else if (cover > ${f(RoofCover.Slate)} - 0.5) {
    vec2 t = vec2(uvm.x / 0.4, uvm.y / 0.3);
    float course = floor(t.y);
    float edge = 1.0 - smoothstep(0.0, 0.08, fract(t.y)) + (1.0 - smoothstep(0.0, 0.05, abs(fract(t.x + 0.5 * course) - 0.5) * 2.0 - 0.95));
    diffuseColor.rgb = mix(vec3(0.3, 0.31, 0.32), vec3(0.42, 0.42, 0.41), hash12(vec2(floor(t.x + 0.5 * course), course) + seed)) * (1.0 - 0.3 * clamp(edge, 0.0, 1.0));
    rRough = 0.75;
    rFlat = 0.7;
  } else {
    // Marseille clay tiles: per-tile tone jitter, replaced (brighter) tiles, lichen / soot patches, eave dirt.
    vec2 tile = floor(vec2(uvm.x / 0.24, uvm.y / 0.4));
    float jitter = hash12(tile + seed * 7.0);
    diffuseColor.rgb *= 0.86 + 0.28 * jitter;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 1.02, 0.85), step(0.965, jitter));
    float lichen = smoothstep(0.62, 0.9, fbm2(wp.xz * 0.5 + seed * 5.0, 3) + 0.3 * (wear - 0.5));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.52, 0.45) * (0.8 + 0.4 * n2), lichen * 0.45);
    diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 1.6, uvm.y));
    diffuseColor.rgb *= 1.0 - 0.25 * wear * smoothstep(0.4, 0.8, vnoise2(vec2(uvm.x * 1.5, uvm.y * 0.2) + seed));
    if (part > 0.5 && part < 1.5) {
      diffuseColor.rgb *= 0.78;
      rFlat = 0.6;
    }
  }
}
`;

function makeRoofMaterial(): THREE.MeshStandardMaterial {
  const m = streetHole(new THREE.MeshStandardMaterial({ name: 'osm-roof', vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
  patchMaterial(m, 'osm-roof-v3', (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${ROOF_VERTEX_PARS}`).replace('#include <project_vertex>', `#include <project_vertex>\n${ROOF_VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ROOF_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${ROOF_MAIN}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n  if (rRough > 0.0) roughnessFactor = rRough;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n  metalnessFactor = max(metalnessFactor, rMetal);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n  normal = normalize(mix(normal, normalize(vNormal) * faceDirection, rFlat));`);
  });
  return m;
}

/** Detail kind ids for the detail shader (uKind). */
const DETAIL_SHADE: Record<DetailKind, number> = {
  surroundCap: 0,
  surroundPediment: 0,
  surroundArch: 0,
  sill: 0,
  frame: 0,
  balcony: 0,
  parapet: 5,
  shutter: 1,
  railing: 2,
  sign: 3,
  awning: 4,
  ac: 6,
};

const DETAIL_VERTEX_PARS = /* glsl */ `
attribute vec4 aAnchor;
uniform vec2 uFade;
uniform vec3 uCamPos;
varying vec3 vDL;
varying vec3 vDS;
varying vec3 vDW;
varying vec3 vDO;
vec3 dScale() {
  return vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
}
vec3 dLocal(vec3 s) {
  return vec3(aAnchor.x * s.x, aAnchor.y * s.y + aAnchor.z * s.z, aAnchor.w * s.z) + position;
}
float dFade() {
  vec3 o = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  return 1.0 - smoothstep(uFade.x, uFade.y, distance(uCamPos, o));
}
`;
const DETAIL_BEGIN = /* glsl */ `
vec3 dS = dScale();
vec3 dL = dLocal(dS);
vDL = dL;
vDS = dS;
vec3 transformed = dL * dFade() / dS;
`;

/**
 * Iron railing pattern (discard where open): Levantine cast iron with bars, rails and rings, or plain bars. Once the
 * 12 cm bar pitch drops below a few pixels the pattern would alias into black speckle (seen from the air), so it
 * turns into a stable screen-space dither with the railing's mean coverage.
 */
const RAILING_GLSL = /* glsl */ `
bool dRailOpen(vec3 l, vec3 s, float h) {
  float along = abs(l.z - s.z) < 0.06 ? l.x : l.z;
  float y = l.y;
  float px = max(fwidth(along), fwidth(y));
  if (px > 0.03) {
    float ign = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
    float cover = mix(0.42, 0.3, smoothstep(0.03, 0.08, px));
    return ign > cover;
  }
  float bars = 1.0 - step(0.022, abs(fract(along / 0.12) - 0.5) * 0.12);
  float rails = 1.0 - step(0.03, min(min(abs(y - 0.08), abs(y - s.y + 0.04)), abs(y - s.y * 0.72)));
  float rings = 0.0;
  if (h > 0.5) {
    vec2 q = vec2(fract(along / 0.24) - 0.5, (y - s.y * 0.86) / 0.24) * 0.24;
    rings = 1.0 - step(0.012, abs(length(q) - 0.07));
    rings *= step(abs(y - s.y * 0.86), 0.1);
  }
  return max(max(bars, rails), rings) < 0.5;
}
`;

const DETAIL_FRAGMENT_PARS = /* glsl */ `
uniform float uKind;
${SIGN_GLSL}
varying vec3 vDL;
varying vec3 vDS;
varying vec3 vDW;
varying vec3 vDO;
${RAILING_GLSL}
`;

const DETAIL_FRAGMENT_MAIN = /* glsl */ `
vec3 dEmis = vec3(0.0);
float dRough = -1.0;
float dMetal = 0.0;
{
  vec3 l = vDL;
  float n = vnoise2(vDW.xz * 1.3 + vDW.y * 0.7);
  float lightsOn = smoothstep(0.06, 0.5, uNight);
  if (uKind < 0.5) {
    // Stucco / stone mouldings, balcony slabs.
    diffuseColor.rgb *= 0.9 + 0.15 * n;
    dRough = 0.85;
  } else if (uKind < 1.5) {
    // Louvred shutters.
    float louv = 0.7 + 0.3 * step(0.45, fract(l.y / 0.065));
    float frame = 1.0 - step(0.05, min(abs(abs(l.x) - vDS.x * 1.0 - 0.12), abs(abs(l.x) - vDS.x * 2.0 - 0.12)));
    diffuseColor.rgb *= mix(louv, 0.8, frame) * (0.85 + 0.2 * n);
    dRough = 0.7;
  } else if (uKind < 2.5) {
    // Wrought / cast iron.
    if (dRailOpen(l, vDS, step(0.5, fract(vDS.x * 3.7)))) discard;
    dRough = 0.45;
    dMetal = 0.6;
  } else if (uKind < 3.5) {
    // Shop sign: Turkish trade word (and a name) in a 5x7 bitmap font on a fascia box (signs.ts).
    float face = step(vDS.z - 0.01, l.z);
    float hs = hash12(vDO.xz * 0.37 + vDS.x);
    vec3 base = diffuseColor.rgb;
    float dark = step(dot(base, vec3(0.3, 0.55, 0.15)), 0.35);
    vec3 ink = dark > 0.5 ? mix(vec3(0.95, 0.93, 0.88), vec3(0.98, 0.8, 0.25), step(0.7, hs)) : mix(vec3(0.06), vec3(0.6, 0.08, 0.06), step(0.6, hs));
    int cat = int(clamp(floor((vDS.z - 0.135) * 100.0), 0.0, 3.0));
    float text = signText(l.xy, vDS.x, vDS.y, cat, hs, fwidth(l.x)) * face;
    diffuseColor.rgb = mix(base, ink, text);
    // Lightbox (whole face glows) or lit channel letters only.
    float lightbox = step(0.45, hs);
    dEmis = face * lightsOn * mix(ink * text * 2.2, diffuseColor.rgb * 1.4, lightbox);
    dRough = 0.35;
  } else if (uKind < 4.5) {
    // Canvas awning: mostly plain, some with soft stripes; faded towards the top, darker valance.
    float striped = step(0.72, fract(vDS.x * 5.3 + vDS.z * 3.1));
    float stripe = step(0.5, fract(l.x / 0.42));
    vec3 canvas = diffuseColor.rgb;
    diffuseColor.rgb = mix(canvas, mix(canvas, vec3(0.86, 0.83, 0.76), 0.55), stripe * striped);
    diffuseColor.rgb *= 0.88 + 0.12 * n;
    diffuseColor.rgb *= mix(0.85, 1.0, smoothstep(-vDS.y, -vDS.y * 0.5, l.y));
    dRough = 0.9;
  } else if (uKind < 5.5) {
    // Solid balcony parapet in the wall colour, dirtier at the top.
    diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(vDS.y, vDS.y - 0.3, l.y)) * (0.9 + 0.15 * n);
    dRough = 0.9;
  } else {
    // Air-conditioner unit: fan grille on the front.
    vec2 q = vec2(l.x + 0.12, l.y - 0.27);
    float grille = step(length(q), 0.2) * (0.6 + 0.4 * step(0.5, fract(length(q) / 0.03)));
    diffuseColor.rgb *= mix(1.0, 0.35, grille * step(0.33, l.z));
    dRough = 0.5;
  }
}
`;

function detailMaterial(kind: DetailKind, fade: THREE.IUniform<THREE.Vector2>): { material: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } {
  const shade = DETAIL_SHADE[kind];
  const material = streetHole(new THREE.MeshStandardMaterial({ name: `osm-detail-${kind}`, vertexColors: true, roughness: 0.85, metalness: 0, side: shade === 2 || shade === 4 ? THREE.DoubleSide : THREE.FrontSide }));
  const kindU = { value: shade };
  patchMaterial(material, 'osm-detail-v3', (shader) => {
    shader.uniforms.uFade = fade;
    shader.uniforms.uKind = kindU;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DETAIL_VERTEX_PARS}`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normal * dScale();')
      .replace('#include <begin_vertex>', DETAIL_BEGIN)
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vDW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n  vDO = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${DETAIL_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${DETAIL_FRAGMENT_MAIN}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n  if (dRough > 0.0) roughnessFactor = dRough;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n  metalnessFactor = dMetal;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n  totalEmissiveRadiance += dEmis;`);
  });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  patchMaterial(depth, `osm-detail-depth-${shade === 2 ? 'rail' : 'solid'}`, (shader) => {
    shader.uniforms.uFade = fade;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DETAIL_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', DETAIL_BEGIN)
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vDW = vec3(0.0);\n  vDO = vec3(0.0);');
    if (shade === 2) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vDL;\nvarying vec3 vDS;\nvarying vec3 vDW;\n${RAILING_GLSL}`).replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n  if (dRailOpen(vDL, vDS, step(0.5, fract(vDS.x * 3.7)))) discard;`);
    }
  });
  return { material, depth };
}

export interface BuildingMaterials {
  facade: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  prop: THREE.MeshStandardMaterial;
  details: Record<DetailKind, { material: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial; fade: THREE.IUniform<THREE.Vector2> }>;
  /** Resolves once every texture is bound. */
  ready: Promise<void>;
  dispose(): void;
}

/** Mean linear luminance of each layer of an sRGB RGBA8 texture array. */
function layerLuminance(t: THREE.DataArrayTexture): number[] {
  const img = t.image as { data: Uint8Array; width: number; height: number; depth: number };
  const layer = img.width * img.height * 4;
  const out: number[] = [];
  const lin = (c: number): number => Math.pow(c / 255, 2.2);
  for (let l = 0; l < img.depth; l++) {
    let sum = 0;
    let n = 0;
    for (let k = l * layer; k < (l + 1) * layer; k += 4 * 97) {
      sum += 0.2126 * lin(img.data[k]) + 0.7152 * lin(img.data[k + 1]) + 0.0722 * lin(img.data[k + 2]);
      n++;
    }
    out.push(Math.max(0.05, sum / Math.max(1, n)));
  }
  return out;
}

export function createBuildingMaterials(renderer: THREE.WebGLRenderer, detailKinds: readonly DetailKind[]): BuildingMaterials {
  const loader = new THREE.TextureLoader();
  const aniso = maxAnisotropy(renderer);
  const textures: THREE.Texture[] = [];
  const uniforms: Record<string, THREE.IUniform> = {
    uFacAlb: { value: null },
    uFacNrm: { value: null },
    uLayerNorm: { value: FACADE_LAYERS.map(() => 1) },
    uLayerRep: { value: FACADE_LAYERS.map((s) => LAYER_REPEAT[s] ?? REPEAT_M[s]) },
    uLayerNrm: { value: FACADE_LAYERS.map((s) => LAYER_NORMAL[s] ?? 1) },
  };
  const facade = makeFacadeMaterial(uniforms);
  const roof = makeRoofMaterial();
  const prop = streetHole(new THREE.MeshStandardMaterial({ name: 'osm-prop', vertexColors: true, roughness: 0.65, metalness: 0.05 }));
  const details = {} as BuildingMaterials['details'];
  for (const k of detailKinds) {
    const fade = { value: new THREE.Vector2(1e5, 1e5 + 1) };
    details[k] = { ...detailMaterial(k, fade), fade };
  }
  const ready = Promise.all([
    loadPbrArrays(FACADE_LAYERS, ARRAY_SIZE, aniso).then(([alb, nrm]) => {
      textures.push(alb, nrm);
      uniforms.uFacAlb.value = alb;
      uniforms.uFacNrm.value = nrm;
      uniforms.uLayerNorm.value = layerLuminance(alb).map((l, i) => (FACADE_LAYERS[i] === 'brick' ? 1 : 0.62 / l));
    }),
    bindPbr(roof, 'roof_tiles', loader, aniso).then((t) => {
      textures.push(...t);
    }),
  ]).then(() => undefined);
  return {
    facade,
    roof,
    prop,
    details,
    ready,
    dispose() {
      for (const t of textures) {
        t.dispose();
      }
      for (const m of [facade, roof, prop]) {
        m.dispose();
      }
      for (const d of Object.values(details)) {
        d.material.dispose();
        d.depth.dispose();
      }
    },
  };
}
