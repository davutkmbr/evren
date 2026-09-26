/**
 * Race HUD (DOM overlay appended to ctx.uiRoot): the big centred countdown, the top-centre race panel (clock, gate
 * n/total, course name, ghost gap, warning line), the split chip shown at each gate, the finish card and the
 * next-gate marker. Built once; per-frame calls only write text/transforms that changed. The activity system calls
 * update() only while something is on screen, so an idle race HUD costs nothing.
 */
import type { Medal, MedalTimes } from '../courses';
import { MEDAL_ORDER } from '../courses';
import { MEDAL_NAME, RACE_TEXT, deltaTone, formatGateDistance, formatRaceTime, formatSplitDelta, formatTargetTime } from '../text';
import { Text, Transform, h, show, toggle } from './dom';
import './race-hud.css';

/** Seconds the split chip stays up after a gate. */
const SPLIT_SECONDS = 2.5;
/** Seconds a warning line stays up after its last report. */
const WARN_SECONDS = 2.5;
/** Seconds "BAŞLA!" stays up. */
const GO_SECONDS = 0.9;
/** Seconds the finish card stays open. */
const FINISH_SECONDS = 8;
/** Seconds the panel lingers after an abort (showing the reason). */
const ABORT_SECONDS = 2.5;
/** Edge inset (px) for the off-screen gate arrow. */
const EDGE_MARGIN = 54;

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
}

export class RaceHud {
  readonly root = h('div', 'ejd race-ui');

  // Countdown.
  private readonly countdown = h('div', 'race-count');
  private countdownLeft = 0;

  // Panel.
  private readonly panel = h('div', 'race-panel ejd-glass');
  private readonly name = new Text(h('span', 'race-panel-name ejd-caps'));
  private readonly clock = new Text(h('span', 'race-panel-time ejd-num'));
  private readonly gateNum = new Text(h('span', 'race-panel-gate-val ejd-num'));
  private readonly ghostRow = h('div', 'race-panel-ghost ejd-num');
  private readonly ghost = new Text(this.ghostRow);
  private readonly warnRow = h('div', 'race-panel-warn');
  private readonly warnText = new Text(this.warnRow);
  private warnLeft = 0;
  private panelOn = false;
  private abortLeft = 0;

  // Split chip.
  private readonly split = h('div', 'race-split ejd-glass ejd-num');
  private readonly splitLabel = new Text(h('span', 'race-split-label'));
  private readonly splitTime = new Text(h('span', 'race-split-time'));
  private readonly splitDelta = h('span', 'race-split-delta');
  private readonly splitDeltaText = new Text(this.splitDelta);
  private splitLeft = 0;

  // Finish card.
  private readonly card = h('div', 'race-card ejd-glass');
  private finishLeft = 0;

  // Next-gate marker.
  private readonly marker = h('div', 'race-gm');
  private readonly markerPos = new Transform(this.marker);
  private readonly arrow = h('div', 'race-gm-arrow');
  private readonly arrowRot = new Transform(this.arrow);
  private readonly distNode = h('div', 'race-gm-dist ejd-num');
  private readonly dist = new Text(this.distNode);
  private readonly distPos = new Transform(this.distNode);
  private markerOn = false;

  private visible = true;

  constructor(parent: HTMLElement) {
    this.root.setAttribute('lang', 'tr');
    const gateBox = h('span', 'race-panel-gate', [h('span', 'race-panel-gate-cap ejd-caps', RACE_TEXT.hud.gate), this.gateNum.node]);
    const head = h('div', 'race-panel-head', [this.name.node, h('span', 'race-panel-hint', [h('kbd', undefined, 'Y'), ` ${RACE_TEXT.hud.cancelHint}`])]);
    const main = h('div', 'race-panel-main', [this.clock.node, gateBox]);
    this.panel.append(head, main, this.ghostRow, this.warnRow);
    this.split.append(this.splitLabel.node, this.splitTime.node, this.splitDelta);
    this.marker.append(this.arrow, this.distNode);
    this.root.append(this.marker, this.countdown, h('div', 'race-top', [this.panel, this.split]), this.card);
    for (const n of [this.countdown, this.panel, this.split, this.card, this.marker, this.ghostRow, this.warnRow]) {
      n.hidden = true;
    }
    parent.append(this.root);
  }

  /** Anything that needs update() this frame (timers, panel, card, marker). */
  get busy(): boolean {
    return this.panelOn || this.countdownLeft > 0 || this.splitLeft > 0 || this.finishLeft > 0 || this.abortLeft > 0 || this.markerOn;
  }

  get finishOpen(): boolean {
    return this.finishLeft > 0;
  }

  /** Hides the whole overlay (HUD hidden, menu open, photo mode) without losing state. */
  setVisible(visible: boolean): void {
    if (visible !== this.visible) {
      this.visible = visible;
      show(this.root, visible);
    }
  }

