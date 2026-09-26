#!/usr/bin/env node
/**
 * In-game perch audit (phase 03): every perch in the running game, in each perch camera, measured against the
 * rendered scene (scripts/lib/perch-measure.mjs) and shot through snap.mjs (the machine-wide GPU queue).
 *
 *   node scripts/perch-audit.mjs                                   # every perch, orbit/fixed/rider at 16:00
 *   node scripts/perch-audit.mjs --hours 16,19.5 --modes orbit,fixed --perch galata-kulesi,kiz-kulesi
 *   node scripts/perch-audit.mjs --out .shots/perches/audit/after --sheet-only
 *   EVREN_CHROME=<chromium> node scripts/perch-audit.mjs --timeout 420000   # software rendering (no GPU)
 *
 * Writes <out>/<perch>-<mode>-<hour>.jpg + .json, <out>/audit.md (table) and <out>/sheet-<hour>.jpg (contact sheet:
 * one row per perch, one column per camera). Perch ids come from src/world/perches/data.ts unless given.
 * Requires the dev server (port 5199). Fails (exit 1) when a perch breaks the in-game thresholds below.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { perchMeasure } from './lib/perch-measure.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : def);
const OUT = resolve(opt('out', '.shots/perches/audit/latest'));
const HOURS = opt('hours', '16').split(',').map(Number);
const MODES = opt('modes', 'orbit,fixed,rider').split(',');
/** Page load timeout (ms): raise it on slow software rendering (EVREN_CHROME / SwiftShader loads take minutes). */
const TIMEOUT = Number(opt('timeout', '90000'));
/**
 * In-game thresholds: dragon hidden, camera view blocked within 60 m, perch clearance over its rendered neighbours
 * (-1: parts of the perch's own structure level with the grip, such as the other leg of a bridge tower, are fine).
 */
const LIMITS = { dragonOccluded: 0.1, viewBlocked60: 0.15, clearNeighbours: -1 };

function perchIds() {
  const given = opt('perch', null);
  if (given) {
    return given.split(',');
  }
  const src = readFileSync(new URL('../src/world/perches/data.ts', import.meta.url), 'utf8');
  return [...src.matchAll(/^\s+id: '([^']+)',$/gm)].map((m) => m[1]);
}

function runShots(ids) {
  mkdirSync(OUT, { recursive: true });
  const fn = perchMeasure.toString();
  const jobs = [];
  for (const id of ids) {
    for (const h of HOURS) {
      for (const m of MODES) {
        const base = join(OUT, `${id}-${m}-${h}`);
        jobs.push({ url: `/?autostart=1&t=${h}`, w: 1280, h: 720, settle: 700, timeout: TIMEOUT, eval: `(${fn})(${JSON.stringify(id)}, ${JSON.stringify(m)}, ${h})`, out: `${base}.jpg`, result: `${base}.json` });
      }
    }
  }
  // A page reload in the middle of a shot (the shared dev server's HMR) leaves an empty result: retry those once.
  for (let pass = 0; pass < 2 && jobs.length > 0; pass++) {
    const batch = join(OUT, 'batch.json');
    writeFileSync(batch, JSON.stringify(jobs));
    const r = spawnSync(process.execPath, [new URL('./snap.mjs', import.meta.url).pathname, '--batch', batch], { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28 });
    if (r.status !== 0) {
      console.error(`snap.mjs exited with ${r.status}`);
    }
    jobs.splice(0, jobs.length, ...jobs.filter((j) => !validResult(j.result)));
  }
}

function validResult(file) {
  try {
    const r = JSON.parse(readFileSync(file, 'utf8'));
    return !!r && r.phase === 'perched';
  } catch {
    return false;
  }
}

function readResults() {
  return readdirSync(OUT)
    .filter((f) => f.endsWith('.json') && f !== 'batch.json')
    .map((f) => JSON.parse(readFileSync(join(OUT, f), 'utf8')))
    .filter((r) => r && r.id);
}

function table(results) {
  const rows = ['| perch | cam | h | above ground | ring 40 m top | clears | dragon hidden | view blocked 60 m | eye cone 60 m | dragon on screen (x, y, h) |', '|---|---|---|---|---|---|---|---|---|---|'];
  const fails = [];
  for (const r of results.sort((a, b) => a.id.localeCompare(b.id) || a.mode.localeCompare(b.mode) || a.hour - b.hour)) {
    const s = r.dragonScreen ?? {};
    rows.push(`| ${r.id} | ${r.mode} | ${r.hour} | ${r.aboveGround} | ${r.ring40Top} | ${r.clearNeighbours} | ${r.dragonOccluded} | ${r.viewBlocked60} | ${r.eyeCone60} | ${s.x}, ${s.y}, ${s.h} |`);
    if (r.mode !== 'rider' && r.dragonOccluded > LIMITS.dragonOccluded) {
      fails.push(`${r.id} ${r.mode}: dragon ${r.dragonOccluded * 100}% hidden (${Object.keys(r.blockers ?? {}).join(', ')})`);
    }
    if (r.viewBlocked60 > LIMITS.viewBlocked60) {
      fails.push(`${r.id} ${r.mode}: view ${r.viewBlocked60 * 100}% blocked within 60 m (${Object.keys(r.viewBlockers ?? {}).join(', ')})`);
    }
    if (r.mode === MODES[0] && r.clearNeighbours < LIMITS.clearNeighbours) {
      fails.push(`${r.id}: ${-r.clearNeighbours} m under a neighbour (${r.tallName})`);
    }
  }
  return { md: rows.join('\n'), fails };
}

async function sheets(ids) {
  const sharp = (await import('sharp')).default;
  const W = 480;
  const H = 270;
  for (const h of HOURS) {
    const cells = [];
    ids.forEach((id, row) => {
      MODES.forEach((m, col) => {
        const f = join(OUT, `${id}-${m}-${h}.jpg`);
        if (existsSync(f)) {
          cells.push({ f, left: col * W, top: row * (H + 22) + 22, label: `${id} · ${m} · ${h}:00`, row, col });
        }
      });
    });
    if (cells.length === 0) {
      continue;
    }
    const width = MODES.length * W;
    const height = ids.length * (H + 22);
    const labels = cells.map((c) => `<text x="${c.left + 6}" y="${c.top - 6}" font-family="sans-serif" font-size="14" fill="#eee">${c.label}</text>`).join('');
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels}</svg>`);
    const composites = await Promise.all(cells.map(async (c) => ({ input: await sharp(c.f).resize(W, H).toBuffer(), left: c.left, top: c.top })));
    composites.push({ input: svg, left: 0, top: 0 });
    const out = join(OUT, `sheet-${h}.jpg`);
    await sharp({ create: { width, height, channels: 3, background: '#161a1f' } }).composite(composites).jpeg({ quality: 82 }).toFile(out);
    console.log(out);
  }
}

const ids = perchIds();
if (!args.includes('--sheet-only')) {
  runShots(ids);
}
const { md, fails } = table(readResults());
writeFileSync(join(OUT, 'audit.md'), `${md}\n\n${fails.length ? fails.map((f) => `- FAIL ${f}`).join('\n') : '- all perches within the in-game limits'}\n`);
console.log(md);
await sheets(ids);
for (const f of fails) {
  console.log(`FAIL ${f}`);
}
process.exit(fails.length ? 1 : 0);
