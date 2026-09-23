/**
 * The two batch materials of the structures module:
 * - opaque: MeshStandardMaterial patched with the procedural surface library (steel, concrete, stone, asphalt...)
 *   selected per vertex (aSurf), plus night emission (floodlights, LED shows, windows, lamp pools; aEmit);
 * - glass: MeshPhysicalMaterial curtain walls with procedural mullions, spandrels, per-pane reflection breakup,
 *   tinted F0 via the specular colour, lit offices at night and crown lighting.
 * Both keep three's lighting, cascaded sun shadows, sky environment reflections and aerial perspective.
 */
import * as THREE from 'three';
import { patchMaterial } from '../../../../core/uniforms';
import { Facade } from '../build/surfaces';
import { LED_GLSL } from './glsl/led.glsl';
import { SURFACE_GLSL } from './glsl/surface.glsl';

const VERTEX_PARS = /* glsl */ `
attribute vec4 aSurf;
attribute vec4 aEmit;
varying vec4 vSurf;
varying vec4 vEmitP;
varying vec2 vUvM;
varying vec3 vStructWorld;
`;

const VERTEX_MAIN = /* glsl */ `
vSurf = aSurf;
vEmitP = aEmit;
vUvM = uv;
{
  vec4 structWp = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    structWp = batchingMatrix * structWp;
  #endif
  vStructWorld = (modelMatrix * structWp).xyz;
}
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec4 vSurf;
varying vec4 vEmitP;
varying vec2 vUvM;
varying vec3 vStructWorld;
`;

