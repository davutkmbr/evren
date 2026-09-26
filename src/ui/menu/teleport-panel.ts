import type { PerchPoint } from '../../core/contracts';
import type { ViewPreset } from '../../core/debug';
import { el } from '../dom';
import { formatClock } from '../format';
import type { MapRaster } from '../map/map-raster';
import { PlaceMap } from './place-map';
import { buildPlaces, fold, perchView, REGIONS, type Place, type PlaceKind, type PlaceRegion } from './places';

export interface TeleportPanelOptions {
  raster: MapRaster;
  /** Işınlan: fly to the place's view (sets its time of day, if any). */
  onTeleport(view: ViewPreset): void;
  /** Oraya kon ve izle: a spot just behind and above the perch, facing its view (the player lands with L). */
  onPerch(view: ViewPreset): void;
  onOpenMap(): void;
}

type Filter = 'all' | 'perch' | PlaceRegion;

const icon = (path: string): string =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

const KIND_ICONS: Record<PlaceKind, string> = {
  tower: icon('<path d="M9 21V9l3-6 3 6v12M6 21h12M9 13h6"/>'),
  hill: icon('<path d="M2 20l7-11 4 6 3-4 6 9z"/>'),
  bridge: icon('<path d="M2 16h20M6 16V6M18 16V6M6 7c3 5 9 5 12 0M4 20h16"/>'),
  view: icon('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
};
const SEARCH_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>';

const regionTitle = (id: PlaceRegion): string => REGIONS.find((r) => r.id === id)?.title ?? '';

/**
 * Işınlan: a map card with a pin per place on the left; search, filter chips, the place list and the selected
 * place's details on the right. Enter teleports, the arrow keys move the selection, M opens the full map.
 */
export class TeleportPanel {
  readonly root: HTMLElement;
  private readonly map: PlaceMap;
  private readonly search: HTMLInputElement;
  private readonly chips: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly detailName: HTMLElement;
  private readonly detailRegion: HTMLElement;
  private readonly detailInfo: HTMLElement;
  private readonly perchButton: HTMLButtonElement;
  private places: Place[] = buildPlaces([]);
  private perchCount = 0;
  private filter: Filter = 'all';
  private selected: string | null = null;
  private hovered: string | null = null;
  private shown: Place[] = [];
  private readonly rows = new Map<string, HTMLButtonElement>();

  constructor(private readonly options: TeleportPanelOptions) {
    this.map = new PlaceMap(options.raster, {
      onPick: (id) => this.select(id, true),
      onHover: (id) => this.hover(id),
      onActivate: (id) => {
        this.select(id, true);
        this.teleport();
      },
      onOpenMap: () => options.onOpenMap(),
    });

    this.search = el('input', 'tp-search', undefined, {
      type: 'search',
      placeholder: 'Yer ara… (ör. kule, köprü, Üsküdar)',
      'aria-label': 'Yer ara',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    this.search.addEventListener('input', () => this.render());
    // Typing must never reach the game (window listeners); Esc still bubbles up and closes the menu.
    this.search.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        return;
      }
      e.stopPropagation();
      if (this.handleKey(e)) {
        e.preventDefault();
      }
    });
    const searchIcon = el('span', 'tp-search-icon');
    searchIcon.innerHTML = SEARCH_ICON;

    this.chips = el('div', 'tp-chips', undefined, { role: 'group', 'aria-label': 'Süzgeç' });
    this.list = el('div', 'tp-list', undefined, { role: 'listbox', 'aria-label': 'Yerler' });
    this.empty = el('p', 'tp-empty', 'Bu isimde bir yer yok. Haritada istediğin noktayı seçebilirsin (M).');
    this.empty.hidden = true;

    this.detailName = el('span', 'tp-detail-name');
    this.detailRegion = el('span', 'tp-detail-region');
    this.detailInfo = el('p', 'tp-detail-info');
    const go = el('button', 'tp-go', [el('span', undefined, 'Işınlan'), el('kbd', undefined, 'Enter')], { type: 'button' });
    go.addEventListener('click', () => this.teleport());
    this.perchButton = el('button', 'tp-perch', 'Oraya kon ve izle', { type: 'button' });
    this.perchButton.addEventListener('click', () => this.perch());

    this.root = el('div', 'menu-teleport', [
      el('div', 'tp-map-col', [this.map.root]),
      el('div', 'tp-side', [
        el('label', 'tp-search-wrap', [searchIcon, this.search]),
        this.chips,
        el('div', 'tp-list-wrap', [this.list, this.empty]),
        el('div', 'tp-detail', [
          el('div', 'tp-detail-head', [this.detailName, this.detailRegion]),
          this.detailInfo,
          el('div', 'tp-detail-actions', [go, this.perchButton]),
        ]),
      ]),
    ]);
    this.setPlaces(this.places);
  }

  /** Merges the perches in once the perch service exists (call when the panel opens). */
  setPerches(points: readonly PerchPoint[] | undefined): void {
    const count = points?.length ?? 0;
    if (count === this.perchCount) {
      return;
    }
    this.perchCount = count;
    this.setPlaces(buildPlaces(points ?? []));
  }

  /** The panel was opened: clear the search, start drawing the map. */
  opened(): void {
    if (this.search.value) {
      this.search.value = '';
    }
    this.render();
    this.map.setActive(true);
    requestAnimationFrame(() => this.rows.get(this.selected ?? '')?.scrollIntoView({ block: 'nearest' }));
  }

  closed(): void {
    this.map.setActive(false);
  }

  /** Enter teleports, ArrowUp / ArrowDown move the selection, M opens the full map. */
  handleKey(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement | null;
    const inSearch = target === this.search;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      // the detail buttons and the map link act on their own
      if (target?.closest('.tp-detail, .tp-map-link')) {
        return false;
      }
      this.teleport();
      return true;
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      this.step(e.code === 'ArrowDown' ? 1 : -1, !inSearch && !!target?.classList.contains('tp-row'));
      return true;
    }
    if (e.code === 'KeyM' && !inSearch && !e.repeat) {
      this.options.onOpenMap();
      return true;
    }
    return false;
  }

  private setPlaces(places: Place[]): void {
    this.places = places;
    if (!this.selected || !places.some((p) => p.id === this.selected)) {
      this.selected = places[0]?.id ?? null;
    }
    this.map.setPlaces(places);
    this.render();
  }

  private matches(p: Place, f: Filter): boolean {
    return f === 'all' || (f === 'perch' ? !!p.perch : p.region === f);
  }

  /** Rebuilds chips and rows for the current filter and search. */
  private render(): void {
    const q = fold(this.search.value.trim());
    this.shown = this.places.filter((p) => this.matches(p, this.filter) && (!q || p.search.includes(q)));

    const filters: Array<{ id: Filter; label: string }> = [
      { id: 'all', label: 'Tümü' },
      { id: 'perch', label: 'Konulabilir' },
      ...REGIONS.map((r) => ({ id: r.id as Filter, label: r.chip })),
    ];
    this.chips.replaceChildren(
      ...filters.flatMap((f) => {
        const count = this.places.filter((p) => this.matches(p, f.id)).length;
        if (count === 0 && f.id !== 'all') {
          return [];
        }
        const chip = el('button', 'tp-chip', [el('span', undefined, f.label), el('span', 'tp-chip-count ejd-num', String(count))], {
          type: 'button',
          'aria-pressed': String(f.id === this.filter),
        });
        chip.classList.toggle('is-on', f.id === this.filter);
        chip.addEventListener('click', () => {
          this.filter = f.id;
          this.render();
        });
        return [chip];
      }),
    );

    this.rows.clear();
    this.list.replaceChildren(
      ...this.shown.map((p) => {
        const kind = el('span', p.perch ? 'tp-kind is-perch' : 'tp-kind');
        kind.innerHTML = KIND_ICONS[p.kind];
        const time = p.view.time !== undefined ? el('span', 'tp-time ejd-num', formatClock(p.view.time)) : null;
        const row = el(
          'button',
          'tp-row',
          [
            kind,
            el('span', 'tp-row-text', [
              el('span', 'tp-row-name', p.name),
              el('span', 'tp-row-sub', regionTitle(p.region) + (p.perch ? ' · konulabilir' : '')),
            ]),
            time,
            p.perch ? el('i', 'tp-dot tp-dot-perch', undefined, { 'aria-hidden': 'true' }) : null,
          ],
          { type: 'button', role: 'option', 'aria-selected': 'false' },
        );
        row.addEventListener('click', () => this.select(p.id, false));
        row.addEventListener('dblclick', () => this.teleport());
        row.addEventListener('pointerenter', () => this.hover(p.id));
        row.addEventListener('pointerleave', () => this.hover(null));
        this.rows.set(p.id, row);
        return row;
      }),
    );
    this.empty.hidden = this.shown.length > 0;
    this.paintSelection();
  }

  private select(id: string, scroll: boolean): void {
    if (!this.shown.some((p) => p.id === id)) {
      // a dimmed pin: show everything again so the picked place has its row
      this.filter = 'all';
      this.search.value = '';
      this.selected = id;
      this.render();
    }
    this.selected = id;
    this.paintSelection();
    if (scroll) {
      this.rows.get(id)?.scrollIntoView({ block: 'nearest' });
    }
  }

  private hover(id: string | null): void {
    if (id === this.hovered) {
      return;
    }
    this.hovered = id;
    for (const [pid, row] of this.rows) {
      row.classList.toggle('is-hover', pid === id);
    }
    this.syncMap();
  }

  /** Moves the selection through the visible rows (focus follows when a row had it). */
  private step(dir: 1 | -1, moveFocus: boolean): void {
    if (this.shown.length === 0) {
      return;
    }
    const i = this.shown.findIndex((p) => p.id === this.selected);
    const next = this.shown[i < 0 ? 0 : Math.min(this.shown.length - 1, Math.max(0, i + dir))];
    this.select(next.id, true);
    if (moveFocus) {
      this.rows.get(next.id)?.focus({ preventScroll: true });
    }
  }

  private paintSelection(): void {
    for (const [id, row] of this.rows) {
      const on = id === this.selected;
      row.classList.toggle('is-on', on);
      row.setAttribute('aria-selected', String(on));
    }
    const place = this.current();
    this.detailName.textContent = place?.name ?? '';
    this.detailRegion.textContent = place
      ? regionTitle(place.region) + (place.view.time !== undefined ? ` · ${formatClock(place.view.time)}` : '')
      : '';
    this.detailInfo.textContent = place?.info ?? '';
    this.perchButton.hidden = !place?.perch;
    this.syncMap();
  }

  private syncMap(): void {
    this.map.setState({ visible: new Set(this.shown.map((p) => p.id)), selected: this.selected, hovered: this.hovered });
  }

  private current(): Place | undefined {
    return this.places.find((p) => p.id === this.selected);
  }

  private teleport(): void {
    const place = this.current();
    if (place) {
      this.options.onTeleport(place.view);
    }
  }

  /** ~30 m behind and above the grip point, facing the perch's view; the landing itself is up to the player (L). */
  private perch(): void {
    const place = this.current();
    if (place?.perch) {
      this.options.onPerch(perchView(place.perch, 30, 30, -12));
    }
  }
}
