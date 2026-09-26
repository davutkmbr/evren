/**
 * Headless check of the gamepad side of the controls (pure TS, no browser; a stub window and gamepad):
 *
 *   npx tsx tools/headless/pad-keys-check.ts
 *
 * - core/pad-keys.ts: the pad names of the key hints (alternatives, combos, conditions, the double tap, the roll's
 *   D-pad press, keys without a pad binding);
 * - every key of the move hints (the tutorial catalogue, the lesson, the race's next-move hint) has a pad name, and
 *   every Kontroller row a catalogued move points to exists (the new water rows included);
 * - core/input.ts with a stub gamepad: A, RT, LT, LB / RB and the left stick's flicks press and double-tap like the
 *   keys, so every trick is reachable from the pad; a held button is one press.
 *
 * Exits non-zero on any failure.
 */
import { CONTROL_HELP, Input, type ButtonName } from '../../src/core/input';
import { padKeys } from '../../src/core/pad-keys';
import { LESSON_STEPS } from '../../src/activities/lesson';
import { TUTORIAL_HINTS } from '../../src/ui/tutorial/hints-data';

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL  ${msg}`);
  }
}

// --- pad names -----------------------------------------------------------------------------
const CASES: Array<[string, string | null]> = [
  ['Space', 'A'],
  ['Space ×2', 'A ×2'],
  ['Shift ×2', 'LT ×2'],
  ['Q / E ×2', 'LB / RB ×2'],
  ['A / D ×2', 'D-pad ◀ / D-pad ▶'],
  ['S ×2', 'LS ▲ ×2'],
  ['W', 'LS ▼'],
  ['Ctrl / X', 'B'],
  ['F / Sol tık', 'X'],
  ['Sağ tık', 'RS'],
  ['Space / L', 'A / R3'],
  ['Ctrl + W / S', 'B + LS ▼ / LS ▲'],
  ['Shift bırak / Space', 'LT bırak / A'],
  ['Dik dalışta A / D ×2', 'Dik dalışta D-pad ◀ / D-pad ▶'],
  ['Looping tepesinde A / D', 'Looping tepesinde LS ◀ / LS ▶'],
  ['A / D basılı + S ×2', 'LS ◀ / LS ▶ basılı + LS ▲ ×2'],
  ['T', null],
  ['1–5', null],
  ['', null],
];
for (const [keys, want] of CASES) {
  const got = padKeys(keys);
  check(got === want, `padKeys(${JSON.stringify(keys)}) = ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
}

// Every move hint names pad buttons (a hint the pad cannot perform would be a dead end).
const hintKeys = [
  ...TUTORIAL_HINTS.filter((h) => h.keys).map((h) => [`tutorial ${h.id}`, h.keys] as const),
  ...LESSON_STEPS.flatMap((s, i) => s.hints.map(([k]) => [`lesson step ${i + 1}`, k] as const)),
  ...['Shift ×2', 'Space ×2', 'A / D ×2', 'Q / E ×2'].map((k) => ['chain hint', k] as const),
];
for (const [where, keys] of hintKeys) {
  check(padKeys(keys) !== null, `${where}: "${keys}" has a pad name`);
}
// Every flight, water and trick row of Kontroller has a pad name.
for (const e of CONTROL_HELP.filter((r) => r.group === 'flight' || r.group === 'water' || r.group === 'tricks' || r.group === 'ground')) {
  check(padKeys(e.keys) !== null, `Kontroller ${e.group}: "${e.keys}" has a pad name`);
}
// The catalogue's Kontroller rows exist (the plunge, the breach and the water take-off point at the water rows).
for (const h of TUTORIAL_HINTS) {
  if (h.control) {
    const { group, keys } = h.control;
    check(
      CONTROL_HELP.some((r) => r.group === group && r.keys === keys),
      `tutorial ${h.id}: Kontroller row ${group} "${keys}" exists`,
    );
  }
}
for (const id of ['plunge', 'breach', 'water-takeoff']) {
  check(TUTORIAL_HINTS.find((h) => h.id === id)?.control?.group === 'water', `tutorial ${id}: marks a water row`);
}

