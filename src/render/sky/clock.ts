/**
 * Local time of day with smooth transitions (setTimeOfDay / [ ] keys). Transitions use real time so they also complete
 * while the simulation is paused (screenshots with ?freeze=1).
 * Every crossing of midnight (time running, transitions, shifts) is reported as a signed day carry so the calendar
 * (moon phase, sidereal time) keeps advancing continuously.
 */
export class SkyClock {
  hours: number;
  private from = 0;
  private delta = 0;
  private progress = 1;
  private duration = 1;
  /** Whole days the running transition has crossed so far (relative to `from`, which lies in [0, 24)). */
  private transitionDays = 0;
  private pendingDays = 0;

  constructor(hours: number) {
    this.hours = wrapHours(hours);
  }

  get transitioning(): boolean {
    return this.progress < 1;
  }

  /** Target of the running transition (or the current time). */
  get targetHours(): number {
    return this.progress < 1 ? wrapHours(this.from + this.delta) : this.hours;
  }

  /** Sets the time. A jump (`smooth` = false) stays on the same calendar day; a transition carries across midnight. */
  set(hours: number, smooth: boolean): void {
    const target = wrapHours(hours);
    if (!smooth) {
      this.hours = target;
      this.progress = 1;
      return;
    }
    let d = target - this.hours;
    if (d > 12) {
      d -= 24;
    } else if (d <= -12) {
      d += 24;
    }
    if (Math.abs(d) < 1e-4) {
      return;
    }
    this.from = this.hours;
    this.delta = d;
    this.progress = 0;
    this.transitionDays = 0;
    this.duration = 0.9 + Math.min(Math.abs(d), 12) * 0.16;
  }

  shift(hours: number): void {
    this.set(this.targetHours + hours, true);
  }

  update(realDt: number, simDt: number, gameMinutesPerSecond: number): number {
    if (this.progress < 1) {
      this.progress = Math.min(1, this.progress + realDt / this.duration);
      const t = this.progress;
      const eased = t * t * (3 - 2 * t);
      const raw = this.from + this.delta * eased;
      const days = Math.floor(raw / 24);
      this.pendingDays += days - this.transitionDays;
      this.transitionDays = days;
      this.hours = raw - days * 24;
    } else if (gameMinutesPerSecond !== 0 && simDt > 0) {
      const raw = this.hours + (simDt * gameMinutesPerSecond) / 60;
      const days = Math.floor(raw / 24);
      this.pendingDays += days;
      this.hours = raw - days * 24;
    }
    return this.hours;
  }

  /** Returns (and clears) the signed number of midnights crossed since the last call. */
  consumeDayCarry(): number {
    const days = this.pendingDays;
    this.pendingDays = 0;
    return days;
  }
}

export function wrapHours(h: number): number {
  const r = h % 24;
  return r < 0 ? r + 24 : r;
}

const DAYS_PER_YEAR = 365;

/** Adds `days` to (year, dayOfYear 1..365). */
export function advanceCalendar(year: number, dayOfYear: number, days: number): { year: number; dayOfYear: number } {
  let doy = Math.round(dayOfYear) + days;
  let y = year;
  while (doy > DAYS_PER_YEAR) {
    doy -= DAYS_PER_YEAR;
    y++;
  }
  while (doy < 1) {
    doy += DAYS_PER_YEAR;
    y--;
  }
  return { year: y, dayOfYear: doy };
}
