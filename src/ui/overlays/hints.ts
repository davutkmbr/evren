import { el } from '../dom';

function hintRow(items: Array<[keys: string[], label: string]>): HTMLElement {
  return el(
    'ul',
    'hint-row',
    items.map(([keys, label]) =>
      el('li', 'hint-item', [...keys.map((k) => (k === '+' ? el('span', 'hint-plus', '+') : el('kbd', undefined, k))), el('span', 'hint-label', label)]),
    ),
  );
}

/** Bottom-centre key reminder shown for a while after take-off. */
export class FlightHints {
  readonly root = el('div', 'hud-hints ejd-fade is-out', [
    hintRow([
      [['M'], 'Harita'],
      [['H'], 'Yardım'],
      [['O'], 'Fotoğraf'],
      [['Esc'], 'Menü'],
    ]),
  ]);
  private timer = 0;

  show(durationMs: number): void {
    this.root.classList.remove('is-out');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), durationMs);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.root.classList.add('is-out');
  }
}

/** Hover controls, shown on entering a hover: full length for the first few hovers of a session, then briefly. */
export class HoverHints {
  readonly root = el('div', 'hud-hints hud-hints-hover ejd-fade is-out', [
    el('p', 'hint-caps', 'Havada asılı'),
    // Two short rows: one long row would crowd the bottom-centre cluster on narrower screens.
    el('div', 'hint-panel', [
      hintRow([
        [['Ctrl', '+', 'W', 'S'], 'Yavaşça ileri, geri'],
        [['A', 'D'], 'Dön'],
      ]),
      hintRow([
        [['Space'], 'Yüksel'],
        [['Shift'], 'Alçal'],
        [['L'], 'Kon'],
      ]),
    ]),
    el('p', 'hint-exit', ['Uçuşa dönmek için freni bırak, ', el('kbd', undefined, 'W'), ' tuşuna bas']),
  ]);
  private timer = 0;
  private shown = 0;

  show(): void {
    this.shown++;
    this.root.classList.remove('is-out');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), this.shown <= 3 ? 9000 : 4500);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.root.classList.add('is-out');
  }
}

/** Subtle caption of the running cinematic shot (a landmark's name, or the kind of shot); fades after a few seconds. */
export class ShotCaption {
  private readonly label = el('span', 'shot-label');
  readonly root = el('div', 'hud-shot ejd-fade is-out', [el('span', 'shot-caps', 'Sinematik'), this.label], { 'aria-live': 'polite' });
  private current = '';
  private timer = 0;

  /** Called every frame with the camera's shot label ('' outside cinematic mode). */
  update(label: string): void {
    if (label === this.current) {
      return;
    }
    this.current = label;
    window.clearTimeout(this.timer);
    if (!label) {
      this.root.classList.add('is-out');
      return;
    }
    this.label.textContent = label;
    this.root.classList.remove('is-out');
    this.timer = window.setTimeout(() => this.root.classList.add('is-out'), 4200);
  }
}

/** Photo mode caption with the free-camera controls; fades to a whisper after a few seconds. */
export class PhotoHint {
  readonly root = el('div', 'ejd-photo-hint ejd-fade is-out', [
    el('p', 'photo-caps', 'Fotoğraf modu'),
    hintRow([
      [['W', 'A', 'S', 'D'], 'Hareket'],
      [['Q', 'E'], 'Alçal, yüksel'],
      [['Shift'], 'Hızlı'],
      [['Sağ tık'], 'Bak'],
      [['Tekerlek'], 'Odak uzaklığı'],
      [['O'], 'Çık'],
    ]),
  ]);
  private timer = 0;

  setVisible(visible: boolean): void {
    window.clearTimeout(this.timer);
    this.root.classList.toggle('is-out', !visible);
    this.root.classList.remove('is-dim');
    if (visible) {
      this.timer = window.setTimeout(() => this.root.classList.add('is-dim'), 4500);
    }
  }
}
