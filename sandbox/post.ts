/**
 * Post-processing sandbox: HDR test scene (emissive spheres 10-100, dark areas, thin cables/minarets, an HDR sky
 * with a sun disc) rendered through the real pipeline.
 *
 * URL params (plus the pipeline's own: ev, tm, aa, msaa, scale, dynres, bloom, flare, grain, sharpen, speed, postdebug):
 *   shot=overview|bloom|thin|flare|under|dragon   camera preset
 *   t=<hours>        sun position (default 15), night below the horizon
 *   anim=1           slow camera orbit (motion / temporal checks)
 *   dragonsvc=0      shot=dragon without the stand-in dragon/rig services (fallback 45 m speed-effect mask)
 *   world=1          use the world systems (geo, sky, terrain, water, dragon, flight, camera) instead of the test scene
 */
import * as THREE from 'three';
import { startSandbox } from '../src/core/sandbox';
import type { DragonRig, DragonState, System } from '../src/core/contracts';
import { RenderLayers, UpdateOrder } from '../src/core/contracts';
import { globalUniforms, registerGlobalUniform } from '../src/core/uniforms';
import { createRenderPipeline, type PostPipeline } from '../src/render/post';

const params = new URLSearchParams(location.search);
const hours = params.has('t') ? Number(params.get('t')) : 15;
const shot = params.get('shot') ?? 'overview';
const animate = params.get('anim') === '1';

interface Shot {
  pos: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

const SHOTS: Record<string, Shot> = {
  overview: { pos: [-60, 38, 150], target: [40, 22, -60] },
  bloom: { pos: [0, 6, 34], target: [0, 5, 0] },
  thin: { pos: [-420, 42, 380], target: [80, 40, -120], fov: 40 },
  flare: { pos: [0, 25, 120], target: [0, 45, -200] },
  under: { pos: [0, -5, 40], target: [0, -12, -20] },
  dragon: { pos: [0, 30, 60], target: [0, 26, 0] },
};

function sunDirectionForHours(h: number, out: THREE.Vector3): THREE.Vector3 {
  const dayPhase = (h - 6) / 12;
  const elevation = THREE.MathUtils.degToRad(52 * Math.sin(Math.PI * dayPhase));
  const azimuth = THREE.MathUtils.degToRad(90 + 180 * dayPhase);
  const c = Math.cos(elevation);
  return out.set(Math.sin(azimuth) * c, Math.sin(elevation), -Math.cos(azimuth) * c).normalize();
}

const SUN_DIR = sunDirectionForHours(hours, new THREE.Vector3());

function resolveShot(): Shot {
  const cfg: Shot = { ...(SHOTS[shot] ?? SHOTS.overview) };
  if (shot === 'flare') {
    const look = SUN_DIR.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(14));
    look.y -= 0.12;
    const p = new THREE.Vector3(...cfg.pos).addScaledVector(look.normalize(), 200);
    cfg.target = [p.x, p.y, p.z];
  }
  return cfg;
}
const SHOT = resolveShot();

function sunColorForElevation(y: number, out: THREE.Color): THREE.Color {
  if (y <= -0.02) {
    return out.setRGB(0, 0, 0);
  }
  const t = THREE.MathUtils.smoothstep(y, -0.02, 0.35);
  const warm = new THREE.Color(1.0, 0.42, 0.16);
  const white = new THREE.Color(1.0, 0.95, 0.88);
  return out.copy(warm).lerp(white, t).multiplyScalar(4.5 * THREE.MathUtils.smoothstep(y, -0.02, 0.08));
}

