import { keyText } from '../components';
import { el } from '../dom';
import { fadeBinding, hintRow, HUD_PRIORITY, ZONE_CLASS, type HudDirector } from '../zones';

/** Start-of-game key reminder: an item of the shared hint line, shown once nothing more important is on it. */
export class FlightHints {
  static readonly ID = 'hints.start';

  constructor(private readonly zones: HudDirector) {}

  show(durationMs: number): void {
    this.zones.request({
      id: FlightHints.ID,
      zone: 'lowerCenter',
      priority: HUD_PRIORITY.startHint,
      duration: durationMs / 1000,
      // Waits out a race countdown or a burst of captions; after half a minute it is no longer "the start".
      maxWait: 30,
      hints: [
        ['M', 'Harita'],
        ['H', 'Yardım'],
        ['O', 'Fotoğraf'],
        ['Esc', 'Menü'],
      ],
    });
  }

  hide(): void {
    this.zones.release(FlightHints.ID);
  }
}

/**
 * Hover controls (lowerCenter, growing upwards), shown on entering a hover: full length for the first few hovers of a
 * session, then briefly.
 */
export class HoverHints {
  static readonly ID = 'hints.hover';
  readonly root = el('div', `${ZONE_CLASS.lowerCenter} hud-hints hud-hints-hover`, [
    el('p', 'hint-caps', 'Havada asılı'),
    // Two short rows: one long row would crowd the bottom-centre cluster on narrower screens.
    el('div', 'hint-panel', [
      hintRow([
        ['Ctrl + W / S', 'Yavaşça ileri, geri'],
        ['A / D', 'Dön'],
      ]),
      hintRow([
        ['Space', 'Yüksel'],
        ['Shift', 'Alçal'],
        ['L', 'Kon'],
      ]),
    ]),
    el('p', 'hint-exit', keyText('Uçuşa dönmek için freni bırak, [W] tuşuna bas')),
  ]);
  private readonly binding = fadeBinding(this.root);
  private shown = 0;

  constructor(private readonly zones: HudDirector) {}

  show(): void {
    this.shown++;
    this.zones.request({
      id: HoverHints.ID,
      zone: 'lowerCenter',
      priority: HUD_PRIORITY.flightHint,
      duration: this.shown <= 3 ? 9 : 4.5,
      maxWait: 4,
      ...this.binding,
    });
  }

  hide(): void {
    this.zones.release(HoverHints.ID);
  }
}

/** Subtle caption of the running cinematic shot (a landmark's name, or the kind of shot); fades after a few seconds. */
export class ShotCaption {
  static readonly ID = 'caption.shot';
  private readonly label = el('span', 'shot-label');
  readonly root = el('div', `${ZONE_CLASS.lowerCenter} hud-shot`, [el('span', 'shot-caps', 'Sinematik'), this.label], { 'aria-live': 'polite' });
  private readonly binding = fadeBinding(this.root);
  private current = '';

  constructor(private readonly zones: HudDirector) {}

  /** Called every frame with the camera's shot label ('' outside cinematic mode). */
  update(label: string): void {
    if (label === this.current) {
      return;
    }
    this.current = label;
    if (!label) {
      this.zones.release(ShotCaption.ID);
      return;
    }
    this.label.textContent = label;
    this.zones.request({ id: ShotCaption.ID, zone: 'lowerCenter', priority: HUD_PRIORITY.flightHint, duration: 4.2, maxWait: 2, ...this.binding });
  }
}

/** Photo mode caption with the free-camera controls; fades to a whisper after a few seconds (HUD hidden: no zone). */
export class PhotoHint {
  readonly root = el('div', 'ejd-photo-hint ejd-fade is-out', [
    el('p', 'photo-caps', 'Fotoğraf modu'),
    hintRow([
      ['W / A / S / D', 'Hareket'],
      ['Q / E', 'Alçal, yüksel'],
      ['Shift', 'Hızlı'],
      ['Sağ tık', 'Bak'],
      ['Tekerlek', 'Odak uzaklığı'],
      ['Enter', 'Çek'],
      ['O', 'Çık'],
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
