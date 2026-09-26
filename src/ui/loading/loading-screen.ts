import { el, setVisible, TextSlot } from '../dom';
import { LOADING_TIPS, loadingLabel } from '../labels';
import { SkylineBackdrop } from './skyline-backdrop';

export interface LoadingScreenOptions {
  /** Screenshot/debug runs: remove the screen as soon as loading is done, no start prompt. */
  autoStart: boolean;
  onStart(): void;
}

const percentFormat = new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: 0 });
const TIP_INTERVAL_MS = 6500;

const MOUSE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="6.2" y="3" width="11.6" height="18" rx="5.8"/><path d="M12 3v6.4"/><path d="M6.4 9.4H12V3.2A5.8 5.8 0 0 0 6.4 8.6Z" fill="currentColor" stroke="none" opacity="0.9"/></svg>`;

/** Full-screen loading screen with the animated skyline, per-system progress and the "click to fly" prompt. */
export class LoadingScreen {
  readonly root: HTMLElement;
  private readonly backdrop = new SkylineBackdrop();
  private readonly fill: HTMLElement;
  private readonly label: TextSlot;
  private readonly percent: TextSlot;
  private readonly progressBlock: HTMLElement;
  private readonly tipText: HTMLElement;
  private readonly startBlock: HTMLElement;
  private readonly cta: HTMLButtonElement;
  private tipIndex = 0;
  private tipTimer = 0;
  private shownProgress = 0;
  private state: 'loading' | 'ready' | 'gone' = 'loading';
  private readonly onKey = (e: KeyboardEvent): void => {
    if (this.state === 'ready' && (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter')) {
      e.preventDefault();
      this.start();
    }
  };

  constructor(
    parent: HTMLElement,
    private readonly options: LoadingScreenOptions,
  ) {
    this.fill = el('div', 'ld-fill');
    const labelNode = el('span', 'ld-label', loadingLabel('ui'));
    const percentNode = el('span', 'ld-pct ejd-num', percentFormat.format(0));
    this.label = new TextSlot(labelNode);
    this.percent = new TextSlot(percentNode);
    this.tipIndex = Math.floor(Math.random() * LOADING_TIPS.length);
    this.tipText = el('span', 'ld-tip-text', LOADING_TIPS[this.tipIndex]);

    this.progressBlock = el('div', 'ld-progress ejd-fade', [
      el('div', 'ld-row', [labelNode, percentNode]),
      el('div', 'ld-track', [this.fill], { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Yükleniyor' }),
      el('p', 'ld-tip', [this.tipText]),
    ]);

    this.cta = el('button', 'ld-cta', undefined, { type: 'button' });
    this.cta.innerHTML = `<span class="ld-cta-icon">${MOUSE_ICON}</span><span>Uçmak için tıkla</span>`;
    this.cta.addEventListener('click', (e) => {
      e.stopPropagation();
      this.start();
    });

    const keyHint = (keys: string[], action: string): HTMLElement =>
      el('li', 'ld-key', [...keys.map((k) => el('kbd', undefined, k)), el('span', 'ld-key-label', action)]);
    this.startBlock = el('div', 'ld-start ejd-fade is-out', [
      this.cta,
      el('ul', 'ld-keys', [
        keyHint(['W', 'A', 'S', 'D'], 'Yönlendir'),
        keyHint(['Space'], 'Kanat çırp'),
        keyHint(['Shift'], 'Dalış'),
        keyHint(['C'], 'Kamera'),
        keyHint(['H'], 'Yardım'),
      ]),
    ]);

    this.root = el('section', 'ejd-loading ejd-interactive', [
      this.backdrop.canvas,
      el('div', 'ld-scrim'),
      el('header', 'ld-title', [el('h1', 'ld-name', 'Evren'), el('p', 'ld-sub', 'İstanbul’un üstünde, bir ejderhanın sırtında')]),
      this.progressBlock,
      this.startBlock,
      el('p', 'ld-credit', [
        'Şehir, gökyüzü, ejderha ve sesler tarayıcıda, kodla üretilir.',
        el('br'),
        'Harita verisi © OpenStreetMap katkıcıları (ODbL) · Yükseklik: NASA SRTM',
      ]),
    ], { 'aria-label': 'Evren yükleniyor' });
    this.root.addEventListener('click', () => this.start());
    parent.append(this.root);
    this.backdrop.start();
    this.tipTimer = window.setInterval(() => this.nextTip(), TIP_INTERVAL_MS);
    window.addEventListener('keydown', this.onKey);
  }

  get visible(): boolean {
    return this.state !== 'gone';
  }

  setProgress(system: string, progress: number): void {
    if (this.state !== 'loading') {
      return;
    }
    this.label.set(loadingLabel(system));
    const p = Math.max(this.shownProgress, Math.min(1, progress));
    this.shownProgress = p;
    this.percent.set(percentFormat.format(p));
    this.fill.style.transform = `scaleX(${p.toFixed(4)})`;
    this.fill.parentElement?.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  }

  /** Loading finished: either vanish (auto start) or reveal the live scene behind the start prompt. */
  finish(): void {
    if (this.state !== 'loading') {
      return;
    }
    this.setProgress('ready', 1);
    if (this.options.autoStart) {
      this.remove();
      this.options.onStart();
      return;
    }
    this.state = 'ready';
    this.root.classList.add('is-ready');
    this.progressBlock.classList.add('is-out');
    this.startBlock.classList.remove('is-out');
    window.clearInterval(this.tipTimer);
    window.setTimeout(() => {
      if (this.state === 'ready') {
        this.backdrop.stop();
      }
    }, 1400);
    requestAnimationFrame(() => this.cta.focus({ preventScroll: true }));
  }

  private start(): void {
    if (this.state !== 'ready') {
      return;
    }
    this.state = 'gone';
    this.root.classList.add('is-leaving');
    this.options.onStart();
    window.setTimeout(() => this.remove(), 700);
  }

  private nextTip(): void {
    this.tipIndex = (this.tipIndex + 1) % LOADING_TIPS.length;
    const node = this.tipText;
    node.classList.add('is-swapping');
    window.setTimeout(() => {
      node.textContent = LOADING_TIPS[this.tipIndex];
      node.classList.remove('is-swapping');
    }, 280);
  }

  private remove(): void {
    this.state = 'gone';
    window.clearInterval(this.tipTimer);
    window.removeEventListener('keydown', this.onKey);
    this.backdrop.dispose();
    setVisible(this.root, false);
    this.root.remove();
  }

  dispose(): void {
    this.remove();
  }
}
