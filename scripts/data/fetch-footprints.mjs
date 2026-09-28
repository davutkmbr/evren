#!/usr/bin/env node
/**
 * Building footprint and height sources of the shared world compiler (approved 2026-09-28; research:
 * seventeenskies-unreal .docs/assets/candidates/building-footprints.md), downloaded into data/footprints-src/
 * (gitignored) with checksums, licence texts and attribution strings:
 *
 *   node scripts/data/fetch-footprints.mjs [all|microsoft|ibb|ghsl|urban-atlas] [--force]
 *
 * - microsoft: Microsoft Global ML Building Footprints, the pinned release's level-9 quadkey tiles that touch the
 *   İstanbul province box (CLIP_BBOX of scripts/data/lib/osm-local.mjs), as Microsoft serves them (.csv.gz of GeoJSON
 *   lines, whole tiles). Every download is checked against the server's Content-MD5.
 * - ibb: İBB Açık Veri Portalı, Mahalle Bazlı Bina Sayıları (2017), through the portal's CKAN API.
 * - ghsl: GHS-BUILT-H R2023A ANBH 100 m, the tile over İstanbul; the GeoTIFF is unpacked next to the zip.
 * - urban-atlas: Copernicus Urban Atlas Building Block Height 2021 needs a free Copernicus account, so it is never
 *   downloaded here: once the owner places the GeoTIFF in data/footprints-src/urban-atlas/, this step records it.
 *
 * Each source must be approved in tools/assets/approved.json (an entry with its id and kind "data"), which also pins
 * its release and URL. Written: data/footprints-src/manifest.json (local paths) and the committed record of the
 * pinned inputs, data/footprints/sources.json, plus the licence texts in data/footprints/licences/ as downloaded (the
 * evidence of the terms at download time; Microsoft relicensed once already). The merge is
 * scripts/data/footprints-merge.ts; licence notes and attribution in data/footprints/LICENSE.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { ROOT } from '../../tools/world-compiler/lib/areas.mjs';
import { CLIP_BBOX } from './lib/osm-local.mjs';
import { download, getText, hashFile, htmlToText, quadkeysOf, unzipEntry } from './lib/footprints/download.mjs';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const STEP = args.find((a) => !a.startsWith('--')) ?? 'all';
const SRC = resolve(ROOT, 'data/footprints-src');
const PUB = resolve(ROOT, 'data/footprints');
const MANIFEST = resolve(SRC, 'manifest.json');
const SOURCES = resolve(PUB, 'sources.json');
const QUADKEY_LEVEL = 9;
const log = (m) => console.error(`[footprints] ${m}`);
const rel = (p) => relative(ROOT, p);

function approved(id) {
  const list = JSON.parse(readFileSync(resolve(ROOT, 'tools/assets/approved.json'), 'utf8')).assets;
  const entry = list.find((a) => a.id === id && a.kind === 'data');
  if (!entry) {
    throw new Error(`${id}: not approved (no entry with this id and kind "data" in tools/assets/approved.json)`);
  }
  return entry;
}

function readJson(file, fallback) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
}

/** Saves a licence text into data/footprints/licences/ and returns its record. */
async function licenceText(name, url, text) {
  const file = resolve(PUB, 'licences', name);
  mkdirSync(resolve(PUB, 'licences'), { recursive: true });
  const body = `${text.trim()}\n`;
  writeFileSync(file, body);
  return { file: rel(file), url, fetched: new Date().toISOString().slice(0, 10), ...(await hashFile(file)) };
}

