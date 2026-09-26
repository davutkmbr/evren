/**
 * Pause menu → Albüm: the photos taken in photo mode (stored locally, idb-store.ts), newest first as a thumbnail
 * grid, and one photo large with its calm caption and key-first actions ([Enter] İndir, [Del] Sil with a
 * confirmation, [Esc] Geri). The golden-hour badge row ("Altın saat 3/12") sits above the grid; a photo that earned a
 * badge carries a small gold mark.
 */
import { keyHint, keyText, prompt, segmented, thumbGrid, type Prompt } from '../components';
import { el } from '../dom';
import type { MenuPanel } from '../menu/pause-menu';
import { earnedBadges, onBadgesChange, PHOTO_QUALITY, photoQuality, setPhotoQuality, type PhotoQuality } from './album-prefs';
import { badgePlace, GOLDEN_HOUR_PLACES } from './badges';
import { photoFileName } from './filename';
import type { IdbPhotoStore } from './idb-store';
import { photoCaption, photoSubline } from './meta';
import type { PhotoEntry } from './types';
import './album.css';

const EMPTY_TEXT = 'Henüz fotoğraf yok. Uçarken [O] ile fotoğraf moduna geç, [Enter] ile çek; fotoğrafların burada kalır.';
const UNAVAILABLE_TEXT = 'Albüm bu tarayıcıda açılamadı: site verileri kapalı ya da gizli pencere olabilir.';

type View = 'grid' | 'detail' | 'confirm';

