import { el } from '../dom';
import { ControlsView } from '../menu/controls-panel';

/** Non-modal controls reference (H). The game keeps running underneath. */
export class HelpOverlay {
  readonly root: HTMLElement;
  private isOpen = false;

  constructor(onClose: () => void) {
    const close = el('button', 'help-close', undefined, { type: 'button', 'aria-label': 'Yardımı kapat' });
    close.innerHTML = `<span>Kapat</span><kbd>H</kbd>`;
    close.addEventListener('click', onClose);
    this.root = el('section', 'ejd-help ejd-glass ejd-fade is-out', [
      el('header', 'help-head', [el('div', undefined, [el('p', 'ejd-caps', 'Yardım'), el('h2', 'help-title', 'Kontroller')]), close]),
      new ControlsView({ compact: true }).root,
      el('p', 'help-foot', 'Bir simge yapıya yaklaşık 800 metre yaklaşıp ona yöneldiğinde keşfedilir. Oyun kolu da desteklenir.'),
    ], { role: 'dialog', 'aria-label': 'Kontroller' });
  }

  get opened(): boolean {
    return this.isOpen;
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.root.classList.toggle('is-out', !open);
    this.root.classList.toggle('ejd-interactive', open);
    this.root.parentElement?.classList.toggle('is-help', open);
  }
}
