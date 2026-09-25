/**
 * Geometry compression of the format 1 glbs (tiles, props, prop LODs): vertex welding, quantization
 * (KHR_mesh_quantization: 14-bit positions, 10-bit normals, 12-bit texture coordinates in [0, 1], 8-bit colours and
 * weather) and EXT_meshopt_compression. The repeating world-space TEXCOORD_0 of walls and ground stays float (the
 * quantizer skips attributes outside [0, 1]). Roughly 5x smaller glbs; runtimes need a meshopt decoder
 * (three.js: GLTFLoader.setMeshoptDecoder). Textures are untouched (they stay external and shared).
 */
import { type Document, Logger, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { cloneDocument, meshopt, quantize, reorder, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

let enabled = true;

/** `--no-compress` writes plain float glbs (inspection, other tools). */
export function setCompression(on: boolean): void {
  enabled = on;
}

export function compressionEnabled(): boolean {
  return enabled;
}

/** Writes `source` as a GLB, compressed unless compression is off (on a copy: `source` stays usable, e.g. for LODs). */
export async function writeGlb(source: Document): Promise<Uint8Array> {
  if (!enabled) {
    return new NodeIO().writeBinary(source);
  }
  await MeshoptEncoder.ready;
  const doc = cloneDocument(source);
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  await doc.transform(
    weld(),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8, quantizeGeneric: 8 }),
    reorder({ encoder: MeshoptEncoder }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  return io.writeBinary(doc);
}
