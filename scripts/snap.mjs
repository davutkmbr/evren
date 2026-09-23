#!/usr/bin/env node
/**
 * GPU screenshot + stats tool (headless system Chrome, Metal ANGLE).
 *
 *   node scripts/snap.mjs --url "/?view=galata&t=18&freeze=1" --out .shots/galata.png
 *   node scripts/snap.mjs --url /sandbox/dragon.html --out .shots/dragon.png --eval "window.myHook?.()"
 *   node scripts/snap.mjs --url "/?view=bogaz" --perf 5000          # measure fps for 5 s
 *   node scripts/snap.mjs --batch shots.json                          # [{url,out,eval?,settle?,w?,h?}]
 *
 * Waits for window.__evren.ready and __evren.pending() === 0 (or --timeout), then --settle ms more.
 * Prints JSON with console errors/warnings and engine stats. Requires the dev server (npm run dev, port 5199).
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = opt('base', 'http://127.0.0.1:5199');

async function ensureServer() {
  try {
    const r = await fetch(BASE + '/', { method: 'GET' });
    if (!r.ok) throw new Error(String(r.status));
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: `Dev server not reachable at ${BASE}. Start it with: npm run dev` }));
    process.exit(2);
  }
}

async function shoot(browser, job) {
  const w = Number(job.w ?? 1600);
  const h = Number(job.h ?? 900);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  const warnings = [];
  const logs = [];
  page.on('console', (m) => {
    const t = m.type();
    const text = m.text().slice(0, 800);
    if (t === 'error' && text.startsWith('Failed to load resource')) return;
    if (t === 'error') errors.push(text);
    else if (t === 'warning') warnings.push(text);
    else if (job.logs) logs.push(text);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
  let url = job.url.startsWith('http') ? job.url : BASE + job.url;
  // Cap the frame rate while waiting/settling so parallel screenshot sessions stay cheap; --perf runs uncapped.
  const fpsCap = job.fps ?? (job.perf ? '0' : process.env.SNAP_FPS ?? '24');
  if (fpsCap !== null && fpsCap !== undefined && !/[?&]fps=/.test(url)) {
    url += (url.includes('?') ? '&' : '?') + `fps=${fpsCap}`;
  }
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  const timeout = Number(job.timeout ?? 45000);
  let ready = false;
  let pending = -1;
  while (Date.now() - t0 < timeout) {
    const s = await page.evaluate(() => {
      const a = window.__evren;
      return a ? { ready: a.ready, pending: a.pending() } : { ready: false, pending: -1 };
    }).catch(() => ({ ready: false, pending: -1 }));
    ready = s.ready;
    pending = s.pending;
    if (ready && pending === 0) break;
    await page.waitForTimeout(250);
  }
  if (job.eval) {
    try {
      await page.evaluate(job.eval);
    } catch (e) {
      errors.push(`eval error: ${e.message}`);
    }
    // give streaming a chance after teleports etc.
    const t1 = Date.now();
    await page.waitForTimeout(300);
    while (Date.now() - t1 < timeout / 2) {
      const p = await page.evaluate(() => window.__evren?.pending?.() ?? 0).catch(() => 0);
      if (p === 0) break;
      await page.waitForTimeout(250);
    }
  }
  await page.waitForTimeout(Number(job.settle ?? 1200));
  let perf = null;
  if (job.perf) {
    perf = await page.evaluate(async (ms) => {
      const times = [];
      let last = performance.now();
      const end = last + ms;
      await new Promise((res) => {
        const f = (t) => {
          times.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(f);
          else res();
        };
        requestAnimationFrame(f);
      });
      times.sort((a, b) => a - b);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return { frames: times.length, avgMs: +avg.toFixed(2), fps: +(1000 / avg).toFixed(1), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(2), maxMs: +times[times.length - 1].toFixed(2) };
    }, Number(job.perf));
  }
  const stats = await page.evaluate(() => (window.__evren ? window.__evren.stats() : null)).catch(() => null);
  if (job.out) {
    mkdirSync(dirname(job.out), { recursive: true });
    await page.screenshot({ path: job.out, type: job.out.endsWith('.jpg') ? 'jpeg' : 'png', quality: job.out.endsWith('.jpg') ? 88 : undefined });
  }
  await page.close();
  return { url: job.url, out: job.out, ready, pending, loadMs: Date.now() - t0, errors, warnings: warnings.slice(0, 15), logs: logs.slice(0, 40), perf, stats };
}

/**
 * Machine-wide limit on concurrent GPU browsers (parallel agents share one GPU). Slots are lock directories holding the
 * owner's pid; stale slots of dead processes are reclaimed. Override with SNAP_MAX_CONCURRENT.
 */
const MAX_CONCURRENT = Number(process.env.SNAP_MAX_CONCURRENT ?? 2);
const LOCK_ROOT = fileURLToPath(new URL('../.shots/.snap-slots', import.meta.url));
let heldSlot = null;
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function acquireSlot() {
  mkdirSync(LOCK_ROOT, { recursive: true });
  for (;;) {
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      const dir = `${LOCK_ROOT}/slot-${i}`;
      try {
        mkdirSync(dir);
        writeFileSync(`${dir}/pid`, String(process.pid));
        heldSlot = dir;
        return;
      } catch {
        let owner = NaN;
        try {
          owner = Number(readFileSync(`${dir}/pid`, 'utf8'));
        } catch {
          /* being created */
        }
        if (Number.isFinite(owner) && owner > 0 && !alive(owner)) {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
function releaseSlot() {
  if (heldSlot) {
    rmSync(heldSlot, { recursive: true, force: true });
    heldSlot = null;
  }
}
process.on('exit', releaseSlot);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    releaseSlot();
    process.exit(130);
  });
}

await ensureServer();
await acquireSlot();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
try {
  let jobs;
  if (opt('batch')) {
    jobs = JSON.parse(readFileSync(opt('batch'), 'utf8'));
  } else {
    jobs = [{ url: opt('url', '/'), out: opt('out'), eval: opt('eval'), settle: opt('settle'), timeout: opt('timeout'), w: opt('w'), h: opt('h'), perf: opt('perf'), logs: args.includes('--logs') }];
  }
  const results = [];
  for (const j of jobs) results.push(await shoot(browser, j));
  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 1));
} finally {
  await browser.close();
  releaseSlot();
}
