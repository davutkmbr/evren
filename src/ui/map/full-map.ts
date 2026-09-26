import { COURSES } from '../../activities/courses';
import type { GeoQuery, LandmarkDef, PerchPoint } from '../../core/contracts';
import type { ViewPreset } from '../../core/debug';
import { latLonToLocal, WORLD_HALF_SIZE } from '../../core/geo-coords';
import { hintLine, hoverCard, layerGroup, layerToggle, prompt, scaleBar, zoomCluster, type LayerToggle } from '../components';
import { el } from '../dom';
import { formatDecimal, formatInt, formatYear } from '../format';
import { LANDMARK_KIND_LABELS } from '../labels';
import { perchTeleportView } from '../perch-teleport';
import { loadMapLayers, saveMapLayers, type MapLayers } from '../prefs';
import { bearingTo, type FlightSnapshot } from '../types';
import type { MapRaster } from './map-raster';

export interface TeleportTarget {
  x: number;
  y: number;
  z: number;
  headingDeg: number;
  pitchDeg: number;
  /** Turkish place label for the confirmation toast. */
  label: string;
}

export interface FullMapOptions {
  onTeleport(target: TeleportTarget): void;
  /** Sit on a perch in the viewing mode (the same flow as the pause menu's "Oraya kon ve izle"). */
  onPerch(perch: PerchPoint): void;
  /** Current perch points (the 'perches' service), read when the map opens. */
  perches(): readonly PerchPoint[] | undefined;
  onClose(): void;
}

interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One map pin: a landmark (with its perch, if the perch sits on it) or a perch without a landmark. */
interface MapPin {
  id: string;
  x: number;
  z: number;
  name: string;
  landmark?: LandmarkDef;
  perch?: PerchPoint;
}

const MAX_SCALE = 0.34;
const DRAG_THRESHOLD_PX = 5;
const HIT_RADIUS_PX = 14;
const GOLD = '#e8b872';
const PIN_RING = '#111318';
const RACE_COLOR = '#7fd1c0';
const ATTRIBUTION = '© OpenStreetMap katkıcıları (ODbL) · NASA SRTM';

/** Water body names and where they are written (drawn only where the point really is water). */
const WATER_LABELS: ReadonlyArray<{ name: string; lat: number; lon: number }> = [
  { name: 'İstanbul Boğazı', lat: 41.083, lon: 29.07 },
  { name: 'Haliç', lat: 41.038, lon: 28.943 },
  { name: 'Marmara Denizi', lat: 40.955, lon: 28.955 },
  { name: 'Karadeniz', lat: 41.245, lon: 29.14 },
];

const BUILT_IN_COURSES = COURSES.filter((c) => !c.custom);
let raceLines: Array<Array<{ x: number; z: number }>> | null = null;

/** Built-in race courses as local-space polylines through their gates (computed once). */
function racePolylines(): Array<Array<{ x: number; z: number }>> {
  raceLines ??= BUILT_IN_COURSES.map((c) => c.gates.map((g) => latLonToLocal(g.lat, g.lon)));
  return raceLines;
}

function overlaps(boxes: LabelBox[], b: LabelBox): boolean {
  for (const o of boxes) {
    if (b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) {
      return true;
    }
  }
  return false;
}

/**
 * Full-screen map (M): the shared raster with pan/zoom, water and district names, landmark and perch pins, race
 * courses and the player's arrow; a layers panel toggles the marker groups; click a pin (or anywhere) to teleport.
 */
export class FullMap {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly where: HTMLElement;
  private readonly card = hoverCard();
  private readonly scaleIndicator = scaleBar(ATTRIBUTION);
  private readonly layers: MapLayers = loadMapLayers();
  private readonly toggles: Record<keyof MapLayers, LayerToggle>;
  private geo: GeoQuery | null = null;
  private discovered: ReadonlySet<string> = new Set();
  private pins: MapPin[] = [];
  private perchCount = -1;
  private centerX = 0;
  private centerZ = 0;
  private scale = 0.08;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private dirty = false;
  private raf = 0;
  private isOpen = false;
  private player: FlightSnapshot | null = null;
  private hovered: MapPin | null = null;
  private pointer = { id: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, dragging: false };
  private hoverX = -1;
  private hoverY = -1;
  private readonly screenPos = new Map<string, { x: number; y: number }>();

