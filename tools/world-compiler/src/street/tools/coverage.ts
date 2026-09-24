/** Dev tool: ASCII coverage map of a tile glb's up-facing triangles around a point (npx tsx coverage.ts <glb> x z r). */
import { NodeIO } from '@gltf-transform/core';
const [file, px, pz, rr] = process.argv.slice(2);
const doc = await new NodeIO().read(file);
const [ox, , oz] = doc.getRoot().listNodes()[0].getTranslation();
const X = Number(px), Z = Number(pz), R = Number(rr ?? 6);
const N = 2 * R * 2;
const grid: string[][] = Array.from({ length: N }, () => Array(N).fill('.'));
const letters = new Map<string, string>();
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
  const name = p.getMaterial()?.getName() ?? '?';
  if (!letters.has(name)) letters.set(name, String.fromCharCode(65 + letters.size));
  const L = letters.get(name)!;
  const pos = p.getAttribute('POSITION')!.getArray()!;
  const idx = p.getIndices()!.getArray()!;
  for (let t = 0; t < idx.length; t += 3) {
    const vs = [idx[t], idx[t + 1], idx[t + 2]].map((v) => [pos[v * 3] + ox, pos[v * 3 + 2] + oz]);
    const [a, b, c] = vs;
    const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (Math.abs(ny) < 1e-9) continue;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = X - R + (i + 0.5) / 2, z = Z - R + (j + 0.5) / 2;
      const s1 = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
      const s2 = (c[0] - b[0]) * (z - b[1]) - (c[1] - b[1]) * (x - b[0]);
      const s3 = (a[0] - c[0]) * (z - c[1]) - (a[1] - c[1]) * (x - c[0]);
      if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) grid[j][i] = L;
    }
  }
}
console.log([...letters].map(([k, v]) => `${v}=${k}`).join(' '));
console.log(grid.map((r) => r.join('')).join('\n'));
