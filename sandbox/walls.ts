/**
 * City-wall kit sandbox (not the game): a lineup of kit pieces on a real stretch of the Marmara shore (geo, sky,
 * terrain, water; no city), so the stone, weathering and the sea foundation are judged in the game's own light.
 *   /sandbox/walls.html?shot=overview&t=15        named camera (overview, air300, eye-tower, eye-pentagon, gate, corner,
 *                                                 ruin, sea, closeup, lod)
 *   &lod=0|1|2                                    force one LOD (default: by distance, 250 m / 900 m)
 *   &lat=..&lon=..                                anchor (default: the straight Ahırkapı-Sarayburnu shore)
 * window.__kit: { shot(name), stats() }.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { startSandbox } from '../src/core/sandbox';
import { UpdateOrder, type EngineContext, type GeoQuery, type System } from '../src/core/contracts';
import { latLonToLocal } from '../src/core/geo-coords';
import { createRenderPipeline } from '../src/render/post';
import { createGeoSystem } from '../src/world/geo';
import { createSkySystem } from '../src/render/sky';
import { createTerrainSystem } from '../src/world/terrain';
import { createWaterSystem } from '../src/world/water';
import { MeshBuilder, type MeshData } from '../src/world/landmarks/heritage/build/mesh-builder';
import type { V2 } from '../src/world/landmarks/heritage/build/geom';
import { curtain, gate, seaFoundation, tower, type CurtainParams, type KitCollider, type KitOut, type TowerParams } from '../src/world/landmarks/walls/kit/kit';
import { createWallsMaterial } from '../src/world/landmarks/walls/render/material';

const params = new URLSearchParams(window.location.search);
const num = (k: string, d: number): number => (params.has(k) && params.get(k) !== '' ? Number(params.get(k)) : d);

function toGeometry(d: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2));
  g.setAttribute('aHCol', new THREE.BufferAttribute(d.colors, 4, true));
  g.setAttribute('aHSurf', new THREE.BufferAttribute(d.surf, 4, false));
  g.setIndex(new THREE.BufferAttribute(d.index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

interface Layout {
  /** Local frame: origin, wall direction d (outer = sea side on the right), outward n. */
  ox: number;
  oz: number;
  d: V2;
  n: V2;
  at(u: number, v: number): V2;
}

/**
 * Frame on the shore: the wall runs along the coast at a constant distance inland (v = 0 is 32 m from the water, the
 * sea on the outer side), so every piece stands on land whatever the shape of the shore.
 */
function shoreLayout(geo: GeoQuery): Layout {
  const a = latLonToLocal(num('lat', 41.0105), num('lon', 28.986));
  const grad = (x: number, z: number): V2 => {
    const e = 20;
    const gx = geo.coastDistance(x + e, z) - geo.coastDistance(x - e, z);
    const gz = geo.coastDistance(x, z + e) - geo.coastDistance(x, z - e);
    const l = Math.hypot(gx, gz) || 1;
    return [gx / l, gz / l];
  };
  // Mean shore direction over +-250 m.
  let gx = 0;
  let gz = 0;
  for (let k = -5; k <= 5; k++) {
    for (let j = -5; j <= 5; j++) {
      const g = grad(a.x + k * 50, a.z + j * 50);
      gx += g[0];
      gz += g[1];
    }
  }
  const gl = Math.hypot(gx, gz) || 1;
  const n: V2 = [-gx / gl, -gz / gl];
  const d: V2 = [n[1], -n[0]];
  // Inland shift along -n per 10 m of u so that v = 0 sits 32 m from the water.
  const shift = new Map<number, number>();
  const shiftAt = (u: number): number => {
    const k = Math.round(u / 10);
    let v = shift.get(k);
    if (v === undefined) {
      v = 0;
      for (let it = 0; it < 30; it++) {
        const x = a.x + d[0] * k * 10 + n[0] * v;
        const z = a.z + d[1] * k * 10 + n[1] * v;
        v += (geo.coastDistance(x, z) - 32) * 0.5;
      }
      shift.set(k, v);
    }
    return v;
  };
  const smooth = (u: number): number => {
    const k0 = Math.floor(u / 10);
    const t = u / 10 - k0;
    return shiftAt(k0 * 10) * (1 - t) + shiftAt((k0 + 1) * 10) * t;
  };
  return { ox: a.x, oz: a.z, d, n, at: (u, v) => [a.x + d[0] * u + n[0] * (v + smooth(u)), a.z + d[1] * u + n[1] * (v + smooth(u))] };
}

const SEA_WALL: CurtainParams = { height: 12, thickness: 4, parapet: 1.1, merlonsKept: 0.35, batter: 0.6, style: 'byzantine', weather: 0.75 };
const SQUARE: Omit<TowerParams, 'wallThickness'> = { plan: 'square', width: 10.5, projection: 5, height: 16, storeys: 3, style: 'byzantine', weather: 0.8 };

interface Piece {
  name: string;
  build(o: KitOut, L: Layout, ground: (x: number, z: number) => number): void;
}

