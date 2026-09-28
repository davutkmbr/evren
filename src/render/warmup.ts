/**
 * Shader warm-up for content that joins a running scene (streamed regions, layers, batches): its programs are created
 * with KHR_parallel_shader_compile and the content is shown only once they are linked. Drawn cold, every new program
 * is linked synchronously on its first draw (23–77 ms each on ultra, .docs/planning/28-frame-budget.md).
 *
 * A program is only reused when its cache key matches the one the frame computes, so the compile reproduces how the
 * pipeline draws:
 * - into an HDR render target (linear output, no tone mapping); compiled against the canvas every program came out
 *   as a variant the frame never uses;
 * - with the real scene's lights, shadows, fog and environment (`scene` is the target scene);
 * - custom shadow depth materials (`customDepthMaterial`) as the shadow pass draws them: same lights, no fog.
 * Materials must already carry every define they are drawn with (e.g. OSM_FADE, osm/fade.ts).
 */
import * as THREE from 'three';

let target: THREE.WebGLRenderTarget | null = null;

/** A root for renderer.compile() that visits only `objects` (compile() walks its first argument with traverse()). */
function listRoot(objects: THREE.Object3D[]): THREE.Object3D {
  return {
    traverse: (fn: (o: THREE.Object3D) => void) => objects.forEach(fn),
    traverseVisible: () => undefined,
  } as unknown as THREE.Object3D;
}

/** Resolves once every program `object` needs (also for its shadow casters) is linked. */
export function compileForScene(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, object: THREE.Object3D): Promise<unknown> {
  target ??= new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const casters: THREE.Mesh[] = [];
  object.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.customDepthMaterial) {
      casters.push(o as THREE.Mesh);
    }
  });
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  try {
    // compileAsync creates the programs synchronously (with the current target) and then polls their completion.
    const jobs = [renderer.compileAsync(object, camera, scene)];
    if (casters.length) {
      const materials = casters.map((m) => m.material);
      const fog = scene.fog;
      casters.forEach((m) => (m.material = m.customDepthMaterial!));
      scene.fog = null;
      try {
        jobs.push(renderer.compileAsync(listRoot(casters), camera, scene));
      } finally {
        scene.fog = fog;
        casters.forEach((m, i) => (m.material = materials[i]));
      }
    }
    return Promise.all(jobs);
  } finally {
    renderer.setRenderTarget(previous);
  }
}
