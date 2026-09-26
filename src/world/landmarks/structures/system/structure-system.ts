/**
 * Main-thread orchestration of the structures module: samples terrain for every structure site, generates the
 * geometry in a module worker, uploads it into the material batches (opaque / glass BatchedMesh, wires, light
 * sprites), registers colliders and runs the per-frame LOD selection. Bridges whose deck ends land on the ground are
 * then rebuilt with the exact drawn ground across those ends (terrain, and the OSM street ground once 'streetGround'
 * is known).
 */
import * as THREE from 'three';
import type { EngineContext, GeoQuery, LandmarkDef, StreetGroundService, System } from '../../../../core/contracts';
import { UpdateOrder } from '../../../../core/contracts';
import { globalUniforms } from '../../../../core/uniforms';
import { StructureBatches } from '../render/batches';
import { LightRenderer } from '../render/lights';
import { createGlassMaterial, createOpaqueMaterial } from '../render/materials';
import { WireRenderer } from '../render/wires';
import { BatchKind, LIGHT_STRIDE, WIRE_STRIDE } from '../types';
import type { DeckData, JointGround, PartData, SiteInput, StructureResult, WorkerRequest, WorkerResponse } from '../types';
import { QUAY_EDGE } from '../../../osm/shared/street-surface';
import { JOINT_REACH } from '../build/deck-joint';
import { RoadSurface } from './road-surface';
import { prepareSite } from './site-planner';

export interface StructureSystemOptions {
  /** Only build these landmark ids (sandbox isolation). */
  only?: readonly string[];
}

const _cam = new THREE.Vector3();
/** Lateral spacing (m) of the exact ground samples across a landed deck end. */
const JOINT_DX_EXACT = 0.05;
/** A height change (m) between neighbouring samples beyond this is a step (kerb) to locate exactly. */
const JOINT_STEP = 0.02;
/** Rows (and their spacing, m) of the ground sampled under a landed deck end (the deck rides over it there). */
const BED_ROWS = 40;
/** Ground lines stopping up to this far (m) short of a deck end (where the OSM bridge way begins) still continue on it. */
const LINE_REACH = 20;
const BED_DD = 1;

export class StructureSystem implements System {
  readonly name = 'structures';
  readonly order = UpdateOrder.World;

  private ctx: EngineContext | null = null;
  private geo: GeoQuery | null = null;
  private defs: LandmarkDef[] = [];
  private readonly workers = new Set<Worker>();
  private disposed = false;
  private readonly opaqueMaterial = createOpaqueMaterial();
  private readonly glassMaterial = createGlassMaterial();
  private readonly batches = new StructureBatches({ [BatchKind.Opaque]: this.opaqueMaterial, [BatchKind.Glass]: this.glassMaterial });
  private readonly wires = new WireRenderer();
  private readonly lights = new LightRenderer();
  private readonly root = new THREE.Group();
  private readonly results = new Map<string, StructureResult>();
  private readonly colliderIds = new Map<string, number[]>();
  private roadSurface: RoadSurface | null = null;
  private outstanding = 0;
  private expected = 0;
  private generationMs = 0;

  constructor(private readonly options: StructureSystemOptions = {}) {
    this.root.name = 'structures';
    this.root.add(this.batches.group, this.wires.object, this.lights.mesh);
  }

  init(ctx: EngineContext): void {
    this.ctx = ctx;
    ctx.scene.add(this.root);
    this.outstanding = 1;
    void ctx.services.when('geo').then((geo) => this.start(geo));
  }

  pending(): number {
    return this.outstanding;
  }

  private start(geo: GeoQuery): void {
    const only = this.options.only;
    const defs = geo.landmarks.filter((l: LandmarkDef) => l.builder === 'structures' && (!only || only.includes(l.id)));
    if (defs.length === 0) {
      this.outstanding = 0;
      return;
    }
    this.geo = geo;
    this.defs = defs;
    this.expected = defs.length;
    this.build(
      defs.map((d) => prepareSite(d, geo)),
      (ms) => {
        if (this.ctx?.sandbox) {
          console.info(`[structures] ${this.results.size}/${this.expected} structures, worker ${ms.toFixed(0)} ms, parts ${this.batches.partCount}, wires ${this.wires.count}, lights ${this.lights.count}`);
        }
        // Landed deck ends are rebuilt against the exact drawn ground: the terrain now, the OSM street ground once
        // it is known.
        const street = this.ctx?.services.tryGet('streetGround') ?? null;
        this.refineJoints(street, () => {
          if (!street) {
            void this.ctx?.services.when('streetGround').then((st) => this.refineJoints(st, () => undefined, true));
          }
        });
      },
    );
  }

