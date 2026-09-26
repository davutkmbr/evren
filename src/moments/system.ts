/**
 * Moments system ("Anlar", phase 19): the game side of the moment runtime. Every frame it reads the real services
 * (dragon position → coast distance, AGL / ASL, flight mode; time of day and date; weather; the race context), hands
 * the snapshot to the pure MomentRunner (./runtime.ts) with the player's settings, and renders what the runner asks for
 * (subtitle line, closing card, the coastal ambience lift) through the HUD zone director.
 *
 * Debug / discoverability: `?moment=<id>` puts the dragon at the moment's start waypoint once the game starts and plays
 * that moment once, whatever the conditions (e.g. `?moment=orhan-veli-istanbulu-dinliyorum`).
 */
import type { DragonState, EngineContext, System } from '../core/contracts';
import { UpdateOrder } from '../core/contracts';
import { ALL_MOMENTS } from './data';
import { loadMomentPrefs, onMomentPrefsChange, type MomentPrefs } from './prefs';
import { momentStartPose, MomentRunner, type MomentFrame, type MomentSink } from './runtime';
import type { MomentContext } from './triggers';
import { MomentView } from './view';

/** Seconds of running game after the ?moment= teleport before the forced moment starts (the camera settles). */
const FORCE_DELAY_S = 2.5;

export function createMomentSystem(): System {
  let ctxRef: EngineContext | null = null;
  let view: MomentView | null = null;
  let prefs: MomentPrefs = loadMomentPrefs();
  let racingByEvents = false;
  let uiRoot: HTMLElement | null = null;
  let uiEjd: HTMLElement | null = null;
  let forceId: string | null = null;
  let forceTimer = -1;
  const disposers: Array<() => void> = [];

  const sink: MomentSink = {
    showLine: (_m, line) => view?.showLine(line),
    hideLine: (_m, how) => view?.hideLine(how === 'fade'),
    showCard: (m) => view?.showCard(m),
    setAmbienceLift: (amount) => ctxRef?.services.tryGet('audio')?.setAmbienceLift?.(amount),
  };
  const runner = new MomentRunner(ALL_MOMENTS, sink);

  const worldContext: Omit<MomentContext, 'session'> = {
    position: { x: 0, z: 0 },
    altitude: 0,
    agl: 0,
    grounded: false,
    timeOfDay: 12,
    dayOfYear: 1,
    weather: 'clear',
  };
  const frame: MomentFrame = { context: null, prefs, racing: false };

  function fillContext(ctx: EngineContext, dragon: DragonState): Omit<MomentContext, 'session'> | null {
    const geo = ctx.services.tryGet('geo');
    const p = dragon.position;
    if (!geo || !Number.isFinite(p.x) || !Number.isFinite(p.z)) {
      return null;
    }
    const c = worldContext;
    c.position.x = p.x;
    c.position.z = p.z;
    c.altitude = dragon.altitude;
    c.agl = dragon.agl;
    c.grounded = dragon.mode === 'grounded';
    c.flightMode = dragon.mode;
    c.coastDistance = geo.coastDistance(p.x, p.z);
    c.timeOfDay = ctx.time.timeOfDay;
    c.dayOfYear = ctx.time.dayOfYear;
    c.weather = ctx.services.tryGet('weather')?.preset ?? 'clear';
    return c;
  }

  /** The start screen is up (the UI marks its root). */
  function prestart(): boolean {
    uiEjd ??= uiRoot?.querySelector<HTMLElement>('.ejd:not(.race-ui)') ?? null;
    return !!uiEjd?.classList.contains('is-prestart');
  }

  function ensureView(ctx: EngineContext): void {
    if (view) {
      return;
    }
    const zones = ctx.services.tryGet('hudZones');
    if (!zones) {
      return;
    }
    // Inside the HUD, so the moment hides with it (menus, map, photo mode, U, ?nohud).
    let container = ctx.uiRoot.querySelector<HTMLElement>('.ejd-hud');
    if (!container) {
      container = document.createElement('div');
      container.className = 'ejd';
      ctx.uiRoot.append(container);
    }
    view = new MomentView(zones, container);
  }

  function updateForced(ctx: EngineContext, dt: number): void {
    if (!forceId || dt <= 0) {
      return;
    }
    if (forceTimer < 0) {
      const m = runner.playable.find((x) => x.id === forceId);
      const pose = m && momentStartPose(m);
      if (pose) {
        ctx.events.emit('teleport', pose);
      }
      forceTimer = FORCE_DELAY_S;
      return;
    }
    forceTimer -= dt;
    if (forceTimer <= 0) {
      runner.force(forceId);
      forceId = null;
    }
  }

  return {
    name: 'moments',
    // Before the UI (800): the lines requested this frame settle in the same frame's zone update.
    order: UpdateOrder.UI - 10,

    init(ctx: EngineContext): void {
      ctxRef = ctx;
      uiRoot = ctx.uiRoot;
      disposers.push(
        onMomentPrefsChange((p) => {
          prefs = p;
        }),
        ctx.events.on('activity', (e) => {
          racingByEvents = e.state === 'started' || e.state === 'checkpoint';
        }),
      );
      if (import.meta.env.DEV) {
        for (const s of runner.skipped) {
          console.info(`[moments] ${s.moment.id} waits: ${s.reason}`);
        }
        console.info(`[moments] playable now: ${runner.playable.map((m) => m.id).join(', ') || 'none'}`);
      }
      const wanted = ctx.debug.params.get('moment');
      if (wanted) {
        const known = ALL_MOMENTS.find((m) => m.id === wanted);
        if (!known) {
          console.warn(`[moments] ?moment=${wanted}: no such moment`);
        } else if (!runner.playable.includes(known)) {
          console.warn(`[moments] ?moment=${wanted} cannot play yet: ${runner.skipped.find((s) => s.moment === known)?.reason}`);
        } else {
          forceId = wanted;
        }
      }
    },

    update(dt: number, ctx: EngineContext): void {
      if (dt <= 0 || ctx.time.paused || prestart()) {
        return;
      }
      ensureView(ctx);
      updateForced(ctx, dt);
      const dragon = ctx.services.tryGet('dragon');
      const zones = ctx.services.tryGet('hudZones');
      frame.context = dragon ? fillContext(ctx, dragon) : null;
      frame.prefs = prefs;
      frame.racing = zones?.hasContext ? zones.hasContext('race') : racingByEvents;
      runner.update(dt, frame);
    },

    dispose(): void {
      for (const fn of disposers.splice(0)) {
        fn();
      }
      ctxRef?.services.tryGet('audio')?.setAmbienceLift?.(0);
      view?.dispose();
      view = null;
    },
  };
}
