#!/usr/bin/env node
/**
 * MetaHuman batch generator: builds the characters of a batch spec in the open Unreal editor, renders review images
 * and writes a contact sheet.
 *
 *   node tools/unreal/metahumans/generate.mjs [tools/unreal/metahumans/batch-01.json]
 *        [--only b01-01,b01-02] [--steps cache,create,edit|open,stage,prime,render,close,sheet] [--timeout 300]
 *        [--draw-wait 20]
 *
 * Every step is one short job for tools/unreal/run-job.mjs (the editor's game thread is blocked while a job runs).
 * Per character: create -> edit -> stage -> prime -> render -> close; a failed step is logged, the character is closed
 * and the run continues.
 * Hair, brows and beards only appear in the renders after the level viewport has drawn the staged actor once (prime),
 * and Unreal does not draw while its window is minimized or hidden: keep the editor window open (it may sit behind
 * other windows) during prime/render. Rows whose grooms could not be drawn are flagged in the log and the sheet.
 * Everything the steps produce is MetaHuman content and stays in private-assets/ (gitignored):
 *   private-assets/metahuman/cache/presets/   face model coefficients of the presets used as bases and donors
 *   private-assets/metahuman/<batch>.json     one log row per character (spec, asset path, images, step results)
 *   <spec.reviewDir>/                         <id>-portrait.png, <id>-body.png, index.html (contact sheet)
 * The cloud auto-rig and texture download are deliberately not part of this tool (they need the user's Epic sign-in).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TOOL_DIR, '../../..');
const RUN_JOB = join(ROOT, 'tools/unreal/run-job.mjs');
const CACHE_DIR = join(ROOT, 'private-assets/metahuman/cache/presets');
const JOB_DIR = join(ROOT, 'private-assets/metahuman/jobs');
const ALL_STEPS = ['cache', 'create', 'edit', 'stage', 'prime', 'render', 'close', 'sheet'];
// 'open' replaces 'edit' to re-render existing characters: --steps open,stage,prime,render,close,sheet

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const specPath = resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
  ?? join(TOOL_DIR, 'batch-01.json'));
const steps = opt('steps', ALL_STEPS.join(',')).split(',');
const only = opt('only', '') ? opt('only', '').split(',') : null;
const timeout = Number(opt('timeout', '300'));
const drawWait = Number(opt('draw-wait', '20'));

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const reviewDir = join(ROOT, spec.reviewDir);
const logPath = join(ROOT, spec.logFile);
const characters = spec.characters.filter((c) => !only || only.includes(c.id));
mkdirSync(JOB_DIR, { recursive: true });
mkdirSync(reviewDir, { recursive: true });
mkdirSync(dirname(logPath), { recursive: true });

const log = existsSync(logPath)
  ? JSON.parse(readFileSync(logPath, 'utf8'))
  : { batch: spec.batch, spec: relative(ROOT, specPath), characters: [], jobs: [] };
const saveLog = () => {
  log.updatedAt = new Date().toISOString();
  log.characters.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(logPath, `${JSON.stringify(log, null, 2)}\n`);
};
const row = (c) => {
  let r = log.characters.find((x) => x.id === c.id);
  if (!r) {
    r = { id: c.id, steps: {} };
    log.characters.push(r);
  }
  Object.assign(r, { label: c.label, spec: c, asset: `${spec.assetRoot}/${c.id}/${c.id}` });
  return r;
};

/** Runs evren_metahumans.<fn>(...fnArgs) as one editor job and returns the runner's JSON result. */
function job(name, fn, fnArgs) {
  const file = join(JOB_DIR, `${name}.py`);
  writeFileSync(file, [
    'import importlib, json, sys',
    `sys.path.insert(0, ${JSON.stringify(TOOL_DIR)})`,
    'import evren_metahumans as m',
    'importlib.reload(m)',
    `RESULT = m.${fn}(*json.loads(${JSON.stringify(JSON.stringify(fnArgs))}))`,
    '',
  ].join('\n'));
  const started = Date.now();
  const p = spawnSync('node', [RUN_JOB, file, '--timeout', String(timeout)], { encoding: 'utf8' });
  let out;
  try {
    out = JSON.parse(p.stdout);
  } catch {
    out = { ok: false, error: (p.stderr || p.stdout || 'no output').trim() };
  }
  out.wallSeconds = Math.round((Date.now() - started) / 100) / 10;
  log.jobs.push({ job: name, ok: out.ok, seconds: out.seconds ?? null, wallSeconds: out.wallSeconds, at: new Date().toISOString() });
  const status = out.ok ? 'ok' : 'FAILED';
  console.log(`${name.padEnd(22)} ${status.padEnd(6)} ${String(out.seconds ?? '-').padStart(7)} s${out.ok ? '' : `\n${out.error}`}`);
  return out;
}

