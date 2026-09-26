/**
 * Unit check of the photo album's pure parts (src/ui/album): golden-hour detection from the sun elevation, the view
 * frustum and distance rules of the badges, place naming and the metadata builder (no NaNs), the caption, file name
 * sanitising (Turkish letters → ASCII), and the storage policy (pruning, confirmation, quota errors) against a fake
 * store. No browser, no IndexedDB, no network.
 *
 *   npx tsx tools/headless/album-check.ts
 *
 * Exits non-zero on any failure.
 */
import { LANDMARKS } from '../../src/world/geo/data/landmarks';
import {
  BADGE_MIN_DISTANCE,
  GOLDEN_HOUR_BAND,
  GOLDEN_HOUR_PLACES,
  goldenHourBadge,
  inFrustum,
  isGoldenHour,
  placeInView,
  sunElevationDeg,
  type BadgeLandmark,
  type CameraView,
  type Vec3,
} from '../../src/ui/album/badges';
import { isoDate, photoFileName, slugify } from '../../src/ui/album/filename';
import { buildPhotoMeta, formatClock, namePlace, newPhotoId, photoCaption, photoSubline, type MetaInput, type PlaceSources } from '../../src/ui/album/meta';
import { ALBUM_LIMITS, isQuotaError, planPrune, savePhoto, type StorageLimits } from '../../src/ui/album/policy';
import type { PhotoMeta, PhotoRecord, PhotoStore } from '../../src/ui/album/types';

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.log(`  FAIL ${msg}`);
  }
}

const DEG = Math.PI / 180;
const sinDeg = (d: number): number => Math.sin(d * DEG);

/** Camera at `pos` looking at `target` (up +Y), 60° vertical fov, 16:9. */
function lookAt(pos: Vec3, target: Vec3, fovDeg = 60, aspect = 16 / 9): CameraView {
  const d = { x: target.x - pos.x, y: target.y - pos.y, z: target.z - pos.z };
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  return { position: pos, forward: { x: d.x / l, y: d.y / l, z: d.z / l }, up: { x: 0, y: 1, z: 0 }, fovDeg, aspect };
}

/* ---------------- 1. sun and golden hour ---------------- */

console.log('1. golden hour');
check(Math.abs(sunElevationDeg(sinDeg(3)) - 3) < 1e-9, 'elevation from the sun direction');
check(isGoldenHour(sunElevationDeg(sinDeg(3))), '3° is golden hour');
check(isGoldenHour(GOLDEN_HOUR_BAND.min) && isGoldenHour(GOLDEN_HOUR_BAND.max), 'band edges are inclusive');
check(isGoldenHour(-3.9) && !isGoldenHour(-4.1), 'civil dusk just below the horizon counts, deeper does not');
check(!isGoldenHour(6.1) && !isGoldenHour(30) && !isGoldenHour(-30), 'high sun and night are not golden');
check(!isGoldenHour(Number.NaN), 'NaN is never golden');
check(Number.isFinite(sunElevationDeg(Number.NaN)) && !isGoldenHour(sunElevationDeg(Number.NaN)), 'unknown sun: finite and not golden');
check(sunElevationDeg(2) === 90 && sunElevationDeg(-2) === -90, 'out-of-range y is clamped');

/* ---------------- 2. view frustum ---------------- */

