/**
 * Loading of the CC0 PBR texture sets in public/textures (see LICENSES.md and scripts/data/fetch-textures.mjs):
 * single maps, full PBR bindings and packed texture arrays (albedo + roughness, normal).
 */
import * as THREE from 'three';

export type TextureSet = 'plaster' | 'plaster_painted' | 'stone' | 'concrete' | 'brick' | 'roof_tiles' | 'asphalt' | 'cobble' | 'sidewalk' | 'granite' | 'yard';
export type TextureMap = 'albedo' | 'normal' | 'rough';

/** Real-world size (m) of one texture repeat (see scripts/data/fetch-textures.mjs). */
export const REPEAT_M: Record<TextureSet, number> = {
  plaster: 2,
  plaster_painted: 2,
  stone: 2,
  concrete: 2.7,
  brick: 1,
  roof_tiles: 2.5,
  asphalt: 2.08,
  cobble: 1.5,
  sidewalk: 2,
  granite: 3,
  yard: 3,
};

export function textureUrl(set: TextureSet, map: TextureMap): string {
  return `${import.meta.env.BASE_URL}textures/${set}/${map}.jpg`;
}

interface SharedEntry {
  job: Promise<THREE.Texture[]>;
  refs: number;
}

const shared = new Map<string, SharedEntry>();

/**
 * Texture sets shared by every OSM region (streamed regions build their own materials over the same CC0 sets): one
 * GPU copy per key. Each caller gets the same textures and disposes them as before; their dispose() only releases
 * the caller's reference, and the last release really frees them.
 */
function share<T extends THREE.Texture[]>(key: string, make: () => Promise<T>): Promise<T> {
  let entry = shared.get(key);
  if (!entry) {
    const e: SharedEntry = { job: make(), refs: 0 };
    shared.set(key, e);
    e.job
      .then((textures) => {
        for (const t of textures) {
          const free = t.dispose.bind(t);
          t.dispose = () => {
            if (--e.refs <= 0) {
              if (shared.get(key) === e) {
                shared.delete(key);
              }
              free();
            }
          };
        }
      })
      .catch(() => shared.delete(key));
    entry = e;
  }
  const e = entry;
  // One reference per texture handed out (callers dispose every texture they got).
  return e.job.then((textures) => {
    e.refs += textures.length;
    return textures as T;
  });
}

/** Repeating texture with a repeat of 1 / REPEAT_M (UVs in metres), sRGB for albedo (shared, see share()). */
export function loadTexture(loader: THREE.TextureLoader, set: TextureSet, map: TextureMap, anisotropy: number): Promise<THREE.Texture> {
  return share(`tex:${set}/${map}:${anisotropy}`, () => loadTextureOnce(loader, set, map, anisotropy).then((t) => [t])).then(([t]) => t);
}

function loadTextureOnce(loader: THREE.TextureLoader, set: TextureSet, map: TextureMap, anisotropy: number): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      textureUrl(set, map),
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.setScalar(1 / REPEAT_M[set]);
        tex.anisotropy = anisotropy;
        tex.colorSpace = map === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

/** Loads albedo / normal / roughness of `set` into `m` (map, normalMap, roughnessMap); returns the three textures. */
export async function bindPbr(m: THREE.MeshStandardMaterial, set: TextureSet, loader: THREE.TextureLoader, anisotropy: number): Promise<[THREE.Texture, THREE.Texture, THREE.Texture]> {
  const [albedo, normal, rough] = await Promise.all([loadTexture(loader, set, 'albedo', anisotropy), loadTexture(loader, set, 'normal', anisotropy), loadTexture(loader, set, 'rough', anisotropy)]);
  m.map = albedo;
  m.normalMap = normal;
  m.roughnessMap = rough;
  m.needsUpdate = true;
  return [albedo, normal, rough];
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** RGBA pixels of `img` resampled to size x size. */
export function pixels(img: CanvasImageSource, size: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, size, size);
  return g.getImageData(0, 0, size, size).data;
}

/**
 * Two texture arrays over `sets` (one layer each, resampled to size x size): albedo RGB + roughness A (sRGB), and
 * tangent-space normal (linear). Shared between callers asking for the same arrays (see share()).
 */
export function loadPbrArrays(sets: readonly TextureSet[], size: number, anisotropy: number): Promise<[THREE.DataArrayTexture, THREE.DataArrayTexture]> {
  return share(`arrays:${sets.join(',')}:${size}:${anisotropy}`, () => buildPbrArrays(sets, size, anisotropy));
}

async function buildPbrArrays(sets: readonly TextureSet[], size: number, anisotropy: number): Promise<[THREE.DataArrayTexture, THREE.DataArrayTexture]> {
  const n = sets.length;
  const layer = size * size * 4;
  const alb = new Uint8Array(layer * n);
  const nrm = new Uint8Array(layer * n);
  await Promise.all(
    sets.map(async (set, i) => {
      const [a, r, nm] = await Promise.all([loadImage(textureUrl(set, 'albedo')), loadImage(textureUrl(set, 'rough')), loadImage(textureUrl(set, 'normal'))]);
      const pa = pixels(a, size);
      const pr = pixels(r, size);
      const pn = pixels(nm, size);
      const o = i * layer;
      for (let k = 0; k < layer; k += 4) {
        alb[o + k] = pa[k];
        alb[o + k + 1] = pa[k + 1];
        alb[o + k + 2] = pa[k + 2];
        alb[o + k + 3] = pr[k + 1];
        nrm[o + k] = pn[k];
        nrm[o + k + 1] = pn[k + 1];
        nrm[o + k + 2] = pn[k + 2];
        nrm[o + k + 3] = 255;
      }
    }),
  );
  const make = (data: Uint8Array, srgb: boolean): THREE.DataArrayTexture => {
    const t = new THREE.DataArrayTexture(data, size, size, n);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return [make(alb, true), make(nrm, false)];
}

/** Mean linear luminance of a texture image (normalises tinted albedo to ~1). */
export function meanLuminance(tex: THREE.Texture): number {
  const d = pixels(tex.image as CanvasImageSource, 16);
  let sum = 0;
  const lin = (c: number): number => Math.pow(c / 255, 2.2);
  for (let i = 0; i < d.length; i += 4) {
    sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
  }
  return Math.max(0.05, sum / (d.length / 4));
}

export function maxAnisotropy(renderer: THREE.WebGLRenderer): number {
  return Math.min(8, renderer.capabilities.getMaxAnisotropy());
}
