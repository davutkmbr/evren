#!/usr/bin/env node
/**
 * Scripted eye-level walks through the compiled street tiles (sandbox/street.html), measured on the real GPU in
 * headless Chrome at an uncapped frame rate (?fps=0), then N evenly spaced eye-level screenshots along the route.
 *
 *   node scripts/walk-test.mjs                                   # both routes, 8 shots each
 *   node scripts/walk-test.mjs --route rihtim-carsi --shots 12
 *   node scripts/walk-test.mjs --speed 6 --shots 3               # quick smoke run (not a 1.4 m/s measurement)
 *   node scripts/walk-test.mjs --out .shots/street-s0/walk --json
 *
 * Per route: median / p99 / max frame time (ms), frames over 50 ms (hitches), CPU time per frame, tiles loaded and
 * live, triangles and draw calls per frame (shadow pass included), the tile-loaded triangle total, and the shots.
 * The browser waits in the machine-wide GPU queue (scripts/lib/gpu-slot.mjs) like snap.mjs. Requires the dev server
 * (port 5199) and compiled tiles (npm run compile:world -- --area kadikoy). Writes <out>/walk-test.json too.
 *
 * --dragon: collision walk instead (scripts/lib/collision-walk.mjs). The dragon walks Eminönü streets, the square, the
 * tram line and the quay in the full game; every blocking contact is logged with its collider, and colliders with no
 * rendered mesh at the contact are reported as phantoms (exit code 1 when any is found).
 *
 *   node scripts/walk-test.mjs --dragon                          # all Eminönü routes
 *   node scripts/walk-test.mjs --dragon --route square,quay --url "/?view=galata&street=1"
 *   node scripts/walk-test.mjs --dragon --legacy-boxes           # old oriented-box building colliders (comparison)
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runDragonWalk } from './lib/collision-walk.mjs';
import { launchGpuBrowser, releaseSlot } from './lib/gpu-slot.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = opt('base', 'http://127.0.0.1:5199');
const ROUTES = opt('route', 'rihtim-carsi,altiyol-sureyya')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SHOTS = Math.max(0, Number(opt('shots', 8)));
const OUT = opt('out', '.shots/street-s0/walk');
const SPEED = Number(opt('speed', 1.4));
const W = Number(opt('w', 1600));
const H = Number(opt('h', 900));
const AREA = opt('area', 'kadikoy');
const JSON_ONLY = args.includes('--json');

const log = (...a) => {
  if (!JSON_ONLY) console.error('[walk-test]', ...a);
};

/** Keeps the shared dev server's hot reload (other modules being edited) from reloading a page mid-test. */
async function blockHotReload(page) {
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    class Stub extends EventTarget {
      constructor() {
        super();
        this.readyState = 0;
      }
      send() {}
      close() {}
    }
    window.WebSocket = function (url, protocol) {
      if (protocol === 'vite-hmr' || String(url).includes('token=')) return new Stub();
      return new NativeSocket(url, protocol);
    };
  });
}

async function waitFor(page, fn, timeoutMs, stepMs = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await page.evaluate(fn).catch(() => false);
    if (ok) return true;
    await page.waitForTimeout(stepMs);
  }
  return false;
}

