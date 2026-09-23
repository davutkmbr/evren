/**
 * GPU side of the traffic layer. All vehicles share one material and live in two BatchedMesh draws (moving
 * vehicles + trams, parked vehicles), each instance switching between its model's three LOD geometries by camera
 * distance; culling is done here per instance (frustum with a shadow margin, max distance) so three.js only
 * rebuilds its multi-draw list when visibility or LOD changes. Head / tail light glows and headlight pools on the
 * road read the moving batch's matrix and colour textures in their vertex shaders: two more instanced draws with
 * no per-frame CPU cost.
 */
import * as THREE from 'three';
import { RenderLayers } from '../../../core/contracts';
import { MODEL_COUNT, MODEL_LENGTH, Model } from './catalog';
import { createPoolMaterial, createSpriteMaterial, createVehicleMaterial, type BatchTextures } from './materials';
import { buildModelGeometry, LOD_COUNT, modelLights } from './models';

/** LOD switch distances (m) for small vehicles; buses and trams switch later. */
const LOD_NEAR = 55;
const LOD_MID = 190;
/** Hysteresis factor for LOD switches. */
const LOD_HYST = 1.12;
/** Light sprites per moving slot (2 head + 2 tail). */
const SPRITES_PER_SLOT = 4;
/** Parked vehicles are culled per grid cell (m); their LODs refresh every PARKED_LOD_FRAMES frames. */
const PARKED_CELL = 48;
const PARKED_LOD_FRAMES = 4;

/** A grid cell of parked vehicles: instance range and bounding sphere. */
interface ParkedCell {
  start: number;
  count: number;
  x: number;
  y: number;
  z: number;
  r: number;
  visible: boolean;
}

interface Batch {
  mesh: THREE.BatchedMesh;
  geometry: number[][];
  /** Per instance: model, current LOD, bounding radius, visibility. */
  model: Int16Array;
  lod: Int8Array;
  radius: Float32Array;
  visible: Uint8Array;
  maxDist: Float32Array;
  data: Float32Array;
  tex: BatchTextures;
}

const _frustum = new THREE.Frustum();
const _m = new THREE.Matrix4();
const _v4 = new THREE.Vector4();
const _sphere = new THREE.Sphere();

export class VehicleRenderer {
  readonly group = new THREE.Group();
  readonly material = createVehicleMaterial();
  private readonly geometries: THREE.BufferGeometry[][] = [];
  private readonly moving: Batch;
  private readonly parked: Batch | null = null;
  private readonly sprites: THREE.Mesh;
  private readonly spriteSlot: THREE.InstancedBufferAttribute;
  private readonly spriteLight: THREE.InstancedBufferAttribute;
  private readonly pools: THREE.Mesh;
  private readonly pixelAngle = { value: 0.001 };
  private readonly spriteMaterial: THREE.ShaderMaterial;
  private readonly poolMaterial: THREE.ShaderMaterial;
  private readonly cam = new THREE.Vector3();
  private frame = 0;
  private readonly cells: ParkedCell[] = [];

  constructor(
    movingCapacity: number,
    parkedRecords: Float32Array | null,
    parkedStride: number,
    private readonly quality: number,
  ) {
    this.group.name = 'osm-traffic';
    for (let m = 0; m < MODEL_COUNT; m++) {
      const lods: THREE.BufferGeometry[] = [];
      for (let l = 0; l < LOD_COUNT; l++) {
        lods.push(buildModelGeometry(m, l));
      }
      this.geometries.push(lods);
    }
    this.moving = this.createBatch('osm-traffic-moving', movingCapacity, Array.from({ length: MODEL_COUNT }, (_, i) => i));
    if (parkedRecords && parkedRecords.length) {
      const n = parkedRecords.length / parkedStride;
      const models = [Model.Sedan, Model.Hatch, Model.Suv, Model.TaxiDoblo, Model.TaxiSedan, Model.Van, Model.PanelVan, Model.Truck, Model.Moto];
      this.parked = this.createBatch('osm-traffic-parked', n, models);
      this.fillParked(parkedRecords, parkedStride);
    }
    // light glows
    const sg = new THREE.InstancedBufferGeometry();
    sg.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    sg.setIndex([0, 1, 2, 0, 2, 3]);
    const cap = movingCapacity * SPRITES_PER_SLOT;
    this.spriteSlot = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.spriteLight = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.spriteSlot.setUsage(THREE.DynamicDrawUsage);
    this.spriteLight.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('iSlot', this.spriteSlot);
    sg.setAttribute('iLight', this.spriteLight);
    sg.instanceCount = cap;
    this.spriteMaterial = createSpriteMaterial(this.moving.tex, this.pixelAngle);
    this.sprites = new THREE.Mesh(sg, this.spriteMaterial);
    this.sprites.name = 'osm-traffic-lights';
    this.sprites.frustumCulled = false;
    this.sprites.renderOrder = 3;
    this.sprites.layers.set(RenderLayers.NoReflection);
    // head light pools
    const pg = new THREE.InstancedBufferGeometry();
    pg.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    pg.setIndex([0, 1, 2, 0, 2, 3]);
    const poolSlot = new THREE.InstancedBufferAttribute(new Float32Array(movingCapacity), 1);
    const poolSize = new THREE.InstancedBufferAttribute(new Float32Array(movingCapacity * 2), 2);
    for (let i = 0; i < movingCapacity; i++) {
      poolSlot.setX(i, i);
      poolSize.setXY(i, 1.6, 13);
    }
    pg.setAttribute('iSlot', poolSlot);
    pg.setAttribute('iSize', poolSize);
    pg.instanceCount = movingCapacity;
    this.poolMaterial = createPoolMaterial(this.moving.tex);
    this.pools = new THREE.Mesh(pg, this.poolMaterial);
    this.pools.name = 'osm-traffic-pools';
    this.pools.frustumCulled = false;
    this.pools.renderOrder = 2;
    this.pools.layers.set(RenderLayers.NoReflection);
    this.group.add(this.moving.mesh, this.sprites, this.pools);
    if (this.parked) {
      this.group.add(this.parked.mesh);
    }
  }

