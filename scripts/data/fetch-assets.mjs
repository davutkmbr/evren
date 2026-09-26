#!/usr/bin/env node
/**
 * Downloads the approved external assets listed in tools/assets/approved.json into the gitignored source cache
 * assets-src/<kind>/<id>/, then writes .docs/assets/approved-assets.md (what is cached) and
 * .docs/assets/manual-downloads.md (what has to be downloaded by hand).
 *
 *   node scripts/data/fetch-assets.mjs [--dry-run] [--budget-mb=600] [--kind=sound]
 *
 * - Poly Haven (api.polyhaven.com): texture maps (Diffuse, nor_gl, Rough, AO, Displacement as JPG), the glTF with its
 *   textures, or an HDRI sky (kind 'hdri', Radiance .hdr), at the requested resolution.
 * - ambientCG (API v2 full_json): the <RES>-JPG zip, extracted with the system `unzip`.
 * - Freesound: the public HQ preview (OGG) at the entry's download_url; the originals need a login.
 * - Sketchfab (login-gated) and cgbookcase (no direct link): listed as a checklist, never downloaded.
 *
 * Downloads run one at a time with retries, and files that already exist with the expected size are skipped. If the
 * planned cache exceeds the budget, every asset is fetched one resolution step lower. public/ is never touched.
 * --kind limits the downloads to one asset kind; the generated docs still cover the whole manifest.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = resolve(ROOT, 'tools/assets/approved.json');
const CACHE = resolve(ROOT, 'assets-src');
const DOC_CACHED = resolve(ROOT, '.docs/assets/approved-assets.md');
const DOC_MANUAL = resolve(ROOT, '.docs/assets/manual-downloads.md');
const HEADERS = { 'User-Agent': 'seventeen-skies-asset-fetch/1.0 (+https://github.com/davutkmbr/evren)' };
const RES_STEPS = ['1k', '2k', '4k', '8k'];
const PH_MAPS_REQUIRED = ['Diffuse', 'nor_gl', 'Rough'];
const PH_MAPS_OPTIONAL = ['AO', 'Displacement'];
const ATTEMPTS = 4;
const PAUSE_MS = 250;
const STAMP = 'source.json';

const SOURCE_LABEL = {
  polyhaven: 'Poly Haven',
  ambientcg: 'ambientCG',
  freesound: 'Freesound',
  cgbookcase: 'cgbookcase',
  sketchfab: 'Sketchfab',
};
const LICENCE_LABEL = { 'CC0-1.0': 'CC0 1.0', 'CC-BY-4.0': 'CC BY 4.0' };
const MANUAL_FORMAT = {
  sketchfab: 'Download 3D Model → glTF (the zip includes Sketchfab\'s `license.txt`); extract the whole zip',
  cgbookcase: 'pick the 2K resolution, then Download; extract the whole zip',
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyKind = args.find((a) => a.startsWith('--kind='))?.split('=')[1];
// 400 MB held the S1 textures and props; the six 4k HDRI skies of the realism pass add about 110 MB.
const budgetMb = Number(args.find((a) => a.startsWith('--budget-mb='))?.split('=')[1] ?? 600);

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;
const lowerRes = (res) => (RES_STEPS.includes(res) ? RES_STEPS[Math.max(0, RES_STEPS.indexOf(res) - 1)] : res);
const assetDir = (asset) => join(CACHE, asset.kind, asset.id);
const rel = (path) => relative(ROOT, path).split('\\').join('/');

async function withRetry(label, fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= ATTEMPTS) {
        throw new Error(`${label}: ${err.message}`);
      }
      const wait = 2000 * 2 ** (attempt - 1);
      console.warn(`    retry ${attempt}/${ATTEMPTS - 1} in ${wait / 1000}s: ${label} (${err.message})`);
      await sleep(wait);
    }
  }
}

async function getJson(url) {
  return withRetry(url, async () => {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  });
}

function md5File(path) {
  return new Promise((ok, fail) => {
    const hash = createHash('md5');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => ok(hash.digest('hex')))
      .on('error', fail);
  });
}

function dirBytes(dir) {
  if (!existsSync(dir)) {
    return 0;
  }
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? dirBytes(path) : statSync(path).size;
  }
  return total;
}

function readStamp(asset) {
  const path = join(assetDir(asset), STAMP);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

function hasManualFiles(asset) {
  const dir = assetDir(asset);
  return existsSync(dir) && readdirSync(dir).some((name) => name !== STAMP && !name.startsWith('.'));
}

/** Rejects paths from an API response that would escape the asset folder. */
function safePath(path) {
  const clean = normalize(path);
  if (isAbsolute(clean) || clean.startsWith('..')) {
    throw new Error(`unsafe path in API response: ${path}`);
  }
  return clean;
}

