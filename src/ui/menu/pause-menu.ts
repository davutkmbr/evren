import { interactive, prompt, stat } from '../components';
import { BRAND } from '../brand';
import { el } from '../dom';

export type MenuTab = 'teleport' | 'controls' | 'settings';

/** A tab's content. `handleKey` gets the keys the menu does not use itself (Esc / P close it). */
export interface MenuPanel {
  readonly root: HTMLElement;
  handleKey?(e: KeyboardEvent): boolean;
}

export interface PauseMenuOptions {
  panels: Record<MenuTab, MenuPanel>;
  onResume(): void;
  onTabOpen?(tab: MenuTab): void;
  onTabClose?(tab: MenuTab): void;
  onClick?(): void;
}

const TABS: ReadonlyArray<{ id: MenuTab; title: string }> = [
  { id: 'teleport', title: 'Işınlan' },
  { id: 'controls', title: 'Kontroller' },
  { id: 'settings', title: 'Ayarlar' },
];

/**
 * Pause menu (Esc / P): a top bar (state, the three tabs, discovery progress, Devam) over one tab's content:
 * Işınlan (map + places), Kontroller (key groups + keyboard) or Ayarlar (settings pages).
 */
export class PauseMenu {
  readonly root: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabButtons = new Map<MenuTab, HTMLButtonElement>();
  private readonly progress = stat('Keşifler', '0/0');
  private progressLast = '0/0';
  private readonly progressFill: HTMLElement;
  private tab: MenuTab = 'teleport';
  private isOpen = false;

  constructor(private readonly options: PauseMenuOptions) {
    const resume = prompt('Devam', 'Esc', 'primary', () => {
      this.options.onClick?.();
      this.options.onResume();
    });
    resume.root.classList.add('menu-resume');

    const tablist = el(
      'div',
      'menu-tabs',
      TABS.map((t) => {
        const button = interactive(
          el('button', 'menu-tab', t.title, { type: 'button', role: 'tab', 'aria-selected': 'false', 'aria-controls': 'ejd-menu-body' }),
          'segment',
        );
        button.addEventListener('click', () => {
          this.options.onClick?.();
          this.show(t.id);
        });
        this.tabButtons.set(t.id, button);
        return button;
      }),
      { role: 'tablist', 'aria-label': 'Menü bölümleri' },
    );
    tablist.addEventListener('keydown', (e) => {
      if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const i = TABS.findIndex((t) => t.id === this.tab);
      const next = TABS[(i + (e.code === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id;
      this.show(next);
      this.tabButtons.get(next)?.focus();
    });

    this.progressFill = el('i', 'menu-progress-fill');

    this.body = el('div', 'menu-body', undefined, { id: 'ejd-menu-body', role: 'tabpanel' });
    this.sheet = el(
      'div',
      'menu-sheet',
      [
        el('header', 'menu-top', [
          el('div', 'menu-brand', [el('span', 'menu-state', 'Duraklatıldı'), el('span', 'menu-name', BRAND.name, { lang: 'en' })]),
          el('nav', 'menu-tabs-wrap', [tablist], { 'aria-label': 'Menü bölümleri' }),
          el('div', 'menu-top-end', [
            el('div', 'menu-progress', [
              this.progress.root,
              el('div', 'menu-progress-track', [this.progressFill]),
            ], { title: 'Keşfedilen simge yapılar' }),
            resume.root,
          ]),
        ]),
        this.body,
      ],
      { tabindex: '-1' },
    );
    this.root = el('section', 'ejd-menu ejd-interactive', [this.sheet], { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Duraklatma menüsü' });
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
    const text = `${count}/${total}`;
    if (text !== this.progressLast) {
      this.progressLast = text;
      this.progress.set(text);
    }
    this.progressFill.style.transform = `scaleX(${total > 0 ? (count / total).toFixed(3) : '0'})`;
  }

  open(tab: MenuTab = this.tab): void {
    this.isOpen = true;
    this.root.hidden = false;
    this.show(tab);
    // focus the sheet itself: Enter and the arrow keys then go to the tab (Enter on a focused Devam would resume)
    requestAnimationFrame(() => this.sheet.focus({ preventScroll: true }));
  }

  close(): void {
    if (this.isOpen) {
      this.options.onTabClose?.(this.tab);
    }
    this.isOpen = false;
    this.root.hidden = true;
  }

  show(tab: MenuTab): void {
    if (tab !== this.tab && this.isOpen) {
      this.options.onTabClose?.(this.tab);
    }
    this.tab = tab;
    for (const [key, button] of this.tabButtons) {
      const on = key === tab;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
    }
    const panel = this.options.panels[tab].root;
    if (this.body.firstChild !== panel) {
      this.body.replaceChildren(panel);
    }
    this.options.onTabOpen?.(tab);
  }

  /** Keys while open (after Esc / P, which close it): passed to the open tab. */
  handleKey(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement | null;
    if (!this.isOpen || target?.closest('.menu-top')) {
      return false;
    }
    return this.options.panels[this.tab].handleKey?.(e) ?? false;
  }
}
