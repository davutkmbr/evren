/**
 * Vegetation sandbox.
 *   /sandbox/vegetation.html?mode=lineup&t=17         species line-up: LOD0 row, LOD1 row, impostor row (orbit camera)
 *   &species=0..5 &lod=0|1|2                          single species / single LOD
 *   &cx=..&cy=..&cz=..&tx=..&ty=..&tz=..             orbit camera position / target
 *   /sandbox/vegetation.html?mode=lod&species=3       one species repeated from 8 m to 420 m (LOD transitions)
 *   /sandbox/vegetation.html?mode=world&view=bogaz    real world (geo, sky, terrain, water, clouds, vegetation)
 *   &x=..&y=..&z=..&h=..&p=.. | &lat=..&lon=..&alt=..  explicit camera (heading/pitch degrees)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { startSandbox } from '../src/core/sandbox';
import { LandUse, RenderLayers, UpdateOrder, type EngineContext, type GeoQuery, type System } from '../src/core/contracts';
import { VIEW_PRESETS } from '../src/core/debug';
import { headingToYaw, latLonToLocal } from '../src/core/geo-coords';
import { patchMaterial } from '../src/core/uniforms';
import { createRenderPipeline } from '../src/render/post';
import { createSkySystem } from '../src/render/sky';
import { createCloudSystem } from '../src/render/clouds';
import { createGeoSystem } from '../src/world/geo';
import { createTerrainSystem } from '../src/world/terrain';
import { createWaterSystem } from '../src/world/water';
import { VegetationSystem } from '../src/world/vegetation';
import { createVegetationAssets, type VegetationAssets } from '../src/world/vegetation/assets';
import { lodConfigFor } from '../src/world/vegetation/config';
import { createPoolGeometry, InstanceStream } from '../src/world/vegetation/render/tree-geometry';
import { INSTANCE_STRIDE, SPECIES_COUNT } from '../src/world/vegetation/species';

const params = new URLSearchParams(window.location.search);
const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);
const mode = params.get('mode') ?? 'lineup';

function groundSystem(y = 0): System {
  return {
    name: 'ground',
    order: UpdateOrder.World,
    init(ctx) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
      patchMaterial(mat, 'veg-sandbox-ground', (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          /* glsl */ `
          {
            vec2 gp = vFogWorldPos.xz;
            float n = fbm2(gp / 7.0, 4);
            float m = fbm2(gp / 55.0, 3);
            vec3 grass = mix(vec3(0.05, 0.075, 0.028), vec3(0.11, 0.1, 0.05), smoothstep(0.35, 0.7, m));
            vec3 soil = vec3(0.09, 0.07, 0.05);
            diffuseColor.rgb = mix(soil, grass, smoothstep(0.3, 0.55, n)) * (0.85 + 0.3 * vnoise2(gp * 1.7));
          }
          `,
        );
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2), mat);
      mesh.position.y = y;
      mesh.receiveShadow = true;
      ctx.scene.add(mesh);
    },
  };
}

interface Placement {
  x: number;
  z: number;
  species: number;
  variant: number;
  scale: number;
  yaw: number;
  lod: number;
}

function writeInstances(stream: InstanceStream, list: Placement[]): void {
  stream.reserve(list.length);
  const a = stream.array;
  list.forEach((p, i) => {
    const o = i * INSTANCE_STRIDE;
    a[o] = p.x;
    a[o + 1] = 0;
    a[o + 2] = p.z;
    a[o + 3] = p.yaw;
    a[o + 4] = p.scale;
    a[o + 5] = p.species + 8 * p.variant;
    a[o + 6] = ((i * 0.618034) % 1) * 0.999;
    a[o + 7] = 1;
  });
  stream.markRange(0, list.length);
}

