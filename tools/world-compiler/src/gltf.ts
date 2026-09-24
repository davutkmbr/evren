/**
 * Plain glTF 2.0 binary writer (no extensions: Godot's importer rejects files that require ones it does not know).
 * One scene, one node translated to the tile origin, one mesh with one primitive per material.
 *
 * Format 0: POSITION, NORMAL, indices and flat-colour materials.
 * Format 1: adds TEXCOORD_0 (world-scale texture repeats), TEXCOORD_1 (per-tile lightmap atlas), COLOR_0 where a
 * step set one, and PBR materials whose images are EXTERNAL files shared by every tile and prop
 * (`../textures/<file>`, relative to the glb). Material extras carry what glTF core cannot: tiling, emissive nits and
 * the night flag, the surface kind.
 * Format 1.1: `_WEATHER` (VEC4 float, custom attribute) on primitives that set it; material extras `variantOf`,
 * `variant` and `weather` (layers with their texture URIs).
 */
import { Document, type Material, NodeIO, type Texture, TextureInfo } from '@gltf-transform/core';
import type { WeatherLayerRec, WeatherRec } from './format';
import { WEATHER_CHANNEL } from './format';
import { baseColor, linearRgb, materialDef, type MaterialName, variantFields, WEATHER_LAYERS } from './materials';
import type { PartArrays } from './mesh';
import { type BakedSet, tilingOf } from './textures';

export const GENERATOR = 'Evren world-compiler (format 0)';
export const GENERATOR_V1 = 'Evren world-compiler (format 1)';

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

/** URI prefix of the shared textures, relative to tiles/ and props/. */
export const TEXTURE_URI = '../textures/';

/** Per-document cache of external textures (one glTF image per file). */
export class ExternalTextures {
  private readonly byFile = new Map<string, Texture>();
  constructor(private readonly doc: Document) {}

  get(file: string, mimeType: string): Texture {
    let t = this.byFile.get(file);
    if (!t) {
      t = this.doc.createTexture(file).setMimeType(mimeType);
      this.byFile.set(file, t);
    }
    return t;
  }
}

export function repeatInfo(info: TextureInfo | null, texCoord = 0): void {
  info
    ?.setTexCoord(texCoord)
    .setWrapS(TextureInfo.WrapMode.REPEAT)
    .setWrapT(TextureInfo.WrapMode.REPEAT)
    .setMinFilter(TextureInfo.MinFilter.LINEAR_MIPMAP_LINEAR)
    .setMagFilter(TextureInfo.MagFilter.LINEAR);
}

/** Baked sets by material id (the weather layers' maps are looked up here). */
export type BakedMap = ReadonlyMap<MaterialName, BakedSet | null>;

/**
 * Weather record of a material (undefined without `weather`). Texture paths get `prefix` (`textures/` in the index,
 * `../textures/` in glTF extras); a layer whose material is not in `baked` gets no maps.
 */
export function weatherRecord(id: MaterialName, baked: BakedMap, prefix: string): WeatherRec | undefined {
  const w = materialDef(id).weather;
  if (!w) {
    return undefined;
  }
  const layers: WeatherRec['layers'] = {};
  for (const k of WEATHER_LAYERS) {
    const L = w[k];
    if (!L) {
      continue;
    }
    const lm = L.material ? materialDef(L.material) : null;
    const b = L.material ? (baked.get(L.material) ?? null) : null;
    const normalScale = L.normalScale ?? lm?.normalScale ?? 1;
    const orm = L.roughness === undefined && b?.orm ? prefix + b.orm.file : null;
    const tint = linearRgb(L.tint ?? 0xffffff);
    const own = linearRgb(lm?.color ?? 0xffffff);
    const rec: WeatherLayerRec = {
      channel: WEATHER_CHANNEL[k],
      material: L.material ?? null,
      baseColor: b?.baseColor ? prefix + b.baseColor.file : null,
      normal: b?.normal && normalScale !== 0 ? prefix + b.normal.file : null,
      orm,
      alpha: !!b?.alpha,
      tiling: L.tiling ?? (L.material ? tilingOf(L.material) : [1, 1]),
      wrap: L.mirror ? 'mirror' : 'repeat',
      tint: [0, 1, 2].map((c) => Math.round(tint[c] * own[c] * 10000) / 10000) as [number, number, number],
      strength: L.strength ?? 1,
      blend: L.blend ?? 'mix',
      darken: L.darken ?? 1,
      roughness: L.roughness ?? (orm ? (lm?.roughness ?? 1) : (lm?.roughness ?? null)),
      normalScale,
      curvature: L.curvature ?? (k === 'edge' ? 0.75 : 0),
    };
    layers[k] = rec;
  }
  return { attribute: '_WEATHER', layers };
}

/** Runtime extras of a registry material (what glTF core cannot say). */
export function materialExtras(id: MaterialName, baked: BakedSet | null, all?: BakedMap): Record<string, unknown> {
  const d = materialDef(id);
  const extras: Record<string, unknown> = { tiling: tilingOf(id) };
  if (d.emissive) {
    extras.emissive = { nits: d.emissive.nits, night: d.emissive.night, source: d.emissive.source };
  }
  if (d.surface) {
    extras.surface = d.surface;
  }
  extras.castShadow = d.castShadow ?? (d.surface === 'wall' || d.surface === 'roof');
  if (baked) {
    extras.set = baked.key;
  }
  Object.assign(extras, variantFields(id));
  const weather = weatherRecord(id, all ?? new Map(), TEXTURE_URI);
  if (weather) {
    extras.weather = weather;
  }
  return extras;
}

