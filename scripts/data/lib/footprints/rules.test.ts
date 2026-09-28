// Building merge rules (rules.ts, geometry.ts): npm run test:footprints
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atSea, cutRing, intersectionArea, Polygons, type Ring, ringArea, samplePoints, Segments } from './geometry';
import {
  assignClasses,
  assignIds,
  capLevels,
  classifyMl,
  classQuotas,
  Drop,
  duplicates,
  ghsFactor,
  joinMahalle,
  LOT_FRONTAGE,
  LOT_MIN_AREA,
  type MlContext,
  mlKey,
  mlKind,
  normName,
  splitBlock,
  splitLots,
  storeysInClass,
  SYNTHETIC_ID_BASE,
  SYNTHETIC_ID_RANGE,
} from './rules';

const rect = (x0: number, z0: number, x1: number, z1: number): Ring => [x0, z0, x1, z0, x1, z1, x0, z1];
const area = (r: Ring): number => Math.abs(ringArea(r));

/** A context with nothing in it; tests add what they need. */
function context(osm: Ring[] = []): MlContext & { streets: Segments; rails: Segments; walls: Segments; coast: Segments; water: Polygons<string>; open: Polygons<string> } {
  return {
    osmNear: (_box, fn) => {
      for (const r of osm) {
        if (fn(r, [])) {
          return;
        }
      }
    },
    streets: new Segments(),
    rails: new Segments(),
    walls: new Segments(),
    coast: new Segments(),
    water: new Polygons<string>(),
    open: new Polygons<string>(),
  };
}

test('geometry: exact intersection areas, also for concave rings', () => {
  assert.equal(intersectionArea(rect(0, 0, 10, 10), rect(5, 5, 15, 15)), 25);
  assert.equal(intersectionArea(rect(0, 0, 10, 10), rect(10, 0, 20, 10)), 0);
  const L: Ring = [0, 0, 10, 0, 10, 2, 2, 2, 2, 10, 0, 10];
  assert.ok(Math.abs(intersectionArea(L, rect(0, 0, 10, 10)) - 36) < 1e-9);
  assert.ok(Math.abs(intersectionArea(rect(0, 0, 10, 10), L) - 36) < 1e-9);
  assert.ok(Math.abs(intersectionArea(rect(4, 4, 8, 8), L)) < 1e-9, 'the L notch is empty');
  // Holes of the second ring are subtracted.
  assert.ok(Math.abs(intersectionArea(rect(0, 0, 10, 10), rect(-5, -5, 15, 15), [rect(2, 2, 4, 4)]) - 96) < 1e-9);
});

test('geometry: a cut keeps every piece on its side, pieces tile the ring', () => {
  const U: Ring = [0, 0, 10, 0, 10, 10, 7, 10, 7, 3, 3, 3, 3, 10, 0, 10];
  const top = cutRing(U, 0, 1, 5);
  const bottom = cutRing(U, 0, -1, -5);
  assert.equal(top.length, 2, 'both arms of the U');
  assert.equal(bottom.length, 1);
  assert.ok(Math.abs(top.reduce((s, r) => s + area(r), 0) + bottom.reduce((s, r) => s + area(r), 0) - area(U)) < 1e-9);
  assert.deepEqual(cutRing(U, 0, 1, -1).length, 1, 'all kept');
  assert.deepEqual(cutRing(U, 0, 1, 11), [], 'all dropped');
  // Samples lie inside the ring, centroid first.
  const pts = samplePoints(rect(0, 0, 8, 4));
  assert.deepEqual(pts.slice(0, 2), [4, 2]);
  assert.ok(pts.length / 2 > 20);
});