  constructor(
    private readonly raster: MapRaster,
    private readonly options: FullMapOptions,
  ) {
    this.canvas = el('canvas', 'map-canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;

    this.where = el('span', 'map-where');
    const close = prompt('Kapat', 'M', 'secondary', () => this.options.onClose());
    close.root.setAttribute('aria-label', 'Haritayı kapat');

    const toggle = (key: keyof MapLayers, label: string, color: string, mark: 'fill' | 'ring' | 'halo'): LayerToggle =>
      layerToggle(label, {
        color,
        mark,
        on: this.layers[key],
        onToggle: (on) => {
          this.layers[key] = on;
          saveMapLayers(this.layers);
          // the hovered pin may be hidden now, or change its action (perch layer): the pointer re-picks it
          this.setHovered(null);
          this.invalidate();
        },
      });
    this.toggles = {
      known: toggle('known', 'Keşfedilenler', GOLD, 'fill'),
      unknown: toggle('unknown', 'Keşfedilmeyenler', GOLD, 'ring'),
      perches: toggle('perches', 'Seyir noktaları', GOLD, 'halo'),
      races: toggle('races', 'Yarış parkurları', RACE_COLOR, 'fill'),
    };
    this.toggles.races.setCount(String(BUILT_IN_COURSES.length));

    const zoom = zoomCluster({
      onZoomIn: () => this.zoomBy(1.6),
      onZoomOut: () => this.zoomBy(1 / 1.6),
      onRecenter: () => this.recenter(),
    });

    this.root = el(
      'section',
      'ejd-map ejd-interactive',
      [
        this.canvas,
        el('div', 'map-vignette'),
        el('div', 'map-title', [el('span', 'map-city', 'İstanbul'), this.where]),
        el('div', 'map-close', [close.root]),
        el('div', 'map-layers', [
          layerGroup('Harita katmanları', [this.toggles.known, this.toggles.unknown, this.toggles.perches, this.toggles.races]),
        ]),
        this.card.root,
        el('div', 'map-zoom', [zoom.root]),
        el('div', 'map-scale', [this.scaleIndicator.root]),
        el('div', 'map-hint', [
          hintLine([
            ['Sürükle', 'kaydır'],
            ['Tekerlek', 'yakınlaştır'],
            ['Tıkla', 'ışınlan'],
          ]),
        ]),
      ],
      { 'aria-label': 'İstanbul haritası' },
    );
    this.root.hidden = true;

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    raster.onReady(() => this.invalidate());
  }

  get opened(): boolean {
    return this.isOpen;
  }

  setGeo(geo: GeoQuery, discovered: ReadonlySet<string>): void {
    this.geo = geo;
    this.discovered = discovered;
    this.perchCount = -1;
    this.buildPins();
  }

  open(player: FlightSnapshot): void {
    this.player = player;
    this.isOpen = true;
    this.root.hidden = false;
    this.buildPins();
    this.updateCounts();
    this.where.textContent = this.whereText(player);
    this.resize();
    this.centerX = player.x;
    this.centerZ = player.z;
    this.scale = Math.max(this.minScale(), 0.085);
    this.hovered = null;
    this.card.hide();
    this.invalidate();
  }

  close(): void {
    this.isOpen = false;
    this.root.hidden = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.dirty = false;
    this.pointer.id = -1;
  }

  resize(): void {
    if (!this.isOpen) {
      return;
    }
    this.width = Math.max(1, this.root.clientWidth);
    this.height = Math.max(1, this.root.clientHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.scale = Math.min(MAX_SCALE, Math.max(this.minScale(), this.scale));
    this.invalidate();
  }

  /** Map-local keys while open. Returns true when handled. */
  handleKey(e: KeyboardEvent): boolean {
    const pan = 120 / this.scale;
    switch (e.code) {
      case 'Equal':
      case 'NumpadAdd':
        this.zoomBy(1.4);
        return true;
      case 'Minus':
      case 'NumpadSubtract':
        this.zoomBy(1 / 1.4);
        return true;
      case 'ArrowLeft':
        this.panBy(-pan, 0);
        return true;
      case 'ArrowRight':
        this.panBy(pan, 0);
        return true;
      case 'ArrowUp':
        this.panBy(0, -pan);
        return true;
      case 'ArrowDown':
        this.panBy(0, pan);
        return true;
      default:
        return false;
    }
  }

  /* ---------------- data ---------------- */

  /** Landmarks (each with the perch standing on it, if any) plus the perches that belong to no landmark. */
  private buildPins(): void {
    const geo = this.geo;
    if (!geo) {
      return;
    }
    const perches = this.options.perches() ?? [];
    if (perches.length === this.perchCount && this.pins.length > 0) {
      return;
    }
    this.perchCount = perches.length;
    const byLandmark = new Map<string, PerchPoint>();
    const loose: PerchPoint[] = [];
    const landmarkIds = new Set(geo.landmarks.map((l) => l.id));
    for (const p of perches) {
      if (p.landmarkId && landmarkIds.has(p.landmarkId)) {
        if (!byLandmark.has(p.landmarkId)) {
          byLandmark.set(p.landmarkId, p);
        }
      } else {
        loose.push(p);
      }
    }
    this.pins = [
      ...geo.landmarks.map((l): MapPin => ({ id: l.id, x: l.x, z: l.z, name: l.name, landmark: l, perch: byLandmark.get(l.id) })),
      ...loose.map((p): MapPin => ({ id: `perch:${p.id}`, x: p.x, z: p.z, name: perchTeleportView(p).label, perch: p })),
    ];
    this.toggles.perches.setCount(String(perches.length));
  }

  private updateCounts(): void {
    const landmarks = this.geo?.landmarks ?? [];
    let known = 0;
    for (const l of landmarks) {
      if (this.discovered.has(l.id)) {
        known++;
      }
    }
    this.toggles.known.setCount(`${known}/${landmarks.length}`);
    this.toggles.unknown.setCount(String(landmarks.length - known));
  }

  /** "<water or district> üzerinde · <altitude> m", the same lookups as the HUD's area title. */
  private whereText(p: FlightSnapshot): string {
    const geo = this.geo;
    let name = '';
    if (geo) {
      const district = geo.isWater(p.x, p.z) ? null : geo.districtAt(p.x, p.z);
      name = district?.name ?? geo.waterNameAt?.(p.x, p.z) ?? '';
    }
    const altitude = `${formatInt(Math.max(0, p.altitude))} m`;
    return name ? `${name} üzerinde · ${altitude}` : altitude;
  }

  private isKnown(pin: MapPin): boolean {
    return !!pin.landmark && this.discovered.has(pin.landmark.id);
  }

  /** A perch counts as a perch only while its layer is on (then it is drawn larger and clicks perch-teleport). */
  private perchShown(pin: MapPin): boolean {
    return !!pin.perch && this.layers.perches;
  }

  private pinVisible(pin: MapPin): boolean {
    if (this.perchShown(pin)) {
      return true;
    }
    return !!pin.landmark && (this.isKnown(pin) ? this.layers.known : this.layers.unknown);
  }

  /* ---------------- view ---------------- */

  private minScale(): number {
    return (Math.min(this.width, this.height) / (WORLD_HALF_SIZE * 2)) * 1.02;
  }

  private panBy(dx: number, dz: number): void {
    this.centerX = Math.max(-WORLD_HALF_SIZE, Math.min(WORLD_HALF_SIZE, this.centerX + dx));
    this.centerZ = Math.max(-WORLD_HALF_SIZE, Math.min(WORLD_HALF_SIZE, this.centerZ + dz));
    this.invalidate();
  }

  private zoomBy(factor: number, anchorX = this.width / 2, anchorY = this.height / 2): void {
    const before = this.toWorld(anchorX, anchorY);
    this.scale = Math.min(MAX_SCALE, Math.max(this.minScale(), this.scale * factor));
    const after = this.toWorld(anchorX, anchorY);
    this.panBy(before.x - after.x, before.z - after.z);
  }

  private recenter(): void {
    if (this.player) {
      this.centerX = this.player.x;
      this.centerZ = this.player.z;
      this.invalidate();
    }
  }

  private toWorld(sx: number, sy: number): { x: number; z: number } {
    return { x: this.centerX + (sx - this.width / 2) / this.scale, z: this.centerZ + (sy - this.height / 2) / this.scale };
  }

  private toScreenX(x: number): number {
    return (x - this.centerX) * this.scale + this.width / 2;
  }

  private toScreenY(z: number): number {
    return (z - this.centerZ) * this.scale + this.height / 2;
  }

  private invalidate(): void {
    if (!this.isOpen || this.dirty) {
      return;
    }
    this.dirty = true;
    this.raf = requestAnimationFrame(() => {
      this.dirty = false;
      this.draw();
    });
  }

  /* ---------------- pointer ---------------- */

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) {
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.pointer = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, dragging: false };
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.hoverX = e.clientX - rect.left;
    this.hoverY = e.clientY - rect.top;
    const p = this.pointer;
    if (p.id === e.pointerId) {
      if (!p.dragging && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > DRAG_THRESHOLD_PX) {
        p.dragging = true;
        this.root.classList.add('is-dragging');
        this.setHovered(null);
      }
      if (p.dragging) {
        this.panBy(-(e.clientX - p.lastX) / this.scale, -(e.clientY - p.lastY) / this.scale);
      }
      p.lastX = e.clientX;
      p.lastY = e.clientY;
      if (p.dragging) {
        return;
      }
    }
    this.updateHover();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const p = this.pointer;
    if (p.id !== e.pointerId) {
      return;
    }
    p.id = -1;
    this.root.classList.remove('is-dragging');
    if (!p.dragging && e.type === 'pointerup') {
      const rect = this.canvas.getBoundingClientRect();
      this.teleportAt(e.clientX - rect.left, e.clientY - rect.top);
    }
  };

