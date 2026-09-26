/**
 * Dragon ground-walk collision test (used by scripts/walk-test.mjs --dragon): walks the dragon along planned routes in
 * the full game with the deterministic fast-forward (window.__flightTest.simulate), logs every blocking contact (wall
 * push-outs and blocked steps) with the collider behind it, and checks each blocking collider against what is rendered
 * there: a collider is a phantom when rays cast from the dragon's body toward the contact point hit no rendered mesh
 * (dragon hidden) within reach. The page runs with ?keepGeometry=1 so the procedural city keeps its chunk geometry on
 * the CPU (players release it after upload) and its buildings are ray tested like everything else; a contact that can
 * still only be checked against released geometry gets the verdict `unverified`.
 *
 * Routes come from scripts/lib/walk-routes.mjs (built from any area's OSM street data, or a named preset). Every stuck
 * spot is classified: `phantom` (a phantom collider blocked it), `narrow` (the rendered street is narrower than the
 * dragon), `obstacle` (blocked by rendered geometry in a street wide enough), `step` (a ledge too high to step onto)
 * or `no-contact` (no blocking contact: slope, turning circle or water). Narrow: rendered width across the heading or
 * the mapped width of the OSM way below NARROW_M.
 */
import { knownFor, nearestWay } from './walk-routes.mjs';

/**
 * In-page (--legacy-boxes, before/after evidence only): swaps every OSM building footprint prism in the rect for the
 * minimum-area oriented box the buildings worker used to register (same algorithm as buildings/footprint.ts orientedBox).
 */