test('geometry: the sea lies right of the coastline (land on its left, OSM convention)', () => {
  const coast = new Segments(64);
  // Heading east (+x): the left is north, i.e. -z in the local frame (+Z south).
  coast.addLine([0, 0, 100, 0, 200, 0], 0);
  assert.equal(atSea(coast, 50, 20), true, 'south of an eastbound coastline is sea');
  assert.equal(atSea(coast, 50, -20), false);
  assert.equal(atSea(coast, 100, 5), true, 'at a vertex the neighbouring segments agree');
  assert.equal(atSea(coast, 50, 2000), false, 'far from every coastline is land');
});

test('ML rules: size, OSM overlap, street, rail, water, sea, wall, open ground', () => {
  const house = rect(0, 0, 10, 10);
  assert.equal(classifyMl(rect(0, 0, 3, 3), context()).drop, Drop.Small);
  assert.equal(classifyMl(house, context()).drop, Drop.Kept);
  // OSM wins an overlap of more than 1 m² (10 % of the footprint when that is smaller).
  assert.equal(classifyMl(house, context([rect(9, 0, 20, 10)])).drop, Drop.Osm, '10 m² overlap');
  assert.equal(classifyMl(house, context([rect(9.95, 0, 20, 10)])).drop, Drop.Kept, '0.5 m² overlap');
  // A footprint on a street, or half of it; touching the street's edge stays.
  const onStreet = context();
  onStreet.streets.addLine([-50, 5, 50, 5], 3);
  assert.equal(classifyMl(house, onStreet).drop, Drop.Street);
  const edge = context();
  edge.streets.addLine([-50, -2, 50, -2], 3);
  assert.equal(classifyMl(house, edge).drop, Drop.Kept, 'a metre into the carriageway');
  const rail = context();
  rail.rails.addLine([5, -50, 5, 50], 2.5);
  assert.equal(classifyMl(house, rail).drop, Drop.Rail);
  const water = context();
  water.water.add(rect(-20, -20, 30, 30), [], 'water');
  assert.equal(classifyMl(house, water).drop, Drop.Water);
  const sea = context();
  sea.coast.addLine([-100, -10, 100, -10], 0);
  assert.equal(classifyMl(house, sea).drop, Drop.Sea);
  const wall = context();
  wall.walls.addLine([-50, 12, 50, 12], 8);
  assert.equal(classifyMl(house, wall).drop, Drop.Wall);
  const parking = context();
  parking.open.add(rect(-20, -20, 30, 30), [], 'parking');
  assert.deepEqual(classifyMl(house, parking), { drop: Drop.Open, what: 'parking' });
  assert.equal(mlKind(25), 'shed');
  assert.equal(mlKind(45), 'yes');
});

test('ML rules: of two footprints overlapping by more than half of the smaller, the larger stays', () => {
  const big = rect(0, 0, 10, 10);
  const dup = rect(1, 1, 9, 8);
  const neighbour = rect(8, 0, 18, 10);
  assert.deepEqual([...duplicates([dup, big, neighbour], ['a', 'b', 'c'])], [1, 0, 0]);
});

test('ids: stable, negative, below the infill range, the same in any input order', () => {
  const keys = ['ml:120323223:1:2', 'ml:120323223:1:3', 'lot:5:0:0', 'ml:122101001:9:9'];
  const a = assignIds(keys).ids;
  const b = assignIds([...keys].reverse()).ids;
  for (const k of keys) {
    assert.equal(a.get(k), b.get(k));
    assert.ok(a.get(k)! <= -SYNTHETIC_ID_BASE && a.get(k)! > -(SYNTHETIC_ID_BASE + SYNTHETIC_ID_RANGE));
  }
  assert.equal(new Set(a.values()).size, keys.length);
  // A taken value moves on to the next free one, deterministically.
  const used = new Set<number>();
  const first = assignIds(['x'], used).ids.get('x')!;
  const again = assignIds(['x'], used);
  assert.equal(again.collisions, 1);
  assert.equal(again.ids.get('x'), first - 1);
  // The key lattice is ~0.5 m: a centimetre does not change it.
  assert.equal(mlKey('q', 41.0, 29.0), mlKey('q', 41.0000001, 29.0000001));
});

