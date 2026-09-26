/**
 * Activities runtime (phase 13): ring races for now.
 *
 * Start a race with ?race=bogaz|halic|adalar, the Y key (starts the next course in turn; Y during a race cancels it)
 * or window.__evrenRaces.start('bogaz') (dev server, sandboxes and ?race= pages). A start teleports the dragon onto the course's lead-in line, runs a 3 s
 * countdown and then times the run gate by gate. Emits 'activity' events (started at GO, every checkpoint, finished,
 * aborted) and Turkish toasts; records (best time, splits, ghost path) persist per course in localStorage.
 */
import type { DragonState, EngineContext, GameEvents, System } from '../core/contracts';
import { UpdateOrder } from '../core/contracts';
import { COURSES, getCourse, type CompiledCourse } from './courses';
import { GateRings } from './gate-rings';
import { RingPass } from './ring-pass';
import { RaceSession, type AbortReason, type RaceEvent } from './race';
import { GhostRecorder, clearRecords, getRecord, loadRecords, submitRun } from './records';
import { RACE_TEXT, formatDelta, formatTime } from './text';

/** Seconds the rings stay visible (in the finish colour) after the finish. */
const FINISH_LINGER = 5;
/** A jump larger than this in one frame (m) is a teleport, not flight. */
const TELEPORT_JUMP = 400;
const RACE_KEY = 'KeyY';

