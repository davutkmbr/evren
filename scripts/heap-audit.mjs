#!/usr/bin/env node
/**
 * JS heap audit: loads a game page headless, waits for streaming to settle, takes a V8 heap snapshot over CDP and
 * reports where the memory is (self size by constructor, retained size by owner with a retainer path, totals).
 *
 *   node scripts/heap-audit.mjs                                            # /?view=spawn&nohud=1, 25 s settle
 *   node scripts/heap-audit.mjs --url "/?view=galata&nohud=1" --name galata --settle 40000 --keep
 *   node scripts/heap-audit.mjs --url "/?view=galata&nohud=1" --compare .shots/heap/spawn   # run, then diff
 *   node scripts/heap-audit.mjs --compare .shots/heap/spawn .shots/heap/galata              # diff two summaries
 *   node scripts/heap-audit.mjs --snapshot .shots/heap/spawn/heap.heapsnapshot --name spawn-again  # re-analyse
 *
 * Options: --url, --name (default: the view param), --out <dir> (default .shots/heap/<name>/), --settle <ms>
 * (after ready + pending() === 0, default 25000), --eval <js> (run once ready, before the settle), --timeout <ms> (ready wait, default 90000), --keep (keep the raw
 * .heapsnapshot, often > 1 GB), --top N (retained owners, default 40), --all-owners (also list pass-through owners).
 * Output: <out>/summary.json and a markdown report on stdout.
 *
 * Method
 * - Waits like scripts/snap.mjs (GPU slot queue, shared dev server on 5199, 24 fps cap), then Runtime.getHeapUsage,
 *   HeapProfiler.collectGarbage and HeapProfiler.takeHeapSnapshot; chunks are streamed to disk.
 * - The snapshot is parsed as a byte stream into typed arrays (no JSON.parse of the whole file); node re-executes
 *   itself with a large old space (HEAP_AUDIT_NODE_MB, default 16384) for the string table.
 * - Dominators: Lengauer-Tarjan over the graph from the synthetic root, weak edges ignored. Retained size = sum of
 *   self sizes in the dominator subtree. Retainer path = BFS shortest path from the root, Window (shortcut) first.
 * - "Owners" skips pass-through nodes (one dominated child holds > 90 % of the retained size) so the list shows
 *   distinct holders; the child appears in their place.
 * - self sizes include ArrayBuffer backing stores ("system / JSArrayBufferData"): outside the V8 heap proper
 *   (Runtime.getHeapUsage) but counted in performance.memory.usedJSHeapSize. They get their own table, grouped by
 *   retainer path with indices folded, and are left out of the owners list (their holders appear there instead).
 */
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '..');

if (!process.env.HEAP_AUDIT_CHILD) {
  const mb = process.env.HEAP_AUDIT_NODE_MB ?? '16384';
  const r = spawnSync(process.execPath, [`--max-old-space-size=${mb}`, SELF, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, HEAP_AUDIT_CHILD: '1' },
  });
  process.exit(r.status ?? 1);
}

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const optList = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return [];
  const out = [];
  for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) out.push(args[j]);
  return out;
};
const BASE = opt('base', 'http://127.0.0.1:5199');
const MB = (b) => Math.round((b / 1048576) * 10) / 10;
const log = (...m) => console.error('[heap-audit]', ...m);

// ---------------------------------------------------------------------------------------------------------------
// Capture