test('İBB join: names, spellings, village prefixes and aliases', () => {
  const ibb = [
    { ilce: 'KADIKÖY', mahalle: 'CAFERAĞA' },
    { ilce: 'ATAŞEHİR', mahalle: 'FETIH' },
    { ilce: 'SİLİVRİ', mahalle: 'BALABAN' },
    { ilce: 'SİLİVRİ', mahalle: 'HÜRRİYET' },
    { ilce: 'SİLİVRİ', mahalle: 'KAVAKLI' },
    { ilce: 'EYÜP', mahalle: 'NİŞANCA' },
    { ilce: 'BAŞAKŞEHİR', mahalle: 'ŞAMLAR' },
    { ilce: 'SARIYER', mahalle: 'RUMELİ HİSARI' },
  ];
  const osm = [
    { key: 1, ilce: 'Kadıköy', name: 'Caferağa Mahallesi' },
    { key: 2, ilce: 'Ataşehir', name: 'Fetih Mahallesi' },
    { key: 3, ilce: 'Silivri', name: 'Çanta Balaban Mahallesi' },
    { key: 4, ilce: 'Silivri', name: 'Kavaklı Hürriyet Mahallesi' },
    { key: 5, ilce: 'Silivri', name: 'Kavaklı İstiklal Mahallesi' },
    { key: 6, ilce: 'Eyüpsultan', name: 'Nişanca Mahallesi' },
    { key: 7, ilce: 'Arnavutköy', name: 'Şamlar Mahallesi' },
    { key: 8, ilce: 'Sarıyer', name: 'Rumelihisarı Mahallesi' },
  ];
  const j = joinMahalle(ibb, osm, { EYÜP: 'Eyüpsultan', 'BAŞAKŞEHİR/ŞAMLAR': 'Arnavutköy/Şamlar' });
  assert.deepEqual(
    [...j.match].sort((a, b) => a[0] - b[0]).map(([i, k]) => [ibb[i].mahalle, k]),
    [
      ['CAFERAĞA', [1]],
      ['FETIH', [2]],
      ['BALABAN', [3]],
      ['HÜRRİYET', [4]],
      ['KAVAKLI', [5]],
      ['NİŞANCA', [6]],
      ['ŞAMLAR', [7]],
      ['RUMELİ HİSARI', [8]],
    ],
  );
  assert.equal(j.ibbUnmatched.length, 0);
  assert.equal(normName('Topselvi Mahalesi'), 'TOPSELVİ');
});

test('row splits: which outlines qualify', () => {
  const bar = rect(0, 0, 60, 12);
  assert.equal(splitBlock({ kind: 'yes' }, bar), null);
  assert.equal(splitBlock({ kind: 'house' }, bar), 'kind');
  assert.equal(splitBlock({ kind: 'yes', levels: 5 }, bar), 'heightTagged');
  assert.equal(splitBlock({ kind: 'yes', name: 'Hanı' }, bar), 'namedOrUse');
  assert.equal(splitBlock({ kind: 'yes', holes: [[1]] }, bar), 'courtyard');
  assert.equal(splitBlock({ kind: 'yes' }, rect(0, 0, 24.5, 24.8)), 'short', '607 m² but under 25 m long');
  assert.equal(splitBlock({ kind: 'yes' }, rect(0, 0, 20, 20)), 'small');
  assert.equal(splitBlock({ kind: 'yes' }, rect(0, 0, 20, 20), 1), null, 'the second tier takes 20 x 20 m');
  assert.equal(splitBlock({ kind: 'yes' }, rect(0, 0, 100, 60)), 'huge');
  // Y-shaped block: three arms of 30 x 8 m around a core.
  const Y: Ring = [0, 0, 8, 0, 8, 30, 38, 30, 38, 38, 8, 38, 8, 68, 0, 68, 0, 38, -30, 38, -30, 30, 0, 30];
  assert.equal(splitBlock({ kind: 'yes' }, Y), 'concave');
});

