/**
 * Result screen after a finish (race UI v2): the time big on the left with the medal disc, what the next medal needs,
 * a "Yeni rekor" pill, three stats and the actions Tekrar [Enter] / Parkurlar [Y] / Uçmaya devam [Esc]; on the right
 * the "Kapı kapı fark" chart (cumulative delta against the previous best at each gate). A first run (or a record whose
 * splits do not match) shows a one-line note instead of the chart.
 *
 * The game keeps running underneath; only the two content columns take the pointer. Keys are routed by the activity
 * system (capture listener); the prompts are clickable too.
 */
import { divergingBars, legend, medalDisc, pill, prompt, stat } from '../../ui/components';
import type { Gate, Medal, MedalTimes } from '../courses';
import { gateDeltas } from '../result';
import { RACE_TEXT, formatRaceTime, formatSplitDelta, nextMedalText } from '../text';
import { h, noFocus, show, toggle } from './dom';

export interface FinishInfo {
  courseName: string;
  time: number;
  /** Medal this run earned. */
  medal: Medal | null;
  medals: MedalTimes;
  newRecord: boolean;
  /** Best time before this run (undefined on a first finish). */
  previousBest?: number;
  splits: readonly number[];
  /** Splits of the record this run was compared against (undefined without one). */
  referenceSplits?: readonly number[];
  /** The course's gates (chart labels). */
  gates: readonly Pick<Gate, 'label'>[];
  ringsUsed: number;
  ringsTotal: number;
}

export interface FinishHandlers {
  onRetry: () => void;
  onCourses: () => void;
  onClose: () => void;
}

const FASTER = '#5a93cf';
const SLOWER = '#cc8140';

export class FinishScreen {
  readonly root = h('div', 'race-finish');
  private readonly title = h('span', 'race-finish-title');
  private readonly time = h('span', 'race-finish-time ejd-num');
  private readonly disc = medalDisc(null);
  private readonly medalName = h('span', 'race-finish-medal-name');
  private readonly medalNext = h('span', 'race-finish-medal-next');
  private readonly badge = pill(RACE_TEXT.finish.newRecord);
  private readonly prevStat = stat(RACE_TEXT.finish.previousBest, '—');
  private readonly deltaStat = stat(RACE_TEXT.finish.delta, '—');
  private readonly ringStat = stat(RACE_TEXT.finish.rings, '—');
  private readonly chart = divergingBars({ negativeColor: FASTER, positiveColor: SLOWER, label: RACE_TEXT.finish.chartLabel });
  private readonly chartBox: HTMLElement;
  private readonly note = h('p', 'race-finish-note');
  /** The pointer is over the content (the auto-close timer waits). */
  hovered = false;

  constructor(parent: HTMLElement, handlers: FinishHandlers) {
    const t = RACE_TEXT.finish;
    const actions = [
      prompt(t.retry, 'Enter', 'primary', handlers.onRetry),
      prompt(t.courses, 'Y', 'secondary', handlers.onCourses),
      prompt(t.close, 'Esc', 'secondary', handlers.onClose),
    ].map((p) => noFocus(p.root));
    const left = h('div', 'race-finish-main ejd-interactive', [
      h('div', 'race-finish-head', [this.title, this.time]),
      h('div', 'race-finish-medal', [this.disc.root, h('div', 'race-finish-medal-text', [this.medalName, this.medalNext]), this.badge.root]),
      h('div', 'race-finish-stats', [this.prevStat.root, this.deltaStat.root, this.ringStat.root]),
      h('div', 'race-finish-actions', actions),
    ]);
    this.chartBox = h('div', 'race-finish-chart', [
      h('div', 'race-finish-chart-head', [
        h('span', 'race-finish-chart-title', t.chartTitle),
        legend([
          { label: t.faster, color: FASTER, swatch: 'square' },
          { label: t.slower, color: SLOWER, swatch: 'square' },
        ]),
      ]),
      h('span', 'race-finish-chart-sub', t.chartSub),
      this.chart.root,
    ]);
    const right = h('section', 'race-finish-side ejd-interactive', [this.chartBox, this.note]);
    right.setAttribute('aria-label', t.chartTitle);
    for (const col of [left, right]) {
      col.addEventListener('mouseenter', () => (this.hovered = true));
      col.addEventListener('mouseleave', () => (this.hovered = false));
    }
    this.root.append(h('div', 'race-finish-shade'), h('div', 'race-finish-grid', [left, right]));
    this.root.hidden = true;
    parent.append(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(info: FinishInfo): void {
    const t = RACE_TEXT.finish;
    this.title.textContent = t.done(info.courseName);
    this.time.textContent = formatRaceTime(info.time);
    this.disc.set(info.medal);
    this.medalName.textContent = info.medal ? t.medal(info.medal) : t.noMedal;
    this.medalNext.textContent = nextMedalText(info.time, info.medals);
    const first = info.previousBest === undefined;
    if (first) {
      this.badge.set(t.firstRecord, 'quiet');
    } else {
      this.badge.set(t.newRecord, 'gold');
    }
    show(this.badge.root, first || info.newRecord);
    this.prevStat.set(first ? '—' : formatRaceTime(info.previousBest!));
    this.deltaStat.set(first ? '—' : `${formatSplitDelta(info.time - info.previousBest!)} s`);
    this.ringStat.set(info.ringsTotal > 0 ? `${info.ringsUsed}/${info.ringsTotal}` : '—');

    const deltas = first ? null : gateDeltas(info.gates, info.splits, info.referenceSplits);
    show(this.chartBox, deltas !== null);
    show(this.note, deltas === null);
    if (deltas) {
      this.chart.set(
        deltas.map((d) => ({
          label: d.label,
          value: d.delta,
          valueText: formatSplitDelta(d.delta),
          tip: { title: d.label, lines: [t.tipSplit(formatRaceTime(d.split)), t.tipDelta(formatSplitDelta(d.delta))] },
        })),
      );
    } else {
      this.note.textContent = first ? t.firstRunNote : t.noSplitsNote;
    }
    this.hovered = false;
    show(this.root, true);
    toggle(this.root, 'is-in', false);
    requestAnimationFrame(() => toggle(this.root, 'is-in', true));
  }

  hide(): void {
    this.hovered = false;
    show(this.root, false);
  }
}
