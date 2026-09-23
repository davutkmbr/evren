import { el } from '../dom';

function hintRow(items: Array<[keys: string[], label: string]>): HTMLElement {
  return el(
    'ul',
    'hint-row',
    items.map(([keys, label]) => el('li', 'hint-item', [...keys.map((k) => el('kbd', undefined, k)), el('span', 'hint-label', label)])),
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

/** Photo mode caption with the free-camera controls; fades to a whisper after a few seconds. */
export class PhotoHint {
  readonly root = el('div', 'ejd-photo-hint ejd-fade is-out', [
    el('p', 'ejd-caps photo-caps', 'Fotoğraf modu'),
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
