/**
 * Dragon ground-walk collision test (used by scripts/walk-test.mjs --dragon): walks the dragon along Eminönü streets,
 * the square and the quay in the full game with the deterministic fast-forward (window.__flightTest.simulate), logs
 * every blocking contact (wall push-outs and blocked steps) with the collider behind it, and checks each blocking
 * collider against what is rendered there: a collider is a phantom when rays cast from the dragon's body toward the
 * contact point hit no rendered mesh (dragon hidden) within reach.
 *
 * Routes follow OSM road centre lines from public/data/osm/slice.json (by name) plus a few straight legs.
 */
import { readFileSync } from 'node:fs';

/** Named OSM ways walked from end to end (every segment with the name, in file order). */
const ROAD_ROUTES = [
  { id: 'resadiye', label: 'Reşadiye Caddesi', names: ['Reşadiye Caddesi'] },
  { id: 'hamidiye', label: 'Hamidiye / Mimar Kemalettin', names: ['Hamidiye Caddesi', 'Mimar Kemalettin Caddesi'] },
  { id: 'yenicami', label: 'Yeni Camii Cd, Tahmis, Hasırcılar', names: ['Yeni Camii Caddesi', 'Tahmis Sokağı', 'Hasırcılar Caddesi'] },
];

/** Straight legs (x, z polylines, local metres) across the square, along the tram line and the quay. */
const FREE_ROUTES = [
  { id: 'square', label: 'Eminönü Meydanı (Yeni Cami önü, batı-doğu)', pts: [-4210, 3045, -4150, 3050, -4080, 3060, -3990, 3055, -3930, 3070] },
  { id: 'square-ns', label: 'Meydan kuzey-güney (köprü ayağı, Yeni Cami ile Mısır Çarşısı arası)', pts: [-4020, 2990, -4060, 3050, -4076, 3095, -4085, 3125, -4080, 3160] },
  { id: 'quay', label: 'Rıhtım (iskeleler boyunca)', pts: [-4280, 2880, -4200, 2930, -4100, 2975, -3990, 2990, -3880, 3000] },
  { id: 'tram', label: 'Tramvay hattı (Eminönü - Sirkeci)', pts: [-4150, 2975, -4000, 3000, -3900, 3050, -3780, 3080, -3680, 3160] },
];

/**
 * Known mismatches owned by other systems: reported as `known` instead of failing the run. Remove an entry once fixed.
 * x, z, radius (m) around the contact.
 */
const KNOWN = [
  {
    source: 'galata-koprusu',
    x: -4015,
    z: 2985,
    r: 20,
    note: 'Galata Köprüsü south end: the deck (top 2.8 m, girder 1.25 m) runs out over the quay, which slopes to 1.0-1.9 m, and its end face is not drawn, so the 0.9-1.7 m ledge looks open',
  },
];

export function eminonuRoutes(root) {
  const data = JSON.parse(readFileSync(`${root}/public/data/osm/slice.json`, 'utf8'));
  const routes = [];
  for (const r of ROAD_ROUTES) {
    const legs = [];
    for (const name of r.names) {
      for (const w of data.roads) {
        if (w.name === name && !w.bridge) legs.push(w.pts);
      }
    }
    routes.push({ id: r.id, label: r.label, legs });
  }
  for (const r of FREE_ROUTES) routes.push({ id: r.id, label: r.label, legs: [r.pts] });
  return routes;
}

/**
 * In-page (--legacy-boxes, before/after evidence only): swaps every OSM building footprint prism around Eminönü for the
 * minimum-area oriented box the buildings worker used to register (same algorithm as buildings/footprint.ts orientedBox).
 */
