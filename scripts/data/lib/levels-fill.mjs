/**
 * Levels fill rule shared by the region fetch (scripts/data/fetch-osm.mjs writes `levelsFill` into the flight-scale
 * regions) and the street compiler (tools/world-compiler/src/cli.ts fills its own data the same way before it takes
 * the flight-scale layer's planned heights), so both see the same storeys for an untagged building.
 */

/** Kinds that are neither sampled nor filled by fillLevels (sheds, kiosks, worship, roofs...). */
const FILL_SKIP = new Set(['roof', 'garage', 'garages', 'shed', 'kiosk', 'hut', 'container', 'carport', 'service', 'toilets', 'cabin', 'mosque', 'church', 'chapel', 'synagogue', 'cathedral', 'temple', 'shrine', 'greenhouse', 'bridge', 'ruins', 'stadium', 'grandstand', 'hangar', 'transformer_tower', 'water_tower', 'tower']);
/** Radius (m), minimum and maximum sample count of the neighbour median. */
const FILL_RADIUS = 160;
const FILL_MIN = 4;
const FILL_MAX = 24;

/**
 * Levels fill rule for untagged buildings (regions only; the slice keeps its data as is): the median storey count of
 * the nearest tagged neighbours (building:levels, else height / 3.1 m) within FILL_RADIUS of similar kind, written as
 * `levelsFill` (the renderer still varies ±1 floor and applies its archetype rules; src/world/osm/buildings/plan.ts).
 * Buildings with too few tagged neighbours keep none: the district profile (buildings/districts.ts) decides there.
 */
export function fillLevels(buildings) {
  const levelsOf = (b) => b.levels ?? (b.height ? Math.max(1, Math.round((b.height - (b.roofHeight ?? 0)) / 3.1)) : 0);
  const centre = (b) => {
    let x = 0;
    let z = 0;
    const n = b.ring.length / 2;
    for (let k = 0; k < b.ring.length; k += 2) {
      x += b.ring[k];
      z += b.ring[k + 1];
    }
    return [x / n, z / n];
  };
  const cell = FILL_RADIUS;
  const grid = new Map();
  const samples = [];
  for (const b of buildings) {
    const lv = levelsOf(b);
    if (!lv || b.part || FILL_SKIP.has(b.kind) || Math.abs(ringArea(b.ring)) < 40) {
      continue;
    }
    const [x, z] = centre(b);
    const s = { x, z, lv, house: b.kind === 'house' || b.kind === 'detached' };
    samples.push(s);
    const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    grid.set(key, [...(grid.get(key) ?? []), s]);
  }
  const counts = { tagged: samples.length, filled: 0, unfilled: 0 };
  for (const b of buildings) {
    if (b.part || b.levels || b.height || FILL_SKIP.has(b.kind)) {
      continue;
    }
    const [x, z] = centre(b);
    const house = b.kind === 'house' || b.kind === 'detached';
    const near = [];
    const gx = Math.floor(x / cell);
    const gz = Math.floor(z / cell);
    for (let j = gz - 1; j <= gz + 1; j++) {
      for (let i = gx - 1; i <= gx + 1; i++) {
        for (const s of grid.get(`${i},${j}`) ?? []) {
          const d = Math.hypot(s.x - x, s.z - z);
          if (d < FILL_RADIUS && s.house === house) {
            near.push([d, s.lv]);
          }
        }
      }
    }
    if (near.length < FILL_MIN) {
      counts.unfilled++;
      continue;
    }
    const lv = near
      .sort((a, c) => a[0] - c[0])
      .slice(0, FILL_MAX)
      .map((e) => e[1])
      .sort((a, c) => a - c);
    b.levelsFill = lv[lv.length >> 1];
    counts.filled++;
  }
  return counts;
}

/** Signed area of a flat [x, z, ...] ring. */
function ringArea(r) {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
  }
  return a / 2;
}
