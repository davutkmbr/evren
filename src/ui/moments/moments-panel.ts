/**
 * Pause menu → Anlar: the moments seen so far (stored per viewer, src/moments/seen.ts), newest first, with their
 * excerpt, card and sources, so a moment can be revisited later. Left the list, right the detail (the shared
 * two-column sheet layout). Arrow keys move the selection, digits open the selected moment's links.
 */
import { ALL_MOMENTS } from '../../moments/data';
import { onMomentSeen, seenMomentIds } from '../../moments/seen';
import { hasSources } from '../../moments/sources';
import type { Moment, MomentCategory } from '../../moments/types';
import { keyText, listRow, type ListRow } from '../components';
import { el } from '../dom';
import type { MenuPanel } from '../menu/pause-menu';
import { MomentSourceDetail } from './source-detail';

const CATEGORY_LABEL: Record<MomentCategory, string> = {
  legend: 'Efsane',
  'city-life': 'Şehir hayatı',
  poem: 'Edebiyat',
};

const EMPTY_TEXT =
  'Henüz bir an görmedin. Anlar şehirde uçarken kendiliğinden gelir; gördüklerin burada kaynaklarıyla birlikte kalır.';

export class MomentsPanel implements MenuPanel {
  readonly root: HTMLElement;
  private readonly list = el('div', 'menu-cats msrc-cats', undefined, { role: 'listbox', 'aria-label': 'Görülen anlar' });
  private readonly pane = el('div', 'menu-pane msrc-pane');
  private readonly detail = new MomentSourceDetail();
  private moments: Moment[] = [];
  private rows: ListRow[] = [];
  private selected = -1;
  private isOpen = false;
  private dirty = true;
  private readonly off: () => void;

  constructor() {
    this.root = el('div', 'menu-split msrc-panel', [this.list, this.pane]);
    this.off = onMomentSeen(() => {
      this.dirty = true;
    });
  }

  /** The tab was opened: rebuild the list if a moment was seen since, select the newest. */
  opened(): void {
    this.isOpen = true;
    if (this.dirty || this.rows.length === 0) {
      this.rebuild();
    }
    this.select(this.selected >= 0 ? this.selected : 0);
  }

  /** The tab was left or the menu closed: embeds go away. */
  closed(): void {
    this.isOpen = false;
    this.detail.clear();
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) {
      return false;
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      if (this.moments.length > 0) {
        this.select(Math.min(this.moments.length - 1, Math.max(0, this.selected + (e.code === 'ArrowDown' ? 1 : -1))));
      }
      return true;
    }
    return this.detail.handleKey(e);
  }

  dispose(): void {
    this.off();
  }

  private rebuild(): void {
    this.dirty = false;
    const byId = new Map(ALL_MOMENTS.map((m) => [m.id, m]));
    this.moments = [...seenMomentIds()]
      .reverse()
      .map((id) => byId.get(id))
      .filter((m): m is Moment => !!m);
    this.rows = this.moments.map((m, i) => {
      const row = listRow({ label: m.title, sub: `${CATEGORY_LABEL[m.category]}${hasSources(m) ? ' · kaynaklı' : ''}` }, () => this.select(i));
      row.root.setAttribute('role', 'option');
      return row;
    });
    this.list.replaceChildren(
      el('p', 'menu-heading', 'Görülen anlar'),
      ...this.rows.map((r) => r.root),
      el('p', 'menu-cats-foot', keyText('Bir anın sırasında ve biraz sonrasında [I] ile de açılır.')),
    );
    this.selected = -1;
  }

  private select(i: number): void {
    if (this.moments.length === 0) {
      this.selected = -1;
      this.detail.clear();
      this.pane.replaceChildren(el('p', 'msrc-note msrc-empty', EMPTY_TEXT));
      return;
    }
    const next = Math.min(this.moments.length - 1, Math.max(0, i));
    this.rows.forEach((r, k) => r.setSelected(k === next));
    if (next !== this.selected || this.detail.current !== this.moments[next] || this.pane.firstChild !== this.detail.root) {
      this.selected = next;
      this.detail.show(this.moments[next]);
      this.pane.replaceChildren(this.detail.root);
      this.pane.scrollTop = 0;
    }
  }
}