/** The lineup, left to right along the shore (u in metres). */
const PIECES: Piece[] = [
  {
    name: 'curtain-square-tower',
    build(o, L, gr) {
      curtain(o, [L.at(-160, 0), L.at(-110, 0)], gr, { ...SEA_WALL, seed: 11, endA: 'sloped' });
      tower(o, L.at(-110, 0), L.d, gr, { ...SQUARE, wallThickness: 4, ruin: 0.18, inscription: 0.62, seed: 12 });
      curtain(o, [L.at(-110, 0), L.at(-62, 0)], gr, { ...SEA_WALL, seed: 13 });
    },
  },
  {
    name: 'pentagon-tower',
    build(o, L, gr) {
      tower(o, L.at(-62, 0), L.d, gr, { ...SQUARE, plan: 'pentagon', width: 11, projection: 4, height: 17, wallThickness: 4, ruin: 0.12, seed: 21 });
    },
  },
  {
    name: 'gate',
    build(o, L, gr) {
      gate(o, L.at(-62, 0), L.at(-10, 0), gr, { width: 4.2, spring: 4.4, wall: { ...SEA_WALL, seed: 31 }, towers: { ...SQUARE, width: 8.5, projection: 4.5, height: 15.5, seed: 32 }, doors: false });
    },
  },
  {
    name: 'corner-hexagon',
    build(o, L, gr) {
      // The wall turns ~20 degrees inland at u = 30 and ends at a hexagonal tower.
      const e = L.at(72, -16);
      const c = L.at(30, 0);
      const dl = Math.hypot(e[0] - c[0], e[1] - c[1]);
      curtain(o, [L.at(-10, 0), c, e], gr, { ...SEA_WALL, seed: 41 });
      tower(o, e, [(e[0] - c[0]) / dl, (e[1] - c[1]) / dl], gr, { ...SQUARE, plan: 'hexagon', width: 10, projection: 4, height: 16.5, wallThickness: 4, ruin: 0.22, seed: 42 });
    },
  },
  {
    name: 'ruin',
    build(o, L, gr) {
      // Broken stretch after a breach: lowered, ragged top with grass, a ruined tower, crumbled end, fallen blocks.
      curtain(o, [L.at(95, 0), L.at(128, 0)], gr, { ...SEA_WALL, ruin: 0.55, endA: 'crumbled', seed: 51 });
      tower(o, L.at(128, 0), L.d, gr, { ...SQUARE, height: 14, ruin: 0.45, wallThickness: 4, seed: 52 });
      curtain(o, [L.at(128, 0), L.at(185, 0)], gr, { ...SEA_WALL, ruin: 0.85, endB: 'crumbled', seed: 53 });
    },
  },
  {
    name: 'sea-wall',
    build(o, L, gr) {
      // A stretch standing at the water: stepped block plinth and riprap in front, octagonal tower.
      const v = 26;
      const a = L.at(-170, v);
      const b = L.at(-230, v);
      const pts: V2[] = [b, a];
      const seaGround = (x: number, z: number): number => Math.max(gr(x, z), 1.5);
      curtain(o, pts, seaGround, { ...SEA_WALL, height: 11, batter: 0.3, seed: 61, endA: 'crumbled', endB: 'sloped' });
      seaFoundation(o, pts, { offset: 2.3, steps: 3, seed: 62 });
      tower(o, L.at(-200, v), L.d, seaGround, { ...SQUARE, plan: 'octagon', width: 9, projection: 3.5, height: 15, wallThickness: 4, ruin: 0.15, seed: 63 });
    },
  },
];

/** Shared between the kit system and the camera. */
const state: { layout: Layout | null; stats: { triangles: number[]; foliage: number[]; colliders: number; pieces: number } } = {
  layout: null,
  stats: { triangles: [0, 0, 0], foliage: [0, 0, 0], colliders: 0, pieces: PIECES.length },
};

