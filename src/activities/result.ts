/**
 * Result screen data (pure, no DOM): the per-gate comparison against the previous best for the "Kapı kapı fark" chart.
 */
import type { Gate } from './courses';
import { RACE_TEXT } from './text';

export interface GateDelta {
  /** Gate index in the course. */
  index: number;
  /** Chart label: the gate's landmark caption or "Kapı n"; the last gate carries "(bitiş)". */
  label: string;
  /** Cumulative split of this run at the gate (s). */
  split: number;
  /** Cumulative time won (negative) or lost (positive) against the reference run up to this gate (s). */
  delta: number;
}

/** Chart label of gate `index` of `total`. */
export function gateLabel(gate: Pick<Gate, 'label'> | undefined, index: number, total: number): string {
  const t = RACE_TEXT.finish;
  const name = gate?.label ?? t.gate(index + 1);
  return index === total - 1 ? t.finishGate(name) : name;
}

/**
 * Cumulative delta at each gate against the reference splits (the record the run was compared against). The start
 * gate is left out (its split is only the lead-in). Null when there is no reference or the splits do not line up
 * (different gate count, missing or non-finite values), so the chart is hidden.
 */
export function gateDeltas(gates: readonly Pick<Gate, 'label'>[], splits: readonly number[], reference: readonly number[] | undefined): GateDelta[] | null {
  const n = gates.length;
  if (!reference || reference.length !== n || splits.length !== n || n < 2) {
    return null;
  }
  const out: GateDelta[] = [];
  for (let i = 1; i < n; i++) {
    const s = splits[i];
    const r = reference[i];
    if (!Number.isFinite(s) || !Number.isFinite(r)) {
      return null;
    }
    out.push({ index: i, label: gateLabel(gates[i], i, n), split: s, delta: s - r });
  }
  return out;
}