console.log('2. frustum');
const north: CameraView = { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 }, fovDeg: 60, aspect: 16 / 9 };
check(inFrustum(north, { x: 0, y: 0, z: -100 }), 'a point straight ahead is in frame');
check(!inFrustum(north, { x: 0, y: 0, z: 100 }), 'a point behind is out');
check(inFrustum(north, { x: 0, y: 50, z: -100 }) && !inFrustum(north, { x: 0, y: 60, z: -100 }), 'vertical edge at 30° (minus margin)');
check(inFrustum(north, { x: 90, y: 0, z: -100 }) && !inFrustum(north, { x: 100, y: 0, z: -100 }), 'horizontal edge from the aspect');
check(!inFrustum({ ...north, forward: { x: 0, y: 0, z: 0 } }, { x: 0, y: 0, z: -100 }), 'a zero forward sees nothing');
check(!inFrustum({ ...north, up: { x: 0, y: 0, z: -1 } }, { x: 0, y: 0, z: -100 }), 'up parallel to forward sees nothing');
check(inFrustum({ ...north, up: { x: 0, y: 1, z: -0.3 } }, { x: 0, y: 40, z: -100 }), 'a slightly tilted up is re-orthogonalised');
check(!inFrustum({ ...north, fovDeg: Number.NaN }, { x: 0, y: 70, z: -100 }), 'NaN fov falls back to 60°');
check(!inFrustum(north, { x: 0, y: 0, z: -0.01 }), 'a point at the lens is out');

/* ---------------- 3. badge rules ---------------- */

console.log('3. badges');
check(GOLDEN_HOUR_PLACES.length === 12, `12 badge places (${GOLDEN_HOUR_PLACES.length})`);
check(new Set(GOLDEN_HOUR_PLACES.map((p) => p.id)).size === GOLDEN_HOUR_PLACES.length, 'badge ids are unique');
for (const p of GOLDEN_HOUR_PLACES) {
  check(LANDMARKS.some((l) => l.id === p.landmarkId), `${p.id}: landmark ${p.landmarkId} exists`);
  check(p.radius > BADGE_MIN_DISTANCE * 10 && p.aim > 0 && p.aim <= 1, `${p.id}: radius and aim are sane`);
  check(!!p.name && p.name.trim() === p.name, `${p.id}: has a Turkish name`);
}

const galata: BadgeLandmark = { id: 'galata-kulesi', name: 'Galata Kulesi', x: 0, y: 30, z: -500, height: 67 };
const kiz: BadgeLandmark = { id: 'kiz-kulesi', name: 'Kız Kulesi', x: 3000, y: 0, z: 0, height: 23 };
const bridge: BadgeLandmark = {
  id: 'bogazici-koprusu',
  name: '15 Temmuz Şehitler Köprüsü',
  x: 0,
  y: 0,
  z: 5000,
  height: 165,
  anchors: [{ x: -540, z: 5000 }, { x: 540, z: 5000 }, { x: -900, z: 5000 }, { x: 900, z: 5000 }],
};
const fakeLandmarks = [galata, kiz, bridge];
const byId = (id: string): BadgeLandmark | undefined => fakeLandmarks.find((l) => l.id === id);
const galataTop = { x: 0, y: 30 + 67 * 0.7, z: -500 };
const cam = { x: 0, y: 60, z: 0 };
const golden = sunElevationDeg(sinDeg(2));
const noon = sunElevationDeg(sinDeg(40));

const hit = goldenHourBadge(golden, lookAt(cam, galataTop), byId);
check(hit?.place.id === 'galata-kulesi', `golden hour + Galata in frame earns its badge (${hit?.place.id})`);
check(goldenHourBadge(noon, lookAt(cam, galataTop), byId) === null, 'the same photo at noon earns nothing');
check(goldenHourBadge(golden, lookAt(cam, { x: 0, y: 60, z: 500 }), byId) === null, 'looking away earns nothing');
check(goldenHourBadge(golden, lookAt({ x: 0, y: 60, z: 900 }, galataTop), byId) === null, 'beyond the radius (1.4 km) earns nothing');
check(goldenHourBadge(golden, lookAt({ x: 0, y: galataTop.y, z: -497 }, galataTop), byId) === null, 'inside the tower earns nothing');
check(goldenHourBadge(golden, lookAt(cam, galataTop), () => undefined) === null, 'a missing landmark earns nothing');
// Bridge: the centre is off to the side, a tower (anchor) is in frame.
const bridgePlace = GOLDEN_HOUR_PLACES.find((p) => p.id === 'bogazici-koprusu')!;
const towerView = lookAt({ x: 540, y: 100, z: 3200 }, { x: 540, y: 99, z: 5000 }, 15);
check(!inFrustum(towerView, { x: 0, y: 99, z: 5000 }), 'setup: the bridge centre is out of the narrow frame');
check(placeInView(bridgePlace, bridge, towerView) !== null, 'a bridge tower (anchor) in frame counts');
check(placeInView({ ...bridgePlace, anchors: 0 }, bridge, towerView) === null, 'without anchors the same view does not count');
// Two places in frame: the one closer relative to its radius wins.
const both = goldenHourBadge(golden, lookAt({ x: 0, y: 60, z: 400 }, { x: 0, y: 60, z: -1000 }, 90), byId);
check(both?.place.id === 'galata-kulesi', `closest (relative) place wins (${both?.place.id})`);

