/**
 * Race balance of the flow system (phase 20 stage D), headless (no browser, no GPU): a scripted pilot flies every
 * built-in course through the real FlightSim over the real terrain (terrain-only collision, calm noon air), plainly and
 * with chained moves (tools/headless/flow/race-pilot.ts), and reports both times against the medal targets.
 *
 *   npx tsx tools/headless/race-balance.ts            # table; exits 1 when a balance rule fails
 *   npx tsx tools/headless/race-balance.ts --seeds 3  # chained runs with 3 seeds (the best counts)
 *
 * Rules: every run finishes; the plain run earns silver (bronze and silver are reachable without moves) but not gold;
 * the best chained run earns gold and is 6–10 % faster than the plain run.
 */
import { COURSES, compileCourse, medalFor, type MedalTimes } from '../../src/activities/courses';
import { formatTargetTime } from '../../src/activities/text';
import { buildHeadlessGeo } from './geo';
import { flyRace, type RaceRun } from './flow/race-pilot';
import { createHeadlessSim, LiftEnv } from './lift-sim';

const args = process.argv.slice(2);
const seedsArg = args.indexOf('--seeds');
const SEEDS = seedsArg >= 0 ? Number(args[seedsArg + 1]) : 3;
const only = args.find((a) => !a.startsWith('--') && Number.isNaN(Number(a)));

const failures: string[] = [];
const check = (ok: boolean, label: string): void => {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (!ok) {
    failures.push(label);
  }
};

const geo = buildHeadlessGeo();
const env = new LiftEnv(12, 'calm');
const fmt = (t: number): string => (Number.isFinite(t) ? t.toFixed(1) : 'DNF');

export interface Balance {
  course: string;
  plain: RaceRun;
  chained: RaceRun;
  medals: MedalTimes;
}

const results: Balance[] = [];
for (const def of COURSES) {
  if (only && def.id !== only) {
    continue;
  }
  const course = compileCourse(def);
  const plain = flyRace(createHeadlessSim(geo, env), course, 'plain');
  let best: RaceRun | null = null;
  for (let s = 1; s <= SEEDS; s++) {
    const r = flyRace(createHeadlessSim(geo, env), course, 'chained', s);
    console.log(
      `  ${def.id} chained seed ${s}: ${fmt(r.time)} s, flow mean ${r.meanFlow.toFixed(2)} max ${r.maxFlow.toFixed(2)}, moments ${r.moments}, moves ${JSON.stringify(r.moves)}`,
    );
    if (!best || r.time < best.time) {
      best = r;
    }
  }
  results.push({ course: def.id, plain, chained: best!, medals: def.medals });
}

console.log('\nCourse     plain (s)  chained (s)  gain    flow plain/chained   V plain/chained   medals (gold/silver/bronze)');
for (const r of results) {
  const gain = (r.plain.time - r.chained.time) / r.plain.time;
  console.log(
    `${r.course.padEnd(10)} ${fmt(r.plain.time).padStart(9)} ${fmt(r.chained.time).padStart(12)}  ${(gain * 100).toFixed(1).padStart(5)} %  ${r.plain.meanFlow.toFixed(2)} / ${r.chained.meanFlow.toFixed(2)}          ${r.plain.meanSpeed.toFixed(1)} / ${r.chained.meanSpeed.toFixed(1)} m/s   ${formatTargetTime(r.medals.gold)} / ${formatTargetTime(r.medals.silver)} / ${formatTargetTime(r.medals.bronze)}  (${medalFor(r.plain.time, r.medals) ?? '—'} / ${medalFor(r.chained.time, r.medals) ?? '—'})`,
  );
}
console.log('');
for (const r of results) {
  const gain = (r.plain.time - r.chained.time) / r.plain.time;
  check(r.plain.finished && r.chained.finished, `${r.course}: both runs finish (${r.plain.splits.length} / ${r.chained.splits.length} gates)`);
  check(medalFor(r.plain.time, r.medals) === 'silver', `${r.course}: the plain run earns silver, not gold (${fmt(r.plain.time)} s vs silver ${r.medals.silver} s, gold ${r.medals.gold} s)`);
  check(medalFor(r.chained.time, r.medals) === 'gold', `${r.course}: the chained run earns gold (${fmt(r.chained.time)} s vs ${r.medals.gold} s)`);
  check(gain >= 0.06 && gain <= 0.1, `${r.course}: chained run 6–10 % faster than plain (${(gain * 100).toFixed(1)} %)`);
}
if (args.includes('--json')) {
  console.log(JSON.stringify(results.map((r) => ({ course: r.course, plain: r.plain.time, chained: r.chained.time, flow: r.chained.meanFlow }))));
}
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall race balance checks passed');
process.exit(failures.length ? 1 : 0);