/** glTF material of a registry material with its baked textures (null: flat colour); `all` holds the weather layers' sets. */
export function createMaterial(doc: Document, tex: ExternalTextures, id: MaterialName, baked: BakedSet | null, all?: BakedMap): Material {
  const d = materialDef(id);
  const alphaMode = d.alphaMode ?? (baked?.alpha ? 'MASK' : 'OPAQUE');
  const m = doc
    .createMaterial(id)
    .setBaseColorFactor([...linearRgb(d.color), 1])
    .setMetallicFactor(d.metallic ?? 0)
    .setRoughnessFactor(d.roughness ?? (baked?.orm ? 1 : 0.9))
    .setAlphaMode(alphaMode)
    .setDoubleSided(!!d.doubleSided);
  if (alphaMode === 'MASK') {
    m.setAlphaCutoff(d.alphaCutoff ?? 0.5);
  }
  if (baked?.baseColor) {
    m.setBaseColorTexture(tex.get(baked.baseColor.file, baked.baseColor.mimeType));
    repeatInfo(m.getBaseColorTextureInfo());
  }
  if (baked?.normal) {
    m.setNormalTexture(tex.get(baked.normal.file, baked.normal.mimeType)).setNormalScale(d.normalScale ?? 1);
    repeatInfo(m.getNormalTextureInfo());
  }
  if (baked?.orm) {
    const orm = tex.get(baked.orm.file, baked.orm.mimeType);
    m.setMetallicRoughnessTexture(orm);
    repeatInfo(m.getMetallicRoughnessTextureInfo());
    m.setOcclusionTexture(orm).setOcclusionStrength(d.occlusion ?? 1);
    repeatInfo(m.getOcclusionTextureInfo());
  }
  if (d.emissive) {
    m.setEmissiveFactor(linearRgb(d.emissive.color));
  }
  m.setExtras(materialExtras(id, baked, all));
  return m;
}

export interface TileGlbInput {
  name: string;
  origin: [number, number, number];
  parts: readonly PartArrays[];
  extras: Record<string, unknown>;
  baked: BakedMap;
}

/** Format 1 tile glb (see the header). */
export async function writeTileGlbV1(input: TileGlbInput): Promise<Uint8Array> {
  const doc = new Document();
  doc.getRoot().getAsset().generator = GENERATOR_V1;
  const buffer = doc.createBuffer();
  const mesh = doc.createMesh(input.name);
  const tex = new ExternalTextures(doc);
  for (const p of input.parts) {
    const material = createMaterial(doc, tex, p.material, input.baked.get(p.material) ?? null, input.baked);
    const vertices = p.position.length / 3;
    const index = vertices <= 65535 ? Uint16Array.from(p.index) : p.index;
    const acc = (suffix: string, type: 'VEC2' | 'VEC3' | 'VEC4' | 'SCALAR', array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>) =>
      doc.createAccessor(`${p.material}_${suffix}`).setType(type).setArray(array).setBuffer(buffer);
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', acc('position', 'VEC3', p.position))
      .setAttribute('NORMAL', acc('normal', 'VEC3', p.normal))
      .setIndices(acc('index', 'SCALAR', index))
      .setMaterial(material);
    if (p.uv0) {
      prim.setAttribute('TEXCOORD_0', acc('uv0', 'VEC2', p.uv0));
    }
    if (p.uv1) {
      prim.setAttribute('TEXCOORD_1', acc('uv1', 'VEC2', p.uv1));
    }
    if (p.color) {
      prim.setAttribute('COLOR_0', acc('color', 'VEC4', p.color));
    }
    if (p.weather) {
      prim.setAttribute('_WEATHER', acc('weather', 'VEC4', p.weather));
    }
    mesh.addPrimitive(prim);
  }
  const node = doc.createNode(input.name).setMesh(mesh).setTranslation(input.origin).setExtras(input.extras);
  const scene = doc.createScene(input.name).addChild(node);
  doc.getRoot().setDefaultScene(scene);
  return externalizeImages(await new NodeIO().writeBinary(doc), TEXTURE_URI);
}

/**
 * gltf-transform embeds images in a GLB and writes no URI for an image without data. The street format keeps images
 * external and shared: every image without a bufferView gets `uri = prefix + name`.
 */
export function externalizeImages(glb: Uint8Array, prefix: string): Uint8Array {
  return patchGlbJson(glb, (json) => {
    const images = (json.images ?? []) as { name?: string; uri?: string; bufferView?: number }[];
    for (const img of images) {
      if (img.bufferView === undefined && img.uri === undefined && img.name) {
        img.uri = prefix + img.name;
      }
    }
  });
}

/** Rewrites the JSON chunk of a GLB (the BIN chunk is kept as is). */
export function patchGlbJson(glb: Uint8Array, edit: (json: Record<string, unknown> & { images?: unknown[] }) => void): Uint8Array {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen))) as Record<string, unknown>;
  edit(json);
  let text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (text.length % 4)) % 4;
  if (pad) {
    const t = new Uint8Array(text.length + pad);
    t.set(text);
    t.fill(0x20, text.length);
    text = t;
  }
  const rest = glb.subarray(20 + jsonLen);
  const out = new Uint8Array(12 + 8 + text.length + rest.length);
  const ov = new DataView(out.buffer);
  out.set(glb.subarray(0, 12));
  ov.setUint32(8, out.length, true);
  ov.setUint32(12, text.length, true);
  ov.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  out.set(rest, 20 + text.length);
  return out;
}
