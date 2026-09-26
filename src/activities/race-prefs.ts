/**
 * Per-player race preferences in localStorage (currently: race against the ghost of the best run). Every access is
 * guarded; without storage the choice lasts for the session only.
 */
const GHOST_KEY = 'evren.races.ghost.v1';

let ghostMemory: boolean | null = null;

/** Whether races show the ghost of the best run (default on). */
export function loadGhostEnabled(): boolean {
  if (ghostMemory !== null) {
    return ghostMemory;
  }
  let on = true;
  try {
    on = window.localStorage.getItem(GHOST_KEY) !== '0';
  } catch {
    // Storage unavailable (private window, blocked site data, headless): default on.
  }
  ghostMemory = on;
  return on;
}

export function saveGhostEnabled(on: boolean): void {
  ghostMemory = on;
  try {
    window.localStorage.setItem(GHOST_KEY, on ? '1' : '0');
  } catch {
    // Storage unavailable: keep the in-memory choice.
  }
}