function legacyBoxesInPage() {
  const E = window.__evren;
  const THREE = E.THREE;
  const col = E.ctx.services.get('collision');
  let swapped = 0;
  for (const info of col.debugEntries(-4700, 2700, -3400, 3600)) {
    const rec = col.debugCollider(info.id);
    if (!rec || rec.collider.kind !== 'prism' || !info.source.startsWith('osm-building:')) continue;
    const r = rec.collider.rings[0];
    const n = r.length / 2;
    let best = null;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let dx = r[j * 2] - r[i * 2];
      let dz = r[j * 2 + 1] - r[i * 2 + 1];
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      dx /= len;
      dz /= len;
      let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
      for (let k = 0; k < n; k++) {
        const a = r[k * 2] * dx + r[k * 2 + 1] * dz;
        const b = -r[k * 2] * dz + r[k * 2 + 1] * dx;
        s0 = Math.min(s0, a); s1 = Math.max(s1, a); t0 = Math.min(t0, b); t1 = Math.max(t1, b);
      }
      const area = (s1 - s0) * (t1 - t0);
      if (!best || area < best.area) {
        const sc = (s0 + s1) / 2, tc = (t0 + t1) / 2;
        best = { area, cx: sc * dx - tc * dz, cz: sc * dz + tc * dx, hl: (s1 - s0) / 2, hw: (t1 - t0) / 2, yaw: -Math.atan2(dz, dx) };
      }
    }
    if (!best) continue;
    const { bottom, top } = rec.collider;
    col.remove(info.id);
    col.add({ kind: 'box', center: new THREE.Vector3(best.cx, (bottom + top) / 2, best.cz), halfSize: new THREE.Vector3(best.hl, (top - bottom) / 2, best.hw), yaw: best.yaw }, 'building', `${info.source} (legacy box)`);
    swapped++;
  }
  return swapped;
}

/** In-page: walks one polyline; returns contacts and stuck events. Runs inside the page (no closures). */
async function walkLegInPage({ pts, maxSeconds }) {
  const T = window.__flightTest;
  const E = window.__evren;
  const col = E.ctx.services.get('collision');
  const sim = T.sim;
  T.options({ wind: false, turbulence: false, thermals: false });
  T.input(null);
  const heading = (dx, dz) => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
  const r2 = (v) => Math.round(v * 100) / 100;
  const contacts = [];
  const stuck = [];
  const place = (x, z, tx, tz) => {
    const y = col.surfaceHeight(x, z) + 3;
    T.teleport(x, y, z, heading(tx - x, tz - z), 0, 0);
    T.ground();
  };
  sim.contacts.onWall = (id, surface, sphere, p) => {
    const b = sim.body.position;
    contacts.push({ id, surface, sphere, x: r2(p.x), y: r2(p.y), z: r2(p.z), bx: r2(b.x), by: r2(b.y), bz: r2(b.z), yaw: r2(sim.groundYaw) });
  };
  let walked = 0;
  try {
    place(pts[0], pts[1], pts[2], pts[3]);
    for (let k = 2; k < pts.length; k += 2) {
      const tx = pts[k];
      const tz = pts[k + 1];
      let t = 0;
      let last = { x: sim.body.position.x, z: sim.body.position.z, t: 0 };
      let skipped = false;
      while (t < maxSeconds) {
        let done = false;
        T.simulate(
          1,
          (_t, s, cmd) => {
            const p = s.body.position;
            const want = Math.atan2(-(tx - p.x), -(tz - p.z));
            let err = want - s.groundYaw;
            err = Math.atan2(Math.sin(err), Math.cos(err));
            cmd.pitch = Math.abs(err) > 1.2 ? 0.15 : 1;
            cmd.roll = Math.max(-1, Math.min(1, -err * 2.5));
            cmd.dive = false;
          },
          1,
          (s) => {
            if (s.mode !== 'grounded') {
              // Fell off the quay / leapt: put it back on the ground where it is.
              s.placeOnGround();
            }
            done = Math.hypot(tx - s.body.position.x, tz - s.body.position.z) < 3;
            return done;
          },
        );
        t += 1;
        const p = sim.body.position;
        if (done) break;
        if (t - last.t >= 3) {
          const moved = Math.hypot(p.x - last.x, p.z - last.z);
          walked += moved;
          if (moved < 2) {
            stuck.push({ x: r2(p.x), z: r2(p.z), target: [tx, tz], leg: k / 2 });
            skipped = true;
            break;
          }
          last = { x: p.x, z: p.z, t };
        }
        // Let the streaming systems (trees, procedural city colliders) follow the dragon.
        await new Promise((r) => setTimeout(r, 30));
      }
      if (skipped || t >= maxSeconds) {
        place(tx, tz, pts[k + 2] ?? tx + 1, pts[k + 3] ?? tz);
      }
    }
  } finally {
    sim.contacts.onWall = null;
  }
  return { contacts, stuck, walked: Math.round(walked) };
}