async function capture(url, snapPath) {
  const { chromium } = await import('playwright-core');
  const { launchGpuBrowser, releaseSlot } = await import('./lib/gpu-slot.mjs');
  try {
    const r = await fetch(BASE + '/');
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    console.error(`Dev server not reachable at ${BASE}. Start it with: npm run dev`);
    process.exit(2);
  }
  log('waiting for a GPU slot');
  const browser = await launchGpuBrowser(chromium);
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let full = url.startsWith('http') ? url : BASE + url;
    if (!/[?&]fps=/.test(full)) full += (full.includes('?') ? '&' : '?') + `fps=${process.env.SNAP_FPS ?? '24'}`;
    const t0 = Date.now();
    await page.goto(full, { waitUntil: 'load', timeout: 60000 });
    const timeout = Number(opt('timeout', 90000));
    let s = { ready: false, pending: -1 };
    while (Date.now() - t0 < timeout) {
      s = await page
        .evaluate(() => {
          const a = window.__evren;
          return a ? { ready: a.ready, pending: a.pending() } : { ready: false, pending: -1 };
        })
        .catch(() => ({ ready: false, pending: -1 }));
      if (s.ready && s.pending === 0) break;
      await page.waitForTimeout(250);
    }
    // --eval <js>: run in the page once ready (e.g. move the camera: `__evren.shot(x, y, z, heading, pitch, fov)`).
    if (opt('eval')) {
      await page.evaluate(opt('eval'));
    }
    const settle = Number(opt('settle', 25000));
    log(`ready=${s.ready} pending=${s.pending} after ${Date.now() - t0} ms; settling ${settle} ms`);
    await page.waitForTimeout(settle);
    // Streaming may restart during the settle window; give it a bounded extra wait.
    const t1 = Date.now();
    while (Date.now() - t1 < 30000) {
      const p = await page.evaluate(() => window.__evren?.pending?.() ?? 0).catch(() => 0);
      if (p === 0) break;
      await page.waitForTimeout(500);
    }
    const stats = await page.evaluate(() => (window.__evren?.stats ? window.__evren.stats() : null)).catch(() => null);
    const cdp = await page.context().newCDPSession(page);
    const before = await cdp.send('Runtime.getHeapUsage');
    // performance.memory.usedJSHeapSize (what the game's HUD / reports quote) includes ArrayBuffer backing stores.
    const perfMem = await page.evaluate(() => (performance.memory ? { used: performance.memory.usedJSHeapSize, limit: performance.memory.jsHeapSizeLimit } : null)).catch(() => null);
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    const afterGc = await cdp.send('Runtime.getHeapUsage');
    log(`heap used ${MB(before.usedSize)} MB, after GC ${MB(afterGc.usedSize)} MB; taking snapshot`);
    mkdirSync(dirname(snapPath), { recursive: true });
    const fd = openSync(snapPath, 'w');
    let bytes = 0;
    cdp.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => {
      bytes += writeSync(fd, chunk);
    });
    const t2 = Date.now();
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
    closeSync(fd);
    log(`snapshot ${MB(bytes)} MB written in ${Math.round((Date.now() - t2) / 1000)} s`);
    await page.close();
    return {
      url,
      ready: s.ready,
      pending: s.pending,
      loadMs: Date.now() - t0,
      heapUsedMB: MB(before.usedSize),
      heapUsedAfterGcMB: MB(afterGc.usedSize),
      heapTotalMB: MB(afterGc.totalSize),
      perfMemoryUsedMB: perfMem ? MB(perfMem.used) : null,
      perfMemoryLimitMB: perfMem ? MB(perfMem.limit) : null,
      stats,
      errors: errors.slice(0, 10),
    };
  } finally {
    await browser.close();
    releaseSlot();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Streaming snapshot parser

class ByteReader {
  constructor(path) {
    this.fd = openSync(path, 'r');
    this.buf = Buffer.allocUnsafe(1 << 24);
    this.pos = 0;
    this.len = 0;
    this.eof = false;
  }
  /** Refills the buffer, keeping unread bytes. Returns false at end of file. */
  fill() {
    if (this.eof) return false;
    if (this.pos < this.len) this.buf.copy(this.buf, 0, this.pos, this.len);
    this.len -= this.pos;
    this.pos = 0;
    if (this.len === this.buf.length) {
      const b = Buffer.allocUnsafe(this.buf.length * 2);
      this.buf.copy(b, 0, 0, this.len);
      this.buf = b;
    }
    const n = readSync(this.fd, this.buf, this.len, this.buf.length - this.len, null);
    if (n === 0) this.eof = true;
    this.len += n;
    return n > 0;
  }
  /** Advances past the next occurrence of `marker`; returns the text before it (only kept when `keep`). */
  skipPast(marker, keep = false) {
    const m = Buffer.from(marker);
    let text = '';
    for (;;) {
      const i = this.buf.indexOf(m, this.pos);
      if (i >= 0 && i + m.length <= this.len) {
        if (keep) text += this.buf.toString('utf8', this.pos, i);
        this.pos = i + m.length;
        return text;
      }
      // keep the tail that could hold a partial marker
      const keepFrom = Math.max(this.pos, this.len - m.length);
      if (keep) text += this.buf.toString('utf8', this.pos, keepFrom);
      this.pos = keepFrom;
      if (!this.fill()) throw new Error(`marker ${marker} not found`);
    }
  }
  /** Reads a JSON array of non-negative integers (opening bracket already consumed) into `out`. */
  readUints(out) {
    let k = 0;
    let v = 0;
    let inNum = false;
    for (;;) {
      if (this.pos >= this.len && !this.fill()) throw new Error('unexpected end of numbers');
      const buf = this.buf;
      const len = this.len;
      let p = this.pos;
      while (p < len) {
        const c = buf[p++];
        if (c >= 48 && c <= 57) {
          v = v * 10 + (c - 48);
          inNum = true;
        } else {
          if (inNum) {
            out[k++] = v;
            v = 0;
            inNum = false;
          }
          if (c === 93) {
            this.pos = p;
            return k;
          }
        }
      }
      this.pos = p;
    }
  }
  /** Reads a JSON array of strings (opening bracket consumed). */
  readStrings() {
    const out = [];
    let scratch = Buffer.allocUnsafe(1 << 16);
    for (;;) {
      // find next quote or closing bracket
      let c;
      for (;;) {
        if (this.pos >= this.len && !this.fill()) throw new Error('unexpected end of strings');
        c = this.buf[this.pos++];
        if (c === 34 || c === 93) break;
      }
      if (c === 93) return out;
      let n = 0;
      let escaped = false;
      for (;;) {
        if (this.pos >= this.len && !this.fill()) throw new Error('unterminated string');
        const b = this.buf[this.pos++];
        if (b === 92) {
          escaped = true;
          if (this.pos >= this.len) this.fill();
          if (n + 2 > scratch.length) scratch = grow(scratch, n);
          scratch[n++] = b;
          scratch[n++] = this.buf[this.pos++];
          continue;
        }
        if (b === 34) break;
        if (n + 1 > scratch.length) scratch = grow(scratch, n);
        scratch[n++] = b;
      }
      const s = scratch.toString('utf8', 0, n);
      out.push(escaped ? JSON.parse('"' + s + '"') : s);
    }
  }
  close() {
    closeSync(this.fd);
  }
}

function grow(b, used) {
  const nb = Buffer.allocUnsafe(b.length * 2);
  b.copy(nb, 0, 0, used);
  return nb;
}

function parseSnapshot(path) {
  const r = new ByteReader(path);
  r.fill();
  const header = r.skipPast('"nodes":[', true).replace(/,\s*$/, '');
  const snap = JSON.parse(header + '}').snapshot;
  const meta = snap.meta;
  const nf = meta.node_fields.length;
  const ef = meta.edge_fields.length;
  const nodes = new Uint32Array(snap.node_count * nf);
  const nn = r.readUints(nodes);
  if (nn !== nodes.length) throw new Error(`node array length ${nn} != ${nodes.length}`);
  r.skipPast('"edges":[');
  const edges = new Uint32Array(snap.edge_count * ef);
  const ne = r.readUints(edges);
  if (ne !== edges.length) throw new Error(`edge array length ${ne} != ${edges.length}`);
  r.skipPast('"strings":[');
  const strings = r.readStrings();
  r.close();
  return { meta, nodeCount: snap.node_count, edgeCount: snap.edge_count, nodes, edges, strings };
}

// ---------------------------------------------------------------------------------------------------------------
// Analysis

function analyse(s, topN, allOwners) {
  const { meta, nodeCount: N, nodes, edges, strings } = s;
  const nf = meta.node_fields.length;
  const ef = meta.edge_fields.length;
  const nType = meta.node_fields.indexOf('type');
  const nName = meta.node_fields.indexOf('name');
  const nSize = meta.node_fields.indexOf('self_size');
  const nEdges = meta.node_fields.indexOf('edge_count');
  const eType = meta.edge_fields.indexOf('type');
  const eName = meta.edge_fields.indexOf('name_or_index');
  const eTo = meta.edge_fields.indexOf('to_node');
  const nodeTypes = meta.node_types[nType];
  const edgeTypes = meta.edge_types[eType];
  const ET = Object.fromEntries(edgeTypes.map((t, i) => [t, i]));
  const NT = Object.fromEntries(nodeTypes.map((t, i) => [t, i]));

  const type = (n) => nodes[n * nf + nType];
  const name = (n) => strings[nodes[n * nf + nName]];
  const size = (n) => nodes[n * nf + nSize];

  // first edge (edge ordinal) per node
  const firstEdge = new Uint32Array(N + 1);
  for (let n = 0; n < N; n++) firstEdge[n + 1] = firstEdge[n] + nodes[n * nf + nEdges];
  const E = firstEdge[N];
  const edgeTo = (e) => edges[e * ef + eTo] / nf;
  const weak = ET.weak;
  const essential = (e) => edges[e * ef + eType] !== weak;

  // class key for the self-size table
  const classOf = (n) => {
    const t = nodeTypes[type(n)];
    const nm = name(n);
    switch (t) {
      case 'object':
      case 'native':
        return nm.length > 80 ? nm.slice(0, 80) + '…' : nm;
      case 'closure':
        return '(closure)';
      case 'string':
      case 'concatenated string':
      case 'sliced string':
        return '(string)';
      case 'code':
        return '(compiled code)';
      case 'array':
        return `(array) ${nm.length > 40 ? nm.slice(0, 40) + '…' : nm}`.trim();
      case 'hidden':
        return `(system) ${nm.length > 40 ? nm.slice(0, 40) + '…' : nm}`.trim();
      case 'number':
        return '(number)';
      case 'regexp':
        return 'RegExp';
      case 'object shape':
        return '(object shape)';
      default:
        return `(${t})`;
    }
  };

  // --- totals and constructor table
  const byClass = new Map();
  const totals = { all: 0, strings: 0, jsArrays: 0, internalArrays: 0, backingStores: 0, typedArrayObjects: 0, closures: 0, code: 0, objectShapes: 0, numbers: 0, native: 0, other: 0 };
  const typedArrayNames = new Set(['Float32Array', 'Float64Array', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Uint8ClampedArray', 'BigInt64Array', 'BigUint64Array', 'DataView', 'ArrayBuffer', 'SharedArrayBuffer']);
  for (let n = 0; n < N; n++) {
    const sz = size(n);
    const t = nodeTypes[type(n)];
    const nm = name(n);
    totals.all += sz;
    if (t === 'string' || t === 'concatenated string' || t === 'sliced string') totals.strings += sz;
    else if (t === 'array') totals.internalArrays += sz;
    else if (t === 'closure') totals.closures += sz;
    else if (t === 'code') totals.code += sz;
    else if (t === 'object shape') totals.objectShapes += sz;
    else if (t === 'number' || t === 'hidden' && nm === 'system / HeapNumber') totals.numbers += sz;
    else if (t === 'native' && nm.startsWith('system / JSArrayBufferData')) totals.backingStores += sz;
    else if (t === 'native') totals.native += sz;
    else if (t === 'object' && nm === 'Array') totals.jsArrays += sz;
    else if (t === 'object' && typedArrayNames.has(nm)) totals.typedArrayObjects += sz;
    else totals.other += sz;
    if (t === 'synthetic') continue;
    const k = classOf(n);
    let c = byClass.get(k);
    if (!c) byClass.set(k, (c = { name: k, count: 0, self: 0 }));
    c.count++;
    c.self += sz;
  }

  // --- DFS from the root (node 0) over essential edges; dfs numbers 0..R-1
  const NONE = 0xffffffff;
  const dfnum = new Uint32Array(N).fill(NONE);
  const vertex = new Uint32Array(N);
  const parentDf = new Uint32Array(N);
  {
    const stackN = new Uint32Array(N);
    const stackE = new Uint32Array(N);
    let sp = 0;
    let R = 0;
    dfnum[0] = R;
    vertex[R++] = 0;
    stackN[0] = 0;
    stackE[0] = firstEdge[0];
    sp = 1;
    while (sp > 0) {
      const n = stackN[sp - 1];
      const e = stackE[sp - 1];
      if (e >= firstEdge[n + 1]) {
        sp--;
        continue;
      }
      stackE[sp - 1] = e + 1;
      if (!essential(e)) continue;
      const m = edgeTo(e);
      if (dfnum[m] !== NONE) continue;
      dfnum[m] = R;
      vertex[R] = m;
      parentDf[R] = dfnum[n];
      R++;
      stackN[sp] = m;
      stackE[sp] = firstEdge[m];
      sp++;
    }
    s.reachable = R;
  }
  const R = s.reachable;

  // predecessors (dfs-number space) of reachable nodes
  const predStart = new Uint32Array(R + 1);
  for (let n = 0; n < N; n++) {
    if (dfnum[n] === NONE) continue;
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) if (essential(e)) predStart[dfnum[edgeTo(e)] + 1]++;
  }
  for (let i = 0; i < R; i++) predStart[i + 1] += predStart[i];
  const preds = new Uint32Array(predStart[R]);
  {
    const fillPos = predStart.slice(0, R);
    for (let n = 0; n < N; n++) {
      const dn = dfnum[n];
      if (dn === NONE) continue;
      for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) if (essential(e)) preds[fillPos[dfnum[edgeTo(e)]]++] = dn;
    }
  }

  // Lengauer-Tarjan (simple version with path compression), all arrays indexed by dfs number
  const semi = new Uint32Array(R);
  const ancestor = new Uint32Array(R).fill(NONE);
  const best = new Uint32Array(R);
  const idom = new Uint32Array(R);
  const samedom = new Uint32Array(R).fill(NONE);
  const bucketHead = new Uint32Array(R).fill(NONE);
  const bucketNext = new Uint32Array(R).fill(NONE);
  for (let i = 0; i < R; i++) best[i] = i;
  const chain = new Uint32Array(R);
  const awls = (v) => {
    let k = 0;
    let x = v;
    while (ancestor[ancestor[x]] !== NONE) {
      chain[k++] = x;
      x = ancestor[x];
    }
    while (k > 0) {
      const y = chain[--k];
      const a = ancestor[y];
      const b = best[a];
      ancestor[y] = ancestor[a];
      if (semi[b] < semi[best[y]]) best[y] = b;
    }
    return best[v];
  };
  for (let n = R - 1; n >= 1; n--) {
    const p = parentDf[n];
    let sd = p;
    for (let j = predStart[n]; j < predStart[n + 1]; j++) {
      const v = preds[j];
      const s2 = v <= n ? v : semi[awls(v)];
      if (s2 < sd) sd = s2;
    }
    semi[n] = sd;
    bucketNext[n] = bucketHead[sd];
    bucketHead[sd] = n;
    ancestor[n] = p;
    for (let v = bucketHead[p]; v !== NONE; v = bucketNext[v]) {
      const y = awls(v);
      if (semi[y] === semi[v]) idom[v] = p;
      else samedom[v] = y;
    }
    bucketHead[p] = NONE;
  }
  for (let n = 1; n < R; n++) if (samedom[n] !== NONE) idom[n] = idom[samedom[n]];

  // retained sizes
  const retained = new Float64Array(R);
  for (let i = 0; i < R; i++) retained[i] = size(vertex[i]);
  for (let i = R - 1; i >= 1; i--) retained[idom[i]] += retained[i];
  // biggest dominated child per node (pass-through detection)
  const bigChild = new Float64Array(R);
  for (let i = 1; i < R; i++) if (retained[i] > bigChild[idom[i]]) bigChild[idom[i]] = retained[i];

  let unreachable = 0;
  for (let n = 0; n < N; n++) if (dfnum[n] === NONE) unreachable += size(n);

  // --- BFS retainer paths from the root; the root's shortcut edges (Window) first
  const bfsParent = new Uint32Array(N).fill(NONE);
  const bfsEdge = new Uint32Array(N);
  {
    const q = new Uint32Array(N);
    let qh = 0;
    let qt = 0;
    bfsParent[0] = 0;
    const visit = (from, e) => {
      const m = edgeTo(e);
      if (bfsParent[m] !== NONE) return;
      bfsParent[m] = from;
      bfsEdge[m] = e;
      q[qt++] = m;
    };
    for (let e = firstEdge[0]; e < firstEdge[1]; e++) if (edges[e * ef + eType] === ET.shortcut) visit(0, e);
    for (let e = firstEdge[0]; e < firstEdge[1]; e++) if (essential(e)) visit(0, e);
    const hidden = ET.hidden;
    // two passes per level would be exact; one queue that prefers visible edges is close enough
    while (qh < qt) {
      const n = q[qh++];
      for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) if (essential(e) && edges[e * ef + eType] !== hidden) visit(n, e);
      for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) if (edges[e * ef + eType] === hidden) visit(n, e);
    }
  }
  const edgeLabel = (e) => {
    const t = edgeTypes[edges[e * ef + eType]];
    const v = edges[e * ef + eName];
    if (t === 'element') return `[${v}]`;
    if (t === 'hidden') return `[#${v}]`;
    if (t === 'shortcut') return '';
    const nm = strings[v];
    if (t === 'context') return `::${nm}`;
    if (t === 'internal') return `.<${nm}>`;
    return /^[A-Za-z_$][\w$]*$/.test(nm) ? `.${nm}` : `[${JSON.stringify(nm.length > 40 ? nm.slice(0, 40) + '…' : nm)}]`;
  };
  const pathOf = (n) => {
    const hops = [];
    let x = n;
    let guard = 0;
    while (x !== 0 && bfsParent[x] !== NONE && guard++ < 10000) {
      hops.push({ label: edgeLabel(bfsEdge[x]), node: x });
      x = bfsParent[x];
    }
    if (bfsParent[n] === NONE) return '(unreachable by BFS)';
    hops.reverse();
    // the first hop from the root names the root child (Window, (GC roots), ...)
    const parts = [];
    for (let i = 0; i < hops.length; i++) {
      const h = hops[i];
      if (i === 0) {
        const nm = name(h.node);
        parts.push(nm.startsWith('Window') ? 'Window' : nm);
        continue;
      }
      let lab = h.label;
      const t = nodeTypes[type(h.node)];
      const cls = name(h.node);
      if (t === 'closure') lab += `{fn ${cls || 'anon'}}`;
      else if (t === 'object' && cls !== 'Object' && cls !== 'Array' && !cls.startsWith('system') && (i === hops.length - 1 || /^(Map|Set|WeakMap)$/.test(cls))) lab += `{${cls.length > 30 ? cls.slice(0, 30) + '…' : cls}}`;
      parts.push(lab);
    }
    let p = parts.length > 26 ? parts.slice(0, 10).join('') + ' … ' + parts.slice(-15).join('') : parts.join('');
    p = p.replace(/^.*?\.<global_object>/, 'window').replace(/\.<\d+ \/ part of key \(([^ ]+) @\d+\) -> value \([^)]*\) pair in WeakMap \(table @\d+\)>/g, '.<WeakMap[$1]>');
    return p;
  };

  // --- top retained owners
  const order = [];
  for (let i = 1; i < R; i++) {
    const n = vertex[i];
    const t = nodeTypes[type(n)];
    if (t === 'synthetic') continue;
    if (retained[i] < 4 * 1048576) continue;
    if (!allOwners && bigChild[i] > 0.9 * retained[i]) continue;
    if (!allOwners && name(n).startsWith('system / JSArrayBufferData')) continue;
    order.push(i);
  }
  // ArrayBuffer backing stores grouped by their normalized retainer path (indices and map slots folded)
  const stores = new Map();
  const abName = 'system / JSArrayBufferData';
  for (let i = 1; i < R; i++) {
    const n = vertex[i];
    if (!name(n).startsWith(abName) || size(n) === 0) continue;
    const k = pathOf(n)
      .replace(/\.<buffer>\.<backing_store>$/, '')
      .replace(/\[\d+\]/g, '[*]')
      .replace(/\.<\d+>/g, '.<*>')
      .replace(/\[#\d+\]/g, '[#*]');
    let g = stores.get(k);
    if (!g) stores.set(k, (g = { path: k, count: 0, bytes: 0 }));
    g.count++;
    g.bytes += size(n);
  }
  const backingStores = [...stores.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 60).map((g) => ({ path: g.path, count: g.count, MB: MB(g.bytes) }));
  order.sort((a, b) => retained[b] - retained[a]);
  const owners = order.slice(0, topN).map((i) => {
    const n = vertex[i];
    return {
      retainedMB: MB(retained[i]),
      selfMB: MB(size(n)),
      type: nodeTypes[type(n)],
      name: classOf(n),
      id: nodes[n * nf + meta.node_fields.indexOf('id')],
      path: pathOf(n),
    };
  });

  // root children (Window, GC roots, ...) for orientation
  const rootKids = [];
  for (let i = 1; i < R; i++) if (idom[i] === 0) rootKids.push(i);
  rootKids.sort((a, b) => retained[b] - retained[a]);
  const roots = rootKids.slice(0, 10).map((i) => ({ name: name(vertex[i]).slice(0, 80), type: nodeTypes[type(vertex[i])], retainedMB: MB(retained[i]) }));

  const classes = [...byClass.values()].sort((a, b) => b.self - a.self).slice(0, 100).map((c) => ({ name: c.name, count: c.count, selfMB: MB(c.self) }));
  const T = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k + 'MB', MB(v)]));
  T.jsHeapMB = MB(totals.all - totals.backingStores - totals.native);
  T.unreachableMB = MB(unreachable);
  return { nodes: N, edges: E, reachable: R, totals: T, roots, classes, owners, backingStores };
}