  private createBatch(name: string, capacity: number, models: number[]): Batch {
    let vertices = 0;
    let indices = 0;
    for (const m of models) {
      for (const g of this.geometries[m]) {
        vertices += g.getAttribute('position').count;
        indices += g.index!.count;
      }
    }
    const mesh = new THREE.BatchedMesh(Math.max(1, capacity), vertices, indices, this.material);
    mesh.name = name;
    mesh.sortObjects = false;
    mesh.perObjectFrustumCulled = false;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.layers.set(RenderLayers.NoReflection);
    const geometry: number[][] = [];
    for (let m = 0; m < MODEL_COUNT; m++) {
      geometry.push(models.includes(m) ? this.geometries[m].map((g) => mesh.addGeometry(g)) : []);
    }
    // force the colour texture into existence (instance state lives in its alpha)
    const id = mesh.addInstance(geometry[models[0]][LOD_COUNT - 1]);
    mesh.setColorAt(id, _v4.set(1, 1, 1, 0));
    mesh.deleteInstance(id);
    const internals = mesh as unknown as { _matricesTexture: THREE.DataTexture; _colorsTexture: THREE.DataTexture };
    return {
      mesh,
      geometry,
      model: new Int16Array(capacity).fill(-1),
      lod: new Int8Array(capacity).fill(-1),
      radius: new Float32Array(capacity),
      visible: new Uint8Array(capacity),
      maxDist: new Float32Array(capacity),
      data: internals._matricesTexture.image.data as unknown as Float32Array,
      tex: { matrices: internals._matricesTexture, colors: internals._colorsTexture },
    };
  }

  /** Adds the parked vehicles grouped by grid cell (instance ids are contiguous per cell). */
  private fillParked(rec: Float32Array, stride: number): void {
    const b = this.parked!;
    const n = rec.length / stride;
    const q = new THREE.Quaternion();
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const cellOf = (i: number): number => {
      const cx = Math.floor(rec[i * stride] / PARKED_CELL);
      const cz = Math.floor(rec[i * stride + 2] / PARKED_CELL);
      return (cz + 4096) * 8192 + cx + 4096;
    };
    const order = Array.from({ length: n }, (_, i) => i).sort((a, c) => cellOf(a) - cellOf(c));
    let cell: ParkedCell | null = null;
    let key = -1;
    for (const i of order) {
      const o = i * stride;
      const model = rec[o + 6];
      const id = b.mesh.addInstance(b.geometry[model][LOD_COUNT - 1]);
      // pitch: nose up when the ground rises ahead (object forward -Z): rotate about local X by +pitch
      e.set(rec[o + 4], rec[o + 3], -rec[o + 5]);
      q.setFromEuler(e);
      p.set(rec[o], rec[o + 1], rec[o + 2]);
      b.mesh.setMatrixAt(id, _m.compose(p, q, one));
      const r = rec[o + 7];
      const g = rec[o + 8];
      const bl = rec[o + 9];
      const metallic = Math.max(r, g, bl) - Math.min(r, g, bl) < 0.06 && r > 0.08 && r < 0.6 ? 8 : 0;
      b.mesh.setColorAt(id, _v4.set(r, g, bl, metallic));
      b.model[id] = model;
      b.lod[id] = LOD_COUNT - 1;
      b.radius[id] = MODEL_LENGTH[model] * 0.6;
      b.visible[id] = 1;
      b.maxDist[id] = 1400;
      const k = cellOf(i);
      if (k !== key || !cell) {
        key = k;
        cell = { start: id, count: 0, x: 0, y: 0, z: 0, r: 0, visible: true };
        this.cells.push(cell);
      }
      cell.count++;
    }
    for (const c of this.cells) {
      const d = b.data;
      for (let id = c.start; id < c.start + c.count; id++) {
        c.x += d[id * 16 + 12] / c.count;
        c.y += d[id * 16 + 13] / c.count;
        c.z += d[id * 16 + 14] / c.count;
      }
      for (let id = c.start; id < c.start + c.count; id++) {
        c.r = Math.max(c.r, Math.hypot(d[id * 16 + 12] - c.x, d[id * 16 + 13] - c.y, d[id * 16 + 14] - c.z) + 4);
      }
    }
  }

