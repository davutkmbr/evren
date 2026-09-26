import { prompt } from '../components';
import { el } from '../dom';
import type { MapRaster } from '../map/map-raster';
import type { Place } from './places';

export interface PlaceMapOptions {
  onPick(id: string): void;
  onHover(id: string | null): void;
  /** Double click on a pin. */
  onActivate(id: string): void;
  onOpenMap(): void;
}

const HIT_RADIUS_PX = 14;
/** Margin (m) around the pins when fitting the view. */
const FIT_MARGIN_M = 1600;

/**
 * The Işınlan map card: the shared map raster (the same image as the minimap and the full map) cropped to the
 * destinations, with a pin per place: gold for perches, blue-grey for views; filtered-out pins dim, the selected pin
 * gets a ring, hover shows the name.
 */
export class PlaceMap {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly label: HTMLElement;
  private readonly base = document.createElement('canvas');
  private baseValid = false;
  private places: readonly Place[] = [];
  private visible: ReadonlySet<string> = new Set();
  private selected: string | null = null;
  private hovered: string | null = null;
  /** Pin under the mouse (the list's hover arrives through setState). */
  private pointerPin: string | null = null;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private scale = 1;
  private centerX = 0;
  private centerZ = 0;
  private raf = 0;
  private active = false;

