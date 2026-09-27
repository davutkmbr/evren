/**
 * Planar reflection of the scene in the sea plane y = 0.
 * The mirror camera renders RenderLayers.Default only (small detail lives on NoReflection), with an oblique near
 * plane on the water (Lengyel) adapted to three's reversed-Z projection (clip z in [0, w], near -> w, far -> 0).
 * The result is mip-mapped so the water shader can blur it by the unresolved wave roughness.
 * The texture is premultiplied by geometry coverage: rgb = 0 and alpha = 0 where the mirror only saw sky (the water
 * shader composites its own sky reflection there), alpha = 1 on geometry. Coverage therefore goes through the same
 * mip/anisotropic filtering as the colour, so silhouettes against the sky are antialiased at the lookup footprint
 * instead of being rebuilt from a binary depth test (texel-sized stair steps). With MSAA the coverage is resolved per
 * sample as well, which antialiases the silhouettes themselves.
 * The scene is drawn into a multisampled target without mips; a clean-up pass then copies it into the mip-mapped target
 * the water samples, turning non-finite texels (a material dividing by zero in the mirror's upward view) into sky and
 * capping over-range ones. The mip chain would otherwise spread a single bad texel over a whole block, which the water
 * showed as hard, screen-aligned dark or bright patches for the frames it was there (flicker audit,
 * .docs/planning/flicker-audit.md).
 */
import * as THREE from 'three';
import { RenderLayers } from '../../core/contracts';

const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();
const _target = new THREE.Vector3();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
const _invProj = new THREE.Matrix4();
const _invProjT = new THREE.Matrix4();
const _clipPlaneClip = new THREE.Vector4();
const _bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 1, 0, 0, 0, 0, 1);
const _corner = new THREE.Vector3();
const _waterNormal = new THREE.Vector3(0, 1, 0);
const _ndc = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;

/**
 * Full-screen triangles on the far plane, drawn last in the mirror render (same render call, so with MSAA they run
 * per sample before the resolve). They are depth-tested against the mirror's depth buffer (never sampled, so no
 * feedback loop with the attached depth texture): `sky` clears colour + alpha where nothing was drawn, `covered` forces
 * alpha = 1 (colour kept) wherever something was drawn, whatever alpha its material wrote.
 */
const COVERAGE_VERTEX = /* glsl */ `
uniform float uFarDepth;
void main() {
  gl_Position = vec4(position.xy, uFarDepth, 1.0);
}
`;
const COVERAGE_FRAGMENT = /* glsl */ `
uniform vec4 uValue;
void main() {
  gl_FragColor = uValue;
}
`;

/** Largest mirror radiance kept before the mips (the water compresses reflections above ~60 anyway). */
const MIRROR_MAX = 1e4;

const SANITIZE_VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
const SANITIZE_FRAGMENT = /* glsl */ `
uniform sampler2D tScene;
// Bit-level test: fast-math GPU compilers fold isnan() / x != x away.
bool badFloat(float x) {
  return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u;
}
void main() {
  vec4 c = texelFetch(tScene, ivec2(gl_FragCoord.xy), 0);
  if (badFloat(c.r) || badFloat(c.g) || badFloat(c.b) || badFloat(c.a)) {
    // Treated as sky: zero colour and coverage (premultiplied), so the water shows its own sky reflection there.
    c = vec4(0.0);
  }
  gl_FragColor = vec4(clamp(c.rgb, vec3(0.0), vec3(${MIRROR_MAX.toFixed(1)})), clamp(c.a, 0.0, 1.0));
}
`;

class CoverageMeshes {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly farDepth = { value: 0 };
  private readonly sky: THREE.ShaderMaterial;
  private readonly covered: THREE.ShaderMaterial;
  private reversed: boolean | null = null;

