/** Main-thread helpers turning worker output (MeshArrays, instance records) into three.js objects. */
import * as THREE from 'three';
import { RenderLayers } from '../../../core/contracts';
import type { MeshArrays } from './protocol';
import { devParams } from '../../../core/dev-tools';

/**
 * Static OSM meshes drop their CPU arrays once uploaded (every streamed region would otherwise keep a second copy of
 * its geometry in the JS heap). `?keepGeometry=1` keeps them for test tools that ray-test the drawn meshes
 * (scripts/lib/collision-walk.mjs), like the procedural city.
 */
const KEEP_CPU = devParams().get('keepGeometry') === '1';

function releaseArray(this: THREE.BufferAttribute): void {
  (this as unknown as { array: ArrayLike<number> | null }).array = null;
}

/**
 * A data texture only the GPU reads drops its pixels once uploaded (same rule and `?keepGeometry=1` switch as the
 * geometry). Only for textures that are never updated again.
 */
export function releaseAfterUpload<T extends THREE.DataTexture | THREE.DataArrayTexture | THREE.Data3DTexture>(texture: T): T {
  if (!KEEP_CPU) {
    texture.onUpdate = () => {
      const img = texture.image as { data: unknown; width: number; height: number; depth?: number };
      texture.image = { data: null, width: img.width, height: img.height, depth: img.depth } as unknown as T['image'];
      texture.onUpdate = null;
    };
  }
  return texture;
}

/** `bounds: false` skips the bounding sphere (a pass over every vertex) for callers that set their own bounds. */
export function toGeometry(m: MeshArrays, opt: { bounds?: boolean } = {}): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const attr = (a: THREE.BufferAttribute): THREE.BufferAttribute => (KEEP_CPU ? a : a.onUpload(releaseArray));
  for (const [name, a] of Object.entries(m.attributes)) {
    g.setAttribute(name, attr(new THREE.BufferAttribute(a.array, a.size, a.normalized ?? false)));
  }
  g.setIndex(attr(new THREE.BufferAttribute(m.index, 1)));
  if (opt.bounds !== false) {
    g.computeBoundingSphere();
  }
  if (!KEEP_CPU) {
    notUploaded.add(g);
    g.addEventListener('dispose', forgetUpload);
  }
  return g;
}

/**
 * Geometries from toGeometry() not uploaded yet. The arrays are released on upload, and three uploads on the first
 * draw, so a mesh that is never drawn (a preloaded region still hidden, near-only kits and props far away) would keep
 * its whole CPU copy; uploadPending() sends them to the GPU right away instead.
 */
const notUploaded = new Set<THREE.BufferGeometry>();

/** Geometries still waiting for uploadPending(). */
export function pendingUploads(): number {
  return notUploaded.size;
}

function forgetUpload(this: THREE.BufferGeometry): void {
  notUploaded.delete(this);
}

/**
 * `source` is only ever drawn through `drawn` (same attributes and index, own draw range): upload through that one,
 * which is disposed with its mesh, so the upload leaves no GL state behind on a geometry that is never disposed.
 */
export function uploadThrough(source: THREE.BufferGeometry, drawn: THREE.BufferGeometry): void {
  if (notUploaded.delete(source)) {
    source.removeEventListener('dispose', forgetUpload);
    notUploaded.add(drawn);
    drawn.addEventListener('dispose', forgetUpload);
  }
}

let upload: { scene: THREE.Scene; camera: THREE.Camera; target: THREE.WebGLRenderTarget; material: THREE.Material } | null = null;

/**
 * Bytes of geometry uploadPending() sends per frame (at least one geometry). A region's geometry arrives as a few
 * large shared buffers plus many small ones: sent all at once they cost up to ~15 ms of buffer copies in one frame.
 */
const UPLOAD_BYTES_PER_FRAME = 8 << 20;

function geometryBytes(g: THREE.BufferGeometry): number {
  let n = g.index?.array.byteLength ?? 0;
  for (const a of Object.values(g.attributes)) {
    n += (a as THREE.BufferAttribute).array?.byteLength ?? 0;
  }
  return n;
}

/**
 * Uploads pending geometries (UPLOAD_BYTES_PER_FRAME per call) with one draw of zero triangles each into a 1x1 target
 * (three uploads the vertex buffers when it projects a mesh and the index when it binds it for the draw). Call once
 * per frame before rendering.
 */
export function uploadPending(renderer: THREE.WebGLRenderer): void {
  if (notUploaded.size === 0) {
    return;
  }
  upload ??= {
    scene: new THREE.Scene(),
    camera: new THREE.OrthographicCamera(),
    target: new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false }),
    material: new THREE.MeshBasicMaterial(),
  };
  const ranges: [THREE.BufferGeometry, number, number][] = [];
  let bytes = 0;
  for (const g of notUploaded) {
    if (bytes > 0 && bytes + geometryBytes(g) > UPLOAD_BYTES_PER_FRAME) {
      continue;
    }
    bytes += geometryBytes(g);
    notUploaded.delete(g);
    g.removeEventListener('dispose', forgetUpload);
    ranges.push([g, g.drawRange.start, g.drawRange.count]);
    g.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(g, upload.material);
    mesh.frustumCulled = false;
    upload.scene.add(mesh);
  }
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(upload.target);
  renderer.render(upload.scene, upload.camera);
  renderer.setRenderTarget(previous);
  upload.scene.clear();
  for (const [g, start, count] of ranges) {
    g.setDrawRange(start, count);
  }
}

export interface MeshOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** RenderLayers value (default: Default, i.e. also seen by the water reflection). */
  layer?: number;
}

/** Adds a static mesh built from worker arrays to `group`; returns null for missing / empty arrays. */
export function addMesh(group: THREE.Object3D, name: string, m: MeshArrays | undefined, material: THREE.Material, opt: MeshOptions = {}): THREE.Mesh | null {
  if (!m || m.index.length === 0) {
    return null;
  }
  const mesh = new THREE.Mesh(toGeometry(m), material);
  mesh.name = name;
  mesh.castShadow = opt.castShadow ?? false;
  mesh.receiveShadow = opt.receiveShadow ?? true;
  mesh.matrixAutoUpdate = false;
  mesh.layers.set(opt.layer ?? RenderLayers.Default);
  group.add(mesh);
  return mesh;
}

/** Disposes the geometries of every mesh under `root` and detaches it (materials belong to their layer). */
export function disposeGeometries(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh as THREE.InstancedMesh).dispose?.();
    }
  });
  root.removeFromParent();
}

/** Triangle count of the visible meshes under `root` (draw ranges honoured, instanced meshes counted per instance). */
export function countTriangles(root: THREE.Object3D): number {
  let tris = 0;
  root.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const per = Math.min(mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count, mesh.geometry.drawRange.count) / 3;
      tris += per * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
    }
  });
  return Math.round(tris);
}
