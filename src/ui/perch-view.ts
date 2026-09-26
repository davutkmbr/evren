/**
 * Perching and the viewing mode on the screen (phase 03). Reads DragonState.perch every frame and:
 * - offers a perch in reach with a key-first prompt on the shared hint line ("[L] Kon: Galata Kulesi"), words a
 *   refused landing politely, and names the way out during the approach;
 * - once perched: fades the HUD down to nothing but the zones (the city is the interface), shows the perch's name and
 *   info in the title zone (with "Yeni seyir noktası" the first time: perching is the perch's discovery), switches
 *   the camera to the perch camera and back, runs the time-lapse (T) and keeps a quiet hint line of the viewing keys;
 * - records the perches visited (localStorage) and emits the 'perch' event.
 * Photo mode (O) and the camera cycle (C) are the UI's and the camera's own keys; the flight model leaves the perch on
 * Space / L.
 */
import type { CameraMode, DragonPerchState, EngineContext, PerchPoint } from '../core/contracts';
import { el, TextSlot } from './dom';
import type { DiscoveryTracker } from './discovery/discovery-tracker';
import { perchShortName } from './menu/places';
import type { Toasts } from './overlays/toasts';
import { loadVisitedPerches, saveVisitedPerches } from './prefs';
import { fadeBinding, HUD_PRIORITY, ZONE_CLASS, type HudDirector } from './zones';

/** Time-lapse: game minutes per real second at full speed, and the ramp up / down (s). */
export const TIMELAPSE_SCALE = 36;
export const TIMELAPSE_RAMP = 1.6;
/** Seconds the full viewing hint line stays after perching or a viewing key; then only the way out remains. */
const VIEW_HINTS_S = 14;
/** Seconds the perch title holds: the first visit (with the info text) and later visits (name and info again). */
const TITLE_FIRST_S = 9;
const TITLE_AGAIN_S = 5;

const PROMPT_ID = 'perch.prompt';
const VIEW_ID = 'perch.view';
const TITLE_ID = 'perch.title';

const CAMERA_LABELS: Record<string, string> = { orbit: 'yörünge', fixed: 'sabit', rider: 'binici gözü', other: 'yörünge' };

export class PerchViewing {
  private readonly title: TextSlot;
  private readonly info: TextSlot;
  private readonly isNew: HTMLElement;
  /** Title zone node: the perch's name, a rule, the info text. */
  readonly root: HTMLElement;
  private readonly binding: { onShow: () => void; onHide: () => void };
  private readonly visited = loadVisitedPerches();
  private phase: DragonPerchState['phase'] = 'free';
  private offerId = '';
  private refusals = 0;
  private perched: PerchPoint | null = null;
  private cameraBefore: CameraMode | null = null;
  private hintKey = '';
  private hintsFor = 0;
  /** Time-lapse: on / off, the ramp 0..1 and the player's own day speed it returns to. */
  private timelapse = false;
  private ramp = 0;
  private baseScale = 0;
  private hudPerched = false;

  constructor(
    private readonly ctx: EngineContext,
    private readonly zones: HudDirector,
    private readonly toasts: Toasts,
    private readonly tracker: DiscoveryTracker,
    private readonly hudRoot: HTMLElement,
  ) {
    const titleNode = el('span', 'at-title');
    const infoNode = el('p', 'pt-info');
    this.isNew = el('span', 'pt-new', 'Yeni seyir noktası');
    this.title = new TextSlot(titleNode);
    this.info = new TextSlot(infoNode);
    this.root = el('div', `${ZONE_CLASS.title} hud-area hud-perch`, [this.isNew, titleNode, el('i', 'at-rule'), infoNode], { role: 'status', 'aria-live': 'polite' });
    this.binding = fadeBinding(this.root);
  }

  /** The perches perched on so far (discovery progress). */
  get visitedCount(): number {
    return this.visited.size;
  }

