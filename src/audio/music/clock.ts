/**
 * Bar-grid math for the music (pure): a grid is a tempo, a meter and the time of bar 0 on the AudioContext clock.
 * Everything musical (set starts, set changes, endings, stingers) lands on a grid boundary.
 */

export interface BarGrid {
  /** AudioContext time (s) of bar 0, beat 0 (the first loop start). */
  anchor: number;
  bpm: number;
  beatsPerBar: number;
  /** Loop length in bars (the position wraps). */
  bars: number;
}

export interface GridPosition {
  /** Bar within the loop, 0-based. */
  bar: number;
  /** Beat within the bar, 0-based. */
  beat: number;
  /** Bars since the anchor (not wrapped, fractional). */
  totalBars: number;
  /** Loops completed. */
  loop: number;
}

export function beatSec(g: Pick<BarGrid, 'bpm'>): number {
  return 60 / g.bpm;
}
export function gridBarSec(g: Pick<BarGrid, 'bpm' | 'beatsPerBar'>): number {
  return (60 / g.bpm) * g.beatsPerBar;
}

/** Musical position at time `t` (before the anchor: bar 0 beat 0). */
export function positionAt(g: BarGrid, t: number): GridPosition {
  const bs = gridBarSec(g);
  const total = Math.max(0, (t - g.anchor) / bs);
  const whole = Math.floor(total + 1e-9);
  const bar = whole % g.bars;
  const beat = Math.min(g.beatsPerBar - 1, Math.floor((total - whole) * g.beatsPerBar + 1e-9));
  return { bar, beat, totalBars: total, loop: Math.floor(whole / g.bars) };
}

/**
 * The first boundary of `unitBars` bars (1 = bar, phrase length = phrase, loop length = loop) at or after
 * `t + lookahead`: the earliest a change can be scheduled so every node gets it in time. Before the anchor: the
 * anchor (or later multiples).
 */
export function nextBoundary(g: BarGrid, t: number, unitBars: number, lookahead = 0.05): number {
  const unit = gridBarSec(g) * Math.max(1, unitBars);
  const from = t + lookahead;
  if (from <= g.anchor) {
    return g.anchor;
  }
  const k = Math.ceil((from - g.anchor) / unit - 1e-9);
  return g.anchor + k * unit;
}

/** Offset (s) into the loop at time `t` (for resuming a paused set in place). */
export function loopOffsetAt(g: BarGrid, t: number): number {
  const loop = gridBarSec(g) * g.bars;
  const d = t - g.anchor;
  return ((d % loop) + loop) % loop;
}