function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString('tr-TR', { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
}

export class AlbumPanel implements MenuPanel {
  readonly root: HTMLElement;
  private readonly gridView: HTMLElement;
  private readonly detailView: HTMLElement;
  private readonly grid = thumbGrid({
    label: 'Fotoğraflar',
    onSelect: () => undefined,
    onOpen: (i) => this.openDetail(i),
  });
  private readonly count = el('span', 'album-count ejd-num');
  private readonly badgeText = el('span', 'album-badges-text ejd-num');
  private readonly badgeDots = el('span', 'album-badge-dots');
  private readonly gridBody = el('div', 'album-grid-body');
  private readonly empty = el('p', 'album-empty');
  private readonly photo = el('img', 'album-photo', undefined, { alt: '', draggable: 'false' });
  private readonly caption = el('p', 'album-caption');
  private readonly subline = el('p', 'album-subline ejd-num');
  private readonly badgeLine = el('p', 'album-badge-line');
  private readonly position = el('span', 'album-position ejd-num');
  private readonly actions: HTMLElement;
  private readonly confirm: HTMLElement;
  private readonly download: Prompt;
  private entries: PhotoEntry[] = [];
  private thumbUrls: string[] = [];
  private photoUrl = '';
  private current = -1;
  private view: View = 'grid';
  private isOpen = false;
  private dirty = true;
  private loadSeq = 0;
  private photoSeq = 0;
  private available = true;
  /** A photo was taken since the last load: select the newest on the next one. */
  private fresh = false;
  private readonly offBadges: () => void;

  constructor(
    private readonly store: IdbPhotoStore,
    private readonly onClick: () => void = () => undefined,
  ) {
    const quality = segmented<PhotoQuality>(
      'Fotoğraf kalitesi',
      (Object.keys(PHOTO_QUALITY) as PhotoQuality[]).map((q) => ({ value: q, label: PHOTO_QUALITY[q].label })),
      photoQuality(),
      (q) => setPhotoQuality(q),
    );
    this.gridView = el('div', 'album-grid-view', [
      el('header', 'album-head', [
        el('div', 'album-title', [el('p', 'menu-heading album-heading', 'Albüm'), this.count]),
        el('div', 'album-badges', [this.badgeText, this.badgeDots], { title: 'Güneş doğarken ya da batarken simge yerlerin fotoğrafını çek' }),
      ]),
      this.gridBody,
      el('footer', 'album-foot', [
        el('div', 'album-keys', [keyHint('Enter', 'Aç').root, keyHint('Del', 'Sil').root, keyHint('O', 'Uçarken fotoğraf modu').root]),
        el('div', 'album-quality', [el('span', 'album-quality-label', 'Kalite'), quality.root]),
      ]),
    ]);

    this.download = prompt('İndir', 'Enter', 'primary', () => this.downloadCurrent());
    this.actions = el('div', 'album-actions', [
      this.download.root,
      prompt('Sil', 'Del', 'danger', () => this.askDelete()).root,
      prompt('Geri', 'Esc', 'secondary', () => this.back()).root,
      this.position,
    ]);
    this.confirm = el('div', 'album-actions album-confirm', [
      el('span', 'album-confirm-text', 'Bu fotoğraf silinsin mi? Geri alınamaz.'),
      prompt('Sil', 'Enter', 'danger', () => void this.deleteCurrent()).root,
      prompt('Vazgeç', 'Esc', 'secondary', () => this.back()).root,
    ]);
    this.confirm.hidden = true;
    const stage = el('div', 'album-stage', [this.photo]);
    stage.addEventListener('click', (e) => {
      const r = stage.getBoundingClientRect();
      this.step(e.clientX < r.left + r.width / 2 ? -1 : 1);
    });
    this.detailView = el('div', 'album-detail', [
      stage,
      el('div', 'album-meta', [el('div', 'album-meta-text', [this.caption, this.subline, this.badgeLine])]),
      this.actions,
      this.confirm,
    ]);
    this.detailView.hidden = true;
    this.root = el('div', 'album', [this.gridView, this.detailView]);
    this.renderBadges();
    this.offBadges = onBadgesChange(() => this.renderBadges());
  }

  /** A photo was saved or deleted elsewhere: reload on the next opening. */
  invalidate(): void {
    this.dirty = true;
    this.fresh = true;
    if (this.isOpen) {
      this.reloadNow();
    }
  }

  private reloadNow(): void {
    const prefer = this.fresh ? 0 : undefined;
    this.fresh = false;
    void this.reload(prefer);
  }

  opened(): void {
    this.isOpen = true;
    this.renderBadges();
    if (this.dirty) {
      this.reloadNow();
    }
  }

  closed(): void {
    this.isOpen = false;
    this.showGrid();
  }

  dispose(): void {
    this.offBadges();
    this.revokeThumbs();
    this.setPhotoUrl('');
  }

  /** Esc: confirmation → detail → grid; false in the grid (the menu closes). */
  back(): boolean {
    if (this.view === 'confirm') {
      this.setView('detail');
      return true;
    }
    if (this.view === 'detail') {
      this.showGrid();
      return true;
    }
    return false;
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) {
      return false;
    }
    const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
    if (this.view === 'confirm') {
      if (enter && !e.repeat) {
        void this.deleteCurrent();
        return true;
      }
      return enter;
    }
    if (this.view === 'detail') {
      if (enter && !e.repeat) {
        this.downloadCurrent();
        return true;
      }
      if (e.code === 'Delete' || e.code === 'Backspace') {
        this.askDelete();
        return true;
      }
      if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') {
        this.step(-1);
        return true;
      }
      if (e.code === 'ArrowRight' || e.code === 'ArrowDown') {
        this.step(1);
        return true;
      }
      return false;
    }
    if (e.code === 'Delete' && this.grid.selected >= 0) {
      this.openDetail(this.grid.selected);
      this.askDelete();
      return true;
    }
    return this.grid.handleKey(e);
  }

  /* ---------------- data ---------------- */

  private async reload(preferIndex?: number): Promise<void> {
    const seq = ++this.loadSeq;
    this.dirty = false;
    let entries: PhotoEntry[] = [];
    try {
      entries = await this.store.entries();
      this.available = true;
    } catch {
      this.available = false;
    }
    if (seq !== this.loadSeq) {
      return;
    }
    const keepId = preferIndex === undefined ? this.entries[this.grid.selected]?.meta.id : undefined;
    this.entries = entries;
    this.revokeThumbs();
    this.thumbUrls = entries.map((e) => URL.createObjectURL(e.thumb));
    this.grid.set(
      entries.map((e, i) => {
        const place = badgePlace(e.meta.badgeId);
        return {
          src: this.thumbUrls[i],
          alt: photoCaption(e.meta),
          mark: !!place,
          markTitle: place ? `Altın saat · ${place.name}` : undefined,
        };
      }),
    );
    const keep = keepId ? entries.findIndex((e) => e.meta.id === keepId) : -1;
    if (entries.length > 0) {
      this.grid.select(keep >= 0 ? keep : (preferIndex ?? 0), false);
    }
    const bytes = entries.reduce((s, e) => s + (e.meta.bytes || 0), 0);
    this.count.textContent = entries.length > 0 ? `${entries.length} fotoğraf · ${formatMb(bytes)}` : '';
    if (!this.available || entries.length === 0) {
      this.empty.replaceChildren(...(this.available ? keyText(EMPTY_TEXT) : [UNAVAILABLE_TEXT]));
      this.gridBody.replaceChildren(this.empty);
    } else {
      this.gridBody.replaceChildren(this.grid.root);
    }
    if (this.view !== 'grid') {
      this.showGrid();
    }
  }

  private renderBadges(): void {
    const earned = earnedBadges();
    const got = GOLDEN_HOUR_PLACES.filter((p) => earned[p.id]).length;
    this.badgeText.textContent = `Altın saat ${got}/${GOLDEN_HOUR_PLACES.length}`;
    this.badgeDots.replaceChildren(
      ...GOLDEN_HOUR_PLACES.map((p) => el('i', earned[p.id] ? 'album-badge-dot is-earned' : 'album-badge-dot', undefined, { title: p.name })),
    );
  }

  /* ---------------- views ---------------- */

  private setView(view: View): void {
    this.view = view;
    this.gridView.hidden = view !== 'grid';
    this.detailView.hidden = view === 'grid';
    this.actions.hidden = view !== 'detail';
    this.confirm.hidden = view !== 'confirm';
  }

  private showGrid(): void {
    this.setView('grid');
    this.setPhotoUrl('');
    if (this.current >= 0 && this.current < this.entries.length) {
      this.grid.select(this.current);
    }
  }

  private openDetail(i: number): void {
    if (i < 0 || i >= this.entries.length) {
      return;
    }
    this.onClick();
    this.current = i;
    this.setView('detail');
    void this.showPhoto(i);
  }

  private step(d: number): void {
    if (this.view !== 'detail' || this.entries.length === 0) {
      return;
    }
    const next = Math.min(this.entries.length - 1, Math.max(0, this.current + d));
    if (next !== this.current) {
      this.current = next;
      void this.showPhoto(next);
    }
  }

  private async showPhoto(i: number): Promise<void> {
    const entry = this.entries[i];
    const meta = entry.meta;
    this.caption.textContent = photoCaption(meta);
    this.subline.textContent = photoSubline(meta);
    const place = badgePlace(meta.badgeId);
    this.badgeLine.textContent = place ? `Altın saat · ${place.name}` : '';
    this.badgeLine.hidden = !place;
    this.position.textContent = this.entries.length > 1 ? `${i + 1}/${this.entries.length}` : '';
    this.photo.alt = photoCaption(meta);
    // The thumbnail first, the full image as soon as it is read.
    this.photo.src = this.thumbUrls[i] ?? '';
    const seq = ++this.photoSeq;
    let blob: Blob | null = null;
    try {
      blob = await this.store.image(meta.id);
    } catch {
      blob = null;
    }
    if (seq !== this.photoSeq || this.current !== i || this.view === 'grid') {
      return;
    }
    this.download.setDisabled(!blob, blob ? undefined : 'Fotoğraf okunamadı');
    if (blob) {
      this.setPhotoUrl(URL.createObjectURL(blob));
      this.photo.src = this.photoUrl;
    }
  }

  private askDelete(): void {
    if (this.view === 'detail') {
      this.setView('confirm');
    }
  }

  private async deleteCurrent(): Promise<void> {
    const entry = this.entries[this.current];
    if (!entry) {
      return;
    }
    this.onClick();
    try {
      await this.store.remove(entry.meta.id);
    } catch {
      /* stays in the album; the reload shows the truth */
    }
    const prefer = Math.max(0, Math.min(this.current, this.entries.length - 2));
    this.current = -1;
    this.showGrid();
    await this.reload(prefer);
  }

  private downloadCurrent(): void {
    const entry = this.entries[this.current];
    if (!entry || !this.photoUrl) {
      return;
    }
    this.onClick();
    const a = el('a', undefined, undefined, { href: this.photoUrl, download: photoFileName(entry.meta.place, entry.meta.takenAt, entry.meta.mime) });
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
  }

  private setPhotoUrl(url: string): void {
    if (this.photoUrl) {
      URL.revokeObjectURL(this.photoUrl);
    }
    this.photoUrl = url;
    if (!url) {
      this.photo.removeAttribute('src');
    }
  }

  private revokeThumbs(): void {
    for (const u of this.thumbUrls) {
      URL.revokeObjectURL(u);
    }
    this.thumbUrls = [];
  }
}
