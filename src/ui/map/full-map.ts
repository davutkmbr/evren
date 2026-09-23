import type { GeoQuery, LandmarkDef } from '../../core/contracts';
import { localToLatLon, WORLD_HALF_SIZE } from '../../core/geo-coords';
import { el } from '../dom';
import { formatInt, formatYear } from '../format';
import { ICONS } from '../icons';
import { LANDMARK_KIND_LABELS, shortLandmarkName } from '../labels';
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
  onClose(): void;
}

interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MAX_SCALE = 0.34;
const DRAG_THRESHOLD_PX = 5;
const SCALE_STEPS_M = [100, 200, 500, 1000, 2000, 5000, 10000];
const COORD_FORMAT = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

function overlaps(boxes: LabelBox[], b: LabelBox): boolean {
  for (const o of boxes) {
    if (b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) {
      return true;
    }
  }
  return false;
}

/** Full-screen map (M): pan/zoom, district names, landmarks, current position, click to teleport. */
export class FullMap {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tooltip: HTMLElement;
  private readonly tooltipTitle: HTMLElement;
  private readonly tooltipMeta: HTMLElement;
  private readonly tooltipAction: HTMLElement;
  private readonly coords: HTMLElement;
  private readonly scaleBar: HTMLElement;
  private readonly scaleLabel: HTMLElement;
  private geo: GeoQuery | null = null;
  private discovered: ReadonlySet<string> = new Set();
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
  private hovered: LandmarkDef | null = null;
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

    this.tooltipTitle = el('span', 'map-tip-title');
    this.tooltipMeta = el('span', 'map-tip-meta');
    this.tooltipAction = el('span', 'map-tip-action');
    this.tooltip = el('div', 'map-tip ejd-glass', [this.tooltipTitle, this.tooltipMeta, this.tooltipAction]);
    this.tooltip.hidden = true;

    const closeButton = el('button', 'map-close ejd-glass', undefined, { type: 'button', 'aria-label': 'Haritayı kapat' });
    closeButton.innerHTML = `<span>Kapat</span><kbd>M</kbd>`;
    closeButton.addEventListener('click', () => this.options.onClose());

    const zoomButton = (icon: string, label: string, fn: () => void): HTMLButtonElement => {
      const b = el('button', 'map-zoom-btn', undefined, { type: 'button', 'aria-label': label, title: label });
      b.innerHTML = icon;
      b.addEventListener('click', fn);
      return b;
    };
    const controls = el('div', 'map-controls ejd-glass', [
      zoomButton(ICONS.plus, 'Yakınlaştır', () => this.zoomBy(1.6)),
      zoomButton(ICONS.minus, 'Uzaklaştır', () => this.zoomBy(1 / 1.6)),
      el('i', 'map-controls-sep'),
      zoomButton(ICONS.locate, 'Konumuma dön', () => this.recenter()),
    ]);

    this.coords = el('span', 'map-coords ejd-num', '');
    this.scaleBar = el('i', 'map-scale-bar');
    this.scaleLabel = el('span', 'map-scale-label ejd-num', '');
    const legendItem = (cls: string, text: string): HTMLElement => el('span', 'map-legend-item', [el('i', cls), text]);