/* ---------------- 4. place naming and metadata ---------------- */

console.log('4. metadata');
const sources: PlaceSources = {
  landmarks: fakeLandmarks,
  landmark: byId,
  districtAt: (x, z) => (x > -2000 && x < 2000 && z > -2000 && z < 2000 ? 'Beyoğlu' : null),
  waterAt: (x) => (x > 5000 ? 'İstanbul Boğazı' : null),
};
check(namePlace(lookAt(cam, galataTop), sources).place === 'Galata Kulesi', 'a landmark in frame names the photo');
check(namePlace(lookAt(cam, { x: 0, y: 60, z: 500 }), sources).place === 'Beyoğlu', 'looking away over the district: the district');
check(namePlace(lookAt(cam, { x: 0, y: 60, z: 500 }), { ...sources, perchName: 'Pierre Loti' }).place === 'Pierre Loti', 'perched: the perch name');
check(namePlace(lookAt({ x: 150, y: 60, z: -500 }, { x: 150, y: 60, z: 500 }), sources).place === 'Galata Kulesi', 'no landmark in frame: one within 250 m');
check(namePlace(lookAt({ x: 8000, y: 60, z: 0 }, { x: 9000, y: 60, z: 0 }), sources).place === 'İstanbul Boğazı', 'over water: the water body');
check(namePlace(lookAt({ x: -8000, y: 60, z: 0 }, { x: -9000, y: 60, z: 0 }), sources).place === 'İstanbul', 'nothing known: İstanbul');
check(namePlace(lookAt(cam, galataTop), sources, 'kiz-kulesi').place === 'Kız Kulesi', 'a badge place overrides the naming');

const base: MetaInput = {
  id: newPhotoId(Date.UTC(2026, 8, 26, 15, 42), 0.5),
  takenAt: new Date(2026, 8, 26, 18, 42).getTime(),
  timeOfDay: 18.7,
  dayOfYear: 269,
  weather: 'clear',
  view: lookAt(cam, galataTop),
  cameraMode: 'third',
  dragon: 'flying',
  sunDirY: sinDeg(2),
  sources,
};
const meta = buildPhotoMeta(base);
check(meta.place === 'Galata Kulesi' && meta.landmarkId === 'galata-kulesi', 'meta names the place');
check(meta.golden && meta.badgeId === 'galata-kulesi', 'meta carries the golden-hour badge');
check(Math.abs(meta.sunElevationDeg - 2) < 1e-6, 'meta sun elevation');
check(photoCaption(meta) === 'Galata Kulesi · 18:42 · açık hava', `caption (${photoCaption(meta)})`);
check(photoSubline(meta).startsWith('26 Eylül 2026 · uçarken · güneş 2°'), `subline (${photoSubline(meta)})`);
check(Math.abs(meta.headingDeg) < 1e-6 || Math.abs(meta.headingDeg - 360) < 1e-6, `looking north: heading 0 (${meta.headingDeg})`);
const east = buildPhotoMeta({ ...base, view: lookAt(cam, { x: 100, y: 60, z: 0 }) });
check(Math.abs(east.headingDeg - 90) < 1e-6 && Math.abs(east.pitchDeg) < 1e-6, `looking east: heading 90, pitch 0 (${east.headingDeg})`);
check(!buildPhotoMeta({ ...base, sunDirY: sinDeg(35) }).badgeId, 'no badge in daylight');
check(/^p-[0-9a-z]+-[0-9a-z]{4}$/.test(meta.id), `photo id format (${meta.id})`);

