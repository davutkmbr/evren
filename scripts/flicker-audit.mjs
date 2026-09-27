#!/usr/bin/env node
/**
 * Temporal flicker audit: steps the camera deterministically, captures consecutive frames and counts pixels whose
 * luminance spikes up-down or down-up across three frames (after compensating the camera motion).
 * Findings and the bisection table: .docs/planning/flicker-audit.md.
 *
 *   node scripts/flicker-audit.mjs --scene night-hisar                       # scene(s) of scripts/flicker-scenes.json
 *   node scripts/flicker-audit.mjs --scene all --toggles all                 # baseline + one run per bisect toggle
 *   node scripts/flicker-audit.mjs --scene sea-dusk --toggles "wrefl=sky,dynres=0,hide:city-lamps,pass:clouds"
 *   node scripts/flicker-audit.mjs --url "/?view=bogaz&t=19" --motion yaw:0.2 --frames 48 --name adhoc
 *   node scripts/flicker-audit.mjs --scene night-hisar --worktree [dir]      # serve a checkout's src/ (default: this one)
 *
 * Toggles (one run each): URL params (`wrefl=sky`, `dynres=0`, `shadows=0`, `wfade=0`, ...), `hide:<name>[+<name>]`
 * (scene objects by name, `prefix*` allowed) and `pass:<name>` (post HDR passes: clouds, weather, fx-particles).
 * Options: --frames N, --motion yaw:<deg>|fly:<m>|still, --threshold <luma>, --tag <suffix>, --no-baseline,
 * --animate (simulation clock runs), --clock real (wall-time frames: dynamic resolution reacts), --w/--h,
 * --only <name>[+<name>] (everything else hidden), --dump (all frames as PNG), --zoom x,y [--zoom-size px],
 * --blame N (binary search for the object behind the N hottest pixels), --blame-at x,y,frame,
 * --events (drawables that appear / disappear per frame), --mirror [lod|depth|bad] (capture the water's planar
 * reflection; `bad` counts non-finite / over-range texels and finds the object that writes them),
 * --pre <js>|@file (evaluated in the page first, e.g. shader probes), --post <js>|@file (after the capture, returned),
 * --carry <name> (the object keeps its start pose relative to the camera: a chase camera).
 *
 * Method
 * - The page runs with ?fps=0&freeze=1&nohud=1&grain=0; the engine's rAF loop is stopped and frames are stepped by
 *   hand with a fixed 1/60 s clock. freeze=1 stops the simulation clock (waves, traffic) so only the camera moves.
 * - The camera is placed with __evren.shot() every frame (yaw sweep: heading += step; fly: position += step along the
 *   view). After each frame the canvas is read back (sRGB, Rec.709 luma, 0..255); fly-throughs also read the scene
 *   depth (16-bit log distance).
 * - Frames i-1 and i+1 are reprojected onto frame i: by the camera rotation, and for fly-throughs by the translation
 *   through the depth. A pixel of frame i is unstable when its luma lies more than --threshold above the 3x3 maximum
 *   (or below the 3x3 minimum) of BOTH neighbours: a spike that neither edge motion (<1 px) nor resampling can
 *   produce. Under a pure rotation a stable renderer draws every world point identically (the view vector of a point
 *   does not change), so every unstable pixel of a yaw sweep is an artefact.
 * - Regions: depth debug view (sky = no depth) and the same view with the water mesh hidden (sea = depth changes),
 *   measured at the first, middle and last pose.
 *
 * Output (.shots/flicker/<scene>/<run>/): heat.png (heatmap over the middle frame), frame.png, worst.jpg (the three
 * frames around the worst triple), zoom.png (the densest block through 8 frames), count.u16 (per-pixel counts),
 * summary.json; plus .shots/flicker/<scene>/summary.json and a markdown table on stdout. Scores: `rate` = unstable
 * pixel-frames / (pixels x triples) in per mille, `share` = % of pixels unstable at least once; per region
 * (all/sea/land/sky).
 * Uses the GPU slot and the shared dev server (port 5199) like scripts/snap.mjs.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireSlot, releaseSlot, chromeLaunchOptions } from './lib/gpu-slot.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const has = (name) => args.includes(`--${name}`);
const BASE = opt('base', 'http://127.0.0.1:5199');

/** One URL toggle per bisect run (see .docs/planning/flicker-audit.md). */
export const BISECT_TOGGLES = ['wrefl=sky', 'dynres=0', 'osmfar=0', 'osmregions=0', 'street=0', 'traffic=0', 'walls=0', 'bloom=0', 'aa=none', 'aa=fxaa', 'aa=smaa', 'flare=0', 'shadows=0', 'wfade=0'];

function loadScenes() {
  return JSON.parse(readFileSync(join(ROOT, 'scripts/flicker-scenes.json'), 'utf8'));
}

function parseMotion(s) {
  const [type, step] = String(s).split(':');
  if (type !== 'yaw' && type !== 'fly' && type !== 'still') {
    throw new Error(`--motion must be yaw:<deg>, fly:<m> or still (got ${s})`);
  }
  return { type, step: Number(step ?? 0) };
}

