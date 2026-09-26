import type { PerchPoint } from '../../core/contracts';
import { VIEW_PRESETS, type ViewPreset } from '../../core/debug';
import { el } from '../dom';
import { formatClock, formatInt } from '../format';

/** Region of each view preset (presets not listed here land in "Diğer"). */
const REGIONS: ReadonlyArray<{ title: string; names: readonly string[] }> = [
  { title: 'Tarihi Yarımada', names: ['spawn', 'sultanahmet', 'ayasofya', 'halic'] },
  { title: 'Beyoğlu ve Galata', names: ['galata'] },
  { title: 'Boğaz', names: ['bogaz', 'koprusu', 'fsm', 'rumelihisari', 'karadeniz'] },
  { title: 'Anadolu yakası', names: ['kizkulesi', 'uskudar', 'camlica'] },
  { title: 'Şehrin çevresi', names: ['levent', 'adalar'] },
  { title: 'Özel manzaralar', names: ['yuksek', 'gece'] },
];

/** A perch viewpoint as a teleport target: behind and above the grip point, facing its view. */
function perchPreset(p: PerchPoint): ViewPreset {
  const h = (p.headingDeg * Math.PI) / 180;
  const back = 140;
  return {
    label: p.name,
    x: p.x - Math.sin(h) * back,
    y: p.y + 45,
    z: p.z + Math.cos(h) * back,
    headingDeg: p.headingDeg,
    pitchDeg: -10,
  };
}

/** Folds Turkish letters for the search box ("kiz" finds "Kız Kulesi"). */
function fold(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüâî]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i' })[c] ?? c);
}

/**
 * Işınlan: destinations grouped by region, the viewpoints (perches) as their own group, and a search box. The map
 * (M) remains the way to go anywhere else.
 */
export class TeleportPanel {
  readonly root: HTMLElement;
  private readonly sections: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly empty: HTMLElement;
  private readonly items: Array<{ node: HTMLElement; text: string }> = [];
  private perchSection: HTMLElement | null = null;

  constructor(
    private readonly onPick: (name: string, preset: ViewPreset) => void,
    onOpenMap?: () => void,
  ) {
    this.search = el('input', 'tp-search', undefined, {
      type: 'search',
      placeholder: 'Yer ara…',
      'aria-label': 'Işınlanacak yeri ara',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    this.search.addEventListener('input', () => this.filter());
    const mapButton = el('button', 'btn-quiet tp-map', [el('span', undefined, 'Haritadan seç'), el('kbd', undefined, 'M')], { type: 'button' });
    mapButton.addEventListener('click', () => onOpenMap?.());

    const used = new Set<string>();
    const regionNodes = REGIONS.map((r) => {
      r.names.forEach((n) => used.add(n));
      return this.section(
        r.title,
        r.names.filter((n) => VIEW_PRESETS[n]).map((n) => [n, VIEW_PRESETS[n]] as const),
      );
    });
    const rest = Object.entries(VIEW_PRESETS).filter(([n]) => !used.has(n));
    if (rest.length) {
      regionNodes.push(this.section('Diğer', rest));
    }
    this.empty = el('p', 'tp-empty', 'Bu isimde bir yer yok. Haritadan istediğin noktayı seçebilirsin.');
    this.empty.hidden = true;
    this.sections = el('div', 'tp-sections', regionNodes);
    this.root = el('div', 'menu-teleport', [el('div', 'tp-toolbar', [this.search, mapButton]), this.sections, this.empty]);
  }

  /** Adds the viewpoints group once the perch service exists (call when the panel opens). */
  setPerches(points: readonly PerchPoint[] | undefined): void {
    if (this.perchSection || !points || points.length === 0) {
      return;
    }
    this.perchSection = this.section(
      'Seyir noktaları',
      points.map((p) => [`perch:${p.id}`, perchPreset(p)] as const),
      'Ejderhanın konup şehri izleyebileceği yerler',
    );
    this.sections.prepend(this.perchSection);
    this.filter();
  }

  /** Clears the search (panel re-opened). */
  reset(): void {
    if (this.search.value) {
      this.search.value = '';
      this.filter();
    }
  }

  private section(title: string, entries: ReadonlyArray<readonly [string, ViewPreset]>, lede?: string): HTMLElement {
    const cards = entries.map(([name, preset]) => {
      const meta: Array<HTMLElement | string> = [`${formatInt(preset.y)} m`];
      if (preset.time !== undefined) {
        meta.push(el('span', 'tp-chip', formatClock(preset.time)));
      }
      const button = el('button', 'tp-item', [el('span', 'tp-name', preset.label), el('span', 'tp-meta ejd-num', meta)], {
        type: 'button',
      });
      button.addEventListener('click', () => this.onPick(name, preset));
      this.items.push({ node: button, text: fold(`${preset.label} ${title}`) });
      return button;
    });
    return el('section', 'tp-section', [
      el('h3', 'ejd-caps set-heading', title),
      lede ? el('p', 'set-lede', lede) : null,
      el('div', 'tp-grid', cards),
    ]);
  }

  private filter(): void {
    const q = fold(this.search.value.trim());
    let any = false;
    for (const item of this.items) {
      const show = !q || item.text.includes(q);
      item.node.hidden = !show;
      any ||= show;
    }
    for (const section of Array.from(this.sections.children) as HTMLElement[]) {
      section.hidden = !Array.from(section.querySelectorAll<HTMLElement>('.tp-item')).some((n) => !n.hidden);
    }
    this.empty.hidden = any;
  }
}
