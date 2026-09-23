/**
 * Prototype: real OpenStreetMap streets and building footprints for Galata / Karaköy / Tophane / Cihangir with CC0
 * PBR materials. Only active with `?osm=1`; the city and vegetation systems then skip procedural buildings and urban
 * trees inside the area. Geometry is built in a worker (worker/osm.worker.ts).
 * Data © OpenStreetMap contributors (ODbL), fetched by scripts/data/fetch-osm.mjs.
 */
import * as THREE from 'three';
import type { CollisionWorld } from '../../core/collision';
import type { EngineContext, GeoQuery, GridData, System } from '../../core/contracts';
import { RenderLayers, UpdateOrder } from '../../core/contracts';
import { OSM_DATA_URL, osmEnabled, osmExclusionRect, type OsmData } from './area';
import { createOsmMaterials, type OsmMaterials } from './materials';
import { chimneyGeometry, dishGeometry, lampArmGeometry, lampLanternGeometry, solarGeometry, tankGeometry, treeGeometry } from './props';
import { COLLIDER_STRIDE, INSTANCE_STRIDE, type GridWin, type MeshArrays, type OsmBuildRequest, type OsmBuildResult } from './protocol';

function cutGrid<T extends Float32Array | Uint8Array>(grid: GridData<T>, data: T, rect: { minX: number; maxX: number; minZ: number; maxZ: number }, margin: number): GridWin<T> {
  const cell = grid.cellSize;
  const c0 = Math.max(0, Math.floor((rect.minX - margin - grid.originX) / cell));
  const c1 = Math.min(grid.width - 1, Math.ceil((rect.maxX + margin - grid.originX) / cell));
  const r0 = Math.max(0, Math.floor((rect.minZ - margin - grid.originZ) / cell));
  const r1 = Math.min(grid.height - 1, Math.ceil((rect.maxZ + margin - grid.originZ) / cell));
  const w = c1 - c0 + 1;
  const h = r1 - r0 + 1;
  const Ctor = data.constructor as { new (n: number): T };
  const out = new Ctor(w * h);
  for (let r = 0; r < h; r++) {
    const src = (r0 + r) * grid.width + c0;
    out.set(data.subarray(src, src + w) as never, r * w);
  }
  return { data: out, w, h, x0: grid.originX + c0 * cell, z0: grid.originZ + r0 * cell, cell };
}

function coastWindow(geo: GeoQuery, like: GridWin<Float32Array>): GridWin<Float32Array> {
  const out = new Float32Array(like.w * like.h);
  for (let r = 0; r < like.h; r++) {
    for (let c = 0; c < like.w; c++) {
      out[r * like.w + c] = geo.coastDistance(like.x0 + c * like.cell, like.z0 + r * like.cell);
    }
  }
  return { ...like, data: out };
}

function toGeometry(m: MeshArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(m.attributes)) {
    g.setAttribute(name, new THREE.BufferAttribute(a.array, a.size, a.normalized ?? false));
  }
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.computeBoundingSphere();
  return g;
}

class OsmSystem implements System {
  readonly name = 'osm';
  readonly order = UpdateOrder.World;
  private loading = 0;
  private readonly group = new THREE.Group();
  private materials: OsmMaterials | null = null;
  private colliderIds: number[] = [];
  private collision: CollisionWorld | null = null;
  private worker: Worker | null = null;
  private disposed = false;

  init(ctx: EngineContext): void {
    if (!osmEnabled(ctx.debug.params)) {
      return;
    }
    this.group.name = 'osm';
    ctx.scene.add(this.group);
    this.loading = 1;
    void ctx.services
      .when('geo')
      .then((geo) => this.load(ctx, geo))
      .catch((e: unknown) => console.error('[osm] failed to load', e))
      .finally(() => {
        this.loading = 0;
      });
  }

  pending(): number {
    return this.loading;
  }