function noNaN(m: PhotoMeta, label: string): void {
  for (const [k, v] of Object.entries(m)) {
    if (typeof v === 'number') {
      check(Number.isFinite(v), `${label}: ${k} is finite (${v})`);
    }
  }
}
noNaN(meta, 'normal');
noNaN(
  buildPhotoMeta({
    ...base,
    timeOfDay: Number.NaN,
    dayOfYear: Number.NaN,
    takenAt: Number.NaN,
    sunDirY: Number.NaN,
    view: { position: { x: Number.NaN, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 0 }, fovDeg: Number.NaN, aspect: Number.NaN },
  }),
  'NaN inputs',
);
noNaN(buildPhotoMeta({ ...base, view: lookAt(cam, { x: 0, y: 1000, z: 0 }) }), 'straight up');
check(formatClock(18.7) === '18:42' && formatClock(23.999) === '00:00' && formatClock(-1) === '23:00' && formatClock(Number.NaN) === '00:00', 'clock formatting');

/* ---------------- 5. file names ---------------- */

console.log('5. file names');
const at = new Date(2026, 8, 26, 18, 42).getTime();
check(photoFileName('Kız Kulesi', at, 'image/webp') === 'seventeen-skies-kiz-kulesi-2026-09-26.webp', photoFileName('Kız Kulesi', at, 'image/webp'));
check(slugify('Üsküdar') === 'uskudar', 'Ü, ü, ş');
check(slugify('İstanbul Boğazı') === 'istanbul-bogazi', 'İ, ğ, ı');
check(slugify('Çamlıca') === 'camlica', 'Ç');
check(slugify('ŞİŞLİ / Ğ Ö') === 'sisli-g-o', 'upper-case Turkish letters');
check(slugify('15 Temmuz Şehitler Köprüsü') === '15-temmuz-sehitler-koprusu', 'bridge name');
check(slugify('Mihrimah Sultan Camii (Edirnekapı)') === 'mihrimah-sultan-camii-edirnekapi', 'brackets dropped');
check(slugify('Zincirlikuyu–Mecidiyeköy Gökdelenleri').length <= 40, 'long names are cut to 40');
check(!slugify('Zincirlikuyu–Mecidiyeköy Gökdelenleri').endsWith('-'), 'no trailing dash after the cut');
check(slugify('Kâğıthane Şarkı') === 'kagithane-sarki', 'circumflex');
check(photoFileName('', at, 'image/jpeg') === 'seventeen-skies-istanbul-2026-09-26.jpg', 'empty place, JPEG');
check(photoFileName('../../etc/passwd', at, 'text/html') === 'seventeen-skies-etc-passwd-2026-09-26.webp', 'no path tricks, unknown type → webp');
for (const name of ['Kız Kulesi', 'Üsküdar', 'İstanbul Boğazı', 'Beyoğlu', '<script>', 'a\u0000b', '日本']) {
  check(/^seventeen-skies-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.(webp|jpg|png)$/.test(photoFileName(name, at, 'image/webp')), `safe ASCII file name for ${JSON.stringify(name)}`);
}
check(isoDate(Number.NaN) === isoDate(0), 'NaN date falls back');

/* ---------------- 6. storage policy ---------------- */

