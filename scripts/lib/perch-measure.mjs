/**
 * In-page perch measurement for scripts/perch-audit.mjs (runs inside the game page through snap.mjs --batch eval):
 * sits the dragon on a perch (window.__evrenUi.perch), picks the perch camera (orbit / fixed / rider), waits for the
 * streaming to settle and raycasts the rendered scene (every visible mesh except the dragon, sky, water, particles):
 * - dragonOccluded: share of 14 points of the dragon's body hidden from the camera;
 * - viewBlocked60: share of a 7 x 5 screen grid of camera rays blocked within 60 m;
 * - eyeCone60: share of rays from the dragon's eye along the perch heading (±30° yaw, -15..+5° pitch) blocked in 60 m;
 * - ring40Top / clearNeighbours: highest rendered surface 12-40 m around the grip point and the grip's clearance;
 * - dragonScreen: the dragon's centre in NDC and its screen height.
 * Vegetation trees (instanced in the vertex shader) are tested as crown cylinders from their instance data. Meshes
 * whose CPU arrays were released after upload cannot be raycast; they are listed as `unraycastable`.
 */
export async function perchMeasure(id, mode, hour) {
  const E = window.__evren;
  const U = window.__evrenUi;
  const T = E.THREE;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  E.setTime(hour);
  const ok = U.perch(id);
  if (!ok) return { id, mode, ok: false };
  await wait(1200);
  for (let i = 0; i < 160 && E.pending() > 0; i++) await wait(250);
  const cam = E.engine.entries.find((e) => e.system.name === 'camera').system;
  if (mode === 'fixed') cam.cyclePerchCamera();
  if (mode === 'rider') { cam.cyclePerchCamera(); cam.cyclePerchCamera(); }
  await wait(3500);
  for (let i = 0; i < 80 && E.pending() > 0; i++) await wait(250);
  await wait(800);
  const ctx = E.ctx;
  const dragon = ctx.services.get('dragon');
  const col = ctx.services.get('collision');
  const perch = ctx.services.get('perches').get(id);
  const camera = ctx.camera;
  camera.updateMatrixWorld();
  const C = camera.getWorldPosition(new T.Vector3());
  const root = dragon.object;
  const inDragon = (o) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const skip = /sky|water|sea|cloud|ocean|atmos|rain|fog|star|sun|moon|bird|gull|wake|spray|particle|shadow|underwater/i;
  const list = [];
  ctx.scene.traverse((o) => {
    if (!(o.isMesh || o.isInstancedMesh || o.isBatchedMesh)) return;
    if (inDragon(o) || !shown(o)) return;
    const name = (o.name || '') + '|' + (o.parent?.name || '');
    if (skip.test(name)) return;
    if (o.material && (Array.isArray(o.material) ? false : o.material.transparent && o.material.opacity < 0.2)) return;
    list.push(o);
  });
  const perch0 = ctx.services.get('perches').get(id);
  const trees = [];
  ctx.scene.traverse((o) => {
    if (!o.isMesh || !/^veg-lod[01]-/.test(o.name) || !shown(o)) return;
    const g = o.geometry;
    const i0 = g.attributes.aInst0;
    const i1 = g.attributes.aInst1;
    if (!i0 || !i1) return;
    let h = 18;
    let r = 4;
    try {
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      if (bb && Number.isFinite(bb.max.y) && bb.max.y > 1) {
        h = bb.max.y;
        r = Math.max(bb.max.x, -bb.min.x, bb.max.z, -bb.min.z) * 0.85;
      }
    } catch (e) { /* released arrays: keep the defaults */ }
    const n = g.instanceCount ?? i0.count;
    for (let i = 0; i < n; i++) {
      const x = i0.getX(i);
      const z = i0.getZ(i);
      if (Math.hypot(x - perch0.x, z - perch0.z) > 250) continue;
      const y = i0.getY(i);
      const sc = i1.getX(i);
      trees.push({ x, z, y0: y + h * sc * 0.25, y1: y + h * sc, r: r * sc });
    }
  });
  const rc = new T.Raycaster();
  rc.firstHitOnly = true;
  const broken = {};
  const bad = new Set();
  const hit = (from, dir, far) => {
    rc.set(from, dir);
    rc.near = 0.2;
    rc.far = far;
    const acc = [];
    for (const o of list) {
      if (bad.has(o)) continue;
      try { o.raycast(rc, acc); } catch (e) { bad.add(o); const n = o.name || o.parent?.name || o.type; broken[n] = (broken[n] || 0) + 1; }
    }
    // Vegetation trees are instanced in the vertex shader (not raycastable): crowns as vertical cylinders.
    for (const t of trees) {
      const ox = from.x - t.x;
      const oz = from.z - t.z;
      const a = dir.x * dir.x + dir.z * dir.z;
      if (a < 1e-9) {
        if (ox * ox + oz * oz <= t.r * t.r && ((dir.y < 0 && from.y > t.y1) || (dir.y > 0 && from.y < t.y0))) {
          const d = dir.y < 0 ? from.y - t.y1 : t.y0 - from.y;
          if (d >= rc.near && d <= far) acc.push({ distance: d, point: from.clone().addScaledVector(dir, d), object: { name: 'vegetation-tree' } });
        }
        continue;
      }
      const b = 2 * (ox * dir.x + oz * dir.z);
      const c = ox * ox + oz * oz - t.r * t.r;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      for (const d of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        if (d < rc.near || d > far) continue;
        const y = from.y + dir.y * d;
        if (y >= t.y0 && y <= t.y1) {
          acc.push({ distance: d, point: from.clone().addScaledVector(dir, d), object: { name: 'vegetation-tree' } });
          break;
        }
      }
    }
    if (!acc.length) return null;
    acc.sort((a, b) => a.distance - b.distance);
    return acc[0];
  };
  const box = new T.Box3().setFromObject(root);
  const ctr = box.getCenter(new T.Vector3());
  const sz = box.getSize(new T.Vector3());
  // dragon occlusion from the camera: 13 points inside the body box
  const pts = [ctr.clone()];
  for (const sx of [-0.3, 0.3]) for (const sy of [-0.2, 0.25]) for (const sz2 of [-0.3, 0.3]) pts.push(new T.Vector3(ctr.x + sx * sz.x, ctr.y + sy * sz.y, ctr.z + sz2 * sz.z));
  pts.push(new T.Vector3(ctr.x, box.max.y - 0.3, ctr.z));
  let blocked = 0;
  const blockers = {};
  const dir = new T.Vector3();
  for (const p of pts) {
    dir.subVectors(p, C);
    const L = dir.length();
    if (L < 0.5) continue;
    dir.divideScalar(L);
    const h = hit(C, dir, L - 0.8);
    if (h) { blocked++; const n = h.object.name || h.object.parent?.name || h.object.type; blockers[n] = (blockers[n] || 0) + 1; }
  }
  // view cone from the camera through the screen (grid), first 60 m, ignoring the dragon
  let vb = 0, vn = 0;
  const vblk = {};
  for (let gy = -0.8; gy <= 0.81; gy += 0.4) for (let gx = -0.9; gx <= 0.91; gx += 0.3) {
    const v = new T.Vector3(gx, gy, 0.5).unproject(camera).sub(C).normalize();
    vn++;
    const h = hit(C, v, 60);
    if (h) { vb++; const n = h.object.name || h.object.parent?.name || h.object.type; vblk[n] = (vblk[n] || 0) + 1; }
  }
  // view cone from the dragon's eye along the perch heading (±30° yaw, -15..+5° pitch), 60 m
  const eye = new T.Vector3(ctr.x, box.max.y + 0.5, ctr.z);
  const hd = (perch.headingDeg * Math.PI) / 180;
  let eb = 0, en = 0;
  for (const dy of [-30, -15, 0, 15, 30]) for (const dp of [-15, -5, 5]) {
    const a = hd + (dy * Math.PI) / 180, p = (dp * Math.PI) / 180;
    const v = new T.Vector3(Math.sin(a) * Math.cos(p), Math.sin(p), -Math.cos(a) * Math.cos(p));
    en++;
    if (hit(eye, v, 60)) eb++;
  }
  // neighbours: highest surface on a ring 12..40 m around the grip point (downward rays)
  let tallest = -Infinity;
  let tallName = '';
  const down = new T.Vector3(0, -1, 0);
  for (let r = 12; r <= 40; r += 7) for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const o = new T.Vector3(perch.x + Math.cos(a) * r, perch.y + 200, perch.z + Math.sin(a) * r);
    const h = hit(o, down, 400);
    const hn = h ? h.object.name || h.object.parent?.name || h.object.type : '';
    // The perch's own mosque model (its minarets) is the perch structure, not a neighbour.
    if (h && perch.landmarkId && hn.endsWith(':' + perch.landmarkId)) continue;
    if (h && h.point.y > tallest) { tallest = h.point.y; tallName = hn; }
  }
  const terrain = col.terrainHeight(perch.x, perch.z);
  const ndc = ctr.clone().project(camera);
  const top = new T.Vector3(ctr.x, box.max.y, ctr.z).project(camera);
  const bot = new T.Vector3(ctr.x, box.min.y, ctr.z).project(camera);
  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    id, mode, hour, ok,
    phase: dragon.perch?.phase,
    perchY: r1(perch.y), terrain: r1(terrain), aboveGround: r1(perch.y - Math.max(terrain, 0)),
    ring40Top: r1(tallest), clearNeighbours: r1(perch.y - tallest), tallName,
    camDist: r1(C.distanceTo(ctr)), camUp: r1(C.y - ctr.y), fov: camera.fov,
    dragonScreen: { x: r1(ndc.x), y: r1(ndc.y), h: r1(top.y - bot.y) },
    dragonOccluded: r1(blocked / pts.length), blockers,
    viewBlocked60: r1(vb / vn), viewBlockers: vblk,
    eyeCone60: r1(eb / en),
    meshes: list.length, trees: trees.length, unraycastable: broken,
  };
}