  /** True while the dragon sits on a perch (the viewing mode). */
  get viewing(): boolean {
    return this.phase === 'perched';
  }

  /** Every frame while the game runs; `live` = no menu, map or photo mode. */
  update(realDt: number, live: boolean): void {
    const perch = this.ctx.services.tryGet('dragon')?.perch;
    if (!perch) {
      return;
    }
    // A teleport from one perch straight onto another stays 'perched' within the frame: the perch itself changed.
    const moved = perch.phase === 'perched' && this.perched !== null && perch.point !== null && perch.point.id !== this.perched.id;
    if (perch.phase !== this.phase || moved) {
      this.onPhase(this.phase, perch.phase, perch);
      this.phase = perch.phase;
    }
    if (perch.refusals !== this.refusals) {
      this.refusals = perch.refusals;
      this.toasts.push('Buraya şu an konulamıyor: yol kapalı. Biraz uzaklaşıp başka yönden yaklaş.', 'warn', 'perch');
    }
    this.updatePrompt(perch);
    if (this.phase === 'perched') {
      this.updateViewing(realDt, live);
    }
    this.updateTimelapse(realDt);
  }

  /** Leaves the viewing mode's own state (teleports, disposal). */
  dispose(): void {
    this.zones.release(PROMPT_ID);
    this.zones.release(VIEW_ID);
    this.zones.release(TITLE_ID);
    this.setHudPerched(false);
    this.stopTimelapse(true);
  }

  /* ---------------- phases ---------------- */

  private onPhase(from: DragonPerchState['phase'], to: DragonPerchState['phase'], perch: DragonPerchState): void {
    if (to === 'approach') {
      this.zones.request({ id: VIEW_ID, zone: 'lowerCenter', priority: HUD_PRIORITY.perch, hints: [['L', 'Vazgeç']] });
    } else if (from === 'approach') {
      this.zones.release(VIEW_ID);
    }
    if (from === 'perched') {
      this.leaveViewing();
    }
    if (to === 'perched' && perch.point) {
      this.enterViewing(perch.point);
    }
  }

  private enterViewing(point: PerchPoint): void {
    this.perched = point;
    const first = !this.visited.has(point.id);
    if (first) {
      this.visited.add(point.id);
      saveVisitedPerches(this.visited);
      this.ctx.services.tryGet('audio')?.play('discover');
    }
    if (point.landmarkId) {
      // Perching on a landmark discovers it too (silently: the perch's title says it).
      this.tracker.markDiscovered(point.landmarkId);
    }
    this.ctx.events.emit('perch', { id: point.id, state: 'perched', first });
    this.zones.request({
      id: TITLE_ID,
      zone: 'title',
      priority: HUD_PRIORITY.discovery,
      duration: first ? TITLE_FIRST_S : TITLE_AGAIN_S,
      maxWait: 6,
      onShow: () => {
        this.title.set(point.name);
        this.info.set(point.info);
        this.isNew.hidden = !first;
        this.binding.onShow();
      },
      onHide: this.binding.onHide,
    });
    // The perch camera (the cinematic mode frames the perch's view while perched); the rider's eyes stay if chosen.
    const rig = this.ctx.services.tryGet('cameraRig');
    if (rig && rig.mode !== 'pov' && rig.mode !== 'free') {
      this.cameraBefore = rig.mode;
      rig.setMode('cinematic');
    } else {
      this.cameraBefore = rig?.mode === 'pov' ? 'pov' : null;
    }
    this.hintsFor = VIEW_HINTS_S;
    this.hintKey = '';
    this.setHudPerched(true);
  }

  private leaveViewing(): void {
    const point = this.perched;
    this.perched = null;
    this.zones.release(VIEW_ID);
    this.setHudPerched(false);
    this.stopTimelapse(false);
    const rig = this.ctx.services.tryGet('cameraRig');
    if (rig && rig.mode !== 'free') {
      rig.setMode(this.cameraBefore ?? 'third');
    }
    this.cameraBefore = null;
    if (point) {
      this.ctx.events.emit('perch', { id: point.id, state: 'left', first: false });
    }
  }