function createKitSystem(): System {
  const root = new THREE.Group();
  const levels: { lods: THREE.Mesh[]; box: THREE.Box3; level: number }[] = [];
  const forced = params.has('lod') ? num('lod', 0) : -1;
  const stats = state.stats;
  return {
    name: 'wall-kit',
    order: UpdateOrder.World,
    async init(ctx: EngineContext) {
      ctx.scene.add(root);
      const geo = await ctx.services.when('geo');
      const mat = createWallsMaterial(ctx.renderer);
      await mat.ready;
      const layout = shoreLayout(geo);
      state.layout = layout;
      const ground = (x: number, z: number): number => Math.max(geo.heightAt(x, z), 0.1);
      const colliders: KitCollider[] = [];
      for (const piece of PIECES) {
        const lods: THREE.Mesh[] = [];
        for (let lod = 0; lod < 3; lod++) {
          const mb = new MeshBuilder(layout.ox, layout.oz);
          const fb = new MeshBuilder(layout.ox, layout.oz);
          piece.build({ mb, lod, colliders: lod === 0 ? colliders : undefined, foliage: fb }, layout, ground);
          const d = mb.finalize((x, z) => geo.heightAt(x, z));
          stats.triangles[lod] += d.triangleCount;
          const mesh = new THREE.Mesh(toGeometry(d), mat.material);
          if (!fb.isEmpty()) {
            // Vegetation cards: alpha-tested, leaf-shaped shadows through the foliage depth material.
            const fd = fb.finalize((x, z) => geo.heightAt(x, z));
            stats.foliage[lod] += fd.triangleCount;
            const leaves = new THREE.Mesh(toGeometry(fd), mat.material);
            leaves.receiveShadow = true;
            leaves.castShadow = true;
            leaves.customDepthMaterial = mat.foliageDepth;
            mesh.add(leaves);
          }
          mesh.name = `kit:${piece.name}:lod${lod}`;
          mesh.position.set(layout.ox, 0, layout.oz);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.visible = false;
          root.add(mesh);
          lods.push(mesh);
        }
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(lods[0]);
        levels.push({ lods, box, level: -1 });
      }
      stats.colliders = colliders.length;
      if (params.get('colliders') === '1') {
        for (const c of colliders) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(c.hx * 2, c.hy * 2, c.hz * 2), new THREE.MeshBasicMaterial({ color: 0xbb55ff, wireframe: true }));
          m.position.set(c.cx, c.cy, c.cz);
          m.rotation.y = c.yaw;
          root.add(m);
        }
      }
      (window as unknown as { __kitReady: boolean }).__kitReady = true;
    },
    update(_dt, ctx) {
      const cam = ctx.camera.position;
      for (const l of levels) {
        const dist = l.box.distanceToPoint(cam);
        const lvl = forced >= 0 ? forced : dist > 900 ? 2 : dist > 250 ? 1 : 0;
        if (lvl !== l.level) {
          l.lods.forEach((m, i) => (m.visible = i === lvl));
          l.level = lvl;
        }
      }
    },
    pending() {
      return (window as unknown as { __kitReady?: boolean }).__kitReady ? 0 : 1;
    },
  };
}

/** Named cameras in the layout frame: [u, v (outward), height above ground, look-at u, look-at v, look-at height, fov]. */
const SHOTS: Record<string, [number, number, number, number, number, number, number]> = {
  overview: [-40, 150, 70, -40, 0, 6, 55],
  air300: [-60, 330, 300, -60, 0, 0, 50],
  'eye-tower': [-128, 26, 1.7, -110, 2, 9, 60],
  'eye-pentagon': [-45, 24, 1.7, -62, 3, 9, 60],
  gate: [-36, 20, 1.7, -36, 0, 5, 62],
  corner: [40, 28, 1.7, 52, -6, 7, 62],
  ruin: [150, 26, 1.7, 135, 0, 4, 62],
  sea: [-178, 60, 3, -200, 22, 6, 55],
  closeup: [-86, 6.5, 1.7, -86, 2, 3.5, 60],
  lod: [-40, 700, 180, -40, 0, 0, 40],
};

function createKitCamera(): System {
  let controls: OrbitControls | null = null;
  let ctxRef: EngineContext | null = null;
  const shot = (name: string): boolean => {
    const s = SHOTS[name];
    const ctx = ctxRef;
    const geo = ctx?.services.tryGet('geo');
    const L = state.layout;
    if (!s || !ctx || !geo || !L) {
      return false;
    }
    const [u, v, h, tu, tv, th, fov] = s;
    const [x, z] = L.at(u, v);
    const [tx, tz] = L.at(tu, tv);
    const y = Math.max(0.3, geo.heightAt(x, z)) + h;
    const ty = Math.max(0, geo.heightAt(tx, tz)) + th;
    const cam = ctx.camera;
    cam.fov = fov;
    cam.near = 0.3;
    cam.far = 60000;
    cam.updateProjectionMatrix();
    cam.position.set(x, y, z);
    cam.lookAt(tx, ty, tz);
    controls?.target.set(tx, ty, tz);
    controls?.update();
    return true;
  };
  return {
    name: 'kit-camera',
    order: UpdateOrder.Camera,
    async init(ctx: EngineContext) {
      ctxRef = ctx;
      await ctx.services.when('geo');
      controls = new OrbitControls(ctx.camera, ctx.canvas);
      controls.enableDamping = false;
      const wait = (): void => {
        if ((window as unknown as { __kitReady?: boolean }).__kitReady) {
          shot(params.get('shot') ?? 'overview');
        } else {
          setTimeout(wait, 100);
        }
      };
      wait();
      (window as unknown as Record<string, unknown>).__kit = { shot, stats: () => state.stats };
    },
    update() {
      controls?.update();
    },
  };
}

const systems: System[] = [createGeoSystem(), createSkySystem(), createTerrainSystem()];
if (params.get('water') !== '0') {
  systems.push(createWaterSystem());
}
systems.push(createKitSystem(), createKitCamera());
void startSandbox({ pipeline: createRenderPipeline, systems });