/** Page URL: the shared server's app, or this checkout's src/ through a shim page (--worktree). */
function pageUrl(query) {
  let path = '/';
  if (has('worktree')) {
    // --worktree [dir]: the checkout whose src/ is served (default: this one); it must live below the server's root.
    const arg = opt('worktree');
    const src = arg && !arg.startsWith('--') ? resolve(arg) : ROOT;
    const shimDir = join(src, '.shots/wt');
    mkdirSync(shimDir, { recursive: true });
    const html = readFileSync(join(src, 'index.html'), 'utf8').replace('src="/src/main.ts"', 'src="../../src/main.ts"');
    writeFileSync(join(shimDir, 'index.html'), html);
    // The shared server's root is the main checkout; a worktree lives below it.
    const serverRoot = opt('server-root', resolve(ROOT, '../../..'));
    path = '/' + relative(serverRoot, join(shimDir, 'index.html')).split('\\').join('/');
  }
  const q = new URLSearchParams(query);
  const defaults = { fps: '0', nohud: '1', grain: '0', ...(has('animate') ? {} : { freeze: '1' }) };
  for (const [k, v] of Object.entries(defaults)) {
    if (!q.has(k)) q.set(k, v);
  }
  return `${path}?${q.toString()}`;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* In-page capture + analysis (serialised into the page).                                                             */
/* ------------------------------------------------------------------------------------------------------------------ */

async function pageAudit(o) {
  const E = window.__evren;
  const ctx = E.ctx;
  const engine = E.engine;
  const THREE = E.THREE;
  const renderer = ctx.renderer;
  const gl = renderer.getContext();
  const DEG = Math.PI / 180;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  renderer.setAnimationLoop(null);
  // --pre <js>: evaluated in the page before the run (debug probes, overrides).
  if (o.pre) {
    await (0, eval)(`(async () => { ${o.pre} })()`);
  }
  // Hidden scene objects (name or name prefix + '*') and --only (every drawable outside the named objects hidden),
  // applied right before each render: systems set visibility in their updates.
  const hideAll = () => {
    if (!(o.hide ?? []).length && !(o.only ?? []).length) return;
    const keep = new Set();
    if (o.only?.length) {
      ctx.scene.traverse((ob) => {
        if (o.only.includes(ob.name)) ob.traverse((c) => keep.add(c));
      });
    }
    ctx.scene.traverse((ob) => {
      for (const pat of o.hide ?? []) {
        if (pat.endsWith('*') ? ob.name.startsWith(pat.slice(0, -1)) : ob.name === pat) ob.visible = false;
      }
      if (o.only?.length && (ob.isMesh || ob.isPoints || ob.isLine || ob.isSprite) && !keep.has(ob)) ob.visible = false;
    });
  };
  // Objects hidden by the blame / NaN searches, also applied at render time.
  const forceHidden = new Set();
  // Every render of the scene (shadow maps, the water's mirror, the main view) sees the hidden set: systems set
  // visibility in their updates and the mirror renders in preRender, before the pipeline.
  // --carry <name>: that object keeps its frame-0 pose relative to the camera (a chase camera: the object stays put on
  // screen while the world moves past it), applied before every scene render.
  let carried = null;
  let carryRel = null;
  const carry = () => {
    if (!o.carry) return;
    if (!carried || !carryRel) return;
    cam.updateMatrixWorld();
    const m = cam.matrixWorld.clone().multiply(carryRel);
    const parentInv = carried.parent ? carried.parent.matrixWorld.clone().invert() : new THREE.Matrix4();
    parentInv.multiply(m).decompose(carried.position, carried.quaternion, carried.scale);
    carried.updateMatrixWorld(true);
  };
  const rendererRender = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => {
    if (scene === ctx.scene) {
      carry();
      hideAll();
      forceHidden.forEach((ob) => (ob.visible = false));
    }
    rendererRender(scene, camera);
  };
  // Disabled HDR passes of the post pipeline (clouds, weather, fx-particles, ...): pinned off (their systems set
  // `enabled` every frame).
  for (const pass of ctx.pipeline.passes ?? []) {
    if ((o.passesOff ?? []).includes(pass.name)) Object.defineProperty(pass, 'enabled', { get: () => false, set: () => undefined });
  }
  let clock = performance.now();
  const step = () => {
    clock = o.clock === 'real' ? Math.max(clock + 1, performance.now()) : clock + 1000 / 60;
    engine.frame(clock);
  };

  const cam = ctx.camera;
  let p0 = o.pose;
  if (!p0 && o.latlon) {
    E.shotLatLon(...o.latlon);
    step();
  }
  if (!p0) {
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    p0 = [cam.position.x, cam.position.y, cam.position.z, -e.y / DEG, e.x / DEG, cam.fov];
  }
  // The carried object's pose relative to the camera at the start pose (before any warm-up pose).
  if (o.carry) {
    carried = ctx.scene.getObjectByName(o.carry) ?? null;
    if (carried) {
      cam.updateMatrixWorld();
      carried.updateMatrixWorld(true);
      carryRel = cam.matrixWorld.clone().invert().multiply(carried.matrixWorld);
    }
  }
  const fwd = new THREE.Vector3();
  const poseAt = (i) => {
    const [x, y, z, h, p, f] = p0;
    if (o.motion.type === 'yaw') {
      return [x, y, z, h + o.motion.step * i, p, f];
    }
    if (o.motion.type === 'fly') {
      fwd.set(0, 0, -1).applyEuler(new THREE.Euler(p * DEG, -h * DEG, 0, 'YXZ'));
      const d = o.motion.step * i;
      return [x + fwd.x * d, y + fwd.y * d, z + fwd.z * d, h, p, f];
    }
    return [x, y, z, h, p, f];
  };
  const place = (i) => E.shot(...poseAt(i));

  // Warm-up at the middle pose (streaming for the whole sweep), then at the start pose (exposure, mirror history).
  const mid = Math.floor(o.frames / 2);
  const t0 = performance.now();
  let quiet = 0;
  let warm = 0;
  while (performance.now() - t0 < o.warmupMs) {
    place(warm < o.warmup ? mid : 0);
    step();
    warm++;
    await sleep(4);
    quiet = E.pending() === 0 ? quiet + 1 : 0;
    if (warm >= o.warmup * 2 && quiet >= 10) break;
  }
  for (let i = 0; i < 30; i++) {
    place(0);
    step();
    await sleep(2);
  }

  // --mirror: capture the water's planar reflection texture (copied to the canvas) instead of the frame.
  let mirrorBlit = null;
  if (o.mirror && window.__water?.reflection) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: null }, tDepth: { value: null }, uLod: { value: Number(o.mirror) || 0 }, uDepth: { value: o.mirror === 'depth' ? 1 : o.mirror === 'bad' ? 2 : 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tMap; uniform sampler2D tDepth; uniform float uLod; uniform int uDepth; varying vec2 vUv;
        void main() {
          if (uDepth == 2) {
            vec4 c = texelFetch(tMap, ivec2(vUv * vec2(textureSize(tMap, 0))), 0);
            bool nan = any(isnan(c)) || any(isinf(c));
            float big = max(max(c.r, c.g), c.b);
            gl_FragColor = vec4(nan ? 1.0 : 0.0, big > 1000.0 ? 1.0 : big > 100.0 ? 0.5 : 0.0, 0.0, 1.0);
            return;
          }
          if (uDepth == 1) { float d = texelFetch(tDepth, ivec2(vUv * vec2(textureSize(tDepth, 0))), 0).r; gl_FragColor = vec4(vec3(pow(d, 0.25)), 1.0); return; }
          vec4 c = textureLod(tMap, vUv, uLod); vec3 m = c.rgb / (1.0 + c.rgb);
          gl_FragColor = vec4(pow(m, vec3(1.0 / 2.2)) + vec3(0.0, 0.0, 0.25 * (1.0 - c.a)), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const qs = new THREE.Scene();
    qs.add(quad);
    const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    mirrorBlit = () => {
      mat.uniforms.tMap.value = o.mirror === 'bad' ? (window.__water.reflection.sceneTarget ?? window.__water.reflection.target).texture : window.__water.reflection.target.texture;
      mat.uniforms.tDepth.value = window.__water.reflection.target.depthTexture;
      renderer.setRenderTarget(null);
      renderer.render(qs, qc);
    };
  }
  // Depth of each captured frame (fly-throughs): the scene target's reversed-Z depth, encoded as 16-bit log distance.
  const depths = [];
  let depthLut = null;
  let depthBlit = null;
  if (o.motion.type === 'fly' && !o.noDepth && !o.mirror && ctx.pipeline.sceneTarget?.depthTexture) {
    const near = cam.near;
    const far = cam.far;
    const L = Math.log2(far / near);
    depthLut = new Float32Array(65536);
    for (let v = 0; v < 65536; v++) depthLut[v] = near * Math.pow(2, (v / 65535) * L);
    const mat = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null }, uNear: { value: near }, uFar: { value: far } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tDepth; uniform float uNear; uniform float uFar; varying vec2 vUv;
        void main() {
          float d = texture2D(tDepth, vUv).r;
          float z = d <= 0.0 ? uFar : (uFar * uNear) / (d * (uFar - uNear) + uNear);
          float t = clamp(log2(z / uNear) / log2(uFar / uNear), 0.0, 1.0);
          float v = floor(t * 65535.0 + 0.5);
          gl_FragColor = vec4(floor(v / 256.0) / 255.0, mod(v, 256.0) / 255.0, 0.0, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const qs = new THREE.Scene();
    qs.add(quad);
    const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    depthBlit = () => {
      mat.uniforms.tDepth.value = ctx.pipeline.sceneTarget.depthTexture;
      renderer.setRenderTarget(null);
      rendererRender(qs, qc);
      const px = readRGBA();
      const out = new Uint16Array(px.w * px.h);
      for (let y = 0; y < px.h; y++) {
        const src = (px.h - 1 - y) * px.w * 4;
        for (let x = 0; x < px.w; x++) out[y * px.w + x] = px.buf[src + x * 4] * 256 + px.buf[src + x * 4 + 1];
      }
      return out;
    };
  }
  const readRGBA = () => {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    renderer.setRenderTarget(null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return { w, h, buf };
  };
  const toLuma = ({ w, h, buf }) => {
    const L = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      const dst = y * w;
      for (let x = 0; x < w; x++) {
        const k = src + x * 4;
        L[dst + x] = (54 * buf[k] + 183 * buf[k + 1] + 19 * buf[k + 2]) >> 8;
      }
    }
    return L;
  };
  const flipRGBA = ({ w, h, buf }) => {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) out.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return out;
  };

  // Capture.
  const frames = [];
  const cams = [];
  const colors = new Map();
  const scales = [];
  // Scene events: drawables that appear / disappear between consecutive captured frames (visible with all parents).
  const events = [];
  const visibleSet = () => {
    const set = new Map();
    const walk = (ob, path) => {
      if (!ob.visible) return;
      const p = path + '/' + (ob.name || ob.type);
      if (ob.isMesh || ob.isPoints || ob.isLine || ob.isSprite) set.set(ob.id, p.slice(7));
      for (const c of ob.children) walk(c, p);
    };
    walk(ctx.scene, '');
    return set;
  };
  let prevVis = null;
  // Render hook: records the drawables actually rendered by each frame (visibility after every system's update).
  let lastVis = null;
  const pipelineRender2 = ctx.pipeline.render.bind(ctx.pipeline);
  ctx.pipeline.render = (c) => {
    pipelineRender2(c);
    if (o.events) lastVis = visibleSet();
  };
  for (let i = 0; i < o.frames; i++) {
    place(i);
    step();
    if (o.events && lastVis) {
      if (prevVis) {
        const on = [];
        const off = [];
        for (const [id, p] of lastVis) if (!prevVis.has(id)) on.push(p);
        for (const [id, p] of prevVis) if (!lastVis.has(id)) off.push(p);
        if (on.length || off.length) events.push({ frame: i, on: on.slice(0, 12), off: off.slice(0, 12), nOn: on.length, nOff: off.length });
      }
      prevVis = lastVis;
    }
    if (o.events) {
      const kl = ctx.services.tryGet?.('env')?.light;
      const planarOn = window.__water?.uniforms?.uReflParams?.value?.x;
      const state = `planar=${planarOn} castShadow=${kl?.castShadow} map=${!!kl?.shadow?.map} key=${kl?.name ?? kl?.type}`;
      if (state !== events.lastState) events.push({ frame: i, state });
      events.lastState = state;
    }
    if (mirrorBlit) mirrorBlit();
    const px = readRGBA();
    if (o.mirror === 'bad') {
      let nan = 0;
      let big = 0;
      let huge = 0;
      for (let k = 0; k < px.buf.length; k += 4) {
        if (px.buf[k] > 127) nan++;
        if (px.buf[k + 1] > 200) huge++;
        else if (px.buf[k + 1] > 100) big++;
      }
      events.push({ frame: i, nan, over100: big, over1000: huge });
    }
    frames.push(toLuma(px));
    if (o.keepColor) colors.set(i, flipRGBA(px));
    if (depthBlit) depths[i] = depthBlit();
    cams.push({ q: cam.quaternion.clone(), p: cam.position.clone(), tanY: Math.tan((cam.fov * DEG) / 2), aspect: cam.aspect });
    scales.push(ctx.pipeline.renderScale ?? 1);
    if (o.clock === 'real') await sleep(0);
  }
  const W = gl.drawingBufferWidth;
  const H = gl.drawingBufferHeight;

  // --nan-source: for the first frames whose mirror scene render holds non-finite texels, re-render that pose with
  // halves of the drawables hidden until the object producing them is found.
  const nanSource = [];
  if (o.mirror === 'bad' && mirrorBlit) {
    const countBad = () => {
      mirrorBlit();
      const px = readRGBA();
      let n = 0;
      for (let k = 0; k < px.buf.length; k += 4) if (px.buf[k] > 127) n++;
      return n;
    };
    const badFrames = events.filter((e) => e.nan > 0).map((e) => e.frame).slice(0, 3);
    for (const f of badFrames) {
      const leaves = [];
      ctx.scene.traverse((ob) => {
        if ((ob.isMesh || ob.isPoints || ob.isLine || ob.isSprite) && ob.visible) leaves.push(ob);
      });
      const test = (hideSet) => {
        hideSet.forEach((ob) => forceHidden.add(ob));
        place(f);
        step();
        const n = countBad();
        hideSet.forEach((ob) => {
          forceHidden.delete(ob);
          ob.visible = true;
        });
        return n;
      };
      const entry = { frame: f, again: test([]), culprits: [] };
      // Shown alone (everything else hidden), which subsets still produce non-finite texels: recurse into both halves.
      const alone = (set) => {
        const keep = new Set(set);
        return test(leaves.filter((ob) => !keep.has(ob)));
      };
      const label = (ob) => {
        const names = [];
        for (let x = ob; x && x !== ctx.scene; x = x.parent) names.push(x.name || x.type);
        return names.reverse().join('/') + ' [' + (Array.isArray(ob.material) ? ob.material.map((m) => m.name).join(',') : ob.material?.name) + ']';
      };
      let budget = 40;
      const search = (set) => {
        if (budget-- <= 0 || entry.culprits.length >= 6) return;
        if (set.length === 1) {
          entry.culprits.push(label(set[0]));
          return;
        }
        const a = set.slice(0, set.length >> 1);
        const b = set.slice(set.length >> 1);
        const na = alone(a);
        const nb = alone(b);
        if (na > 0) search(a);
        if (nb > 0) search(b);
        if (na === 0 && nb === 0) entry.culprits.push(`needs both of ${a.length}+${b.length}: ${label(a[0])} ... ${label(b[0])}`);
      };
      if (entry.again > 0 && alone(leaves) > 0) search(leaves);
      nanSource.push(entry);
    }
  }

  // --post <js>|@file: evaluated in the page after the capture; its (awaited) value goes to the summary as `post`.
  let post = null;
  if (o.post) {
    try {
      post = await (0, eval)(`(async () => { ${o.post} })()`);
    } catch (e) {
      post = `post error: ${e.message}`;
    }
  }

  // Region masks (0 land, 1 sea, 2 sky) at the first, middle and last pose.
  const maskPoses = [0, mid, o.frames - 1];
  const masks = [];
  const water = window.__water?.mesh;
  ctx.pipeline.setDebugView?.('depth');
  for (const i of maskPoses) {
    place(i);
    step();
    const a = toLuma(readRGBA());
    let b = a;
    if (water) {
      water.visible = false;
      place(i);
      step();
      b = toLuma(readRGBA());
      water.visible = true;
    }
    const m = new Uint8Array(W * H);
    for (let k = 0; k < m.length; k++) m[k] = a[k] <= 1 ? 2 : Math.abs(a[k] - b[k]) >= 1 ? 1 : 0;
    masks.push(m);
  }
  ctx.pipeline.setDebugView?.('off');
  place(0);
  step();

  // 3x3 min/max per frame.
  const minmax = (L) => {
    const rmin = new Uint8Array(W * H);
    const rmax = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const r = y * W;
      for (let x = 0; x < W; x++) {
        const a = L[r + Math.max(0, x - 1)];
        const b = L[r + x];
        const c = L[r + Math.min(W - 1, x + 1)];
        rmin[r + x] = Math.min(a, b, c);
        rmax[r + x] = Math.max(a, b, c);
      }
    }
    const mn = new Uint8Array(W * H);
    const mx = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const u = Math.max(0, y - 1) * W;
      const c = y * W;
      const d = Math.min(H - 1, y + 1) * W;
      for (let x = 0; x < W; x++) {
        mn[c + x] = Math.min(rmin[u + x], rmin[c + x], rmin[d + x]);
        mx[c + x] = Math.max(rmax[u + x], rmax[c + x], rmax[d + x]);
      }
    }
    return { mn, mx };
  };
  const mm = frames.map(minmax);

  // Pixel map of frame i onto frame j by the camera rotation: index into j or -1.
  // Reprojection of frame i's pixels into frame j: by the camera rotation, plus the translation when the frame's depth
  // was captured (a fly-through; rotation-only pixels are treated as infinitely far). Returns (k) -> index or -1.
  const mapper = (i, j) => {
    const ci = cams[i];
    const cj = cams[j];
    const rel = new THREE.Matrix4().makeRotationFromQuaternion(cj.q.clone().invert().multiply(ci.q)).elements;
    const t = ci.p.clone().sub(cj.p).applyQuaternion(cj.q.clone().invert());
    const depth = depths[i];
    const txi = ci.tanY * ci.aspect;
    const txj = cj.tanY * cj.aspect;
    return (k) => {
      const x = k % W;
      const y = (k - x) / W;
      const vy = (1 - ((y + 0.5) / H) * 2) * ci.tanY;
      const vx = (((x + 0.5) / W) * 2 - 1) * txi;
      let X = rel[0] * vx + rel[4] * vy - rel[8];
      let Y = rel[1] * vx + rel[5] * vy - rel[9];
      let Z = rel[2] * vx + rel[6] * vy - rel[10];
      if (depth) {
        const z = depthLut[depth[k]];
        X = X * z + t.x;
        Y = Y * z + t.y;
        Z = Z * z + t.z;
      }
      if (Z >= 0) return -1;
      const px = Math.floor(((X / -Z / txj + 1) / 2) * W);
      const py = Math.floor(((1 - Y / -Z / cj.tanY) / 2) * H);
      return px >= 0 && px < W && py >= 0 && py < H ? py * W + px : -1;
    };
  };
  const rotMap = (i, j) => {
    const f = mapper(i, j);
    const map = new Int32Array(W * H);
    for (let k = 0; k < map.length; k++) map[k] = f(k);
    return map;
  };
  const mapOne = (i, j, k) => mapper(i, j)(k);

  // Reprojection check: mean |L(mid) - L(mid-1) o map| for the mapped pixel shifted by dx, dy in -2..2 (best at 0,0).
  const align = [];
  {
    const mp = rotMap(mid, mid - 1);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        let acc = 0;
        let n = 0;
        for (let k = 0; k < mp.length; k += 7) {
          const m = mp[k];
          if (m < 0) continue;
          const x = (m % W) + dx;
          const y = Math.floor(m / W) + dy;
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          acc += Math.abs(frames[mid][k] - frames[mid - 1][y * W + x]);
          n++;
        }
        align.push([dx, dy, Math.round((acc / Math.max(n, 1)) * 100) / 100]);
      }
    }
    align.sort((a, b) => a[2] - b[2]);
  }

  const th = o.threshold;
  const count = new Uint16Array(W * H);
  const regionPx = [0, 0, 0];
  const regionEv = [0, 0, 0];
  const regionEver = [0, 0, 0];
  const perTriple = [];
  for (let i = 1; i < o.frames - 1; i++) {
    const L = frames[i];
    const prev = mm[i - 1];
    const next = mm[i + 1];
    const mp = rotMap(i, i - 1);
    const mnx = rotMap(i, i + 1);
    const mask = masks[i < o.frames / 3 ? 0 : i < (2 * o.frames) / 3 ? 1 : 2];
    let ev = 0;
    for (let k = 0; k < L.length; k++) {
      const a = mp[k];
      const b = mnx[k];
      if (a < 0 || b < 0) continue;
      const r = mask[k];
      regionPx[r]++;
      const v = L[k];
      const up = v - Math.max(prev.mx[a], next.mx[b]);
      const dn = Math.min(prev.mn[a], next.mn[b]) - v;
      if (up > th || dn > th) {
        count[k]++;
        regionEv[r]++;
        ev++;
      }
    }
    perTriple.push(ev);
  }
  const midMask = masks[1];
  const regionAll = [0, 0, 0];
  for (let k = 0; k < count.length; k++) {
    regionAll[midMask[k]]++;
    if (count[k] > 0) regionEver[midMask[k]]++;
  }
  const triples = o.frames - 2;
  const names = ['land', 'sea', 'sky'];
  const r2 = (x) => Math.round(x * 100) / 100;
  const regions = {};
  let totPx = 0;
  let totEv = 0;
  let totEver = 0;
  for (let r = 0; r < 3; r++) {
    totPx += regionPx[r];
    totEv += regionEv[r];
    totEver += regionEver[r];
    regions[names[r]] = {
      area: r2((100 * regionAll[r]) / (W * H)),
      rate: regionPx[r] ? r2((1000 * regionEv[r]) / regionPx[r]) : 0,
      share: regionAll[r] ? r2((100 * regionEver[r]) / regionAll[r]) : 0,
    };
  }
  regions.all = { area: 100, rate: totPx ? r2((1000 * totEv) / totPx) : 0, share: r2((100 * totEver) / (W * H)) };

  // Images.
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const midRGBA = colors.get(mid);
  g.putImageData(new ImageData(midRGBA, W, H), 0, 0);
  const frameUrl = canvas.toDataURL('image/png');
  const heat = new ImageData(W, H);
  const hd = heat.data;
  const full = Math.max(2, triples * 0.25);
  const L0 = frames[mid];
  for (let k = 0; k < count.length; k++) {
    const base = L0[k] * 0.4;
    const c = count[k];
    const o4 = k * 4;
    if (c === 0) {
      hd[o4] = hd[o4 + 1] = hd[o4 + 2] = base;
    } else {
      const t = Math.min(1, c / full);
      hd[o4] = 255;
      hd[o4 + 1] = Math.round(40 + 215 * t);
      hd[o4 + 2] = Math.round(40 * (1 - t));
    }
    hd[o4 + 3] = 255;
  }
  // Region outlines (sea cyan, sky blue) at the middle pose.
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const k = y * W + x;
      const r = midMask[k];
      if (r !== midMask[k + 1] || r !== midMask[k + W]) {
        const o4 = k * 4;
        if (count[k] === 0) {
          hd[o4] = 0;
          hd[o4 + 1] = r === 1 || midMask[k + 1] === 1 || midMask[k + W] === 1 ? 200 : 90;
          hd[o4 + 2] = 255;
        }
      }
    }
  }
  g.putImageData(heat, 0, 0);
  const heatUrl = canvas.toDataURL('image/png');

  // The three frames around the worst triple, side by side at half size.
  let worst = 0;
  for (let t = 1; t < perTriple.length; t++) if (perTriple[t] > perTriple[worst]) worst = t;
  const wi = worst + 1;
  let worstUrl = null;
  if (colors.has(wi - 1) && colors.has(wi + 1)) {
    const strip = document.createElement('canvas');
    strip.width = Math.round(W * 1.5);
    strip.height = Math.round(H / 2);
    const sg = strip.getContext('2d');
    [wi - 1, wi, wi + 1].forEach((f, n) => {
      g.putImageData(new ImageData(colors.get(f), W, H), 0, 0);
      sg.drawImage(canvas, 0, 0, W, H, n * (W / 2), 0, W / 2, H / 2);
    });
    worstUrl = strip.toDataURL('image/jpeg', 0.9);
  }

  // Zoom strip: a 40x40 crop around the densest 40x40 block of unstable pixels, followed through 8 frames (x4).
  let zoomUrl = null;
  {
    const B = o.zoomSize ?? 40;
    const Z = Math.max(4, Math.round(160 / B));
    let best = -1;
    let bx = 0;
    let by = 0;
    for (let y = 0; y + B <= H; y += B / 2) {
      for (let x = 0; x + B <= W; x += B / 2) {
        let n = 0;
        for (let yy = y; yy < y + B; yy++) for (let xx = x; xx < x + B; xx++) n += count[yy * W + xx];
        if (n > best) {
          best = n;
          bx = x;
          by = y;
        }
      }
    }
    if (o.zoom) {
      bx = Math.max(0, Math.min(W - B, o.zoom[0] - B / 2));
      by = Math.max(0, Math.min(H - B, o.zoom[1] - B / 2));
    }
    const f0 = Math.max(0, Math.min(o.frames - 8, mid - 4));
    const strip = document.createElement('canvas');
    strip.width = 8 * B * Z + 7 * 4;
    strip.height = B * Z;
    const sg = strip.getContext('2d');
    sg.imageSmoothingEnabled = false;
    const cx = bx + B / 2;
    const cy = by + B / 2;
    for (let n = 0; n < 8; n++) {
      const f = f0 + n;
      if (!colors.has(f)) continue;
      const m = mapOne(mid, f, cy * W + cx);
      const fx = m >= 0 ? m % W : cx;
      const fy = m >= 0 ? Math.floor(m / W) : cy;
      g.putImageData(new ImageData(colors.get(f), W, H), 0, 0);
      sg.drawImage(canvas, fx - B / 2, fy - B / 2, B, B, n * (B * Z + 4), 0, B * Z, B * Z);
    }
    zoomUrl = strip.toDataURL('image/png');
    var zoomAt = [bx, by, B, best];
  }

  // What the hottest pixels are: raycast through the most unstable pixels at the middle pose (object path + distance).
  const probes = [];
  {
    const order = [];
    for (let k = 0; k < count.length; k++) if (count[k] > 1) order.push(k);
    order.sort((a, b) => count[b] - count[a]);
    place(mid);
    step();
    const rc = new THREE.Raycaster();
    const tally = new Map();
    for (const k of order.slice(0, 60)) {
      const x = k % W;
      const y = Math.floor(k / W);
      rc.setFromCamera(new THREE.Vector2(((x + 0.5) / W) * 2 - 1, 1 - ((y + 0.5) / H) * 2), cam);
      let hit = null;
      try {
        hit = rc.intersectObject(ctx.scene, true).find((h) => h.object.visible !== false);
      } catch {
        /* custom geometry without raycast support */
      }
      let path = 'none';
      if (hit) {
        const names = [];
        for (let ob = hit.object; ob && ob !== ctx.scene; ob = ob.parent) names.push(ob.name || ob.type);
        path = names.reverse().join('/');
      }
      const e = tally.get(path) ?? { path, n: 0, dist: [] };
      e.n++;
      if (hit && e.dist.length < 5) e.dist.push(Math.round(hit.distance));
      tally.set(path, e);
    }
    probes.push(...[...tally.values()].sort((a, b) => b.n - a.n));
  }

  // Luma series of the hottest pixels, followed through the sweep (3x3 max around the reprojected pixel).
  const hot = [];
  {
    const order = [];
    for (let k = 0; k < count.length; k++) if (count[k] > 1) order.push(k);
    order.sort((a, b) => count[b] - count[a]);
    for (const k of order.slice(0, 8)) {
      const series = [];
      const mxs = [];
      for (let f = 0; f < o.frames; f++) {
        const m = mapOne(mid, f, k);
        series.push(m >= 0 ? frames[f][m] : -1);
        mxs.push(m >= 0 ? mm[f].mx[m] : -1);
      }
      hot.push({ x: k % W, y: Math.floor(k / W), count: count[k], region: names[midMask[k]], luma: series.join(' '), max3: mxs.join(' ') });
    }
  }

  // Blame (--blame N): for the N hottest pixels, re-render the triple where each was unstable with halves of the scene's
  // drawable objects hidden (binary search) until one object is left whose hiding removes the spike.
  const blame = [];
  if (o.blame > 0 || o.blameAt) {
    const leaves = [];
    ctx.scene.traverse((ob) => {
      if ((ob.isMesh || ob.isPoints || ob.isLine || ob.isSprite) && ob.visible) {
        let vis = true;
        for (let p = ob.parent; p; p = p.parent) if (!p.visible) vis = false;
        if (vis) leaves.push(ob);
      }
    });
    const pathOf = (ob) => {
      const names = [];
      for (let x = ob; x && x !== ctx.scene; x = x.parent) names.push(x.name || x.type);
      return names.reverse().join('/');
    };
    const spikeAt = (k, t, hideSet) => {
      hideSet.forEach((ob) => forceHidden.add(ob));
      const L = [];
      for (const f of [t - 1, t, t + 1]) {
        place(f);
        step();
        L.push(toLuma(readRGBA()));
      }
      hideSet.forEach((ob) => {
        forceHidden.delete(ob);
        ob.visible = true;
      });
      const a = mapOne(t, t - 1, k);
      const b = mapOne(t, t + 1, k);
      if (a < 0 || b < 0) return false;
      const around = (img, m) => {
        let mn = 255;
        let mx = 0;
        const x0 = m % W;
        const y0 = Math.floor(m / W);
        for (let y = Math.max(0, y0 - 1); y <= Math.min(H - 1, y0 + 1); y++) {
          for (let x = Math.max(0, x0 - 1); x <= Math.min(W - 1, x0 + 1); x++) {
            mn = Math.min(mn, img[y * W + x]);
            mx = Math.max(mx, img[y * W + x]);
          }
        }
        return [mn, mx];
      };
      const [pn, px] = around(L[0], a);
      const [nn, nx] = around(L[2], b);
      const v = L[1][k];
      return v - Math.max(px, nx) > th || Math.min(pn, nn) - v > th;
    };
    // Unstable triple of each hot pixel: recompute per triple (cheap for single pixels).
    const order = [];
    for (let k = 0; k < count.length; k++) if (count[k] > 1) order.push(k);
    order.sort((a, b) => count[b] - count[a]);
    const picked = [];
    for (const k of order) {
      if (picked.length >= o.blame) break;
      if (picked.some((q) => Math.abs((q % W) - (k % W)) < 12 && Math.abs(Math.floor(q / W) - Math.floor(k / W)) < 12)) continue;
      picked.push(k);
    }
    if (o.blameAt) picked.splice(0, picked.length, o.blameAt[1] * W + o.blameAt[0]);
    for (const k of picked) {
      let t = o.blameAt ? o.blameAt[2] : -1;
      for (let i = 1; i < o.frames - 1 && t < 0; i++) {
        const a = mapOne(i, i - 1, k);
        const b = mapOne(i, i + 1, k);
        if (a < 0 || b < 0) continue;
        const v = frames[i][k];
        if (v - Math.max(mm[i - 1].mx[a], mm[i + 1].mx[b]) > th || Math.min(mm[i - 1].mn[a], mm[i + 1].mn[b]) - v > th) t = i;
      }
      const entry = { x: k % W, y: Math.floor(k / W), triple: t, reproduced: false, culprit: null, steps: 0 };
      if (t > 0 && spikeAt(k, t, [])) {
        entry.reproduced = true;
        let cand = leaves.slice();
        while (cand.length > 1 && entry.steps < 24) {
          entry.steps++;
          const half = cand.slice(0, cand.length >> 1);
          const rest = cand.slice(cand.length >> 1);
          if (!spikeAt(k, t, half)) cand = half;
          else if (!spikeAt(k, t, rest)) cand = rest;
          else {
            entry.culprit = 'split: ' + [half, rest].map((c) => [...new Set(c.slice(0, 50).map((ob) => pathOf(ob).split('/').slice(0, 3).join('/')))].slice(0, 6).join(', ')).join(' | ');
            break;
          }
        }
        if (cand.length === 1) {
          const ob = cand[0];
          entry.culprit = pathOf(ob);
          entry.material = Array.isArray(ob.material) ? ob.material.map((m) => m.name).join(',') : ob.material?.name;
          entry.type = ob.type;
          entry.confirmed = !spikeAt(k, t, [ob]);
        }
      }
      blame.push(entry);
    }
  }

  let countB64 = '';
  {
    const bytes = new Uint8Array(count.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    countB64 = btoa(bin);
  }

  const frameMean = frames.map((L) => {
    let a = 0;
    for (let k = 0; k < L.length; k += 3) a += L[k];
    return Math.round((a / (L.length / 3)) * 100) / 100;
  });

  const dump = [];
  if (o.dump) {
    for (let f = 0; f < o.frames; f++) {
      g.putImageData(new ImageData(colors.get(f), W, H), 0, 0);
      dump.push(canvas.toDataURL('image/png'));
    }
  }

  return {
    post,
    nanSource,
    events,
    dump,
    frameMean,
    blame,
    countB64,
    align: align.slice(0, 5),
    hot,
    probes,
    zoomAt,
    size: [W, H],
    pose0: p0,
    frames: o.frames,
    triples,
    renderScale: { min: Math.min(...scales), max: Math.max(...scales) },
    regions,
    perTriple,
    worstTriple: wi,
    images: { frame: frameUrl, heat: heatUrl, worst: worstUrl, zoom: zoomUrl },
  };
}

