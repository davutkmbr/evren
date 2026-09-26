/**
 * Race HUD (race UI v2, DOM overlay appended to ctx.uiRoot). Plain text over the scene with text shadows, no boxes:
 *
 * - Start screen (countdown): the course name, gate / speed ring counts and the medal targets at the top, a huge
 *   centred 3 / 2 / 1 and a gold "Başla!", a subline, and the ghost line with [Y] iptal above the HUD cluster.
 * - Running: the big clock under the compass, "Kapı n/total", the split delta at each gate (blue faster, amber
 *   slower), the ghost gap, one warning line, a brief teal "+10 m/s" when a speed ring pushes, and the next-gate
 *   marker (distance under the gate, or a gold arrow on the screen edge).
 * - The result screen (finish-screen.ts).
 *
 * Built once; per-frame calls only write text / transforms that changed. The activity system calls update() only while
 * something is on screen, so an idle race HUD costs nothing.
 */
import { keyHint, medalDot } from '../../ui/components';
import { MEDAL_ORDER, type MedalTimes } from '../courses';
import { RACE_TEXT, deltaTone, formatGateDistance, formatRaceTime, formatSplitDelta, formatTargetTime, ghostGapText } from '../text';
import { Text, Transform, h, show, toggle } from './dom';
import { FinishScreen, type FinishHandlers, type FinishInfo } from './finish-screen';
import './races.css';

export type { FinishInfo } from './finish-screen';

/** Seconds the split delta stays up after a gate. */
const SPLIT_SECONDS = 2.5;
/** Seconds a warning line stays up after its last report. */
const WARN_SECONDS = 2.5;
/** Seconds "Başla!" stays up. */
const GO_SECONDS = 1;
/** Seconds the speed ring callout stays up. */
const BOOST_SECONDS = 1.2;
/** Seconds the result screen stays open without input (held while the pointer is over it). */
const FINISH_SECONDS = 30;
/** Seconds the readout lingers after an abort (showing the reason). */
const ABORT_SECONDS = 2.5;
/** Edge inset (px) for the off-screen gate arrow. */
const EDGE_MARGIN = 54;

export interface RaceIntro {
  name: string;
  gates: number;
  rings: number;
  medals: MedalTimes;
  /** Best time of the ghost raced against (undefined: no ghost). */
  ghostBest?: number;
}

export class RaceHud {
  readonly root = h('div', 'ejd race-ui race-hud');

  // Start screen.
  private readonly intro = h('div', 'race-intro');
  private readonly introName = new Text(h('span', 'race-intro-name'));
  private readonly introInfo = h('span', 'race-intro-info ejd-num');
  private readonly introFoot = h('div', 'race-intro-foot');
  private readonly count = h('div', 'race-count');
  private countLeft = 0;
  private introOn = false;

  // Running readout.
  private readonly readout = h('div', 'race-readout');
  private readonly clock = new Text(h('span', 'race-clock ejd-num'));
  private readonly gateNum = new Text(h('span', 'race-gate ejd-num'));
  private readonly split = h('span', 'race-split ejd-num');
  private readonly splitText = new Text(this.split);
  private readonly ghostRow = h('span', 'race-ghost ejd-num');
  private readonly ghostText = new Text(h('span'));
  private readonly warnRow = h('span', 'race-warn');
  private readonly warnText = new Text(this.warnRow);
  private readonly boostNode = h('span', 'race-boost ejd-num');
  private splitLeft = 0;
  private warnLeft = 0;
  private boostLeft = 0;
  private readoutOn = false;
  private abortLeft = 0;

  // Result screen.
  private readonly finish: FinishScreen;
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

  constructor(parent: HTMLElement, handlers: FinishHandlers) {
    this.root.setAttribute('lang', 'tr');
    this.intro.append(this.introName.node, this.introInfo);
    this.ghostRow.append(h('i', 'race-ghost-dot'), this.ghostText.node);
    this.readout.append(this.clock.node, h('span', 'race-line', [this.gateNum.node, this.split, this.ghostRow]), this.warnRow);
    this.arrow.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M8 4l10 8-10 8z"/></svg>';
    this.marker.append(this.arrow, this.distNode);
    this.root.append(this.marker, this.intro, this.count, this.introFoot, this.readout, this.boostNode);
    this.finish = new FinishScreen(this.root, handlers);
    for (const n of [this.intro, this.count, this.introFoot, this.readout, this.boostNode, this.marker, this.split, this.ghostRow, this.warnRow]) {
      n.hidden = true;
    }
    parent.append(this.root);
  }

  /** Anything that needs update() this frame (timers, readout, result screen, marker). */
  get busy(): boolean {
    return this.readoutOn || this.introOn || this.countLeft > 0 || this.finishLeft > 0 || this.abortLeft > 0 || this.boostLeft > 0 || this.markerOn;
  }