  private build(req: OsmBuildRequest): Promise<OsmBuildResult> {
    const worker = new Worker(new URL('./worker/osm.worker.ts', import.meta.url), { type: 'module', name: 'osm' });
    this.worker = worker;
    return new Promise((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ ok: boolean; res?: OsmBuildResult; error?: string }>) => {
        worker.terminate();
        this.worker = null;
        if (e.data.ok && e.data.res) {
          resolve(e.data.res);
        } else {
          reject(new Error(e.data.error));
        }
      };
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage(req, [req.height.data.buffer, req.coast.data.buffer, req.landUse.data.buffer]);
    });
  }

  private async load(ctx: EngineContext, geo: GeoQuery): Promise<void> {
    const materials = createOsmMaterials(ctx.renderer);
    this.materials = materials;
    const data = (await fetch(OSM_DATA_URL).then((r) => r.json())) as OsmData;
    const rect = osmExclusionRect();
    const height = cutGrid(geo.heightGrid, geo.heightGrid.data, rect, 40);
    let coast: GridWin<Float32Array>;
    const coastTex = (geo.getCoastDistanceTexture().image as { data?: unknown }).data;
    if (coastTex instanceof Float32Array && coastTex.length === geo.heightGrid.width * geo.heightGrid.height) {
      coast = cutGrid(geo.heightGrid, coastTex, rect, 40);
    } else {
      coast = coastWindow(geo, height);
    }
    const landUse = cutGrid(geo.landUseGrid, geo.landUseGrid.data, rect, 40);
    const reserved: number[] = [];
    for (const l of geo.landmarks) {
      reserved.push(l.x, l.z, l.radius + 10);
    }
    for (const m of geo.smallMosqueSites) {
      reserved.push(m.x, m.z, m.radius);
    }
    const t0 = performance.now();
    const [res] = await Promise.all([this.build({ data, rect, height, coast, landUse, reserved }), materials.ready]);
    if (this.disposed) {
      return;
    }
    const t1 = performance.now();

    const mask = new THREE.DataTexture(res.mask.rgba, res.mask.size, res.mask.size, THREE.RGBAFormat, THREE.UnsignedByteType);
    mask.minFilter = THREE.LinearMipmapLinearFilter;
    mask.magFilter = THREE.LinearFilter;
    mask.generateMipmaps = true;
    mask.needsUpdate = true;
    const pool = new THREE.DataTexture(res.mask.pool, res.mask.poolSize, res.mask.poolSize, THREE.RedFormat, THREE.UnsignedByteType);
    pool.minFilter = THREE.LinearFilter;
    pool.magFilter = THREE.LinearFilter;
    pool.needsUpdate = true;
    materials.setStreetMask(mask, pool, res.mask.minX, res.mask.minZ, res.mask.extent, new THREE.Vector4(rect.minX, rect.minZ, rect.maxX, rect.maxZ));

    const add = (key: string, material: THREE.Material, cast: boolean, layer: number = RenderLayers.Default): void => {
      const m = res.meshes[key];
      if (!m || m.index.length === 0) {
        return;
      }
      const mesh = new THREE.Mesh(toGeometry(m), material);
      mesh.name = `osm-${key}`;
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.layers.set(layer);
      this.group.add(mesh);
    };
    add('plaster', materials.facades.plaster, true);
    add('painted', materials.facades.painted, true);
    add('stone', materials.facades.stone, true);
    add('concrete', materials.facades.concrete, true);
    add('brick', materials.facades.brick, true);
    add('roof', materials.roof, true);
    add('ground', materials.ground, false);
    add('paint', materials.paint, false, RenderLayers.NoReflection);
    add('rails', materials.rails, false, RenderLayers.NoReflection);

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const instanced = (key: string, geometry: THREE.BufferGeometry, material: THREE.Material, cast: boolean): void => {
      const d = res.instances[key];
      const n = d ? d.length / INSTANCE_STRIDE : 0;
      if (!n) {
        geometry.dispose();
        return;
      }
      const mesh = new THREE.InstancedMesh(geometry, material, n);
      for (let i = 0; i < n; i++) {
        const o = i * INSTANCE_STRIDE;
        p.set(d[o], d[o + 1], d[o + 2]);
        q.setFromAxisAngle(up, d[o + 3]);
        s.set(d[o + 4], d[o + 5], d[o + 4]);
        mesh.setMatrixAt(i, m4.compose(p, q, s));
        mesh.setColorAt(i, c.setRGB(d[o + 6], d[o + 7], d[o + 8]));
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = `osm-${key}`;
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.layers.set(RenderLayers.NoReflection);
      this.group.add(mesh);
    };
    instanced('lampArm', lampArmGeometry(), materials.lamp, false);
    instanced('lampLantern', lampLanternGeometry(), materials.lamp, false);
    instanced('chimney', chimneyGeometry(), materials.prop, true);
    instanced('tank', tankGeometry(), materials.prop, true);
    instanced('solar', solarGeometry(), materials.prop, true);
    instanced('dish', dishGeometry(), materials.prop, false);
    instanced('tree', treeGeometry(), materials.tree, true);

    this.collision = ctx.services.get('collision');
    const boxes = [];
    for (let i = 0; i < res.colliders.length; i += COLLIDER_STRIDE) {
      const b = res.colliders;
      boxes.push({ kind: 'box' as const, center: new THREE.Vector3(b[i], b[i + 1], b[i + 2]), halfSize: new THREE.Vector3(b[i + 3], b[i + 4], b[i + 5]), yaw: b[i + 6] });
    }
    this.colliderIds = this.collision.addMany(boxes, 'building');

    let tris = 0;
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const per = (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
        tris += per * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
      }
    });
    console.info(
      `[osm] worker ${Math.round(t1 - t0)} ms (${JSON.stringify(res.stats)}), main-thread upload ${Math.round(performance.now() - t1)} ms, ${this.group.children.length} draw objects, ${Math.round(tris)} triangles`,
    );
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
      }
    });
    this.group.removeFromParent();
    this.materials?.dispose();
    this.collision?.removeMany(this.colliderIds);
    this.colliderIds = [];
  }
}

export function createOsmSystem(): System {
  return new OsmSystem();
}