async function microsoft() {
  const entry = approved('microsoft-building-footprints');
  const dir = resolve(SRC, 'microsoft', entry.release);
  const links = await download(entry.endpoint, resolve(dir, 'dataset-links.csv'), { force: FORCE, log });
  const rows = readFileSync(resolve(dir, 'dataset-links.csv'), 'utf8').trim().split('\n');
  const head = rows[0].split(',');
  const col = (name) => head.indexOf(name);
  const wanted = new Set(quadkeysOf(CLIP_BBOX, QUADKEY_LEVEL));
  const tiles = [];
  for (const line of rows.slice(1)) {
    const cells = line.split(',');
    if (wanted.has(cells[col('QuadKey')])) {
      tiles.push({ location: cells[col('Location')], quadkey: cells[col('QuadKey')], url: cells[col('Url')], size: cells[col('Size')], uploaded: cells[col('UploadDate')] });
    }
  }
  if (!tiles.length) {
    throw new Error(`no tile of ${entry.endpoint} touches the province box`);
  }
  log(`${tiles.length} of the ${wanted.size} level-${QUADKEY_LEVEL} tiles over the province have footprints in release ${entry.release}`);
  const files = [];
  for (const t of tiles.sort((a, b) => (a.quadkey < b.quadkey ? -1 : 1))) {
    const file = resolve(dir, `${t.location}-${t.quadkey}.csv.gz`);
    const d = await download(t.url, file, { force: FORCE, log });
    files.push({ ...t, file: rel(file), bytes: d.bytes, md5: d.md5, sha256: d.sha256, ...(d.contentMd5 ? { contentMd5: d.contentMd5 } : {}) });
  }
  // Microsoft's own licence statement, and the licence text itself (the CDLA's official plain-text release).
  const statement = (await getText('https://raw.githubusercontent.com/microsoft/GlobalMLBuildingFootprints/main/README.md')).match(/## License\s+([^\n]+)/)?.[1]?.trim() ?? null;
  if (!statement || !/CDLA Permissive 2\.0/i.test(statement)) {
    throw new Error(`Microsoft's README no longer states CDLA Permissive 2.0 ("${statement}"): stop and ask the owner`);
  }
  const text = await getText('https://raw.githubusercontent.com/Community-Data-License-Agreements/Releases/main/CDLA-Permissive-2.0.txt');
  const licence = await licenceText('CDLA-Permissive-2.0.txt', 'https://cdla.dev/permissive-2-0/', text);
  return {
    id: entry.id,
    release: entry.release,
    licence: entry.licence,
    licenceStatement: statement,
    licenceText: licence,
    attribution: entry.attribution,
    index: { url: entry.endpoint, file: rel(resolve(dir, 'dataset-links.csv')), bytes: links.bytes, md5: links.md5, sha256: links.sha256 },
    quadkeyLevel: QUADKEY_LEVEL,
    tiles: files,
  };
}

async function ibb() {
  const entry = approved('ibb-mahalle-bina-sayilari');
  const meta = JSON.parse(await getText(entry.endpoint)).result;
  const res = meta.resources.find((r) => /csv/i.test(r.format));
  if (!res) {
    throw new Error(`${entry.endpoint}: no CSV resource`);
  }
  const file = resolve(SRC, 'ibb', basename(new URL(res.url).pathname));
  const d = await download(res.url, file, { force: FORCE, log });
  const page = await getText(entry.licence_url);
  const licence = await licenceText('IBB-Open-Data-License-1.0.txt', entry.licence_url, htmlToText(page));
  return {
    id: entry.id,
    dataset: meta.title,
    publisher: meta.organization?.title ?? null,
    resource: { name: res.name, url: res.url, created: res.created, lastModified: res.last_modified, file: rel(file), bytes: d.bytes, md5: d.md5, sha256: d.sha256, encoding: 'windows-1254', separator: ';' },
    metadataModified: meta.metadata_modified,
    licence: entry.licence,
    licencePortal: { id: meta.license_id, title: meta.license_title, url: meta.license_url },
    licenceText: licence,
    attribution: entry.attribution,
  };
}

async function ghsl() {
  const entry = approved('ghs-built-h-r2023a');
  const dir = resolve(SRC, 'ghsl');
  const zipFile = resolve(dir, basename(new URL(entry.endpoint).pathname));
  const d = await download(entry.endpoint, zipFile, { force: FORCE, log });
  const tif = unzipEntry(readFileSync(zipFile), /\.tif$/i);
  const tifFile = resolve(dir, basename(tif.name));
  writeFileSync(tifFile, tif.data);
  const copyright = await getText('https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_BUILT_H_GLOBE_R2023A/copyright.txt');
  const licence = await licenceText('GHSL-copyright.txt', 'https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_BUILT_H_GLOBE_R2023A/copyright.txt', copyright);
  return {
    id: entry.id,
    tile: entry.source_id,
    zip: { url: entry.endpoint, file: rel(zipFile), bytes: d.bytes, md5: d.md5, sha256: d.sha256 },
    tif: { file: rel(tifFile), ...(await hashFile(tifFile)) },
    doi: '10.2905/85005901-3A49-48DD-9D19-6261354F56FE',
    licence: entry.licence,
    licenceText: licence,
    attribution: entry.attribution,
  };
}

async function urbanAtlas() {
  const entry = approved('urban-atlas-bbh-2021');
  const dir = resolve(SRC, 'urban-atlas');
  mkdirSync(dir, { recursive: true });
  const tif = readdirSync(dir).find((f) => /\.tif{1,2}$/i.test(f));
  if (!tif) {
    log(`urban-atlas: pending. ${entry.manual_reason}. Expected file: ${entry.source_id}.tif (EPSG:3035 COG, 10 m).`);
    return { id: entry.id, status: 'pending', expected: `${rel(dir)}/${entry.source_id}.tif`, reason: entry.manual_reason, licence: entry.licence, attribution: entry.attribution };
  }
  return { id: entry.id, status: 'present', file: rel(resolve(dir, tif)), ...(await hashFile(resolve(dir, tif))), licence: entry.licence, attribution: entry.attribution };
}

const STEPS = { microsoft, ibb, ghsl, 'urban-atlas': urbanAtlas };
if (STEP !== 'all' && !STEPS[STEP]) {
  console.error('usage: node scripts/data/fetch-footprints.mjs [all|microsoft|ibb|ghsl|urban-atlas] [--force]');
  process.exit(1);
}
mkdirSync(SRC, { recursive: true });
const manifest = readJson(MANIFEST, { sources: {} });
for (const [name, run] of Object.entries(STEPS)) {
  if (STEP === 'all' || STEP === name) {
    manifest.sources[name] = { ...(await run()), recorded: new Date().toISOString() };
  }
}
manifest.updated = new Date().toISOString();
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
// The committed record: the same, without the timestamps of this machine's run.
const pinned = JSON.parse(JSON.stringify(manifest.sources, (k, v) => (k === 'recorded' || k === 'cached' ? undefined : v)));
writeFileSync(
  SOURCES,
  JSON.stringify(
    {
      $comment: 'Pinned inputs of the building merge (scripts/data/footprints-merge.ts), written by scripts/data/fetch-footprints.mjs: what was downloaded, from where, with checksums. The raw files live in data/footprints-src/ (gitignored). Licence notes: data/footprints/LICENSE.md.',
      sources: pinned,
    },
    null,
    1,
  ) + '\n',
);
log(`manifest: ${rel(MANIFEST)}; pinned inputs: ${rel(SOURCES)}`);