  /** Allocates an instance for a moving vehicle / tram module of `model`; returns the slot id. */
  allocate(model: number, paint: ArrayLike<number>, state: number): number {
    const b = this.moving;
    const id = b.mesh.addInstance(b.geometry[model][LOD_COUNT - 1]);
    b.model[id] = model;
    b.lod[id] = LOD_COUNT - 1;
    b.radius[id] = MODEL_LENGTH[model] * 0.6 + 1;
    b.visible[id] = 0;
    b.mesh.setVisibleAt(id, false);
    b.data[id * 16 + 13] = -1e5;
    b.maxDist[id] = model >= Model.CitadisEnd || model === Model.Bus ? 3000 : 1800;
    b.mesh.setColorAt(id, _v4.set(paint[0], paint[1], paint[2], state));
    // light sprites of this slot
    const L = modelLights(model);
    const lights: [number, number, number, number][] = [...L.head.map(([x, y, z]) => [x, y, z, 0] as [number, number, number, number]), ...L.tail.map(([x, y, z]) => [x, y, z, 1] as [number, number, number, number])];
    for (let k = 0; k < SPRITES_PER_SLOT; k++) {
      const si = id * SPRITES_PER_SLOT + k;
      const l = lights[k];
      if (l) {
        this.spriteSlot.setX(si, id);
        this.spriteLight.setXYZW(si, l[0], l[1], l[2], l[3]);
      } else {
        this.spriteSlot.setX(si, id);
        this.spriteLight.setXYZW(si, 0, -1000, 0, 2);
      }
    }
    this.spriteSlot.addUpdateRange(id * SPRITES_PER_SLOT, SPRITES_PER_SLOT);
    this.spriteLight.addUpdateRange(id * SPRITES_PER_SLOT * 4, SPRITES_PER_SLOT * 4);
    this.spriteSlot.needsUpdate = true;
    this.spriteLight.needsUpdate = true;
    return id;
  }

  release(slot: number): void {
    const b = this.moving;
    b.mesh.setColorAt(slot, _v4.set(0, 0, 0, 0));
    b.mesh.deleteInstance(slot);
    b.model[slot] = -1;
    b.visible[slot] = 0;
  }

  setState(slot: number, paint: ArrayLike<number>, state: number): void {
    this.moving.mesh.setColorAt(slot, _v4.set(paint[0], paint[1], paint[2], state));
  }

