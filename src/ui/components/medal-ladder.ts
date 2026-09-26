import { el } from '../dom';

export type Medal = 'gold' | 'silver' | 'bronze';

const MEDALS: readonly Medal[] = ['gold', 'silver', 'bronze'];
const NAMES: Record<Medal, string> = { gold: 'Altın', silver: 'Gümüş', bronze: 'Bronz' };

export interface MedalLadder {
  readonly root: HTMLElement;
  /** Target times (s) in medal order gold, silver, bronze, and the best time (s) or null. */
  set(targets: readonly [number, number, number], best: number | null): void;
}

/**
 * The three medal targets on one time line (faster to the left) with the best time as a marker on it: which medals
 * are held is read from where the marker stands (medals at or right of it), not from checkboxes. Positions are in
 * percent of the width, so it fits any container.
 */
export function medalLadder(format: (seconds: number) => string): MedalLadder {
  const track = el('i', 'ui-ladder-track');
  const earned = el('i', 'ui-ladder-earned');
  const marks = MEDALS.map((m) => {
    const node = el('div', `ui-ladder-mark ui-medal-${m}`, [el('i', 'ui-ladder-dot'), el('span', 'ui-ladder-name', NAMES[m]), el('span', 'ui-ladder-time ejd-num')]);
    return node;
  });
  const bestLabel = el('span', 'ui-ladder-best-label ejd-num');
  const best = el('div', 'ui-ladder-best', [bestLabel, el('i', 'ui-ladder-best-tick')]);
  const root = el('div', 'ui-ladder', [track, earned, ...marks, best], { role: 'img' });
  return {
    root,
    set(targets, bestTime) {
      const span = targets[2] - targets[0];
      const lo = targets[0] - span * 0.18;
      const hi = targets[2] + span * 0.22;
      const pct = (s: number): number => ((Math.min(hi, Math.max(lo, s)) - lo) / (hi - lo)) * 100;
      const has = bestTime !== null && bestTime > 0;
      marks.forEach((node, i) => {
        node.style.left = `${pct(targets[i]).toFixed(2)}%`;
        node.classList.toggle('is-earned', has && bestTime! <= targets[i]);
        (node.lastChild as HTMLElement).textContent = format(targets[i]);
      });
      best.hidden = !has;
      earned.hidden = !has;
      if (has) {
        const p = pct(bestTime!);
        best.style.left = `${p.toFixed(2)}%`;
        earned.style.left = `${p.toFixed(2)}%`;
        bestLabel.textContent = `Rekorun ${format(bestTime!)}`;
      }
      root.setAttribute(
        'aria-label',
        has
          ? `Rekorun ${format(bestTime!)}; hedefler altın ${format(targets[0])}, gümüş ${format(targets[1])}, bronz ${format(targets[2])}`
          : `Henüz derece yok; hedefler altın ${format(targets[0])}, gümüş ${format(targets[1])}, bronz ${format(targets[2])}`,
      );
    },
  };
}
