#!/usr/bin/env node
/**
 * Renders every audio test case offline in headless Chrome (sandbox/audio.html) and writes:
 *   .shots/audio/<id>.wav      16-bit stereo 48 kHz renders through the full master chain
 *   .shots/audio/metrics.json  peak / pre-dynamics peak / gain reduction / clipping / LUFS / sub-30 Hz / bands per case
 *   .shots/audio/report.png    the visual report (waveforms + spectrograms)
 *
 *   node src/audio/tools/dump-audio.mjs [--cases id1,id2] [--no-wav] [--synth] [--base http://127.0.0.1:5199]
 * --synth renders without the recorded sounds (synthesis only). DUMP_CHROME=<path> runs a given Chromium instead of the
 * system Chrome (Linux containers).
 * Requires the Vite dev server.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = opt('base', 'http://127.0.0.1:5199');
const cases = opt('cases');
const outDir = resolve(process.cwd(), '.shots/audio');
mkdirSync(outDir, { recursive: true });

// DUMP_CHROME=<path>: a Chromium executable instead of the system Chrome (Linux containers).
const browser = await chromium.launch(
  process.env.DUMP_CHROME
    ? { executablePath: process.env.DUMP_CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }
    : { channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] },
);
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  // Keep other modules' hot reloads from restarting the render midway.
  await page.routeWebSocket(/.*/, () => {});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const query = new URLSearchParams();
  if (cases) {
    query.set('cases', cases);
  }
  if (args.includes('--synth')) {
    query.set('samples', '0');
  }
  await page.goto(`${BASE}/sandbox/audio.html${query.size ? `?${query}` : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__audioReport?.done === true, null, { timeout: 300000, polling: 250 });
  const results = await page.evaluate(() => window.__audioReport.results());
  if (!args.includes('--no-wav')) {
    for (const r of results) {
      const b64 = await page.evaluate((id) => window.__audioReport.wav(id), r.id);
      if (b64) {
        writeFileSync(resolve(outDir, `${r.id}.wav`), Buffer.from(b64, 'base64'));
      }
    }
  }
  writeFileSync(resolve(outDir, 'metrics.json'), JSON.stringify(results, null, 1));
  const fullHeight = await page.evaluate(() => document.querySelector('.ar-root')?.scrollHeight ?? 900);
  await page.setViewportSize({ width: 1600, height: Math.min(8000, fullHeight) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(outDir, 'report.png') });
  const table = results.map((r) => ({
    id: r.id,
    lufs: +r.measured.toFixed(1),
    target: r.target.join('..'),
    peak: +r.metrics.peakDb.toFixed(1),
    pre: +r.prePeakDb.toFixed(1),
    glue: +r.glueGrDb.toFixed(1),
    lim: +r.limiterGrDb.toFixed(1),
    sub30: +(r.metrics.sub30 * 100).toFixed(1),
    rise: r.rise === null ? '' : +r.rise.toFixed(1),
    rep: r.repeat ? `${r.repeat.corr.toFixed(2)}@${r.repeat.lagS.toFixed(2)}` : '',
    clip: r.metrics.clipped,
    centroid: Math.round(r.metrics.centroidHz),
    low: +r.metrics.bands[0].toFixed(2),
    mid: +r.metrics.bands[1].toFixed(2),
    high: +r.metrics.bands[2].toFixed(2),
    corr: +r.metrics.stereoCorrelation.toFixed(2),
    ok: r.pass ? 'OK' : r.problems.join('; '),
  }));
  console.table(table);
  if (errors.length) {
    console.log('ERRORS:', errors);
  }
} finally {
  await browser.close();
}
