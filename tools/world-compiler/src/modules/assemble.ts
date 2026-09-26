/**
 * Assembly of the module outputs (called from cli.ts):
 * - per tile, the step records `slots:*` become `tiles/<id>.slots.bin` (and leave the manifest);
 * - per area, the shared library is exported (library.ts) and the area's module material palette is written:
 *   `modules/palette.glb`, one tiny primitive per material a module may use, with the area's own material
 *   definitions and textures (district overrides included), so the runtime draws expanded modules with exactly the
 *   materials the tiles use. The index gets `modules` (ModulesRef) and each tile ref `slots` (SlotsRef).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { ModulesRef, SlotsRef } from '../../../../src/street/modules/format';
import { district } from '../district';
import { type BakedMap, writeTileGlbV1 } from '../gltf';
import type { MaterialName } from '../materials';
import type { PartArrays } from '../mesh';
import { tilingOf } from '../textures';
import { exportLibrary } from './library';
import { encodeTileSlots, SLOTS_RECORD, type SlotRecord } from './slots';

const sha16 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex').slice(0, 16);

/** Moves a tile's slot records out of `extra` into `tiles/<id>.slots.bin`; null when the tile has none. */
export function takeTileSlots(outDir: string, tileId: string, extra: Record<string, unknown>): SlotsRef | null {
  const keys = Object.keys(extra)
    .filter((k) => k.startsWith(SLOTS_RECORD))
    .sort();
  const records = keys.map((k) => extra[k] as SlotRecord);
  for (const k of keys) {
    delete extra[k];
  }
  const enc = encodeTileSlots(records);
  if (!enc) {
    return null;
  }
  const file = `tiles/${tileId}.slots.bin`;
  writeFileSync(resolve(outDir, file), enc.bytes);
  return { file, hash: sha16(enc.bytes), bytes: enc.bytes.byteLength, count: enc.count };
}

/** A hex string of an sRGB colour number. */
const hex = (v: number): string => `#${v.toString(16).padStart(6, '0')}`;

/**
 * Exports the library next to the area folders and writes the area's palette. `bake(id)` makes sure a material's
 * textures are processed and the material is listed in the index (cli.ts does for tile materials).
 */
export async function writeAreaModules(outDir: string, worldDir: string, bake: (id: MaterialName) => Promise<void>, baked: BakedMap): Promise<ModulesRef> {
  const lib = await exportLibrary(worldDir);
  for (const id of lib.materials) {
    await bake(id);
  }
  // One small triangle per material: the glb is read for its materials only.
  const parts: PartArrays[] = lib.materials.map((material) => ({
    material,
    position: new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0]),
    normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    index: new Uint32Array([0, 1, 2]),
    uv0: new Float32Array([0, 0, 1, 0, 0, 1]),
    color: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
  }));
  const glb = await writeTileGlbV1({ name: 'modules_palette', origin: [0, 0, 0], parts, extras: { palette: true, catalog: lib.catalog.hash }, baked });
  mkdirSync(resolve(outDir, 'modules'), { recursive: true });
  writeFileSync(resolve(outDir, 'modules', 'palette.glb'), glb);
  const tiling: Record<string, [number, number]> = {};
  for (const id of lib.materials) {
    if (baked.get(id)) {
      tiling[id] = tilingOf(id);
    }
  }
  const flag = district().facade.flag;
  return {
    catalog: `${relative(outDir, lib.dir).split('\\').join('/')}/catalog.json.gz`,
    catalogHash: lib.catalog.hash,
    palette: 'modules/palette.glb',
    tiling,
    district: district().id,
    colors: { flag: [hex(flag[0]), hex(flag[1])] },
  };
}