    this.root = el('section', 'ejd-map ejd-interactive', [
      this.canvas,
      el('div', 'map-vignette'),
      el('header', 'map-head', [
        el('p', 'ejd-caps map-eyebrow', 'Harita'),
        el('h2', 'map-title', 'İstanbul'),
        el('p', 'map-hint', [
          el('span', undefined, [el('b', undefined, 'Sürükle'), ' kaydır']),
          el('span', undefined, [el('b', undefined, 'Tekerlek'), ' yakınlaştır']),
          el('span', undefined, [el('b', undefined, 'Tıkla'), ' ışınlan']),
        ]),
      ]),
      closeButton,
      el('footer', 'map-foot', [
        el('div', 'map-scale', [this.scaleBar, this.scaleLabel]),
        el('div', 'map-legend', [
          legendItem('lg-known', 'Keşfedildi'),
          legendItem('lg-unknown', 'Keşfedilmedi'),
          legendItem('lg-you', 'Konumun'),
        ]),
        this.coords,
        el('span', 'map-attrib', '© OpenStreetMap katkıcıları (ODbL) · NASA SRTM'),
      ]),
      controls,
      this.tooltip,
    ], { 'aria-label': 'İstanbul haritası' });
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
  }

  open(player: FlightSnapshot): void {
    this.player = player;
    this.isOpen = true;
    this.root.hidden = false;
    this.resize();
    this.centerX = player.x;
    this.centerZ = player.z;
    this.scale = Math.max(this.minScale(), 0.085);
    this.hovered = null;
    this.tooltip.hidden = true;
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
        this.tooltip.hidden = true;
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
    this.tooltip.hidden = true;
    if (this.hovered) {
      this.hovered = null;
      this.invalidate();
    }
    this.coords.textContent = '';
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.zoomBy(Math.exp(-delta * 0.0016), e.clientX - rect.left, e.clientY - rect.top);
    this.updateHover();
  };

  private hitLandmark(sx: number, sy: number): LandmarkDef | null {
    if (!this.geo) {
      return null;
    }
    let best: LandmarkDef | null = null;
    let bestD = 13 * 13;
    for (const landmark of this.geo.landmarks) {
      const pos = this.screenPos.get(landmark.id);
      if (!pos) {
        continue;
      }
      const d = (pos.x - sx) ** 2 + (pos.y - sy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = landmark;
      }
    }
    return best;
  }

  private updateHover(): void {
    if (this.hoverX < 0 || !this.geo) {
      return;
    }
    const world = this.toWorld(this.hoverX, this.hoverY);
    const ll = localToLatLon(world.x, world.z);
    this.coords.textContent = `${COORD_FORMAT.format(ll.lat)}° K   ${COORD_FORMAT.format(ll.lon)}° D`;
    const hit = this.hitLandmark(this.hoverX, this.hoverY);
    if (hit !== this.hovered) {
      this.hovered = hit;
      this.invalidate();
    }
    const outside = Math.abs(world.x) > WORLD_HALF_SIZE || Math.abs(world.z) > WORLD_HALF_SIZE;
    if (outside) {
      this.tooltip.hidden = true;
      return;
    }
    if (hit) {
      this.tooltipTitle.textContent = hit.name;
      const kind = LANDMARK_KIND_LABELS[hit.kind];
      this.tooltipMeta.textContent = hit.year !== undefined ? `${kind} · ${formatYear(hit.year)}` : kind;
      this.tooltipAction.textContent = this.discovered.has(hit.id) ? 'Keşfedildi · Tıkla, yakınına ışınlan' : 'Tıkla, yakınına ışınlan';
    } else {
      const water = this.geo.isWater(world.x, world.z);
      const district = water ? null : this.geo.districtAt(world.x, world.z);
      this.tooltipTitle.textContent = district ? district.name : water ? 'Su üzeri' : 'İstanbul';
      const ground = Math.max(0, this.geo.heightAt(world.x, world.z));
      this.tooltipMeta.textContent = water ? 'Deniz seviyesi' : `Rakım ${formatInt(ground)} m`;
      this.tooltipAction.textContent = 'Tıkla, buraya ışınlan';
    }
    const tipX = Math.min(this.width - 240, this.hoverX + 18);
    const tipY = Math.min(this.height - 90, this.hoverY + 18);
    this.tooltip.style.transform = `translate3d(${tipX.toFixed(0)}px, ${tipY.toFixed(0)}px, 0)`;
    this.tooltip.hidden = false;
  }

  private teleportAt(sx: number, sy: number): void {
    const geo = this.geo;
    if (!geo) {
      return;
    }
    const landmark = this.hitLandmark(sx, sy);
    if (landmark) {
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
    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);

    const boxes: LabelBox[] = [
      { x0: 0, y0: 0, x1: 390, y1: 112 },
      { x0: w - 160, y0: 0, x1: w, y1: 72 },
      { x0: 0, y0: h - 58, x1: 660, y1: h },
      { x0: w - 84, y0: h - 170, x1: w, y1: h },
    ];
    this.drawPlayer(ctx, boxes);
    this.drawLandmarks(ctx, boxes);
    this.drawDistricts(ctx, boxes);
    this.updateScaleBar();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, boxes: LabelBox[]): void {
    const p = this.player;
    if (!p) {
      return;
    }
    const x = this.toScreenX(p.x);
    const y = this.toScreenY(p.z);
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(232, 184, 114, 0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232, 184, 114, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.rotate((p.headingDeg * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 4.6);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fillStyle = '#fff6e8';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(10, 12, 16, 0.8)';
    ctx.stroke();
    ctx.restore();
    boxes.push({ x0: x - 20, y0: y - 20, x1: x + 20, y1: y + 20 });
  }

  private drawLandmarks(ctx: CanvasRenderingContext2D, boxes: LabelBox[]): void {
    const geo = this.geo;
    this.screenPos.clear();
    if (!geo) {
      return;
    }
    const showLabels = this.scale > 0.055;
    ctx.font = '600 12px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const sorted = [...geo.landmarks].sort((a, b) => Number(b.id === this.hovered?.id) - Number(a.id === this.hovered?.id) || b.height - a.height);
    for (const landmark of sorted) {
      const x = this.toScreenX(landmark.x);
      const y = this.toScreenY(landmark.z);
      if (x < -20 || y < -20 || x > this.width + 20 || y > this.height + 20) {
        continue;
      }
      this.screenPos.set(landmark.id, { x, y });
    }
    for (const landmark of sorted) {
      const pos = this.screenPos.get(landmark.id);
      if (!pos) {
        continue;
      }
      const known = this.discovered.has(landmark.id);
      const hovered = landmark === this.hovered;
      const r = hovered ? 6.5 : 4.5;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = known ? '#e8b872' : 'rgba(14, 16, 20, 0.9)';
      ctx.fill();
      ctx.lineWidth = known ? 1.5 : 1.6;
      ctx.strokeStyle = known ? 'rgba(12, 12, 14, 0.85)' : 'rgba(243, 211, 160, 0.95)';
      ctx.stroke();
      if (hovered) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(243, 211, 160, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    const markerBoxes: LabelBox[] = [];
    for (const pos of this.screenPos.values()) {
      markerBoxes.push({ x0: pos.x - 6, y0: pos.y - 6, x1: pos.x + 6, y1: pos.y + 6 });
    }
    for (const landmark of sorted) {
      const pos = this.screenPos.get(landmark.id);
      const hovered = landmark === this.hovered;
      if (!pos || (!showLabels && !hovered)) {
        continue;
      }
      const known = this.discovered.has(landmark.id);
      const text = shortLandmarkName(landmark);
      const tw = ctx.measureText(text).width;
      const right = { x0: pos.x + 9, y0: pos.y - 9, x1: pos.x + 13 + tw, y1: pos.y + 9 };
      const left = { x0: pos.x - 13 - tw, y0: pos.y - 9, x1: pos.x - 9, y1: pos.y + 9 };
      const fits = (b: LabelBox): boolean =>
        b.x0 > 4 && b.x1 < this.width - 4 && b.y0 > 4 && b.y1 < this.height - 4 && !overlaps(boxes, b) && !overlaps(markerBoxes, b);
      const box = hovered || fits(right) ? right : fits(left) ? left : null;
      if (!box) {
        continue;
      }
      boxes.push(box);
      const textX = box.x0 + 2;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(8, 10, 14, 0.72)';
      ctx.strokeText(text, textX, pos.y + 0.5);
      ctx.fillStyle = hovered ? '#fff8ee' : known ? 'rgba(248, 231, 204, 0.96)' : 'rgba(243, 238, 229, 0.82)';
      ctx.fillText(text, textX, pos.y + 0.5);
    }
    boxes.push(...markerBoxes);
  }

  private drawDistricts(ctx: CanvasRenderingContext2D, boxes: LabelBox[]): void {
    const geo = this.geo;
    if (!geo || this.scale < 0.03) {
      return;
    }
    const alpha = Math.min(0.62, 0.3 + (this.scale - 0.03) * 5);
    ctx.font = '600 10.5px system-ui, -apple-system, sans-serif';
    const spacing = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    if ('letterSpacing' in spacing) {
      spacing.letterSpacing = '1.4px';
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const district of geo.districts) {
      const x = this.toScreenX(district.x);
      const y = this.toScreenY(district.z);
      if (x < 0 || y < 0 || x > this.width || y > this.height) {
        continue;
      }
      const text = district.name.toLocaleUpperCase('tr-TR');
      const tw = ctx.measureText(text).width;
      const box = { x0: x - tw / 2 - 6, y0: y - 9, x1: x + tw / 2 + 6, y1: y + 9 };
      if (box.x0 < 4 || box.x1 > this.width - 4 || box.y1 > this.height - 4 || overlaps(boxes, box)) {
        continue;
      }
      boxes.push(box);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(8, 10, 14, 0.55)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = `rgba(243, 238, 229, ${alpha.toFixed(2)})`;
      ctx.fillText(text, x, y);
    }
    if ('letterSpacing' in spacing) {
      spacing.letterSpacing = '0px';
    }
    ctx.textAlign = 'start';
  }

  private updateScaleBar(): void {
    const targetPx = 120;
    let meters = SCALE_STEPS_M[0];
    for (const step of SCALE_STEPS_M) {
      if (step * this.scale <= targetPx) {
        meters = step;
      }
    }
    this.scaleBar.style.width = `${Math.round(meters * this.scale)}px`;
    this.scaleLabel.textContent = meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
  }

  dispose(): void {
    this.close();
  }
}