function checkHost(url, prefix) {
  if (!url?.startsWith(prefix)) {
    throw new Error(`unexpected download URL ${url} (expected ${prefix}…)`);
  }
  return url;
}

const polyHavenFiles = new Map();

async function planPolyHaven(asset, res) {
  if (!polyHavenFiles.has(asset.source_id)) {
    polyHavenFiles.set(asset.source_id, await getJson(`https://api.polyhaven.com/files/${asset.source_id}`));
  }
  const files = polyHavenFiles.get(asset.source_id);
  const item = (file, path) => ({
    url: checkHost(file.url, 'https://dl.polyhaven.org/'),
    path: safePath(path ?? basename(new URL(file.url).pathname)),
    size: file.size,
    md5: file.md5,
  });
  if (asset.kind === 'hdri') {
    const hdr = files.hdri?.[res]?.hdr;
    if (!hdr) {
      throw new Error(`no ${res} HDR for ${asset.source_id}`);
    }
    return [item(hdr)];
  }
  if (asset.kind === 'model') {
    const gltf = files.gltf?.[res]?.gltf;
    if (!gltf) {
      throw new Error(`no ${res} glTF for ${asset.source_id}`);
    }
    return [item(gltf), ...Object.entries(gltf.include ?? {}).map(([path, file]) => item(file, path))];
  }
  const items = [];
  for (const map of [...PH_MAPS_REQUIRED, ...PH_MAPS_OPTIONAL]) {
    const file = files[map]?.[res]?.jpg;
    if (file) {
      items.push(item(file));
    } else if (PH_MAPS_REQUIRED.includes(map)) {
      throw new Error(`no ${map} ${res} JPG for ${asset.source_id}`);
    }
  }
  return items;
}

let ambientCgIndex = null;

async function planAmbientCg(asset, res, assets) {
  if (!ambientCgIndex) {
    const ids = assets.filter((a) => a.source === 'ambientcg').map((a) => a.source_id);
    const json = await getJson(
      `https://ambientcg.com/api/v2/full_json?id=${ids.join(',')}&include=downloadData&limit=${ids.length}`,
    );
    ambientCgIndex = new Map(json.foundAssets.map((a) => [a.assetId, a]));
  }
  const attribute = `${res.toUpperCase()}-JPG`;
  const zip = ambientCgIndex
    .get(asset.source_id)
    ?.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads?.find((d) => d.attribute === attribute);
  if (!zip) {
    throw new Error(`no ${attribute} zip for ${asset.source_id}`);
  }
  return [
    { url: checkHost(zip.downloadLink, 'https://ambientcg.com/'), path: safePath(zip.fileName), size: zip.size, zip: true },
  ];
}

async function planFreesound(asset) {
  const url = checkHost(asset.download_url, 'https://cdn.freesound.org/previews/');
  const size = await withRetry(url, async () => {
    const res = await fetch(url, { method: 'HEAD', headers: HEADERS });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return Number(res.headers.get('content-length')) || undefined;
  });
  return [{ url, path: safePath(basename(new URL(url).pathname)), size }];
}

async function planAll(assets, pickRes) {
  const plans = [];
  for (const asset of assets) {
    const res = pickRes(asset);
    try {
      const items =
        asset.source === 'polyhaven'
          ? await planPolyHaven(asset, res)
          : asset.source === 'ambientcg'
            ? await planAmbientCg(asset, res, assets)
            : asset.source === 'freesound'
              ? await planFreesound(asset)
              : null;
      if (!items) {
        throw new Error(`no automatic download for source "${asset.source}"`);
      }
      plans.push({ asset, res, items, bytes: items.reduce((sum, i) => sum + (i.size ?? 0), 0) });
    } catch (err) {
      plans.push({ asset, res, items: [], bytes: 0, error: err.message });
    }
  }
  return plans;
}

