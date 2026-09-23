import { el, TextSlot } from '../dom';
import { ICONS } from '../icons';

export type MenuTab = 'settings' | 'teleport' | 'controls';

export interface PauseMenuOptions {
  panels: Record<MenuTab, HTMLElement>;
  onResume(): void;
  onTabOpen?(tab: MenuTab): void;
  onClick?(): void;
}

const TAB_TITLES: Record<MenuTab, string> = {
  settings: 'Ayarlar',
  teleport: 'Işınlan',
  controls: 'Kontroller',
};
const TAB_ICONS: Record<MenuTab, string> = {
  settings: ICONS.sliders,
  teleport: ICONS.pin,
  controls: ICONS.keyboard,
};

/** Pause menu (Esc / P): resume, settings, teleport destinations and controls. */
export class PauseMenu {
  readonly root: HTMLElement;
  private readonly title: TextSlot;
  private readonly body: HTMLElement;
  private readonly navButtons = new Map<MenuTab, HTMLButtonElement>();
  private readonly resumeButton: HTMLButtonElement;
  private readonly progressText: TextSlot;
  private readonly progressFill: HTMLElement;
  private tab: MenuTab = 'settings';
  private isOpen = false;

  constructor(private readonly options: PauseMenuOptions) {
    this.resumeButton = el('button', 'nav-item nav-resume', undefined, { type: 'button' });
    this.resumeButton.innerHTML = `<span class="nav-icon">${ICONS.play}</span><span class="nav-label">Devam</span><kbd>Esc</kbd>`;
    this.resumeButton.addEventListener('click', () => {
      this.options.onClick?.();
      this.options.onResume();
    });

    const navItems = (Object.keys(TAB_TITLES) as MenuTab[]).map((tab) => {
      const button = el('button', 'nav-item', undefined, { type: 'button', 'aria-controls': 'ejd-menu-body' });
      button.innerHTML = `<span class="nav-icon">${TAB_ICONS[tab]}</span><span class="nav-label">${TAB_TITLES[tab]}</span>`;
      button.addEventListener('click', () => {
        this.options.onClick?.();
        this.show(tab);
      });
      this.navButtons.set(tab, button);
      return button;
    });

    const progressTextNode = el('span', 'menu-progress-val ejd-num', '0/0');
    this.progressText = new TextSlot(progressTextNode);
    this.progressFill = el('i', 'menu-progress-fill');

    const titleNode = el('h2', 'menu-title', TAB_TITLES.settings);
    this.title = new TextSlot(titleNode);
    this.body = el('div', 'menu-scroll', undefined, { id: 'ejd-menu-body' });

    const sheet = el('div', 'menu-sheet ejd-glass', [
      el('nav', 'menu-nav', [
        el('div', 'menu-brand', [el('p', 'ejd-caps menu-state', 'Duraklatıldı'), el('p', 'menu-name', 'Evren')]),
        this.resumeButton,
        el('i', 'nav-sep'),
        ...navItems,
        el('div', 'menu-progress', [
          el('div', 'menu-progress-row', [el('span', 'menu-progress-label', 'Keşfedilen simge yapılar'), progressTextNode]),
          el('div', 'menu-progress-track', [this.progressFill]),
        ]),
      ]),
      el('div', 'menu-body', [el('header', 'menu-head', [titleNode]), this.body]),
    ]);
    this.root = el('section', 'ejd-menu ejd-interactive', [sheet], { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Duraklatma menüsü' });
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) {
        this.options.onResume();
      }
    });
  }

  get opened(): boolean {
    return this.isOpen;
  }

  setProgress(count: number, total: number): void {
    this.progressText.set(`${count}/${total}`);
    this.progressFill.style.transform = `scaleX(${total > 0 ? (count / total).toFixed(3) : '0'})`;
  }

  open(tab: MenuTab = this.tab): void {
    this.isOpen = true;
    this.root.hidden = false;
    this.show(tab);
    requestAnimationFrame(() => this.resumeButton.focus({ preventScroll: true }));
  }

  close(): void {
    this.isOpen = false;
    this.root.hidden = true;
  }

  show(tab: MenuTab): void {
    this.tab = tab;
    this.title.set(TAB_TITLES[tab]);
    for (const [key, button] of this.navButtons) {
      button.classList.toggle('is-on', key === tab);
      button.setAttribute('aria-current', key === tab ? 'page' : 'false');
    }
    const panel = this.options.panels[tab];
    if (this.body.firstChild !== panel) {
      this.body.replaceChildren(panel);
      this.body.scrollTop = 0;
    }
    this.options.onTabOpen?.(tab);
  }
}