  /** Builds `sites` in a fresh worker; their results replace earlier ones of the same id. */
  private build(sites: SiteInput[], done: (ms: number) => void): void {
    this.outstanding = sites.length + 1;
    const worker = new Worker(new URL('../worker/structures.worker.ts', import.meta.url), { type: 'module' });
    this.workers.add(worker);
    const finish = (): void => {
      worker.terminate();
      this.workers.delete(worker);
      this.outstanding = 0;
    };
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'structure') {
        this.results.set(msg.result.id, msg.result);
        this.generationMs += msg.result.ms;
        this.setColliders(msg.result);
        this.outstanding = Math.max(this.outstanding - 1, 1);
      } else if (msg.type === 'error') {
        console.error(`[structures] ${msg.id}: ${msg.message}`);
        this.outstanding = Math.max(this.outstanding - 1, 1);
      } else if (msg.type === 'done') {
        this.upload();
        this.provideRoadSurface();
        if (import.meta.env.DEV) {
          // Joint checks: every deck end with its strips (see DeckEnd).
          (window as unknown as { __structures?: unknown }).__structures = { ends: [...this.results.values()].flatMap((r) => r.ends) };
        }
        finish();
        done(msg.ms);
      }
    };
    worker.onerror = (e) => {
      console.error('[structures] worker error', e.message);
      finish();
    };
    const request: WorkerRequest = { type: 'build', sites };
    const transfer = sites.flatMap((s) => [...s.patches.map((p) => p.data.buffer as ArrayBuffer), ...(s.joints ?? []).flatMap((j) => [j.xs.buffer as ArrayBuffer, j.ground.buffer as ArrayBuffer, ...(j.bed ? [j.bed.ground.buffer as ArrayBuffer] : [])])]);
    worker.postMessage(request, transfer);
  }

  /**
   * Samples the drawn ground exactly across every landed deck end (JOINT_DX_EXACT apart, each step in it such as a kerb
   * located to 1 mm) and rebuilds those bridges with it, so each joint meets the ground across its whole width, kerbs
   * included (build/deck-joint.ts). The ground is the OSM street ground where `street` covers the end (under the deck
   * none seaward of the quay wall), else the terrain (none offshore); `streetOnly` limits it to ends on the street
   * ground. The street's tram tracks and lane lines across the end go along (the deck's lines move onto them).
   */
  private refineJoints(street: StreetGroundService | null, done: () => void, streetOnly = false): void {
    const geo = this.geo;
    if (!geo || this.disposed) {
      return;
    }
    const joints = new Map<string, JointGround[]>();
    for (const r of this.results.values()) {
      for (const e of r.ends) {
        // Lateral x across the deck, `d` m beyond the end (negative: under the deck).
        const at = (x: number, d = 0.05): { x: number; z: number } => ({ x: e.ox + e.ax * (e.s + e.dir * d) - e.az * x, z: e.oz + e.az * (e.s + e.dir * d) + e.ax * x });
        const c = at(0);
        const onStreet = !!street && street.covers(c.x, c.z);
        if (streetOnly && !onStreet) {
          continue;
        }
        const ground = (x: number, d = 0.05): number => {
          const p = at(x, d);
          const coast = geo.coastDistance(p.x, p.z);
          if (onStreet && street!.covers(p.x, p.z)) {
            // Beyond the end the street ground's height counts even seaward of the flight world's quay line: the
            // compiled street tiles draw the ground up to the finer OSM shoreline there, at the same height
            // (tools/world-compiler/src/foundation.ts). Under the deck only ground the slice draws lifts it.
            return d > 0 || coast > QUAY_EDGE ? street!.heightAt(p.x, p.z) : NaN;
          }
          return coast > 0 ? geo.heightAt(p.x, p.z) : NaN;
        };
        // Whether the end lands on this ground (deck-joint.ts decides the same way), not whether it landed on the
        // previous one: an end the terrain leaves in the air (a quay the flight terrain slopes into the sea at) can
        // still land on the street ground refined later.
        if (!(Math.abs(ground(0) - e.height) <= JOINT_REACH)) {
          continue;
        }
        const xs: number[] = [];
        const gs: number[] = [];
        const n = Math.ceil((e.halfWidth * 2) / JOINT_DX_EXACT) + 1;
        for (let i = 0; i < n; i++) {
          const x = -e.halfWidth + (i * e.halfWidth * 2) / (n - 1);
          const g = ground(x);
          const px = xs[xs.length - 1];
          const pg = gs[gs.length - 1];
          if (i > 0 && Math.abs(g - pg) > JOINT_STEP) {
            // A step (kerb, platform edge): bisect to 1 mm and keep both sides of it.
            let lo = px;
            let hi = x;
            while (hi - lo > 0.002) {
              const m = (lo + hi) / 2;
              if (Math.abs(ground(m) - pg) <= JOINT_STEP) {
                lo = m;
              } else {
                hi = m;
              }
            }
            xs.push(lo, hi);
            gs.push(ground(lo), ground(hi));
          }
          xs.push(x);
          gs.push(g);
        }
        // The ground under the deck's last metres, row by row inward at the same lateral positions.
        const under = new Float32Array(BED_ROWS * xs.length);
        for (let k = 0; k < BED_ROWS; k++) {
          const d = (k + 1) * BED_DD;
          for (let i = 0; i < xs.length; i++) {
            under[k * xs.length + i] = ground(xs[i], -d);
          }
        }
        const list = joints.get(r.id) ?? [];
        // The ground's tram tracks and lane lines across the end: the deck's own lines are moved onto them.
        let lines: JointGround['lines'];
        if (onStreet && street!.linesAcross) {
          const a = at(-e.halfWidth);
          const b = at(e.halfWidth);
          lines = street!.linesAcross(a.x, a.z, b.x, b.z, LINE_REACH).map((l) => ({ x: l.t - e.halfWidth, kind: l.kind }));
        }
        list.push({ ox: e.ox, oz: e.oz, ax: e.ax, az: e.az, s: e.s, xs: Float32Array.from(xs), ground: Float32Array.from(gs), bed: { dd: BED_DD, rows: BED_ROWS, ground: under }, lines });
        joints.set(r.id, list);
      }
    }
    const defs = this.defs.filter((d) => joints.has(d.id));
    if (defs.length === 0) {
      done();
      return;
    }
    this.build(
      defs.map((d) => ({ ...prepareSite(d, geo), joints: joints.get(d.id) })),
      () => done(),
    );
  }

  private setColliders(result: StructureResult): void {
    const collision = this.ctx?.services.get('collision');
    if (!collision) {
      return;
    }
    const old = this.colliderIds.get(result.id);
    if (old) {
      collision.removeMany(old);
    }
    const ids: number[] = [];
    this.colliderIds.set(result.id, ids);
    for (const c of result.colliders) {
      if (c.kind === 'box') {
        ids.push(collision.add({ kind: 'box', center: new THREE.Vector3(...c.center), halfSize: new THREE.Vector3(...c.halfSize), yaw: c.yaw }, 'structure', result.id));
      } else if (c.kind === 'cylinder') {
        ids.push(collision.add({ kind: 'cylinder', base: new THREE.Vector3(...c.base), radius: c.radius, height: c.height }, 'structure', result.id));
      } else {
        ids.push(collision.add({ kind: 'sphere', center: new THREE.Vector3(...c.center), radius: c.radius }, 'structure', result.id));
      }
    }
  }

  /** Publishes the bridge road decks as the core 'roadSurface' service (traffic, landing, OSM streets). */
  private provideRoadSurface(): void {
    const decks: DeckData[] = [];
    for (const r of this.results.values()) {
      decks.push(...r.decks);
    }
    if (!this.ctx || decks.length === 0) {
      return;
    }
    this.roadSurface = new RoadSurface(decks);
    this.ctx.services.provide('roadSurface', this.roadSurface);
  }

  /** The published road surface (debug). */
  get roads(): RoadSurface | null {
    return this.roadSurface;
  }

  private upload(): void {
    const parts: PartData[] = [];
    let wireFloats = 0;
    let lightFloats = 0;
    for (const r of this.results.values()) {
      parts.push(...r.parts);
      wireFloats += r.wires.length;
      lightFloats += r.lights.length;
    }
    this.batches.build(parts);
    const wires = new Float32Array(Math.max(wireFloats, WIRE_STRIDE));
    const lights = new Float32Array(Math.max(lightFloats, LIGHT_STRIDE));
    let wo = 0;
    let lo = 0;
    for (const r of this.results.values()) {
      wires.set(r.wires, wo);
      wo += r.wires.length;
      lights.set(r.lights, lo);
      lo += r.lights.length;
    }
    this.wires.setData(wires.subarray(0, wo));
    this.lights.setData(lights.subarray(0, lo));
    if (this.ctx) {
      this.updateLod(this.ctx);
    }
  }

  private updateLod(ctx: EngineContext): void {
    _cam.setFromMatrixPosition(ctx.camera.matrixWorld);
    this.batches.update(_cam, ctx.quality.settings.landmarkDetailDistance);
  }

  update(_dt: number, ctx: EngineContext): void {
    if (this.batches.partCount > 0) {
      this.updateLod(ctx);
    }
  }

  preRender(ctx: EngineContext): void {
    // uResolution is the internal (dynamic-resolution) target size already: no extra render-scale factor.
    const res = globalUniforms.uResolution.value as THREE.Vector2;
    const pixelAngle = (2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2)) / Math.max(res.y, 1);
    this.wires.setPixelAngle(pixelAngle);
    this.lights.setPixelAngle(pixelAngle);
  }

  /** Debug info for sandboxes. */
  stats(): { parts: number; wires: number; lights: number; activeTriangles: number; generationMs: number } {
    return {
      parts: this.batches.partCount,
      wires: this.wires.count,
      lights: this.lights.count,
      activeTriangles: this.batches.activeTriangles,
      generationMs: Math.round(this.generationMs),
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers.clear();
    const collision = this.ctx?.services.tryGet('collision');
    for (const ids of this.colliderIds.values()) {
      collision?.removeMany(ids);
    }
    if (this.roadSurface && this.ctx?.services.tryGet('roadSurface') === this.roadSurface) {
      this.ctx.services.withdraw('roadSurface');
    }
    this.roadSurface = null;
    this.colliderIds.clear();
    this.batches.dispose();
    this.wires.dispose();
    this.lights.dispose();
    this.opaqueMaterial.dispose();
    this.glassMaterial.dispose();
    this.root.removeFromParent();
  }
}
