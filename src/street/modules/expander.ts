import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadGlb, type StreetTileRef } from '../format';
import type { ModulesRef } from './format';
import type { ExpandReply, ExpandRequest } from './expand.worker';

/**
 * Main-thread side of the façade modules (format.ts): asks the expansion worker (expand.worker.ts) to assemble a
 * tile's slots and turns the reply into meshes with the area's palette materials (`modules.palette`, loaded once),
 * positioned like the tile glb's node. The streamer hands them to the draw batches with the tile's own meshes, so a
 * tile's façade detail costs no main-thread geometry work beyond wrapping the transferred arrays.
 */

let worker: Worker | null = null;
let seq = 0;
const waits = new Map<number, { resolve: (r: ExpandReply) => void; reject: (e: Error) => void }>();

function expandWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./expand.worker.ts', import.meta.url), { type: 'module', name: 'street-modules' });
    worker.onmessage = (e: MessageEvent<ExpandReply>) => {
      const w = waits.get(e.data.id);
      waits.delete(e.data.id);
      if (e.data.error || !e.data.parts) {
        w?.reject(new Error(e.data.error ?? 'expansion failed'));
      } else {
        w?.resolve(e.data);
      }
    };
  }
  return worker;
}

/** Totals over every tile expanded in this session (debug, size and time checks). */
export interface ModuleStats {
  tiles: number;
  slots: number;
  unmatched: number;
  vertices: number;
  /** Bytes of the slots files on the wire. */
  wireBytes: number;
  /** Bytes of the module library (catalog and module glbs) on the wire. */
  libBytes: number;
  /** Worker time per tile (fetch wait excluded): sum and maximum. */
  expandMs: number;
  maxExpandMs: number;
  /** Main-thread time spent wrapping replies into meshes. */
  mainMs: number;
  failures: number;
}

export class ModuleExpander {
  readonly stats: ModuleStats = { tiles: 0, slots: 0, unmatched: 0, vertices: 0, wireBytes: 0, libBytes: 0, expandMs: 0, maxExpandMs: 0, mainMs: 0, failures: 0 };
  private palette: Promise<Map<string, THREE.Material>> | null = null;
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly ref: ModulesRef,
    private readonly loader: GLTFLoader,
  ) {
    this.base = new URL(baseUrl, window.location.href).href;
  }

  private materials(): Promise<Map<string, THREE.Material>> {
    if (!this.palette) {
      this.palette = loadGlb(this.loader, new URL(this.ref.palette, this.base).href).then((gltf) => {
        const out = new Map<string, THREE.Material>();
        gltf.scene.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          if ((o as THREE.Mesh).isMesh && m && !out.has(m.name)) {
            out.set(m.name, m);
          }
        });
        return out;
      });
      this.palette.catch(() => {
        this.palette = null;
      });
    }
    return this.palette;
  }

  /** The tile's module meshes (in a group at the tile origin), or null when the tile has no slots. */
  async expand(tile: StreetTileRef): Promise<THREE.Object3D | null> {
    if (!tile.slots) {
      return null;
    }
    const origin: [number, number] = [(tile.bounds.minX + tile.bounds.maxX) / 2, (tile.bounds.minZ + tile.bounds.maxZ) / 2];
    const id = ++seq;
    const req: ExpandRequest = {
      id,
      slots: new URL(tile.slots.file, this.base).href,
      catalog: new URL(this.ref.catalog, this.base).href,
      tiling: this.ref.tiling,
      district: this.ref.district,
      colors: this.ref.colors ?? {},
      origin,
    };
    const reply = new Promise<ExpandReply>((resolve, reject) => {
      waits.set(id, { resolve, reject });
      expandWorker().postMessage(req);
    });
    let res: ExpandReply;
    let mats: Map<string, THREE.Material>;
    try {
      [res, mats] = await Promise.all([reply, this.materials()]);
    } catch (err) {
      this.stats.failures++;
      throw err;
    }
    const t0 = performance.now();
    const group = new THREE.Group();
    group.name = `modules_${tile.id}`;
    group.position.set(origin[0], 0, origin[1]);
    for (const p of res.parts!) {
      const m = mats.get(p.material);
      if (!m) {
        continue;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.position, 3, true));
      g.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3, true));
      g.setAttribute('color', new THREE.BufferAttribute(p.color, 4, true));
      if (p.uv) {
        g.setAttribute('uv', new THREE.BufferAttribute(p.uv, 2));
      }
      g.setIndex(new THREE.BufferAttribute(p.index, 1));
      const mesh = new THREE.Mesh(g, m);
      mesh.name = p.material;
      mesh.position.set(p.quant[0], p.quant[1], p.quant[2]);
      mesh.scale.setScalar(p.quant[3]);
      group.add(mesh);
    }
    const s = res.stats!;
    this.stats.tiles++;
    this.stats.slots += s.slots;
    this.stats.unmatched += s.unmatched;
    this.stats.vertices += s.vertices;
    this.stats.wireBytes += s.wireBytes;
    this.stats.libBytes += s.libWireBytes;
    this.stats.expandMs += s.expandMs;
    this.stats.maxExpandMs = Math.max(this.stats.maxExpandMs, s.expandMs);
    this.stats.mainMs += performance.now() - t0;
    return group;
  }
}
