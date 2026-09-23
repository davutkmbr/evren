import type { District, GeoQuery, LandmarkDef } from '../../core/contracts';
import { el, svg, TextSlot, TransformSlot } from '../dom';
import { PLAYER_ARROW } from '../icons';
import type { FlightSnapshot } from '../types';
import type { MapRaster } from './map-raster';

const DEG = Math.PI / 180;
const DRAW_INTERVAL_S = 1 / 30;
const DISTRICT_INTERVAL_S = 0.5;
const SIDE_LABELS: Record<District['side'], string> = { europe: 'Avrupa Yakası', asia: 'Anadolu Yakası', island: 'Adalar' };

/** Circular heading-up minimap (bottom-right) drawn from the pre-rendered world raster. */
export class Minimap {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly north: TransformSlot;
  private readonly arrow: TransformSlot;
  private readonly districtName: TextSlot;
  private readonly districtSide: TextSlot;
  private readonly districtRow: HTMLElement;
  private geo: GeoQuery | null = null;
  private landmarks: readonly LandmarkDef[] = [];
  private discovered: ReadonlySet<string> = new Set();
  private cssSize = 184;
  private dpr = 1;
  private drawTimer = 0;
  private districtTimer = 0;
  private viewRadius = 2200;
  private lastDistrict: District | null | undefined = undefined;

  constructor(private readonly raster: MapRaster) {
    this.canvas = el('canvas', 'mm-canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: true })!;
    const northNode = el('div', 'mm-north-orbit', [el('span', 'mm-north', 'K')]);
    this.north = new TransformSlot(northNode);
    const arrowNode = el('div', 'mm-arrow');
    arrowNode.append(svg(PLAYER_ARROW));
    this.arrow = new TransformSlot(arrowNode);
    const nameNode = el('span', 'mm-district', '');
    const sideNode = el('span', 'mm-side', '');
    this.districtName = new TextSlot(nameNode);
    this.districtSide = new TextSlot(sideNode);
    this.districtRow = el('div', 'mm-place', [nameNode, sideNode]);
    this.districtRow.hidden = true;
    this.root = el('div', 'hud-minimap', [
      this.districtRow,
      el('div', 'mm-disc', [this.canvas, el('div', 'mm-ring'), northNode, arrowNode]),
    ]);
  }

  setGeo(geo: GeoQuery, discovered: ReadonlySet<string>): void {
    this.geo = geo;
    this.landmarks = geo.landmarks;
    this.discovered = discovered;
  }

  measure(): void {
    const disc = this.canvas.parentElement;
    const size = disc ? disc.clientWidth : 0;
    if (size <= 0) {
      return;
    }
    this.cssSize = size;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(size * this.dpr);
    if (this.canvas.width !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    this.drawTimer = 0;
  }

  update(s: FlightSnapshot, realDt: number): void {
    const targetRadius = Math.min(6500, Math.max(1600, 1300 + Math.max(0, s.agl) * 2.4));
    this.viewRadius += (targetRadius - this.viewRadius) * Math.min(1, realDt * 1.5);
    this.north.set(`rotate(${(-s.viewHeadingDeg).toFixed(2)}deg)`);
    this.arrow.set(`rotate(${(s.headingDeg - s.viewHeadingDeg).toFixed(2)}deg)`);

    this.districtTimer -= realDt;
    if (this.districtTimer <= 0 && this.geo) {
      this.districtTimer = DISTRICT_INTERVAL_S;
      const district = this.geo.isWater(s.x, s.z) ? null : this.geo.districtAt(s.x, s.z);
      if (district !== this.lastDistrict) {
        this.lastDistrict = district;
        if (district) {
          this.districtName.set(district.name);
          this.districtSide.set(SIDE_LABELS[district.side]);
        } else {
          this.districtName.set(this.geo.waterNameAt?.(s.x, s.z) ?? 'Su');
          this.districtSide.set('Su üzeri');
        }
        this.districtRow.hidden = false;
      }
    }

    this.drawTimer -= realDt;
    if (this.drawTimer > 0) {
      return;
    }
    this.drawTimer = DRAW_INTERVAL_S;
    this.draw(s);
  }

  private draw(s: FlightSnapshot): void {
    const ctx = this.ctx;
    const size = this.canvas.width;
    const half = size / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const image = this.raster.image;
    const scale = half / this.viewRadius;
    const rotation = -s.viewHeadingDeg * DEG;
    ctx.setTransform(1, 0, 0, 1, half, half);
    ctx.rotate(rotation);
    if (image) {
      const b = this.raster.bounds;
      const spanX = b.maxX - b.minX;
      const spanZ = b.maxZ - b.minZ;
      const reach = this.viewRadius * 1.45;
      const pxPerMeterX = image.width / spanX;
      const pxPerMeterZ = image.height / spanZ;
      const sx0 = Math.max(0, (s.x - reach - b.minX) * pxPerMeterX);
      const sz0 = Math.max(0, (s.z - reach - b.minZ) * pxPerMeterZ);
      const sx1 = Math.min(image.width, (s.x + reach - b.minX) * pxPerMeterX);
      const sz1 = Math.min(image.height, (s.z + reach - b.minZ) * pxPerMeterZ);
      if (sx1 > sx0 && sz1 > sz0) {
        const wx0 = b.minX + sx0 / pxPerMeterX;
        const wz0 = b.minZ + sz0 / pxPerMeterZ;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
          image,
          sx0,
          sz0,
          sx1 - sx0,
          sz1 - sz0,
          (wx0 - s.x) * scale,
          (wz0 - s.z) * scale,
          ((sx1 - sx0) / pxPerMeterX) * scale,
          ((sz1 - sz0) / pxPerMeterZ) * scale,
        );
      }
    } else {
      ctx.fillStyle = '#10161d';
      ctx.fillRect(-half, -half, size, size);
    }

    const dotR = 2.6 * this.dpr;
    const limit = this.viewRadius * 1.05;
    for (const landmark of this.landmarks) {
      const dx = landmark.x - s.x;
      const dz = landmark.z - s.z;
      if (Math.abs(dx) > limit || Math.abs(dz) > limit) {
        continue;
      }
      const px = dx * scale;
      const pz = dz * scale;
      const known = this.discovered.has(landmark.id);
      ctx.beginPath();
      ctx.arc(px, pz, known ? dotR : dotR * 0.95, 0, Math.PI * 2);
      if (known) {
        ctx.fillStyle = '#e8b872';
        ctx.fill();
        ctx.lineWidth = 1.2 * this.dpr;
        ctx.strokeStyle = 'rgba(12, 12, 14, 0.7)';
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(12, 14, 18, 0.75)';
        ctx.fill();
        ctx.lineWidth = 1.4 * this.dpr;
        ctx.strokeStyle = 'rgba(243, 211, 160, 0.9)';
        ctx.stroke();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
