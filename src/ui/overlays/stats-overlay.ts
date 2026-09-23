import { el, TextSlot } from '../dom';
import { formatCount, formatDecimal, formatInt } from '../format';

interface EngineStatsLike {
  fps: number;
  frameMs: number;
  cpuMs: number;
  drawCalls: number;
  triangles: number;
  renderScale: number;
  pending: number;
  cpuBySystem: Record<string, number>;
}

const REFRESH_S = 0.25;
const ROWS: Array<[key: string, label: string]> = [
  ['fps', 'FPS'],
  ['frame', 'Kare'],
  ['cpu', 'CPU'],
  ['calls', 'Çizim çağrısı'],
  ['tris', 'Üçgen'],
  ['scale', 'Çözünürlük'],
  ['pending', 'Bekleyen iş'],
  ['ui', 'Arayüz CPU'],
];

/** ?stats=1 performance readout (reads window.__ejderha.stats() at 4 Hz). */
export class StatsOverlay {
  readonly root: HTMLElement;
  private readonly slots = new Map<string, TextSlot>();
  private timer = 0;

  constructor() {
    const rows = ROWS.map(([key, label]) => {
      const value = el('span', 'st-val ejd-num', '–');
      this.slots.set(key, new TextSlot(value));
      return el('div', `st-row st-${key}`, [el('span', 'st-key', label), value]);
    });
    this.root = el('aside', 'hud-stats ejd-glass', [el('p', 'ejd-caps st-title', 'Performans'), ...rows], { 'aria-label': 'Performans' });
  }

  update(realDt: number): void {
    this.timer -= realDt;
    if (this.timer > 0) {
      return;
    }
    this.timer = REFRESH_S;
    // renderer.info is reset at the start of each frame: read it after this frame has rendered.
    window.setTimeout(this.refresh, 0);
  }

  private readonly refresh = (): void => {
    const api = (window as unknown as { __ejderha?: { stats(): EngineStatsLike } }).__ejderha;
    if (!api) {
      return;
    }
    const s = api.stats();
    const set = (key: string, text: string): void => this.slots.get(key)?.set(text);
    set('fps', formatDecimal(s.fps));
    set('frame', `${formatDecimal(s.frameMs, 2)} ms`);
    set('cpu', `${formatDecimal(s.cpuMs, 2)} ms`);
    set('calls', formatInt(s.drawCalls));
    set('tris', formatCount(s.triangles));
    set('scale', `%${formatInt(s.renderScale * 100)}`);
    set('pending', formatInt(s.pending));
    set('ui', `${formatDecimal(s.cpuBySystem.ui ?? 0, 2)} ms`);
    this.root.classList.toggle('is-slow', s.fps > 0 && s.fps < 50);
  };
}
