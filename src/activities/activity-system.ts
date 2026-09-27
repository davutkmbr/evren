/**
 * Activities runtime (phase 13): ring races and the course editor.
 *
 * Start a race from the course picker (Y opens it; Y during a race cancels the race), with ?race=<course id>, or
 * window.__evrenRaces.start('bogaz') (dev server, sandboxes and ?race= pages). A start teleports the dragon onto the
 * course's lead-in line, runs a 3 s countdown and then times the run gate by gate.
 *
 * Feedback (race UI v2): the race HUD (hud/race-hud.ts: start screen with countdown, clock, split deltas against the
 * record, warnings, speed ring callout, and the result screen hud/finish-screen.ts with medal and the per-gate delta
 * chart), a marker pointing at the next gate, and the ghost of the best run (hud/ghost-orb.ts) with the live gap to
 * it; the ghost can be switched off in the picker (remembered per player, race-prefs.ts). A toast only announces the
 * start. The result screen: Enter races the same course again, Y opens the picker, Esc closes it.
 * Emits 'activity' events (started at GO, every checkpoint, finished, aborted); records (best time, splits, best
 * medal, ghost path, run count) persist per course in localStorage.
 *
 * Speed rings (races only): flying through one pushes the dragon forward (speed-boost.ts: +10 m/s over 1.5 s, capped
 * under the dive envelope) with a whoosh and a short camera shake. DragonState.velocity is flight telemetry (copied
 * from the physics body every frame and never read back), so writing it does nothing. The push goes through an
 * optional `addVelocity(dx, dy, dz)` on the dragon service when flight provides one (spread over the envelope);
 * until then it is applied once at the ring through the 'teleport' event with the boosted speed (same position,
 * heading and pitch; the flight resets roll and the camera re-snaps).
 *
 * Course editor (picker → Yeni parkur [N] or E on a custom course): fly around, B places a gate (or a speed ring) at
 * the dragon with its flight direction, Backspace removes the last one, K switches gate / speed ring, J cycles the gate
 * size, Enter saves under a name, Y leaves. Custom courses (custom-courses.ts) appear in the picker with records,
 * medals and ghosts like the built-in ones, and travel as share codes (K copies, I pastes).
 *
 * Idle cost: no per-frame DOM work and the ring pass is disabled while no race, card, picker or editor is shown.
 */
import * as THREE from 'three';
import type { DragonState, EngineContext, GameEvents, System } from '../core/contracts';
import { UpdateOrder } from '../core/contracts';
import { COURSES, getCourse, LESSON_COURSE, medalFor, type CompiledCourse } from './courses';
import { LESSON_FINISHED_TEXT, LessonRunner } from './lesson';
import {
  CUSTOM_LIMIT,
  MIN_GATES,
  compileCustomCourse,
  decodeCourseCode,
  deleteCustomCourse,
  encodeCourseCode,
  getCustomCourse,
  loadCustomCourses,
  saveCustomCourse,
  type CustomCourse,
  type PlacementProbe,
} from './custom-courses';
import { CourseEditor } from './editor';
import { GateRings } from './gate-rings';
import { GhostTrack, ghostGap } from './ghost';
import { CoursePicker, type PickerEntry } from './hud/course-picker';
import { EDITOR_KEYS, EditorPanel, type EditorLabel } from './hud/editor-panel';
import { GhostOrb } from './hud/ghost-orb';
import { RaceHud } from './hud/race-hud';
import { RingPass } from './ring-pass';
import { RaceSession, courseProgress, passTightness, type AbortReason, type RaceEvent } from './race';
import { loadGhostEnabled, saveGhostEnabled } from './race-prefs';
import { GhostRecorder, clearRecords, decodeGhost, getRecord, loadRecords, recordRuns, submitRun } from './records';
import { BoostEnvelope, boostDeltaV } from './speed-boost';
import { SpeedRingMesh } from './speed-ring-mesh';
import { RACE_TEXT, formatRaceTime, skippedWarning, type SkipReason } from './text';

