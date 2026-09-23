#!/usr/bin/env node
/**
 * Downloads the CC0 PBR texture sets used by the OSM prototype (src/world/osm) from Poly Haven (1k/2k JPG: albedo,
 * OpenGL normal, roughness) into public/textures/<name>/{albedo,normal,rough}.jpg and writes public/textures/LICENSES.md.
 *
 *   node scripts/data/fetch-textures.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'public/textures');

/** Local name -> Poly Haven asset id, real-world size of one texture repeat (m) and download resolution. */
const SETS = {
  plaster: { id: 'plastered_wall', meters: 2, res: '2k' },
  plaster_painted: { id: 'painted_plaster_wall', meters: 2, res: '1k' },
  stone: { id: 'white_sandstone_blocks_02', meters: 2, res: '1k' },
  concrete: { id: 'concrete_wall_008', meters: 2.7, res: '1k' },
  brick: { id: 'red_brick_03', meters: 1, res: '1k' },
  roof_tiles: { id: 'clay_roof_tiles_02', meters: 2.5, res: '1k' },
  asphalt: { id: 'asphalt_01', meters: 2.08, res: '1k' },
  cobble: { id: 'cobblestone_floor_04', meters: 1.5, res: '1k' },
  sidewalk: { id: 'pavement_03', meters: 2, res: '1k' },
  granite: { id: 'large_grey_tiles', meters: 3, res: '1k' },
  yard: { id: 'concrete_floor_worn_001', meters: 3, res: '1k' },
};
const MAPS = { albedo: 'Diffuse', normal: 'nor_gl', rough: 'Rough' };

async function main() {
  const rows = [];
  let total = 0;
  for (const [name, set] of Object.entries(SETS)) {
    rows.push(`| \`${name}/\` | [${set.id}](https://polyhaven.com/a/${set.id}) | ${set.res} | ${set.meters} m | CC0 1.0 |`);
    const stamp = resolve(OUT, name, 'source.txt');
    if (existsSync(stamp) && readFileSync(stamp, 'utf8') === `${set.id}@${set.res}`) {
      continue;
    }
    const files = await (await fetch(`https://api.polyhaven.com/files/${set.id}`)).json();
    mkdirSync(resolve(OUT, name), { recursive: true });
    for (const [local, key] of Object.entries(MAPS)) {
      const url = files[key]?.[set.res]?.jpg?.url;
      if (!url || !url.startsWith('https://dl.polyhaven.org/')) {
        throw new Error(`No ${key} ${set.res} jpg for ${set.id}`);
      }
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      writeFileSync(resolve(OUT, name, `${local}.jpg`), buf);
      total += buf.length;
    }
    writeFileSync(stamp, `${set.id}@${set.res}`);
  }
  const md = `# Texture licences

All textures in this folder are **CC0 1.0 (public domain)** from [Poly Haven](https://polyhaven.com/license),
downloaded as JPG (albedo = Diffuse, normal = OpenGL normal \`nor_gl\`, rough = Roughness) by
\`scripts/data/fetch-textures.mjs\`.

| Folder | Source | Resolution | Repeat size | Licence |
| --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
  writeFileSync(resolve(OUT, 'LICENSES.md'), md);
  console.log(JSON.stringify({ ok: true, sets: Object.keys(SETS).length, bytes: total }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