  get shown(): boolean {
    return this.visible;
  }

  /* ---------------- countdown ---------------- */

  /** 3, 2, 1 or 'go' ("BAŞLA!"). A new node per tick restarts the pop animation. */
  showCountdown(value: number | 'go'): void {
    const go = value === 'go';
    const node = h('span', `race-count-val${go ? ' is-go' : ''}`, go ? RACE_TEXT.countdownGo : String(value));
    this.countdown.replaceChildren(node);
    show(this.countdown, true);
    this.countdownLeft = go ? GO_SECONDS : 1.2;
  }

  /* ---------------- panel ---------------- */

  /** Shows the race panel for a new run (called at the countdown). */
  begin(courseName: string, total: number): void {
    this.name.set(courseName);
    this.gateNum.set(`0/${total}`);
    this.clock.set(formatRaceTime(0));
    this.ghost.set('');
    show(this.ghostRow, false);
    this.warnLeft = 0;
    show(this.warnRow, false);
    this.splitLeft = 0;
    show(this.split, false);
    this.abortLeft = 0;
    this.closeFinish();
    this.panelOn = true;
    show(this.panel, true);
  }

  /** Per running frame: clock and gate count (next = gates passed). */
  setRunning(elapsed: number, passed: number, total: number): void {
    this.clock.set(formatRaceTime(elapsed));
    this.gateNum.set(`${passed}/${total}`);
  }

  /** Live gap to the ghost (null hides the row). */
  setGhostGap(gap: number | null): void {
    if (gap === null || !Number.isFinite(gap)) {
      show(this.ghostRow, false);
      return;
    }
    show(this.ghostRow, true);
    this.ghost.set(RACE_TEXT.hud.ghost(formatSplitDelta(gap, 1)));
    const tone = deltaTone(gap, 1);
    toggle(this.ghostRow, 'is-faster', tone === 'faster');
    toggle(this.ghostRow, 'is-slower', tone === 'slower');
  }

  /** Warning line in the panel (missed gate, wrong way, straying, landing); repeated calls keep it up. */
  warn(text: string): void {
    this.warnText.set(text);
    show(this.warnRow, true);
    this.warnLeft = WARN_SECONDS;
  }

  /** Split chip at a gate: split time and the delta against the record's split (undefined on a first run). */
  gate(gateNumber: number, split: number, delta?: number): void {
    this.splitLabel.set(RACE_TEXT.hud.split(gateNumber));
    this.splitTime.set(formatRaceTime(split));
    if (delta === undefined) {
      show(this.splitDelta, false);
    } else {
      show(this.splitDelta, true);
      this.splitDeltaText.set(formatSplitDelta(delta));
      const tone = deltaTone(delta);
      toggle(this.splitDelta, 'is-faster', tone === 'faster');
      toggle(this.splitDelta, 'is-slower', tone === 'slower');
    }
    show(this.split, true);
    toggle(this.split, 'is-pop', false);
    // Restart the entry animation without a layout read: swap the node's animation name via the class on the next frame.
    requestAnimationFrame(() => toggle(this.split, 'is-pop', true));
    this.splitLeft = SPLIT_SECONDS;
  }

  /** Race aborted: the reason in the warning line, then the panel fades out. */
  abort(reason: string): void {
    this.warn(reason);
    this.warnLeft = ABORT_SECONDS;
    this.abortLeft = ABORT_SECONDS;
    this.countdownLeft = 0;
    show(this.countdown, false);
    this.setMarker(null);
  }

  /** Hides the panel and the split chip (finish, reset). */
  end(): void {
    this.panelOn = false;
    this.abortLeft = 0;
    show(this.panel, false);
    this.splitLeft = 0;
    show(this.split, false);
    this.setMarker(null);
  }

  /* ---------------- finish card ---------------- */