/** Static showcase: every species / LOD drawn with the real materials, no streaming. */
function showcaseSystem(build: (assets: VegetationAssets) => Placement[]): System {
  let assets: VegetationAssets | null = null;
  return {
    name: 'vegetation-showcase',
    order: UpdateOrder.World,
    async init(ctx) {
      const cfg = lodConfigFor(ctx.quality.settings);
      assets = await createVegetationAssets(ctx.renderer, cfg);
      const a = assets;
      const list = build(a);
      const noFade = mode === 'lineup';
      if (noFade) {
        a.trees.fade0.set(-1, 0, 1e9, 1e9);
        a.trees.fade1.set(-1, 0, 1e9, 1e9);
        a.impostors.fadeNear.set(-1, 0, 1e9, 1e9);
      } else {
        a.trees.fade0.set(-1, 0, cfg.lod0 - cfg.lod0Fade, cfg.lod0 + cfg.lod0Fade);
        a.trees.fade1.set(cfg.lod0 - cfg.lod0Fade, cfg.lod0 + cfg.lod0Fade, cfg.lod1 - cfg.lod1Fade, cfg.lod1 + cfg.lod1Fade);
        a.impostors.fadeNear.set(cfg.lod1 - cfg.lod1Fade, cfg.lod1 + cfg.lod1Fade, 1e9, 1e9);
      }
      a.impostors.fadeDepth.set(-1, 0, 1e9, 1e9);
      const sphere = new THREE.Sphere(new THREE.Vector3(), 5000);
      for (let s = 0; s < SPECIES_COUNT; s++) {
        for (let lod = 0; lod < 3; lod++) {
          const mine = list.filter((p) => p.species === s && (noFade ? p.lod === lod : true));
          if (mine.length === 0) {
            continue;
          }
          const stream = new InstanceStream(mine.length);
          writeInstances(stream, mine);
          if (lod < 2) {
            const g = createPoolGeometry(lod === 0 ? a.lod0[s] : a.lod1[s], stream);
            g.instanceCount = mine.length;
            g.boundingSphere = sphere;
            const mesh = new THREE.Mesh(g, lod === 0 ? a.trees.lod0 : a.trees.lod1);
            mesh.customDepthMaterial = a.trees.depth;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.layers.set(RenderLayers.NoReflection);
            ctx.scene.add(mesh);
          } else {
            const g = createPoolGeometry(a.quad, stream);
            g.instanceCount = mine.length;
            g.boundingSphere = sphere;
            const mesh = new THREE.Mesh(g, a.impostors.near);
            mesh.customDepthMaterial = a.impostors.depth;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.layers.set(RenderLayers.NoReflection);
            ctx.scene.add(mesh);
          }
        }
      }
      const tris = a.species.map((s, i) => `${i}: lod0 ${s.triangles[0]} lod1 ${s.triangles[1]} h ${s.height.toFixed(1)} r ${s.radius.toFixed(1)}`);
      console.info(`[veg-sandbox] generated in ${a.generationMs.toFixed(0)} ms\n${tris.join('\n')}`);
      (window as unknown as Record<string, unknown>).__veg = a;
    },
  };
}

function lineup(): Placement[] {
  const only = params.has('species') ? num('species', 0) : -1;
  const onlyLod = params.has('lod') ? num('lod', 0) : -1;
  const out: Placement[] = [];
  const spacing = num('spacing', 24);
  let col = 0;
  for (let s = 0; s < SPECIES_COUNT; s++) {
    if (only >= 0 && s !== only) {
      continue;
    }
    const variants = s === 1 || s === 4 ? 2 : 1;
    for (let v = 0; v < variants; v++) {
      for (let lod = 0; lod < 3; lod++) {
        if (onlyLod >= 0 && lod !== onlyLod) {
          continue;
        }
        out.push({ x: col * spacing, z: lod * 34, species: s, variant: v, scale: 1, yaw: col * 1.3, lod });
      }
      col++;
    }
  }
  return out;
}

function lodRow(): Placement[] {
  const s = num('species', 3);
  const out: Placement[] = [];
  for (let d = 10, i = 0; d < 460; d += 18, i++) {
    out.push({ x: (i % 2 === 0 ? -1 : 1) * 9, z: -d, species: s, variant: i % 2, scale: 1, yaw: i * 2.1, lod: 0 });
  }
  return out;
}

function orbitCamera(target: THREE.Vector3, position: THREE.Vector3): System {
  let controls: OrbitControls | null = null;
  return {
    name: 'orbit',
    order: UpdateOrder.Camera,
    init(ctx) {
      ctx.camera.position.set(num('cx', position.x), num('cy', position.y), num('cz', position.z));
      ctx.camera.near = 0.3;
      ctx.camera.updateProjectionMatrix();
      controls = new OrbitControls(ctx.camera, ctx.canvas);
      controls.target.set(num('tx', target.x), num('ty', target.y), num('tz', target.z));
      controls.update();
    },
    update() {
      controls?.update();
    },
  };
}

interface CamPose {
  x: number;
  y: number;
  z: number;
  h: number;
  p: number;
}