  get finishOpen(): boolean {
    return this.finish.open;
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

  /* ---------------- start screen ---------------- */

  /** Shows the start screen for a new run (called at the countdown). */
  begin(info: RaceIntro): void {
    const t = RACE_TEXT.countdown;
    this.introName.set(info.name);
    this.introInfo.replaceChildren(
      h('span', undefined, t.counts(info.gates, info.rings)),
      ...MEDAL_ORDER.map((m) => h('span', 'race-intro-target', [medalDot(m, 's').root, formatTargetTime(info.medals[m])])),
    );
    this.introFoot.replaceChildren(
      ...(info.ghostBest !== undefined ? [h('span', 'race-intro-ghost', [h('i', 'race-ghost-dot is-glow'), t.ghost(formatRaceTime(info.ghostBest))])] : []),
      keyHint('Y', t.cancel, 'quiet').root,
    );
    this.clock.set(formatRaceTime(0));
    this.gateNum.set(RACE_TEXT.hud.gate(0, info.gates));
    this.setGhostGap(null);
    this.splitLeft = 0;
    show(this.split, false);
    this.warnLeft = 0;
    show(this.warnRow, false);
    this.boostLeft = 0;
    show(this.boostNode, false);
    this.abortLeft = 0;
    this.closeFinish();
    this.readoutOn = false;
    show(this.readout, false);
    this.introOn = true;
    show(this.intro, true);
    show(this.introFoot, true);
  }

  /** 3, 2, 1 or 'go' ("Başla!"). A new node per tick restarts the pop animation. */
  showCountdown(value: number | 'go'): void {
    const t = RACE_TEXT.countdown;
    const go = value === 'go';
    this.count.replaceChildren(h('span', `race-count-val${go ? ' is-go' : ''}`, go ? t.go : String(value)), h('span', 'race-count-sub', go ? t.goSub : t.sub));
    show(this.count, true);
    this.countLeft = go ? GO_SECONDS : 1.2;
    if (go) {
      this.introOn = false;
      show(this.intro, false);
      show(this.introFoot, false);
      this.readoutOn = true;
      show(this.readout, true);
    }
  }

  /* ---------------- running ---------------- */

  /** Per running frame: clock and gate count (passed gates). */
  setRunning(elapsed: number, passed: number, total: number): void {
    this.clock.set(formatRaceTime(elapsed));
    this.gateNum.set(RACE_TEXT.hud.gate(passed, total));
  }

  /** Live gap to the ghost (null hides it). */
  setGhostGap(gap: number | null): void {
    if (gap === null || !Number.isFinite(gap)) {
      show(this.ghostRow, false);
      return;
    }
    show(this.ghostRow, true);
    this.ghostText.set(ghostGapText(gap));
  }

  /** The warning line (missed gate, wrong way, straying, landing); repeated calls keep it up. */
  warn(text: string): void {
    this.warnText.set(text);
    show(this.warnRow, true);
    this.warnLeft = WARN_SECONDS;
  }

  /** At a gate: the delta against the record's split (blue faster, amber slower), or the split time on a first run. */
  gate(split: number, delta?: number): void {
    if (delta === undefined) {
      this.splitText.set(formatRaceTime(split));
      toggle(this.split, 'is-faster', false);
      toggle(this.split, 'is-slower', false);
    } else {
      this.splitText.set(formatSplitDelta(delta));
      const tone = deltaTone(delta);
      toggle(this.split, 'is-faster', tone === 'faster');
      toggle(this.split, 'is-slower', tone === 'slower');
    }
    show(this.split, true);
    this.splitLeft = SPLIT_SECONDS;
  }

  /** A speed ring pushed the dragon: the brief teal callout. */
  boost(dv: number): void {
    // A new node restarts the fade animation.
    const node = h('span', 'race-boost-val', RACE_TEXT.hud.boost(dv));
    this.boostNode.replaceChildren(node);
    show(this.boostNode, true);
    this.boostLeft = BOOST_SECONDS;
  }

  /** Race aborted: the reason in the warning line, then the readout fades out. */
  abort(reason: string): void {
    this.introOn = false;
    show(this.intro, false);
    show(this.introFoot, false);
    this.countLeft = 0;
    show(this.count, false);
    this.readoutOn = true;
    show(this.readout, true);
    this.warn(reason);
    this.warnLeft = ABORT_SECONDS;
    this.abortLeft = ABORT_SECONDS;
    this.setMarker(null);
  }

  /** Hides the readout and the start screen (finish, reset). */
  end(): void {
    this.readoutOn = false;
    this.introOn = false;
    this.abortLeft = 0;
    show(this.readout, false);
    show(this.intro, false);
    show(this.introFoot, false);
    this.splitLeft = 0;
    show(this.split, false);
    this.boostLeft = 0;
    show(this.boostNode, false);
    this.setMarker(null);
  }

  /* ---------------- result screen ---------------- */

  showFinish(info: FinishInfo): void {
    this.end();
    this.finish.show(info);
    this.finishLeft = FINISH_SECONDS;
  }

  closeFinish(): void {
    this.finishLeft = 0;
    this.finish.hide();
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
    this.arrowRot.set(`translate(-50%, -50%) rotate(${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1)}deg)`);
    // Label on the inner side of the arrow.
    this.distPos.set(`translate(calc(-50% - ${(dx * 44).toFixed(1)}px), calc(-50% - ${(dy * 30).toFixed(1)}px))`);
  }

  /* ---------------- timers ---------------- */

  /** Advances the timers (call every frame while busy, with real seconds; pass 0 while hidden to hold them). */
  update(dt: number): void {
    if (dt <= 0) {
      return;
    }
    if (this.countLeft > 0) {
      this.countLeft -= dt;
      if (this.countLeft <= 0) {
        show(this.count, false);
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
    if (this.boostLeft > 0) {
      this.boostLeft -= dt;
      if (this.boostLeft <= 0) {
        show(this.boostNode, false);
      }
    }
    if (this.abortLeft > 0) {
      this.abortLeft -= dt;
      if (this.abortLeft <= 0) {
        this.end();
      }
    }
    if (this.finishLeft > 0 && !this.finish.hovered) {
      this.finishLeft -= dt;
      if (this.finishLeft <= 0) {
        this.closeFinish();
      }
    }
  }

  /** Everything off (race cancelled with no message, dispose). */
  reset(): void {
    this.countLeft = 0;
    show(this.count, false);
    this.end();
    this.closeFinish();
  }

  dispose(): void {
    this.root.remove();
  }
}