function legacyBoxesInPage(rect) {
  const E = window.__evren;
  const THREE = E.THREE;
  const col = E.ctx.services.get('collision');
  let swapped = 0;
  for (const info of col.debugEntries(rect.minX, rect.minZ, rect.maxX, rect.maxZ)) {
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

/**
 * In-page, once per page: window.__walkTest ray helpers against the rendered scene (dragon, terrain, water, sky and
 * shadow/reflection-only copies skipped). Meshes whose CPU arrays were released cannot be ray tested; their world
 * bounding boxes are kept so a miss next to one is reported as unverified rather than phantom.
 */
function installHelpersInPage() {
  const E = window.__evren;
  const THREE = E.THREE;
  const scene = E.ctx.scene;
  const ray = new THREE.Raycaster();
  // Most world meshes render on the NoReflection layer (1); reflection-only (2) and shadow-only (5) copies are skipped.
  ray.layers.enableAll();
  let targets = [];
  let opaque = [];
  let instanced = [];
  const skip = (o, dragon) => {
    for (let q = o; q; q = q.parent) {
      if (!q.visible || q === dragon) return true;
      const n = q.name || '';
      if (/terrain|water|sky|cloud|ocean|sea|ground|dragon|collider-overlay/i.test(n)) return true;
    }
    return o.isPoints || o.isSprite || o.isLine || (o.layers.mask & 0b11) === 0;
  };
  const collect = () => {
    scene.updateMatrixWorld(true);
    const dragon = E.ctx.services.tryGet('dragon')?.object ?? null;
    targets = [];
    opaque = [];
    instanced = [];
    scene.traverseVisible((o) => {
      if (!(o.isMesh || o.isInstancedMesh) || skip(o, dragon)) return;
      const ga = o.geometry?.attributes;
      if (o.geometry?.isInstancedBufferGeometry) {
        // Shader-instanced meshes (tree pools: aInst0 = base xyz + yaw, aInst1.x = scale, .w = crown width) are ray
        // tested per instance below; other instanced geometry cannot be placed on the CPU.
        if (ga.aInst0 && ga.aInst1 && ga.position?.array && o.geometry.instanceCount > 0) instanced.push(o);
        else if (o.geometry.boundingSphere) {
          const sp = o.geometry.boundingSphere;
          opaque.push({ name: o.name || o.type, box: new THREE.Box3(sp.center.clone().subScalar(sp.radius), sp.center.clone().addScalar(sp.radius)).applyMatrix4(o.matrixWorld) });
        }
        return;
      }
      if (ga?.position?.array) targets.push(o);
      else {
        const g = o.geometry;
        if (g && !g.boundingBox && g.boundingSphere) {
          const s = g.boundingSphere;
          g.boundingBox = new THREE.Box3(s.center.clone().subScalar(s.radius), s.center.clone().addScalar(s.radius));
        }
        if (g?.boundingBox) opaque.push({ name: o.name || o.type, box: g.boundingBox.clone().applyMatrix4(o.matrixWorld) });
      }
    });
    return { targets: targets.length, instanced: instanced.length, unverifiable: opaque.length };
  };
  // Large static meshes (procedural city chunks kept with ?keepGeometry=1: 100k+ triangles each) are ray tested
  // through a lazily built xz grid of their triangles instead of three's brute-force Mesh.raycast.
  const BIG = 20000;
  const CELL = 16;
  const grids = new WeakMap();
  const gridOf = (g) => {
    let e = grids.get(g);
    if (e) return e;
    const pos = g.attributes.position.array;
    const idx = g.index.array;
    const n = idx.length / 3;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]);
      z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]);
    }
    const nx = Math.max(1, Math.ceil((x1 - x0) / CELL));
    const nz = Math.max(1, Math.ceil((z1 - z0) / CELL));
    const range = (t) => {
      let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k] * 3;
        a = Math.min(a, pos[v]); b = Math.max(b, pos[v]); c = Math.min(c, pos[v + 2]); d = Math.max(d, pos[v + 2]);
      }
      return [Math.min(nx - 1, Math.floor((a - x0) / CELL)), Math.min(nx - 1, Math.floor((b - x0) / CELL)), Math.min(nz - 1, Math.floor((c - z0) / CELL)), Math.min(nz - 1, Math.floor((d - z0) / CELL))];
    };
    const count = new Int32Array(nx * nz + 1);
    for (let t = 0; t < n; t++) {
      const [i0, i1, j0, j1] = range(t);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) count[j * nx + i + 1]++;
    }
    for (let k = 1; k <= nx * nz; k++) count[k] += count[k - 1];
    const fill = count.slice();
    const tris = new Int32Array(count[nx * nz]);
    for (let t = 0; t < n; t++) {
      const [i0, i1, j0, j1] = range(t);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) tris[fill[j * nx + i]++] = t;
    }
    e = { x0, z0, nx, nz, start: count, tris };
    grids.set(g, e);
    return e;
  };
  const inv = new THREE.Matrix4();
  const lray = new THREE.Ray();
  const ta = new THREE.Vector3(), tb = new THREE.Vector3(), tc = new THREE.Vector3(), hit = new THREE.Vector3();
  const castGrid = (t, far) => {
    const g = t.geometry;
    const e = gridOf(g);
    inv.copy(t.matrixWorld).invert();
    lray.copy(ray.ray).applyMatrix4(inv);
    const pos = g.attributes.position.array;
    const idx = g.index.array;
    const mats = Array.isArray(t.material) ? t.material : [t.material];
    const cull = mats.every((m) => m.side === THREE.FrontSide);
    const ex = lray.origin.x + lray.direction.x * far;
    const ez = lray.origin.z + lray.direction.z * far;
    const ci = (x) => Math.floor((x - e.x0) / CELL);
    const cj = (z) => Math.floor((z - e.z0) / CELL);
    const i0 = Math.max(0, ci(Math.min(lray.origin.x, ex))), i1 = Math.min(e.nx - 1, ci(Math.max(lray.origin.x, ex)));
    const j0 = Math.max(0, cj(Math.min(lray.origin.z, ez))), j1 = Math.min(e.nz - 1, cj(Math.max(lray.origin.z, ez)));
    let best = null;
    const done = new Set();
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * e.nx + i;
        for (let k = e.start[c]; k < e.start[c + 1]; k++) {
          const tri = e.tris[k];
          if (done.has(tri)) continue;
          done.add(tri);
          ta.fromArray(pos, idx[tri * 3] * 3);
          tb.fromArray(pos, idx[tri * 3 + 1] * 3);
          tc.fromArray(pos, idx[tri * 3 + 2] * 3);
          if (!lray.intersectTriangle(ta, tb, tc, cull, hit)) continue;
          hit.applyMatrix4(t.matrixWorld);
          const dist = hit.distanceTo(ray.ray.origin);
          if (dist <= far && (!best || dist < best.distance)) best = { distance: dist, point: hit.clone(), object: t };
        }
      }
    }
    return best;
  };
  const im = new THREE.Matrix4();
  const iq = new THREE.Quaternion();
  const ip = new THREE.Vector3();
  const isc = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const castInstanced = (t, far) => {
    const g = t.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const reach = g.boundingSphere.center.length() + g.boundingSphere.radius;
    const pos = g.attributes.position.array;
    const idx = g.index?.array ?? null;
    const n = idx ? idx.length / 3 : pos.length / 9;
    const a0 = g.attributes.aInst0;
    const a1 = g.attributes.aInst1;
    const mats = Array.isArray(t.material) ? t.material : [t.material];
    const cull = mats.every((m) => m.side === THREE.FrontSide);
    let best = null;
    for (let i = 0; i < g.instanceCount; i++) {
      ip.set(a0.getX(i), a0.getY(i), a0.getZ(i));
      const scale = a1.getX(i);
      const width = a1.getW(i) || 1;
      const r = reach * scale * Math.max(1, width);
      if (ray.ray.distanceSqToPoint(ip) > r * r || ip.distanceTo(ray.ray.origin) > far + r) continue;
      im.compose(ip, iq.setFromAxisAngle(yAxis, a0.getW(i)), isc.set(width * scale, scale, width * scale));
      inv.copy(im).invert();
      lray.copy(ray.ray).applyMatrix4(inv);
      for (let k = 0; k < n; k++) {
        const v0 = idx ? idx[k * 3] : k * 3;
        const v1 = idx ? idx[k * 3 + 1] : k * 3 + 1;
        const v2 = idx ? idx[k * 3 + 2] : k * 3 + 2;
        ta.fromArray(pos, v0 * 3);
        tb.fromArray(pos, v1 * 3);
        tc.fromArray(pos, v2 * 3);
        if (!lray.intersectTriangle(ta, tb, tc, cull, hit)) continue;
        hit.applyMatrix4(im);
        const dist = hit.distanceTo(ray.ray.origin);
        if (dist <= far && (!best || dist < best.distance)) best = { distance: dist, point: hit.clone(), object: t, instanceId: i };
      }
    }
    return best;
  };
  const cast = (o, d, far) => {
    ray.set(o, d);
    ray.far = far;
    let best = null;
    for (const t of instanced) {
      const h = castInstanced(t, far);
      if (h && (!best || h.distance < best.distance)) best = h;
    }
    for (const t of targets) {
      try {
        const g = t.geometry;
        const big = t.isMesh && !t.isInstancedMesh && !t.isSkinnedMesh && g.index && g.index.count > BIG * 3 && !g.morphAttributes?.position;
        if (big) {
          if (!g.boundingSphere) g.computeBoundingSphere();
          const s = g.boundingSphere.clone().applyMatrix4(t.matrixWorld);
          if (ray.ray.distanceSqToPoint(s.center) > s.radius * s.radius && s.center.distanceTo(o) > s.radius) continue;
        }
        const h = big ? castGrid(t, far) : ray.intersectObject(t, false)[0];
        if (h && (!best || h.distance < best.distance)) best = h;
      } catch {
        /* released index buffer */
      }
    }
    return best;
  };
  /** Names of released-geometry meshes whose bounds the ray passes through within `far`. */
  const opaqueOn = (o, d, far) => {
    ray.set(o, d);
    const out = [];
    const p = new THREE.Vector3();
    for (const q of opaque) {
      if (q.box.containsPoint(o) || (ray.ray.intersectBox(q.box, p) && p.distanceTo(o) <= far)) out.push(q.name);
    }
    return out;
  };
  const V = () => new THREE.Vector3();
  /** Free rendered width across the heading at (x, y, z): left + right distance to the nearest mesh (cap 40 m). */
  const corridor = (x, y, z, dx, dz) => {
    collect();
    const l = Math.hypot(dx, dz) || 1;
    const side = V().set(-dz / l, 0, dx / l);
    const fwd = V().set(dx / l, 0, dz / l);
    let left = 40;
    let right = 40;
    let ahead = 40;
    for (const dy of [1.5, 3]) {
      const o = V().set(x, y + dy, z);
      left = Math.min(left, cast(o, side, 40)?.distance ?? 40);
      right = Math.min(right, cast(o, side.clone().negate(), 40)?.distance ?? 40);
      ahead = Math.min(ahead, cast(o, fwd, 40)?.distance ?? 40);
    }
    const r = (v) => Math.round(v * 10) / 10;
    return { width: r(left + right), left: r(left), right: r(right), ahead: r(ahead), unverifiable: opaqueOn(V().set(x, y + 2, z), side, 20).length + opaqueOn(V().set(x, y + 2, z), side.clone().negate(), 20).length };
  };
  /** Same ray with every target drawn double sided: finds walls that exist but face away (back-face culled). */
  const castBack = (o, d, far) => {
    const saved = [];
    for (const t of [...targets, ...instanced]) {
      for (const m of Array.isArray(t.material) ? t.material : [t.material]) {
        if (m && m.side !== THREE.DoubleSide) {
          saved.push([m, m.side]);
          m.side = THREE.DoubleSide;
        }
      }
    }
    try {
      return cast(o, d, far);
    } finally {
      for (const [m, side] of saved) m.side = side;
    }
  };
  /** Diagnostics (--probe): nearest front and double-sided hits in 16 directions at 1.5 m and 4 m, colliders around. */
  const probe = (x, z, r = 12) => {
    collect();
    const col = E.ctx.services.get('collision');
    const y = col.surfaceHeight(x, z);
    const rays = [];
    for (const dy of [1.5, 4]) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const o = V().set(x, y + dy, z);
        const d = V().set(Math.cos(a), 0, Math.sin(a));
        const f = cast(o, d, r);
        const b = f ? null : castBack(o, d, r);
        rays.push({ dy, deg: k * 22.5, front: f ? { d: +f.distance.toFixed(1), name: f.object.name || f.object.type } : null, back: b ? { d: +b.distance.toFixed(1), name: b.object.name || b.object.type } : null, opaque: opaqueOn(o, d, r).slice(0, 2) });
      }
    }
    const near = col.debugEntries(x - r, z - r, x + r, z + r).map((i) => ({ id: i.id, tag: i.tag, source: i.source, kind: i.kind, bounds: i.bounds }));
    const penetrating = col.debugSphere(V().set(x, y + 2, z), 3);
    return { x, z, surface: +y.toFixed(2), rays, near, penetrating };
  };
  // Collider records captured at the first contact: streamed colliders (trees, steps, city tiles) can be gone again by
  // the time the contacts are classified, and the report still names their source.
  const seen = new Map();
  window.__walkTest = { collect, cast, castBack, opaqueOn, corridor, probe, seen };
  return collect();
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
  const seen = window.__walkTest.seen;
  sim.contacts.onWall = (id, surface, sphere, p) => {
    const b = sim.body.position;
    if (id > 0 && !seen.has(id)) seen.set(id, col.debugCollider(id) ?? null);
    contacts.push({ id, surface, sphere, x: r2(p.x), y: r2(p.y), z: r2(p.z), bx: r2(b.x), by: r2(b.y), bz: r2(b.z), yaw: r2(sim.groundYaw) });
  };
  let walked = 0;
  let reached = 0;
  const waypoints = pts.length / 2 - 1;
  try {
    place(pts[0], pts[1], pts[2], pts[3]);
    for (let k = 2; k < pts.length; k += 2) {
      const tx = pts[k];
      const tz = pts[k + 1];
      let t = 0;
      let last = { x: sim.body.position.x, z: sim.body.position.z, t: 0, contact: contacts.length };
      let skipped = false;
      let done = false;
      while (t < maxSeconds) {
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
        if (done) {
          walked += Math.hypot(p.x - last.x, p.z - last.z);
          break;
        }
        if (t - last.t >= 3) {
          const moved = Math.hypot(p.x - last.x, p.z - last.z);
          walked += moved;
          if (moved < 2) {
            // Colliders that blocked it in the last window, most contacts first.
            const ids = {};
            for (const c of contacts.slice(last.contact)) ids[c.id] = (ids[c.id] ?? 0) + 1;
            const steps = contacts.slice(last.contact).filter((c) => c.sphere < 0).length;
            const dx = tx - p.x;
            const dz = tz - p.z;
            stuck.push({
              x: r2(p.x),
              y: r2(p.y),
              z: r2(p.z),
              target: [tx, tz],
              leg: k / 2,
              ids: Object.entries(ids).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id: Number(id), n })),
              steps,
              corridor: window.__walkTest.corridor(p.x, col.surfaceHeight(p.x, p.z), p.z, dx, dz),
            });
            skipped = true;
            break;
          }
          last = { x: p.x, z: p.z, t, contact: contacts.length };
        }
        // Let the streaming systems (trees, procedural city colliders, street tiles) follow the dragon.
        await new Promise((r) => setTimeout(r, 30));
      }
      if (done) reached++;
      if (skipped || t >= maxSeconds) {
        place(tx, tz, pts[k + 2] ?? tx + 1, pts[k + 3] ?? tz);
      }
    }
  } finally {
    sim.contacts.onWall = null;
  }
  return { contacts, stuck, walked: Math.round(walked), reached, waypoints };
}

