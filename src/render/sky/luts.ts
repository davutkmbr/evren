import * as THREE from 'three';
import { ATMOSPHERE, MULTI_SCATTERING_LUT_SIZE, SKY_VIEW_LUT_SIZE, TRANSMITTANCE_LUT_SIZE } from './params';
import { FULLSCREEN_VERTEX, MULTI_SCATTERING_FRAGMENT, SKY_VIEW_FRAGMENT, TRANSMITTANCE_FRAGMENT } from './glsl/luts.glsl';

export type MediumUniforms = Record<string, THREE.IUniform>;

/** Uniforms describing the participating medium (km units), shared by every atmosphere shader. */
export function createMediumUniforms(): MediumUniforms {
  const a = ATMOSPHERE;
  return {
    uRayleighSca: { value: new THREE.Vector3(...a.rayleighScatteringPerKm) },
    uRayleighInvH: { value: 1 / a.rayleighScaleHeightKm },
    uMieParams: { value: new THREE.Vector4(a.mieScatteringPerKm, a.mieExtinctionPerKm, 1 / a.mieScaleHeightKm, a.mieG) },
    uOzoneAbs: { value: new THREE.Vector3(...a.ozoneAbsorptionPerKm) },
    uHazeSca: { value: new THREE.Vector3(...a.hazeScatteringPerKm) },
    uHazeExt: {
      value: new THREE.Vector3(
        a.hazeScatteringPerKm[0] + a.hazeAbsorptionPerKm[0],
        a.hazeScatteringPerKm[1] + a.hazeAbsorptionPerKm[1],
        a.hazeScatteringPerKm[2] + a.hazeAbsorptionPerKm[2],
      ),
    },
    uHazeParams: { value: new THREE.Vector2(1 / a.hazeScaleHeightKm, a.hazeG) },
    uGroundAlbedo: { value: new THREE.Vector3(...a.groundAlbedo) },
    uMediumMul: { value: new THREE.Vector4(1, 1, 0, 0) },
  };
}

function createLutTarget(width: number, height: number, wrapS: THREE.Wrapping = THREE.ClampToEdgeWrapping): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    wrapS,
    wrapT: THREE.ClampToEdgeWrapping,
  });
  rt.texture.name = 'atmosphere-lut';
  return rt;
}

export interface SkyViewLights {
  camAltitudeM: number;
  lightDirA: THREE.Vector3;
  lightIllumA: THREE.Vector3;
  lightDirB: THREE.Vector3;
  lightIllumB: THREE.Vector3;
  lightPollution: THREE.Vector4;
  /** Camera world x/z in km (the light-pollution dome is centred on the city). */
  cityOffsetKm: THREE.Vector2;
  airglow: THREE.Vector3;
}

/**
 * GPU atmosphere LUTs (Hillaire 2020): transmittance (256x64), multiple scattering (32x32) and the per-camera
 * sky-view LUT (256x128, absolute azimuth so sun, moon and the city's skyglow can be combined).
 */
export class AtmosphereLuts {
  readonly medium: MediumUniforms;
  readonly transmittance: THREE.WebGLRenderTarget;
  readonly multiScattering: THREE.WebGLRenderTarget;
  readonly skyView: THREE.WebGLRenderTarget;

  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly transmittanceMaterial: THREE.ShaderMaterial;
  private readonly multiScatteringMaterial: THREE.ShaderMaterial;
  private readonly skyViewMaterial: THREE.ShaderMaterial;

  constructor(skyViewSize: { width: number; height: number } = SKY_VIEW_LUT_SIZE) {
    this.medium = createMediumUniforms();
    this.transmittance = createLutTarget(TRANSMITTANCE_LUT_SIZE.width, TRANSMITTANCE_LUT_SIZE.height);
    this.multiScattering = createLutTarget(MULTI_SCATTERING_LUT_SIZE, MULTI_SCATTERING_LUT_SIZE);
    this.skyView = createLutTarget(skyViewSize.width, skyViewSize.height, THREE.RepeatWrapping);
    this.skyView.texture.name = 'sky-view-lut';

    const make = (fragmentShader: string, extra: Record<string, THREE.IUniform>): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        vertexShader: FULLSCREEN_VERTEX,
        fragmentShader,
        uniforms: { ...this.medium, ...extra },
        depthTest: false,
        depthWrite: false,
        fog: false,
        lights: false,
        toneMapped: false,
      });

    this.transmittanceMaterial = make(TRANSMITTANCE_FRAGMENT, {
      uSize: { value: new THREE.Vector2(TRANSMITTANCE_LUT_SIZE.width, TRANSMITTANCE_LUT_SIZE.height) },
    });
    this.multiScatteringMaterial = make(MULTI_SCATTERING_FRAGMENT, {
      uSize: { value: new THREE.Vector2(MULTI_SCATTERING_LUT_SIZE, MULTI_SCATTERING_LUT_SIZE) },
      uTransmittanceLUT: { value: this.transmittance.texture },
    });
    this.skyViewMaterial = make(SKY_VIEW_FRAGMENT, {
      uSize: { value: new THREE.Vector2(skyViewSize.width, skyViewSize.height) },
      uTransmittanceLUT: { value: this.transmittance.texture },
      uMultiScatteringLUT: { value: this.multiScattering.texture },
      uCamAltKm: { value: 0.1 },
      uLightDirA: { value: new THREE.Vector3(0, 1, 0) },
      uLightIllumA: { value: new THREE.Vector3() },
      uLightDirB: { value: new THREE.Vector3(0, 1, 0) },
      uLightIllumB: { value: new THREE.Vector3() },
      uLightPollution: { value: new THREE.Vector4() },
      uCityOffsetKm: { value: new THREE.Vector2() },
      uAirglow: { value: new THREE.Vector3() },
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(geometry, this.transmittanceMaterial);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setMediumScale(haze: number, aerosol: number): void {
    const mul = this.medium.uMediumMul.value as THREE.Vector4;
    mul.x = haze;
    mul.y = aerosol;
  }

  renderTransmittance(renderer: THREE.WebGLRenderer): void {
    this.draw(renderer, this.transmittanceMaterial, this.transmittance);
  }

  renderMultiScattering(renderer: THREE.WebGLRenderer): void {
    this.draw(renderer, this.multiScatteringMaterial, this.multiScattering);
  }

  renderSkyView(renderer: THREE.WebGLRenderer, lights: SkyViewLights): void {
    const u = this.skyViewMaterial.uniforms;
    u.uCamAltKm.value = Math.max(lights.camAltitudeM, 1) * 0.001;
    (u.uLightDirA.value as THREE.Vector3).copy(lights.lightDirA);
    (u.uLightIllumA.value as THREE.Vector3).copy(lights.lightIllumA);
    (u.uLightDirB.value as THREE.Vector3).copy(lights.lightDirB);
    (u.uLightIllumB.value as THREE.Vector3).copy(lights.lightIllumB);
    (u.uLightPollution.value as THREE.Vector4).copy(lights.lightPollution);
    (u.uCityOffsetKm.value as THREE.Vector2).copy(lights.cityOffsetKm);
    (u.uAirglow.value as THREE.Vector3).copy(lights.airglow);
    this.draw(renderer, this.skyViewMaterial, this.skyView);
  }

  private draw(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.quadScene, this.quadCamera);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.transmittance.dispose();
    this.multiScattering.dispose();
    this.skyView.dispose();
    this.transmittanceMaterial.dispose();
    this.multiScatteringMaterial.dispose();
    this.skyViewMaterial.dispose();
    this.quad.geometry.dispose();
  }
}