function makeNoiseTexture(size: number, base: [number, number, number], variance: number, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(size, size);
  let s = seed;
  const rand = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < size * size; i++) {
    const n = (rand() - 0.5) * variance;
    img.data[i * 4] = THREE.MathUtils.clamp(base[0] + n, 0, 255);
    img.data[i * 4 + 1] = THREE.MathUtils.clamp(base[1] + n, 0, 255);
    img.data[i * 4 + 2] = THREE.MathUtils.clamp(base[2] + n, 0, 255);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function makeWindowTexture(seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 128);
  let s = seed;
  const rand = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 8; x++) {
      if (rand() < 0.45) {
        const warm = rand();
        g.fillStyle = warm < 0.7 ? `rgb(255,${190 + Math.floor(rand() * 40)},${120 + Math.floor(rand() * 40)})` : 'rgb(200,220,255)';
        g.fillRect(x * 8 + 2, y * 8 + 2, 4, 5);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform float uNightAmt;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  float sunUp = clamp(uSun.y * 4.0 + 0.3, 0.0, 1.0);
  vec3 zenith = mix(vec3(0.0015, 0.0025, 0.006), vec3(0.18, 0.34, 0.8) * 1.6, sunUp);
  vec3 horizon = mix(vec3(0.004, 0.005, 0.009), vec3(0.75, 0.78, 0.85) * 1.8, sunUp);
  horizon = mix(horizon, vec3(1.6, 0.8, 0.4), (1.0 - smoothstep(0.0, 0.35, uSun.y)) * sunUp * 0.8);
  vec3 c = mix(horizon, zenith, pow(up, 0.45));
  float mu = max(dot(d, uSun), 0.0);
  c += uSunCol * (pow(mu, 12.0) * 0.12 + pow(mu, 400.0) * 0.6);
  float disc = smoothstep(0.99995, 0.99998, mu);
  c += uSunCol * disc * 6000.0;
  if (d.y < 0.0) c = horizon * 0.5;
  gl_FragColor = vec4(c, 1.0);
}`;

function createTestScene(): System {
  const group = new THREE.Group();
  const sunDir = new THREE.Vector3();
  const sunColor = new THREE.Color();
  const sunLight = new THREE.DirectionalLight(0xffffff, 1);
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6b5a45, 1);
  const orbitCenter = new THREE.Vector3();
  let orbitAngle = 0;
  let orbitRadius = 0;
  let orbitHeight = 0;

  return {
    name: 'post-test-scene',
    order: UpdateOrder.World,
    init(ctx) {
      const scene = ctx.scene;
      sunDir.copy(SUN_DIR);
      sunColorForElevation(sunDir.y, sunColor);
      const night = THREE.MathUtils.smoothstep(-sunDir.y, -0.02, 0.2);
      (globalUniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
      (globalUniforms.uSunColor.value as THREE.Color).copy(sunColor);
      globalUniforms.uNight.value = night;
      globalUniforms.uFogDensity.value = 0.00002;
      (globalUniforms.uFogColor.value as THREE.Color).setRGB(0.62, 0.68, 0.78).lerp(new THREE.Color(0.004, 0.005, 0.009), night);

      sunLight.color.copy(sunColor).multiplyScalar(1 / Math.max(0.001, Math.max(sunColor.r, sunColor.g, sunColor.b)));
      sunLight.intensity = Math.max(sunColor.r, sunColor.g, sunColor.b);
      sunLight.position.copy(sunDir).multiplyScalar(800);
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(2048, 2048);
      Object.assign(sunLight.shadow.camera, { left: -250, right: 250, top: 250, bottom: -250, near: 1, far: 2000 });
      sunLight.shadow.bias = -0.0005;
      hemi.intensity = THREE.MathUtils.lerp(0.9, 0.012, night);
      hemi.color.set(night > 0.5 ? 0x6078b0 : 0xbfd8ff);
      if (night > 0.5) {
        const moon = new THREE.DirectionalLight(0x9fb4ff, 0.06);
        moon.position.set(-300, 500, 200);
        group.add(moon);
      }
      group.add(sunLight, sunLight.target, hemi);

      const sky = new THREE.Mesh(
        new THREE.SphereGeometry(40000, 48, 24),
        new THREE.ShaderMaterial({
          vertexShader: SKY_VERT,
          fragmentShader: SKY_FRAG,
          side: THREE.BackSide,
          depthWrite: false,
          uniforms: { uSun: { value: sunDir }, uSunCol: { value: sunColor }, uNightAmt: { value: night } },
        }),
      );
      sky.renderOrder = -1;
      sky.frustumCulled = false;
      group.add(sky);

      const groundTex = makeNoiseTexture(256, [96, 94, 88], 40, 7);
      groundTex.repeat.set(400, 400);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.92 }));
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      group.add(ground);

      // Buildings with window emissive maps (lit at night).
      let seed = 11;
      const rand = (): number => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      const facade = makeNoiseTexture(64, [178, 168, 150], 30, 3);
      for (let i = 0; i < 46; i++) {
        const w = 14 + rand() * 20;
        const h = 12 + rand() * 50;
        const d = 14 + rand() * 20;
        const winTex = makeWindowTexture(100 + i);
        const mat = new THREE.MeshStandardMaterial({
          map: facade,
          color: new THREE.Color().setHSL(0.08 + rand() * 0.05, 0.2, 0.45 + rand() * 0.25),
          roughness: 0.85,
          emissive: new THREE.Color(1, 1, 1),
          emissiveMap: winTex,
          emissiveIntensity: night * (3 + rand() * 6),
        });
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        const ang = rand() * Math.PI * 2;
        const r = 90 + rand() * 260;
        const bx = Math.cos(ang) * r;
        const bz = Math.sin(ang) * r - 60;
        if (Math.abs(bx) < 70 && bz > -110) {
          continue;
        }
        b.position.set(bx, h / 2, bz);
        b.castShadow = b.receiveShadow = true;
        group.add(b);
      }

      // Emissive spheres: radiance 10, 30, 100 (+ a dark wall behind them).
      const wall = new THREE.Mesh(new THREE.BoxGeometry(40, 16, 1), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 }));
      wall.position.set(0, 8, -6);
      group.add(wall);
      [10, 30, 100].forEach((intensity, i) => {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.82, 0.6).multiplyScalar(intensity) }));
        s.position.set(-8 + i * 8, 5, 0);
        group.add(s);
        const lamp = new THREE.PointLight(0xffd8a8, intensity * 4, 30, 2);
        lamp.position.copy(s.position);
        group.add(lamp);
      });
      // Tiny bright points (fireflies test) and a thin neon tube.
      for (let i = 0; i < 12; i++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(20, 18, 14) }));
        p.position.set(-15 + i * 2.7, 11 + Math.sin(i) * 1.5, -5);
        p.layers.set(RenderLayers.NoReflection);
        group.add(p);
      }
      const neon = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 20, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 8, 12) }));
      neon.rotation.z = Math.PI / 2;
      neon.position.set(0, 14.5, -5.3);
      group.add(neon);

      // Suspension bridge: towers, main cables and thin hangers (sub-pixel at distance).
      const steel = new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.4, metalness: 0.8 });
      const concrete = new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.8 });
      const span = 320;
      const towerH = 90;
      const bridgeZ = -150;
      for (const x of [-span / 2, span / 2]) {
        for (const z of [-8, 8]) {
          const t = new THREE.Mesh(new THREE.BoxGeometry(4, towerH, 4), concrete);
          t.position.set(x + 80, towerH / 2, bridgeZ + z);
          t.castShadow = true;
          group.add(t);
        }
      }
      const deck = new THREE.Mesh(new THREE.BoxGeometry(span + 80, 2, 18), concrete);
      deck.position.set(80, 30, bridgeZ);
      deck.castShadow = true;
      group.add(deck);
      const cableGeo = new THREE.CylinderGeometry(0.35, 0.35, 1, 6);
      const hangerGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 4);
      const addSegment = (a: THREE.Vector3, b: THREE.Vector3, geo: THREE.BufferGeometry): void => {
        const m = new THREE.Mesh(geo, steel);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const dir = b.clone().sub(a);
        m.position.copy(mid);
        m.scale.set(1, dir.length(), 1);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        group.add(m);
      };
      for (const z of [-8, 8]) {
        let prev: THREE.Vector3 | null = null;
        for (let i = 0; i <= 40; i++) {
          const u = i / 40;
          const x = -span / 2 + u * span;
          const y = 32 + (towerH - 34) * Math.pow(2 * u - 1, 2);
          const p = new THREE.Vector3(x + 80, y, bridgeZ + z);
          if (prev) {
            addSegment(prev, p, cableGeo);
          }
          if (i > 0 && i < 40) {
            addSegment(p, new THREE.Vector3(x + 80, 31, bridgeZ + z), hangerGeo);
          }
          prev = p;
        }
      }

      // Minarets: slender shafts with balconies and pointed caps.
      const stone = new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.75 });
      const lead = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.5, metalness: 0.6 });
      for (let i = 0; i < 6; i++) {
        const m = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.6, 64, 12), stone);
        shaft.position.y = 32;
        const balcony = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.0, 1.2, 12), stone);
        balcony.position.y = 48;
        const cap = new THREE.Mesh(new THREE.ConeGeometry(1.4, 12, 12), lead);
        cap.position.y = 70;
        m.add(shaft, balcony, cap);
        m.traverse((o) => (o.castShadow = true));
        m.position.set(-320 + i * 55, 0, -420 - (i % 2) * 60);
        group.add(m);
      }

      // Near dark object standing in for the dragon (speed-effect depth mask test).
      if (shot === 'dragon') {
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 8, 6, 12), new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.6 }));
        body.rotation.x = Math.PI / 2;
        body.position.set(0, 26, 28);
        const wings = new THREE.Mesh(new THREE.BoxGeometry(22, 0.3, 4), body.material);
        wings.position.set(0, 26.5, 28);
        group.add(body, wings);
        // Near scenery at the frame edge (~18 m): must streak with the speed effect while the dragon stays sharp.
        const post = new THREE.Mesh(new THREE.BoxGeometry(2.5, 60, 2.5), new THREE.MeshStandardMaterial({ map: makeWindowTexture(7), color: 0xb0a590, roughness: 0.8 }));
        post.position.set(-14, 30, 42);
        group.add(post);
        // Minimal dragon/rig services so the speed effect masks the stand-in's bounding sphere (as in the game).
        if (params.get('dragonsvc') !== '0') {
          ctx.services.provide('dragon', { position: body.position.clone() } as unknown as DragonState);
          ctx.services.provide('rig', { dimensions: { length: 11, wingspan: 22, height: 3 } } as unknown as DragonRig);
        }
      }

      // Underwater: water surface + sea bed with rocks.
      if (shot === 'under') {
        const bed = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ map: makeNoiseTexture(128, [150, 140, 110], 60, 5), roughness: 1 }));
        bed.rotation.x = -Math.PI / 2;
        bed.position.y = -14;
        group.add(bed);
        for (let i = 0; i < 30; i++) {
          const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1 + rand() * 3, 1), new THREE.MeshStandardMaterial({ color: 0x6d665a, roughness: 1 }));
          rock.position.set((rand() - 0.5) * 120, -13, -rand() * 120);
          group.add(rock);
        }
        const surface = new THREE.Mesh(
          new THREE.PlaneGeometry(2000, 2000),
          new THREE.MeshStandardMaterial({ color: 0x2a6f78, roughness: 0.1, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
        );
        surface.rotation.x = -Math.PI / 2;
        surface.position.y = -0.01;
        group.add(surface);
      }

      // GPU load generator for dynamic-resolution tests: a transparent sheet with an expensive fragment loop.
      const heavy = Number(params.get('heavy') ?? 0);
      if (heavy > 0) {
        const burner = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          new THREE.ShaderMaterial({
            transparent: true,
            depthTest: false,
            depthWrite: false,
            uniforms: { uIter: { value: heavy } },
            vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
            fragmentShader: `uniform float uIter;
void main() {
  vec2 p = gl_FragCoord.xy * 0.001;
  float a = 0.0;
  for (int i = 0; i < 4096; i++) { if (float(i) >= uIter) break; a += sin(p.x * float(i) + a) * cos(p.y + a * 0.5); }
  gl_FragColor = vec4(vec3(0.0), clamp(a * 1e-6, 0.0, 0.001));
}`,
          }),
        );
        burner.frustumCulled = false;
        burner.renderOrder = 999;
        group.add(burner);
      }
      scene.add(group);

      const cfg = SHOT;
      const cam = ctx.camera;
      cam.fov = cfg.fov ?? 55;
      cam.near = 0.2;
      cam.far = 60000;
      cam.updateProjectionMatrix();
      cam.position.set(...cfg.pos);
      cam.lookAt(new THREE.Vector3(...cfg.target));
      orbitCenter.set(...cfg.target);
      const dx = cfg.pos[0] - cfg.target[0];
      const dz = cfg.pos[2] - cfg.target[2];
      orbitRadius = Math.hypot(dx, dz);
      orbitAngle = Math.atan2(dz, dx);
      orbitHeight = cfg.pos[1];
    },
    update(_dt, ctx) {
      if (!animate) {
        return;
      }
      orbitAngle += ctx.time.realDt * 0.05;
      ctx.camera.position.set(orbitCenter.x + Math.cos(orbitAngle) * orbitRadius, orbitHeight, orbitCenter.z + Math.sin(orbitAngle) * orbitRadius);
      ctx.camera.lookAt(orbitCenter);
    },
  };
}

async function worldSystems(): Promise<System[]> {
  const [geo, sky, terrain, water, clouds, dragon, flight, camera] = await Promise.all([
    import('../src/world/geo'),
    import('../src/render/sky'),
    import('../src/world/terrain'),
    import('../src/world/water'),
    import('../src/render/clouds'),
    import('../src/dragon/model'),
    import('../src/dragon/flight'),
    import('../src/camera'),
  ]);
  return [
    geo.createGeoSystem(),
    sky.createSkySystem(),
    terrain.createTerrainSystem(),
    water.createWaterSystem(),
    clouds.createCloudSystem(),
    dragon.createDragonModelSystem(),
    flight.createFlightSystem(),
    camera.createCameraSystem(),
  ];
}

/**
 * Without the sky/clouds systems the shared GLSL samplers (sky-view LUT, cloud shadow map) would stay unbound and
 * alias texture unit 0 with shadow samplers (GL "two textures of different types" warnings). Neutral 1x1 stand-ins;
 * with no uAtmoState the atmosphere falls back to its height fog.
 */
function registerNeutralSamplers(): void {
  const make = (v: number): THREE.DataTexture => {
    const t = new THREE.DataTexture(new Uint8Array([v, v, v, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.needsUpdate = true;
    return t;
  };
  registerGlobalUniform('uSkyViewLUT', { value: make(0) });
  registerGlobalUniform('uCloudShadowMap', { value: make(255) });
  registerGlobalUniform('uCloudShadowXform', { value: new THREE.Vector4(0, 0, 1 / 32000, 0) });
}

async function main(): Promise<void> {
  const world = params.get('world') === '1';
  if (!world) {
    registerNeutralSamplers();
  }
  const systems = world ? await worldSystems() : [createTestScene()];
  const engine = await startSandbox({
    pipeline: createRenderPipeline,
    systems,
    orbit: !world && !animate,
    orbitTarget: world ? undefined : new THREE.Vector3(...SHOT.target),
  });
  const pipeline = engine.ctx.pipeline as PostPipeline;
  (window as unknown as { __post: PostPipeline }).__post = pipeline;
}

void main();