async function runRoute(browser, id) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = [];
  const warnings = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const text = m.text().slice(0, 400);
    if (m.type() === 'error' && !text.startsWith('Failed to load resource')) errors.push(text);
    else if (m.type() === 'warning') warnings.push(text);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  await blockHotReload(page);
  const url = `/sandbox/street.html?area=${AREA}&route=${encodeURIComponent(id)}&autostart=0&fps=0&speed=${SPEED}`;
  const t0 = Date.now();
  await page.goto(BASE + url, { waitUntil: 'load', timeout: 60000 });
  const loaded = await waitFor(page, () => !!window.__street && !!window.__evren?.ready && window.__evren.pending() === 0, 120000);
  const initialLoadMs = Date.now() - t0;
  const route = await page.evaluate(() => window.__street?.route() ?? null).catch(() => null);
  if (!loaded || !route || route.id !== id) {
    await page.close();
    return { route: id, url, error: !loaded ? 'page did not become ready' : `route "${id}" not found`, errors };
  }
  const graph = await page.evaluate(() => window.__street.graph());
  const startTiles = await page.evaluate(() => window.__street.streamer());
  log(`${id}: ${route.lengthM} m, initial load ${initialLoadMs} ms (${startTiles.tilesLive} tiles); walking at ${SPEED} m/s`);

  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.__street.record.start();
    window.__street.play();
  });
  const walkStart = Date.now();
  const limitMs = (route.lengthM / SPEED) * 1000 * 1.5 + 30000;
  let state = null;
  while (Date.now() - walkStart < limitMs) {
    await page.waitForTimeout(1000);
    state = await page.evaluate(() => window.__street.state()).catch(() => null);
    if (state?.done) break;
  }
  const walkWallS = (Date.now() - walkStart) / 1000;
  await page.evaluate(() => window.__street.record.stop());
  const measured = await page.evaluate(() => window.__street.record.report());
  const tiles = await page.evaluate(() => window.__street.streamer());
  log(`${id}: walked ${state?.walkedM} m in ${walkWallS.toFixed(0)} s, median ${measured.frameMs.median} ms, p99 ${measured.frameMs.p99} ms, ${measured.hitchesOver50ms} hitches`);

  const shots = [];
  if (SHOTS > 0) {
    mkdirSync(OUT, { recursive: true });
    await page.evaluate(() => {
      window.__street.setFpsCap(24);
      window.__street.hud(false);
    });
    for (let k = 0; k < SHOTS; k++) {
      const f = SHOTS === 1 ? 0 : k / (SHOTS - 1);
      await page.evaluate((x) => window.__street.setProgress(x), f);
      await page.waitForTimeout(300);
      await waitFor(page, () => window.__evren.pending() === 0, 60000);
      await page.evaluate(() => window.__street.settleGround());
      await page.waitForTimeout(700);
      const out = `${OUT}/${id}-${String(k).padStart(2, '0')}.jpg`;
      await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
      const st = await page.evaluate(() => window.__street.state());
      const mark = [...route.marks].reverse().find((m) => m.s <= st.walkedM + 0.5);
      shots.push({ out, walkedM: st.walkedM, x: st.x, z: st.z, groundY: st.groundY, headingDeg: st.headingDeg, after: mark?.label ?? null });
    }
  }
  await page.close();
  return {
    route: id,
    label: route.label,
    url,
    lengthM: route.lengthM,
    offGraphM: route.offGraphM,
    waypoints: route.marks,
    walkGraph: graph,
    speed: SPEED,
    initialLoadMs,
    initialTiles: startTiles.tilesLive,
    walkedM: state?.walkedM ?? null,
    completed: !!state?.done,
    walkWallS: +walkWallS.toFixed(1),
    ...measured,
    tiles: {
      loadsDuringWalk: tiles.loads - startTiles.loads,
      unloadsDuringWalk: tiles.unloads - startTiles.unloads,
      loadsTotal: tiles.loads,
      failures: tiles.failures,
      liveAtEnd: tiles.tilesLive,
      trianglesLiveAtEnd: tiles.trianglesLive,
      mbLiveAtEnd: +(tiles.bytesLive / 1048576).toFixed(1),
      loadMsMedian: tiles.loadMsMedian,
      loadMsMax: tiles.loadMsMax,
    },
    shots,
    errors: errors.slice(0, 20),
    warnings: warnings.slice(0, 10),
  };
}

async function dragonMain() {
  const out = opt('out', '.shots/collision-walk');
  log('waiting for a GPU slot...');
  const browser = await launchGpuBrowser(chromium);
  let report;
  try {
    const only = args.includes('--route') ? ROUTES : [];
    const res = await runDragonWalk(browser, { base: BASE, root: fileURLToPath(new URL('..', import.meta.url)), only, log, url: opt('url', undefined), legacyBoxes: args.includes('--legacy-boxes') });
    report = { date: new Date().toISOString(), ...res };
  } finally {
    await browser.close();
    releaseSlot();
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/collision-walk.json`, JSON.stringify(report, null, 1));
  log(`report: ${out}/collision-walk.json`);
  if (JSON_ONLY) console.log(JSON.stringify(report, null, 1));
  // Stuck spots against rendered walls (18 m dragon in a 4 m alley) are reported but do not fail the run.
  if (report.error || report.phantoms > 0 || report.errors?.length) process.exitCode = 1;
}

async function main() {
  try {
    const r = await fetch(BASE + '/');
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    console.error(`Dev server not reachable at ${BASE}`);
    process.exit(2);
  }
  log(`waiting for a GPU slot...`);
  const browser = await launchGpuBrowser(chromium);
  const results = [];
  try {
    for (const id of ROUTES) {
      results.push(await runRoute(browser, id));
    }
  } finally {
    await browser.close();
    releaseSlot();
  }
  const report = { date: new Date().toISOString(), viewport: `${W}x${H}`, fps: 'uncapped (?fps=0, vsync-bound)', hitchMs: 50, results };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/walk-test.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
}

if (args.includes('--dragon')) {
  await dragonMain();
} else {
  await main();
}