console.log('6. storage policy');
const MB = 1024 * 1024;
const limits: StorageLimits = { maxPhotos: 5, maxBytes: 10 * MB, quotaShare: 0.8 };
const photo = (i: number, bytes = MB, badgeId?: string): Pick<PhotoMeta, 'id' | 'takenAt' | 'bytes' | 'badgeId'> => ({ id: `p${i}`, takenAt: 1000 + i, bytes, badgeId });
check(ALBUM_LIMITS.maxPhotos > 0 && ALBUM_LIMITS.maxBytes > 0 && ALBUM_LIMITS.quotaShare < 1, 'default limits are sane');
let plan = planPrune([photo(1), photo(2)], MB, limits);
check(plan.fits && plan.prune.length === 0, 'room left: nothing pruned');
plan = planPrune([photo(3), photo(1), photo(2), photo(4), photo(5)], MB, limits);
check(plan.fits && plan.prune.join() === 'p1', `count limit: the oldest goes (${plan.prune.join()})`);
plan = planPrune([photo(1, MB, 'galata-kulesi'), photo(2), photo(3), photo(4), photo(5)], MB, limits);
check(plan.prune.join() === 'p2', `badge photos are pruned last (${plan.prune.join()})`);
plan = planPrune([photo(1, 4 * MB), photo(2, 4 * MB)], 3 * MB, limits);
check(plan.fits && plan.prune.join() === 'p1', `byte limit: oldest pruned until it fits (${plan.prune.join()})`);
plan = planPrune([photo(1)], 11 * MB, limits);
check(!plan.fits && plan.prune.length === 0, 'a photo larger than the budget never prunes');
plan = planPrune([photo(1, 2 * MB), photo(2, 2 * MB)], 2 * MB, limits, { usage: 20 * MB, quota: 25 * MB });
// budget = 25 × 0.8 − (20 − 4) = 4 MB: album 4 + 2 > 4 → prune p1 → 2 + 2 ≤ 4
check(plan.fits && plan.prune.join() === 'p1', `quota estimate tightens the budget (${plan.prune.join()})`);
plan = planPrune([photo(1, Number.NaN), photo(2, -5)], Number.NaN, limits, { usage: Number.NaN, quota: Number.NaN });
check(plan.fits && plan.prune.length === 0, 'NaN sizes and estimates are ignored');
check(planPrune([], MB, { ...limits, maxPhotos: 0 }).fits, 'maxPhotos below 1 still keeps the new photo');

class FakeStore implements PhotoStore {
  readonly rows = new Map<string, PhotoRecord>();
  readonly log: string[] = [];
  failPut: 'none' | 'quota-once' | 'quota-always' | 'error' = 'none';
  failList = false;
  /** Origin quota and the bytes the rest of the site uses; usage adds the album's rows. */
  quotaEstimate: { others: number; quota: number } | null = null;
  async listMeta(): Promise<PhotoMeta[]> {
    if (this.failList) {
      throw new Error('list failed');
    }
    return [...this.rows.values()].map((r) => r.meta);
  }
  async put(record: PhotoRecord): Promise<void> {
    if (this.failPut === 'error') {
      throw new Error('disk on fire');
    }
    if (this.failPut === 'quota-always' || this.failPut === 'quota-once') {
      if (this.failPut === 'quota-once') {
        this.failPut = 'none';
      }
      this.log.push(`put-fail:${record.meta.id}`);
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    }
    this.rows.set(record.meta.id, record);
    this.log.push(`put:${record.meta.id}`);
  }
  async remove(id: string): Promise<void> {
    this.rows.delete(id);
    this.log.push(`remove:${id}`);
  }
  async estimate(): Promise<{ usage: number; quota: number } | null> {
    if (!this.quotaEstimate) {
      return null;
    }
    const album = [...this.rows.values()].reduce((sum, r) => sum + r.meta.bytes, 0);
    return { usage: this.quotaEstimate.others + album, quota: this.quotaEstimate.quota };
  }
}