  private readonly onPointerLeave = (): void => {
    this.hoverX = -1;
    this.setHovered(null);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.zoomBy(Math.exp(-delta * 0.0016), e.clientX - rect.left, e.clientY - rect.top);
    this.updateHover();
  };

  private hitPin(sx: number, sy: number): MapPin | null {
    let best: MapPin | null = null;
    let bestD = HIT_RADIUS_PX * HIT_RADIUS_PX;
    for (const pin of this.pins) {
      const pos = this.screenPos.get(pin.id);
      if (!pos) {
        continue;
      }
      const d = (pos.x - sx) ** 2 + (pos.y - sy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = pin;
      }
    }
    return best;
  }

  private updateHover(): void {
    if (this.hoverX < 0) {
      return;
    }
    this.setHovered(this.hitPin(this.hoverX, this.hoverY));
  }

  private setHovered(pin: MapPin | null): void {
    if (pin === this.hovered) {
      return;
    }
    this.hovered = pin;
    this.root.classList.toggle('is-over-pin', !!pin);
    if (pin) {
      this.card.set(pin.name, this.pinMeta(pin), this.perchShown(pin) ? 'Tıkla: ışınlan · konulabilir' : 'Tıkla: ışınlan');
    } else {
      this.card.hide();
    }
    this.invalidate();
  }