/**
 * In-page: for each blocking collider, rays from the recorded body positions toward the contact points against the
 * rendered scene. Returns per-collider info, hits and a verdict (phantom / unverified).
 */
function classifyInPage({ ids }) {
  /** A blocked step is explained by drawn geometry whose top is at most this far (m) below the contact. */
  const LEDGE_TOLERANCE = 0.5;
  const E = window.__evren;
  const THREE = E.THREE;
  const col = E.ctx.services.get('collision');
  const W = window.__walkTest;
  const stats = W.collect();
  const o = new THREE.Vector3();
  const d = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const out = [];
  for (const { id, samples } of ids) {
    const live = id > 0 ? col.debugCollider(id) : null;
    const rec = live ?? W.seen.get(id) ?? null;
    let seen = 0;
    let opaque = 0;
    let back = 0;
    const tried = [];
    for (const s of samples) {
      if (s.sphere < 0) {
        // Blocked step: look straight down at the point the dragon could not step onto.
        // The contact lies on the ledge's edge, where a vertical ray grazes the drawn wall: also look up to 0.3 m further in
        // (from the body toward the contact).
        const ground = Math.max(col.terrainHeight(s.x, s.z), 0);
        const l = Math.hypot(s.x - s.bx, s.z - s.bz) || 1;
        d.set(0, -1, 0);
        const far = s.y + 20 - ground - 1;
        let h = null;
        for (const inset of [0, 0.08, 0.16, 0.3]) {
          o.set(s.x + ((s.x - s.bx) / l) * inset, s.y + 20, s.z + ((s.z - s.bz) / l) * inset);
          const q = W.cast(o, d, far);
          // A drawn surface well below the blocked ledge (a roof sloping down to its eaves) does not explain it.
          if (q && o.y - q.distance >= s.y - LEDGE_TOLERANCE && (!h || q.distance < h.distance)) h = q;
        }
        const hit = h ? { d: Math.round(h.distance * 10) / 10, name: h.object.name || h.object.type } : null;
        tried.push(hit);
        if (hit) seen++;
        else if (W.opaqueOn(o, d, far).length) opaque++;
        continue;
      }
      d.set(s.x - s.bx, 0, s.z - s.bz);
      const reach = d.length();
      if (reach < 1e-3) continue;
      d.divideScalar(reach);
      let hit = null;
      let near = 0;
      // A contact on a convex corner lies exactly on the wall edge, where a ray aimed at it grazes both faces: aim a
      // fan at the contact and 0.5 m to either side of it.
      const fan = [];
      for (const side of [0, -0.5, 0.5]) {
        const tx = s.x - d.z * side - s.bx;
        const tz = s.z + d.x * side - s.bz;
        const l = Math.hypot(tx, tz);
        fan.push([tx / l, tz / l, l + 1.5]);
      }
      for (const dy of [-1, 0, 1.5]) {
        for (const [fx, fz, far] of fan) {
          o.set(s.bx, s.y + dy, s.bz);
          const h = W.cast(o, dir.set(fx, 0, fz), far);
          if (h && (!hit || h.distance < hit.d)) hit = { d: Math.round(h.distance * 10) / 10, name: h.object.name || h.object.type };
          near += W.opaqueOn(o, dir, far).length;
        }
      }
      if (!hit) {
        for (const dy of [-1, 0, 1.5]) {
          o.set(s.bx, s.y + dy, s.bz);
          if (W.castBack(o, d, reach + 1.5)) back++;
        }
      }
      tried.push(hit);
      if (hit) seen++;
      else if (near) opaque++;
    }
    const miss = tried.length > 0 && seen === 0;
    out.push({ id, info: rec?.info ?? null, shape: rec?.collider ?? null, rendered: seen, samples: tried.length, hits: tried.slice(0, 3), backfaceHits: back, phantom: miss && opaque === 0, unverified: miss && opaque > 0, streamedOut: !live && !!rec });
  }
  return { ...stats, colliders: out };
}