  /** Starts a frame: camera frustum (with a margin for shadows) and pixel angle for the light sprites. */
  begin(camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    camera.updateMatrixWorld();
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_m, camera.coordinateSystem, (camera as unknown as { reversedDepth?: boolean }).reversedDepth);
    this.cam.setFromMatrixPosition(camera.matrixWorld);
    this.pixelAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(viewportHeight, 1);
  }

  /**
   * Visibility and LOD of moving slot `slot` centred near (px, py, pz); `hidden` forces it invisible (tunnels,
   * unresolved decks, faded out). Returns whether it is drawn: only then does it need a pose() this frame.
   */
  test(slot: number, px: number, py: number, pz: number, hidden: boolean): boolean {
    return this.cull(this.moving, slot, px, py, pz, hidden);
  }

  /** Test + pose in one call (trams). */
  place(slot: number, px: number, py: number, pz: number, fx: number, fy: number, fz: number, rx: number, ry: number, rz: number, ux: number, uy: number, uz: number, scale: number, hidden: boolean): void {
    if (this.test(slot, px, py, pz, hidden || scale < 0.02)) {
      this.pose(slot, px, py, pz, fx, fy, fz, rx, ry, rz, ux, uy, uz, scale);
    }
  }

  /** Writes the matrix of moving slot `slot`: position p, forward f, right r, up u (unit, orthogonal), `scale`. */
  pose(slot: number, px: number, py: number, pz: number, fx: number, fy: number, fz: number, rx: number, ry: number, rz: number, ux: number, uy: number, uz: number, scale: number): void {
    const d = this.moving.data;
    const o = slot * 16;
    d[o] = rx * scale;
    d[o + 1] = ry * scale;
    d[o + 2] = rz * scale;
    d[o + 3] = 0;
    d[o + 4] = ux * scale;
    d[o + 5] = uy * scale;
    d[o + 6] = uz * scale;
    d[o + 7] = 0;
    d[o + 8] = -fx * scale;
    d[o + 9] = -fy * scale;
    d[o + 10] = -fz * scale;
    d[o + 11] = 0;
    d[o + 12] = px;
    d[o + 13] = py;
    d[o + 14] = pz;
    d[o + 15] = 1;
  }

  private cull(b: Batch, slot: number, px: number, py: number, pz: number, hidden: boolean): boolean {
    const dx = px - this.cam.x;
    const dy = py - this.cam.y;
    const dz = pz - this.cam.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let vis = !hidden && dist < b.maxDist[slot] * this.quality;
    if (vis) {
      _sphere.center.set(px, py, pz);
      _sphere.radius = b.radius[slot] + 10;
      vis = _frustum.intersectsSphere(_sphere);
    }
    if (vis !== (b.visible[slot] === 1)) {
      b.visible[slot] = vis ? 1 : 0;
      b.mesh.setVisibleAt(slot, vis);
      if (!vis && b === this.moving) {
        // the light glows and pools read the matrix of every slot: park hidden ones far below the world
        b.data[slot * 16 + 13] = -1e5;
      }
    }
    if (!vis) {
      return false;
    }
    const model = b.model[slot];
    const big = model === Model.Bus || model >= Model.CitadisEnd ? 1.8 : 1;
    const cur = b.lod[slot];
    const n0 = LOD_NEAR * big * this.quality;
    const n1 = LOD_MID * big * this.quality;
    let lod = dist < n0 ? 0 : dist < n1 ? 1 : 2;
    // hysteresis: keep the finer LOD a little longer
    if (lod > cur && cur >= 0 && dist < (cur === 0 ? n0 : n1) * LOD_HYST) {
      lod = cur;
    }
    if (lod !== cur) {
      b.lod[slot] = lod;
      b.mesh.setGeometryIdAt(slot, b.geometry[model][lod]);
    }
    return true;
  }

  /** Ends a frame: matrix upload, parked culling per cell (LODs of visible cells refreshed in turns). */
  end(): void {
    this.moving.tex.matrices.needsUpdate = true;
    const p = this.parked;
    if (p) {
      const d = p.data;
      const maxDist = 1400 * this.quality;
      const turn = this.frame % PARKED_LOD_FRAMES;
      for (let k = 0; k < this.cells.length; k++) {
        const c = this.cells[k];
        const dist = Math.hypot(c.x - this.cam.x, c.y - this.cam.y, c.z - this.cam.z);
        _sphere.center.set(c.x, c.y, c.z);
        _sphere.radius = c.r + 10;
        const vis = dist - c.r < maxDist && _frustum.intersectsSphere(_sphere);
        if (!vis) {
          if (c.visible) {
            c.visible = false;
            for (let id = c.start; id < c.start + c.count; id++) {
              if (p.visible[id]) {
                p.visible[id] = 0;
                p.mesh.setVisibleAt(id, false);
              }
            }
          }
          continue;
        }
        const fresh = !c.visible;
        c.visible = true;
        if (fresh || k % PARKED_LOD_FRAMES === turn) {
          for (let id = c.start; id < c.start + c.count; id++) {
            this.cull(p, id, d[id * 16 + 12], d[id * 16 + 13], d[id * 16 + 14], false);
          }
        }
      }
    }
    this.frame++;
  }

  /** Drawn moving / parked instances (stats). */
  visibleCounts(): [number, number] {
    let m = 0;
    let q = 0;
    for (let i = 0; i < this.moving.visible.length; i++) {
      m += this.moving.visible[i];
    }
    if (this.parked) {
      for (let i = 0; i < this.parked.visible.length; i++) {
        q += this.parked.visible[i];
      }
    }
    return [m, q];
  }

  /** Triangles currently submitted (stats). */
  triangles(): number {
    let t = 0;
    for (const b of [this.moving, this.parked]) {
      if (!b) {
        continue;
      }
      for (let i = 0; i < b.visible.length; i++) {
        if (b.visible[i] && b.model[i] >= 0) {
          t += this.geometries[b.model[i]][b.lod[i]].index!.count / 3;
        }
      }
    }
    return t;
  }

  dispose(): void {
    for (const lods of this.geometries) {
      for (const g of lods) {
        g.dispose();
      }
    }
    this.moving.mesh.dispose();
    this.parked?.mesh.dispose();
    this.sprites.geometry.dispose();
    this.pools.geometry.dispose();
    this.spriteMaterial.dispose();
    this.poolMaterial.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
