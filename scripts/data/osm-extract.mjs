#!/usr/bin/env node
/**
 * Local OpenStreetMap source for the fetch scripts (fetch-osm.mjs, fetch-walls.mjs, osm-regions.mjs):
 *
 *   node scripts/data/osm-extract.mjs download   # Geofabrik Turkey extract -> data/osm-src/ (md5 verified)
 *   node scripts/data/osm-extract.mjs index      # clip İstanbul + build data/osm-src/istanbul.osmidx (~1-2 min)
 *   node scripts/data/osm-extract.mjs all        # both
 *   node scripts/data/osm-extract.mjs info       # index date, clip and counts
 *
 * data/osm-src/ is gitignored. The query layer is scripts/data/lib/osm-local.mjs.
 * Data © OpenStreetMap contributors, ODbL 1.0; source and licence notes in data/osm/LICENSE.md.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buildIndex, INDEX_FILE, openIndex, SOURCE_PBF, SRC_DIR } from './lib/osm-local.mjs';

const URL_PBF = 'https://download.geofabrik.de/europe/turkey-latest.osm.pbf';
const cmd = process.argv[2];

async function md5(path) {
  const h = createHash('md5');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

async function download() {
  mkdirSync(SRC_DIR, { recursive: true });
  const md5Res = await fetch(`${URL_PBF}.md5`);
  if (!md5Res.ok) throw new Error(`md5: HTTP ${md5Res.status}`);
  const expected = (await md5Res.text()).trim().split(/\s+/)[0];
  const res = await fetch(URL_PBF);
  if (!res.ok) throw new Error(`pbf: HTTP ${res.status}`);
  const tmp = `${SOURCE_PBF}.part`;
  console.error(`[osm-extract] downloading ${res.url} (${(Number(res.headers.get('content-length')) / 1e6).toFixed(0)} MB)`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  const got = await md5(tmp);
  if (got !== expected) throw new Error(`md5 mismatch: got ${got}, expected ${expected}`);
  renameSync(tmp, SOURCE_PBF);
  writeFileSync(`${SOURCE_PBF}.md5`, `${expected}  turkey-latest.osm.pbf\n`);
  writeFileSync(resolveSrc('SOURCE.json'), JSON.stringify({ url: URL_PBF, resolved: res.url, md5: expected, lastModified: res.headers.get('last-modified'), downloaded: new Date().toISOString() }, null, 1) + '\n');
  console.error(`[osm-extract] ${SOURCE_PBF}: md5 ${got} ok`);
}

const resolveSrc = (f) => `${SRC_DIR}/${f}`;

async function index() {
  if (!existsSync(SOURCE_PBF)) throw new Error(`${SOURCE_PBF} missing: run \`node scripts/data/osm-extract.mjs download\``);
  if (existsSync(`${SOURCE_PBF}.md5`)) {
    const expected = readFileSync(`${SOURCE_PBF}.md5`, 'utf8').trim().split(/\s+/)[0];
    const got = await md5(SOURCE_PBF);
    if (got !== expected) throw new Error(`${SOURCE_PBF}: md5 ${got} does not match ${expected}`);
  }
  const meta = await buildIndex();
  console.log(JSON.stringify({ ok: true, index: INDEX_FILE, ...meta }, null, 1));
}

function info() {
  const t = Date.now();
  const idx = openIndex();
  console.log(JSON.stringify({ index: INDEX_FILE, loadMs: Date.now() - t, ...idx.meta, layout: undefined }, null, 1));
}

if (cmd === 'download') await download();
else if (cmd === 'index') await index();
else if (cmd === 'all') {
  await download();
  await index();
} else if (cmd === 'info') info();
else {
  console.error('usage: node scripts/data/osm-extract.mjs download | index | all | info');
  process.exit(1);
}
