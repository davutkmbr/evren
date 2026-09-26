/**
 * Streets layer: the draped ground mesh with street surfaces, raised sidewalks and kerbs (ground shader over the
 * shared street raster), paint and grooved tram rails, masonry (steps, tram platforms), the tram overhead line and
 * instanced street furniture (lamps, signals, bollards, benches, bins, shelters), plus the night light pools and lamp
 * head sprites (streets.worker.ts builds everything). On the main thread it also attaches the bridge deck query to
 * the shared StreetSurface (OsmContext.surface.topAt()).
 */
import * as THREE from 'three';
import { RenderLayers } from '../../../core/contracts';
import { SHARED_GLSL } from '../../../render/shaders';
import type { OsmData } from '../data';
import { BoxGrid, segDist } from '../shared/geometry';
import { LayerBase } from '../shared/layer';
import { CARRIAGEWAY_KINDS } from '../shared/street-field';
import { InstanceLod, type InstanceLodOptions } from '../shared/instance-lod';
import { INSTANCE_STRIDE } from '../shared/protocol';
import { LodTiledMesh } from '../shared/lod-tiles';
import { addMesh } from '../shared/three';
import { runWorker } from '../shared/worker';
import type { OsmContext, OsmLayer } from '../types';
import { PROP_KINDS, type PropKind } from './kinds';
import { createStreetMaterials, type StreetMaterials } from './materials';
import { propGeometry } from './props';
import type { StreetsRequest, StreetsResult } from './protocol';

const SPRITE_VERTEX = /* glsl */ `
${SHARED_GLSL}
attribute vec4 aLamp;
varying vec3 vLampColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 1.0);
  float lightsOn = smoothstep(0.08, 0.42, uNight);
  float pxScale = projectionMatrix[1][1] * uResolution.y * 0.5;
  float px = aLamp.w * pxScale / dist;
  float size = max(px, 1.5);
  float energy = pow(px / size, 1.6);
  // Near lamps show their emissive glass; the sprite takes over with distance.
  float far = smoothstep(40.0, 120.0, dist);
  float intensity = 18.0 * lightsOn * mix(0.35, 1.0, energy) * far;
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vLampColor = aLamp.rgb * intensity * atmoTransmittance(wp);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * 2.2;
  if (intensity <= 0.001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
  }
}
`;

const SPRITE_FRAGMENT = /* glsl */ `
${SHARED_GLSL}
varying vec3 vLampColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vLampColor * (exp(-r2 * 9.0) + exp(-r2 * 3.0) * 0.18), 1.0);
}
`;

/** Triangles drawn per frame by `root` (honours draw ranges of the shared-buffer ground tiles and instancing). */
function trianglesOf(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const g = mesh.geometry;
      const total = g.index?.count ?? g.getAttribute('position').count;
      const per = Math.min(total, g.drawRange.count) / 3;
      tris += per * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
    }
  });
  return Math.round(tris);
}

/** Street furniture is drawn within 450 m (far lamps live on as the night head sprites); only tram canopies cast shadows. */
const PROP_LOD: InstanceLodOptions = { radius: 450, shadowRadius: 0 };
const CANOPY_LOD: InstanceLodOptions = { radius: 1200, shadowRadius: 300 };
/**
 * Beyond this distance (m at "high") the ground drops its 1 m kerb refinement and kerb faces for the plain 5 m grid
 * cells: a 15 cm kerb step is a third of a pixel there, and the street look comes from the ground shader's raster.
 */
const GROUND_FAR_DISTANCE = 400;

class StreetsLayer extends LayerBase {
  private readonly props: InstanceLod[] = [];
  private ground: LodTiledMesh | null = null;

  constructor(ctx: OsmContext, data: OsmData) {
    super('streets');
    const materials = createStreetMaterials(ctx.engine.renderer);
    this.onDispose(() => materials.dispose());
    this.attachDecks(ctx, data);
    const worker = new Worker(new URL('./streets.worker.ts', import.meta.url), { type: 'module', name: 'osm-streets' });
    const request: StreetsRequest = {
      base: ctx.base,
      data: { roads: data.roads, rails: data.rails, points: data.points, buildings: data.buildings, areas: data.areas, lines: data.lines },
    };
    const job = runWorker<StreetsRequest, StreetsResult>(worker, request);
    this.onDispose(() => job.cancel());
    const t0 = performance.now();
    this.track(
      Promise.all([job.promise, materials.ready]).then(([res]) => {
        if (!this.disposed) {
          this.upload(ctx, res, materials, performance.now() - t0);
        }
      }),
    );
  }

  update(_dt: number, ctx: OsmContext): void {
    const preset = ctx.engine.quality.settings.preset;
    this.ground?.update(ctx.engine.camera.position, preset);
    for (const p of this.props) {
      p.update(ctx.engine.camera.position, preset);
    }
  }

