/**
 * Perceived speed (phase 20, owner feedback on races): the speed-feel factor every speed effect is scaled by
 * (src/core/speed-feel.ts) and the camera's use of it (src/camera/feel.ts), headless.
 *
 *   npx tsx tools/headless/speed-feel-check.ts
 *
 * Checks: full strength in a race; subtle in free flight, growing to full with flow; the accessibility setting scales
 * everything (off: no effects at all); the speed ramp; chain bursts are smaller in free flight than in a race.
 */
import type { DragonState } from '../../src/core/contracts';
import { feelContext, MOTION_EFFECTS_SCALE, motionEffects, setMotionEffects, SPEED_FEEL, speedAmount, speedFeel } from '../../src/core/speed-feel';
import { CAMERA_FEEL } from '../../src/camera/feel';
import { BURST } from '../../src/dragon/flight/flow/burst';

const failures: string[] = [];
const check = (ok: boolean, label: string): void => {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (!ok) {
    failures.push(label);
  }
};
const f2 = (v: number): string => v.toFixed(2);
const dragon = (racing: boolean, flow: number): DragonState => ({ racing, flow }) as unknown as DragonState;

console.log('Speed feel');
check(motionEffects() === 'full', 'default setting: Tam (full)');
check(feelContext(true, 0) === 1 && feelContext(true, 1) === 1, 'a race: full strength at any flow');
const free0 = feelContext(false, 0);
const free5 = feelContext(false, 0.5);
const free8 = feelContext(false, 0.8);
const free1 = feelContext(false, 1);
check(Math.abs(free0 - SPEED_FEEL.freeFlight) < 1e-9 && free0 <= 0.4, `free flight without flow stays subtle (${f2(free0)})`);
check(free0 <= free5 && free5 < free8 && free8 < free1 && free1 === 1, `free flight grows with flow: ${f2(free0)} / ${f2(free5)} / ${f2(free8)} / ${f2(free1)} at flow 0 / 0.5 / 0.8 / 1`);
check(speedAmount(SPEED_FEEL.speedFrom) === 0 && speedAmount(SPEED_FEEL.speedFull) === 1 && speedAmount(50) > 0.3 && speedAmount(50) < 0.7, `speed ramp ${SPEED_FEEL.speedFrom}–${SPEED_FEEL.speedFull} m/s (50 m/s: ${f2(speedAmount(50))})`);
for (const s of ['full', 'reduced', 'off'] as const) {
  setMotionEffects(s);
  check(Math.abs(speedFeel(dragon(true, 0)) - MOTION_EFFECTS_SCALE[s]) < 1e-9, `setting ${s}: race ${f2(speedFeel(dragon(true, 0)))}, free flight ${f2(speedFeel(dragon(false, 0)))}`);
}
check(MOTION_EFFECTS_SCALE.off === 0 && MOTION_EFFECTS_SCALE.reduced < 0.5, 'Kapalı removes every speed effect, Azaltılmış keeps less than half');
setMotionEffects('full');
check(speedFeel(null) === 0, 'no dragon: no speed effects');

console.log('Camera at full feel');
console.log(`      extra FOV +${CAMERA_FEEL.fov}° (rider +${CAMERA_FEEL.povFov}°), burst kick +${CAMERA_FEEL.kick}° (rider +${CAMERA_FEEL.povKick}°), shake ${CAMERA_FEEL.buffet} + ${CAMERA_FEEL.burstBuffet} at a burst`);
check(CAMERA_FEEL.fov + CAMERA_FEEL.kick <= 12 && CAMERA_FEEL.buffet + CAMERA_FEEL.burstBuffet <= 0.08, 'camera additions stay moderate (FOV ≤ +12°, shake ≤ 0.08)');
const freeFov = CAMERA_FEEL.fov * feelContext(false, 0);
check(freeFov < 2.5, `free flight without flow: extra FOV at full speed only +${f2(freeFov)}°`);

console.log('Chain bursts');
check(BURST.freeFlightScale < 1 && BURST.freeFlightScale >= 0.4, `bursts in free flight ×${BURST.freeFlightScale} of a race's`);

console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall speed feel checks passed');
process.exit(failures.length ? 1 : 0);