/* ------------------------------------------------------------------------------------------------------------------ */

async function runOne(browser, run) {
  const page = await browser.newPage({ viewport: { width: run.w, height: run.h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const url = pageUrl(run.query);
  const t0 = Date.now();
  await page.goto(BASE + url, { waitUntil: 'load', timeout: 90000 });
  while (Date.now() - t0 < 90000) {
    const s = await page.evaluate(() => (window.__evren ? { ready: window.__evren.ready, pending: window.__evren.pending() } : null)).catch(() => null);
    if (s?.ready && s.pending === 0) break;
    await page.waitForTimeout(250);
  }
  let res;
  try {
    res = await page.evaluate(pageAudit, {
      pose: run.pose ?? null,
      latlon: run.latlon ?? null,
      hide: run.hide,
      passesOff: run.passesOff,
      blame: Number(opt('blame', 0)),
      carry: opt('carry') ?? null,
      post: opt('post') ? (opt('post').startsWith('@') ? readFileSync(opt('post').slice(1), 'utf8') : opt('post')) : null,
      pre: opt('pre') ? (opt('pre').startsWith('@') ? readFileSync(opt('pre').slice(1), 'utf8') : opt('pre')) : null,
      events: has('events'),
      mirror: has('mirror') ? (opt('mirror') && !opt('mirror').startsWith('--') ? opt('mirror') : '0') : null,
      blameAt: opt('blame-at') ? opt('blame-at').split(',').map(Number) : null,
      dump: has('dump'),
      only: opt('only') ? opt('only').split('+') : null,
      zoom: opt('zoom') ? opt('zoom').split(',').map(Number) : null,
      zoomSize: opt('zoom-size') ? Number(opt('zoom-size')) : undefined,
      motion: run.motion,
      frames: run.frames,
      warmup: run.warmup,
      warmupMs: 60000,
      threshold: run.threshold,
      clock: run.clock,
      keepColor: true,
    });
  } catch (e) {
    await page.close();
    return { name: run.name, url, error: String(e.message ?? e), errors };
  }
  await page.close();
  mkdirSync(run.dir, { recursive: true });
  const save = (file, dataUrl) => {
    if (!dataUrl) return null;
    writeFileSync(join(run.dir, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
    return relative(ROOT, join(run.dir, file));
  };
  writeFileSync(join(run.dir, 'count.u16'), Buffer.from(res.countB64, 'base64'));
  if (res.dump.length) {
    mkdirSync(join(run.dir, 'frames'), { recursive: true });
    res.dump.forEach((u, f) => writeFileSync(join(run.dir, 'frames', `${String(f).padStart(3, '0')}.png`), Buffer.from(u.split(',')[1], 'base64')));
  }
  delete res.dump;
  delete res.countB64;
  const images = { heat: save('heat.png', res.images.heat), frame: save('frame.png', res.images.frame), worst: save('worst.jpg', res.images.worst), zoom: save('zoom.png', res.images.zoom) };
  const summary = { name: run.name, toggle: run.toggle, url, motion: run.motion, threshold: run.threshold, clock: run.clock, ...res, images, errors: errors.slice(0, 10), ms: Date.now() - t0 };
  writeFileSync(join(run.dir, 'summary.json'), JSON.stringify(summary, null, 1));
  return summary;
}

function expandRuns() {
  const scenes = loadScenes();
  const outRoot = join(ROOT, opt('out', '.shots/flicker'));
  const togglesArg = opt('toggles', '');
  const toggles = togglesArg === 'all' ? BISECT_TOGGLES : togglesArg ? togglesArg.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const withBase = !has('no-baseline');
  let defs;
  if (opt('url')) {
    const u = new URL(opt('url'), BASE);
    defs = [{ name: opt('name', 'adhoc'), query: Object.fromEntries(u.searchParams), motion: opt('motion', 'yaw:0.2'), frames: Number(opt('frames', 40)), pose: opt('pose') ? opt('pose').split(',').map(Number) : undefined }];
  } else {
    const wanted = (opt('scene', 'all') === 'all' ? Object.keys(scenes) : opt('scene').split(','));
    defs = wanted.map((n) => {
      if (!scenes[n]) throw new Error(`unknown scene ${n}; known: ${Object.keys(scenes).join(', ')}`);
      return { name: n, ...scenes[n] };
    });
  }
  const tag = opt('tag', '');
  const runs = [];
  for (const d of defs) {
    const list = [...(withBase ? [''] : []), ...toggles];
    for (const t of list) {
      const query = { ...d.query };
      const hide = [...(d.hide ?? []), ...(opt('hide') ? opt('hide').split('+') : [])];
      const passesOff = [];
      for (const kv of t.split('&').filter(Boolean)) {
        if (kv.startsWith('pass:')) {
          passesOff.push(...kv.slice(5).split('+'));
          continue;
        }
        if (kv.startsWith('hide:')) {
          hide.push(...kv.slice(5).split('+'));
          continue;
        }
        const [k, v] = kv.split('=');
        query[k] = v ?? '1';
      }
      const runName = (t ? t.replace(/[=&:+*]/g, '-') : 'baseline') + (tag ? `.${tag}` : '');
      runs.push({
        name: d.name,
        toggle: t || 'baseline',
        query,
        pose: d.pose,
        latlon: d.latlon,
        hide,
        passesOff,
        motion: parseMotion(opt('motion', d.motion)),
        frames: Number(opt('frames', d.frames ?? 40)),
        warmup: Number(opt('warmup', d.warmup ?? 60)),
        threshold: Number(opt('threshold', d.threshold ?? 12)),
        clock: opt('clock', 'fixed'),
        w: Number(opt('w', 1280)),
        h: Number(opt('h', 720)),
        dir: join(outRoot, d.name, runName),
        sceneDir: join(outRoot, d.name),
      });
    }
  }
  return runs;
}

const runs = expandRuns();
try {
  const r = await fetch(BASE + '/');
  if (!r.ok) throw new Error(String(r.status));
} catch {
  console.error(`Dev server not reachable at ${BASE}. Start it with: npm run dev`);
  process.exit(2);
}
await acquireSlot();
const browser = await chromium.launch(chromeLaunchOptions());
const results = [];
try {
  for (const run of runs) {
    process.stderr.write(`[flicker] ${run.name} / ${run.toggle} ...`);
    const s = await runOne(browser, run);
    results.push(s);
    process.stderr.write(s.error ? ` error: ${s.error}\n` : ` all ${s.regions.all.rate}‰ sea ${s.regions.sea.rate}‰ land ${s.regions.land.rate}‰ sky ${s.regions.sky.rate}‰\n`);
    const scenePath = join(run.sceneDir, 'summary.json');
    let prev = {};
    try {
      prev = JSON.parse(readFileSync(scenePath, 'utf8'));
    } catch {
      /* first run */
    }
    const { perTriple, images, ...rest } = s;
    prev[run.dir.slice(run.sceneDir.length + 1)] = { ...rest, images };
    writeFileSync(scenePath, JSON.stringify(prev, null, 1));
  }
} finally {
  await browser.close();
  releaseSlot();
}
const line = (s) =>
  s.error
    ? `| ${s.name} | ${s.toggle} | error: ${s.error} |`
    : `| ${s.name} | ${s.toggle} | ${s.regions.all.rate} | ${s.regions.sea.rate} | ${s.regions.land.rate} | ${s.regions.sky.rate} | ${s.regions.all.share}% | ${s.renderScale.min === s.renderScale.max ? s.renderScale.min : `${s.renderScale.min}-${s.renderScale.max}`} |`;
console.log('| scene | run | all ‰ | sea ‰ | land ‰ | sky ‰ | px share | scale |');
console.log('|---|---|---|---|---|---|---|---|');
for (const s of results) console.log(line(s));