// ---------------------------------------------------------------------------------------------------------------
// Reporting

function markdown(sum, top) {
  const L = [];
  L.push(`# Heap audit: ${sum.name}`);
  L.push('');
  if (sum.page) {
    L.push(`URL \`${sum.page.url}\` — V8 heap used ${sum.page.heapUsedMB} MB, after GC ${sum.page.heapUsedAfterGcMB} MB (V8 total ${sum.page.heapTotalMB} MB); performance.memory.usedJSHeapSize ${sum.page.perfMemoryUsedMB} MB of ${sum.page.perfMemoryLimitMB} MB`);
  }
  L.push(`Snapshot: ${sum.nodes.toLocaleString('en')} nodes, ${sum.edges.toLocaleString('en')} edges, reachable ${sum.reachable.toLocaleString('en')}`);
  L.push('');
  L.push('## Totals (MB)');
  L.push('');
  L.push('| bucket | MB |');
  L.push('|---|---:|');
  for (const [k, v] of Object.entries(sum.totals)) L.push(`| ${k.replace(/MB$/, '')} | ${v} |`);
  L.push('');
  L.push('## Root children (dominator tree)');
  L.push('');
  L.push('| name | type | retained MB |');
  L.push('|---|---|---:|');
  for (const r of sum.roots) L.push(`| ${esc(r.name)} | ${r.type} | ${r.retainedMB} |`);
  L.push('');
  L.push(`## Top ${top} retained owners`);
  L.push('');
  L.push('| # | retained MB | self MB | class | retainer path |');
  L.push('|---:|---:|---:|---|---|');
  sum.owners.forEach((o, i) => L.push(`| ${i + 1} | ${o.retainedMB} | ${o.selfMB} | ${esc(o.name)} | \`${o.path.replace(/`/g, "'").replace(/\|/g, '\\|')}\` |`));
  L.push('');
  L.push('## ArrayBuffer backing stores by path (top 30, indices folded)');
  L.push('');
  L.push('| # | MB | buffers | retainer path |');
  L.push('|---:|---:|---:|---|');
  (sum.backingStores ?? []).slice(0, 30).forEach((g, i) => L.push(`| ${i + 1} | ${g.MB} | ${g.count} | \`${g.path.replace(/`/g, "'").replace(/\|/g, '\\|')}\` |`));
  L.push('');
  L.push('## Self size by constructor (top 50)');
  L.push('');
  L.push('| # | constructor | count | self MB |');
  L.push('|---:|---|---:|---:|');
  sum.classes.slice(0, 50).forEach((c, i) => L.push(`| ${i + 1} | ${esc(c.name)} | ${c.count.toLocaleString('en')} | ${c.selfMB} |`));
  return L.join('\n');
}

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function compare(a, b) {
  const L = [];
  L.push(`# Heap diff: ${a.name} → ${b.name}`);
  L.push('');
  if (a.page && b.page) L.push(`Used after GC: ${a.page.heapUsedAfterGcMB} → ${b.page.heapUsedAfterGcMB} MB`);
  L.push('');
  L.push('| total | A MB | B MB | Δ MB |');
  L.push('|---|---:|---:|---:|');
  for (const k of Object.keys(b.totals)) L.push(`| ${k.replace(/MB$/, '')} | ${a.totals[k] ?? '-'} | ${b.totals[k]} | ${r1(b.totals[k] - (a.totals[k] ?? 0))} |`);
  const diffTable = (title, la, lb, key, val, cols) => {
    const m = new Map();
    for (const x of la) m.set(key(x), { a: val(x), b: 0 });
    for (const x of lb) {
      const e = m.get(key(x)) ?? { a: 0, b: 0 };
      e.b = val(x);
      m.set(key(x), e);
    }
    const rows = [...m.entries()].map(([k, v]) => ({ k, ...v, d: v.b - v.a })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 25);
    L.push('');
    L.push(`## ${title}`);
    L.push('');
    L.push(`| ${cols} | A MB | B MB | Δ MB |`);
    L.push('|---|---:|---:|---:|');
    for (const r of rows) L.push(`| ${esc(r.k)} | ${r.a} | ${r.b} | ${r1(r.d)} |`);
  };
  diffTable('Constructors (self size)', a.classes, b.classes, (c) => c.name, (c) => c.selfMB, 'constructor');
  diffTable('Backing stores (by path)', a.backingStores ?? [], b.backingStores ?? [], (g) => g.path, (g) => g.MB, 'path');
  diffTable('Owners (retained, by path)', a.owners, b.owners, (o) => o.path, (o) => o.retainedMB, 'path');
  return L.join('\n');
}
const r1 = (x) => Math.round(x * 10) / 10;

