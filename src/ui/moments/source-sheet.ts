/**
 * Source sheet ("[I] Kaynağa bak" during and right after a moment): a centred sheet over the paused game with the
 * moment's excerpt, card and sources (MomentSourceDetail). It stops the game, so it is a sheet (design language §1);
 * the UI system owns it as a modal: Esc (or I) closes it and resumes, the scrim closes it too.
 */
import type { Moment } from '../../moments/types';
import { prompt } from '../components';
import { el } from '../dom';
import { MomentSourceDetail } from './source-detail';

export interface SourceSheetOptions {
  onClose(): void;
  onClick?(): void;
}

export class SourceSheet {
  readonly root: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly detail = new MomentSourceDetail();
  private isOpen = false;

  constructor(private readonly options: SourceSheetOptions) {
    const close = prompt('Kapat', 'Esc', 'secondary', () => {
      this.options.onClick?.();
      this.options.onClose();
    });
    this.sheet = el(
      'div',
      'msrc-sheet',
      [
        el('header', 'msrc-top', [el('span', 'msrc-state', 'Kaynak · oyun duraklatıldı'), close.root]),
        el('div', 'msrc-body', [this.detail.root]),
      ],
      { tabindex: '-1' },
    );
    this.root = el('section', 'ejd-menu ejd-interactive msrc-scrim', [this.sheet], { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Anın kaynakları' });
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) {
        this.options.onClose();
      }
    });
  }

  get opened(): boolean {
    return this.isOpen;
  }

  open(moment: Moment): void {
    this.isOpen = true;
    this.detail.show(moment);
    this.root.hidden = false;
    requestAnimationFrame(() => this.sheet.focus({ preventScroll: true }));
  }

  close(): void {
    this.isOpen = false;
    this.root.hidden = true;
    // No embed outlives the sheet: the video stops and nothing more is requested.
    this.detail.clear();
  }

  /** Keys while open, except Esc (the UI closes the sheet): digits open the listed links. */
  handleKey(e: KeyboardEvent): boolean {
    return this.isOpen && this.detail.handleKey(e);
  }
}