  /** "<kind> · <year> · <distance> km · keşfedildi / keşfedilmedi". */
  private pinMeta(pin: MapPin): string {
    const parts: string[] = [];
    if (pin.landmark) {
      parts.push(LANDMARK_KIND_LABELS[pin.landmark.kind]);
      if (pin.landmark.year !== undefined) {
        parts.push(formatYear(pin.landmark.year));
      }
    } else if (pin.perch) {
      parts.push(pin.perch.surface === 'hill' ? 'Tepe' : 'Seyir noktası');
    }
    if (this.player) {
      parts.push(`${formatDecimal(Math.hypot(pin.x - this.player.x, pin.z - this.player.z) / 1000)} km`);
    }
    if (pin.landmark) {
      parts.push(this.isKnown(pin) ? 'keşfedildi' : 'keşfedilmedi');
    }
    return parts.join(' · ');
  }

  /* ---------------- teleport ---------------- */

  private teleportAt(sx: number, sy: number): void {
    const geo = this.geo;
    if (!geo) {
      return;
    }
    const pin = this.hitPin(sx, sy);
    if (pin && this.perchShown(pin)) {
      this.options.onPerch(pin.perch!);
      return;
    }
    if (pin?.landmark) {
      this.teleportToLandmark(geo, pin.landmark);
      return;
    }
    const world = this.toWorld(sx, sy);
    if (Math.abs(world.x) > WORLD_HALF_SIZE - 200 || Math.abs(world.z) > WORLD_HALF_SIZE - 200) {
      return;
    }
    const water = geo.isWater(world.x, world.z);
    const district = water ? null : geo.districtAt(world.x, world.z);
    const ground = Math.max(0, geo.heightAt(world.x, world.z));
    this.options.onTeleport({
      x: world.x,
      y: ground + 220,
      z: world.z,
      headingDeg: this.player?.headingDeg ?? 0,
      pitchDeg: -3,
      label: district?.name ?? 'Su üzeri',
    });
  }

