/**
 * Fixed vertical bands of the HUD zones, derived from the viewport (percentages with px limits). The UI writes them as
 * CSS custom properties on the shared UI root (applyZoneBands), zones.css positions every zone from them, and the
 * headless check verifies that no two bands overlap from 1280 × 720 to 2560 × 1440.
 *
 *   top          compass tape + one line under it (landmark label, or the race readout while racing)
 *   title        upper third: area title, race intro / countdown / warnings, big announcements
 *   center       reserved for the aim / ring area: no text except small labels next to world markers
 *   lowerCenter  one line of hints / captions right above the bottom cluster (grows upwards for the hover panel)
 *   bottom       speed · stamina + hotbar · altitude (static)
 *   corner       discovery card top right; toasts top left
 */

/** Height of the compass tape box (hud.css .hud-compass). */
export const COMPASS_H = 54;
/** Offset of the top zone's second line from the compass top: right under the heading number. */
export const TOP_LINE_OFFSET = 50;
/** The race readout starts a little lower than the landmark line (the approved race UI: gutter + 72 px). */
export const RACE_READOUT_DROP = 20;
/** Race readout: clock (46) + gap + gate / split / ghost line (20). */
export const RACE_READOUT_H = 72;
/** Space kept free between the top band and the title band. */
const TOP_TITLE_GAP = 14;
/** Bottom cluster: readouts, stamina wings, hotbar and its caption, above its bottom inset. */
export const BOTTOM_CLUSTER_H = 146;
const BOTTOM_INSET = 10;
/** The hint line sits this far above the gutter (above the cluster). */
export const LOWER_LINE_BOTTOM = 158;
export const LOWER_LINE_H = 30;

export interface Band {
  y0: number;
  y1: number;
}

export interface ZoneBands {
  gutter: number;
  top: Band;
  /** y of the top zone's second line (the landmark label). */
  topLine: number;
  /** y of the race readout, which replaces the landmark line while racing. */
  raceReadout: number;
  title: Band;
  center: Band;
  lowerCenter: Band;
  bottom: Band;
}

/** The UI gutter (base.css: 18 px up to 1440 × 820, else 24 px). */
export function gutterFor(width: number, height: number): number {
  return width <= 1440 || height <= 820 ? 18 : 24;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function zoneBands(width: number, height: number): ZoneBands {
  const gutter = gutterFor(width, height);
  const compassTop = gutter + 2;
  const topLine = compassTop + TOP_LINE_OFFSET;
  const raceReadout = topLine + RACE_READOUT_DROP;
  const top = { y0: compassTop, y1: raceReadout + RACE_READOUT_H };
  // Upper third: 18 % of the height, never touching the top band; 21 % tall within 150–290 px.
  const titleY0 = Math.round(Math.max(top.y1 + TOP_TITLE_GAP, height * 0.18));
  const title = { y0: titleY0, y1: titleY0 + Math.round(clamp(height * 0.21, 150, 290)) };
  const bottom = { y0: height - gutter - BOTTOM_INSET - BOTTOM_CLUSTER_H, y1: height - gutter - BOTTOM_INSET };
  const lowerY1 = height - gutter - LOWER_LINE_BOTTOM;
  const lowerCenter = { y0: lowerY1 - LOWER_LINE_H, y1: lowerY1 };
  const center = { y0: title.y1, y1: lowerCenter.y0 };
  return { gutter, top, topLine, raceReadout, title, center, lowerCenter, bottom };
}

/** Writes the bands as CSS custom properties (px) on `root`; zones.css falls back to the same formulas without them. */
export function applyZoneBands(root: HTMLElement, width: number, height: number): void {
  const b = zoneBands(width, height);
  const set = (name: string, px: number): void => root.style.setProperty(name, `${Math.round(px)}px`);
  set('--zone-top-line', b.topLine);
  set('--zone-top-readout', b.raceReadout);
  set('--zone-title-top', b.title.y0);
  set('--zone-title-h', b.title.y1 - b.title.y0);
  set('--zone-lower-bottom', height - b.lowerCenter.y1);
}
