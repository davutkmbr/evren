/**
 * Race balance of the flow system (phase 20 stage D, chain bursts), headless (no browser, no GPU): scripted pilots fly
 * every built-in course through the real FlightSim over the real terrain (terrain-only collision, calm noon air) and
 * the times are checked against the medal targets (tools/headless/flow/race-pilot.ts).
 *
 *   npx tsx tools/headless/race-balance.ts            # table; exits 1 when a balance rule fails
 *   npx tsx tools/headless/race-balance.ts halic      # one course
 *   npx tsx tools/headless/race-balance.ts --seeds 5  # more seeds for the chaining racers (the best counts)
 *
 * Three racers: plain (no moves), some chaining (chains on every other leg: SOME_PILOT) and chained (chains on every
 * leg; flies both skilled lines, with and without the low line over the water, as a practising player tries lines).
 * Rules (owner decision 26 Sep: finishing earns bronze, clean flying silver, flow gold): every run finishes; plain
 * earns silver with a margin (a run 10 % slower still earns silver, one 1.4× slower still earns bronze); some chaining
 * earns silver but not gold; the best chained run earns gold and is 15–25 % faster than the plain run.
 */
import { COURSES, compileCourse, LESSON_COURSE, medalFor, type MedalTimes } from '../../src/activities/courses';
import { LESSON_STEPS, LessonRunner } from '../../src/activities/lesson';
import { formatTargetTime } from '../../src/activities/text';
import { buildHeadlessGeo } from './geo';
import { DEFAULT_PILOT, flyRace, SOME_PILOT, type PilotOptions, type RaceRun } from './flow/race-pilot';
import { createHeadlessSim, LiftEnv } from './lift-sim';

const args = process.argv.slice(2);
const seedsArg = args.indexOf('--seeds');
const SEEDS = seedsArg >= 0 ? Number(args[seedsArg + 1]) : 3;
const only = args.find((a) => !a.startsWith('--') && Number.isNaN(Number(a)));
/** The chained racer's lines: the low line over the water (skim, zoom back to the gate) and the straight one. */
const LINES: Array<{ name: string; opts: PilotOptions }> = [
  { name: 'skim line', opts: DEFAULT_PILOT },
  { name: 'straight line', opts: { ...DEFAULT_PILOT, skimLine: false } },
];
const GAP_MIN = 0.15;
const GAP_MAX = 0.25;

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
const gapOf = (plain: RaceRun, r: RaceRun): number => (plain.time - r.time) / plain.time;

export interface Balance {
  course: string;
  plain: RaceRun;
  some: RaceRun;
  chained: RaceRun;
  medals: MedalTimes;
  /** Every seed's run (the rules use the best; the spread shows how robust the gap is). */
  someRuns: RaceRun[];
  chainedRuns: RaceRun[];
}

function best(runs: RaceRun[]): RaceRun {
  return runs.reduce((a, b) => (b.time < a.time ? b : a));
}

function describe(label: string, r: RaceRun): void {
  console.log(
    `  ${r.course} ${label}: ${fmt(r.time)} s, flow mean ${r.meanFlow.toFixed(2)}, links ${r.links} (longest chain ${r.bestChain}, bursts +${r.burstDv.toFixed(0)} m/s), moments ${r.moments}, misses ${r.misses}, moves ${JSON.stringify(r.moves)}`,
  );
}

const results: Balance[] = [];
for (const def of COURSES) {
  if (only && def.id !== only) {
    continue;
  }
  const course = compileCourse(def);
  const plain = flyRace(createHeadlessSim(geo, env), course, 'plain');
  describe('plain', plain);
  const some: RaceRun[] = [];
  const chained: RaceRun[] = [];
  for (let s = 1; s <= SEEDS; s++) {
    const r = flyRace(createHeadlessSim(geo, env), course, 'chained', s, 600, SOME_PILOT);
    describe(`some chaining seed ${s}`, r);
    some.push(r);
    for (const line of LINES) {
      const c = flyRace(createHeadlessSim(geo, env), course, 'chained', s, 600, line.opts);
      describe(`chained (${line.name}) seed ${s}`, c);
      chained.push(c);
    }
  }
  results.push({ course: def.id, plain, some: best(some), chained: best(chained), medals: def.medals, someRuns: some, chainedRuns: chained });
}

