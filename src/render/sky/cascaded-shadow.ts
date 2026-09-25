import * as THREE from 'three';
import { SunLightShadow } from 'three/examples/jsm/lights/SunLightShadow.js';
import { shadowGatePasses } from '../../core/shadow-gate';

/** Cascade slots compiled into every lit shader (2x2 atlas). Fewer can be active at runtime (quality). */
export const SHADOW_CASCADES = 4;

interface SunShadowInternals {
  _cameras: THREE.OrthographicCamera[];
  _matrices: THREE.Matrix4[];
  _frustums: THREE.Frustum[];
  _cascadeData: THREE.Vector4[];
  _viewports: THREE.Vector4[];
  _viewportCount: number;
  _frameExtents: THREE.Vector2;
  _updateMatrix(camera: THREE.Camera, matrix: THREE.Matrix4, frustum: THREE.Frustum, viewport: THREE.Vector4): void;
}

type BoundedObject = THREE.Object3D & {
  boundingSphere?: THREE.Sphere | null;
  computeBoundingSphere?: () => void;
  geometry?: THREE.BufferGeometry;
};

const _lightOrientation = new THREE.Matrix4();
const _viewToLight = new THREE.Matrix4();
const _lightDirection = new THREE.Vector3();
const _up = new THREE.Vector3();
const _center = new THREE.Vector3();
const _corner = new THREE.Vector3();
const _zero = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const INACTIVE_DEPTH = 1e20;

/** Shared per-frame data the cascade frusta need for caster culling. */
interface CullingContext {
  /** Third row of the view camera's world-to-view matrix: view depth = -(row.xyz . p + row.w). */
  readonly depthRow: THREE.Vector4;
  /** Direction the light travels (away from the sun/moon). */
  readonly lightTravel: THREE.Vector3;
  /** Lowest receiver height (m) a shadow can land on. */
  groundY: number;
  /** Longest shadow (m) considered along the light direction. */
  maxShadowLength: number;
  /** Size + receiver-range caster culling (debug toggle for A/B measurements). */
  enabled: boolean;
}

/**
 * Cascade frustum with receiver-aware caster culling. A caster is drawn into cascade i only when
 * 1. its bounding sphere intersects the cascade's light-space box (the regular frustum test),
 * 2. it is larger than a fraction of a shadow texel of that cascade, and
 * 3. its shadow volume (the sphere swept along the light direction down to the ground) overlaps the view-depth range
 *    in which cascade i is actually sampled.
 * Objects can also be limited to the near or the far cascades (core/shadow-gate.ts), e.g. full-detail meshes near
 * and their simplified proxies far.
 * The last test stops near-camera casters (the dragon) from being re-rendered into far cascades whose bounding sphere
 * happens to contain the camera, while keeping long shadows (low sun, high flight) that do land far away.
 */
class CascadeFrustum extends THREE.Frustum {
  readonly isCascadeFrustum = true;
  active = true;
  depthMin = -Infinity;
  depthMax = Infinity;
  minRadius = 0;

  constructor(private readonly cull: CullingContext) {
    super();
  }

  override intersectsObject(object: THREE.Object3D): boolean {
    if (!this.active || !shadowGatePasses(object, this.depthMin)) {
      return false;
    }
    const o = object as BoundedObject;
    if (o.boundingSphere !== undefined) {
      if (o.boundingSphere === null) {
        o.computeBoundingSphere?.();
      }
      _sphere.copy(o.boundingSphere as THREE.Sphere).applyMatrix4(object.matrixWorld);
    } else if (o.geometry) {
      if (o.geometry.boundingSphere === null) {
        o.geometry.computeBoundingSphere();
      }
      _sphere.copy(o.geometry.boundingSphere as THREE.Sphere).applyMatrix4(object.matrixWorld);
    } else {
      return true;
    }
    if (!this.intersectsSphere(_sphere)) {
      return false;
    }
    const c = this.cull;
    if (!c.enabled) {
      return true;
    }
    if (_sphere.radius < this.minRadius) {
      return false;
    }
    const row = c.depthRow;
    const center = _sphere.center;
    const d0 = -(row.x * center.x + row.y * center.y + row.z * center.z + row.w);
    const fall = -c.lightTravel.y;
    const length = fall > 1e-3 ? Math.min(Math.max(center.y + _sphere.radius - c.groundY, 0) / fall, c.maxShadowLength) : c.maxShadowLength;
    const d1 = d0 - length * (row.x * c.lightTravel.x + row.y * c.lightTravel.y + row.z * c.lightTravel.z);
    const lo = Math.min(d0, d1) - _sphere.radius;
    const hi = Math.max(d0, d1) + _sphere.radius;
    return hi >= this.depthMin && lo <= this.depthMax;
  }
}