  /* ---------------- prompt ---------------- */

  private updatePrompt(perch: DragonPerchState): void {
    const offer = perch.phase === 'free' ? perch.offer : null;
    const id = offer?.id ?? '';
    if (id === this.offerId) {
      return;
    }
    this.offerId = id;
    if (!offer) {
      this.zones.release(PROMPT_ID);
      return;
    }
    this.zones.request({ id: PROMPT_ID, zone: 'lowerCenter', priority: HUD_PRIORITY.perch, hints: [['L', `Kon: ${perchShortName(offer)}`]] });
  }

  /* ---------------- viewing ---------------- */

  private updateViewing(realDt: number, live: boolean): void {
    const input = this.ctx.input;
    if (live && input.enabled) {
      if (input.wasPressed('stand')) {
        if (this.timelapse) {
          this.stopTimelapse(false);
        } else {
          this.startTimelapse();
        }
        this.hintsFor = VIEW_HINTS_S;
      }
      if (input.wasPressed('camera')) {
        this.hintsFor = VIEW_HINTS_S;
      }
    }
    this.hintsFor = Math.max(0, this.hintsFor - realDt);
    const camera = CAMERA_LABELS[this.ctx.services.tryGet('cameraRig')?.perchCamera ?? 'orbit'] ?? 'yörünge';
    const full = this.hintsFor > 0;
    const key = `${full ? 1 : 0}|${this.timelapse ? 1 : 0}|${camera}`;
    if (key === this.hintKey) {
      return;
    }
    this.hintKey = key;
    const hints: Array<readonly [string, string]> = [['Space', 'Havalan']];
    if (full) {
      hints.push(['T', this.timelapse ? 'Normal zaman' : 'Zamanı hızlandır'], ['O', 'Fotoğraf'], ['C', `Kamera: ${camera}`]);
    } else if (this.timelapse) {
      hints.push(['T', 'Normal zaman']);
    }
    this.zones.request({ id: VIEW_ID, zone: 'lowerCenter', priority: HUD_PRIORITY.perch, hints });
  }

  /** The HUD's static parts (compass, bottom cluster, minimap) fade out while perched. */
  private setHudPerched(on: boolean): void {
    if (on !== this.hudPerched) {
      this.hudPerched = on;
      this.hudRoot.classList.toggle('is-perched', on);
    }
  }

  /* ---------------- time-lapse ---------------- */

  private startTimelapse(): void {
    if (!this.timelapse && this.ramp <= 0) {
      this.baseScale = this.ctx.time.dayTimeScale;
    }
    this.timelapse = true;
    this.toasts.push('Zaman hızlandı · gün batımını, şehrin ışıklarını izle', 'info', 'perch');
  }

  /** Ends the time-lapse with the smooth ramp back (or at once). */
  private stopTimelapse(instant: boolean): void {
    if (!this.timelapse && this.ramp <= 0) {
      return;
    }
    this.timelapse = false;
    if (instant) {
      this.ramp = 0;
      this.ctx.time.dayTimeScale = this.baseScale;
    }
  }

  private updateTimelapse(realDt: number): void {
    const target = this.timelapse ? 1 : 0;
    if (this.ramp === target) {
      return;
    }
    this.ramp = target > this.ramp ? Math.min(1, this.ramp + realDt / TIMELAPSE_RAMP) : Math.max(0, this.ramp - realDt / TIMELAPSE_RAMP);
    const k = this.ramp * this.ramp * (3 - 2 * this.ramp);
    this.ctx.time.dayTimeScale = this.baseScale + (Math.max(TIMELAPSE_SCALE, this.baseScale) - this.baseScale) * k;
  }
}
