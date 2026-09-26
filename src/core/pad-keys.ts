/**
 * Gamepad names for the keyboard keys of the key hints and the Kontroller list (the CONTROL_HELP key syntax: "A / B"
 * alternatives, "Ctrl + W" held together, a trailing "×2" double tap, extra words kept: "Dik dalışta A / D ×2").
 * Follows the pad mapping in `core/input.ts` (standard layout, Xbox names):
 *
 *   left stick: W / S = LS ▼ / ▲ (the pitch axis before the invert setting, like the keys), A / D = LS ◀ / ▶
 *   A / RT flap (Space), LT dive (Shift), B brake (Ctrl / X), X fire (F), Y camera (C), LB / RB rudder (Q / E),
 *   L3 roar (R), R3 land (L), D-pad ↑ encourage (V), D-pad ↓ pet (G), D-pad ◀ / ▶ a roll (A / D ×2: one press),
 *   Start pause (Esc / P), Back map (M), the right stick looks around (right mouse button)
 *
 * A double tap of a button is a double tap on the pad too ("Space ×2" → "A ×2"); the roll's "A / D ×2" is the D-pad's
 * single press. Pure; `null` when a key has no pad binding (the caller keeps the keyboard keys).
 */

/** Pad name of one keyboard key name (null: not on the pad). */
const PAD: Readonly<Record<string, string>> = {
  Space: 'A',
  Shift: 'LT',
  Ctrl: 'B',
  X: 'B',
  F: 'X',
  C: 'Y',
  Q: 'LB',
  E: 'RB',
  R: 'L3',
  L: 'R3',
  V: 'D-pad ↑',
  G: 'D-pad ↓',
  W: 'LS ▼',
  S: 'LS ▲',
  A: 'LS ◀',
  D: 'LS ▶',
  Esc: 'Start',
  P: 'Start',
  M: 'Back',
};

/** The roll's double tap is one D-pad press. */
const DPAD_ROLL: Readonly<Record<string, string>> = { A: 'D-pad ◀', D: 'D-pad ▶' };

/** The left mouse button is dropped from alternatives ("F / Sol tık" → X); the right one (look) is the right stick. */
const LEFT_CLICK = /^sol tık/i;
const RIGHT_CLICK = /^sağ tık/i;

/**
 * One alternative ("Dik dalışta A", "Shift bırak", "S"): the key it names translated, the other words kept; null when
 * it names a key with no pad binding, undefined when it is a mouse button (dropped).
 */
function translatePart(part: string, rollPress: boolean): string | null | undefined {
  if (LEFT_CLICK.test(part)) {
    return undefined;
  }
  if (RIGHT_CLICK.test(part)) {
    return part.replace(RIGHT_CLICK, 'RS');
  }
  const words = part.split(/\s+/);
  let found = false;
  const out: string[] = [];
  for (const w of words) {
    const name = (rollPress && DPAD_ROLL[w]) || PAD[w];
    if (name && !found && (w.length > 1 || w === w.toUpperCase())) {
      out.push(name);
      found = true;
    } else {
      out.push(w);
    }
  }
  return found ? out.join(' ') : null;
}

/** The gamepad version of a key hint ("Space ×2" → "A ×2", "A / D ×2" → "D-pad ◀ / D-pad ▶"), or null. */
export function padKeys(keys: string): string | null {
  let text = keys.trim();
  if (!text) {
    return null;
  }
  const double = /\s*×2$/.exec(text);
  if (double) {
    text = text.slice(0, double.index);
  }
  const combos = text.split('+').map((c) => c.trim());
  // "A / D ×2" (alone or after a condition) is the roll: one D-pad press, no double tap.
  const lastAlts = combos[combos.length - 1].split('/').map((k) => k.trim());
  const rollPress = !!double && lastAlts.every((k) => /(^|\s)[AD]$/.test(k));
  const out: string[] = [];
  for (const [ci, combo] of combos.entries()) {
    const alts: string[] = [];
    for (const part of combo.split('/').map((k) => k.trim())) {
      const t = translatePart(part, rollPress && ci === combos.length - 1);
      if (t === null) {
        return null;
      }
      if (t !== undefined && !alts.includes(t)) {
        alts.push(t);
      }
    }
    if (!alts.length) {
      return null;
    }
    out.push(alts.join(' / '));
  }
  return out.join(' + ') + (double && !rollPress ? ' ×2' : '');
}