async function downloadFile(item, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  await withRetry(item.url, async () => {
    const res = await fetch(item.url, { headers: HEADERS });
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}`);
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
    if (item.md5) {
      const size = statSync(part).size;
      if (size !== item.size) {
        throw new Error(`size ${size} differs from the expected ${item.size}`);
      }
      if ((await md5File(part)) !== item.md5) {
        throw new Error('md5 mismatch');
      }
    }
    if (item.zip) {
      execFileSync('unzip', ['-tqq', part], { stdio: 'pipe' });
    }
  });
  renameSync(part, dest);
}

/** Downloads one asset; returns the number of bytes fetched (0 when everything was already cached). */
async function fetchAsset(plan) {
  const { asset, res, items } = plan;
  const dir = assetDir(asset);
  const stamp = readStamp(asset);
  const stampValid =
    stamp?.resolution === res && stamp.files?.every((file) => existsSync(join(dir, file)));
  if (items.some((i) => i.zip) && stampValid) {
    return 0;
  }
  let fetched = 0;
  const files = [];
  for (const item of items) {
    const dest = join(dir, item.path);
    if (item.zip) {
      await downloadFile(item, dest);
      fetched += statSync(dest).size;
      const listed = execFileSync('unzip', ['-Z1', dest], { encoding: 'utf8' })
        .split('\n')
        .filter((name) => name && !name.endsWith('/'))
        .map(safePath);
      execFileSync('unzip', ['-o', '-qq', dest, '-d', dir], { stdio: 'pipe' });
      rmSync(dest);
      files.push(...listed);
    } else {
      if (!(existsSync(dest) && statSync(dest).size === item.size)) {
        await downloadFile(item, dest);
        fetched += item.size;
        await sleep(PAUSE_MS);
      }
      files.push(item.path);
    }
  }
  if (fetched > 0 || !stampValid) {
    const record = {
      id: asset.id,
      source: asset.source,
      source_id: asset.source_id,
      url: asset.url,
      licence: asset.licence,
      author: asset.author,
      resolution: res,
      fetched: new Date().toISOString(),
      files: files.map((f) => f.split('\\').join('/')).sort(),
    };
    writeFileSync(join(dir, STAMP), `${JSON.stringify(record, null, 2)}\n`);
  }
  return fetched;
}

const cell = (text) => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');

function conditionsText(asset) {
  return asset.conditions.length ? asset.conditions.map(cell).join('; ') : '–';
}

function writeCachedDoc(manifest, rows, pending, downgraded) {
  const total = rows.reduce((sum, r) => sum + r.bytes, 0);
  const table = rows.map(({ asset, res, bytes }) =>
    [
      cell(asset.name),
      asset.kind,
      `[${SOURCE_LABEL[asset.source]}](${asset.url})`,
      `[${LICENCE_LABEL[asset.licence] ?? asset.licence}](${asset.licence_url})`,
      cell(asset.author),
      asset.attribution ? cell(asset.attribution) : 'not required (CC0)',
      `\`${rel(assetDir(asset))}/\``,
      res ?? 'as published',
      mb(bytes),
      conditionsText(asset),
    ].join(' | '),
  );
  const pendingTable = pending.map((asset) =>
    [
      cell(asset.name),
      `[${SOURCE_LABEL[asset.source]}](${asset.url})`,
      LICENCE_LABEL[asset.licence] ?? asset.licence,
      cell(asset.author),
      `\`${rel(assetDir(asset))}/\``,
    ].join(' | '),
  );
  const decisions = manifest.decisions.map((d) => `[${basename(d.split('#')[0])}](${d.replace(/^\.docs\/assets\//, '')})`);
  const md = `# Approved external assets

Generated by \`scripts/data/fetch-assets.mjs\` from [\`tools/assets/approved.json\`](../../tools/assets/approved.json).
Edit the manifest, not this file. The user approved these assets on ${manifest.approved}: see the Decision sections in
${decisions.slice(0, -1).join(',\n')} and\n${decisions.at(-1)}.

- Raw files are cached in the gitignored \`assets-src/<kind>/<id>/\` folders; each downloaded one has a \`source.json\`.
  The street compiler copies optimised textures and models into its build output, and \`scripts/audio/prep-sounds.mjs\`
  encodes the sounds into \`public/audio/\`. Each integrated asset is recorded in \`public/textures/LICENSES.md\`,
  \`public/models/LICENSES.md\` or \`public/audio/LICENSES.md\`.
- Every condition must be met before the asset is used in any build.
- Cached: **${rows.length} assets, ${mb(total)}**. Waiting for manual download: **${pending.length}** (see
  [manual-downloads.md](manual-downloads.md)).${
    downgraded
      ? `\n- The planned cache exceeded ${budgetMb} MB, so every asset was fetched one resolution step below the request.`
      : ''
  }

## Cached

| Asset | Kind | Source | Licence | Author | Attribution | Cached in | Resolution | Size | Conditions |
|---|---|---|---|---|---|---|---|---|---|
${table.map((r) => `| ${r} |`).join('\n')}
${
  pending.length
    ? `
## Waiting for manual download

| Asset | Source | Licence | Author | Target folder |
|---|---|---|---|---|
${pendingTable.map((r) => `| ${r} |`).join('\n')}
`
    : ''
}`;
  writeFileSync(DOC_CACHED, md);
}

