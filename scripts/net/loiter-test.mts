/**
 * Unit test of the away loiter (src/net/loiter.ts) and its hand-over in the snapshot buffer: the circle keeps speed
 * and radius, the body faces along the path with the right wing down, and a receiver sees no jump when the away player
 * comes back placed on the circle. Exit code 1 on failure.
 *
 *   npx tsx scripts/net/loiter-test.mts
 */
import { SnapshotBuffer } from '../../src/dragon/remote/buffer';
import { LOITER_BANK_DEG, loiter, loiters } from '../../src/net/loiter';
import { createSnapshot, decodeSnapshot, encodeSnapshot, type DragonSnapshot } from '../../src/net/snapshot';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
  if (!ok) {
    failures++;
  }
}

/** Rotates v by the unit quaternion q = [x, y, z, w]. */
function rotate(q: number[], v: [number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

const away = createSnapshot();
away.t = 50_000;
away.position = [1200, 240, -800];
away.velocity = [18, -1, -24]; // 30 m/s on the ground, heading east of north
away.quaternion = [0, 0, 0, 1];
away.mode = 'gliding';
away.away = true;
const sent = decodeSnapshot(encodeSnapshot(away));

check('a gliding dragon loiters', loiters(sent));
check('a grounded dragon does not', !loiters({ ...sent, mode: 'grounded' } as DragonSnapshot));

const speed = Math.hypot(sent.velocity[0], sent.velocity[2]);
const radius = (speed * speed) / (9.81 * Math.tan((LOITER_BANK_DEG * Math.PI) / 180));
const p0 = loiter(sent, 0, createSnapshot());
check('starts where the snapshot was', Math.hypot(p0.position[0] - sent.position[0], p0.position[2] - sent.position[2]) < 1e-6);
const dt = 0.05;
const a = loiter(sent, 20, createSnapshot());
const b = loiter(sent, 20 + dt, createSnapshot());
const step = Math.hypot(b.position[0] - a.position[0], b.position[2] - a.position[2]);
check('keeps its speed along the circle', Math.abs(step / dt - speed) < 0.05, { measured: step / dt, speed });
check('keeps its altitude', a.position[1] === sent.position[1]);
const half = loiter(sent, (Math.PI * radius) / speed, createSnapshot());
const across = Math.hypot(half.position[0] - sent.position[0], half.position[2] - sent.position[2]);
check('half a turn is one diameter across', Math.abs(across - 2 * radius) < 0.5, { across, diameter: 2 * radius });
const fwd = rotate(a.quaternion, [0, 0, -1]);
const dir = [a.velocity[0] / speed, a.velocity[2] / speed];
check('the body faces along the path', fwd[0] * dir[0] + fwd[2] * dir[1] > 0.99, { fwd, dir });
const right = rotate(a.quaternion, [1, 0, 0]);
check(`banked right by ${LOITER_BANK_DEG}°`, Math.abs(Math.asin(-right[1]) * (180 / Math.PI) - LOITER_BANK_DEG) < 0.1, { right });
// Turning right: the next heading leans towards the current right vector (-vz, vx) on the ground.
check('turns right', -b.velocity[0] * a.velocity[2] + b.velocity[2] * a.velocity[0] > 0);

// Receiver: normal stream, then away, then the player back on the circle 30 s later.
const buffer = new SnapshotBuffer();
const snap = (t: number, x: number) => {
  const s = createSnapshot();
  s.t = t;
  s.position = [x, 240, 0];
  s.velocity = [30, 0, 0];
  s.mode = 'gliding';
  return s;
};
for (let i = 0; i < 10; i++) {
  buffer.push(snap(i * 100, i * 3));
}
const awaySnap = snap(1000, 30);
awaySnap.away = true;
const awayDecoded = decodeSnapshot(encodeSnapshot(awaySnap));
buffer.push(awayDecoded);
const out = createSnapshot();
let t = 0;
let prev: number[] | null = null;
let maxJump = 0;
let resumed = false;
for (let frame = 0; frame < 40 * 60; frame++) {
  t += 1000 / 60;
  if (!resumed && t >= 31_000) {
    // The player is back: placed on the circle at its own clock, then streaming again.
    for (let k = 0; k < 3; k++) {
      const at = loiter(awayDecoded, (t + k * 100 - awayDecoded.t) / 1000, createSnapshot());
      at.away = false;
      buffer.push(at);
    }
    resumed = true;
  }
  buffer.sample(1 / 60, out);
  if (prev) {
    maxJump = Math.max(maxJump, Math.hypot(out.position[0] - prev[0], out.position[2] - prev[2]));
  }
  prev = [...out.position];
}
check('receiver: no jump through away and back (≤ 1 m per frame at 30 m/s)', maxJump < 1, { maxJump });

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
