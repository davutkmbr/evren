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
 * --dragon: collision walk instead (scripts/lib/collision-walk.mjs, routes from scripts/lib/walk-routes.mjs). The dragon
 * walks planned routes in the full game; every blocking contact is logged with its collider, colliders with no rendered
 * mesh at the contact are phantoms, and every stuck spot is classified (phantom / narrow street / rendered obstacle /
 * step / no contact). Routes are built from the area's own OSM data, so any district works without hand-picked points:
 * seeded coverage-greedy walks over its street graph, chords across its squares and the coastline 10 m inland.
 * Exit code 1 on any phantom (outside the per-area known list in walk-routes.mjs KNOWN) or page error.
 *
 *   node scripts/walk-test.mjs --dragon                          # the Eminönü routes of commit 7c71997 (preset eminonu-streets)
 *   node scripts/walk-test.mjs --dragon --area galata            # the area's default preset (auto, AREA_DEFAULTS)
 *   node scripts/walk-test.mjs --dragon --area galata,kadikoy --street
 *   node scripts/walk-test.mjs --dragon --bbox -4300,2900,-3900,3200 --routes 6 --length 2500 --seed 7
 *   node scripts/walk-test.mjs --dragon --area eminonu --plan    # print the planned routes only (no browser)
 *   node scripts/walk-test.mjs --dragon --route square,quay --url "/?view=galata&street=1"
 *   node scripts/walk-test.mjs --dragon --legacy-boxes           # old oriented-box building colliders (comparison)
 *
 *   --area <ids>      OSM_AREAS ids (src/world/osm/area.ts), comma separated; routes from each area's data file
 *   --bbox a,b,c,d    minX,minZ,maxX,maxZ in local metres instead (data from the area covering most of it)
 *   --preset <name>   auto (default with --area/--bbox) or eminonu-streets (default without)
 *   --routes <n>      street routes (auto); --length <m> total planned length; --seed <n> (same seed, same routes)
 *   --budget <s>      wall-clock walking budget per area (default 1800); routes past it are listed as skipped
 *   --route <ids>     only these route ids; --street adds ?street=1 (street layer); --url overrides the page URL
 *   --probe "x,z[,r];..."  diagnostics: rendered front / back-face ray hits in 16 directions and the colliders there
 *   --out <dir>       report folder (default .shots/collision-walk): collision-walk.json with one entry per area
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runDragonWalk, runProbe } from './lib/collision-walk.mjs';
import { planRoutes, resolveArea } from './lib/walk-routes.mjs';
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
  const root = fileURLToPath(new URL('..', import.meta.url));
  const num = (name) => (args.includes(`--${name}`) ? Number(opt(name)) : undefined);
  const areaArg = opt('area', undefined);
  const bbox = opt('bbox', undefined);
  // Without --area / --bbox: the hand-picked Eminönü routes on the runtime slice (the original --dragon run).
  const preset = opt('preset', areaArg || bbox ? undefined : 'eminonu-streets');
  const targets = bbox ? [{ bbox }] : (areaArg ?? 'galata').split(',').map((a) => ({ area: a.trim() }));
  const only = args.includes('--route') ? ROUTES : [];
  const plans = targets.map((t) => {
    const area = resolveArea(root, t);
    const p = planRoutes(area, { preset, routes: num('routes'), lengthM: num('length'), seed: num('seed') });
    const routes = p.routes.filter((r) => !only.length || only.includes(r.id));
    log(`${area.id}: preset ${p.plan.preset}${p.plan.preset === 'auto' ? ` (seed ${p.plan.seed}, ${p.plan.routes} street routes, ${p.plan.lengthM} m)` : ''}: ${routes.length} routes, ${routes.reduce((a, r) => a + r.lengthM, 0)} m; street graph ${p.graph.lengthM} m${p.graph.coveragePct != null ? `, ${p.graph.coveragePct}% planned` : ''}`);
    return { area, plan: p.plan, graph: p.graph, routes };
  });
  if (args.includes('--plan')) {
    const report = plans.map((p) => ({ area: p.area.id, rect: p.area.rect, plan: p.plan, graph: p.graph, routes: p.routes.map((r) => ({ id: r.id, label: r.label, kind: r.kind, lengthM: r.lengthM, start: r.legs[0].slice(0, 2), legs: r.legs.length })) }));
    console.log(JSON.stringify(report, null, 1));
    return;
  }
  let url = opt('url', '/?view=galata&nohud=1');
  if (args.includes('--street') && !/[?&]street=/.test(url)) url += `${url.includes('?') ? '&' : '?'}street=1`;
  if (args.includes('--probe')) {
    const points = opt('probe').split(';').map((p) => p.split(',').map(Number));
    const browser = await launchGpuBrowser(chromium);
    try {
      const res = await runProbe(browser, { base: BASE, url, points, log });
      mkdirSync(out, { recursive: true });
      writeFileSync(`${out}/probe.json`, JSON.stringify(res, null, 1));
      log(`probe report: ${out}/probe.json`);
    } finally {
      await browser.close();
      releaseSlot();
    }
    return;
  }
  try {
    const r = await fetch(BASE + '/');
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    console.error(`Dev server not reachable at ${BASE}`);
    process.exit(2);
  }
  log('waiting for a GPU slot...');
  const browser = await launchGpuBrowser(chromium);
  const areas = [];
  try {
    for (const p of plans) {
      const res = await runDragonWalk(browser, { base: BASE, area: p.area, routes: p.routes, graph: p.graph, log, url, legacyBoxes: args.includes('--legacy-boxes'), budgetS: num('budget') ?? 1800 });
      areas.push({ ...res, plan: p.plan });
    }
  } finally {
    await browser.close();
    releaseSlot();
  }
  const report = {
    date: new Date().toISOString(),
    url,
    phantoms: areas.reduce((a, r) => a + (r.phantoms ?? 0), 0),
    errors: areas.reduce((a, r) => a + (r.errors?.length ?? 0), 0),
    areas,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/collision-walk.json`, JSON.stringify(report, null, 1));
  log(`report: ${out}/collision-walk.json`);
  for (const a of areas) {
    log(`== ${a.area}: ${a.error ?? `${a.phantoms} phantom, ${a.unverified} unverified, ${a.known} known, ${a.colliders.length} blocking colliders; stuck ${JSON.stringify(a.stuckBy)}; walked ${a.coverage.walkedM}/${a.coverage.plannedM} m (${a.coverage.waypointsReachedPct}% waypoints); ${a.errors.length} page errors`}`);
  }
  if (JSON_ONLY) console.log(JSON.stringify(report, null, 1));
  // Stuck spots against rendered walls (18 m dragon in a 4 m alley) are reported but do not fail the run.
  if (areas.some((a) => a.error) || report.phantoms > 0 || report.errors > 0) process.exitCode = 1;
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