function patchVertex(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_MAIN}`);
}

function requireChunk(source: string, chunk: string, label: string): void {
  if (!source.includes(chunk)) {
    console.warn(`[structures] material patch "${label}" could not find ${chunk}`);
  }
}

export function createOpaqueMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  material.name = 'structures.opaque';
  patchMaterial(material, 'structures-opaque-v1', (shader) => {
    patchVertex(shader);
    const fs = shader.fragmentShader;
    requireChunk(fs, '#include <fog_pars_fragment>', 'opaque pars');
    shader.fragmentShader = fs
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${LED_GLSL}\n${SURFACE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
  vec3 structAlbedo = diffuseColor.rgb;
  float structRough = vSurf.y;
  float structMetal = vSurf.z;
  float structH = 0.0;
  float structFw = max(max(fwidth(vUvM.x), fwidth(vUvM.y)), 1e-4);
  float structType = vSurf.x;
  if (structType < 0.5) {
    structSteel(structAlbedo, structRough, structH, vUvM, vStructWorld, vSurf.w, structFw);
  } else if (structType < 1.5) {
    structConcrete(structAlbedo, structRough, structH, vUvM, vStructWorld, vSurf.w, structFw);
  } else if (structType < 2.5) {
    structAshlar(structAlbedo, structRough, structH, vUvM, vStructWorld, vSurf.w, structFw);
  } else if (structType < 3.5) {
    structRubble(structAlbedo, structRough, structH, vUvM, vStructWorld, vSurf.w, structFw);
  } else if (structType < 4.5) {
    structMetal = 0.0;
    structRoad(structAlbedo, structRough, structH, vUvM, vStructWorld, vSurf.w, vSurf.z, structFw);
  } else if (structType < 5.5) {
    structLead(structAlbedo, structRough, structMetal, structH, vUvM, vStructWorld, vSurf.w, structFw);
  } else if (structType < 6.5) {
    structPlain(structAlbedo, structRough, structH, vUvM, vStructWorld, structFw);
  } else if (structType < 7.5) {
    structRail(structAlbedo, structRough, structMetal, structH, vUvM, vStructWorld, vSurf.w, structFw);
  } else if (structType < 8.5) {
    structPaving(structAlbedo, structRough, structH, vUvM, vStructWorld, vSurf.w, structFw);
  } else {
    structRough = 0.06 + 0.05 * hash12(floor(vStructWorld.xz * 0.7));
  }
  diffuseColor.rgb = structAlbedo;
`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = structRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = structMetal;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  normal = structBump(-vViewPosition, normal, structH, faceDirection);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  {
    vec3 structNW = inverseTransformDirection(normal, viewMatrix);
    totalEmissiveRadiance += structEmission(structAlbedo, vUvM, vStructWorld, structNW, vEmitP, vSurf.w, vSurf.z);
  }`,
      );
  });
  return material;
}

const GLASS_FRAGMENT = /* glsl */ `
  vec3 gTint = diffuseColor.rgb;
  float gStyle = vSurf.x;
  float gFloor = max(vSurf.y, 2.4);
  float gBay = max(vSurf.z, 0.6);
  float gSeed = vSurf.w;
  vec2 guv = vUvM;
  float gfw = max(max(fwidth(guv.x), fwidth(guv.y)), 1e-4);
  vec2 gcell = floor(guv / vec2(gBay, gFloor));
  vec2 gf = (guv / vec2(gBay, gFloor) - gcell) * vec2(gBay, gFloor);
  float gPaneRand = hash12(gcell + gSeed * 13.1);

  // style table: spandrel height, mullion half width, frame colour, pane reflectance, interior tone
  float spH = 1.0;
  float mullW = 0.035;
  float transW = 0.04;
  vec3 frameCol = vec3(0.55, 0.57, 0.6);
  float frameRough = 0.38;
  float frameMetal = 0.85;
  float refl = 0.2;
  vec3 interior = vec3(0.028, 0.03, 0.034);
  vec3 spandrelCol = gTint * 0.22;
  float fin = 0.0;
  if (gStyle < ${Facade.BlueBand}.5) {
    spH = 1.05;
  } else if (gStyle < ${Facade.SilverFins}.5) {
    spH = 0.0;
    refl = 0.34;
    mullW = 0.03;
    fin = structLine(min(gf.x, gBay - gf.x), 0.09, gfw);
  } else if (gStyle < ${Facade.DarkGrid}.5) {
    spH = 0.55;
    mullW = 0.06;
    transW = 0.07;
    frameCol = vec3(0.72, 0.73, 0.74);
    frameMetal = 0.2;
    frameRough = 0.45;
    refl = 0.15;
    interior = vec3(0.018, 0.019, 0.021);
  } else if (gStyle < ${Facade.Residential}.5) {
    spH = 0.0;
    refl = 0.1;
    frameCol = vec3(0.78, 0.78, 0.76);
    frameMetal = 0.0;
    frameRough = 0.7;
    transW = 0.2;
    interior = vec3(0.05, 0.045, 0.04);
  } else if (gStyle < ${Facade.GreenBand}.5) {
    spH = 0.9;
    refl = 0.2;
  } else if (gStyle < ${Facade.Bronze}.5) {
    spH = 0.8;
    refl = 0.28;
    frameCol = vec3(0.3, 0.24, 0.18);
    frameMetal = 0.9;
    interior = vec3(0.025, 0.02, 0.016);
  } else {
    spH = 0.0;
    refl = 0.22;
    fin = structLine(min(gf.x, gBay - gf.x), 0.16, gfw);
    frameCol = vec3(0.8, 0.8, 0.79);
    frameMetal = 0.05;
    frameRough = 0.5;
  }
  float mull = structLine(min(gf.x, gBay - gf.x), mullW, gfw);
  float transom = structLine(min(gf.y, gFloor - gf.y), transW, gfw);
  float spandrel = spH > 0.0 ? 1.0 - smoothstep(spH - gfw, spH + gfw, gf.y) : 0.0;
  float frame = clamp(max(max(mull, transom), fin), 0.0, 1.0);
  float pane = (1.0 - frame) * (1.0 - spandrel);

  vec3 gDiffuse = mix(interior * (0.8 + 0.4 * gPaneRand), spandrelCol, spandrel);
  gDiffuse = mix(gDiffuse, frameCol, frame);
  diffuseColor.rgb = gDiffuse;
  // coated glass: F0 = hue of the tint (normalised) * style reflectance, slight per-pane variation
  vec3 gTintN = min(gTint / max(dot(gTint, vec3(0.2126, 0.7152, 0.0722)), 0.04), vec3(2.5));
  vec3 structSpecColor = mix(gTintN * refl * (0.9 + 0.2 * gPaneRand) / 0.04, vec3(1.0), frame);
  float structRough = mix(0.035 + 0.035 * gPaneRand + spandrel * 0.05, frameRough, frame);
  float structMetal = mix(0.0, frameMetal, frame);