export function createActivitySystem(): System {
  let ctx: EngineContext | null = null;
  let dragon: DragonState | null = null;
  const rings = new GateRings();
  const ringPass = new RingPass();
  ringPass.scene.add(rings.group);
  let session: RaceSession | null = null;
  let recorder = new GhostRecorder();
  let lingerLeft = 0;
  let pendingUrlCourse: string | null = null;
  let loadingDone = false;
  let ownTeleport = false;
  let lastCourseIndex = -1;
  const lastPos = { x: 0, y: 0, z: 0, valid: false };
  const disposers: Array<() => void> = [];

  const toast = (text: string, kind: 'info' | 'warn' = 'info'): void => {
    ctx?.events.emit('toast', { text, kind });
  };

  const emitActivity = (state: GameEvents['activity']['state'], label: string): void => {
    if (!ctx || !session) {
      return;
    }
    const rec = getRecord(session.course.def.id);
    ctx.events.emit('activity', {
      activityId: `race:${session.course.def.id}`,
      state,
      checkpoint: session.splits.length,
      total: session.total,
      elapsed: session.elapsed,
      best: rec?.best,
      label,
    });
  };

  function start(id: string): boolean {
    const course = getCourse(id);
    if (!course) {
      toast(RACE_TEXT.unknownCourse(id), 'warn');
      return false;
    }
    if (!ctx) {
      return false;
    }
    if (session?.active) {
      handle(session.abort('cancel'));
    }
    lastCourseIndex = COURSES.findIndex((c) => c.id === id);
    const rec = getRecord(id);
    session = new RaceSession(course, { bestSplits: rec?.splits.length === course.gates.length ? rec.splits : undefined });
    recorder = new GhostRecorder();
    lingerLeft = 0;
    rings.setCourse(course);
    const s = course.start;
    ownTeleport = true;
    ctx.events.emit('teleport', { x: s.x, y: s.y, z: s.z, headingDeg: s.headingDeg, pitchDeg: s.pitchDeg, speed: s.speed });
    ownTeleport = false;
    lastPos.valid = false;
    session.resetTrail();
    handle(session.start());
    return true;
  }

  function cancel(reason: AbortReason = 'cancel'): void {
    if (session?.active) {
      handle(session.abort(reason));
    }
  }

  function handle(events: readonly RaceEvent[]): void {
    const s = session;
    if (!s) {
      return;
    }
    const course = s.course;
    const name = course.def.name;
    for (const e of events) {
      switch (e.type) {
        case 'countdown':
          toast(RACE_TEXT.countdown(name, e.secondsLeft));
          break;
        case 'go':
          toast(RACE_TEXT.go(name));
          ctx?.services.tryGet('audio')?.play('ui-click', 0.8);
          recorder.reset();
          emitActivity('started', `${name} · ${RACE_TEXT.label.running(1, s.total)}`);
          break;
        case 'gate': {
          rings.setNext(e.index + 1, false);
          const label = course.gates[e.index].label;
          const delta = e.bestSplit !== undefined ? ` (${formatDelta(e.split - e.bestSplit)})` : '';
          const where = label && e.index > 0 ? ` · ${label}` : '';
          if (e.index < s.total - 1) {
            toast(`${RACE_TEXT.gate(e.index + 1, s.total, formatTime(e.split))}${where}${delta}`);
            ctx?.services.tryGet('audio')?.play('ui-click', 0.5);
            emitActivity('checkpoint', `${name} · ${RACE_TEXT.label.running(e.index + 2, s.total)}`);
          }
          break;
        }
        case 'finished': {
          rings.setNext(s.total, true);
          lingerLeft = FINISH_LINGER;
          const result = submitRun(course.def.id, e.time, e.splits, recorder.count > 1 ? recorder.encode() : undefined);
          toast(RACE_TEXT.finished(name, formatTime(e.time)));
          if (result.previousBest === undefined) {
            toast(RACE_TEXT.firstRecord);
          } else if (result.newRecord) {
            toast(RACE_TEXT.newRecord(formatDelta(e.time - result.previousBest)));
          } else {
            toast(RACE_TEXT.noRecord(formatTime(result.previousBest), formatDelta(e.time - result.previousBest)));
          }
          ctx?.services.tryGet('audio')?.play('discover', 0.8);
          emitActivity('finished', `${name} · ${RACE_TEXT.label.finished} · ${formatTime(e.time)}`);
          break;
        }
        case 'missed':
          toast(RACE_TEXT.missed(e.expected + 1), 'warn');
          break;
        case 'wrongWay':
          toast(RACE_TEXT.wrongWay, 'warn');
          break;
        case 'strayWarning':
          toast(RACE_TEXT.strayWarning, 'warn');
          break;
        case 'aborted':
          toast(RACE_TEXT.aborted[e.reason], 'warn');
          emitActivity('aborted', `${name} · ${RACE_TEXT.label.aborted}`);
          rings.setCourse(null);
          break;
      }
    }
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== RACE_KEY || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !ctx || !ctx.input.enabled || ctx.time.paused) {
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    if (session?.active) {
      cancel('cancel');
    } else {
      start(COURSES[(lastCourseIndex + 1) % COURSES.length].id);
    }
  };

  function installDebugHook(): void {
    const hook = {
      courses: () => COURSES.map((c) => ({ id: c.id, name: c.name, gates: c.gates.length, lengthM: Math.round(getCourse(c.id)!.length) })),
      start: (id: string): boolean => start(id),
      cancel: (): void => cancel('cancel'),
      state: () =>
        session
          ? { course: session.course.def.id, phase: session.phase, next: session.next, total: session.total, elapsed: session.elapsed, splits: session.splits.slice() }
          : { phase: 'idle' as const },
      records: () => loadRecords(),
      clearRecords: (id?: string): void => clearRecords(id),
      /** Teleports to just before gate `index` of a running race (testing). */
      skipTo: (index: number): boolean => {
        if (!session?.active || !ctx) {
          return false;
        }
        const g = session.course.gates[Math.max(0, Math.min(session.total - 1, index))];
        const h = Math.hypot(g.nx, g.nz) || 1;
        const back = 150;
        ownTeleport = true;
        ctx.events.emit('teleport', {
          x: g.x - (g.nx / h) * back,
          y: g.y,
          z: g.z - (g.nz / h) * back,
          headingDeg: ((Math.atan2(g.nx, -g.nz) * 180) / Math.PI + 360) % 360,
          pitchDeg: 0,
          speed: 35,
        });
        ownTeleport = false;
        lastPos.valid = false;
        session.resetTrail();
        return true;
      },
    };
    (window as unknown as { __evrenRaces?: typeof hook }).__evrenRaces = hook;
    disposers.push(() => {
      const w = window as unknown as { __evrenRaces?: typeof hook };
      if (w.__evrenRaces === hook) {
        delete w.__evrenRaces;
      }
    });
  }

  return {
    name: 'activities',
    order: UpdateOrder.World + 10,

    init(c) {
      ctx = c;
      c.pipeline.addHdrPass(ringPass);
      dragon = c.services.tryGet('dragon') ?? null;
      if (!dragon) {
        void c.services.when('dragon').then((d) => (dragon = d));
      }
      const raceParam = c.debug.params.get('race');
      if (raceParam) {
        pendingUrlCourse = raceParam;
      }
      disposers.push(
        c.events.on('loading-done', () => {
          loadingDone = true;
        }),
        c.events.on('teleport', () => {
          // Someone else moved the dragon (map teleport, view preset): the run is void.
          if (!ownTeleport && session?.active) {
            cancel('teleport');
          }
          lastPos.valid = false;
          session?.resetTrail();
        }),
      );
      window.addEventListener('keydown', onKeyDown);
      disposers.push(() => window.removeEventListener('keydown', onKeyDown));
      // Console hook for testers and tooling: dev server, sandboxes and ?race= only (like the UI and flight hooks).
      if (raceParam || c.sandbox || import.meta.env.DEV) {
        installDebugHook();
      }
    },

    update(dt, c) {
      // the pass only runs (one full-screen copy + the markers) while rings are shown
      ringPass.enabled = rings.group.visible;
      if (pendingUrlCourse && loadingDone && dragon) {
        const id = pendingUrlCourse;
        pendingUrlCourse = null;
        start(id);
      }
      if (!session || !dragon) {
        return;
      }
      rings.animate(c.time.elapsed);
      if (lingerLeft > 0) {
        lingerLeft -= c.time.realDt;
        if (lingerLeft <= 0 && !session.active) {
          rings.setCourse(null);
        }
      }
      if (!session.active) {
        return;
      }
      const p = dragon.position;
      if (lastPos.valid && Math.hypot(p.x - lastPos.x, p.y - lastPos.y, p.z - lastPos.z) > TELEPORT_JUMP) {
        session.resetTrail();
      }
      lastPos.x = p.x;
      lastPos.y = p.y;
      lastPos.z = p.z;
      lastPos.valid = true;
      const mode = dragon.mode;
      const grounded = mode === 'grounded' || mode === 'landing' || mode === 'swimming';
      handle(session.update(dt, p, grounded));
      if (session.phase === 'running' && dt > 0) {
        recorder.push(dt, p.x, p.y, p.z);
      }
    },

    dispose() {
      for (const d of disposers.splice(0)) {
        d();
      }
      ctx?.pipeline.removeHdrPass(ringPass);
      rings.dispose();
      ringPass.dispose();
      ctx = null;
    },
  };
}
