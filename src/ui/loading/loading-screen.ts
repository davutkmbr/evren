import type { AccountService, NetService } from '../../core/contracts';
import { keyHint, prompt } from '../components';
import { el, setVisible, TextSlot } from '../dom';
import { LOADING_TIPS, loadingLabel } from '../labels';
import { SkylineBackdrop } from './skyline-backdrop';
import { BRAND } from '../brand';
import { titleLogoSvg } from '../brand-logo';
import { OnlinePanel, RESUME_KEY } from './online-panel';

export interface LoadingScreenOptions {
  /** Screenshot/debug runs: remove the screen as soon as loading is done, no start prompt. */
  autoStart: boolean;
  onStart(): void;
  /** Online play, when the game runs with its API (seventeenskies.com, wrangler dev); null hides "Online uç". */
  online?(): { account: AccountService; net: NetService } | null;
}

const percentFormat = new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: 0 });
const TIP_INTERVAL_MS = 6500;

/**
 * Full-screen loading screen with the animated skyline, per-system progress and the start prompts: "[Enter] Tek
 * başına uç" (Enter, Space or a click anywhere) and "[O] Online uç", which opens the online sheet (OnlinePanel) in
 * their place.
 */
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
  private readonly onlineCta: HTMLButtonElement;
  private online: OnlinePanel | null = null;
  private tipIndex = 0;
  private tipTimer = 0;
  private shownProgress = 0;
  private state: 'loading' | 'ready' | 'gone' = 'loading';
  private readonly onKey = (e: KeyboardEvent): void => {
    if (this.state !== 'ready') {
      return;
    }
    if (this.online) {
      if (this.online.handleKey(e)) {
        e.preventDefault();
      }
      return;
    }
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') {
      e.preventDefault();
      this.start();
    } else if (e.code === 'KeyO' && !this.onlineCta.hidden) {
      e.preventDefault();
      this.openOnline();
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

    this.cta = prompt('Tek başına uç', 'Enter', 'primary', () => this.start()).root;
    this.cta.classList.add('ld-cta');
    this.onlineCta = prompt('Online uç', 'O', 'secondary', () => this.openOnline()).root;
    this.onlineCta.classList.add('ld-cta', 'ld-cta-online');
    this.onlineCta.hidden = true;

    const hint = (keys: string, action: string): HTMLElement => el('li', 'ld-key', [keyHint(keys, action).root]);
    this.startBlock = el('div', 'ld-start ejd-fade is-out', [
      el('div', 'ld-choices', [this.cta, this.onlineCta]),
      el('ul', 'ld-keys', [
        hint('W / A / S / D', 'Yönlendir'),
        hint('Space', 'Kanat çırp'),
        hint('Shift', 'Dalış'),
        hint('C', 'Kamera'),
        hint('H', 'Yardım'),
      ]),
    ]);

    this.root = el('section', 'ejd-loading ejd-interactive', [
      this.backdrop.canvas,
      el('div', 'ld-scrim'),
      this.title(),
      this.progressBlock,
      this.startBlock,
      el('p', 'ld-credit', [
        'Şehir, gökyüzü, yaratıklar ve sesler tarayıcıda, kodla üretilir.',
        el('br'),
        'Harita verisi © OpenStreetMap katkıcıları (ODbL) · Yükseklik: NASA SRTM',
        el('br'),
        'Bina tabanları: Microsoft · Kat bilgisi: İBB Açık Veri, GHSL',
      ]),
    ], { 'aria-label': `${BRAND.name} yükleniyor` });
    this.root.addEventListener('click', () => {
      if (!this.online) {
        this.start();
      }
    });
    parent.append(this.root);
    this.backdrop.start();
    this.tipTimer = window.setInterval(() => this.nextTip(), TIP_INTERVAL_MS);
    window.addEventListener('keydown', this.onKey);
  }

  /** The title logo (drawn as SVG, see brand-logo.ts) with the brand line under it. */
  private title(): HTMLElement {
    const logo = el('h1', 'ld-logo', undefined, { lang: 'en', 'aria-label': BRAND.name });
    logo.innerHTML = titleLogoSvg({ id: 'ld-logo' });
    return el('header', 'ld-title', [logo, el('p', 'ld-sub', BRAND.lineTr)]);
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
    this.onlineCta.hidden = !this.options.online?.();
    let resume = false;
    try {
      resume = sessionStorage.getItem(RESUME_KEY) === '1';
      sessionStorage.removeItem(RESUME_KEY);
    } catch {
      resume = false;
    }
    if (resume) {
      this.openOnline();
    }
  }

  /** The online sheet in place of the start prompts. */
  private openOnline(): void {
    const services = this.options.online?.();
    if (this.state !== 'ready' || this.online || !services) {
      return;
    }
    const panel = new OnlinePanel({
      ...services,
      onStart: () => this.start(),
      onBack: () => this.closeOnline(),
    });
    this.online = panel;
    this.startBlock.classList.add('is-out');
    this.root.classList.add('is-online');
    this.root.append(panel.root);
    void panel.open();
  }

  private closeOnline(): void {
    const panel = this.online;
    if (!panel) {
      return;
    }
    this.online = null;
    panel.dispose();
    panel.root.remove();
    this.root.classList.remove('is-online');
    this.startBlock.classList.remove('is-out');
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
    this.online?.dispose();
    this.online = null;
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