  constructor() {
    this.group.name = 'water-reflection-coverage';
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const make = (value: THREE.Vector4, blend: Partial<THREE.ShaderMaterialParameters>): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        name: 'water.reflectionCoverage',
        vertexShader: COVERAGE_VERTEX,
        fragmentShader: COVERAGE_FRAGMENT,
        uniforms: { uFarDepth: this.farDepth, uValue: { value } },
        // Transparent + highest renderOrder: drawn after everything else in the mirror.
        transparent: true,
        depthTest: true,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        ...blend,
      });
    this.sky = make(new THREE.Vector4(0, 0, 0, 0), { blending: THREE.NoBlending });
    // Colour untouched (0 * src + 1 * dst), alpha replaced (1 * src + 0 * dst).
    this.covered = make(new THREE.Vector4(0, 0, 0, 1), {
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.ZeroFactor,
    });
    [this.sky, this.covered].forEach((material, i) => {
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1e9 + i;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    });
    this.group.matrixAutoUpdate = false;
  }

  /** Depth state for the renderer's depth convention (call before the mirror render). */
  prepare(renderer: THREE.WebGLRenderer): void {
    const reversed = renderer.state.buffers.depth.getReversed();
    if (reversed === this.reversed) {
      return;
    }
    this.reversed = reversed;
    // Cleared (sky) depth is the far plane: 0 with reversed-Z, 1 otherwise. three remaps depth functions for a
    // reversed buffer (ReversedDepthFuncs), so pick the logical function that yields the GL test needed:
    // sky = EQUAL to the far value, covered = anything nearer than it (GreaterDepth maps to LESS when reversed).
    this.farDepth.value = reversed ? 0 : 1;
    this.sky.depthFunc = reversed ? THREE.NotEqualDepth : THREE.EqualDepth;
    this.covered.depthFunc = THREE.GreaterDepth;
  }

  dispose(): void {
    this.geometry.dispose();
    this.sky.dispose();
    this.covered.dispose();
  }
}

