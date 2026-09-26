import * as THREE from 'three';
import { SHARED_GLSL } from '../shaders';

/**
 * Sky-only environment lighting:
 * - a small cube capture of the sky dome (no disks) prefiltered with PMREMGenerator into ONE persistent target
 *   (scene.environment keeps the same texture, so materials never need a program change), captured and filtered on
 *   separate frames to spread the cost;
 * - a 4x1 irradiance probe read back asynchronously: [0] sky irradiance on an up-facing surface (uAmbient),
 *   [1] mean horizon radiance (fog colour), [2] irradiance from below, [3] zenith radiance.
 */
const PROBE_FRAGMENT = /* glsl */ `
${SHARED_GLSL}
void main() {
  int px = int(gl_FragCoord.x);
  vec3 acc = vec3(0.0);
  if (px == 0 || px == 2) {
    float s = px == 0 ? 1.0 : -1.0;
    for (int i = 0; i < 16; i++) {
      for (int j = 0; j < 8; j++) {
        float u = (float(j) + 0.5) / 8.0;
        float phi = 6.2831853 * (float(i) + 0.5 + 0.5 * float(j)) / 16.0;
        float r = sqrt(u);
        vec3 dir = vec3(r * cos(phi), s * sqrt(1.0 - u), r * sin(phi));
        acc += skyRadiance(dir);
      }
    }
    acc *= PI / 128.0;
  } else if (px == 1) {
    for (int i = 0; i < 32; i++) {
      float az = 6.2831853 * (float(i) + 0.5) / 32.0;
      float el = 0.035;
      acc += skyRadiance(vec3(cos(el) * sin(az), sin(el), -cos(el) * cos(az)));
    }
    acc /= 32.0;
  } else {
    acc = skyRadiance(vec3(0.0, 1.0, 0.0));
  }
  gl_FragColor = vec4(acc, 1.0);
}
`;

export interface ProbeResult {
  irradianceUp: THREE.Color;
  horizon: THREE.Color;
  irradianceDown: THREE.Color;
  zenith: THREE.Color;
  valid: boolean;
}

export class SkyEnvironment {
  readonly scene = new THREE.Scene();
  readonly result: ProbeResult = {
    irradianceUp: new THREE.Color(),
    horizon: new THREE.Color(),
    irradianceDown: new THREE.Color(),
    zenith: new THREE.Color(),
    valid: false,
  };
  /** Number of completed probe readbacks (screenshots wait for the first). */
  readbacks = 0;
  envTarget: THREE.WebGLRenderTarget | null = null;

  private cubeTarget: THREE.WebGLCubeRenderTarget;
  private cubeCamera: THREE.CubeCamera;
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly probeTarget: THREE.WebGLRenderTarget;
  private readonly probeScene = new THREE.Scene();
  private readonly probeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly probeBuffer = new Float32Array(16);
  private readonly probeMaterial: THREE.ShaderMaterial;
  private readonly probeGeometry: THREE.BufferGeometry;
  private readbackInFlight = false;
  private stage: 'idle' | 'filter' = 'idle';
  private cubeSize: number;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    skyMesh: THREE.Mesh,
    cubeSize: number,
  ) {
    this.cubeSize = cubeSize;
    this.scene.add(skyMesh);
    this.cubeTarget = this.createCubeTarget(cubeSize);
    this.cubeCamera = new THREE.CubeCamera(0.1, 10, this.cubeTarget);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.probeTarget = new THREE.WebGLRenderTarget(4, 1, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    const probeMaterial = (this.probeMaterial = new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: PROBE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      fog: false,
    }));
    const geometry = (this.probeGeometry = new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new THREE.Mesh(geometry, probeMaterial);
    quad.frustumCulled = false;
    this.probeScene.add(quad);
  }

  private createCubeTarget(size: number): THREE.WebGLCubeRenderTarget {
    return new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
  }

  get busy(): boolean {
    return this.stage !== 'idle';
  }

  setCubeSize(size: number): void {
    if (size === this.cubeSize) {
      return;
    }
    this.cubeSize = size;
    // An amortised update captured into the old cube would filter the new, empty one on the next step().
    this.stage = 'idle';
    this.cubeTarget.dispose();
    this.cubeTarget = this.createCubeTarget(size);
    this.cubeCamera = new THREE.CubeCamera(0.1, 10, this.cubeTarget);
    if (this.envTarget) {
      this.envTarget.dispose();
      this.envTarget = null;
    }
  }

  /** Synchronous capture + filter (initialisation / big jumps). Returns the PMREM texture. */
  captureNow(): THREE.Texture {
    this.capture();
    this.filter();
    this.stage = 'idle';
    return this.envTarget!.texture;
  }

  /** Starts an amortised update: capture this frame, filter on the next `step()`. */
  begin(): void {
    if (this.stage !== 'idle') {
      return;
    }
    this.capture();
    this.stage = 'filter';
  }

  /** Advances an amortised update. Returns true when a new environment texture content is ready. */
  step(): boolean {
    if (this.stage === 'filter') {
      this.filter();
      this.stage = 'idle';
      return true;
    }
    return false;
  }

  private capture(): void {
    this.cubeCamera.update(this.renderer, this.scene);
  }

  private filter(): void {
    if (this.envTarget) {
      this.pmrem.fromCubemap(this.cubeTarget.texture, this.envTarget);
    } else {
      this.envTarget = this.pmrem.fromCubemap(this.cubeTarget.texture);
    }
  }

  /** Renders the irradiance probe and starts an async readback (no GPU stall). */
  requestProbe(): void {
    if (this.readbackInFlight) {
      return;
    }
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.probeTarget);
    this.renderer.render(this.probeScene, this.probeCamera);
    this.renderer.setRenderTarget(prev);
    this.readbackInFlight = true;
    this.renderer
      .readRenderTargetPixelsAsync(this.probeTarget, 0, 0, 4, 1, this.probeBuffer)
      .then(() => {
        const b = this.probeBuffer;
        const ok = b.every((x) => Number.isFinite(x));
        if (ok) {
          this.result.irradianceUp.setRGB(b[0], b[1], b[2]);
          this.result.horizon.setRGB(b[4], b[5], b[6]);
          this.result.irradianceDown.setRGB(b[8], b[9], b[10]);
          this.result.zenith.setRGB(b[12], b[13], b[14]);
          this.result.valid = true;
          this.readbacks++;
        }
      })
      .catch(() => undefined)
      .finally(() => {
        this.readbackInFlight = false;
      });
  }

  dispose(): void {
    this.cubeTarget.dispose();
    this.envTarget?.dispose();
    this.envTarget = null;
    this.pmrem.dispose();
    this.probeTarget.dispose();
    this.probeMaterial.dispose();
    this.probeGeometry.dispose();
  }
}
