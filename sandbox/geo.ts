/**
 * Geo sandbox: top-down 2D map of the generated geography.
 *   /sandbox/geo.html?view=bosphorus            presets: world, bosphorus, horn, peninsula, kadikoy, islands, north, galata, uskudar
 *   /sandbox/geo.html?cx=0&cz=0&zoom=4          center in local meters, zoom 1 = whole 48 km world
 *   &lat=41.04&lon=29.0                         center by lat/lon instead of cx/cz
 *   &mode=map|height|density|district|coast     base layer (&hmax=500 height colour range, &contour=20 m)
 *   &labels=0 &roads=0 &mosques=0 &districts=0  hide overlays
 *   &spots=1                                    spot-height residuals (blue: terrain below the survey, red: above)
 *   &mode=3d&az=200&el=25&dist=6000&vx=1   3D relief preview of the region (orbit with the mouse)
 */
import * as THREE from 'three';
import { startSandbox } from '../src/core/sandbox';
import { LandUse, UpdateOrder } from '../src/core/contracts';
import type { GeoQuery } from '../src/core/contracts';
import { latLonToLocal, WORLD_HALF_SIZE } from '../src/core/geo-coords';
import { createGeoSystem } from '../src/world/geo';
import { SPOT_HEIGHTS } from '../src/world/geo/data/spot-heights';
import type { GeoQueryImpl } from '../src/world/geo';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);
const on = (k: string): boolean => params.get(k) !== '0';

const PRESETS: Record<string, { lat: number; lon: number; zoom: number }> = {
  world: { lat: 41.045, lon: 29.02, zoom: 1 },
  bosphorus: { lat: 41.1, lon: 29.05, zoom: 3.2 },
  south: { lat: 41.035, lon: 29.01, zoom: 6 },
  horn: { lat: 41.035, lon: 28.955, zoom: 7 },
  peninsula: { lat: 41.013, lon: 28.955, zoom: 7 },
  galata: { lat: 41.03, lon: 28.985, zoom: 14 },
  sultanahmet: { lat: 41.009, lon: 28.977, zoom: 16 },
  kadikoy: { lat: 40.985, lon: 29.035, zoom: 8 },
  uskudar: { lat: 41.03, lon: 29.03, zoom: 9 },
  islands: { lat: 40.875, lon: 29.08, zoom: 5 },
  north: { lat: 41.19, lon: 29.08, zoom: 4 },
  hisar: { lat: 41.085, lon: 29.06, zoom: 10 },
  levent: { lat: 41.085, lon: 29.01, zoom: 8 },
};

const USE_COLORS: Record<number, [number, number, number]> = {
  [LandUse.Water]: [120, 170, 210],
  [LandUse.Beach]: [238, 222, 176],
  [LandUse.Urban]: [214, 204, 190],
  [LandUse.HistoricUrban]: [222, 186, 150],
  [LandUse.Highrise]: [168, 156, 196],
  [LandUse.Industrial]: [190, 178, 160],
  [LandUse.Park]: [158, 206, 132],
  [LandUse.Forest]: [98, 150, 86],
  [LandUse.Farmland]: [226, 226, 160],
  [LandUse.Airport]: [205, 205, 214],
  [LandUse.Cemetery]: [140, 178, 128],
  [LandUse.Landmark]: [236, 150, 60],
  [LandUse.Road]: [250, 246, 238],
  [LandUse.Suburban]: [232, 224, 206],
};
const USE_NAMES: Record<number, string> = {
  [LandUse.Water]: 'Su',
  [LandUse.Beach]: 'Kumsal',
  [LandUse.Urban]: 'Kentsel',
  [LandUse.HistoricUrban]: 'Tarihi doku',
  [LandUse.Highrise]: 'Yüksek yapı',
  [LandUse.Industrial]: 'Sanayi/liman',
  [LandUse.Park]: 'Park/koru',
  [LandUse.Forest]: 'Orman',
  [LandUse.Farmland]: 'Tarla',
  [LandUse.Airport]: 'Havalimanı',
  [LandUse.Cemetery]: 'Mezarlık',
  [LandUse.Landmark]: 'Anıt alanı',
  [LandUse.Road]: 'Ana yol',
  [LandUse.Suburban]: 'Banliyö/köy',
};

function districtColor(i: number): [number, number, number] {
  const h = (i * 0.618034) % 1;
  const c = new THREE.Color().setHSL(h, 0.45, 0.62);
  return [c.r * 255, c.g * 255, c.b * 255];
}

interface View {
  cx: number;
  cz: number;
  mpp: number;
  w: number;
  h: number;
}