/**
 * Up to four-cascade version of the r186 SunLight shadow (2x2 atlas). Cascades are bounding spheres of view-frustum
 * slices with explicit split distances (a tight first cascade gives the dragon crisp self shadowing), quantised radii
 * and texel-snapped centres so they neither swim nor shimmer while the camera moves or rotates.
 * Inactive cascades (low/medium quality) keep their atlas tile but draw nothing and are never sampled.
 */
export class CascadedSunShadow extends SunLightShadow {
  /** View-depth split distances (m). splits[0] is replaced by the camera near plane. */
  readonly splits: number[] = [0, 42, 180, 660, 2000];
  /** World size (m) of one shadow texel per cascade, updated every fit. */
  readonly texelWorldSize: number[] = [0, 0, 0, 0];
  /** Normal offset in texels (the shader multiplies shadow.normalBias by cascade.w = texel size * this). */
  normalOffsetTexels = 1.6;
  /** Fraction of each cascade over which it blends into the next one. */
  fadeFraction = 0.14;
  /** Extra height (m) above the view frustum from which casters are still captured. */
  casterMargin = 1500;
  /** Casters whose bounding radius is below this many texels are skipped in cascades >= 1. */
  minCasterTexels = 0.75;
  /** Number of cascades in use (2..SHADOW_CASCADES). */
  activeCascades = SHADOW_CASCADES;

  private readonly cull: CullingContext = {
    depthRow: new THREE.Vector4(),
    lightTravel: new THREE.Vector3(0, -1, 0),
    groundY: -20,
    maxShadowLength: 20000,
    enabled: true,
  };
  private readonly cascadeFrusta: CascadeFrustum[] = [];
  private maxDistance = 2000;

  constructor() {
    super();
    const s = this as unknown as SunShadowInternals;
    if (!Array.isArray(s._cameras) || !Array.isArray(s._frustums) || typeof s._updateMatrix !== 'function') {
      console.warn('[sky] SunLightShadow internals changed (three.js upgrade?): cascaded shadows may be wrong');
    }
    while (s._cameras.length < SHADOW_CASCADES) {
      s._cameras.push(new THREE.OrthographicCamera());
      s._matrices.push(new THREE.Matrix4());
      s._cascadeData.push(new THREE.Vector4());
    }
    s._frustums.length = 0;
    for (let i = 0; i < SHADOW_CASCADES; i++) {
      const frustum = new CascadeFrustum(this.cull);
      this.cascadeFrusta.push(frustum);
      s._frustums.push(frustum);
    }
    while (s._viewports.length < SHADOW_CASCADES) {
      s._viewports.push(new THREE.Vector4());
    }
    s._viewportCount = SHADOW_CASCADES;
    s._frameExtents.set(2, 2);
    for (const camera of s._cameras) {
      camera.layers.enableAll();
    }
    this.camera.layers.enableAll();
    this.normalBias = 1;
  }

  get casterCulling(): boolean {
    return this.cull.enabled;
  }

  set casterCulling(enabled: boolean) {
    this.cull.enabled = enabled;
  }

  /** Sets the number of active cascades (2..4) and re-derives the split scheme. */
  setActiveCascades(count: number): void {
    const n = THREE.MathUtils.clamp(Math.round(count), 2, SHADOW_CASCADES);
    if (n !== this.activeCascades) {
      this.activeCascades = n;
      this.setDistance(this.maxDistance);
    }
  }

  /** Sets the split scheme from the maximum shadow distance. */
  setDistance(maxDistance: number): void {
    const d = Math.max(maxDistance, 200);
    this.maxDistance = d;
    const n = this.activeCascades;
    // With fewer cascades the first one must reach further: the texel jump to the next cascade (and with it the
    // normal offset, which erodes the shadows of small casters) would otherwise start right behind the dragon.
    const s1 = n === 4 ? THREE.MathUtils.clamp(d * 0.021, 26, 60) : n === 3 ? THREE.MathUtils.clamp(d * 0.035, 30, 70) : THREE.MathUtils.clamp(d * 0.12, 40, 120);
    this.splits[1] = s1;
    if (n === 4) {
      const s2 = Math.max(d * 0.09, s1 * 3);
      const s3 = Math.max(d * 0.33, s2 * 2.8);
      this.splits[2] = s2;
      this.splits[3] = s3;
      this.splits[4] = Math.max(d, s3 * 1.5);
    } else if (n === 3) {
      const s2 = Math.max(d * 0.2, s1 * 4);
      this.splits[2] = s2;
      this.splits[3] = Math.max(d, s2 * 1.8);
      this.splits[4] = this.splits[3];
    } else {
      this.splits[2] = Math.max(d, s1 * 3);
      this.splits[3] = this.splits[2];
      this.splits[4] = this.splits[2];
    }
  }