/**
 * Test page parameters: 24 fps unless the URL sets it, and ?keepGeometry=1 so streamed geometry whose CPU copy is
 * released for players (procedural city chunks) stays ray-testable.
 */
function withTestParams(u) {
  const add = (q) => (u += `${u.includes('?') ? '&' : '?'}${q}`);
  if (!/[?&]fps=/.test(u)) add('fps=24');
  if (!/[?&]keepGeometry=/.test(u)) add('keepGeometry=1');
  return u;
}

async function waitReady(page, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await page.evaluate(() => !!window.__flightTest && !!window.__evren?.ready && window.__evren.pending() === 0).catch(() => false);
    if (ok) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function park(page, x, z, headingDeg = 0) {
  await page.evaluate(([px, pz, h]) => {
    const T = window.__flightTest;
    const col = window.__evren.ctx.services.get('collision');
    T.teleport(px, col.surfaceHeight(px, pz) + 3, pz, h, 0, 0);
    T.ground();
  }, [x, z, headingDeg]);
}

/**
 * A street is narrow for the dragon (3 m wide, 18 m long: it cannot turn in it) when the rendered width across the
 * heading or the mapped width of the OSM way it is on is below this (m).
 */
const NARROW_M = 6;

/** Cause of a stuck spot from its blocking colliders' verdicts and the rendered corridor there. */
function stuckCause(s, verdicts) {
  const vs = s.ids.map((c) => verdicts.get(c.id)).filter(Boolean);
  if (vs.some((v) => v.phantom)) return 'phantom';
  if (!s.ids.length) return 'no-contact';
  if (s.steps > 0 && s.steps >= s.ids.reduce((a, c) => a + c.n, 0) / 2) return 'step';
  if ((s.corridor && s.corridor.width < NARROW_M) || (s.way && s.way.d < 4 && s.way.width != null && s.way.width < NARROW_M)) return 'narrow';
  return 'obstacle';
}

/** --probe x,z[,r]: parks the dragon next to the point and returns window.__walkTest.probe() there (dragon hidden). */
export async function runProbe(browser, { base, url, points, log }) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(withTestParams(base + url), { waitUntil: 'load', timeout: 60000 });
  if (!(await waitReady(page, 120000))) {
    await page.close();
    return { error: 'page did not become ready', errors };
  }
  await page.evaluate(installHelpersInPage);
  const out = [];
  for (const [x, z, r] of points) {
    // Stand 25 m away so the near LODs around the point are drawn, then hide the dragon from the rays.
    await park(page, x + 25, z);
    await waitReady(page, 30000);
    await page.waitForTimeout(1500);
    const res = await page.evaluate(([px, pz, pr]) => window.__walkTest.probe(px, pz, pr), [x, z, r ?? 12]);
    log(`probe ${x},${z}: ${res.rays.filter((q) => q.front).length}/${res.rays.length} rays hit a front face, ${res.rays.filter((q) => q.back).length} only a back face; ${res.near.length} colliders within ${r ?? 12} m`);
    out.push(res);
  }
  await page.close();
  return { probes: out, errors };
}

