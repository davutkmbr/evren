#!/usr/bin/env node
/**
 * Street layer checks in the flight game (src/world/street), run through scripts/snap.mjs (GPU queue, port 5199):
 *
 *   node scripts/street-layer-test.mjs                  # all checks
 *   node scripts/street-layer-test.mjs --only flip,pass # a subset: flip, pass, cross, descent, gpu
 *   node scripts/street-layer-test.mjs --street 1       # URL value of ?street= (default: the game default)
 *   node scripts/street-layer-test.mjs --trace <dir>    # also a Chrome trace per job (<dir>/<job>.json)
 *
 * - flip: descent from 140 m to 30 m over the Eminönü square with a +-4 m wobble around the 80 m activation height,
 *   then a 5 s hover. Frame by frame every live tile's fade may rise once and fall once, its hole may be painted once,
 *   it may never be hidden while faded in, and the layer state may switch on once. The hover also counts screen cells
 *   (32 x 18) whose brightness jumps back and forth (the crowd moves, so compare with --street 0).
 * - pass: 30 m flight east over the area (720 m at 24 m/s, tiles streaming in and out): frames over 33 / 50 ms, the
 *   same per-tile fade and visibility rules, and a street-off control run for the machine's own jitter.
 * - cross: 30 m flight from Karaköy over Galata Kulesi to Eminönü (three adjacent areas), frame by frame: the street
 *   layer's update time, the other systems, the render call and the GL uploads in it, and main-thread long tasks
 *   (see LIMITS for the thresholds). Worst frames: [ms, street, systems, render, texMB, texMs, bufMB, bufMs, longTask,
 *   where, layerMB]; all frames in the job's result file (rowsFile). A street-off control flies the same route.
 * - descent: 150 m down to 60 m over the Eminönü square at 5 m/s (prefetch from 130 m, fade-in below 80 m), measured
 *   like cross, with a control.
 *   Options for both: --uploads groups GL uploads over 0.5 MB by call and buffer size; --trace <dir> records a Chrome
 *   trace per job (--trace-categories a,b,c to choose), with user-timing marks street-test:start / :end.
 * - gpu: a 2.3 km zig-zag at 30-40 m (tiles loaded, dropped, their buffer ranges reused), then every batch's GPU index
 *   buffer is read back and compared with its CPU copy on the drawn ranges.
 * Exit code 1 when a check fails, 2 when nothing failed but a control was too noisy to judge. The GPU is shared with
 * whoever plays on the machine: rerun hitch counts when the control run is not clean. A run whose page was reloaded
 * by the dev server (another agent saved a file) reports that as an error: rerun.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const only = new Set(opt('only', 'flip,pass,cross,descent,gpu').split(','));
const street = opt('street', null);
/** --uploads: also group GL uploads over 1 MB by call site (logged as UPLOAD lines). */
const uploads = args.includes('--uploads');
const url = (extra = '', value = street) => `/?t=11&autostart=1&nohud=1&fps=0${value === null ? '' : `&street=${value}`}${extra}`;

/** Per-tile rules, shared by the page scripts: called every frame with the layer root. */
const TRACK = /* js */ `
window.__track = (() => {
  const tiles = new Map(); const layer = { showing: 0, active: 0, on: 0 }; let prev = null;
  return {
    frame() {
      const root = __evren.ctx.scene.getObjectByName('street:eminonu');
      if (!root || !root.userData.streamer) return;
      const L = root.userData.layer; if (prev && L) for (const k in layer) if (L[k] !== prev[k]) layer[k]++; prev = L && { ...L };
      const mask = root.userData.holeMask;
      for (const t of root.userData.streamer.liveTiles()) {
        let r = tiles.get(t.ref.id);
        if (!r) { r = { fade: 0, dir: 0, reversals: 0, painted: false, paintFlips: 0, shown: false, shownFlips: 0, hiddenFaded: 0 }; tiles.set(t.ref.id, r); }
        const d = Math.sign(t.fade - r.fade); if (d) { if (r.dir && d !== r.dir) r.reversals++; r.dir = d; } r.fade = t.fade;
        const p = !!mask && mask.isPainted(t.ref.id, t.slot); if (p !== r.painted) { r.paintFlips++; r.painted = p; }
        if (t.shown !== r.shown) { r.shownFlips++; r.shown = t.shown; } if (t.fade > 0 && !t.shown) r.hiddenFaded++;
      }
    },
    report() {
      const bad = [...tiles].filter(([, r]) => r.reversals > 1 || r.paintFlips > 2 || r.shownFlips > 2 || r.hiddenFaded > 0).map(([id, r]) => ({ id, ...r }));
      return { tiles: tiles.size, layer, bad };
    },
  };
})();`;