  /** A spot off the landmark on the player's side, high enough to clear it, facing it. */
  private teleportToLandmark(geo: GeoQuery, landmark: LandmarkDef): void {
    const from = this.player ?? { x: landmark.x, z: landmark.z + 1 };
    let dx = from.x - landmark.x;
    let dz = from.z - landmark.z;
    const len = Math.hypot(dx, dz);
    if (len < 1) {
      dx = 0;
      dz = 1;
    } else {
      dx /= len;
      dz /= len;
    }
    const distance = Math.max(650, landmark.radius * 1.5 + 320);
    const x = landmark.x + dx * distance;
    const z = landmark.z + dz * distance;
    const ground = Math.max(0, geo.heightAt(x, z));
    const y = Math.max(ground + 130, landmark.y + Math.max(landmark.height * 1.25, 120));
    this.options.onTeleport({ x, y, z, headingDeg: bearingTo(x, z, landmark), pitchDeg: -6, label: landmark.name });
  }

  /* ---------------- drawing ---------------- */

  private draw(): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const w = this.width;
    const h = this.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080c11';
    ctx.fillRect(0, 0, w, h);

    const image = this.raster.image;
    const b = this.raster.bounds;
    const x0 = this.toScreenX(b.minX);
    const y0 = this.toScreenY(b.minZ);
    const size = (b.maxX - b.minX) * this.scale;
    if (image) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, x0, y0, size, size);
    }

    ctx.save();
    ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * (w / 2 - this.centerX * this.scale), dpr * (h / 2 - this.centerZ * this.scale));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (this.raster.coastPath) {
      ctx.strokeStyle = 'rgba(160, 198, 222, 0.5)';
      ctx.lineWidth = 1.1 / this.scale;
      ctx.stroke(this.raster.coastPath);
    }
    if (this.raster.highwayPath && this.scale > 0.05) {
      ctx.strokeStyle = `rgba(240, 196, 138, ${Math.min(0.42, (this.scale - 0.05) * 3 + 0.18).toFixed(2)})`;
      ctx.lineWidth = 1.3 / this.scale;
      ctx.stroke(this.raster.highwayPath);
    }
    if (this.layers.races) {
      this.drawRaces(ctx);
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);

    // screen areas the chrome covers: names are not written under it
    const boxes: LabelBox[] = [
      { x0: 0, y0: 0, x1: 340, y1: 84 },
      { x0: 0, y0: 96, x1: 272, y1: 300 },
      { x0: w - 180, y0: 0, x1: w, y1: 80 },
      { x0: 0, y0: h - 76, x1: w, y1: h },
      { x0: w - 90, y0: h - 190, x1: w, y1: h },
    ];
    this.placePins();
    this.drawNames(ctx, boxes);
    this.drawPins(ctx);
    this.drawPlayer(ctx);
    this.scaleIndicator.set(this.scale);
    if (this.hovered) {
      const pos = this.screenPos.get(this.hovered.id);
      if (pos) {
        this.card.showAt(pos.x, pos.y, w, h);
      } else {
        this.card.hide();
      }
    }
  }

  /** Teal dashed polylines through the built-in courses' gates (world transform set by the caller). */
  private drawRaces(ctx: CanvasRenderingContext2D): void {
    const k = 1 / this.scale;
    ctx.strokeStyle = RACE_COLOR;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2.5 * k;
    ctx.setLineDash([7 * k, 6 * k]);
    for (const line of racePolylines()) {
      ctx.beginPath();
      line.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.z) : ctx.lineTo(p.x, p.z)));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  private placePins(): void {
    this.screenPos.clear();
    for (const pin of this.pins) {
      if (!this.pinVisible(pin)) {
        continue;
      }
      const x = this.toScreenX(pin.x);
      const y = this.toScreenY(pin.z);
      if (x < -20 || y < -20 || x > this.width + 20 || y > this.height + 20) {
        continue;
      }
      this.screenPos.set(pin.id, { x, y });
    }
  }

  /** Water names in italic blue-grey, then district names in muted ink where they fit (the raster has no names). */
  private drawNames(ctx: CanvasRenderingContext2D, boxes: LabelBox[]): void {
    const geo = this.geo;
    if (!geo) {
      return;
    }
    for (const pos of this.screenPos.values()) {
      boxes.push({ x0: pos.x - 8, y0: pos.y - 8, x1: pos.x + 8, y1: pos.y + 8 });
    }
    if (this.player) {
      const px = this.toScreenX(this.player.x);
      const py = this.toScreenY(this.player.z);
      boxes.push({ x0: px - 16, y0: py - 16, x1: px + 16, y1: py + 16 });
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const spacing = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    const hasSpacing = 'letterSpacing' in spacing;

    ctx.font = 'italic 500 15px system-ui, -apple-system, sans-serif';
    if (hasSpacing) {
      spacing.letterSpacing = '0.3px';
    }
    for (const water of WATER_LABELS) {
      const local = latLonToLocal(water.lat, water.lon);
      if (!geo.isWater(local.x, local.z)) {
        continue;
      }
      const x = this.toScreenX(local.x);
      const y = this.toScreenY(local.z);
      const tw = ctx.measureText(water.name).width;
      const box = { x0: x - tw / 2 - 4, y0: y - 10, x1: x + tw / 2 + 4, y1: y + 10 };
      if (box.x0 < 4 || box.y0 < 4 || box.x1 > this.width - 4 || box.y1 > this.height - 4 || overlaps(boxes, box)) {
        continue;
      }
      boxes.push(box);
      ctx.fillStyle = 'rgba(170, 190, 215, 0.6)';
      ctx.fillText(water.name, x, y);
    }
    if (hasSpacing) {
      spacing.letterSpacing = '0px';
    }

    if (this.scale >= 0.03) {
      ctx.font = '500 13px system-ui, -apple-system, sans-serif';
      for (const district of geo.districts) {
        const x = this.toScreenX(district.x);
        const y = this.toScreenY(district.z);
        if (x < 0 || y < 0 || x > this.width || y > this.height) {
          continue;
        }
        const tw = ctx.measureText(district.name).width;
        const box = { x0: x - tw / 2 - 5, y0: y - 9, x1: x + tw / 2 + 5, y1: y + 9 };
        if (box.x0 < 4 || box.y0 < 4 || box.x1 > this.width - 4 || box.y1 > this.height - 4 || overlaps(boxes, box)) {
          continue;
        }
        boxes.push(box);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(8, 10, 14, 0.35)';
        ctx.strokeText(district.name, x, y);
        ctx.fillStyle = 'rgba(243, 238, 229, 0.5)';
        ctx.fillText(district.name, x, y);
      }
    }
    ctx.textAlign = 'start';
  }

  /** Discovered: filled gold with a dark ring; undiscovered: hollow gold ring; perches larger with a soft halo. */
  private drawPins(ctx: CanvasRenderingContext2D): void {
    const draw = (pin: MapPin): void => {
      const pos = this.screenPos.get(pin.id)!;
      const perch = this.perchShown(pin);
      const filled = this.isKnown(pin) || !pin.landmark;
      const r = pin === this.hovered ? 8 : perch ? 6.5 : 5.5;
      if (perch) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(232, 184, 114, 0.3)';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = filled ? GOLD : 'rgba(17, 19, 24, 0.9)';
      ctx.fill();
      ctx.lineWidth = filled ? 1.5 : 2;
      ctx.strokeStyle = filled ? PIN_RING : GOLD;
      ctx.stroke();
    };
    for (const pin of this.pins) {
      if (pin !== this.hovered && this.screenPos.has(pin.id)) {
        draw(pin);
      }
    }
    if (this.hovered && this.screenPos.has(this.hovered.id)) {
      draw(this.hovered);
    }
  }

  /** White arrow in the heading direction with a soft view cone ahead of it. */
  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    const p = this.player;
    if (!p) {
      return;
    }
    ctx.save();
    ctx.translate(this.toScreenX(p.x), this.toScreenY(p.z));
    ctx.rotate((p.headingDeg * Math.PI) / 180);
    const reach = 120;
    const cone = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
    cone.addColorStop(0, 'rgba(246, 241, 231, 0.2)');
    cone.addColorStop(1, 'rgba(246, 241, 231, 0)');
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, reach, -Math.PI / 2 - 0.46, -Math.PI / 2 + 0.46);
    ctx.closePath();
    ctx.fillStyle = cone;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fillStyle = '#f6f1e7';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = PIN_RING;
    ctx.stroke();
    ctx.restore();
  }

  dispose(): void {
    this.close();
  }
}
