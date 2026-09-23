/**
 * Terrain sandbox.
 *   /sandbox/terrain.html?view=sultanahmet&t=17.5      camera at a VIEW_PRESET (heading/pitch from the preset)
 *   &x=..&y=..&z=..&h=..&p=..                         explicit camera (local metres, heading/pitch degrees)
 *   &lat=..&lon=..&alt=..                              camera by lat/lon
 *   &fov=60 &clouds=1 &water=placeholder|flat|0 &terrainDebug=lod|landuse|grey &carpetStart=0
 *   &tiles=carpets|nature|detail&layer=0&zoom=1   baked surface tile preview (albedo left, aux right)
 */
import * as THREE from 'three';
import { startSandbox } from '../src/core/sandbox';
import { UpdateOrder, type EngineContext, type System } from '../src/core/contracts';
import { VIEW_PRESETS } from '../src/core/debug';
import { headingToYaw, latLonToLocal } from '../src/core/geo-coords';
import { createRenderPipeline } from '../src/render/post';
import { createGeoSystem } from '../src/world/geo';
import { createSkySystem } from '../src/render/sky';
import { createCloudSystem } from '../src/render/clouds';
import { createWaterSystem } from '../src/world/water';
import { TerrainSystem } from '../src/world/terrain/terrain-system';

const params = new URLSearchParams(window.location.search);
const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);

interface CamPose {
  x: number;
  y: number;
  z: number;
  h: number;
  p: number;
}

function initialPose(): CamPose {
  const preset = VIEW_PRESETS[params.get('view') ?? 'spawn'] ?? VIEW_PRESETS.spawn;
  const pose: CamPose = { x: preset.x, y: preset.y, z: preset.z, h: preset.headingDeg, p: preset.pitchDeg };
  if (params.has('lat') && params.has('lon')) {
    const l = latLonToLocal(num('lat', 41), num('lon', 29));
    pose.x = l.x;
    pose.z = l.z;
  }
  pose.x = num('x', pose.x);
  pose.y = num('alt', num('y', pose.y));
  pose.z = num('z', pose.z);
  pose.h = num('h', pose.h);
  pose.p = num('p', pose.p);
  return pose;
}

function createSandboxCamera(): System {
  const pose = initialPose();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const apply = (ctx: EngineContext): void => {
    const cam = ctx.camera;
    cam.position.set(pose.x, pose.y, pose.z);
    euler.set(THREE.MathUtils.degToRad(pose.p), headingToYaw(pose.h), 0, 'YXZ');
    cam.quaternion.setFromEuler(euler);
    cam.fov = num('fov', 60);
    cam.near = 0.5;
    cam.far = 60000;
    cam.updateProjectionMatrix();
  };
  return {
    name: 'sandbox-camera',
    order: UpdateOrder.Camera,
    init(ctx) {
      apply(ctx);
      (window as unknown as Record<string, unknown>).__cam = {
        set: (p: Partial<CamPose>) => {
          Object.assign(pose, p);
          apply(ctx);
        },
        pose,
      };
    },
    update(_dt, ctx) {
      apply(ctx);
    },
  };
}

function createFlatWater(): System {
  return {
    name: 'flat-water',
    order: UpdateOrder.World,
    init(ctx) {
      const m = new THREE.MeshStandardMaterial({ color: 0x0c2230, roughness: 0.08, metalness: 0 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(200000, 200000).rotateX(-Math.PI / 2), m);
      mesh.receiveShadow = true;
      ctx.scene.add(mesh);
    },
  };
}

function createTilePreview(kind: string): System {
  const layerCount: Record<string, number> = { carpets: 5, nature: 2, detail: 7 };
  const uniforms = {
    uTex: { value: null as THREE.Texture | null },
    uLayers: { value: layerCount[kind] ?? 1 },
    uLayer: { value: num('layer', 0) },
    uZoom: { value: num('zoom', 1) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }',
    fragmentShader: `
      precision highp sampler2DArray;
      uniform sampler2DArray uTex; uniform float uLayers; uniform float uLayer; uniform float uZoom;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * vec2(1600.0 / 900.0, 1.0);
        float side = step(1.0, p.x);
        vec2 uv = fract(p) / uZoom;
        if (p.x > 2.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec4 t = texture(uTex, vec3(uv, uLayer + side * uLayers));
        vec3 c = side < 0.5 ? t.rgb * 1.6 : t.rgb;
        if (side < 0.5 && vUv.y < 0.08) c = vec3(t.a);
        gl_FragColor = vec4(side < 0.5 ? pow(c, vec3(1.0 / 2.2)) : c, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  return {
    name: 'tile-preview',
    order: UpdateOrder.UI,
    init(ctx) {
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      quad.frustumCulled = false;
      quad.renderOrder = 1000;
      ctx.scene.add(quad);
      ctx.scene.background = new THREE.Color(0x000000);
    },
    update() {
      const t = (window as unknown as { __terrain?: { uniforms: Record<string, THREE.IUniform> } }).__terrain;
      const key = kind === 'carpets' ? 'uCarpets' : kind === 'nature' ? 'uNature' : 'uDetail';
      if (t) {
        uniforms.uTex.value = t.uniforms[key].value as THREE.Texture;
      }
    },
  };
}

function sceneSystems(): System[] {
  const systems: System[] = [createGeoSystem(), createSkySystem(), new TerrainSystem()];
  const water = params.get('water') ?? 'flat';
  if (water === 'placeholder' || water === 'real') {
    systems.push(createWaterSystem());
  } else if (water === 'flat') {
    systems.push(createFlatWater());
  }
  if (params.get('clouds') === '1') {
    systems.push(createCloudSystem());
  }
  systems.push(createSandboxCamera());
  return systems;
}

const tilesKind = params.get('tiles');
if (tilesKind) {
  void startSandbox({ systems: [createGeoSystem(), new TerrainSystem(), createTilePreview(tilesKind)] });
} else {
  void startSandbox({ pipeline: createRenderPipeline, systems: sceneSystems() });
}