  showFinish(info: FinishInfo): void {
    this.end();
    const card = this.card;
    card.replaceChildren();
    const t = RACE_TEXT.finishCard;
    card.append(h('div', 'race-card-head ejd-caps', `${t.title} · ${info.courseName}`));
    card.append(h('div', 'race-card-time ejd-num', formatRaceTime(info.time)));

    const badges = h('div', 'race-card-badges');
    badges.append(
      info.medal
        ? h('span', `race-medal is-${info.medal}`, [h('i', 'race-medal-dot'), MEDAL_NAME[info.medal]])
        : h('span', 'race-medal is-none', t.noMedal),
    );
    if (info.newRecord && info.previousBest !== undefined) {
      badges.append(h('span', 'race-card-record', t.newRecord));
    } else if (info.previousBest === undefined) {
      badges.append(h('span', 'race-card-first', t.firstRecord));
    }
    card.append(badges);

    if (info.previousBest !== undefined) {
      const delta = info.time - info.previousBest;
      const tone = deltaTone(delta);
      card.append(
        h('div', 'race-card-best ejd-num', [
          h('span', 'race-card-best-cap', info.newRecord ? t.previousBest : t.best),
          h('span', 'race-card-best-val', formatRaceTime(info.previousBest)),
          h('span', `race-card-delta is-${tone}`, formatSplitDelta(delta)),
        ]),
      );
    }

    const targets = h('div', 'race-card-targets ejd-num');
    for (const m of MEDAL_ORDER) {
      const got = info.medal !== null && MEDAL_ORDER.indexOf(info.medal) <= MEDAL_ORDER.indexOf(m);
      targets.append(h('span', `race-target is-${m}${got ? ' is-got' : ''}`, [h('i', 'race-medal-dot'), formatTargetTime(info.medals[m])]));
    }
    card.append(h('div', 'race-card-sec ejd-caps', t.targets), targets);

    const splits = h('div', 'race-card-splits ejd-num');
    info.splits.forEach((s, i) => {
      const ref = info.referenceSplits?.[i];
      const cell = h('span', 'race-card-split', [h('b', undefined, String(i + 1)), formatRaceTime(s)]);
      if (ref !== undefined) {
        const d = s - ref;
        cell.append(h('em', `is-${deltaTone(d)}`, formatSplitDelta(d)));
      }
      splits.append(cell);
    });
    card.append(h('div', 'race-card-sec ejd-caps', t.splits), splits);
    card.append(h('div', 'race-card-foot', [h('kbd', undefined, 'Y'), h('kbd', undefined, 'Esc'), ` ${t.close}`]));

    show(card, true);
    toggle(card, 'is-in', false);
    requestAnimationFrame(() => toggle(card, 'is-in', true));
    this.finishLeft = FINISH_SECONDS;
  }

  closeFinish(): void {
    this.finishLeft = 0;
    show(this.card, false);
  }

  /* ---------------- next-gate marker ---------------- */

  /**
   * Places the next-gate marker. `onScreen`: (x, y) is the ring label position; otherwise (x, y) is the direction from
   * the screen centre (any length) and the arrow sits on the screen edge. null hides the marker.
   */
  setMarker(m: { onScreen: boolean; x: number; y: number; distance: number; width: number; height: number } | null): void {
    if (!m) {
      if (this.markerOn) {
        this.markerOn = false;
        show(this.marker, false);
      }
      return;
    }
    if (!this.markerOn) {
      this.markerOn = true;
      show(this.marker, true);
    }
    this.dist.set(formatGateDistance(m.distance));
    toggle(this.marker, 'is-edge', !m.onScreen);
    if (m.onScreen) {
      this.markerPos.set(`translate3d(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px, 0)`);
      this.distPos.set('translate(-50%, 0)');
      return;
    }
    // Edge point: scale the direction until it hits the inset screen rectangle.
    const hw = Math.max(1, m.width / 2 - EDGE_MARGIN);
    const hh = Math.max(1, m.height / 2 - EDGE_MARGIN);
    let dx = m.x;
    let dy = m.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      dx = 0;
      dy = 1;
    } else {
      dx /= len;
      dy /= len;
    }
    const k = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity);
    const x = m.width / 2 + dx * k;
    const y = m.height / 2 + dy * k;
    this.markerPos.set(`translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`);
    this.arrowRot.set(`rotate(${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1)}deg)`);
    // Label on the inner side of the arrow.
    this.distPos.set(`translate(calc(-50% - ${(dx * 34).toFixed(1)}px), calc(-50% - ${(dy * 30).toFixed(1)}px))`);
  }

  /* ---------------- timers ---------------- */

  /** Advances the timers (call every frame while busy, with real seconds; pass 0 while hidden to hold them). */
  update(dt: number): void {
    if (dt <= 0) {
      return;
    }
    if (this.countdownLeft > 0) {
      this.countdownLeft -= dt;
      if (this.countdownLeft <= 0) {
        show(this.countdown, false);
      }
    }
    if (this.splitLeft > 0) {
      this.splitLeft -= dt;
      if (this.splitLeft <= 0) {
        show(this.split, false);
      }
    }
    if (this.warnLeft > 0) {
      this.warnLeft -= dt;
      if (this.warnLeft <= 0) {
        show(this.warnRow, false);
      }
    }
    if (this.abortLeft > 0) {
      this.abortLeft -= dt;
      if (this.abortLeft <= 0) {
        this.end();
      }
    }
    if (this.finishLeft > 0) {
      this.finishLeft -= dt;
      if (this.finishLeft <= 0) {
        this.closeFinish();
      }
    }
  }

  /** Everything off (race cancelled with no message, dispose). */
  reset(): void {
    this.countdownLeft = 0;
    show(this.countdown, false);
    this.end();
    this.closeFinish();
  }

  dispose(): void {
    this.root.remove();
  }
}