`;

export function createGlassMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.05,
    metalness: 0,
    ior: 1.5,
    specularIntensity: 1,
    specularColor: new THREE.Color(0.999, 0.999, 0.999),
  });
  material.name = 'structures.glass';
  patchMaterial(material, 'structures-glass-v2', (shader) => {
    patchVertex(shader);
    const fs = shader.fragmentShader;
    requireChunk(fs, '#include <lights_physical_fragment>', 'glass specular');
    const physical = THREE.ShaderChunk.lights_physical_fragment;
    requireChunk(physical, 'vec3 specularColorFactor = vec3( 1.0 );', 'glass specular factor');
    shader.fragmentShader = fs
      .replace('#include <lights_physical_fragment>', physical.replace('vec3 specularColorFactor = vec3( 1.0 );', 'vec3 specularColorFactor = structSpecColor;'))
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${LED_GLSL}\n${SURFACE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${GLASS_FRAGMENT}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = structRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = structMetal;')
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
  {
    // per-pane flatness error: tiny random tilt so reflections break at pane edges like real curtain walls
    vec2 jr = hash22(gcell + gSeed * 5.3) - 0.5;
    vec3 nW = inverseTransformDirection(normal, viewMatrix);
    vec3 tU = normalize(cross(vec3(0.0, 1.0, 0.0), nW) + vec3(1e-4, 0.0, 0.0));
    vec3 jitterW = (tU * jr.x + vec3(0.0, 1.0, 0.0) * jr.y) * 0.022 * pane;
    normal = normalize(normal + (viewMatrix * vec4(jitterW, 0.0)).xyz);
  }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
  {
    float on = structLightsOn();
    if (on > 0.0) {
      float lateness = clamp((mod(uTimeOfDay - 17.0, 24.0) - 2.5) / 9.0, 0.0, 1.0);
      bool resid = gStyle > ${Facade.Residential}.0 - 0.5 && gStyle < ${Facade.Residential}.5;
      float frac = resid ? mix(0.5, 0.1, lateness) : mix(0.58, 0.08, lateness);
      float floorBias = hash11(gcell.y * 1.37 + gSeed * 11.0);
      float floorFrac = frac * (0.35 + 1.3 * floorBias * floorBias);
      vec2 office = floor(gcell / vec2(resid ? 2.0 : 3.0, 1.0));
      float lit = step(hash12(office + gSeed * 7.0), floorFrac);
      vec3 lc = resid ? mix(vec3(1.0, 0.6, 0.3), vec3(1.0, 0.75, 0.5), hash12(office * 1.3))
                      : mix(vec3(1.0, 0.8, 0.6), vec3(0.82, 0.9, 1.0), step(0.45, hash11(gcell.y * 3.1 + gSeed)));
      float ceiling = 0.55 + 0.45 * smoothstep(0.1, 1.0, gf.y / gFloor);
      float blinds = resid ? 0.6 + 0.4 * step(0.5, hash12(gcell * 1.9 + 4.0)) : 1.0;
      totalEmissiveRadiance += lc * lit * ceiling * blinds * (1.2 + 1.8 * gPaneRand) * pane * on;
      if (vEmitP.x > 5.5 && guv.y > vEmitP.y) {
        float band = smoothstep(vEmitP.y, vEmitP.y + 6.0, guv.y);
        vec3 cc = vEmitP.z < 0.5 ? vec3(1.0, 0.8, 0.6) : vEmitP.z < 1.5 ? vec3(0.85, 0.92, 1.0) : vEmitP.z < 2.5 ? vec3(0.1, 0.35, 1.0)
          : vEmitP.z < 3.5 ? structLed(5.0 + gSeed, fract(guv.x * 0.004), (guv.y - vEmitP.y) * 0.02) : vec3(1.0, 0.05, 0.03);
        float lines = max(fin, mull) * 0.8 + 0.25;
        totalEmissiveRadiance += cc * vEmitP.w * band * lines * on;
      }
    }
  }`,
      );
  });
  return material;
}