function record(i: number, bytes = MB): PhotoRecord {
  const m = { ...meta, id: `p${i}`, takenAt: 1000 + i, bytes };
  delete m.badgeId;
  return { meta: m, image: new Blob([new Uint8Array(8)]), thumb: new Blob([new Uint8Array(2)]) };
}

async function storageChecks(): Promise<void> {
  const s = new FakeStore();
  for (let i = 1; i <= 5; i++) {
    const r = await savePhoto(s, record(i), { limits });
    check(r.status === 'saved', `save ${i} under the limit`);
  }
  let r = await savePhoto(s, record(6), { limits });
  check(r.status === 'needs-confirm' && r.prune.join() === 'p1', 'a full album asks before pruning');
  check(s.rows.size === 5 && !s.rows.has('p6'), 'nothing written without confirmation');
  r = await savePhoto(s, record(6), { limits, confirmPrune: true });
  check(r.status === 'saved' && r.pruned.join() === 'p1', 'confirmed: saved and the oldest pruned');
  check(s.rows.has('p6') && !s.rows.has('p1') && s.rows.size === 5, 'album holds the newest five');
  const iPut = s.log.indexOf('put:p6');
  const iRemove = s.log.indexOf('remove:p1');
  check(iPut >= 0 && iRemove > iPut, `the new photo is written before the old one is deleted (${s.log.slice(-2).join(', ')})`);

  s.failPut = 'error';
  r = await savePhoto(s, record(7), { limits, confirmPrune: true });
  check(r.status === 'error' && s.rows.size === 5 && s.rows.has('p2'), 'a failed write deletes nothing');
  s.failPut = 'none';

  r = await savePhoto(s, record(8, 11 * MB), { limits, confirmPrune: true });
  check(r.status === 'no-space' && s.rows.size === 5, 'a photo larger than the budget: no space, nothing deleted');

  const q = new FakeStore();
  await savePhoto(q, record(1), { limits });
  await savePhoto(q, record(2), { limits });
  q.failPut = 'quota-once';
  r = await savePhoto(q, record(3), { limits });
  check(r.status === 'needs-confirm' && r.prune.join() === 'p1', `browser quota full: asks to prune one (${JSON.stringify(r)})`);
  check(q.rows.size === 2, 'quota error without confirmation deletes nothing');
  q.failPut = 'quota-once';
  r = await savePhoto(q, record(3), { limits, confirmPrune: true });
  check(r.status === 'saved' && r.pruned.join() === 'p1' && q.rows.has('p3'), `confirmed after a quota error: prune one and retry (${JSON.stringify(r)})`);
  q.failPut = 'quota-always';
  r = await savePhoto(q, record(4), { limits, confirmPrune: true });
  check(r.status === 'no-space', 'quota still full after pruning: no space');

  const e = new FakeStore();
  e.failPut = 'quota-always';
  r = await savePhoto(e, record(1), { limits });
  check(r.status === 'no-space', 'empty album and no quota: no space');
  e.failList = true;
  r = await savePhoto(e, record(1), { limits });
  check(r.status === 'error', 'an unreadable store reports an error');

  const est = new FakeStore();
  est.quotaEstimate = { others: MB, quota: 3 * MB };
  r = await savePhoto(est, record(1), { limits });
  check(r.status === 'saved', 'first photo fits the origin quota');
  r = await savePhoto(est, record(2), { limits });
  check(r.status === 'needs-confirm', `the origin quota estimate triggers pruning early (${r.status})`);

  check(isQuotaError({ name: 'QuotaExceededError' }) && isQuotaError({ code: 22 }) && !isQuotaError(new Error('x')) && !isQuotaError(null), 'quota error detection');
}

storageChecks()
  .then(() => {
    console.log(`\n${checks - failures}/${checks} checks passed`);
    if (failures > 0) {
      process.exit(1);
    }
  })
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