test('row splits: lots tile the outline, frontages in range, two rows when deep, concave arms apart', () => {
  for (const r of [rect(0, 0, 60, 14), rect(0, 0, 14, 60), rect(10, 20, 47, 33)]) {
    const lots = splitLots(r, 'k');
    assert.ok(lots.length >= 3);
    assert.ok(Math.abs(lots.reduce((s, l) => s + area(l), 0) - area(r)) < 1e-6, 'no gap, no overlap');
    for (const l of lots) {
      assert.ok(ringArea(l) > 0, 'counter-clockwise');
      assert.ok(area(l) >= LOT_MIN_AREA);
      const long = Math.max(...[0, 1].map((a) => Math.max(...l.filter((_, i) => i % 2 === a)) - Math.min(...l.filter((_, i) => i % 2 === a))));
      const short = area(l) / long;
      assert.ok(short >= LOT_FRONTAGE[0] - 1e-6 && short <= LOT_FRONTAGE[1] * 1.5 + 1e-6, `frontage ${short}`);
    }
  }
  assert.deepEqual(splitLots(rect(0, 0, 60, 14), 'k'), splitLots(rect(0, 0, 60, 14), 'k'), 'deterministic');
  const deep = splitLots(rect(0, 0, 40, 40), 'd');
  assert.ok(deep.every((l) => Math.max(...l.filter((_, i) => i % 2 === 1)) <= 20 + 1e-6 || Math.min(...l.filter((_, i) => i % 2 === 1)) >= 20 - 1e-6), 'back to back rows');
  const L: Ring = [0, 0, 40, 0, 40, 12, 12, 12, 12, 40, 0, 40];
  const lots = splitLots(L, 'L');
  assert.ok(Math.abs(lots.reduce((s, l) => s + area(l), 0) - area(L)) < 1e-6);
  assert.deepEqual(splitLots(rect(0, 0, 10, 6), 'x'), [], 'too small to split');
});

test('storeys: İBB class quotas, largest first, draws inside the class', () => {
  // İBB: 60 % 1-4, 30 % 5-8, 10 % 9-19 over 100 buildings; 20 already decided in class 1 (1-4 floors).
  const q = classQuotas([60, 30, 10], 100, [20, 0, 0], 80);
  assert.deepEqual(q, [40, 30, 10]);
  assert.equal(q.reduce((a, b) => a + b, 0), 80);
  // Largest units take the highest classes; a split outline uses one place of the quota per lot.
  assert.deepEqual([...assignClasses([1, 3, 1, 1, 1], [3, 2, 2])], [2, 2, 1, 1, 0]);
  for (let h = 0; h < 1; h += 0.05) {
    const [a, b, c] = [storeysInClass(0, h), storeysInClass(1, h), storeysInClass(2, h)];
    assert.ok(a >= 1 && a <= 4 && b >= 5 && b <= 8 && c >= 9 && c <= 19);
  }
});

test('storeys: GHS-BUILT-H band and sanity limits', () => {
  // 1000 m² of estimated buildings at 30 m against a 10 m cell: back to 13 m.
  assert.ok(Math.abs(ghsFactor(10, 0, 30 * 1000, 1000) - 13 / 30) < 1e-9);
  assert.equal(ghsFactor(10, 0, 11 * 1000, 1000), 1, 'inside the band');
  assert.ok(ghsFactor(20, 0, 6 * 1000, 1000) > 2, 'too low: raised');
  assert.equal(ghsFactor(10, 0, 30 * 100, 100), 1, 'too little footprint to judge');
  assert.equal(ghsFactor(0, 0, 3000, 1000), 1, 'no GHS value');
  assert.equal(capLevels(6, 25, 'shed', 19), 1);
  assert.equal(capLevels(6, 30, 'yes', 19), 2);
  assert.equal(capLevels(12, 200, 'yes', 8), 8);
  assert.equal(capLevels(0.2, 200, 'yes', 8), 1);
});
