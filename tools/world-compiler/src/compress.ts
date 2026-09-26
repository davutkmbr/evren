/**
 * Geometry compression of the format 1 glbs (tiles, props, prop LODs): vertex welding, quantization
 * (KHR_mesh_quantization: 14-bit positions, 10-bit normals, 12-bit texture coordinates in [0, 1], 8-bit colours and
 * weather) and EXT_meshopt_compression. The repeating world-space TEXCOORD_0 of walls and ground stays float (the
 * quantizer skips attributes outside [0, 1]). Roughly 5x smaller glbs; runtimes need a meshopt decoder
 * (three.js: GLTFLoader.setMeshoptDecoder). Textures are untouched (they stay external and shared).
 */
import { type Document, Logger, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { cloneDocument, reorder, weld } from '@gltf-transform/functions';
import { fastMeshopt, fastQuantize } from './quantize';
import { MeshoptEncoder } from 'meshoptimizer';
import { prepareWeb, webProfile } from './web';

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
  const web = webProfile();
  if (web) {
    prepareWeb(doc);
  }
  await doc.transform(
    weld(),
    // quantize.ts: the library's quantize() with its per-vertex loops on typed arrays (byte-identical, faster).
    fastQuantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8, quantizeGeneric: 8 }),
    reorder({ encoder: MeshoptEncoder }),
    // Web: 'high' stores normals octahedral (8 bits) through the meshopt filter.
    fastMeshopt({ encoder: MeshoptEncoder, level: web ? 'high' : 'medium' }),
  );
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': web ? WEB_ENCODER : MeshoptEncoder });
  return io.writeBinary(doc);
}

/**
 * Web: vertex attributes with meshopt's vertex codec version 1 at its highest level (10-20% smaller than version 0;
 * three's meshopt decoder, meshoptimizer 1.1, reads both). Indices as before.
 */
const WEB_ENCODER: typeof MeshoptEncoder = {
  ...MeshoptEncoder,
  encodeGltfBuffer: (source, count, size, mode) =>
    mode === 'ATTRIBUTES' ? MeshoptEncoder.encodeVertexBufferLevel(source, count, size, 3, 1) : MeshoptEncoder.encodeGltfBuffer(source, count, size, mode),
};
