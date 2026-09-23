/**
 * Plain glTF 2.0 binary writer (no extensions: Godot's importer rejects files that require ones it does not know).
 * One scene, one node translated to the tile origin, one mesh with one primitive per material.
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { baseColor } from './materials';
import type { PartArrays } from './mesh';

export const GENERATOR = 'Evren world-compiler (format 0)';

export async function writeTileGlb(name: string, origin: [number, number, number], parts: readonly PartArrays[], extras: Record<string, unknown>): Promise<Uint8Array> {
  const doc = new Document();
  doc.getRoot().getAsset().generator = GENERATOR;
  const buffer = doc.createBuffer();
  const mesh = doc.createMesh(name);
  for (const p of parts) {
    const material = doc
      .createMaterial(p.material)
      .setBaseColorFactor(baseColor(p.material))
      .setMetallicFactor(0)
      .setRoughnessFactor(1);
    const vertices = p.position.length / 3;
    const index = vertices <= 65535 ? Uint16Array.from(p.index) : p.index;
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor(`${p.material}_position`).setType('VEC3').setArray(p.position).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor(`${p.material}_normal`).setType('VEC3').setArray(p.normal).setBuffer(buffer))
      .setIndices(doc.createAccessor(`${p.material}_index`).setType('SCALAR').setArray(index).setBuffer(buffer))
      .setMaterial(material);
    mesh.addPrimitive(prim);
  }
  const node = doc.createNode(name).setMesh(mesh).setTranslation(origin).setExtras(extras);
  const scene = doc.createScene(name).addChild(node);
  doc.getRoot().setDefaultScene(scene);
  return new NodeIO().writeBinary(doc);
}
