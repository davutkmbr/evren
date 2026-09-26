import { el } from '../dom';
import { interactive } from './interaction';

export interface ThumbItem {
  /** Image URL (an object URL of a stored thumbnail). */
  src: string;
  /** Accessible name, e.g. the photo's caption. */
  alt: string;
  /** A small gold mark in the corner (e.g. a golden-hour badge). */
  mark?: boolean;
  /** Tooltip for the mark. */
  markTitle?: string;
}

export interface ThumbGridOptions {
  /** Accessible name of the grid. */
  label: string;
  /** Selection changed (pointer or keys). */
  onSelect?(index: number): void;
  /** A cell was opened: click, Enter or Space. */
  onOpen?(index: number): void;
}

export interface ThumbGrid {
  readonly root: HTMLElement;
  set(items: readonly ThumbItem[]): void;
  select(index: number, scroll?: boolean): void;
  readonly selected: number;
  readonly size: number;
  /** Arrow keys, Home / End, Enter / Space; true when the key was used. */
  handleKey(e: KeyboardEvent): boolean;
}

/**
 * A grid of image thumbnails (16:9 cells, as many columns as fit). The selection is a gold bar under the cell and the
 * selected surface; a cell can carry a small gold corner mark. Arrow keys move in two dimensions, Enter / Space open.
 * Cells take no keyboard focus of their own: the screen routes its keys to `handleKey`.
 */
export function thumbGrid(options: ThumbGridOptions): ThumbGrid {
  const root = el('div', 'ui-thumbs', undefined, { role: 'listbox', 'aria-label': options.label });
  let cells: HTMLButtonElement[] = [];
  let selected = -1;

  const columns = (): number => {
    if (cells.length < 2) {
      return 1;
    }
    const top = cells[0].offsetTop;
    let n = 0;
    while (n < cells.length && cells[n].offsetTop === top) {
      n++;
    }
    return Math.max(1, n);
  };

  const select = (index: number, scroll = true): void => {
    if (cells.length === 0) {
      selected = -1;
      return;
    }
    const next = Math.min(cells.length - 1, Math.max(0, index));
    if (selected >= 0 && cells[selected]) {
      cells[selected].classList.remove('is-selected');
      cells[selected].setAttribute('aria-selected', 'false');
    }
    selected = next;
    cells[next].classList.add('is-selected');
    cells[next].setAttribute('aria-selected', 'true');
    if (scroll) {
      cells[next].scrollIntoView({ block: 'nearest' });
    }
    options.onSelect?.(next);
  };

  const set = (items: readonly ThumbItem[]): void => {
    cells = items.map((item, i) => {
      const img = el('img', 'ui-thumb-img', undefined, { src: item.src, alt: item.alt, loading: 'lazy', decoding: 'async', draggable: 'false' });
      const mark = item.mark ? el('i', 'ui-thumb-mark', undefined, { title: item.markTitle }) : null;
      const cell = interactive(
        el('button', 'ui-thumb', [img, mark, el('i', 'ui-thumb-bar')], { type: 'button', role: 'option', tabindex: -1, 'aria-selected': 'false', title: item.alt }),
        'surface',
      );
      cell.addEventListener('mousedown', (e) => e.preventDefault());
      cell.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (selected === i) {
          options.onOpen?.(i);
        } else {
          select(i, false);
        }
      });
      cell.addEventListener('dblclick', (e) => {
        e.preventDefault();
        options.onOpen?.(i);
      });
      return cell;
    });
    root.replaceChildren(...cells);
    const keep = selected;
    selected = -1;
    if (cells.length > 0) {
      select(keep >= 0 ? keep : 0, false);
    }
  };

  const handleKey = (e: KeyboardEvent): boolean => {
    if (cells.length === 0) {
      return false;
    }
    const cols = columns();
    switch (e.code) {
      case 'ArrowLeft':
        select(selected - 1);
        return true;
      case 'ArrowRight':
        select(selected + 1);
        return true;
      case 'ArrowUp':
        select(selected - cols >= 0 ? selected - cols : selected);
        return true;
      case 'ArrowDown':
        select(selected + cols < cells.length ? selected + cols : selected);
        return true;
      case 'Home':
        select(0);
        return true;
      case 'End':
        select(cells.length - 1);
        return true;
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        if (!e.repeat && selected >= 0) {
          options.onOpen?.(selected);
        }
        return true;
      default:
        return false;
    }
  };

  return {
    root,
    set,
    select,
    get selected() {
      return selected;
    },
    get size() {
      return cells.length;
    },
    handleKey,
  };
}