/** Seconds the rings stay visible (in the finish colour) after the finish. */
const FINISH_LINGER = 5;
/** A jump larger than this in one frame (m) is a teleport, not flight. */
const TELEPORT_JUMP = 400;
const RACE_KEY = 'KeyY';
/** Keys of the result screen (see finishKey). */
const FINISH_KEYS: ReadonlySet<string> = new Set(['Enter', 'NumpadEnter', 'Escape', RACE_KEY]);
/** Camera shake of a speed ring (m of offset amplitude; a roar is 0.12). */
const BOOST_SHAKE = 0.2;
/** Seconds a second Y press confirms leaving the editor with unsaved changes. */
const EXIT_CONFIRM_SECONDS = 4;
/** Flight modes a speed ring pushes (airborne flight). */
const BOOST_MODES: ReadonlySet<DragonState['mode']> = new Set(['flying', 'gliding', 'diving', 'stalling']);

export function createActivitySystem(): System {
  let ctx: EngineContext | null = null;
  let dragon: DragonState | null = null;
  const rings = new GateRings();
  const speedRings = new SpeedRingMesh();
  const ringPass = new RingPass();
  const ghost = new GhostOrb();
  ringPass.scene.add(rings.group, speedRings.mesh, ghost.group);
  let session: RaceSession | null = null;
  let recorder = new GhostRecorder();
  let ghostTrack: GhostTrack | null = null;
  let referenceSplits: readonly number[] | undefined;
  let lingerLeft = 0;
  let pendingUrlCourse: string | null = null;
  let loadingDone = false;
  let ownTeleport = false;
  /** The teleport being emitted is a speed ring push: the run and its trail continue. */
  let boostTeleport = false;
  let lastCourseId: string | null = null;
  /** The guided chain practice's steps while its course runs (lesson.ts). */
  let lesson: LessonRunner | null = null;
  const lastPos = { x: 0, y: 0, z: 0, valid: false };
  const disposers: Array<() => void> = [];
  const boost = new BoostEnvelope();
  let pendingShake = 0;

  // Editor.
  const editor = new CourseEditor();
  let editing = false;
  let exitArmedLeft = 0;

  // Text fields (picker paste field, editor name): game input is off while one has focus.
  let typing = false;
  let inputDisabledByUs = false;

  // DOM (created in init).
  let hud: RaceHud | null = null;
  let picker: CoursePicker | null = null;
  let pickerRoot: HTMLElement | null = null;
  let editorPanel: EditorPanel | null = null;
  let editorRoot: HTMLElement | null = null;
  /** The UI system's root (.ejd) and HUD (.ejd-hud), looked up once they exist. */
  let uiEjd: HTMLElement | null = null;
  let uiHud: HTMLElement | null = null;
  let viewW = 1;
  let viewH = 1;
  const view = new THREE.Vector3();
  const probeSphere = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  const audio = (name: 'ui-click' | 'discover' | 'whoosh', volume: number): void => {
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

  function modalOpen(): boolean {
    findUi();
    const cl = uiEjd?.classList;
    return !!cl && (cl.contains('is-modal') || cl.contains('is-photo') || cl.contains('is-prestart'));
  }

  /** A menu, the map, photo mode or the start screen owns the screen (or the game is paused). */
  function uiBlocked(): boolean {
    if (!ctx) {
      return true;
    }
    if (ctx.time.paused || (!ctx.input.enabled && !inputDisabledByUs)) {
      return true;
    }
    return modalOpen();
  }

  /** A text field of ours gained or lost focus: game input off while typing, restored after (unless a menu took it). */
  function setTyping(on: boolean): void {
    if (!ctx) {
      return;
    }
    typing = on;
    if (on) {
      if (ctx.input.enabled) {
        ctx.input.enabled = false;
        inputDisabledByUs = true;
      }
    } else if (inputDisabledByUs) {
      inputDisabledByUs = false;
      // A menu that opened meanwhile owns input now; it re-enables it when it closes.
      if (!modalOpen()) {
        ctx.input.enabled = true;
      }
    }
  }

  /* ---------------- courses ---------------- */

  function customDescription(c: CustomCourse): string {
    return RACE_TEXT.picker.customDesc(c.rings.length);
  }

  /** Built-in or custom course by id. */
  function resolveCourse(id: string): CompiledCourse | undefined {
    const builtIn = getCourse(id);
    if (builtIn) {
      return builtIn;
    }
    const custom = getCustomCourse(id);
    return custom ? compileCustomCourse(custom, customDescription(custom)) : undefined;
  }

  function allCourseIds(): string[] {
    return [...COURSES.map((c) => c.id), LESSON_COURSE.id, ...loadCustomCourses().map((c) => c.id)];
  }

  /* ---------------- race control ---------------- */

  function start(id: string): boolean {
    const course = resolveCourse(id);
    if (!course) {
      toast(RACE_TEXT.unknownCourse(id), 'warn');
      return false;
    }
    if (!ctx) {
      return false;
    }
    closePicker();
    if (editing) {
      exitEditor(true);
    }
    if (session?.active) {
      handle(session.abort('cancel'));
    }
    lastCourseId = id;
    const rec = getRecord(id);
    const splitsMatch = rec?.splits.length === course.gates.length;
    referenceSplits = splitsMatch ? rec!.splits.slice() : undefined;
    session = new RaceSession(course, { bestSplits: referenceSplits });
    lesson = course.def.lesson ? new LessonRunner() : null;
    recorder = new GhostRecorder();
    ghostTrack = null;
    if (rec?.ghost && loadGhostEnabled() && !lesson) {
      const samples = decodeGhost(rec.ghost);
      const track = new GhostTrack(samples, splitsMatch ? { course, splits: rec.splits, finishTime: rec.best } : { finishTime: rec.best });
      ghostTrack = track.valid ? track : null;
    }
    ghost.setTrack(ghostTrack);
    lingerLeft = 0;
    boost.cancel();
    rings.setCourse(course);
    speedRings.set(course.speedRings);
    const s = course.start;
    ownTeleport = true;
    ctx.events.emit('teleport', { x: s.x, y: s.y, z: s.z, headingDeg: s.headingDeg, pitchDeg: s.pitchDeg, speed: s.speed });
    ownTeleport = false;
    lastPos.valid = false;
    session.resetTrail();
    hud?.begin({
      name: course.def.name,
      gates: course.gates.length,
      rings: course.speedRings.length,
      medals: course.def.medals,
      ghostBest: ghostTrack ? rec?.best : undefined,
      lesson: !!lesson,
    });
    toast(RACE_TEXT.started(course.def.name));
    handle(session.start());
    return true;
  }

  function cancel(reason: AbortReason = 'cancel'): void {
    if (session?.active) {
      handle(session.abort(reason));
    }
  }

  function hideCourse(): void {
    rings.setCourse(null);
    speedRings.set([]);
    boost.cancel();
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
          showLessonStep();
          emitActivity('started', `${name} · ${RACE_TEXT.label.running(1, s.total)}`);
          break;
        case 'gate': {
          notePass(course.gates[e.index], 'gate');
          rings.setNext(e.index + 1, false);
          if (e.index < s.total - 1) {
            hud?.gate(e.split, e.bestSplit !== undefined ? e.split - e.bestSplit : undefined);
            audio('ui-click', 0.5);
            emitActivity('checkpoint', `${name} · ${RACE_TEXT.label.running(e.index + 2, s.total)}`);
          }
          break;
        }
        case 'boost':
          notePass(course.speedRings[e.index], 'ring');
          speedRings.markUsed(e.index);
          startBoost();
          break;
        case 'finished': {
          rings.setNext(s.total, true);
          lingerLeft = FINISH_LINGER;
          ghost.hide();
          if (lesson) {
            // The practice keeps no time, medal or record: a closing line, then the course fades out.
            const l = lesson;
            lesson = null;
            hud?.end();
            hud?.lessonPraise(RACE_TEXT.lesson.finished(l.index, l.steps.length));
            audio('discover', l.done ? 1 : 0.7);
            emitActivity('finished', `${name} · ${RACE_TEXT.lesson.finished(l.index, l.steps.length)}`);
            break;
          }
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
            gates: course.gates,
            ringsUsed: s.boostsUsed.filter(Boolean).length,
            ringsTotal: course.speedRings.length,
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
          lesson = null;
          hud?.abort(RACE_TEXT.aborted[e.reason]);
          ghost.hide();
          emitActivity('aborted', `${name} · ${RACE_TEXT.label.aborted}`);
          hideCourse();
          break;
      }
    }
  }

  /** A gate or speed ring passed: tells flight how snug it was (the flow system's use of the world, chain links). */
  function notePass(ring: { x: number; y: number; z: number; radius: number } | undefined, kind: 'gate' | 'ring'): void {
    const d = dragon;
    if (!d || !ring || typeof d.notePass !== 'function') {
      return;
    }
    const p = d.position;
    d.notePass(passTightness(ring.radius, Math.hypot(p.x - ring.x, p.y - ring.y, p.z - ring.z)), kind);
  }

  /* ---------------- speed ring boost ---------------- */

  function startBoost(): void {
    const d = dragon;
    if (!d || !ctx || !BOOST_MODES.has(d.mode)) {
      return;
    }
    const push = boostDeltaV(d.airspeed);
    if (push >= 0.5) {
      hud?.boost(Math.round(push));
    }
    audio('whoosh', 0.9);
    // Next frame: a teleport re-snaps the camera this frame, which clears any shake added before it.
    pendingShake = BOOST_SHAKE;
    const hook = d.addVelocity;
    if (typeof hook === 'function') {
      boost.start(d.airspeed);
      return;
    }
    const dv = boostDeltaV(d.airspeed);
    if (dv <= 0) {
      return;
    }
    // Fallback: the whole push at once, through the teleport event (same place, heading and nose pitch).
    tmpDir.set(0, 0, -1).applyQuaternion(d.quaternion);
    const pitchDeg = (Math.asin(Math.max(-1, Math.min(1, tmpDir.y))) * 180) / Math.PI;
    const p = d.position;
    boostTeleport = true;
    ctx.events.emit('teleport', { x: p.x, y: p.y, z: p.z, headingDeg: d.headingDeg, pitchDeg, speed: d.airspeed + dv });
    boostTeleport = false;
  }

  /** Smooth push through the flight hook (only when flight provides one). */
  function stepBoost(dt: number): void {
    const d = dragon;
    if (!d || !boost.active) {
      return;
    }
    const hook = d.addVelocity;
    if (typeof hook !== 'function' || !BOOST_MODES.has(d.mode)) {
      boost.cancel();
      return;
    }
    const dv = boost.step(dt, d.airspeed);
    const v = d.velocity;
    const len = v.length();
    if (dv > 0 && len > 1) {
      hook.call(d, (v.x / len) * dv, (v.y / len) * dv, (v.z / len) * dv);
    }
  }

  /* ---------------- editor ---------------- */

  function placementProbe(): PlacementProbe {
    const geo = ctx?.services.tryGet('geo');
    const col = ctx?.services.tryGet('collision');
    return {
      terrainAt: (x, z) => (geo ? geo.heightAt(x, z) : (col?.terrainHeight(x, z) ?? 0)),
      surfaceAt: col ? (x, z) => col.surfaceHeight(x, z) : undefined,
      solidAt: col
        ? (x, y, z, r) => {
            probeSphere.set(x, y, z);
            return col.resolveSphere(probeSphere, Math.min(r, 1.5)) !== null;
          }
        : undefined,
    };
  }

  function startEditor(from?: CustomCourse): boolean {
    if (!ctx || !editorPanel) {
      return false;
    }
    if (session?.active) {
      toast(RACE_TEXT.editorToast.busy, 'warn');
      return false;
    }
    closePicker();
    hud?.closeFinish();
    lingerLeft = 0;
    hideCourse();
    editor.reset(from);
    editing = true;
    exitArmedLeft = 0;
    editorPanel.setOpen(true);
    refreshEditor();
    toast(RACE_TEXT.editorToast.started);
    audio('ui-click', 0.6);
    return true;
  }

  function exitEditor(force = false): void {
    if (!editing) {
      return;
    }
    if (!force && editor.dirty && exitArmedLeft <= 0) {
      exitArmedLeft = EXIT_CONFIRM_SECONDS;
      toast(RACE_TEXT.editorToast.exitConfirm, 'warn');
      return;
    }
    editing = false;
    exitArmedLeft = 0;
    editorPanel?.setOpen(false);
    rings.setCourse(null);
    speedRings.set([]);
    if (!force) {
      toast(RACE_TEXT.editorToast.exited);
    }
  }

  function refreshEditor(): void {
    rings.showEditor(
      editor.previewGates(),
      editor.gates.map((g) => !!g.problem),
    );
    speedRings.set(
      editor.previewRings(),
      editor.rings.map((r) => !!r.problem),
    );
    editorPanel?.update({
      sourceName: editor.sourceName,
      gates: editor.gates.length,
      rings: editor.rings.length,
      invalid: editor.gates.filter((g) => !!g.problem).length + editor.rings.filter((r) => !!r.problem).length,
      validGates: editor.validGates,
      kind: editor.kind,
      size: editor.size,
      lengthM: editor.length,
    });
  }

  function editorPlace(): void {
    const d = dragon;
    if (!d) {
      return;
    }
    const p = d.position;
    const v = d.velocity;
    const r = editor.place({ x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, headingDeg: d.headingDeg }, placementProbe());
    const t = RACE_TEXT.editorToast;
    if (!r.ok) {
      toast(t.refused[r.reason], 'warn');
      audio('ui-click', 0.3);
      return;
    }
    if (r.problem === 'terrain' || r.problem === 'structure') {
      toast(t.invalid[r.problem], 'warn');
    } else {
      toast(r.kind === 'gate' ? t.placedGate(r.index + 1) : t.placedRing(r.index + 1));
    }
    audio('ui-click', 0.7);
    refreshEditor();
  }

  function editorSave(): void {
    if (!editorPanel || editorPanel.naming) {
      return;
    }
    if (editor.validGates < MIN_GATES) {
      toast(RACE_TEXT.editorToast.tooFew(editor.validGates, MIN_GATES), 'warn');
      return;
    }
    const fallback = editor.sourceName ?? `Parkurum ${loadCustomCourses().length + 1}`;
    const reasons = (list: ReadonlyArray<{ problem: string | null }>): SkipReason[] =>
      list.flatMap((v) => (v.problem === 'terrain' || v.problem === 'structure' ? [v.problem] : []));
    editorPanel.askName(
      fallback,
      skippedWarning(reasons(editor.gates), reasons(editor.rings)),
      (name) => finishSave(name.trim() ? name : fallback),
      () => undefined,
    );
  }

  function finishSave(name: string): void {
    const t = RACE_TEXT.editorToast;
    const built = editor.build(name, placementProbe());
    if (!built.ok) {
      toast(built.error === 'tooFew' ? t.tooFew(built.valid, MIN_GATES) : t.leadIn, 'warn');
      refreshEditor();
      return;
    }
    const saved = saveCustomCourse(built.course, editor.sourceId);
    if (!saved.ok) {
      toast(saved.error === 'limit' ? t.limit(CUSTOM_LIMIT) : t.duplicate, 'warn');
      return;
    }
    if (editor.sourceId && editor.sourceId !== saved.course.id) {
      // The geometry changed: the old records and ghost belong to a course that no longer exists.
      clearRecords(editor.sourceId);
    }
    toast(t.saved(saved.course.name));
    if (built.skippedGates || built.skippedRings) {
      toast(t.skipped(built.skippedGates, built.skippedRings), 'warn');
    }
    audio('discover', 0.6);
    exitEditor(true);
    lastCourseId = saved.course.id;
    openPicker();
  }

  function updateEditor(c: EngineContext): void {
    if (exitArmedLeft > 0) {
      exitArmedLeft -= c.time.realDt;
    }
    const blocked = uiBlocked();
    if (blocked && editorPanel?.naming) {
      // A menu took over while typing the name: the question is withdrawn (the editor stays open).
      editorPanel.cancelName();
    }
    editorPanel?.setVisible(hudVisible() && !modalOpen());
    rings.animate(c.time.elapsed);
  }

  /** Projects a world point to screen pixels; null when behind the camera or off screen. */
  function project(c: EngineContext, x: number, y: number, z: number): { x: number; y: number } | null {
    view.set(x, y, z).applyMatrix4(c.camera.matrixWorldInverse);
    if (-view.z <= c.camera.near) {
      return null;
    }
    view.applyMatrix4(c.camera.projectionMatrix);
    const sx = (view.x * 0.5 + 0.5) * viewW;
    const sy = (0.5 - view.y * 0.5) * viewH;
    return sx < -40 || sx > viewW + 40 || sy < -40 || sy > viewH + 40 ? null : { x: sx, y: sy };
  }

  function problemText(problem: string | null): string | undefined {
    return problem === 'terrain' || problem === 'structure' ? RACE_TEXT.editor.problem[problem] : undefined;
  }

  function updateEditorLabels(c: EngineContext): void {
    if (!editorPanel) {
      return;
    }
    if (!editing || !hudVisible() || modalOpen()) {
      editorPanel.setLabels([]);
      return;
    }
    c.camera.updateMatrixWorld();
    const items: EditorLabel[] = [];
    editor.gates.forEach((g, i) => {
      const s = project(c, g.x, g.y + g.r + 6, g.z);
      if (s) {
        items.push({ x: s.x, y: s.y, text: String(i + 1), ring: false, reason: problemText(g.problem) });
      }
    });
    editor.rings.forEach((r, i) => {
      const s = project(c, r.x, r.y + 18, r.z);
      if (s) {
        items.push({ x: s.x, y: s.y, text: `H${i + 1}`, ring: true, reason: problemText(r.problem) });
      }
    });
    editorPanel.setLabels(items);
  }

  /* ---------------- guided chain practice ---------------- */

  /** The current lesson step on the hint line (or the closing line once every step is done). */
  function showLessonStep(): void {
    const l = lesson;
    if (!l || !hud) {
      return;
    }
    const step = l.step;
    const label = RACE_TEXT.lesson.step(Math.min(l.index + 1, l.steps.length), l.steps.length);
    if (step) {
      hud.lessonStep(step.text, step.hints, label);
    } else {
      hud.lessonStep(LESSON_FINISHED_TEXT, [['Y', RACE_TEXT.countdown.cancel]], label);
    }
  }

  /** A lesson step was done: praise, a chime and the next step. */
  function lessonAdvanced(done: { done: string } | null): void {
    if (!done) {
      return;
    }
    hud?.lessonPraise(done.done);
    audio('discover', 0.6);
    showLessonStep();
  }

  /* ---------------- picker ---------------- */

  function pickerEntry(c: CompiledCourse): PickerEntry {
    const rec = getRecord(c.def.id);
    return {
      id: c.def.id,
      name: c.def.name,
      description: c.def.description,
      lengthM: c.length,
      gates: c.gates.length,
      rings: c.speedRings.length,
      best: rec?.best,
      medal: rec?.medal ?? null,
      medals: c.def.medals,
      runs: recordRuns(rec),
      custom: !!c.def.custom,
      lesson: !!c.def.lesson,
      hasGhost: !!rec?.ghost,
      route: { gates: c.gates.map((g) => ({ x: g.x, y: g.z })), rings: c.speedRings.map((r) => ({ x: r.x, y: r.z })) },
    };
  }

  function pickerEntries(): PickerEntry[] {
    return [
      ...COURSES.map((def) => pickerEntry(getCourse(def.id)!)),
      pickerEntry(getCourse(LESSON_COURSE.id)!),
      ...loadCustomCourses().map((custom) => pickerEntry(compileCustomCourse(custom, customDescription(custom)))),
    ];
  }

  /** Gives the picker's route map its land / water background once the world is loaded. */
  let pickerWater = false;
  function ensurePickerWater(): void {
    const geo = pickerWater ? null : ctx?.services.tryGet('geo');
    if (geo && picker) {
      pickerWater = true;
      picker.setWater((x, z, cell) => Math.max(0, Math.min(1, 0.5 - geo.coastDistance(x, z) / cell)));
    }
  }

  function openPicker(selectId?: string): void {
    if (!picker || !pickerRoot) {
      return;
    }
    hud?.closeFinish();
    if (picker.isOpen) {
      picker.close();
    }
    ensurePickerWater();
    picker.open(pickerEntries(), selectId ?? lastCourseId ?? undefined, loadGhostEnabled());
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

  function importCode(code: string): string | null {
    const res = decodeCourseCode(code);
    if (!res.ok) {
      return RACE_TEXT.share.errors[res.error];
    }
    const saved = saveCustomCourse(res.course);
    if (!saved.ok) {
      return saved.error === 'limit' ? RACE_TEXT.editorToast.limit(CUSTOM_LIMIT) : RACE_TEXT.editorToast.duplicate;
    }
    toast(RACE_TEXT.share.imported(saved.course.name));
    audio('discover', 0.5);
    openPicker(saved.course.id);
    return null;
  }

  function copyCode(id: string): void {
    const custom = getCustomCourse(id);
    if (!custom) {
      return;
    }
    const code = encodeCourseCode(custom);
    const fallback = (): void => {
      picker?.showCode(code);
      toast(RACE_TEXT.share.copyFallback);
    };
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clip?.writeText) {
      fallback();
      return;
    }
    clip.writeText(code).then(
      () => {
        toast(RACE_TEXT.share.copied);
        audio('ui-click', 0.5);
      },
      fallback,
    );
  }

  function removeCourse(id: string): void {
    const custom = getCustomCourse(id);
    if (!custom) {
      return;
    }
    const ids = allCourseIds();
    const at = ids.indexOf(id);
    deleteCustomCourse(id);
    clearRecords(id);
    if (lastCourseId === id) {
      lastCourseId = null;
    }
    toast(RACE_TEXT.share.deleted(custom.name));
    audio('ui-click', 0.5);
    const rest = allCourseIds();
    openPicker(rest[Math.min(at, rest.length - 1)]);
  }

  /* ---------------- keys ---------------- */

  const swallow = (e: KeyboardEvent): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  /** Result screen: Enter races the same course again, Y opens the picker on it, Esc closes the screen. */
  function finishKey(code: string): void {
    if (code === 'Escape') {
      hud?.closeFinish();
      audio('ui-click', 0.4);
    } else if (code === RACE_KEY) {
      openPicker();
    } else if (lastCourseId) {
      audio('ui-click', 0.7);
      start(lastCourseId);
    }
  }

  /** Editor keys (only while the editor is open and nothing else owns the screen). */
  function editorKey(e: KeyboardEvent): boolean {
    const k = EDITOR_KEYS;
    switch (e.code) {
      case k.place.code:
        if (!e.repeat) {
          editorPlace();
        }
        return true;
      case k.undo.code:
        if (!e.repeat) {
          const removed = editor.undo();
          toast(removed ? RACE_TEXT.editorToast.removed : RACE_TEXT.editorToast.nothingToRemove);
          audio('ui-click', 0.4);
          refreshEditor();
        }
        return true;
      case k.kind.code:
        if (!e.repeat) {
          editor.toggleKind();
          audio('ui-click', 0.4);
          refreshEditor();
        }
        return true;
      case k.size.code:
        if (!e.repeat) {
          editor.cycleSize();
          if (editor.kind === 'ring') {
            editor.toggleKind();
          }
          audio('ui-click', 0.4);
          refreshEditor();
        }
        return true;
      case k.save.code:
      case 'NumpadEnter':
        if (!e.repeat) {
          editorSave();
        }
        return true;
      case k.exit.code:
        if (!e.repeat) {
          exitEditor();
        }
        return true;
      default:
        return false;
    }
  }

  // Capture phase on window: runs before the input system and the UI (bubble listeners), so keys the picker, the
  // editor or the finish card use never reach flight controls or the pause menu. Every other key passes through.
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
    if (editing) {
      if (!uiBlocked() && !editorPanel?.naming && editorKey(e)) {
        swallow(e);
      }
      return;
    }
    if (hud?.finishOpen && hud.shown && !uiBlocked() && FINISH_KEYS.has(e.code)) {
      if (!e.repeat) {
        finishKey(e.code);
      }
      swallow(e);
      return;
    }
    if (e.code !== RACE_KEY || e.repeat) {
      return;
    }
    if (uiBlocked()) {
      return;
    }
    if (session?.active) {
      cancel('cancel');
    } else if (ctx.debug.nohud || !picker) {
      const ids = allCourseIds();
      start(ids[(Math.max(-1, ids.indexOf(lastCourseId ?? '')) + 1) % ids.length]);
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
        allCourseIds().map((id) => {
          const c = resolveCourse(id)!;
          return { id, name: c.def.name, gates: c.gates.length, speedRings: c.speedRings.length, lengthM: Math.round(c.length), medals: { ...c.def.medals }, custom: !!c.def.custom };
        }),
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
              boostsUsed: session.boostsUsed.slice(),
              ghost: ghost.visible,
              picker: !!picker?.isOpen,
              finishCard: !!hud?.finishOpen,
              editing,
            }
          : { phase: 'idle' as const, picker: !!picker?.isOpen, editing },
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
      /** Course editor: open (optionally on a custom course), place / undo at the dragon, save, close. */
      editor: {
        open: (id?: string): boolean => startEditor(id ? getCustomCourse(id) : undefined),
        place: (): void => editorPlace(),
        undo: (): void => {
          editor.undo();
          refreshEditor();
        },
        save: (name: string): void => finishSave(name),
        close: (): void => exitEditor(true),
        state: () => ({ editing, kind: editor.kind, size: editor.size, gates: editor.gates.map((g) => ({ ...g })), rings: editor.rings.map((r) => ({ ...r })) }),
      },
      customCourses: () => loadCustomCourses().map((c) => ({ ...c })),
      exportCourse: (id: string): string | null => {
        const c = getCustomCourse(id);
        return c ? encodeCourseCode(c) : null;
      },
      importCourse: (code: string): string | null => importCode(code),
      deleteCourse: (id: string): void => removeCourse(id),
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

      hud = new RaceHud(
        c.uiRoot,
        {
          onRetry: () => finishKey('Enter'),
          onCourses: () => finishKey(RACE_KEY),
          onClose: () => finishKey('Escape'),
        },
        () => c.services.tryGet('hudZones'),
      );
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
        onNew: () => startEditor(),
        onEdit: (id) => {
          const custom = getCustomCourse(id);
          if (custom) {
            startEditor(custom);
          }
        },
        onDelete: (id) => removeCourse(id),
        onCopy: (id) => copyCode(id),
        onImport: (code) => importCode(code),
        onTyping: (on) => setTyping(on),
        onGhost: (on) => {
          saveGhostEnabled(on);
          audio('ui-click', 0.4);
        },
      });
      editorRoot = document.createElement('div');
      editorRoot.className = 'ejd race-ui race-ui-editor';
      editorRoot.setAttribute('lang', 'tr');
      c.uiRoot.append(editorRoot);
      editorPanel = new EditorPanel(editorRoot, (on) => setTyping(on));
      viewW = Math.max(1, c.canvas.clientWidth || window.innerWidth);
      viewH = Math.max(1, c.canvas.clientHeight || window.innerHeight);
      findUi();

      disposers.push(
        c.events.on('loading-done', () => {
          loadingDone = true;
          findUi();
        }),
        c.events.on('maneuver', ({ id }) => {
          if (lesson && session?.phase === 'running') {
            lessonAdvanced(lesson.move(id));
          }
        }),
        c.events.on('chain-link', ({ link, source }) => {
          if (lesson && session?.phase === 'running') {
            lessonAdvanced(lesson.link(link, source));
          }
        }),
        c.events.on('teleport', () => {
          if (boostTeleport) {
            // A speed ring push: same place, the run and its trail go on.
            return;
          }
          // Someone else moved the dragon (map teleport, view preset): the run is void.
          if (!ownTeleport && session?.active) {
            cancel('teleport');
          }
          lastPos.valid = false;
          session?.resetTrail();
          boost.cancel();
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
      // the pass only runs (one full-screen copy + the markers) while rings, speed rings or the ghost are shown
      ringPass.enabled = rings.group.visible || speedRings.visible || ghost.visible;
      if (pendingUrlCourse && loadingDone && dragon) {
        const id = pendingUrlCourse;
        pendingUrlCourse = null;
        start(id);
      }
      if (picker?.isOpen && uiBlocked()) {
        // A menu, the map or photo mode took over: the picker steps aside.
        closePicker();
      }
      // While a race is prepared, run, aborting or its result is open, the HUD zones defer the area title and the
      // compass landmark label (the next gate is the target).
      c.services.tryGet('hudZones')?.setContext('race', !!session?.active || !!hud?.holdsScreen);
      // The practice shows its own keys: the next-move hint (ui/hud/chain-hint.ts) steps aside.
      c.services.tryGet('hudZones')?.setContext('lesson', !!lesson && !!session?.active);
      // A running race (countdown included): full-size chain bursts and full-strength speed effects (flight, camera, fx).
      const racing = !!session?.active;
      if (dragon && !!dragon.racing !== racing) {
        dragon.setRacing?.(racing);
      }
      if (hud?.busy) {
        const on = hudVisible();
        hud.setVisible(on);
        hud.update(on ? c.time.realDt : 0);
      }
      if (pendingShake > 0 && dt > 0) {
        c.services.tryGet('cameraRig')?.shake(pendingShake);
        pendingShake = 0;
      }
      stepBoost(dt);
      if (speedRings.visible) {
        speedRings.animate(c.time.elapsed);
      }
      if (editing) {
        updateEditor(c);
      }
      if (!session || !dragon) {
        return;
      }
      if (!editing) {
        rings.animate(c.time.elapsed);
      }
      if (lingerLeft > 0) {
        lingerLeft -= c.time.realDt;
        if (lingerLeft <= 0 && !session.active && !editing) {
          hideCourse();
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
      // A hard landing is no landing of the player's: it only costs its time (phase 04).
      const grounded = (mode === 'grounded' || mode === 'landing' || mode === 'swimming') && !dragon.hardLanding;
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
      if (editing) {
        updateEditorLabels(c);
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
      if (typing) {
        setTyping(false);
      }
      ctx?.pipeline.removeHdrPass(ringPass);
      rings.dispose();
      speedRings.dispose();
      ghost.dispose();
      ringPass.dispose();
      hud?.dispose();
      picker?.dispose();
      pickerRoot?.remove();
      editorPanel?.dispose();
      editorRoot?.remove();
      hud = null;
      picker = null;
      pickerRoot = null;
      editorPanel = null;
      editorRoot = null;
      ctx = null;
    },
  };
}