function drawMap(geo: GeoQuery, canvas: HTMLCanvasElement): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const preset = PRESETS[params.get('view') ?? 'world'] ?? PRESETS.world;
  let center = latLonToLocal(num('lat', preset.lat), num('lon', preset.lon));
  if (params.has('cx')) {
    center = { x: num('cx', 0), z: num('cz', 0) };
  }
  const zoom = num('zoom', preset.zoom);
  const view: View = { cx: center.x, cz: center.z, mpp: (WORLD_HALF_SIZE * 2) / (h * zoom), w, h };
  const toX = (x: number): number => (x - view.cx) / view.mpp + w / 2;
  const toY = (z: number): number => (z - view.cz) / view.mpp + h / 2;
  const mode = params.get('mode') ?? 'map';
  const hmax = num('hmax', 500);
  const contour = num('contour', 20);

  const img = ctx.createImageData(w, h);
  const px = img.data;
  const n = new THREE.Vector3();
  const lx = -0.5;
  const ly = 0.72;
  const lz = -0.48;
  const districtIndex = new Map(geo.districts.map((d, i) => [d.id, i]));
  for (let j = 0; j < h; j++) {
    const z = view.cz + (j - h / 2) * view.mpp;
    for (let i = 0; i < w; i++) {
      const x = view.cx + (i - w / 2) * view.mpp;
      const o = (j * w + i) * 4;
      if (Math.abs(x) > WORLD_HALF_SIZE || Math.abs(z) > WORLD_HALF_SIZE) {
        px[o] = 20;
        px[o + 1] = 22;
        px[o + 2] = 28;
        px[o + 3] = 255;
        continue;
      }
      const hgt = geo.heightAt(x, z);
      let r: number;
      let g: number;
      let b: number;
      if (mode === 'height') {
        if (hgt < 0) {
          const t = Math.min(1, -hgt / 120);
          r = 150 - 120 * t;
          g = 200 - 120 * t;
          b = 235 - 90 * t;
        } else {
          const t = Math.min(1, hgt / hmax);
          const c = new THREE.Color().setHSL(0.33 - 0.33 * t, 0.55, 0.35 + 0.35 * t);
          r = c.r * 255;
          g = c.g * 255;
          b = c.b * 255;
        }
      } else if (mode === 'coast') {
        const d = geo.coastDistance(x, z);
        const t = Math.min(1, Math.abs(d) / 2000);
        const band = Math.abs(((d % 100) + 100) % 100) < view.mpp * 1.2 ? 0.6 : 1;
        r = (d > 0 ? 230 - 120 * t : 60) * band;
        g = (d > 0 ? 200 - 80 * t : 110 + 60 * (1 - t)) * band;
        b = (d > 0 ? 150 : 200 + 50 * (1 - t)) * band;
      } else if (mode === 'density') {
        const d = geo.densityAt(x, z);
        const water = hgt < 0;
        r = water ? 90 : 245 - 200 * d;
        g = water ? 130 : 240 - 170 * d;
        b = water ? 170 : 230 - 60 * d;
      } else if (mode === 'district') {
        const d = geo.districtAt(x, z);
        [r, g, b] = d ? districtColor(districtIndex.get(d.id) ?? 0) : [110, 150, 190];
      } else {
        const use = geo.landUseAt(x, z);
        if (use === LandUse.Water) {
          const t = Math.min(1, -hgt / 90);
          r = 158 - 110 * t;
          g = 200 - 105 * t;
          b = 228 - 70 * t;
        } else {
          [r, g, b] = USE_COLORS[use] ?? [255, 0, 255];
        }
      }
      if (hgt >= 0 || mode === 'height') {
        geo.normalAt(x, z, n);
        const e = Math.max(view.mpp, 8);
        if (e > 12) {
          const hx = geo.heightAt(x + e, z) - geo.heightAt(x - e, z);
          const hz = geo.heightAt(x, z + e) - geo.heightAt(x, z - e);
          n.set(-hx, 2 * e, -hz).normalize();
        }
        const shade = Math.max(0, n.x * lx + n.y * ly + n.z * lz);
        const k = 0.5 + 0.62 * shade;
        r *= k;
        g *= k;
        b *= k;
        const c0 = Math.floor(hgt / contour);
        const c1 = Math.floor(geo.heightAt(x + view.mpp, z) / contour);
        const c2 = Math.floor(geo.heightAt(x, z + view.mpp) / contour);
        if (c0 !== c1 || c0 !== c2) {
          const kk = c0 % 5 === 4 || c1 % 5 === 4 ? 0.72 : 0.86;
          r *= kk;
          g *= kk;
          b *= kk;
        }
      }
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(30, 60, 90, 0.9)';
  ctx.lineWidth = 1;
  for (const ring of geo.coastlines) {
    ctx.beginPath();
    ring.forEach((p, i) => (i ? ctx.lineTo(toX(p.x), toY(p.z)) : ctx.moveTo(toX(p.x), toY(p.z))));
    ctx.closePath();
    ctx.stroke();
  }

  if (on('roads')) {
    for (const road of geo.roads) {
      ctx.beginPath();
      road.points.forEach((p, i) => (i ? ctx.lineTo(toX(p.x), toY(p.z)) : ctx.moveTo(toX(p.x), toY(p.z))));
      ctx.lineWidth = Math.max(1.2, road.width / view.mpp);
      ctx.strokeStyle = road.kind === 'highway' ? 'rgba(214, 96, 60, 0.95)' : road.kind === 'bridge' ? 'rgba(160, 40, 40, 0.95)' : road.kind === 'coastal' ? 'rgba(230, 170, 60, 0.95)' : 'rgba(240, 200, 90, 0.95)';
      ctx.stroke();
    }
  }

  if (on('mosques')) {
    ctx.fillStyle = 'rgba(20, 110, 90, 0.95)';
    for (const s of geo.smallMosqueSites) {
      const r = Math.max(1.5, s.radius / view.mpp);
      ctx.beginPath();
      ctx.arc(toX(s.x), toY(s.z), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (params.get('spots') === '1') {
    for (let i = 0; i < SPOT_HEIGHTS.length; i += 3) {
      const p = latLonToLocal(SPOT_HEIGHTS[i], SPOT_HEIGHTS[i + 1]);
      const err = geo.heightAt(p.x, p.z) - SPOT_HEIGHTS[i + 2];
      const t = Math.max(-1, Math.min(1, err / 30));
      ctx.fillStyle = t > 0 ? `rgba(220, 40, 30, ${0.25 + 0.75 * t})` : `rgba(30, 70, 220, ${0.25 - 0.75 * t})`;
      ctx.beginPath();
      ctx.arc(toX(p.x), toY(p.z), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const label = (text: string, x: number, y: number, font: string, fill: string): void => {
    ctx.font = font;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  };
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (on('districts')) {
    for (const d of geo.districts) {
      label(d.name.toLocaleUpperCase('tr'), toX(d.x), toY(d.z), '600 10px system-ui', 'rgba(70, 60, 80, 0.85)');
    }
  }
  for (const l of geo.landmarks) {
    const X = toX(l.x);
    const Y = toY(l.z);
    if (l.anchors && l.anchors.length > 1) {
      ctx.beginPath();
      l.anchors.forEach((p, i) => (i ? ctx.lineTo(toX(p.x), toY(p.z)) : ctx.moveTo(toX(p.x), toY(p.z))));
      ctx.strokeStyle = 'rgba(180, 40, 30, 0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
      for (const p of l.anchors) {
        ctx.fillStyle = 'rgba(180, 40, 30, 0.95)';
        ctx.fillRect(toX(p.x) - 2, toY(p.z) - 2, 4, 4);
      }
    }
    ctx.beginPath();
    ctx.arc(X, Y, Math.max(3, l.radius / view.mpp), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(200, 60, 20, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(200, 60, 20, 0.95)';
    ctx.fillRect(X - 1.5, Y - 1.5, 3, 3);
    if (on('labels')) {
      label(l.name, X, Y - 10, '600 11px system-ui', 'rgba(120, 30, 10, 1)');
    }
  }

  const barM = [100, 250, 500, 1000, 2000, 5000].find((m) => m / view.mpp > 80) ?? 10000;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(12, h - 44, barM / view.mpp + 16, 32);
  ctx.fillStyle = '#222';
  ctx.fillRect(20, h - 24, barM / view.mpp, 4);
  ctx.textAlign = 'left';
  ctx.font = '11px system-ui';
  ctx.fillText(barM >= 1000 ? `${barM / 1000} km` : `${barM} m`, 20, h - 34);

  const legendUses = Object.keys(USE_COLORS).map(Number);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(w - 150, 10, 140, legendUses.length * 16 + 12);
  legendUses.forEach((u, i) => {
    const [r, g, b] = USE_COLORS[u];
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(w - 142, 18 + i * 16, 12, 12);
    ctx.fillStyle = '#222';
    ctx.fillText(USE_NAMES[u], w - 124, 24 + i * 16);
  });

  const impl = geo as GeoQueryImpl;
  const info = [
    `geo build: ${JSON.stringify(impl.buildTimings)}`,
    `height ${geo.heightGrid.width}² @ ${geo.heightGrid.cellSize.toFixed(2)} m · landuse ${geo.landUseGrid.width}² @ ${geo.landUseGrid.cellSize.toFixed(2)} m`,
    `landmarks ${geo.landmarks.length} · roads ${geo.roads.length} · districts ${geo.districts.length} · mosque sites ${geo.smallMosqueSites.length} · coast rings ${geo.coastlines.length}`,
  ];
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(170, h - 52, Math.min(w - 180, 980), 46);
  ctx.fillStyle = '#111';
  info.forEach((t, i) => ctx.fillText(t, 176, h - 42 + i * 14));
}

const MUTED: Record<number, [number, number, number]> = {
  [LandUse.Water]: [60, 80, 90],
  [LandUse.Beach]: [196, 182, 150],
  [LandUse.Urban]: [150, 142, 132],
  [LandUse.HistoricUrban]: [160, 138, 118],
  [LandUse.Highrise]: [132, 132, 140],
  [LandUse.Industrial]: [138, 132, 124],
  [LandUse.Park]: [86, 110, 62],
  [LandUse.Forest]: [52, 72, 40],
  [LandUse.Farmland]: [150, 146, 96],
  [LandUse.Airport]: [140, 140, 136],
  [LandUse.Cemetery]: [74, 92, 60],
  [LandUse.Landmark]: [182, 150, 110],
  [LandUse.Road]: [110, 108, 106],
  [LandUse.Suburban]: [150, 146, 128],
};

function build3d(geo: GeoQuery, scene: THREE.Scene, camera: THREE.PerspectiveCamera): THREE.Vector3 {
  const preset = PRESETS[params.get('view') ?? 'bosphorus'] ?? PRESETS.bosphorus;
  let center = latLonToLocal(num('lat', preset.lat), num('lon', preset.lon));
  if (params.has('cx')) {
    center = { x: num('cx', 0), z: num('cz', 0) };
  }
  const size = (WORLD_HALF_SIZE * 2) / num('zoom', preset.zoom);
  const res = 511;
  const vx = num('vx', 1);
  const g = new THREE.PlaneGeometry(size, size, res, res).rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + center.x;
    const z = pos.getZ(i) + center.z;
    const h = geo.heightAt(x, z);
    pos.setXYZ(i, x, h * vx, z);
    const [r, gg, b] = MUTED[geo.landUseAt(x, z)] ?? [255, 0, 255];
    col[i * 3] = (r / 255) ** 2.2;
    col[i * 3 + 1] = (gg / 255) ** 2.2;
    col[i * 3 + 2] = (b / 255) ** 2.2;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })));
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1d3d52, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82 }),
  );
  water.position.set(center.x, 0, center.z);
  scene.add(water);
  const az = (num('az', 200) * Math.PI) / 180;
  const el = (num('el', 28) * Math.PI) / 180;
  const dist = num('dist', size * 0.75);
  const target = new THREE.Vector3(center.x, geo.heightAt(center.x, center.z) * vx, center.z);
  camera.position.set(target.x + Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z - Math.cos(az) * Math.cos(el) * dist);
  camera.lookAt(target);
  camera.far = 80000;
  camera.updateProjectionMatrix();
  return target;
}

let drawn = false;
const is3d = params.get('mode') === '3d';
void startSandbox({
  basicLighting: is3d,
  systems: [
    createGeoSystem(),
    {
      name: 'geo-map',
      order: UpdateOrder.UI,
      init(ctx) {
        const geo = ctx.services.get('geo');
        (window as unknown as { __geo: GeoQuery }).__geo = geo;
        if (is3d) {
          const target = build3d(geo, ctx.scene, ctx.camera);
          const sun = ctx.scene.children.find((o): o is THREE.DirectionalLight => o instanceof THREE.DirectionalLight);
          if (sun) {
            const sunAz = (num('sunaz', 250) * Math.PI) / 180;
            const sunEl = (num('sunel', 22) * Math.PI) / 180;
            sun.position.set(target.x + Math.sin(sunAz) * Math.cos(sunEl) * 5000, target.y + Math.sin(sunEl) * 5000, target.z - Math.cos(sunAz) * Math.cos(sunEl) * 5000);
            sun.intensity = 3.6;
            const hemi = ctx.scene.children.find((o): o is THREE.HemisphereLight => o instanceof THREE.HemisphereLight);
            if (hemi) {
              hemi.intensity = 0.35;
            }
            sun.target.position.copy(target);
            ctx.scene.add(sun.target);
            sun.castShadow = false;
          }
          drawn = true;
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:fixed;inset:0;z-index:5;';
        document.body.appendChild(canvas);
        requestAnimationFrame(() => {
          const t0 = performance.now();
          drawMap(geo, canvas);
          console.info(`[geo-sandbox] map drawn in ${Math.round(performance.now() - t0)} ms`);
          drawn = true;
        });
      },
      pending: () => (drawn ? 0 : 1),
    },
  ],
});
