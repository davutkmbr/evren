import * as THREE from 'three';
import type { GeoQuery, RoadSurfaceService, WorldBounds } from '../../../core/contracts';
import { RenderLayers } from '../../../core/contracts';
import { patchMaterial } from '../../../core/uniforms';
import { SHARED_GLSL } from '../../../render/shaders';
import { MeshBuilder, surf } from '../util/mesh-builder';
import { CAR_FRAME_GLSL, CAR_LIGHT_FRAGMENT, CAR_LIGHT_VERTEX, CAR_MESH_BEGIN, CAR_MESH_COLOR, CAR_MESH_FRAGMENT_PARS, CAR_MESH_NORMAL, CAR_MESH_VERTEX_PARS } from './car-shaders';
import { ROAD_STEP, RoadNetwork } from './road-network';

/** Radius (m) around the camera inside which cars are drawn as meshes. */
const NEAR_RADIUS = 1400;

function replaceOnce(src: string, search: string, replacement: string): string {
  if (!src.includes(search)) {
    console.warn(`[life] car shader chunk "${search}" not found`);
    return src;
  }
  return src.replace(search, replacement);
}

/** Unit car (1 x 1 x 1 bounding box, forward -Z, wheels on y = 0) with aPart 0 body / 1 cabin / 2 wheels. */
function buildCarGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const s = surf(0xffffff);
  const body = new MeshBuilder();
  body.box(0, 0.33, 0, 1, 0.42, 1, s);
  // Bonnet / boot slopes are implied by the cabin set-back.
  parts.push(body.build());
  const cabin = new MeshBuilder();
  const w = 0.43;
  const zf0 = -0.2;
  const zf1 = -0.08;
  const zb0 = 0.3;
  const zb1 = 0.22;
  const y0 = 0.54;
  const y1 = 0.98;
  // Trapezoid cabin: raked windscreen and rear window.
  cabin.quadXYZ(-w, y0, zf0, w, y0, zf0, w * 0.92, y1, zf1, -w * 0.92, y1, zf1, s);
  cabin.quadXYZ(w, y0, zb0, -w, y0, zb0, -w * 0.92, y1, zb1, w * 0.92, y1, zb1, s);
  cabin.quadXYZ(w, y0, zf0, w, y0, zb0, w * 0.92, y1, zb1, w * 0.92, y1, zf1, s);
  cabin.quadXYZ(-w, y0, zb0, -w, y0, zf0, -w * 0.92, y1, zf1, -w * 0.92, y1, zb1, s);
  cabin.quadXYZ(-w * 0.92, y1, zf1, w * 0.92, y1, zf1, w * 0.92, y1, zb1, -w * 0.92, y1, zb1, s);
  parts.push(cabin.build());
  const wheels = new MeshBuilder();
  for (const x of [-0.44, 0.44]) {
    for (const z of [-0.32, 0.3]) wheels.box(x, 0.15, z, 0.14, 0.3, 0.15, s, 1 | 2 | 16 | 32);
  }
  parts.push(wheels.build());
  const pos: number[] = [];
  const nrm: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];
  parts.forEach((g, pi) => {
    const base = pos.length / 3;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      part.push(pi);
    }
    const index = g.getIndex()!;
    for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
    g.dispose();
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  return g;
}

/**
 * Road traffic: head/tail light streams for every car on the major roads and bridges (additive points, one call),
 * plus instanced low-poly cars near the camera (one call). Car motion is evaluated on the GPU from static lane data.
 */
export class CarTraffic {
  readonly group = new THREE.Group();
  readonly network: RoadNetwork;
  private readonly lights: THREE.Points;
  private readonly cars: THREE.Mesh;
  private readonly carGeo: THREE.InstancedBufferGeometry;
  private readonly nearRoad: Float32Array;
  private readonly nearLane: Float32Array;
  private readonly nearStyle: Float32Array;
  private readonly nearAttrs: THREE.InstancedBufferAttribute[];
  private readonly timeU = { value: 0 };
  private readonly trafficU = { value: 1 };
  private readonly carRange: [number, number][] = [];
  private refreshTimer = 0;
  private readonly lastCam = new THREE.Vector3(1e9, 0, 0);
  private readonly lightMaterial: THREE.ShaderMaterial;
  private readonly carMaterial: THREE.MeshStandardMaterial;