  constructor(
    private readonly raster: MapRaster,
    private readonly options: PlaceMapOptions,
  ) {
    this.canvas = el('canvas', 'tp-map-canvas', undefined, { role: 'img', 'aria-label': 'İstanbul haritası, gidilebilecek yerler' });
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.label = el('div', 'tp-map-label');
    this.label.hidden = true;

    const legend = el('div', 'tp-map-legend', [
      el('span', undefined, [el('i', 'tp-dot tp-dot-perch'), 'Konulabilir']),
      el('span', undefined, [el('i', 'tp-dot tp-dot-view'), 'Manzara']),
    ]);
    const mapLink = prompt('Haritada herhangi bir yere', 'M', 'secondary', () => options.onOpenMap()).root;
    mapLink.classList.add('tp-map-link');

    this.root = el('div', 'tp-map', [this.canvas, this.label, legend, mapLink]);

    this.canvas.addEventListener('pointermove', (e) => {
      const id = this.hit(e);
      this.canvas.classList.toggle('is-pin', id !== null);
      if (id !== this.pointerPin) {
        this.pointerPin = id;
        options.onHover(id);
      }
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.canvas.classList.remove('is-pin');
      if (this.pointerPin !== null) {
        this.pointerPin = null;
        options.onHover(null);
      }
    });
    this.canvas.addEventListener('click', (e) => {
      const id = this.hit(e);
      if (id) {
        options.onPick(id);
      }
    });
    this.canvas.addEventListener('dblclick', (e) => {
      const id = this.hit(e);
      if (id) {
        options.onActivate(id);
      }
    });

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.resize()).observe(this.root);
    }
    raster.onReady(() => {
      this.baseValid = false;
      this.invalidate();
    });
  }

  /** Starts drawing (the panel is shown); `false` stops the redraws. */
  setActive(active: boolean): void {
    this.active = active;
    if (active) {
      this.resize();
    } else {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  setPlaces(places: readonly Place[]): void {
    this.places = places;
    this.fit();
  }

  setState(state: { visible: ReadonlySet<string>; selected: string | null; hovered: string | null }): void {
    this.visible = state.visible;
    this.selected = state.selected;
    this.hovered = state.hovered;
    this.invalidate();
  }

  private resize(): void {
    const w = Math.max(1, Math.round(this.root.clientWidth));
    const h = Math.max(1, Math.round(this.root.clientHeight));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === this.width && h === this.height && dpr === this.dpr && this.canvas.width > 1) {
      this.invalidate();
      return;
    }
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.fit();
  }

  /** Fits every pin into the card, keeping the map's aspect. */
  private fit(): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of this.places) {
      if (p.pin) {
        minX = Math.min(minX, p.pin.x);
        maxX = Math.max(maxX, p.pin.x);
        minZ = Math.min(minZ, p.pin.z);
        maxZ = Math.max(maxZ, p.pin.z);
      }
    }
    if (!Number.isFinite(minX)) {
      minX = minZ = -12000;
      maxX = maxZ = 12000;
    }
    // keep some water and land around the pins, and room for the legend strip at the bottom
    const spanX = maxX - minX + FIT_MARGIN_M * 2;
    const spanZ = maxZ - minZ + FIT_MARGIN_M * 2;
    this.scale = Math.min(this.width / spanX, Math.max(1, this.height - 36) / spanZ);
    this.centerX = (minX + maxX) / 2;
    this.centerZ = (minZ + maxZ) / 2 + 18 / this.scale;
    this.baseValid = false;
    this.invalidate();
  }

  private sx(x: number): number {
    return (x - this.centerX) * this.scale + this.width / 2;
  }

  private sy(z: number): number {
    return (z - this.centerZ) * this.scale + this.height / 2;
  }

  private hit(e: MouseEvent): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best: string | null = null;
    let bestD = HIT_RADIUS_PX * HIT_RADIUS_PX;
    for (const p of this.places) {
      if (!p.pin) {
        continue;
      }
      const d = (this.sx(p.pin.x) - mx) ** 2 + (this.sy(p.pin.z) - my) ** 2;
      // visible pins win over dimmed ones at the same spot
      const bias = this.visible.has(p.id) ? 0 : 20;
      if (d + bias < bestD) {
        bestD = d + bias;
        best = p.id;
      }
    }
    return best;
  }

  private invalidate(): void {
    if (!this.active || this.raf) {
      return;
    }
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  /** The raster crop and the coastline, cached until the size or the raster changes. */
  private paintBase(): void {
    const c = this.base;
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const ctx = c.getContext('2d', { alpha: false });
    if (!ctx) {
      return;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0b1219';
    ctx.fillRect(0, 0, this.width, this.height);
    const image = this.raster.image;
    const b = this.raster.bounds;
    if (image) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, this.sx(b.minX), this.sy(b.minZ), (b.maxX - b.minX) * this.scale, (b.maxZ - b.minZ) * this.scale);
    }
    if (this.raster.coastPath) {
      ctx.save();
      ctx.setTransform(
        this.dpr * this.scale,
        0,
        0,
        this.dpr * this.scale,
        this.dpr * (this.width / 2 - this.centerX * this.scale),
        this.dpr * (this.height / 2 - this.centerZ * this.scale),
      );
      ctx.strokeStyle = 'rgba(160, 198, 222, 0.42)';
      ctx.lineWidth = 1 / this.scale;
      ctx.lineJoin = 'round';
      ctx.stroke(this.raster.coastPath);
      ctx.restore();
    }
    // a soft darkening so the pins read over bright land
    ctx.fillStyle = 'rgba(8, 10, 14, 0.18)';
    ctx.fillRect(0, 0, this.width, this.height);
    this.baseValid = !!image;
  }

  private draw(): void {
    if (!this.baseValid) {
      this.paintBase();
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const pins = this.places.filter((p) => p.pin);
    // dimmed pins first, then visible, the selected one on top
    const order = (p: Place): number => (p.id === this.selected ? 3 : p.id === this.hovered ? 2 : this.visible.has(p.id) ? 1 : 0);
    pins.sort((a, b) => order(a) - order(b));
    for (const p of pins) {
      const x = this.sx(p.pin!.x);
      const y = this.sy(p.pin!.z);
      const on = p.id === this.selected;
      const hov = p.id === this.hovered;
      const shown = this.visible.has(p.id);
      const r = p.perch ? (on ? 7 : 5.5) : on ? 6 : 4;
      if (on || hov) {
        ctx.beginPath();
        ctx.arc(x, y, on ? 12 : 9, 0, Math.PI * 2);
        ctx.strokeStyle = on ? '#e8b872' : 'rgba(232, 184, 114, 0.7)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = shown ? (p.perch ? '#e8b872' : '#9fb3c8') : 'rgba(243, 238, 229, 0.18)';
      ctx.fill();
      ctx.strokeStyle = '#111318';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    this.placeLabel();
  }

  /** Name tag next to the hovered pin (or the selected one). */
  private placeLabel(): void {
    const id = this.hovered ?? this.selected;
    const place = id ? this.places.find((p) => p.id === id) : undefined;
    if (!place?.pin) {
      this.label.hidden = true;
      return;
    }
    if (this.label.textContent !== place.name) {
      this.label.textContent = place.name;
    }
    this.label.hidden = false;
    const x = this.sx(place.pin.x);
    const y = this.sy(place.pin.z);
    const w = this.label.offsetWidth;
    // right of the pin, or left of it near the right edge
    const left = x + 14 + w > this.width - 8 ? Math.max(8, x - 14 - w) : x + 14;
    this.label.style.transform = `translate3d(${left.toFixed(0)}px, ${(y - 13).toFixed(0)}px, 0)`;
  }
}