/**
 * In-page: for each blocking collider, rays from the recorded body positions toward the contact points against the
 * rendered scene (dragon moved away). Returns per-collider info, hits and a phantom verdict.
 */
function classifyInPage({ ids }) {
  const E = window.__evren;
  const THREE = E.THREE;
  const col = E.ctx.services.get('collision');
  const scene = E.ctx.scene;
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  // Most world meshes render on the NoReflection layer (1); reflection-only (2) and shadow-only (5) copies are skipped.
  ray.layers.enableAll();
  const dragon = E.ctx.services.tryGet('dragon')?.object ?? null;
  const skip = (o) => {
    for (let q = o; q; q = q.parent) {
      if (!q.visible || q === dragon) return true;
      const n = q.name || '';
      if (/terrain|water|sky|cloud|ocean|sea|ground|dragon/i.test(n)) return true;
    }
    return o.isPoints || o.isSprite || o.isLine || (o.layers.mask & 0b11) === 0;
  };
  const targets = [];
  const unverifiable = [];
  scene.traverseVisible((o) => {
    if ((o.isMesh || o.isInstancedMesh) && !skip(o)) {
      // Meshes whose CPU arrays were released after upload (procedural city chunks) cannot be ray tested.
      if (o.geometry?.attributes?.position?.array) targets.push(o);
      else unverifiable.push(o.name || o.type);
    }
  });
  const cast = () => {
    let best = null;
    for (const t of targets) {
      try {
        const h = ray.intersectObject(t, false)[0];
        if (h && (!best || h.distance < best.distance)) best = h;
      } catch {
        /* released index buffer */
      }
    }
    return best;
  };
  const o = new THREE.Vector3();
  const d = new THREE.Vector3();
  const out = [];
  for (const { id, samples } of ids) {
    const rec = id > 0 ? col.debugCollider(id) : null;
    let seen = 0;
    const tried = [];
    for (const s of samples) {
      if (s.sphere < 0) {
        // Blocked step: look straight down at the point the dragon could not step onto.
        const ground = Math.max(col.terrainHeight(s.x, s.z), 0);
        o.set(s.x, s.y + 20, s.z);
        ray.set(o, d.set(0, -1, 0));
        ray.far = s.y + 20 - ground - 1;
        const h = cast();
        const hit = h ? { d: Math.round(h.distance * 10) / 10, name: h.object.name || h.object.type } : null;
        tried.push(hit);
        if (hit) seen++;
        continue;
      }
      d.set(s.x - s.bx, 0, s.z - s.bz);
      const reach = d.length();
      if (reach < 1e-3) continue;
      d.divideScalar(reach);
      let hit = null;
      for (const dy of [-1, 0, 1.5]) {
        o.set(s.bx, s.y + dy, s.bz);
        ray.set(o, d);
        ray.far = reach + 1.5;
        const h = cast();
        if (h && (!hit || h.distance < hit.d)) hit = { d: Math.round(h.distance * 10) / 10, name: h.object.name || h.object.type };
      }
      tried.push(hit);
      if (hit) seen++;
    }
    out.push({ id, info: rec?.info ?? null, shape: rec?.collider ?? null, rendered: seen, samples: tried.length, hits: tried.slice(0, 3), phantom: tried.length > 0 && seen === 0 });
  }
  return { targets: targets.length, unverifiable: unverifiable.length, colliders: out };
}