// 1. Preset cache: every base and donor face must be read once from its preset.
if (steps.includes('cache')) {
  const presets = new Set();
  for (const c of characters) {
    presets.add(c.face.base);
    for (const donor of Object.keys(c.face.blend ?? {})) presets.add(donor);
  }
  for (const preset of [...presets].sort()) {
    if (existsSync(join(CACHE_DIR, `${preset}.json`))) continue;
    const r = job(`cache-${preset}`, 'step_cache_preset', [CACHE_DIR, preset]);
    if (!r.ok) process.exit(1);
  }
}

// 2. Characters, one at a time (a character stays open for editing from edit to close).
const charSteps = ['create', 'edit', 'open', 'stage', 'prime', 'render', 'close'].filter((s) => steps.includes(s));
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
for (const c of characters) {
  const r = row(c);
  for (const step of charSteps) {
    const sentinel = join(JOB_DIR, `draw-${c.id}.png`);
    if (step === 'prime') rmSync(sentinel, { force: true });
    const fnArgs = {
      create: [specPath, c.id],
      edit: [specPath, c.id, CACHE_DIR],
      open: [specPath, c.id],
      stage: [specPath, c.id],
      prime: [specPath, c.id, sentinel],
      render: [specPath, c.id, reviewDir],
      close: [specPath, c.id],
    }[step];
    const out = job(`${step}-${c.id}`, `step_${step}`, fnArgs);
    r.steps[step] = { ok: out.ok, seconds: out.seconds ?? null, at: new Date().toISOString(), ...(out.ok ? { result: out.result } : { error: out.error }) };
    if (step === 'prime' && out.ok) {
      const t0 = Date.now();
      while (!existsSync(sentinel) && Date.now() - t0 < drawWait * 1000) sleep(500);
      r.grooms = existsSync(sentinel) ? 'rendered' : 'missing';
      r.steps.prime.viewportDrawSeconds = r.grooms === 'rendered' ? Math.round((Date.now() - t0) / 100) / 10 : null;
      console.log(`  viewport draw: ${r.grooms === 'rendered' ? 'ok' : `none within ${drawWait} s (editor window minimized?)`}`);
    }
    if (step === 'render' && out.ok) {
      r.images = {
        portrait: `${spec.reviewDir}/${out.result.images.portrait}`,
        body: `${spec.reviewDir}/${out.result.images.body}`,
      };
    }
    saveLog();
    if (!out.ok) {
      if (step !== 'close' && charSteps.includes('close')) job(`close-${c.id}`, 'step_close', [specPath, c.id]);
      break;
    }
  }
}
saveLog();

// 3. Contact sheet.
if (steps.includes('sheet')) {
  writeFileSync(join(reviewDir, 'index.html'), contactSheet());
  console.log(`contact sheet: ${relative(ROOT, join(reviewDir, 'index.html'))}`);
}

