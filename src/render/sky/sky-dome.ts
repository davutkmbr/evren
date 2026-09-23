import * as THREE from 'three';
import { RenderLayers } from '../../core/contracts';
import { SKY_DOME_FRAGMENT, SKY_DOME_VERTEX } from './glsl/sky-dome.glsl';
import { EQUATORIAL_TO_GALACTIC } from './milky-way';

export interface SkyDomeTextures {
  transmittance: THREE.Texture;
  moon: THREE.Texture;
  milkyWay: THREE.Texture;
}

export interface SkyDomeParams {
  sunDir: THREE.Vector3;
  /** Top-of-atmosphere disk radiance (the shader applies the view transmittance). */
  sunDiskRadiance: number;
  sunFlatten: number;
  moonDir: THREE.Vector3;
  moonRadius: number;
  /** Top-of-atmosphere radiance of a fully lit, albedo-1 lunar surface. */
  moonRadiance: THREE.Vector3;
  earthshine: number;
  equatorialToLocal: THREE.Matrix3;
  milkyWay: THREE.Vector3;
}

const _up = new THREE.Vector3();
const _ncp = new THREE.Vector3();
const OBLIQUITY = THREE.MathUtils.degToRad(23.44);
const SIN_OBLIQUITY = Math.sin(OBLIQUITY);
const COS_OBLIQUITY = Math.cos(OBLIQUITY);

/**
 * The sky as scene objects: `mesh` lives in the main scene (so it is rendered first, appears in the water's planar
 * reflection and keeps depth = 0 = far), `envMesh` lives in the sky-only capture scene (no sun/moon disks, so the
 * PMREM environment does not double count the direct light).
 */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly envMesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly material: THREE.ShaderMaterial;
  private readonly envMaterial: THREE.ShaderMaterial;
  private readonly localToGalactic = new THREE.Matrix3();

  constructor(textures: SkyDomeTextures, medium: Record<string, THREE.IUniform>) {
    this.uniforms = {
      ...medium,
      uTransmittanceLUT: { value: textures.transmittance },
      uMoonTex: { value: textures.moon },
      uMilkyWayTex: { value: textures.milkyWay },
      uSunDiskRadiance: { value: new THREE.Vector3() },
      uSunRadius: { value: 0.004653 },
      uSunUp: { value: new THREE.Vector3(0, 1, 0) },
      uSunFlatten: { value: 1 },
      uMoonDirL: { value: new THREE.Vector3(0, -1, 0) },
      uMoonRight: { value: new THREE.Vector3(1, 0, 0) },
      uMoonUp: { value: new THREE.Vector3(0, 1, 0) },
      uMoonRadius: { value: 0.0045 },
      uMoonRadiance: { value: new THREE.Vector3() },
      uMoonEarthshine: { value: 0 },
      uLocalToGalactic: { value: this.localToGalactic },
      uMilkyWayRadiance: { value: new THREE.Vector3() },
      uDrawDisks: { value: 1 },
    };
    const make = (drawDisks: number): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        vertexShader: SKY_DOME_VERTEX,
        fragmentShader: SKY_DOME_FRAGMENT,
        uniforms: { ...this.uniforms, uDrawDisks: { value: drawDisks } },
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      });
    this.material = make(1);
    this.envMaterial = make(0);
    const geometry = new THREE.BoxGeometry(2, 2, 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'sky-dome';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1e9;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.layers.set(RenderLayers.Default);
    this.envMesh = new THREE.Mesh(geometry, this.envMaterial);
    this.envMesh.frustumCulled = false;
    this.envMesh.matrixAutoUpdate = false;
  }

  update(params: SkyDomeParams): void {
    const u = this.uniforms;
    (u.uSunDiskRadiance.value as THREE.Vector3).setScalar(params.sunDiskRadiance);
    _up.set(0, 1, 0).addScaledVector(params.sunDir, -params.sunDir.y);
    if (_up.lengthSq() < 1e-8) {
      _up.set(0, 0, -1);
    }
    (u.uSunUp.value as THREE.Vector3).copy(_up.normalize());
    u.uSunFlatten.value = params.sunFlatten;

    const moonDir = params.moonDir;
    (u.uMoonDirL.value as THREE.Vector3).copy(moonDir);
    // The lunar spin axis stays within 1.5 deg of the ecliptic pole (Cassini's laws): its position angle swings by
    // ~+-25 deg from celestial north through the month and the night. Ecliptic pole in equatorial coordinates:
    // (0, -sin(obliquity), cos(obliquity)); the matrix columns are the equatorial basis vectors in the local frame.
    const e = params.equatorialToLocal.elements;
    _ncp.set(e[6] * COS_OBLIQUITY - e[3] * SIN_OBLIQUITY, e[7] * COS_OBLIQUITY - e[4] * SIN_OBLIQUITY, e[8] * COS_OBLIQUITY - e[5] * SIN_OBLIQUITY);
    _up.copy(_ncp).addScaledVector(moonDir, -_ncp.dot(moonDir));
    if (_up.lengthSq() < 1e-8) {
      _up.set(0, 1, 0);
    }
    _up.normalize();
    (u.uMoonUp.value as THREE.Vector3).copy(_up);
    (u.uMoonRight.value as THREE.Vector3).crossVectors(moonDir, _up).normalize();
    u.uMoonRadius.value = params.moonRadius;
    (u.uMoonRadiance.value as THREE.Vector3).copy(params.moonRadiance);
    u.uMoonEarthshine.value = params.earthshine;

    // local -> galactic = (equatorial -> galactic) * (equatorial -> local)^T
    this.localToGalactic.copy(params.equatorialToLocal).transpose().premultiply(EQUATORIAL_TO_GALACTIC);
    (u.uMilkyWayRadiance.value as THREE.Vector3).copy(params.milkyWay);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.envMaterial.dispose();
  }
}