  /**
   * `exclude`: optional rectangle where cars are hidden; `surface`: the core 'roadSurface' service, the only source
   * of bridge deck heights (see RoadNetwork).
   */
  constructor(geo: GeoQuery, densityScale: number, exclude: WorldBounds | null = null, surface: RoadSurfaceService | null = null) {
    this.network = new RoadNetwork(geo, densityScale, exclude, surface);
    const cars = this.network.cars;
    const n = cars.length;
    const road = new Float32Array(n * 4);
    const lane = new Float32Array(n * 4);
    const style = new Float32Array(n * 4);
    let prevRoad = -1;
    cars.forEach((c, i) => {
      const tr = this.network.tracks[c.road];
      road.set([tr.start, tr.count, tr.length, tr.side], i * 4);
      lane.set([c.offset, c.dir, c.speed, c.phase], i * 4);
      style.set([c.style, c.type, c.hide, 0], i * 4);
      if (c.road !== prevRoad) {
        this.carRange[c.road] = [i, i];
        prevRoad = c.road;
      }
      this.carRange[c.road][1] = i + 1;
    });
    const roadsU = { value: this.network.texture };

    // Light streams: 2 point vertices (head / tail) per car instance.
    const lg = new THREE.InstancedBufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    lg.setAttribute('aEnd', new THREE.Float32BufferAttribute([1, -1], 1));
    lg.setAttribute('aRoad', new THREE.InstancedBufferAttribute(road, 4));
    lg.setAttribute('aLane', new THREE.InstancedBufferAttribute(lane, 4));
    lg.setAttribute('aStyle', new THREE.InstancedBufferAttribute(style, 4));
    lg.instanceCount = n;
    this.lightMaterial = new THREE.ShaderMaterial({
      name: 'life-car-lights',
      vertexShader: `${SHARED_GLSL}\n${CAR_FRAME_GLSL}\n${CAR_LIGHT_VERTEX}`,
      fragmentShader: CAR_LIGHT_FRAGMENT,
      uniforms: { uRoads: roadsU, uCarTime: this.timeU, uTraffic: this.trafficU },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.lights = new THREE.Points(lg, this.lightMaterial);
    this.lights.name = 'life-car-lights';
    this.lights.frustumCulled = false;
    this.lights.renderOrder = 21;
    this.group.add(this.lights);

    // Near-camera car meshes (compacted instance list, refreshed a few times per second).
    this.carGeo = new THREE.InstancedBufferGeometry();
    const base = buildCarGeometry();
    this.carGeo.setAttribute('position', base.getAttribute('position'));
    this.carGeo.setAttribute('normal', base.getAttribute('normal'));
    this.carGeo.setAttribute('aPart', base.getAttribute('aPart'));
    this.carGeo.setIndex(base.getIndex());
    const cap = Math.min(n, 6000);
    this.nearRoad = new Float32Array(cap * 4);
    this.nearLane = new Float32Array(cap * 4);
    this.nearStyle = new Float32Array(cap * 4);
    this.nearAttrs = [
      new THREE.InstancedBufferAttribute(this.nearRoad, 4).setUsage(THREE.DynamicDrawUsage),
      new THREE.InstancedBufferAttribute(this.nearLane, 4).setUsage(THREE.DynamicDrawUsage),
      new THREE.InstancedBufferAttribute(this.nearStyle, 4).setUsage(THREE.DynamicDrawUsage),
    ];
    this.carGeo.setAttribute('aRoad', this.nearAttrs[0]);
    this.carGeo.setAttribute('aLane', this.nearAttrs[1]);
    this.carGeo.setAttribute('aStyle', this.nearAttrs[2]);
    this.carGeo.instanceCount = 0;
    this.carMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.3 });
    this.carMaterial.name = 'life-cars';
    patchMaterial(this.carMaterial, 'life-cars-v1', (shader) => {
      shader.uniforms.uRoads = roadsU;
      shader.uniforms.uCarTime = this.timeU;
      shader.uniforms.uTraffic = this.trafficU;
      let vs = shader.vertexShader;
      vs = replaceOnce(vs, '#include <common>', `#include <common>\n${CAR_MESH_VERTEX_PARS}`);
      vs = replaceOnce(vs, '#include <beginnormal_vertex>', CAR_MESH_NORMAL);
      vs = replaceOnce(vs, '#include <begin_vertex>', CAR_MESH_BEGIN);
      shader.vertexShader = vs;
      let fs = shader.fragmentShader;
      fs = replaceOnce(fs, '#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${CAR_MESH_FRAGMENT_PARS}`);
      fs = replaceOnce(fs, '#include <color_fragment>', `#include <color_fragment>\n${CAR_MESH_COLOR}`);
      shader.fragmentShader = fs;
    });
    this.cars = new THREE.Mesh(this.carGeo, this.carMaterial);
    this.cars.name = 'life-cars';
    this.cars.frustumCulled = false;
    this.cars.layers.set(RenderLayers.NoReflection);
    this.group.add(this.cars);
    this.roadData = { road, lane, style };
  }

  private readonly roadData: { road: Float32Array; lane: Float32Array; style: Float32Array };

  get carCount(): number {
    return this.network.cars.length;
  }

  /** Traffic volume over the day (fraction of cars on the road). */
  private static volume(hours: number): number {
    const h = ((hours % 24) + 24) % 24;
    const rush = Math.exp(-Math.pow((h - 8.3) / 1.6, 2)) + Math.exp(-Math.pow((h - 18.3) / 2.0, 2));
    const day = THREE.MathUtils.smoothstep(h, 5.5, 8) * (1 - THREE.MathUtils.smoothstep(h, 22, 25));
    return THREE.MathUtils.clamp(0.28 + 0.45 * day + 0.3 * rush, 0.25, 1);
  }

  update(dt: number, time: number, hours: number, cam: THREE.Vector3): void {
    this.timeU.value = time;
    this.trafficU.value = CarTraffic.volume(hours);
    this.refreshTimer -= dt;
    if (this.refreshTimer <= 0 || this.lastCam.distanceToSquared(cam) > 150 * 150) {
      this.refreshTimer = 0.35;
      this.lastCam.copy(cam);
      this.refreshNear(time, cam);
    }
  }

  /** CPU mirror of the shader kinematics to pick the cars within NEAR_RADIUS of the camera. */
  private refreshNear(time: number, cam: THREE.Vector3): void {
    const net = this.network;
    const smp = net.samples;
    const stride = net.stride;
    const cap = this.nearRoad.length / 4;
    const { road, lane, style } = this.roadData;
    let k = 0;
    const r2 = NEAR_RADIUS * NEAR_RADIUS;
    for (let ri = 0; ri < net.tracks.length && k < cap; ri++) {
      const tr = net.tracks[ri];
      if (Math.hypot(tr.cx - cam.x, tr.cz - cam.z) - tr.radius > NEAR_RADIUS) continue;
      const range = this.carRange[ri];
      if (!range) continue;
      for (let i = range[0]; i < range[1] && k < cap; i++) {
        const L = road[i * 4 + 2];
        let s = (lane[i * 4 + 3] + lane[i * 4 + 1] * lane[i * 4 + 2] * time) % L;
        if (s < 0) s += L;
        const idx = tr.start + Math.min(Math.floor(s / ROAD_STEP), tr.count - 1);
        const dx = smp[idx * stride] - cam.x;
        const dz = smp[idx * stride + 2] - cam.z;
        if (dx * dx + dz * dz > r2) continue;
        this.nearRoad.set(road.subarray(i * 4, i * 4 + 4), k * 4);
        this.nearLane.set(lane.subarray(i * 4, i * 4 + 4), k * 4);
        this.nearStyle.set(style.subarray(i * 4, i * 4 + 4), k * 4);
        k++;
      }
    }
    this.carGeo.instanceCount = k;
    for (const a of this.nearAttrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, k * 4);
      a.needsUpdate = true;
    }
  }

  dispose(): void {
    this.lights.geometry.dispose();
    this.carGeo.dispose();
    this.lightMaterial.dispose();
    this.carMaterial.dispose();
    this.network.dispose();
  }
}