function writeManualDoc(manual) {
  const items = manual.map(
    (asset) => `- [${hasManualFiles(asset) ? 'x' : ' '}] **${asset.name}** by ${asset.author} (${
      LICENCE_LABEL[asset.licence] ?? asset.licence
    })
  - Link: <${asset.url}>
  - Download: ${MANUAL_FORMAT[asset.source]}
  - Target folder: \`${rel(assetDir(asset))}/\`
  - Conditions: ${asset.conditions.length ? asset.conditions.join('; ') : 'none'}`,
  );
  const md = `# Manual downloads

Generated by \`scripts/data/fetch-assets.mjs\` from [\`tools/assets/approved.json\`](../../tools/assets/approved.json).
These approved assets have no public direct download, so the script does not fetch them and never logs in or uses
tokens:

- **Sketchfab** requires a logged-in account for every download.
- **cgbookcase** serves its zips only through the download thank-you page; its CDN refuses direct requests (HTTP 403).

For each item: open the link, download the format named below and extract it into the target folder. Then run
\`node scripts/data/fetch-assets.mjs\` again: it ticks the item here and records it in
[approved-assets.md](approved-assets.md). Meet every condition before the asset is used in any build.

${items.join('\n')}
`;
  writeFileSync(DOC_MANUAL, md);
}

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const apiAssets = manifest.assets.filter((a) => a.download === 'api' && (!onlyKind || a.kind === onlyKind));
  const manual = manifest.assets.filter((a) => a.download === 'manual');

  let plans = await planAll(apiAssets, (a) => a.resolution);
  let planned = plans.reduce((sum, p) => sum + p.bytes, 0);
  let downgraded = false;
  console.log(`Planned: ${apiAssets.length} assets, ${mb(planned)} at the requested resolutions.`);
  if (planned > budgetMb * 1e6) {
    plans = await planAll(apiAssets, (a) => lowerRes(a.resolution));
    planned = plans.reduce((sum, p) => sum + p.bytes, 0);
    downgraded = true;
    console.log(`Over the ${budgetMb} MB budget: fetching one resolution step lower (${mb(planned)}).`);
  }

  if (dryRun) {
    for (const p of plans) {
      console.log(`  ${p.asset.kind}/${p.asset.id} ${p.res}: ${p.error ?? `${p.items.length} files, ${mb(p.bytes)}`}`);
    }
    console.log(`Manual: ${manual.length} assets.`);
    return;
  }

  const failures = [];
  let fetchedBytes = 0;
  for (const [index, plan] of plans.entries()) {
    const label = `[${index + 1}/${plans.length}] ${plan.asset.kind}/${plan.asset.id} ${plan.res}`;
    if (plan.error) {
      failures.push({ id: plan.asset.id, error: plan.error });
      console.log(`${label}: FAILED (${plan.error})`);
      continue;
    }
    try {
      const fetched = await fetchAsset(plan);
      fetchedBytes += fetched;
      console.log(`${label}: ${fetched ? `downloaded ${mb(fetched)}` : 'already cached'}`);
    } catch (err) {
      failures.push({ id: plan.asset.id, error: err.message });
      console.log(`${label}: FAILED (${err.message})`);
    }
  }

  const rows = [];
  for (const asset of manifest.assets) {
    const stamp = asset.download === 'api' ? readStamp(asset) : null;
    if (stamp || (asset.download === 'manual' && hasManualFiles(asset))) {
      rows.push({ asset, res: stamp?.resolution ?? null, bytes: dirBytes(assetDir(asset)) });
    }
  }
  const pending = manual.filter((a) => !hasManualFiles(a));
  writeCachedDoc(manifest, rows, pending, downgraded);
  writeManualDoc(manual);

  console.log(`\nManual downloads (${pending.length} pending, written to ${rel(DOC_MANUAL)}):`);
  for (const asset of manual) {
    console.log(`  [${hasManualFiles(asset) ? 'x' : ' '}] ${asset.name} (${SOURCE_LABEL[asset.source]})`);
    console.log(`      ${asset.url}`);
    console.log(`      -> ${rel(assetDir(asset))}/`);
  }

  const cacheBytes = rows.reduce((sum, r) => sum + r.bytes, 0);
  console.log(
    `\n${JSON.stringify({
      ok: failures.length === 0,
      cached: rows.length,
      cacheSize: mb(cacheBytes),
      downloadedThisRun: mb(fetchedBytes),
      downgraded,
      manualPending: pending.length,
      failures,
    })}`,
  );
  if (failures.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