const FLIP = /* js */ `${TRACK}
(() => {
  const g = __evren.ctx.services.tryGet('geo'); const x = -4060, z = 3020; const H = (h) => g.heightAt(x, z) + h;
  __evren.setPaused(false); __evren.setCamera('free'); __evren.shot(x, H(140), z, 205, -14, 60);
  const small = document.createElement('canvas'); small.width = 32; small.height = 18; const c2 = small.getContext('2d', { willReadFrequently: true });
  const glc = __evren.ctx.renderer.domElement; const cells = []; let t0 = 0;
  const agl = (s) => (s < 6 ? 140 - s * 10 : s < 10 ? 80 + 4 * Math.sin((s - 6) * Math.PI * 1.5) : s < 14 ? 80 - (s - 10) * 12.5 : 30);
  const tick = (t) => {
    if (!t0) { if ((t < 5000 || __evren.pending() > 0) && t < 40000) { requestAnimationFrame(tick); return; } t0 = t; }
    const s = (t - t0) / 1000; __evren.shot(x, H(agl(s)), z, 205, -14, 60); window.__track.frame();
    if (s >= 14.5) { c2.drawImage(glc, 0, 0, 32, 18); const d = c2.getImageData(0, 0, 32, 18).data; const l = new Float32Array(576); for (let i = 0; i < 576; i++) l[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]; cells.push(l); }
    if (s > 19) { let flipping = 0; for (let i = 0; i < 576; i++) { let j = 0; for (let k = 1; k < cells.length; k++) if (Math.abs(cells[k][i] - cells[k - 1][i]) > 18) j++; if (j >= 2) flipping++; }
      console.log('RESULT ' + JSON.stringify({ ...window.__track.report(), hoverFrames: cells.length, flippingCells: flipping })); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

const PASS = /* js */ `${TRACK}
(() => {
  const g = __evren.ctx.services.tryGet('geo'); const H = (x, z) => g.heightAt(x, z);
  const x0 = -4420, x1 = -3700, z = 3060, agl = 30, speed = 24;
  __evren.setPaused(false); __evren.setCamera('free'); __evren.shot(x0, H(x0, z) + agl, z, 90, -12, 60);
  const times = []; let last = 0, start = 0;
  const tick = (t) => {
    if (!start) { if (__evren.pending() > 0 && t < 60000) { requestAnimationFrame(tick); return; } start = t; last = t; }
    times.push(t - last); last = t; const x = x0 + ((t - start) / 1000) * speed;
    window.__track.frame();
    if (x > x1) { console.log('RESULT ' + JSON.stringify({ ...window.__track.report(), frames: times.length, over33: times.filter((v) => v > 34).length, over50: times.filter((v) => v > 50).length, max: Math.round(Math.max(...times)) })); return; }
    __evren.shot(x, H(x, z) + agl, z, 90, -12, 60); requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;


/**
 * Per-frame attribution (crossing): wall time between frames, the street layer's update, the other systems, the
 * render call and the GL uploads inside it (texture and buffer bytes), so a long frame can be pinned on one of them.
 */
const PROBE = /* js */ `
window.__probe = (() => {
  const E = __evren.engine; const gl = __evren.ctx.renderer.getContext(); const cur = { street: 0, systems: 0, render: 0, tex: 0, texMs: 0, buf: 0, bufMs: 0, own: 0 };
  // Uploads of the layer itself: buffers of its batches, textures uploaded from its code (its budgeted initTexture).
  const owns = (name, a) => { if (name.startsWith('tex')) return (new Error().stack || '').includes('/street/'); const own = __evren.ctx.scene.getObjectByName('street:batches')?.userData.ownsBufferArray; return !!own && a.some((x) => own(x)); };
  for (const e of E.sorted) { const u = e.system.update; if (!u) continue; const street = e.system.name === 'street-layer';
    e.system.update = function (...a) { const t0 = performance.now(); try { return u.apply(this, a); } finally { const ms = performance.now() - t0; if (street) cur.street += ms; else cur.systems += ms; } }; }
  const pl = __evren.ctx.pipeline; const r0 = pl.render; pl.render = function (...a) { const t0 = performance.now(); try { return r0.apply(this, a); } finally { cur.render += performance.now() - t0; } };
  const img = (o) => (o && o.width ? o.width * o.height * 4 : 0); const stack = [];
  const size = { texImage2D: (a) => (a.length >= 9 ? a[3] * a[4] * 4 : img(a[5])), texSubImage2D: (a) => (a.length >= 9 ? a[4] * a[5] * 4 : img(a[6])), texStorage2D: () => 0, compressedTexImage2D: (a) => a[6]?.byteLength ?? 0,
    generateMipmap: () => 0, bufferData: (a) => (typeof a[1] === 'number' ? 0 : a[1]?.byteLength ?? 0), bufferSubData: (a) => (a.length >= 5 ? a[4] * a[2].BYTES_PER_ELEMENT : a.length === 4 ? (a[2].length - a[3]) * a[2].BYTES_PER_ELEMENT : a[2]?.byteLength ?? 0) };
  for (const [name, key] of [['texImage2D', 'tex'], ['texSubImage2D', 'tex'], ['texStorage2D', 'tex'], ['compressedTexImage2D', 'tex'], ['generateMipmap', 'tex'], ['bufferData', 'buf'], ['bufferSubData', 'buf']]) {
    // A call that makes further GL upload calls (the street layer's lazy buffer creation) counts through those only.
    const f = gl[name].bind(gl); gl[name] = (...a) => { const t0 = performance.now(); const frame = { nested: false }; if (stack.length) stack[stack.length - 1].nested = true; stack.push(frame);
      try { return f(...a); } finally { stack.pop(); const ms = performance.now() - t0; const b = frame.nested ? 0 : size[name](a); if (!stack.length) cur[key + 'Ms'] += ms; cur[key] += b; if (b > 0 && owns(name, a)) cur.own += b;
      if (window.__uploadStacks && b > 5e5) { const src = a.find((x) => x && x.BYTES_PER_ELEMENT); const k = name + (key === 'buf' ? ' ' + (a[0] === gl.ELEMENT_ARRAY_BUFFER ? 'index' : 'vertex') + ' ' + (src ? src.constructor.name + '[' + src.length + ']' : a[1]) : ' ' + b);
        const u = (window.__uploadStacks[k] ??= { n: 0, mb: 0, ms: 0 }); u.n++; u.mb += b / 1e6; u.ms += ms;
        if (b > 3e6 && window.__bigUploads.length < 400) window.__bigUploads.push([__evren.ctx.time.frame, Math.round(b / 1e5) / 10, Math.round(ms * 10) / 10, k]); } } }; }
  // Main-thread tasks over 50 ms outside the frame (loading callbacks, parsing, GC): summed per frame.
  let longTask = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) longTask += e.duration; }).observe({ type: 'longtask' }); } catch {}
  return { take() { const o = { ...cur, long: longTask }; for (const k in cur) cur[k] = 0; longTask = 0; return o; } };
})();`;

/** Frame-time summary of an array of frame records ({ ms, ... }). */
const SUMMARY = /* js */ `
window.__summary = (rows) => { const ms = rows.map((r) => r.ms);
  // Worst frames, one log line each (snap.mjs cuts log lines at 800 characters): ms street systems render texMB texMs bufMB bufMs longTask [where].
  const f1 = (v) => Math.round(v * 10) / 10; const row = (r) => [f1(r.ms), f1(r.street), f1(r.systems), f1(r.render), f1(r.tex / 1e6), f1(r.texMs), f1(r.buf / 1e6), f1(r.bufMs), f1(r.long), r.where ?? '', f1(r.own / 1e6)];
  const worst = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 12).map(row);
  // Frames over 50 ms with a layer cause in them or the two frames before (the GPU runs a frame or two behind): the
  // street update over 8 ms, or over 12 MB of the layer's own texture and buffer uploads.
  const heavy = rows.map((r) => r.street > 8 || r.own > 12e6);
  const layerHitches = rows.filter((r, i) => r.ms > 50 && (heavy[i] || heavy[i - 1] || heavy[i - 2])).length;
  const sum = (k) => Math.round(rows.reduce((s, r) => s + r[k], 0)); const q = [...ms].sort((a, b) => a - b);
  return { frames: rows.length, over33: ms.filter((v) => v > 34).length, over50: ms.filter((v) => v > 50).length, max: Math.round(Math.max(...ms)), median: Math.round(q[q.length >> 1] * 10) / 10,
    streetOver8: rows.filter((r) => r.street > 8).length, streetMax: Math.round(Math.max(...rows.map((r) => r.street)) * 10) / 10, streetTotal: sum('street'), texMB: Math.round(rows.reduce((s, r) => s + r.tex, 0) / 1e5) / 10, bufMB: Math.round(rows.reduce((s, r) => s + r.buf, 0) / 1e5) / 10, longTasks: sum('long'), layerHitches, batch: { ...__evren.ctx.scene.children.find((o) => o.userData.batchCounters)?.userData.batchCounters }, worst,
    uploads: window.__uploadStacks ? Object.entries(window.__uploadStacks).sort((a, b) => b[1].mb - a[1].mb).slice(0, 15).map(([k, u]) => [Math.round(u.mb), u.n, Math.round(u.ms), k]) : undefined, rows: rows.map(row), bigUploads: window.__bigUploads }; };`;

/**
 * Crossing: 30 m flight from Karaköy over Galata Kulesi to Eminönü (three adjacent areas, cells owned by different
 * areas, the hole mask changes its set of areas several times) at 24 m/s.
 */
const UPLOADS = /* js */ `
window.__uploadStacks = {}; window.__bigUploads = [];`;

const CROSS = /* js */ `${uploads ? UPLOADS : ''}${PROBE}${SUMMARY}
new Promise((done) => {
  const g = __evren.ctx.services.tryGet('geo'); const H = (x, z) => g.heightAt(x, z);
  const W = [[-3560, 2560], [-3850, 2150], [-3960, 2650], [-4050, 3120]]; const agl = 30, speed = 24;
  const heading = (a, b) => (Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI;
  __evren.setPaused(false); __evren.setCamera('free'); __evren.shot(W[0][0], H(W[0][0], W[0][1]) + agl, W[0][1], heading(W[0], W[1]), -12, 60);
  const rows = []; let last = 0, start = 0, seg = 0, along = 0, prevKey = '';
  const areas = () => __evren.ctx.scene.children.filter((o) => o.name.startsWith('street:') && o.visible).map((o) => o.name.slice(7)).sort().join('+');
  const tick = (t) => {
    if (!start) { if (__evren.pending() > 0 && t < 60000) { requestAnimationFrame(tick); return; } start = t; last = t; window.__probe.take(); performance.mark('street-test:start'); }
    const ms = t - last; last = t; const key = areas(); rows.push({ ms, ...window.__probe.take(), where: seg + (key !== prevKey ? ' ' + key : '') }); prevKey = key;
    along += (ms / 1000) * speed; let a = W[seg], b = W[seg + 1]; let L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (along >= L && seg < W.length - 2) { along -= L; seg++; a = W[seg]; b = W[seg + 1]; L = Math.hypot(b[0] - a[0], b[1] - a[1]); }
    if (along >= L) { performance.mark('street-test:end'); done(window.__summary(rows.slice(1))); return; }
    const f = along / L; const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
    __evren.shot(x, H(x, z) + agl, z, heading(a, b), -12, 60); requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});`;

/**
 * Descent: from 150 m down to 60 m over the Eminönü square at 5 m/s (tiles prefetched hidden from 130 m, fading in
 * below 80 m): frames over 50 ms while the tiles, their textures and buffers are first uploaded.
 */
const DESCENT = /* js */ `${uploads ? UPLOADS : ''}${PROBE}${SUMMARY}
new Promise((done) => {
  const g = __evren.ctx.services.tryGet('geo'); const x = -4060, z = 3020; const H = (h) => g.heightAt(x, z) + h;
  __evren.setPaused(false); __evren.setCamera('free'); __evren.shot(x, H(150), z, 205, -14, 60);
  const rows = []; let last = 0, start = 0;
  const tick = (t) => {
    if (!start) { if ((t < 5000 || __evren.pending() > 0) && t < 40000) { requestAnimationFrame(tick); return; } start = t; last = t; window.__probe.take(); performance.mark('street-test:start'); }
    const ms = t - last; last = t; const s = (t - start) / 1000; const h = 150 - s * 5; rows.push({ ms, ...window.__probe.take(), where: Math.round(h) });
    if (h < 60) { performance.mark('street-test:end'); done(window.__summary(rows.slice(1))); return; }
    __evren.shot(x, H(h), z, 205, -14, 60); requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});`;

const GPU = /* js */ `
(() => {
  const g = __evren.ctx.services.tryGet('geo'); const H = (x, z) => g.heightAt(x, z); const gl = __evren.ctx.renderer.getContext();
  const W = [[-4400, 3060, 40], [-3700, 3060, 30], [-3700, 3200, 30], [-4300, 3200, 30], [-4300, 3000, 35], [-3800, 3000, 30], [-3800, 3150, 30]];
  __evren.setPaused(false); __evren.setCamera('free'); __evren.shot(W[0][0], H(W[0][0], W[0][1]) + W[0][2], W[0][1], 90, -12, 60);
  let seg = 0, along = 0, start = 0, last = 0;
  const check = () => { const roots = ['street:eminonu', 'street:batches'].map((n) => __evren.ctx.scene.getObjectByName(n)).filter(Boolean); const res = { checked: 0, bad: [] }; const seen = new Set();
    for (const root of roots) root.traverse((o) => { if (!o.isBatchedMesh) return; const prev = o.onAfterRender;
      o.onAfterRender = function (...a) { if (prev) prev.apply(this, a); if (seen.has(o)) return; seen.add(o); const idx = o.geometry.index; let diff = 0;
        for (const inst of o._instanceInfo) { if (!inst.active) continue; const gi = o._geometryInfo[inst.geometryIndex]; if (!gi.indexCount) continue;
          const dst = new idx.array.constructor(gi.indexCount); gl.getBufferSubData(gl.ELEMENT_ARRAY_BUFFER, gi.indexStart * idx.array.BYTES_PER_ELEMENT, dst);
          for (let k = 0; k < gi.indexCount; k++) if (dst[k] !== idx.array[gi.indexStart + k]) diff++; }
        res.checked++; if (diff) res.bad.push(o.name + ': ' + diff); }; });
    setTimeout(() => console.log('RESULT ' + JSON.stringify(res)), 1500); };
  const tick = (t) => {
    if (!start) { if (__evren.pending() > 0 && t < 60000) { requestAnimationFrame(tick); return; } start = t; last = t; }
    const dt = (t - last) / 1000; last = t;
    if (seg >= W.length - 1) { setTimeout(check, 2000); return; }
    const a = W[seg], b = W[seg + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); along += dt * 30; let f = along / L; if (f >= 1) { seg++; along = 0; f = 1; }
    const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f, h = a[2] + (b[2] - a[2]) * f;
    __evren.shot(x, H(x, z) + h, z, (Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI, -12, 60); requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

const jobs = [];
if (only.has('flip')) jobs.push({ name: 'flip', url: url(), eval: FLIP, settle: 45000 });
if (only.has('pass')) {
  jobs.push({ name: 'pass', url: url(), eval: PASS, settle: 45000 });
  jobs.push({ name: 'pass-control', url: url('', '0'), eval: PASS, settle: 45000 });
}
// The flights resolve their evals with the result (frame rows included), written to <dir>/<job>.result.json.
if (only.has('cross')) {
  jobs.push({ name: 'cross', url: url(), eval: CROSS, settle: 500, returns: true });
  jobs.push({ name: 'cross-control', url: url('', '0'), eval: CROSS, settle: 500, returns: true });
}
if (only.has('descent')) {
  jobs.push({ name: 'descent', url: url(), eval: DESCENT, settle: 500, returns: true });
  jobs.push({ name: 'descent-control', url: url('', '0'), eval: DESCENT, settle: 500, returns: true });
}
if (only.has('gpu')) jobs.push({ name: 'gpu', url: url(), eval: GPU, settle: 100000 });
const dir = mkdtempSync(join(tmpdir(), 'street-layer-test-'));
for (const j of jobs) {
  if (j.returns) j.result = join(dir, `${j.name}.result.json`);
}
const batch = join(dir, 'batch.json');
// --trace <dir>: a Chrome trace per job (main-thread tasks with JS samples, GC, GPU tasks) for attributing long frames.
const traceDir = opt('trace', null);
const TRACE_CATEGORIES = opt('trace-categories', 'devtools.timeline,disabled-by-default-devtools.timeline,v8.gc,disabled-by-default-v8.cpu_profiler,gpu,blink.user_timing,toplevel').split(',');
writeFileSync(batch, JSON.stringify(jobs.map(({ name, returns, ...j }) => ({ ...j, timeout: 300000, logs: true, ...(traceDir ? { trace: join(traceDir, `${name}.json`), traceCategories: TRACE_CATEGORIES } : {}) }))));
const out = JSON.parse(execFileSync('node', ['scripts/snap.mjs', '--batch', batch], { encoding: 'utf8', maxBuffer: 1 << 28 }));
const results = Array.isArray(out) ? out : [out];
writeFileSync(join(dir, 'out.json'), JSON.stringify(results, null, 1));

let failed = false;
const summary = {};
jobs.forEach((job, k) => {
  const r = results[k];
  const line = (r.logs || []).find((l) => l.startsWith('RESULT '));
  let res = line ? JSON.parse(line.slice(7)) : null;
  if (job.result) {
    try {
      res = JSON.parse(readFileSync(job.result, 'utf8'));
      if (res) {
        res.rowsFile = job.result;
        delete res.rows;
        delete res.bigUploads;
      }
    } catch {
      res = null;
    }
  }
  const errors = [...(r.errors || []), ...(r.warnings || []).filter((w) => !w.includes('will retry'))];
  // The shared dev server reloads the page when another agent saves a file: such a run measured nothing.
  const reloaded = (r.logs || []).filter((l) => l.startsWith('[vite] connecting')).length > 1;
  if (reloaded && !res) errors.push('page reloaded by the dev server (a file changed): rerun');
  let ok = !!res && errors.length === 0;
  if (res && job.name === 'flip') ok &&= res.bad.length === 0 && Object.values(res.layer).every((n) => n <= 1);
  if (res && job.name === 'pass') ok &&= res.bad.length === 0;
  if (res && job.name === 'gpu') ok &&= res.bad.length === 0 && res.checked > 0;
  failed ||= !ok;
  summary[job.name] = { ok, ...(res ? {} : { raw: join(dir, 'out.json') }), ...res, errors: errors.slice(0, 3) };
});
if (summary.pass && summary['pass-control']) {
  summary.pass.hitchesOverControl = summary.pass.over33 - summary['pass-control'].over33;
}
/**
 * Flight thresholds, trusted only when the street-off control on the same route is clean (the GPU is shared with
 * whoever plays on the machine; a noisy control makes the run inconclusive, exit code 2 when nothing failed).
 * - cross: the layer's update never over 12 ms, no frame over 50 ms with a layer cause (see layerHitches) and at most
 *   50 more frames over 50 ms than the control (the first 20 s look over Beyoğlu, where the GPU is saturated with or
 *   without the layer and the layer's ~2 ms of draw cost shows as extra missed vsyncs; 38 more on 2026-09-26).
 * - descent: the layer's update never over 12 ms, no frame over 50 ms with a layer cause, at most one more frame over
 *   50 ms than the control.
 */
const LIMITS = {
  cross: { controlOver50: 45, streetMax: 12, layerHitches: 0, over50OverControl: 50 },
  descent: { controlOver50: 3, streetMax: 12, layerHitches: 0, over50OverControl: 1 },
};
let inconclusive = false;
for (const [name, lim] of Object.entries(LIMITS)) {
  const run = summary[name];
  const control = summary[`${name}-control`];
  if (!run || !control || run.frames === undefined || control.frames === undefined) {
    continue;
  }
  const checks = {
    streetMax: run.streetMax <= lim.streetMax,
    layerHitches: run.layerHitches <= lim.layerHitches,
    over50OverControl: run.over50 - control.over50 <= lim.over50OverControl,
  };
  run.checks = checks;
  if (control.over50 > lim.controlOver50) {
    run.verdict = `inconclusive: control not clean (${control.over50} frames over 50 ms)`;
    inconclusive = true;
    continue;
  }
  const pass = Object.values(checks).every(Boolean);
  run.verdict = pass ? 'pass' : 'fail';
  run.ok &&= pass;
  failed ||= !pass;
}
console.log(JSON.stringify(summary, null, 1));
process.exit(failed ? 1 : inconclusive ? 2 : 0);