export class PlanarReflection {
  readonly camera = new THREE.PerspectiveCamera();
  /** World -> reflection texture uv (xy/w), without the oblique clip. */
  readonly textureMatrix = new THREE.Matrix4();
  /** What the water samples: the mirror image, cleaned up and mip-mapped. */
  target: THREE.WebGLRenderTarget;
  /** The mirror's scene render (multisampled, no mips) and its depth. */
  private sceneTarget: THREE.WebGLRenderTarget;
  private readonly sanitize = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)),
    new THREE.ShaderMaterial({
      name: 'water.reflectionSanitize',
      vertexShader: SANITIZE_VERTEX,
      fragmentShader: SANITIZE_FRAGMENT,
      uniforms: { tScene: { value: null } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  private readonly sanitizeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** False when the last frame skipped the pass (camera under water / water not in view). */
  valid = false;
  /**
   * Angular margin (degrees, each side) of the mirror camera beyond the main camera's view. Wave normals bend the
   * reflected rays by a similar angle whatever the zoom, so the margin is an angle, not a factor of the field of
   * view: with a factor, a narrow (zoomed) view left the bent rays outside the mirror, where the water fell back to
   * the sky reflection in screen-aligned patches that jumped as the view turned.
   */
  static readonly MARGIN_DEG = 9;
  /** Largest mirror resolution boost that keeps the texel density of the wider view (see coverage()). */
  static readonly MAX_BOOST = 1.35;
  private width = 0;
  private height = 0;
  private readonly coverage = new CoverageMeshes();
  /** MSAA samples of the mirror target (antialiased silhouettes and coverage, see WaterQuality.reflectionSamples). */
  private samples: number;

  constructor(anisotropy: number, samples = 0) {
    this.samples = samples;
    this.camera.layers.set(RenderLayers.Default);
    this.camera.layers.enable(RenderLayers.ReflectionOnly);
    this.camera.matrixAutoUpdate = true;
    // Mark the mirror camera as reversed-Z up front: the renderer would otherwise rebuild its projection (and drop
    // the oblique clip plane) on first use.
    (this.camera as unknown as { _reversedDepth: boolean })._reversedDepth = true;
    this.sanitize.frustumCulled = false;
    this.sceneTarget = this.createSceneTarget(2, 2);
    this.target = this.createTarget(2, 2, anisotropy);
  }

  /** Depth of the mirror's scene render (the water's per-pixel reflection distance). */
  get depthTexture(): THREE.DepthTexture {
    return this.sceneTarget.depthTexture as THREE.DepthTexture;
  }

  private createTarget(width: number, height: number, anisotropy: number): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
    target.texture.name = 'water.reflection';
    target.texture.anisotropy = anisotropy;
    return target;
  }

  private createSceneTarget(width: number, height: number): THREE.WebGLRenderTarget {
    const depthTexture = new THREE.DepthTexture(width, height, THREE.FloatType);
    depthTexture.name = 'water.reflectionDepth';
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      depthTexture,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      // Multisampled: the coverage pass then runs per sample, so the resolved alpha is the antialiased coverage.
      samples: this.samples,
    });
    target.texture.name = 'water.reflectionScene';
    return target;
  }

  setSize(width: number, height: number, anisotropy: number, samples = this.samples): void {
    const w = Math.max(16, Math.round(width / 8) * 8);
    const h = Math.max(16, Math.round(height / 8) * 8);
    // Dynamic resolution moves the internal size in small steps; only reallocate for a real change (the mirror
    // projection is resolution independent, a slightly larger/smaller target is just a little more/less sharp).
    const same = (a: number, b: number): boolean => b > 0 && Math.abs(a - b) <= b * 0.12;
    if (same(w, this.width) && same(h, this.height) && samples === this.samples) {
      return;
    }
    this.width = w;
    this.height = h;
    this.samples = samples;
    this.target.dispose();
    this.sceneTarget.dispose();
    this.sceneTarget = this.createSceneTarget(w, h);
    this.target = this.createTarget(w, h, anisotropy);
  }

  /** Vertical field of view (degrees) of the mirror camera for a main camera of `fov`. */
  static mirrorFov(fov: number): number {
    return Math.min(fov + 2 * PlanarReflection.MARGIN_DEG, 150);
  }

  /** Resolution factor that keeps the mirror's texels per degree at the centre while it covers the wider view. */
  static coverage(fov: number): number {
    const t = (f: number): number => Math.tan((f * Math.PI) / 360);
    return Math.min(PlanarReflection.MAX_BOOST, t(PlanarReflection.mirrorFov(fov)) / t(fov));
  }

  /** True if any part of the main camera's view could see the water plane from above. */
  static seesWater(camera: THREE.PerspectiveCamera): boolean {
    if (camera.position.y <= 0.02) {
      return false;
    }
    _invProj.copy(camera.projectionMatrixInverse);
    for (const [x, y] of _ndc) {
      _corner.set(x, y, 0.5).applyMatrix4(_invProj).transformDirection(camera.matrixWorld);
      if (_corner.y < 0.02) {
        return true;
      }
    }
    return false;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, main: THREE.PerspectiveCamera, hide: THREE.Object3D): void {
    const cam = this.camera;
    main.updateMatrixWorld();
    const eye = main.position;
    // Mirror position, forward and up across y = 0.
    _forward.set(0, 0, -1).transformDirection(main.matrixWorld);
    _up.set(0, 1, 0).transformDirection(main.matrixWorld);
    cam.position.set(eye.x, -eye.y, eye.z);
    _forward.y = -_forward.y;
    _up.y = -_up.y;
    cam.up.copy(_up);
    _target.copy(cam.position).add(_forward);
    cam.lookAt(_target);
    cam.fov = PlanarReflection.mirrorFov(main.fov);
    cam.aspect = main.aspect;
    cam.near = main.near;
    cam.far = main.far * 2;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    this.textureMatrix.copy(_bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    // Oblique near plane = the water plane (view space), reversed-Z variant of Lengyel's construction.
    _plane.set(_waterNormal, 0).applyMatrix4(cam.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const proj = cam.projectionMatrix;
    _invProj.copy(proj).invert();
    _invProjT.copy(_invProj).transpose();
    _clipPlaneClip.copy(_clip).applyMatrix4(_invProjT);
    _q.set(Math.sign(_clipPlaneClip.x), Math.sign(_clipPlaneClip.y), 0, 1).applyMatrix4(_invProj);
    const cq = _clip.dot(_q);
    if (Math.abs(cq) > 1e-12) {
      const a = -_q.z / _q.w / (cq / _q.w);
      const e = proj.elements;
      e[2] = -a * _clip.x;
      e[6] = -a * _clip.y;
      e[10] = -1 - a * _clip.z;
      e[14] = -a * _clip.w;
      cam.projectionMatrixInverse.copy(proj).invert();
    }

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const wasVisible = hide.visible;
    hide.visible = false;
    this.coverage.prepare(renderer);
    scene.add(this.coverage.group);
    try {
      renderer.autoClear = true;
      renderer.setRenderTarget(this.sceneTarget);
      renderer.state.buffers.depth.setMask(true);
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
      // The coverage triangles cover the whole far plane: left in the scene they would black out the main view's sky.
      scene.remove(this.coverage.group);
      // Clean-up copy into the mip-mapped target (the renderer builds its mips after the draw).
      (this.sanitize.material as THREE.ShaderMaterial).uniforms.tScene.value = this.sceneTarget.texture;
      renderer.setRenderTarget(this.target);
      renderer.render(this.sanitize, this.sanitizeCamera);
      this.valid = true;
    } finally {
      scene.remove(this.coverage.group);
      renderer.setRenderTarget(previousTarget);
      renderer.autoClear = previousAutoClear;
      hide.visible = wasVisible;
    }
  }

  dispose(): void {
    this.target.dispose();
    this.sceneTarget.dispose();
    this.sanitize.geometry.dispose();
    (this.sanitize.material as THREE.Material).dispose();
    this.coverage.dispose();
  }
}
