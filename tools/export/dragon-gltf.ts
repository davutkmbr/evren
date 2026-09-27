/**
 * Exports the procedural dragon for other runtimes (the Unreal game): skinned body and wing membranes with the shared
 * skeleton as a binary glTF, the runtime-baked textures as PNGs and the material parameters as JSON.
 *
 * Runs inside the dragon sandbox page (it needs the WebGL renderer that bakes the textures), driven by
 * scripts/snap.mjs with `result`:
 *   { "url": "/sandbox/dragon.html?pose=tuck&freeze=1",
 *     "eval": "import('/tools/export/dragon-gltf.ts').then((m) => m.exportDragon())", "result": "<file>.json" }
 * The result holds base64 files: { files: { "dragon.glb": ..., "body_albedo.png": ... }, meta: {...} }.
 *
 * Geometry notes: the custom per-vertex `aData` (x material id, y/w shader data, z breathing weight) is written as
 * TEXCOORD_2 (x, y) and TEXCOORD_3 (z, w), since glTF importers drop unknown attributes. The rider, tack and reins
 * are not exported (the Unreal rider is a MetaHuman).
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

interface EvrenWindow {
  __evren: { ctx: { renderer: THREE.WebGLRenderer; services: { get(name: string): unknown } } };
}

const EXPORTED = new Set(['dragon-body', 'dragon-membrane']);

/** Copies a (possibly render-target) texture into RGBA8 bytes, sRGB-encoded when the texture is sRGB. */
function readTexture(renderer: THREE.WebGLRenderer, tex: THREE.Texture): { width: number; height: number; data: Uint8Array } {
  const image = tex.image as { width: number; height: number };
  const width = image.width;
  const height = image.height;
  const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType, depthBuffer: false });
  const srgb = tex.colorSpace === THREE.SRGBColorSpace;
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D map; varying vec2 vUv;
      vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() { vec4 c = texture2D(map, vUv); gl_FragColor = vec4(${srgb ? 'toSrgb(c.rgb)' : 'c.rgb'}, c.a); }`,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const data = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, data);
  renderer.setRenderTarget(previous);
  target.dispose();
  material.dispose();
  quad.geometry.dispose();
  return { width, height, data };
}

/** RGBA8 rows (bottom-up, as WebGL reads them) to a base64 PNG, flipped to top-down like image files. */
async function toPng(width: number, height: number, data: Uint8Array): Promise<string> {
  const flipped = new Uint8ClampedArray(width * height * 4);
  const row = width * 4;
  for (let y = 0; y < height; y++) flipped.set(data.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.putImageData(new ImageData(flipped, width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Splits the 4-component custom attribute into two UV channels the importer keeps. */
function remapCustomData(geometry: THREE.BufferGeometry): void {
  const data = geometry.getAttribute('aData') as THREE.BufferAttribute | undefined;
  if (!data) return;
  const n = data.count;
  const a = new Float32Array(n * 2);
  const b = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    a[i * 2] = data.getX(i);
    a[i * 2 + 1] = data.getY(i);
    b[i * 2] = data.getZ(i);
    b[i * 2 + 1] = data.getW(i);
  }
  geometry.deleteAttribute('aData');
  geometry.setAttribute('uv2', new THREE.BufferAttribute(a, 2));
  geometry.setAttribute('uv3', new THREE.BufferAttribute(b, 2));
}

export async function exportDragon(): Promise<{ files: Record<string, string>; meta: Record<string, unknown> }> {
  const { ctx } = (window as unknown as EvrenWindow).__evren;
  const renderer = ctx.renderer;
  const rig = ctx.services.get('rig') as { root: THREE.Object3D; dimensions: Record<string, number> };
  const files: Record<string, string> = {};
  const textures: Record<string, { file: string; width: number; height: number; colorSpace: string }> = {};
  /** One file per texture object: the ORM texture serves roughness and AO and is written once. */
  const byTexture = new Map<string, string>();
  const materials: Record<string, Record<string, unknown>> = {};

  // Textures and material parameters of the exported meshes; the glb itself carries plain materials.
  const hidden: THREE.Object3D[] = [];
  const restoreMaterials: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];
  const restoreGeometry: Array<[THREE.Mesh, THREE.BufferGeometry]> = [];
  rig.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!EXPORTED.has(mesh.name)) {
      if (mesh.visible) hidden.push(mesh);
      mesh.visible = false;
    }
  });
  for (const name of EXPORTED) {
    const mesh = rig.root.getObjectByName(name) as THREE.SkinnedMesh;
    const source = mesh.material as THREE.MeshPhysicalMaterial;
    const key = name.replace('dragon-', '');
    const params: Record<string, unknown> = {
      type: source.type,
      color: source.color.getHexString(),
      roughness: source.roughness,
      metalness: source.metalness,
      doubleSided: source.side === THREE.DoubleSide,
      vertexColors: source.vertexColors,
    };
    for (const field of ['clearcoat', 'clearcoatRoughness', 'iridescence', 'iridescenceIOR', 'specularIntensity', 'transmission', 'thickness', 'opacity'] as const) {
      const value = (source as unknown as Record<string, unknown>)[field];
      if (typeof value === 'number') params[field] = value;
    }
    for (const slot of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const) {
      const tex = (source as unknown as Record<string, THREE.Texture | null>)[slot];
      if (!tex) continue;
      const shared = byTexture.get(tex.uuid);
      if (shared) {
        params[slot] = shared;
        continue;
      }
      const id = slot === 'roughnessMap' || slot === 'aoMap' ? `${key}_orm` : `${key}_${slot.replace('Map', '').replace('map', 'albedo')}`;
      byTexture.set(tex.uuid, id);
      if (!textures[id]) {
        const px = readTexture(renderer, tex);
        const file = `${id}.png`;
        files[file] = await toPng(px.width, px.height, px.data);
        textures[id] = { file, width: px.width, height: px.height, colorSpace: tex.colorSpace };
      }
      params[slot] = id;
    }
    materials[key] = params;
    restoreMaterials.push([mesh, mesh.material]);
    mesh.material = new THREE.MeshStandardMaterial({ name: `M_Dragon_${key}`, vertexColors: true });
    restoreGeometry.push([mesh, mesh.geometry]);
    mesh.geometry = mesh.geometry.clone();
    remapCustomData(mesh.geometry);
  }

  const exporter = new GLTFExporter();
  const glb = (await exporter.parseAsync(rig.root, { binary: true, onlyVisible: true })) as ArrayBuffer;
  files['dragon.glb'] = toBase64(new Uint8Array(glb));

  for (const [mesh, material] of restoreMaterials) mesh.material = material;
  for (const [mesh, geometry] of restoreGeometry) {
    (mesh.geometry as THREE.BufferGeometry).dispose();
    mesh.geometry = geometry;
  }
  for (const o of hidden) o.visible = true;

  const meta = {
    format: 1,
    frame: 'three.js: +Y up, the dragon faces -Z (forward), metres; glTF axes are the same',
    dimensions: rig.dimensions,
    textures,
    materials,
    customData: { TEXCOORD_2: 'aData.xy (x: material id, y: shader data)', TEXCOORD_3: 'aData.zw (z: breathing weight, w: shader data)' },
  };
  files['dragon.json'] = btoa(unescape(encodeURIComponent(JSON.stringify(meta, null, 1))));
  return { files, meta };
}