function contactSheet() {
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const version = (file) => (existsSync(join(reviewDir, file)) ? Math.round(statSync(join(reviewDir, file)).mtimeMs) : 0);
  const cards = spec.characters.map((c) => {
    const portrait = `${c.id}-portrait.png`;
    const body = `${c.id}-body.png`;
    const has = version(portrait) && version(body);
    const hairMissing = log.characters.find((x) => x.id === c.id)?.grooms === 'missing';
    const pretty = (item) => item.replace(/^WI_[A-Za-z]+_[SML]_/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();
    const grooms = ['hair', 'beard', 'mustache'].filter((slot) => c.grooms?.[slot])
      .map((slot) => `${slot[0].toUpperCase()}${slot.slice(1)}: ${pretty(c.grooms[slot])}${/Goatee/.test(c.grooms[slot]) ? ' goatee' : ''}`)
      .join(' · ');
    const meta = [c.sex, c.age, c.build, `${c.heightCm} cm`, `eyes ${c.eyes}`].join(' · ');
    const face = [c.face.base, ...Object.entries(c.face.blend ?? {}).map(([k, w]) => `${k} ${Math.round(w * 100)}%`)].join(' + ');
    return `
    <li class="card${c.hero ? ' hero' : ''}" data-id="${esc(c.id)}">
      <div class="shots">
        ${has ? `<button type="button" class="shot portrait" data-full="${portrait}?v=${version(portrait)}" aria-label="Enlarge ${esc(c.id)} portrait"><img src="${portrait}?v=${version(portrait)}" alt="${esc(c.id)} portrait" loading="lazy" width="768" height="960"></button>
        <button type="button" class="shot body" data-full="${body}?v=${version(body)}" aria-label="Enlarge ${esc(c.id)} full body"><img src="${body}?v=${version(body)}" alt="${esc(c.id)} full body" loading="lazy" width="640" height="1280"></button>`
          : '<p class="missing">Not rendered yet</p>'}
      </div>
      <label class="pick">
        <input type="checkbox" value="${esc(c.id)}">
        <span class="text">
          <span class="id">${esc(c.id)}${c.hero ? ' <span class="badge">Hero</span>' : ''}</span>
          <span class="label">${esc(c.label)}</span>${hairMissing ? '\n          <span class="warn">Hair, brows and beard not rendered: re-run prime/render with the Unreal window open</span>' : ''}
          <span class="meta">${esc(meta)}</span>
          <span class="meta">${esc(grooms || 'no hair groom')}</span>
          <span class="meta faint">Face: ${esc(face)}</span>
        </span>
      </label>
    </li>`;
  }).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evren ${esc(spec.batch)} review</title>
<style>
  :root {
    --bg: #141517; --surface: #1d1f22; --surface-2: #26292d; --line: #33373c; --text: #eceae6; --muted: #a3a6ab;
    --faint: #7d8187; --accent: #e0a458; --accent-ink: #1b1409; --focus: #8ab4f8;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; -webkit-font-smoothing: antialiased; }
  header { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; padding: 14px 24px; background: rgb(20 21 23 / 0.92); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
  h1 { font-size: 17px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
  h1 small { color: var(--muted); font-weight: 400; margin-left: 8px; }
  .toolbar { display: flex; align-items: center; gap: 10px; margin-left: auto; }
  .count { color: var(--muted); font-variant-numeric: tabular-nums; min-width: 88px; text-align: right; }
  output { font: 13px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); max-width: 42ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button.action { font: inherit; font-weight: 600; border-radius: 8px; padding: 8px 14px; cursor: pointer; border: 1px solid var(--line); background: var(--surface-2); color: var(--text); transition: background-color 120ms, border-color 120ms, transform 80ms; }
  button.action:hover { border-color: #4a4f56; background: #2d3035; }
  button.action:active { transform: translateY(1px); }
  button.action.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  button.action.primary:hover { background: #eab26b; }
  button.action:disabled { opacity: 0.45; cursor: default; transform: none; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .note { margin: 16px 24px 0; color: var(--muted); font-size: 13px; max-width: 110ch; }
  ul.grid { list-style: none; margin: 0; padding: 20px 24px 48px; display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; transition: border-color 120ms, box-shadow 120ms; }
  .card:hover { border-color: #454a51; }
  .card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .shots { display: grid; grid-template-columns: 1fr 0.625fr; gap: 2px; background: #0e0f10; }
  .shot { display: block; padding: 0; border: 0; background: none; cursor: zoom-in; overflow: hidden; }
  .shot img { display: block; width: 100%; height: auto; object-fit: cover; aspect-ratio: 768 / 960; transition: transform 200ms ease-out; }
  .shot.body img { aspect-ratio: 1 / 2; }
  .shot:hover img { transform: scale(1.02); }
  .missing { margin: 0; padding: 60px 16px; color: var(--faint); text-align: center; grid-column: 1 / -1; }
  .pick { display: flex; gap: 12px; padding: 12px 14px 14px; cursor: pointer; align-items: flex-start; }
  .pick input { width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--accent); flex: none; cursor: pointer; }
  .text { display: grid; gap: 1px; min-width: 0; }
  .id { font: 600 14px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .label { font-weight: 500; }
  .meta { color: var(--muted); font-size: 13px; }
  .faint { color: var(--faint); }
  .warn { color: #f0b37e; font-size: 13px; }
  .badge { font: 600 11px/1 -apple-system, sans-serif; text-transform: uppercase; letter-spacing: 0.04em; background: var(--accent); color: var(--accent-ink); padding: 3px 6px; border-radius: 4px; margin-left: 6px; vertical-align: 1px; }
  dialog { padding: 0; border: 0; background: transparent; max-width: 96vw; max-height: 96vh; }
  dialog::backdrop { background: rgb(0 0 0 / 0.82); }
  dialog img { display: block; max-width: 96vw; max-height: 92vh; border-radius: 8px; }
  @media (max-width: 640px) {
    header { padding: 12px 16px; }
    .toolbar { margin-left: 0; width: 100%; }
    output { display: none; }
    ul.grid { padding: 16px; grid-template-columns: 1fr; }
    .note { margin: 12px 16px 0; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<header>
  <h1>Evren · ${esc(spec.batch)}<small>${spec.characters.length} characters</small></h1>
  <div class="toolbar">
    <output id="picked" aria-live="polite"></output>
    <span class="count" id="count">0 selected</span>
    <button type="button" class="action" id="clear" disabled>Clear</button>
    <button type="button" class="action primary" id="copy" disabled>Copy selection</button>
  </div>
</header>
<p class="note">${esc(spec.notes ?? '')} Click an image to enlarge it. Previews use the editor's synthesized skin textures; high-resolution textures and the rig come after selection.</p>
<ul class="grid">${cards}
</ul>
<dialog id="zoom"><img alt=""></dialog>
<script>
  const KEY = 'evren-${esc(spec.batch)}-selection';
  const boxes = [...document.querySelectorAll('.pick input')];
  const countEl = document.getElementById('count');
  const pickedEl = document.getElementById('picked');
  const copyBtn = document.getElementById('copy');
  const clearBtn = document.getElementById('clear');
  const selected = () => boxes.filter((b) => b.checked).map((b) => b.value);
  function render() {
    const ids = selected();
    countEl.textContent = ids.length + ' selected';
    pickedEl.textContent = ids.join(', ');
    copyBtn.disabled = clearBtn.disabled = ids.length === 0;
    boxes.forEach((b) => b.closest('.card').classList.toggle('selected', b.checked));
    try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch {}
  }
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '[]'); boxes.forEach((b) => { b.checked = saved.includes(b.value); }); } catch {}
  boxes.forEach((b) => b.addEventListener('change', render));
  clearBtn.addEventListener('click', () => { boxes.forEach((b) => { b.checked = false; }); render(); });
  copyBtn.addEventListener('click', async () => {
    const text = selected().join(', ');
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch {}
      ta.remove();
    }
    copyBtn.textContent = ok ? 'Copied' : 'Copy failed: select the ids above';
    setTimeout(() => { copyBtn.textContent = 'Copy selection'; }, 1600);
  });
  const zoom = document.getElementById('zoom');
  document.querySelectorAll('.shot').forEach((s) => s.addEventListener('click', () => {
    zoom.querySelector('img').src = s.dataset.full;
    zoom.querySelector('img').alt = s.getAttribute('aria-label').replace('Enlarge ', '');
    zoom.showModal();
  }));
  zoom.addEventListener('click', () => zoom.close());
  render();
</script>
</body>
</html>
`;
}
