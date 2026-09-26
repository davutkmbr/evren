#!/usr/bin/env node
/**
 * GPU screenshot + stats tool (headless system Chrome, Metal ANGLE).
 *
 *   node scripts/snap.mjs --url "/?view=galata&t=18&freeze=1" --out .shots/galata.png
 *   node scripts/snap.mjs --url /sandbox/dragon.html --out .shots/dragon.png --eval "window.myHook?.()"
 *   node scripts/snap.mjs --url "/?view=bogaz" --perf 5000          # measure fps for 5 s
 *   node scripts/snap.mjs --batch shots.json                          # [{url,out,eval?,settle?,w?,h?,trace?}]
 *   (trace: path of a Chrome trace JSON recorded from the eval through the settle window; open in Perfetto)
 *   (result: path of a JSON file the eval's (awaited) return value is written to, e.g. in-page measurements)
 *
 * Waits for window.__evren.ready and __evren.pending() === 0 (or --timeout), then --settle ms more.
 * Prints JSON with console errors/warnings and engine stats. Requires the dev server (npm run dev, port 5199).
 * Frame times are measured in the page over the settle window: `stats.frameMedianMs` / `stats.frameP99Ms`, and
 * `frameTimes` ({ windowMs, frames, medianMs, p99Ms, maxMs, over50ms }). A frame is a change of the page's frame
 * counter (__evren.frame or __evren.ctx.time.frame), so a capped page (default 24 fps) reports its real cadence.
 * GPU browsers are queued machine-wide (scripts/lib/gpu-slot.mjs).
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { acquireSlot, releaseSlot, CHROME_ARGS } from './lib/gpu-slot.mjs';

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

/**
 * Installed before the page's scripts: records the interval between rendered frames (rAF timestamps at which the
 * page's frame counter changed; every rAF when the page exposes none).
 */
function installFrameProbe() {
  const times = [];
  let lastFrame = null;
  let lastT = -1;
  const counter = () => {
    const a = window.__evren;
    if (!a) return null;
    if (typeof a.frame === 'number') return a.frame;
    const f = a.ctx && a.ctx.time ? a.ctx.time.frame : undefined;
    return typeof f === 'number' ? f : null;
  };
  const tick = (t) => {
    const c = counter();
    if (c === null || c !== lastFrame) {
      if (lastT >= 0) times.push(t - lastT);
      lastT = t;
      lastFrame = c;
    }
    if (times.length > 20000) times.splice(0, 10000);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  let since = performance.now();
  window.__snapFrames = {
    reset() {
      times.length = 0;
      since = performance.now();
    },
    summary() {
      const s = times.slice().sort((a, b) => a - b);
      const pick = (p) => (s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] : 0);
      const r = (x) => Math.round(x * 100) / 100;
      return {
        windowMs: Math.round(performance.now() - since),
        frames: s.length,
        medianMs: r(pick(0.5)),
        p99Ms: r(pick(0.99)),
        maxMs: r(s.length ? s[s.length - 1] : 0),
        over50ms: s.filter((x) => x > 50).length,
      };
    },
  };
}

async function shoot(browser, job) {
  const w = Number(job.w ?? 1600);
  const h = Number(job.h ?? 900);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.addInitScript(installFrameProbe);
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
  if (job.trace) {
    // Chrome trace (renderer main thread, GPU process, V8 GC, user timing) from the eval through the settle window.
    await browser.startTracing(page, {
      path: job.trace,
      screenshots: false,
      categories: job.traceCategories ?? ['devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'blink.user_timing', 'v8', 'v8.gc', 'gpu', 'disabled-by-default-gpu.service', 'viz', 'toplevel', 'cc'],
    });
  }
  let evalResult;
  if (job.eval) {
    try {
      evalResult = await page.evaluate(job.eval);
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
  await page.evaluate(() => window.__snapFrames?.reset()).catch(() => undefined);
  await page.waitForTimeout(Number(job.settle ?? 1200));
  const frameTimes = await page.evaluate(() => window.__snapFrames?.summary() ?? null).catch(() => null);
  if (job.trace) {
    mkdirSync(dirname(job.trace), { recursive: true });
    await browser.stopTracing();
  }
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
  if (stats && typeof stats === 'object' && frameTimes && frameTimes.frames > 0) {
    stats.frameMedianMs = frameTimes.medianMs;
    stats.frameP99Ms = frameTimes.p99Ms;
  }
  if (job.result) {
    mkdirSync(dirname(job.result), { recursive: true });
    writeFileSync(job.result, JSON.stringify(evalResult ?? null, null, 1));
  }
  if (job.out) {
    mkdirSync(dirname(job.out), { recursive: true });
    await page.screenshot({ path: job.out, type: job.out.endsWith('.jpg') ? 'jpeg' : 'png', quality: job.out.endsWith('.jpg') ? 88 : undefined });
  }
  await page.close();
  return { url: job.url, out: job.out, ready, pending, loadMs: Date.now() - t0, errors, warnings: warnings.slice(0, 15), logs: logs.slice(0, 40), perf, stats, frameTimes };
}

await ensureServer();
await acquireSlot();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: CHROME_ARGS,
});
try {
  let jobs;
  if (opt('batch')) {
    jobs = JSON.parse(readFileSync(opt('batch'), 'utf8'));
  } else {
    jobs = [{ url: opt('url', '/'), out: opt('out'), eval: opt('eval'), result: opt('result'), settle: opt('settle'), timeout: opt('timeout'), w: opt('w'), h: opt('h'), perf: opt('perf'), logs: args.includes('--logs') }];
  }
  const results = [];
  for (const j of jobs) results.push(await shoot(browser, j));
  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 1));
} finally {
  await browser.close();
  releaseSlot();
}