function worldCamera(): System {
  const preset = VIEW_PRESETS[params.get('view') ?? 'bogaz'] ?? VIEW_PRESETS.bogaz;
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
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  let agl = params.has('agl') ? num('agl', 50) : NaN;
  const apply = (ctx: EngineContext): void => {
    const cam = ctx.camera;
    if (!Number.isNaN(agl)) {
      const geo = ctx.services.tryGet('geo');
      if (geo) {
        pose.y = Math.max(geo.heightAt(pose.x, pose.z), 0) + agl;
        agl = NaN;
      }
    }
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

/** Texture array preview: &src=tex|imp &layer=N (albedo left, packed normal/AO/translucency right). */
function texturePreview(): System {
  const uniforms = { uTex: { value: null as THREE.Texture | null }, uTex2: { value: null as THREE.Texture | null }, uLayer: { value: num('layer', 0) } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }',
    fragmentShader: `
      precision highp sampler2DArray;
      uniform sampler2DArray uTex; uniform sampler2DArray uTex2; uniform float uLayer;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * vec2(1600.0 / 900.0, 1.0);
        if (p.x > 2.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec2 uv = fract(p);
        vec4 t = p.x < 1.0 ? texture(uTex, vec3(uv, uLayer)) : texture(uTex2, vec3(uv, uLayer));
        vec3 bg = mod(floor(uv.x * 32.0) + floor(uv.y * 32.0), 2.0) < 1.0 ? vec3(0.8) : vec3(0.6);
        vec3 c = p.x < 1.0 ? mix(bg, pow(t.rgb * 2.0, vec3(1.0 / 2.2)), t.a) : t.rgb;
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  return {
    name: 'tex-preview',
    order: UpdateOrder.UI,
    async init(ctx) {
      const assets = await createVegetationAssets(ctx.renderer, lodConfigFor(ctx.quality.settings));
      const imp = params.get('src') === 'imp';
      uniforms.uTex.value = imp ? assets.atlas.albedo : assets.textures.albedo;
      uniforms.uTex2.value = imp ? assets.atlas.normal : assets.textures.normal;
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      quad.frustumCulled = false;
      ctx.scene.add(quad);
      ctx.scene.background = new THREE.Color(0x000000);
    },
  };
}

/** Top-down placement map: land use + trees (colour = species) around a view (&size=m, &px=pixels). */
function placementMap(): System {
  return {
    name: 'placement-map',
    order: UpdateOrder.UI,
    async init(ctx) {
      const geo = await ctx.services.when('geo');
      const { buildPlacementInit, GeoWindowCutter } = await import('../src/world/vegetation/stream/geo-window');
      const { PlacementContext } = await import('../src/world/vegetation/stream/placement');
      const { SPECIES_SHAPES } = await import('../src/world/vegetation/species');
      const preset = VIEW_PRESETS[params.get('view') ?? 'rumelihisari'] ?? VIEW_PRESETS.rumelihisari;
      let cx = num('x', preset.x);
      let cz = num('z', preset.z);
      if (params.has('lat') && params.has('lon')) {
        const l = latLonToLocal(num('lat', 41), num('lon', 29));
        cx = l.x;
        cz = l.z;
      }
      const size = num('size', 2048);
      const px = num('px', 900);
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = px;
      canvas.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:900px;z-index:10;image-rendering:pixelated';
      document.body.appendChild(canvas);
      const g = canvas.getContext('2d')!;
      const colors: Record<number, string> = {
        0: '#1d3b5a', 1: '#c8b88a', 2: '#7a7a7a', 3: '#8a7a8a', 4: '#a09090', 5: '#6a6060', 6: '#6f8f4f', 7: '#2f5a2a',
        8: '#b0a060', 9: '#909090', 10: '#5a6a5a', 11: '#a07060', 12: '#505050', 13: '#9a9a80',
      };
      const scale = px / size;
      for (let y = 0; y < px; y += 2) {
        for (let x = 0; x < px; x += 2) {
          const wx = cx - size / 2 + x / scale;
          const wz = cz - size / 2 + y / scale;
          g.fillStyle = colors[geo.landUseAt(wx, wz)] ?? '#ff00ff';
          g.fillRect(x, y, 2, 2);
        }
      }
      const init = buildPlacementInit(geo, SPECIES_SHAPES.map((s) => ({ height: s.height, centerY: 0, radius: 0, impostorRadius: 0, triangles: [0, 0] as [number, number] })), SPECIES_SHAPES.map((s) => s.crownWidth / 2));
      const pc = new PlacementContext(init);
      const cutter = new GeoWindowCutter(geo);
      const T = 256;
      const spColor = ['#e8d040', '#20c0ff', '#101010', '#ff60a0', '#40ff40', '#ff8000'];
      let total = 0;
      const perSpecies = [0, 0, 0, 0, 0, 0];
      for (let tz = Math.floor((cz - size / 2) / T); tz <= Math.floor((cz + size / 2) / T); tz++) {
        for (let tx = Math.floor((cx - size / 2) / T); tx <= Math.floor((cx + size / 2) / T); tx++) {
          const res = pc.placeTile(cutter.request(0, tx * T, tz * T, T, num('density', 1)));
          for (let i = 0; i < res.count; i++) {
            const o = i * 8;
            const sp = res.instances[o + 5] % 8;
            const r = (SPECIES_SHAPES[sp].crownWidth / 2) * res.instances[o + 4] * res.instances[o + 7] * scale;
            g.fillStyle = spColor[sp];
            g.globalAlpha = 0.55;
            g.beginPath();
            g.arc((res.instances[o] - cx + size / 2) * scale, (res.instances[o + 2] - cz + size / 2) * scale, Math.max(r, 0.8), 0, Math.PI * 2);
            g.fill();
            total++;
            perSpecies[sp]++;
          }
        }
      }
      g.globalAlpha = 1;
      g.fillStyle = '#fff';
      g.font = '14px monospace';
      g.fillText(`trees ${total}  per species ${perSpecies.join(' / ')}  (${size} m)`, 8, 18);
      console.info(`[veg-map] trees ${total} per species ${perSpecies.join('/')}`);
    },
  };
}

/**
 * Flat synthetic world for the real streaming system (independent of geo/terrain): forest disc (r 700 m) with a park
 * clearing, a cemetery patch and farmland around, ground at y = 2.
 */
function fakeGeoSystem(): System {
  return {
    name: 'fake-geo',
    order: UpdateOrder.World,
    init(ctx) {
      const n = 1024;
      const cell = 48000 / n;
      const origin = -24000 + cell / 2;
      const lu = new Uint8Array(n * n);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const x = origin + c * cell;
          const z = origin + r * cell;
          const d = Math.hypot(x, z);
          let use: number = LandUse.Farmland;
          if (d < 700) {
            use = LandUse.Forest;
          }
          if (Math.hypot(x - 250, z + 150) < 140) {
            use = LandUse.Park;
          }
          if (Math.hypot(x + 300, z - 250) < 110) {
            use = LandUse.Cemetery;
          }
          if (d > 700 && d < 1100 && x > 0) {
            use = LandUse.Suburban;
          }
          lu[r * n + c] = use;
        }
      }
      const hn = 256;
      const hcell = 48000 / hn;
      const height = new Float32Array(hn * hn).fill(2);
      const coastTex = new THREE.DataTexture(new Float32Array(hn * hn).fill(5000), hn, hn, THREE.RedFormat, THREE.FloatType);
      const geo = {
        bounds: { minX: -24000, maxX: 24000, minZ: -24000, maxZ: 24000 },
        heightAt: () => 2,
        normalAt: (_x: number, _z: number, out: THREE.Vector3) => out.set(0, 1, 0),
        isWater: () => false,
        coastDistance: () => 5000,
        landUseAt: (x: number, z: number) => lu[Math.min(n - 1, Math.max(0, Math.round((z - origin) / cell))) * n + Math.min(n - 1, Math.max(0, Math.round((x - origin) / cell)))] as LandUse,
        densityAt: () => 0,
        districtAt: () => null,
        buildableAt: () => false,
        landmarks: [],
        landmark: () => undefined,
        roads: [],
        smallMosqueSites: [],
        coastlines: [],
        districts: [],
        heightGrid: { data: height, width: hn, height: hn, cellSize: hcell, originX: -24000 + hcell / 2, originZ: -24000 + hcell / 2 },
        landUseGrid: { data: lu, width: n, height: n, cellSize: cell, originX: origin, originZ: origin },
        getHeightTexture: () => coastTex,
        getLandUseTexture: () => coastTex,
        getCoastDistanceTexture: () => coastTex,
      } as unknown as GeoQuery;
      ctx.services.provide('geo', geo);
    },
  };
}

if (mode === 'forest') {
  const vegetation = new VegetationSystem();
  (window as unknown as Record<string, unknown>).__vegSystem = vegetation;
  void startSandbox({
    pipeline: createRenderPipeline,
    systems: [fakeGeoSystem(), createSkySystem(), groundSystem(2), vegetation, orbitCamera(new THREE.Vector3(0, 10, 0), new THREE.Vector3(-260, 70, 260))],
  });
} else if (mode === 'map') {
  void startSandbox({ systems: [createGeoSystem(), placementMap()] });
} else if (mode === 'tex') {
  void startSandbox({ systems: [texturePreview()] });
} else if (mode === 'world') {
  const vegetation = new VegetationSystem();
  (window as unknown as Record<string, unknown>).__vegSystem = vegetation;
  const systems: System[] = [createGeoSystem(), createSkySystem(), createTerrainSystem(), createWaterSystem(), vegetation];
  if (params.get('clouds') !== '0') {
    systems.push(createCloudSystem());
  }
  systems.push(worldCamera());
  void startSandbox({ pipeline: createRenderPipeline, systems });
} else if (mode === 'lod') {
  void startSandbox({
    pipeline: createRenderPipeline,
    systems: [createSkySystem(), groundSystem(), showcaseSystem(lodRow), orbitCamera(new THREE.Vector3(0, 6, -60), new THREE.Vector3(0, 7, 4))],
  });
} else {
  void startSandbox({
    pipeline: createRenderPipeline,
    systems: [createSkySystem(), groundSystem(), showcaseSystem(lineup), orbitCamera(new THREE.Vector3(80, 9, 30), new THREE.Vector3(80, 22, -95))],
  });
}
