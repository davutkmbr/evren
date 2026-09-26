import type { CameraMode, EngineContext } from '../../core/contracts';
import { formatClock } from '../format';
import { CAMERA_MODE_LABELS, dayPhase } from '../labels';
import type { Toasts } from '../overlays/toasts';

const RAD = 180 / Math.PI;

/**
 * Short toasts for state the HUD no longer shows permanently: a camera switch ("Kamera: Binici gözü") and a time
 * change with [ / ] ("Saat 18:30 · Gün batımı"). Both replace their previous toast instead of stacking.
 */
export class StatusToasts {
  private lastCamera: CameraMode | null = null;
  /** Frame at which to report the clock (the sky applies [ / ] during its own update, so read it a frame later). */
  private clockFrame = -1;

  constructor(private readonly toasts: Toasts) {}

  /** Every frame while playing; `live` is false in menus and photo mode (their camera switches stay silent). */
  update(ctx: EngineContext, live: boolean): void {
    const mode = ctx.services.tryGet('cameraRig')?.mode ?? null;
    if (mode !== this.lastCamera) {
      const previous = this.lastCamera;
      this.lastCamera = mode;
      // Photo mode enters and leaves through the free camera: no toast for those switches.
      if (live && previous && mode && mode !== 'free' && previous !== 'free') {
        this.toasts.push(`Kamera: ${CAMERA_MODE_LABELS[mode] ?? mode}`, 'info', 'camera');
      }
    }

    if (live && ctx.input.enabled && (ctx.input.wasPressed('timeFwd') || ctx.input.wasPressed('timeBack'))) {
      this.clockFrame = ctx.time.frame + 1;
    }
    if (this.clockFrame >= 0 && ctx.time.frame >= this.clockFrame) {
      this.clockFrame = -1;
      const hours = ctx.time.timeOfDay;
      const env = ctx.services.tryGet('env');
      const sun = env ? Math.asin(Math.max(-1, Math.min(1, env.sunDirection.y))) * RAD : 30;
      this.toasts.push(`Saat ${formatClock(hours)} · ${dayPhase(sun, hours)}`, 'info', 'clock');
    }
  }
}