// --- the pad through Input -------------------------------------------------------------------
const noop = (): void => undefined;
const g = globalThis as unknown as Record<string, unknown>;
g.window = { addEventListener: noop };
g.document = { addEventListener: noop, pointerLockElement: null };
const pad = { connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [pad] }, configurable: true });
let now = 1000;
performance.now = () => now;
const input = new Input({ addEventListener: noop } as unknown as HTMLElement);

type Frame = { press: ButtonName[]; double: ButtonName[] };
/** One frame (1/60 s) with the pad in this state. */
function frame(set: () => void): Frame {
  pad.buttons.forEach((b) => {
    b.pressed = false;
    b.value = 0;
  });
  pad.axes.fill(0);
  set();
  now += 1000 / 60;
  input.update(1 / 60);
  const names: ButtonName[] = ['flap', 'dive', 'brake', 'yawLeft', 'yawRight', 'pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'land'];
  return { press: names.filter((n) => input.wasPressed(n)), double: names.filter((n) => input.wasDoubleTapped(n)) };
}
const idle = (n: number): void => {
  for (let i = 0; i < n; i++) {
    frame(noop);
  }
};
const btn = (i: number, value = 1) => () => {
  pad.buttons[i].pressed = true;
  pad.buttons[i].value = value;
};
/** Two short presses ~150 ms apart; returns the frames' presses and double taps. */
function doubleTap(set: () => void): { presses: number; doubles: Set<ButtonName> } {
  const doubles = new Set<ButtonName>();
  let presses = 0;
  for (const step of [set, set, noop, noop, noop, noop, noop, set, set, noop]) {
    const f = frame(step);
    presses += f.press.length;
    f.double.forEach((d) => doubles.add(d));
  }
  idle(30);
  return { presses, doubles };
}

idle(30);
const a = doubleTap(btn(0));
check(a.doubles.has('flap'), `A twice: the power stroke's double tap (${[...a.doubles].join(', ') || 'none'})`);
const rt = doubleTap(btn(7, 1));
check(rt.doubles.has('flap'), 'RT twice: the power stroke too');
const lt = doubleTap(btn(6, 1));
check(lt.doubles.has('dive'), 'LT twice: the dart');
const lb = doubleTap(btn(4));
const rb = doubleTap(btn(5));
check(lb.doubles.has('yawLeft') && rb.doubles.has('yawRight'), 'LB / RB twice: the slip');
const flickUp = doubleTap(() => {
  pad.axes[1] = -1;
});
check(flickUp.doubles.has('pitchUp') && !flickUp.doubles.has('pitchDown'), 'left stick flicked up twice: the loop / wingover (S ×2)');
const dpad = frame(btn(14));
check(dpad.double.includes('rollLeft'), 'D-pad ◀ once: the roll');
idle(30);
// A held button is one press, and a press is a press (A takes off from the water, touches and goes).
let held = 0;
let heldDouble = false;
for (let i = 0; i < 40; i++) {
  const f = frame(btn(0));
  held += f.press.includes('flap') ? 1 : 0;
  heldDouble ||= f.double.includes('flap');
}
check(held === 1 && !heldDouble, `A held for 40 frames: one press, no double tap (${held})`);
idle(30);
// Two presses too far apart are not a double tap.
frame(btn(0));
idle(30);
check(!frame(btn(0)).double.includes('flap'), 'A twice 0.5 s apart: no double tap');
idle(30);
// A slow stick movement past the threshold and held is one press, never a double tap.
let slow = 0;
for (let i = 0; i < 30; i++) {
  const f = frame(() => {
    pad.axes[1] = -Math.min(1, i / 10);
  });
  slow += f.double.includes('pitchUp') ? 1 : 0;
}
check(slow === 0, 'the stick pulled and held: no double tap');

console.log(`${checks - failures}/${checks} pad checks passed`);
process.exit(failures ? 1 : 0);
