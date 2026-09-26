/**
 * Activities runtime (phase 13): ring races for now.
 *
 * Start a race from the course picker (Y opens it; Y during a race cancels the race), with ?race=bogaz|halic|adalar,
 * or window.__evrenRaces.start('bogaz') (dev server, sandboxes and ?race= pages). A start teleports the dragon onto the
 * course's lead-in line, runs a 3 s countdown and then times the run gate by gate.
 *
 * Feedback: the race HUD (hud/race-hud.ts: countdown, clock panel, split deltas against the record, warnings, finish
 * card with medal), a marker pointing at the next gate, and the ghost of the best run (hud/ghost-orb.ts) with the live
 * gap to it. A toast only announces the start. Emits 'activity' events (started at GO, every checkpoint, finished,
 * aborted); records (best time, splits, best medal, ghost path) persist per course in localStorage.
 *
 * Idle cost: no per-frame DOM work and the ring pass is disabled while no race, card or picker is shown.
 */
import * as THREE from 'three';
import type { DragonState, EngineContext, GameEvents, System } from '../core/contracts';
import { UpdateOrder } from '../core/contracts';
import { COURSES, getCourse, medalFor } from './courses';
import { GateRings } from './gate-rings';
import { GhostTrack, ghostGap } from './ghost';
import { CoursePicker, type PickerEntry } from './hud/course-picker';
import { GhostOrb } from './hud/ghost-orb';
import { RaceHud } from './hud/race-hud';
import { RingPass } from './ring-pass';
import { RaceSession, courseProgress, type AbortReason, type RaceEvent } from './race';
import { GhostRecorder, clearRecords, decodeGhost, getRecord, loadRecords, submitRun } from './records';
import { RACE_TEXT, formatRaceTime } from './text';

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
  const ghost = new GhostOrb();
  ringPass.scene.add(rings.group, ghost.group);
  let session: RaceSession | null = null;
  let recorder = new GhostRecorder();
  let ghostTrack: GhostTrack | null = null;
  let referenceSplits: readonly number[] | undefined;
  let lingerLeft = 0;
  let pendingUrlCourse: string | null = null;
  let loadingDone = false;
  let ownTeleport = false;
  let lastCourseIndex = -1;
  const lastPos = { x: 0, y: 0, z: 0, valid: false };
  const disposers: Array<() => void> = [];

  // DOM (created in init).
  let hud: RaceHud | null = null;
  let picker: CoursePicker | null = null;
  let pickerRoot: HTMLElement | null = null;
  /** The UI system's root (.ejd) and HUD (.ejd-hud), looked up once they exist. */
  let uiEjd: HTMLElement | null = null;
  let uiHud: HTMLElement | null = null;
  let viewW = 1;
  let viewH = 1;
  const view = new THREE.Vector3();

  const audio = (name: 'ui-click' | 'discover', volume: number): void => {
    ctx?.services.tryGet('audio')?.play(name, volume);
  };

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

  function findUi(): void {
    if (!ctx) {
      return;
    }
    uiEjd ??= ctx.uiRoot.querySelector<HTMLElement>('.ejd:not(.race-ui)');
    uiHud ??= ctx.uiRoot.querySelector<HTMLElement>('.ejd-hud');
  }

  /** The game HUD is on screen (not ?nohud, not hidden with U, no menu, map or photo mode). */
  function hudVisible(): boolean {
    if (!ctx || ctx.debug.nohud) {
      return false;
    }
    return uiHud ? !uiHud.hidden : true;
  }

  /** A menu, the map, photo mode or the start screen owns the screen (or the game is paused). */
  function uiBlocked(): boolean {
    if (!ctx) {
      return true;
    }
    if (ctx.time.paused || !ctx.input.enabled) {
      return true;
    }
    const cl = uiEjd?.classList;
    return !!cl && (cl.contains('is-modal') || cl.contains('is-photo') || cl.contains('is-prestart'));
  }

  /* ---------------- race control ---------------- */

  function start(id: string): boolean {
    const course = getCourse(id);
    if (!course) {
      toast(RACE_TEXT.unknownCourse(id), 'warn');
      return false;
    }
    if (!ctx) {
      return false;
    }
    closePicker();
    if (session?.active) {
      handle(session.abort('cancel'));
    }
    lastCourseIndex = COURSES.findIndex((c) => c.id === id);
    const rec = getRecord(id);
    const splitsMatch = rec?.splits.length === course.gates.length;
    referenceSplits = splitsMatch ? rec!.splits.slice() : undefined;
    session = new RaceSession(course, { bestSplits: referenceSplits });
    recorder = new GhostRecorder();
    ghostTrack = null;
    if (rec?.ghost) {
      const samples = decodeGhost(rec.ghost);
      const track = new GhostTrack(samples, splitsMatch ? { course, splits: rec.splits, finishTime: rec.best } : { finishTime: rec.best });
      ghostTrack = track.valid ? track : null;
    }
    ghost.setTrack(ghostTrack);
    lingerLeft = 0;
    rings.setCourse(course);
    const s = course.start;
    ownTeleport = true;
    ctx.events.emit('teleport', { x: s.x, y: s.y, z: s.z, headingDeg: s.headingDeg, pitchDeg: s.pitchDeg, speed: s.speed });
    ownTeleport = false;
    lastPos.valid = false;
    session.resetTrail();
    hud?.begin(course.def.name, course.gates.length);
    toast(RACE_TEXT.started(course.def.name));
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
          hud?.showCountdown(e.secondsLeft);
          audio('ui-click', 0.35);
          break;
        case 'go':
          hud?.showCountdown('go');
          audio('ui-click', 0.8);
          recorder.reset();
          emitActivity('started', `${name} · ${RACE_TEXT.label.running(1, s.total)}`);
          break;
        case 'gate': {
          rings.setNext(e.index + 1, false);
          if (e.index < s.total - 1) {
            hud?.gate(e.index + 1, e.split, e.bestSplit !== undefined ? e.split - e.bestSplit : undefined);
            audio('ui-click', 0.5);
            emitActivity('checkpoint', `${name} · ${RACE_TEXT.label.running(e.index + 2, s.total)}`);
          }
          break;
        }
        case 'finished': {
          rings.setNext(s.total, true);
          lingerLeft = FINISH_LINGER;
          ghost.hide();
          const medals = course.def.medals;
          const medal = medalFor(e.time, medals);
          const result = submitRun(course.def.id, e.time, e.splits, recorder.count > 1 ? recorder.encode() : undefined, medal);
          hud?.showFinish({
            courseName: name,
            time: e.time,
            medal,
            medals,
            newRecord: result.newRecord,
            previousBest: result.previousBest,
            splits: e.splits,
            referenceSplits,
          });
          const improved = (result.newRecord && result.previousBest !== undefined) || result.newMedal;
          audio('discover', improved ? 1 : 0.7);
          emitActivity('finished', `${name} · ${RACE_TEXT.label.finished} · ${formatRaceTime(e.time)}`);
          break;
        }
        case 'missed':
          hud?.warn(RACE_TEXT.hud.missed(e.expected + 1));
          break;
        case 'wrongWay':
          hud?.warn(RACE_TEXT.hud.wrongWay);
          break;
        case 'strayWarning':
          hud?.warn(RACE_TEXT.hud.stray);
          break;
        case 'aborted':
          hud?.abort(RACE_TEXT.aborted[e.reason]);
          ghost.hide();
          emitActivity('aborted', `${name} · ${RACE_TEXT.label.aborted}`);
          rings.setCourse(null);
          break;
      }
    }
  }

  /* ---------------- picker ---------------- */

  function pickerEntries(): PickerEntry[] {
    return COURSES.map((def) => {
      const c = getCourse(def.id)!;
      const rec = getRecord(def.id);
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        lengthM: c.length,
        gates: c.gates.length,
        best: rec?.best,
        medal: rec?.medal ?? null,
        medals: def.medals,
      };
    });
  }

  function openPicker(): void {
    if (!picker || !pickerRoot) {
      return;
    }
    hud?.closeFinish();
    picker.open(pickerEntries(), lastCourseIndex >= 0 ? lastCourseIndex : 0);
    pickerRoot.hidden = false;
    audio('ui-click', 0.5);
  }

  function closePicker(): void {
    if (picker?.isOpen) {
      picker.close();
    }
    if (pickerRoot) {
      pickerRoot.hidden = true;
    }
  }

  /* ---------------- keys ---------------- */

  const swallow = (e: KeyboardEvent): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  // Capture phase on window: runs before the input system and the UI (bubble listeners), so keys the picker or the
  // finish card use never reach flight controls or the pause menu. Every other key passes through untouched.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!ctx || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    if (picker?.isOpen) {
      const nav = e.code.startsWith('Arrow');
      if ((nav || !e.repeat) && picker.handleKey(e.code)) {
        swallow(e);
      } else if (e.repeat && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Escape' || e.code === RACE_KEY)) {
        swallow(e);
      }
      return;
    }
    if (hud?.finishOpen && hud.shown && (e.code === RACE_KEY || e.code === 'Escape')) {
      if (!e.repeat) {
        hud.closeFinish();
      }
      swallow(e);
      return;
    }
    if (e.code !== RACE_KEY || e.repeat) {
      return;
    }
    findUi();
    if (uiBlocked()) {
      return;
    }
    if (session?.active) {
      cancel('cancel');
    } else if (ctx.debug.nohud || !picker) {
      start(COURSES[(lastCourseIndex + 1) % COURSES.length].id);
    } else {
      openPicker();
    }
  };

  /* ---------------- next-gate marker ---------------- */

  function updateMarker(c: EngineContext): void {
    if (!hud) {
      return;
    }
    const s = session;
    if (!s || !s.active || !dragon || !hud.shown || s.next >= s.total) {
      hud.setMarker(null);
      return;
    }
    const g = s.course.gates[s.next];
    const camera = c.camera;
    camera.updateMatrixWorld();
    view.set(g.x, g.y, g.z).applyMatrix4(camera.matrixWorldInverse);
    const p = dragon.position;
    const distance = Math.hypot(g.x - p.x, g.y - p.y, g.z - p.z);
    const depth = -view.z;
    const vx = view.x;
    const vy = view.y;
    if (depth > camera.near) {
      view.applyMatrix4(camera.projectionMatrix);
      const x = (view.x * 0.5 + 0.5) * viewW;
      const y = (0.5 - view.y * 0.5) * viewH;
      const inset = 24;
      if (x >= inset && x <= viewW - inset && y >= inset && y <= viewH - inset) {
        const rPx = (g.radius * viewH * 0.5) / (Math.tan((camera.fov * Math.PI) / 360) * depth);
        const ly = Math.min(viewH - 28, y + Math.min(rPx, viewH * 0.35) + 8);
        hud.setMarker({ onScreen: true, x, y: ly, distance, width: viewW, height: viewH });
        return;
      }
      hud.setMarker({ onScreen: false, x: view.x * viewW, y: -view.y * viewH, distance, width: viewW, height: viewH });
      return;
    }
    // Behind the camera: the view-space x/y still say which way to turn; straight behind points down.
    const len = Math.hypot(vx, vy);
    hud.setMarker({ onScreen: false, x: len > 1e-3 ? vx : 0, y: len > 1e-3 ? -vy : 1, distance, width: viewW, height: viewH });
  }

  /* ---------------- debug hook ---------------- */

  function installDebugHook(): void {
    const hook = {
      courses: () =>
        COURSES.map((c) => ({ id: c.id, name: c.name, gates: c.gates.length, lengthM: Math.round(getCourse(c.id)!.length), medals: { ...c.medals } })),
      start: (id: string): boolean => start(id),
      cancel: (): void => cancel('cancel'),
      /** Opens (default) or closes the course picker. */
      picker: (open = true): boolean => {
        if (open) {
          openPicker();
        } else {
          closePicker();
        }
        return !!picker?.isOpen;
      },
      state: () =>
        session
          ? {
              course: session.course.def.id,
              phase: session.phase,
              next: session.next,
              total: session.total,
              elapsed: session.elapsed,
              splits: session.splits.slice(),
              ghost: ghost.visible,
              picker: !!picker?.isOpen,
              finishCard: !!hud?.finishOpen,
            }
          : { phase: 'idle' as const, picker: !!picker?.isOpen },
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

      hud = new RaceHud(c.uiRoot);
      pickerRoot = document.createElement('div');
      pickerRoot.className = 'ejd race-ui race-ui-picker';
      pickerRoot.setAttribute('lang', 'tr');
      pickerRoot.hidden = true;
      c.uiRoot.append(pickerRoot);
      picker = new CoursePicker(pickerRoot, {
        onStart: (id) => {
          audio('ui-click', 0.7);
          start(id);
        },
        onClose: () => {
          closePicker();
          audio('ui-click', 0.4);
        },
        onMove: () => audio('ui-click', 0.3),
      });
      viewW = Math.max(1, c.canvas.clientWidth || window.innerWidth);
      viewH = Math.max(1, c.canvas.clientHeight || window.innerHeight);
      findUi();

      disposers.push(
        c.events.on('loading-done', () => {
          loadingDone = true;
          findUi();
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
      window.addEventListener('keydown', onKeyDown, true);
      disposers.push(() => window.removeEventListener('keydown', onKeyDown, true));
      // Console hook for testers and tooling: dev server, sandboxes and ?race= only (like the UI and flight hooks).
      if (raceParam || c.sandbox || import.meta.env.DEV) {
        installDebugHook();
      }
    },

    update(dt, c) {
      // the pass only runs (one full-screen copy + the markers) while rings or the ghost are shown
      ringPass.enabled = rings.group.visible || ghost.visible;
      if (pendingUrlCourse && loadingDone && dragon) {
        const id = pendingUrlCourse;
        pendingUrlCourse = null;
        start(id);
      }
      if (picker?.isOpen && uiBlocked()) {
        // A menu, the map or photo mode took over: the picker steps aside.
        closePicker();
      }
      if (hud?.busy) {
        const on = hudVisible();
        hud.setVisible(on);
        hud.update(on ? c.time.realDt : 0);
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
      if (session.phase === 'running') {
        if (dt > 0) {
          recorder.push(dt, p.x, p.y, p.z);
        }
        hud?.setRunning(session.elapsed, session.splits.length, session.total);
        if (grounded && dt > 0) {
          hud?.warn(RACE_TEXT.hud.landing);
        }
        ghost.update(session.elapsed, c.time.elapsed);
        hud?.setGhostGap(ghostTrack ? ghostGap(ghostTrack, session.elapsed, courseProgress(session.course, session.next, p)) : null);
      } else if (session.phase === 'countdown') {
        ghost.update(0, c.time.elapsed);
      }
    },

    preRender(c) {
      if (hud?.busy) {
        updateMarker(c);
      }
    },

    onResize(width, height) {
      viewW = Math.max(1, width);
      viewH = Math.max(1, height);
    },

    dispose() {
      for (const d of disposers.splice(0)) {
        d();
      }
      ctx?.pipeline.removeHdrPass(ringPass);
      rings.dispose();
      ghost.dispose();
      ringPass.dispose();
      hud?.dispose();
      picker?.dispose();
      pickerRoot?.remove();
      hud = null;
      picker = null;
      pickerRoot = null;
      ctx = null;
    },
  };
}