export async function runDragonWalk(browser, { base, root, only, log, legacyBoxes = false, maxSeconds = 90, url = '/?view=galata&nohud=1' }) {
  const routes = eminonuRoutes(root).filter((r) => !only.length || only.includes(r.id));
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text().slice(0, 400));
  });
  // Keep the shared dev server's hot reload (other agents editing) from reloading the page mid-walk.
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    window.WebSocket = function (u, protocol) {
      if (protocol === 'vite-hmr' || String(u).includes('token=')) {
        const stub = new EventTarget();
        stub.readyState = 0;
        stub.send = () => {};
        stub.close = () => {};
        return stub;
      }
      return new NativeSocket(u, protocol);
    };
  });
  const target = base + url + (url.includes('fps=') ? '' : `${url.includes('?') ? '&' : '?'}fps=24`);
  await page.goto(target, { waitUntil: 'load', timeout: 60000 });
  const ready = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const ok = await page.evaluate(() => !!window.__flightTest && !!window.__evren?.ready && window.__evren.pending() === 0).catch(() => false);
      if (ok) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  if (!(await ready(120000))) {
    await page.close();
    return { error: 'page did not become ready', errors };
  }
  // Park the dragon in the middle of Eminönü and let everything around it stream in.
  await page.evaluate(() => {
    const T = window.__flightTest;
    T.teleport(-4040, 40, 3050, 90, 0, 0);
    T.ground();
  });
  await ready(60000);
  await page.waitForTimeout(1500);
  if (legacyBoxes) log(`legacy boxes: ${await page.evaluate(legacyBoxesInPage)} building prisms swapped for oriented boxes`);

  const results = [];
  const byId = new Map();
  for (const r of routes) {
    const res = { id: r.id, label: r.label, walked: 0, contacts: 0, stuck: [], colliders: {} };
    for (const pts of r.legs) {
      const leg = await page.evaluate(walkLegInPage, { pts, maxSeconds });
      res.walked += leg.walked;
      res.contacts += leg.contacts.length;
      res.stuck.push(...leg.stuck);
      for (const c of leg.contacts) {
        const key = c.id;
        res.colliders[key] = (res.colliders[key] ?? 0) + 1;
        let e = byId.get(key);
        if (!e) {
          e = { id: key, surface: c.surface, count: 0, routes: new Set(), samples: [] };
          byId.set(key, e);
        }
        e.count++;
        e.routes.add(r.id);
        if (e.samples.length < 6 && (e.samples.length === 0 || e.count % 7 === 0)) e.samples.push(c);
      }
    }
    log(`${r.id}: ${r.legs.length} legs, walked ${res.walked} m, ${res.contacts} blocking contacts on ${Object.keys(res.colliders).length} colliders, ${res.stuck.length} stuck`);
    results.push(res);
  }
  // Compare every blocking collider with the rendered scene: park the dragon where it touched it (so the near LODs are
  // drawn there), let a few frames render, then ray-test with the dragon's own meshes excluded.
  const classified = [];
  let cls = { targets: 0, unverifiable: 0 };
  for (const e of byId.values()) {
    const s0 = e.samples[0];
    await page.evaluate(([x, y, z]) => {
      window.__flightTest.teleport(x, y, z, 0, 0, 0);
      window.__flightTest.ground();
    }, [s0.bx, s0.by, s0.bz]);
    await page.waitForTimeout(600);
    cls = await page.evaluate(classifyInPage, { ids: [{ id: e.id, samples: e.samples }] });
    classified.push(...cls.colliders);
  }
  const colliders = classified.map((c) => {
    const e = byId.get(c.id);
    return { ...c, surface: e.surface, contacts: e.count, routes: [...e.routes], at: e.samples.slice(0, 2).map((s) => [s.x, s.y, s.z]) };
  });
  for (const c of colliders) {
    const k = c.phantom && KNOWN.find((n) => c.info?.source === n.source && c.at.some(([x, , z]) => Math.hypot(x - n.x, z - n.z) < n.r));
    if (k) {
      c.phantom = false;
      c.known = k.note;
    }
  }
  colliders.sort((a, b) => Number(b.phantom) - Number(a.phantom) || b.contacts - a.contacts);
  await page.close();
  const phantoms = colliders.filter((c) => c.phantom);
  log(`${colliders.length} blocking colliders, ${phantoms.length} phantom (no rendered mesh at the contact), ${cls.targets} rendered meshes tested, ${cls.unverifiable} without CPU geometry`);
  for (const k of colliders.filter((c) => c.known)) log(`  known #${k.id} ${k.info?.tag} ${k.info?.source} x${k.contacts}: ${k.known}`);
  for (const p of phantoms) log(`  phantom #${p.id} ${p.info?.tag}${p.info?.source ? ` ${p.info.source}` : ''} ${p.info?.kind} bounds ${JSON.stringify(p.info?.bounds)} x${p.contacts} at ${JSON.stringify(p.at[0])} (${p.routes.join(',')})`);
  return { routes: results, colliders, phantoms: phantoms.length, known: colliders.filter((c) => c.known).length, stuck: results.reduce((a, r) => a + r.stuck.length, 0), errors: errors.slice(0, 20) };
}