  updateMatrices(light: THREE.Light, viewCamera?: THREE.Camera): void {
    if (!viewCamera || !(viewCamera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      return;
    }
    const cam = viewCamera as THREE.PerspectiveCamera;
    const s = this as unknown as SunShadowInternals;
    const tile = this.mapSize.x;
    const inset = Math.min(0.25, (Math.ceil(this.radius) + 2) / tile);
    for (let i = 0; i < SHADOW_CASCADES; i++) {
      s._viewports[i].set((i % 2) + inset, Math.floor(i / 2) + inset, 1 - 2 * inset, 1 - 2 * inset);
    }
    const resolution = tile * (1 - 2 * inset);

    _lightDirection.setFromMatrixPosition(light.matrixWorld).negate().normalize();
    _up.set(0, 1, 0);
    if (Math.abs(_up.dot(_lightDirection)) > 0.99) {
      _up.set(0, 0, 1);
    }
    _lightOrientation.lookAt(_zero, _lightDirection, _up);
    _viewToLight.copy(_lightOrientation).transpose().multiply(cam.matrixWorld);

    const e = cam.matrixWorldInverse.elements;
    this.cull.depthRow.set(e[2], e[6], e[10], e[14]);
    this.cull.lightTravel.copy(_lightDirection);

    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5) / cam.zoom;
    const tanH = tanV * cam.aspect;
    const k2 = tanV * tanV + tanH * tanH;
    const near = cam.near;
    const active = this.activeCascades;
    const far = Math.min(this.splits[active], cam.far);
    this.cull.maxShadowLength = Math.max(far * 4, 4000);

    // Caster ceiling: highest point of the whole shadowed frustum in light space + margin.
    let ceiling = -Infinity;
    for (let c = 0; c < 8; c++) {
      const z = c < 4 ? near : far;
      const x = (c & 1 ? 1 : -1) * tanH * z;
      const y = (c & 2 ? 1 : -1) * tanV * z;
      _corner.set(x, y, -z).applyMatrix4(_viewToLight);
      ceiling = Math.max(ceiling, _corner.z);
    }
    ceiling += Math.max(this.casterMargin, far * 0.5);

    const shadowNear = this.camera.near;
    let begin = near;
    for (let i = 0; i < SHADOW_CASCADES; i++) {
      const shadowCamera = s._cameras[i];
      const frustum = this.cascadeFrusta[i];
      if (i >= active) {
        frustum.active = false;
        s._cascadeData[i].set(INACTIVE_DEPTH, INACTIVE_DEPTH, INACTIVE_DEPTH, 0);
        continue;
      }
      const last = i === active - 1;
      const splitStart = i === 0 ? near : this.splits[i];
      const end = Math.min(last ? far : this.splits[i + 1], far);
      const fadeStart = end - this.fadeFraction * (end - splitStart);
      const n = Math.max(begin, near);
      const f = Math.max(end, n + 1e-3);

      const c = Math.min(f, ((1 + k2) * (f + n)) / 2);
      let radius = Math.max(Math.sqrt((c - n) ** 2 + n * n * k2), Math.sqrt((f - c) ** 2 + f * f * k2));
      radius = Math.pow(2, Math.ceil(Math.log2(radius) * 8) / 8);
      radius /= 1 - 2 / resolution;
      const texel = (2 * radius) / resolution;

      _center.set(0, 0, -c).applyMatrix4(_viewToLight);
      _center.x = Math.round(_center.x / texel) * texel;
      _center.y = Math.round(_center.y / texel) * texel;
      const minZ = _center.z - radius;
      _center.z = ceiling + shadowNear;
      _center.applyMatrix4(_lightOrientation);

      shadowCamera.position.copy(_center);
      shadowCamera.quaternion.setFromRotationMatrix(_lightOrientation);
      shadowCamera.left = -radius;
      shadowCamera.right = radius;
      shadowCamera.top = radius;
      shadowCamera.bottom = -radius;
      shadowCamera.near = shadowNear;
      shadowCamera.far = ceiling - minZ + 2 * shadowNear;
      shadowCamera.coordinateSystem = this.camera.coordinateSystem;
      (shadowCamera as unknown as { _reversedDepth: boolean })._reversedDepth = this.camera.reversedDepth;
      shadowCamera.updateProjectionMatrix();
      shadowCamera.updateMatrixWorld();
      s._updateMatrix(shadowCamera, s._matrices[i], frustum, s._viewports[i]);

      this.texelWorldSize[i] = texel;
      const receiverMin = i === 0 ? -1e10 : n;
      s._cascadeData[i].set(receiverMin, end, fadeStart, texel * this.normalOffsetTexels);
      frustum.active = true;
      frustum.depthMin = receiverMin;
      frustum.depthMax = end;
      frustum.minRadius = i === 0 ? 0 : texel * this.minCasterTexels;
      begin = fadeStart;
    }
  }
}
