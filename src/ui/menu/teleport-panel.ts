import { VIEW_PRESETS, type ViewPreset } from '../../core/debug';
import { el } from '../dom';
import { formatClock, formatInt } from '../format';

/** Işınlan: the named view presets as a grid of destinations. */
export class TeleportPanel {
  readonly root: HTMLElement;

  constructor(onPick: (name: string, preset: ViewPreset) => void) {
    const items = Object.entries(VIEW_PRESETS).map(([name, preset]) => {
      const meta = [`${formatInt(preset.y)} m`];
      if (preset.time !== undefined) {
        meta.push(formatClock(preset.time));
      }
      const button = el('button', 'tp-item', [el('span', 'tp-name', preset.label), el('span', 'tp-meta ejd-num', meta.join(' · '))], {
        type: 'button',
      });
      button.addEventListener('click', () => onPick(name, preset));
      return button;
    });
    this.root = el('div', 'menu-teleport', [
      el('p', 'menu-lede', 'Bir noktayı seç; ejderha oraya, belirtilen irtifada ışınlanır. Haritadan (M) istediğin yere de ışınlanabilirsin.'),
      el('div', 'tp-grid', items),
    ]);
  }
}
