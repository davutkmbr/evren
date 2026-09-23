/** The single city building material (patched MeshStandardMaterial) and its per-chunk fade variants. */
import * as THREE from 'three';
import { patchMaterial } from '../../../core/uniforms';
import { CITY_FADE_FRAGMENT, CITY_FRAGMENT_PARS, CITY_VERTEX_MAIN, CITY_VERTEX_PARS, CITY_VERTEX_WORLD } from './city.glsl';

const CACHE_KEY = 'city-building-v1';

function replaceOnce(src: string, search: string, replacement: string): string {
  if (!src.includes(search)) {
    console.warn(`[city] shader chunk "${search}" not found`);
    return src;
  }
  return src.replace(search, replacement);
}

export interface FadeHandle {
  material: THREE.MeshStandardMaterial;
  fade: THREE.IUniform<number>;
  invert: THREE.IUniform<number>;
}

export class CityMaterials {
  readonly opaque: THREE.MeshStandardMaterial;
  readonly heightTex: THREE.IUniform<THREE.Texture | null> = { value: null };
  readonly heightXform: THREE.IUniform<THREE.Vector4> = { value: new THREE.Vector4(0, 0, 0, 0) };
  /** Distance (m) at which each far fade class starts sinking into the terrain (Skyline, Large, Mid, Small). */
  readonly classFade: THREE.IUniform<THREE.Vector4> = { value: new THREE.Vector4(1e9, 1e9, 1e9, 1e9) };
  /** Debug view: 0 shaded, 1 emissive only, 2 albedo, 3 lighting without emission. */
  readonly debugView: THREE.IUniform<number> = { value: 0 };
  private readonly fadePool: FadeHandle[] = [];
  private readonly allFades: FadeHandle[] = [];

  constructor() {
    this.opaque = this.create(false).material;
  }

  setHeightTexture(tex: THREE.Texture, minX: number, minZ: number, size: number): void {
    this.heightTex.value = tex;
    this.heightXform.value.set(minX, minZ, 1 / size, 1);
  }

  private create(fade: boolean): FadeHandle {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, flatShading: true });
    material.name = fade ? 'city-building-fade' : 'city-building';
    const fadeU: THREE.IUniform<number> = { value: 1 };
    const invertU: THREE.IUniform<number> = { value: 0 };
    patchMaterial(material, fade ? `${CACHE_KEY}-fade` : CACHE_KEY, (shader) => {
      shader.uniforms.uCityHeight = this.heightTex;
      shader.uniforms.uCityHeightXform = this.heightXform;
      shader.uniforms.uCityClassFade = this.classFade;
      shader.uniforms.uCityDebug = this.debugView;
      if (fade) {
        shader.uniforms.uCityFade = fadeU;
        shader.uniforms.uCityFadeInvert = invertU;
      }
      let vs = shader.vertexShader;
      vs = replaceOnce(vs, '#include <common>', `#include <common>\n${CITY_VERTEX_PARS}`);
      vs = replaceOnce(vs, '#include <begin_vertex>', `#include <begin_vertex>\n${CITY_VERTEX_MAIN}`);
      vs = replaceOnce(vs, '#include <project_vertex>', `#include <project_vertex>\n${CITY_VERTEX_WORLD}`);
      shader.vertexShader = vs;

      let fs = fade ? `#define CITY_FADE\n${shader.fragmentShader}` : shader.fragmentShader;
      fs = replaceOnce(fs, '#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${CITY_FRAGMENT_PARS}`);
      fs = replaceOnce(fs, '#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${CITY_FADE_FRAGMENT}`);
      fs = replaceOnce(
        fs,
        '#include <color_fragment>',
        `#include <color_fragment>
  CitySurf citySurf = cityEval(normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition))));
  diffuseColor.rgb = citySurf.albedo;`,
      );
      fs = replaceOnce(fs, '#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n  roughnessFactor = citySurf.rough;`);
      fs = replaceOnce(fs, '#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n  metalnessFactor = citySurf.metal;`);
      fs = replaceOnce(fs, '#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n  normal = normalize((viewMatrix * vec4(citySurf.n, 0.0)).xyz);`);
      fs = replaceOnce(fs, '#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n  totalEmissiveRadiance += citySurf.emissive;`);
      fs = replaceOnce(
        fs,
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
  reflectedLight.indirectDiffuse *= citySurf.ao;
  reflectedLight.indirectSpecular *= citySurf.ao;`,
      );
      fs = replaceOnce(
        fs,
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
  if (uCityDebug > 0.5) {
    vec3 dbg = uCityDebug < 1.5 ? citySurf.emissive : uCityDebug < 2.5 ? citySurf.albedo : uCityDebug < 3.5 ? gl_FragColor.rgb - citySurf.emissive : (citySurf.dbg < 0.0 ? vec3(0.0, 0.0, 0.3) : vec3(citySurf.dbg * 3.0, citySurf.dbg * 0.3, 0.0));
    gl_FragColor = vec4(dbg, 1.0);
  }`,
      );
      shader.fragmentShader = fs;
    });
    return { material, fade: fadeU, invert: invertU };
  }

  acquireFade(): FadeHandle {
    const h = this.fadePool.pop();
    if (h) {
      return h;
    }
    const created = this.create(true);
    this.allFades.push(created);
    return created;
  }

  releaseFade(h: FadeHandle): void {
    this.fadePool.push(h);
  }

  dispose(): void {
    this.opaque.dispose();
    for (const h of this.allFades) {
      h.material.dispose();
    }
    this.allFades.length = 0;
    this.fadePool.length = 0;
  }
}