console.log('\nCourse     plain (s)  some (s)  chained (s)  gap some / chained   flow plain/some/chained   V plain/chained    medals (gold/silver/bronze)');
for (const r of results) {
  const m = r.medals;
  console.log(
    `${r.course.padEnd(10)} ${fmt(r.plain.time).padStart(9)} ${fmt(r.some.time).padStart(9)} ${fmt(r.chained.time).padStart(12)}  ${(gapOf(r.plain, r.some) * 100).toFixed(1).padStart(6)} % / ${(gapOf(r.plain, r.chained) * 100).toFixed(1).padStart(5)} %      ${r.plain.meanFlow.toFixed(2)} / ${r.some.meanFlow.toFixed(2)} / ${r.chained.meanFlow.toFixed(2)}        ${r.plain.meanSpeed.toFixed(1)} / ${r.chained.meanSpeed.toFixed(1)} m/s   ${formatTargetTime(m.gold)} / ${formatTargetTime(m.silver)} / ${formatTargetTime(m.bronze)}  (${medalFor(r.plain.time, m) ?? '—'} / ${medalFor(r.some.time, m) ?? '—'} / ${medalFor(r.chained.time, m) ?? '—'})`,
  );
}
/** Mean, standard deviation, min and max of the gap to plain (%) over every seed and line. */
function spread(plain: RaceRun, runs: RaceRun[]): string {
  const g = runs.map((r) => gapOf(plain, r) * 100);
  const mean = g.reduce((a, b) => a + b, 0) / g.length;
  const sd = Math.sqrt(g.reduce((a, b) => a + (b - mean) ** 2, 0) / g.length);
  const median = [...g].sort((a, b) => a - b)[Math.floor(g.length / 2)];
  return `mean ${mean.toFixed(1)} ± ${sd.toFixed(1)} %, median ${median.toFixed(1)} %, range ${Math.min(...g).toFixed(1)}–${Math.max(...g).toFixed(1)} % (n ${g.length})`;
}
console.log('\nSpread of the gap to plain over seeds (the plain racer is deterministic):');
for (const r of results) {
  console.log(`  ${r.course.padEnd(8)} some:    ${spread(r.plain, r.someRuns)}`);
  console.log(`  ${r.course.padEnd(8)} chained: ${spread(r.plain, r.chainedRuns)}`);
}
console.log('');
for (const r of results) {
  const gap = gapOf(r.plain, r.chained);
  check(r.plain.finished && r.some.finished && r.chained.finished, `${r.course}: every run finishes (${r.plain.splits.length} / ${r.some.splits.length} / ${r.chained.splits.length} gates)`);
  check(medalFor(r.plain.time, r.medals) === 'silver', `${r.course}: the plain run earns silver, not gold (${fmt(r.plain.time)} s vs silver ${r.medals.silver} s, gold ${r.medals.gold} s)`);
  check(medalFor(r.plain.time * 1.1, r.medals) === 'silver', `${r.course}: a plain run 10 % slower still earns silver (${fmt(r.plain.time * 1.1)} s vs ${r.medals.silver} s)`);
  check(medalFor(r.plain.time * 1.4, r.medals) === 'bronze', `${r.course}: a slow, wandering finish (1.4× plain) still earns bronze (${fmt(r.plain.time * 1.4)} s vs ${r.medals.bronze} s)`);
  check(medalFor(r.some.time, r.medals) === 'silver', `${r.course}: some chaining earns silver, not gold (${fmt(r.some.time)} s vs silver ${r.medals.silver} s, gold ${r.medals.gold} s)`);
  check(medalFor(r.chained.time, r.medals) === 'gold', `${r.course}: sustained chaining earns gold (${fmt(r.chained.time)} s vs ${r.medals.gold} s)`);
  check(gap >= GAP_MIN && gap <= GAP_MAX, `${r.course}: the chained run is ${GAP_MIN * 100}–${GAP_MAX * 100} % faster than plain (${(gap * 100).toFixed(1)} %)`);
}
// The guided chain practice (lesson.ts): a chaining racer flying its course completes every step (the events come
// from the real sim: move starts and chain links).
if (!only || only === LESSON_COURSE.id) {
  const course = compileCourse(LESSON_COURSE);
  let bestDone = 0;
  const lines: string[] = [];
  for (let s = 1; s <= SEEDS; s++) {
    const sim = createHeadlessSim(geo, env);
    const lesson = new LessonRunner();
    const doneAt: string[] = [];
    const emit = sim.emit.bind(sim);
    sim.emit = (e) => {
      emit(e);
      if (e.type === 'maneuver' && !e.ended && lesson.move(e.id)) {
        doneAt.push(`${lesson.index}@${sim.time.toFixed(0)}s`);
      } else if (e.type === 'chain' && lesson.link(e.link, e.source)) {
        doneAt.push(`${lesson.index}@${sim.time.toFixed(0)}s`);
      }
    };
    const r = flyRace(sim, course, 'chained', s, 600, DEFAULT_PILOT);
    bestDone = Math.max(bestDone, lesson.index);
    lines.push(`  lesson seed ${s}: ${lesson.index}/${lesson.steps.length} steps (${doneAt.join(' ')}), course ${fmt(r.time)} s`);
  }
  console.log(lines.join('\n'));
  check(bestDone === LESSON_STEPS.length, `the chain practice can be completed by a chaining racer (${bestDone}/${LESSON_STEPS.length} steps)`);
}
if (args.includes('--json')) {
  console.log(JSON.stringify(results.map((r) => ({ course: r.course, plain: r.plain.time, some: r.some.time, chained: r.chained.time, flow: r.chained.meanFlow }))));
}
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall race balance checks passed');
process.exit(failures.length ? 1 : 0);