/**
 * Walks every route of one area in one page. area: resolveArea() result; routes: planRoutes().routes.
 * Returns the per-area report (routes, colliders with verdicts, phantoms, stuck spots with causes, coverage, errors).
 */
export async function runDragonWalk(browser, { base, area, routes, graph, log, legacyBoxes = false, maxSeconds = 90, budgetS = 1800, url = '/?view=galata&nohud=1' }) {
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
  const target = withTestParams(base + url);
  await page.goto(target, { waitUntil: 'load', timeout: 60000 });
  if (!(await waitReady(page, 120000))) {
    await page.close();
    return { area: area.id, url, error: 'page did not become ready', errors };
  }
  // Park the dragon at the first route and let everything around it stream in.
  const first = routes[0]?.legs[0];
  if (first) await park(page, first[0], first[1]);
  await waitReady(page, 60000);
  await page.waitForTimeout(1500);
  await page.evaluate(installHelpersInPage);
  if (legacyBoxes) log(`legacy boxes: ${await page.evaluate(legacyBoxesInPage, area.rect)} building prisms swapped for oriented boxes`);

  const t0 = Date.now();
  const results = [];
  const byId = new Map();
  const stuck = [];
  let budgetHit = false;
  for (const r of routes) {
    if ((Date.now() - t0) / 1000 > budgetS) {
      budgetHit = true;
      results.push({ id: r.id, label: r.label, kind: r.kind, plannedM: r.lengthM, skipped: 'time budget' });
      continue;
    }
    const res = { id: r.id, label: r.label, kind: r.kind, plannedM: r.lengthM, walked: 0, waypoints: 0, reached: 0, contacts: 0, stuck: 0, colliders: {} };
    for (const pts of r.legs) {
      // Teleport first and let the street tiles / procedural colliders around the leg start stream in.
      await park(page, pts[0], pts[1]);
      await waitReady(page, 20000);
      const leg = await page.evaluate(walkLegInPage, { pts, maxSeconds });
      res.walked += leg.walked;
      res.waypoints += leg.waypoints;
      res.reached += leg.reached;
      res.contacts += leg.contacts.length;
      res.stuck += leg.stuck.length;
      for (const s of leg.stuck) stuck.push({ route: r.id, ...s });
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
    log(`${area.id} ${r.id} (${r.label}): planned ${r.lengthM} m, walked ${res.walked} m, ${res.reached}/${res.waypoints} waypoints, ${res.contacts} contacts on ${Object.keys(res.colliders).length} colliders, ${res.stuck} stuck`);
    results.push(res);
  }
  const walkS = Math.round((Date.now() - t0) / 1000);
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
  await page.close();
  const colliders = classified.map((c) => {
    const e = byId.get(c.id);
    return { ...c, surface: e.surface, contacts: e.count, routes: [...e.routes], at: e.samples.slice(0, 2).map((s) => [s.x, s.y, s.z]) };
  });
  for (const c of colliders) {
    const k = (c.phantom || c.unverified) && knownFor(c);
    if (k) {
      c.phantom = false;
      c.unverified = false;
      c.known = k.note;
    }
  }
  colliders.sort((a, b) => Number(b.phantom) - Number(a.phantom) || b.contacts - a.contacts);
  const verdicts = new Map(colliders.map((c) => [c.id, c]));
  for (const s of stuck) {
    s.way = nearestWay(area.data, s.x, s.z);
    s.cause = stuckCause(s, verdicts);
    s.blockers = s.ids.slice(0, 3).map((c) => ({ ...c, source: verdicts.get(c.id)?.info?.source ?? null, tag: verdicts.get(c.id)?.info?.tag ?? null, verdict: verdicts.get(c.id)?.phantom ? 'phantom' : verdicts.get(c.id)?.known ? 'known' : verdicts.get(c.id)?.unverified ? 'unverified' : 'rendered' }));
    delete s.ids;
  }
  const phantoms = colliders.filter((c) => c.phantom);
  const plannedM = routes.reduce((a, r) => a + r.lengthM, 0);
  const walkedM = results.reduce((a, r) => a + (r.walked ?? 0), 0);
  const wp = results.reduce((a, r) => a + (r.waypoints ?? 0), 0);
  const reached = results.reduce((a, r) => a + (r.reached ?? 0), 0);
  const coverage = {
    routes: routes.length,
    routesWalked: results.filter((r) => !r.skipped).length,
    plannedM,
    walkedM,
    walkedPct: plannedM ? +((walkedM / plannedM) * 100).toFixed(1) : 0,
    waypointsReachedPct: wp ? +((reached / wp) * 100).toFixed(1) : 0,
    streetGraphM: graph?.lengthM ?? null,
    streetGraphPlannedPct: graph?.coveragePct ?? null,
    budgetHit,
    walkS,
  };
  const stuckBy = {};
  for (const s of stuck) stuckBy[s.cause] = (stuckBy[s.cause] ?? 0) + 1;
  log(`${area.id}: ${colliders.length} blocking colliders, ${phantoms.length} phantom, ${colliders.filter((c) => c.unverified).length} unverified, ${cls.targets} rendered meshes tested`);
  log(`${area.id}: walked ${walkedM}/${plannedM} m in ${walkS} s, ${coverage.waypointsReachedPct}% waypoints reached; stuck ${JSON.stringify(stuckBy)}`);
  for (const k of colliders.filter((c) => c.known)) log(`  known #${k.id} ${k.info?.tag} ${k.info?.source} x${k.contacts}: ${k.known}`);
  for (const p of phantoms) log(`  phantom #${p.id} ${p.info?.tag}${p.info?.source ? ` ${p.info.source}` : ''} ${p.info?.kind} bounds ${JSON.stringify(p.info?.bounds)} x${p.contacts} at ${JSON.stringify(p.at[0])} (${p.routes.join(',')})`);
  return {
    area: area.id,
    dataFile: area.dataFile,
    rect: area.rect,
    url,
    routes: results,
    coverage,
    colliders,
    phantoms: phantoms.length,
    unverified: colliders.filter((c) => c.unverified).length,
    known: colliders.filter((c) => c.known).length,
    stuck,
    stuckBy,
    errors: errors.slice(0, 20),
  };
}