  /** Bridge decks for StreetSurface.topAt(): the core 'roadSurface' service, else structure colliders over OSM bridges. */
  private attachDecks(ctx: OsmContext, data: OsmData): void {
    const services = ctx.engine.services;
    const grid = new BoxGrid(40);
    const segs: number[] = [];
    for (const r of data.roads) {
      if (!r.bridge || !CARRIAGEWAY_KINDS.has(r.kind)) {
        continue;
      }
      for (let k = 2; k < r.pts.length; k += 2) {
        const id = segs.push(r.pts[k - 2], r.pts[k - 1], r.pts[k], r.pts[k + 1], r.width / 2 + 0.5) / 5 - 1;
        const h = r.width / 2 + 0.5;
        grid.add(id, Math.min(r.pts[k - 2], r.pts[k]) - h, Math.min(r.pts[k - 1], r.pts[k + 1]) - h, Math.max(r.pts[k - 2], r.pts[k]) + h, Math.max(r.pts[k - 1], r.pts[k + 1]) + h);
      }
    }
    ctx.surface.setDecks((x, z) => {
      const road = services.tryGet('roadSurface');
      if (road) {
        return road.deckHeightAt(x, z);
      }
      for (const id of grid.at(x, z)) {
        const o = id * 5;
        if (segDist(x, z, segs[o], segs[o + 1], segs[o + 2], segs[o + 3]) < segs[o + 4]) {
          const collision = services.tryGet('collision');
          const top = collision?.surfaceHeight(x, z);
          return top !== undefined && top > ctx.surface.heightAt(x, z) + 1 ? top : null;
        }
      }
      return null;
    });
    this.onDispose(() => ctx.surface.setDecks(null));
  }

  private upload(ctx: OsmContext, res: StreetsResult, materials: StreetMaterials, workerMs: number): void {
    const t1 = performance.now();
    materials.setStreetMask(ctx.base.street, res.pool, ctx.fade);
    // Flat streets barely show in the water's mirror image, but ~2 M triangles went into it every frame.
    if (res.meshes.ground?.index.length) {
      this.ground = new LodTiledMesh(this.group, 'osm-ground', res.meshes.ground, res.groundTiles, materials.ground, { distance: GROUND_FAR_DISTANCE });
      this.ground.setEnabled(ctx.engine.debug.params.get('osmlod') !== '0');
      this.ground.update(ctx.engine.camera.position, ctx.engine.quality.settings.preset);
    }
    addMesh(this.group, 'osm-paint', res.meshes.paint, materials.paint, { layer: RenderLayers.NoReflection });
    addMesh(this.group, 'osm-rails', res.meshes.rails, materials.rails, { layer: RenderLayers.NoReflection });
    addMesh(this.group, 'osm-trackbed', res.meshes.inlay, materials.inlay);
    addMesh(this.group, 'osm-masonry', res.meshes.masonry, materials.masonry);
    addMesh(this.group, 'osm-wires', res.meshes.wires, materials.wire, { layer: RenderLayers.NoReflection, receiveShadow: false });
    for (const kind of PROP_KINDS) {
      this.addProps(kind, res, materials);
    }
    this.addSprites(res.sprites);
    console.info(
      `[osm:streets] worker ${Math.round(workerMs)} ms ${JSON.stringify(res.stats)}, upload ${Math.round(performance.now() - t1)} ms, ${this.group.children.length} draws, ${trianglesOf(this.group)} tris`,
    );
  }

  private addProps(kind: PropKind, res: StreetsResult, materials: StreetMaterials): void {
    const records = res.instances[kind];
    if (!records?.length) {
      return;
    }
    const lights = res.lights[kind];
    const lit = lights.length === records.length / INSTANCE_STRIDE;
    const lod = kind === 'tramCanopy' ? CANOPY_LOD : PROP_LOD;
    this.props.push(new InstanceLod(this.group, `osm-${kind}`, records, propGeometry(kind), materials.props, { ...lod, attributes: lit ? { aLight: { data: lights, itemSize: 1 } } : undefined }));
  }

  private addSprites(sprites: Float32Array): void {
    const n = sprites.length / 7;
    if (!n) {
      return;
    }
    const pos = new Float32Array(n * 3);
    const lamp = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos.set(sprites.subarray(i * 7, i * 7 + 3), i * 3);
      lamp.set(sprites.subarray(i * 7 + 3, i * 7 + 7), i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aLamp', new THREE.BufferAttribute(lamp, 4));
    g.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      name: 'osm-lamp-sprites',
      vertexShader: SPRITE_VERTEX,
      fragmentShader: SPRITE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.onDispose(() => mat.dispose());
    const points = new THREE.Points(g, mat);
    points.name = 'osm-lamp-sprites';
    points.renderOrder = 5;
    points.matrixAutoUpdate = false;
    points.layers.set(RenderLayers.NoReflection);
    this.group.add(points);
  }
}

export function createStreetsLayer(ctx: OsmContext, data: OsmData): OsmLayer {
  return new StreetsLayer(ctx, data);
}
