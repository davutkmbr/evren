/**
 * Photo album controller: [Enter] in photo mode takes a photo of the frame as rendered (the HUD is already hidden
 * there), names it (meta.ts), checks the golden-hour badge rules (badges.ts), encodes it off the main thread
 * (capture.ts) and stores it locally under the album policy (policy.ts, idb-store.ts). A full album asks first:
 * pressing [Enter] again within a few seconds saves and prunes the oldest photos. Feedback is one quiet toast.
 */
import * as THREE from 'three';
import type { CameraMode, EngineContext } from '../../core/contracts';
import { el } from '../dom';
import type { Toasts } from '../overlays/toasts';
import { AlbumPanel } from './album-panel';
import { earnBadge, PHOTO_QUALITY, photoQuality } from './album-prefs';
import { badgePlace } from './badges';
import { afterThisFrame, grabCanvas, PhotoEncoder } from './capture';
import type { IdbPhotoStore } from './idb-store';
import { buildPhotoMeta, newPhotoId, type PlaceSources } from './meta';
import { savePhoto } from './policy';
import type { PhotoDragonState, PhotoMeta, PhotoRecord } from './types';

/** How long a "the album is full" question waits for the second [Enter] (ms). */
const CONFIRM_MS = 8000;
const THUMB_SIDE = 400;

export class PhotoAlbum {
  readonly panel: AlbumPanel;
  /** A short white flash over the scene after the shutter (DOM only, never in the photo). */
  readonly flash = el('div', 'album-flash', undefined, { 'aria-hidden': 'true' });
  private readonly encoder = new PhotoEncoder();
  private request: CameraMode | null = null;
  private busy = false;
  private pending: { record: PhotoRecord; until: number } | null = null;
  private readonly forward = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();

  constructor(
    private readonly ctx: EngineContext,
    private readonly toasts: Toasts,
    private readonly store: IdbPhotoStore,
    private readonly onClick: () => void,
  ) {
    this.panel = new AlbumPanel(store, onClick);
  }

  /** [Enter] in photo mode: take a photo on this frame, or confirm saving the one waiting on a full album. */
  requestCapture(cameraMode: CameraMode): void {
    if (this.pending && performance.now() < this.pending.until) {
      const record = this.pending.record;
      this.pending = null;
      void this.save(record, true);
      return;
    }
    this.pending = null;
    if (!this.busy) {
      this.request = cameraMode;
    }
  }

  /** Per frame, from the UI update (after the camera moved, before the render). */
  update(): void {
    if (this.request === null || this.busy) {
      return;
    }
    const cameraMode = this.request;
    this.request = null;
    this.busy = true;
    let meta: PhotoMeta;
    try {
      meta = this.describe(cameraMode);
    } catch {
      this.busy = false;
      this.toasts.push('Fotoğraf çekilemedi', 'warn');
      return;
    }
    const canvas = this.ctx.canvas;
    void afterThisFrame(() => grabCanvas(canvas))
      .then(async (bitmap) => {
        if (!bitmap) {
          throw new Error('capture unavailable');
        }
        this.shutter();
        const q = PHOTO_QUALITY[photoQuality()];
        const encoded = await this.encoder.encode(bitmap, { quality: q.quality, maxSide: q.maxSide, thumbSide: THUMB_SIDE });
        meta.width = encoded.width;
        meta.height = encoded.height;
        meta.mime = encoded.mime;
        meta.bytes = encoded.image.size + encoded.thumb.size;
        await this.save({ meta, image: encoded.image, thumb: encoded.thumb }, false);
      })
      .catch(() => this.toasts.push('Fotoğraf çekilemedi', 'warn'))
      .finally(() => {
        this.busy = false;
      });
  }

  /** Photo mode ended: a photo waiting for the "album full" confirmation is dropped. */
  photoModeEnded(): void {
    if (this.pending) {
      this.pending = null;
      this.toasts.push('Fotoğraf kaydedilmedi');
    }
    this.request = null;
  }

  dispose(): void {
    this.encoder.dispose();
    this.panel.dispose();
    this.flash.remove();
  }

  private async save(record: PhotoRecord, confirmPrune: boolean): Promise<void> {
    const outcome = await savePhoto(this.store, record, { confirmPrune });
    switch (outcome.status) {
      case 'saved': {
        const place = badgePlace(record.meta.badgeId);
        const fresh = !!place && earnBadge(place.id, record.meta.id, record.meta.takenAt);
        this.toasts.push(fresh && place ? `Altın saat · ${place.name} · fotoğraf albümde` : 'Fotoğraf albüme kaydedildi');
        this.panel.invalidate();
        break;
      }
      case 'needs-confirm': {
        this.pending = { record, until: performance.now() + CONFIRM_MS };
        const n = outcome.prune.length;
        this.toasts.push(`Albüm dolu: ${n > 1 ? `en eski ${n} fotoğraf` : 'en eski fotoğraf'} silinecek · kaydetmek için yine [Enter]`, 'warn');
        break;
      }
      case 'no-space':
        this.toasts.push('Albümde yer kalmadı · Albüm\'den birkaç fotoğraf sil', 'warn');
        break;
      default:
        this.toasts.push('Fotoğraf kaydedilemedi', 'warn');
    }
  }

  private shutter(): void {
    this.onClick();
    this.flash.classList.remove('is-on');
    void this.flash.offsetWidth;
    this.flash.classList.add('is-on');
  }

  /** Metadata from the engine state of this frame. */
  private describe(cameraMode: CameraMode): PhotoMeta {
    const { ctx } = this;
    const { services } = ctx;
    const camera = ctx.camera;
    camera.updateMatrixWorld();
    camera.getWorldDirection(this.forward);
    camera.getWorldQuaternion(this.quat);
    camera.getWorldPosition(this.pos);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    const dragon = services.tryGet('dragon');
    const perch = dragon?.perch?.phase === 'perched' ? dragon.perch.point : null;
    let state: PhotoDragonState = 'none';
    if (perch) {
      state = 'perched';
    } else if (dragon) {
      const mode = dragon.mode;
      state = mode === 'grounded' || mode === 'landing' ? 'ground' : mode === 'swimming' || mode === 'underwater' ? 'water' : 'flying';
    }
    const geo = services.tryGet('geo');
    const sources: PlaceSources = {
      landmarks: geo?.landmarks ?? [],
      landmark: (id) => geo?.landmark(id),
      districtAt: (x, z) => geo?.districtAt(x, z)?.name,
      waterAt: (x, z) => geo?.waterNameAt?.(x, z),
      perchName: perch?.name,
    };
    const env = services.tryGet('env');
    const now = Date.now();
    return buildPhotoMeta({
      id: newPhotoId(now),
      takenAt: now,
      timeOfDay: ctx.time.timeOfDay,
      dayOfYear: ctx.time.dayOfYear,
      weather: services.tryGet('weather')?.preset ?? 'unknown',
      view: {
        position: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
        forward: { x: this.forward.x, y: this.forward.y, z: this.forward.z },
        up: { x: this.up.x, y: this.up.y, z: this.up.z },
        fovDeg: camera.fov,
        aspect: camera.aspect,
        near: camera.near,
      },
      cameraMode,
      dragon: state,
      perchId: perch?.id,
      // Without a sky the sun counts as high (no golden hour).
      sunDirY: env ? env.sunDirection.y : 1,
      sources,
    });
  }
}