// ---------------------------------------------------------------------------------------------------------------
// Main

const cmp = optList('compare');
const runs = opt('url') !== undefined || opt('snapshot') !== undefined || cmp.length < 2;
if (!runs) {
  const [a, b] = cmp.map((d) => JSON.parse(readFileSync(join(d, 'summary.json'), 'utf8')));
  console.log(compare(a, b));
  process.exit(0);
}

const url = opt('url', '/?view=spawn&nohud=1');
const name = opt('name', new URLSearchParams(url.split('?')[1] ?? '').get('view') ?? 'page');
const out = resolve(opt('out', join(ROOT, '.shots/heap', name)));
const top = Number(opt('top', 40));
mkdirSync(out, { recursive: true });

let page = null;
let snapPath = opt('snapshot');
const external = !!snapPath;
if (!snapPath) {
  snapPath = join(out, 'heap.heapsnapshot');
  page = await capture(url, snapPath);
}
const t0 = Date.now();
log(`parsing ${MB(statSync(snapPath).size)} MB`);
const parsed = parseSnapshot(snapPath);
log(`parsed ${parsed.nodeCount} nodes / ${parsed.edgeCount} edges / ${parsed.strings.length} strings in ${Math.round((Date.now() - t0) / 1000)} s`);
const res = analyse(parsed, top, args.includes('--all-owners'));
log(`analysed in ${Math.round((Date.now() - t0) / 1000)} s`);
const summary = { name, date: new Date().toISOString(), page, snapshot: external ? snapPath : undefined, ...res };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 1));
if (!external && !args.includes('--keep') && existsSync(snapPath)) rmSync(snapPath);
console.log(markdown(summary, top));
if (cmp.length) {
  const a = JSON.parse(readFileSync(join(cmp[0], 'summary.json'), 'utf8'));
  console.log('\n' + compare(a, summary));
}
log(`summary: ${join(out, 'summary.json')}`);
