/**
 * Moments system ("Anlar", phase 19): the game side of the moment runtime. Every frame it reads the real services
 * (dragon position → coast distance, AGL / ASL, flight mode; time of day and date; weather; the race context), hands
 * the snapshot to the pure MomentRunner (./runtime.ts) with the player's settings, and renders what the runner asks for
 * (subtitle line, closing card, the coastal ambience lift) through the HUD zone director.
 *
 * Debug / discoverability: `?moment=<id>` puts the dragon at the moment's start waypoint once the game starts and plays
 * that moment once, whatever the conditions (e.g. `?moment=orhan-veli-istanbulu-dinliyorum`). A moment anchored to a
 * moving object (`?moment=ferry-gull-simit`) waits for one in service and puts the dragon next to it instead.
 *
 * Moving anchors (./anchors.ts: the ferries in service) are read from the 'life' service every frame; a moment with an
 * actor (./actors: procedural scene content such as the ferry's gull flock) builds it when it starts and disposes it
 * once the actor has wound down.
 */
import type { DragonState, EngineContext, System } from '../core/contracts';
import { UpdateOrder } from '../core/contracts';
import { MOMENT_ACTORS, actorSounds, type MomentActor } from './actors';
import { AnchorFeed, ferryShortcut } from './anchors';
import { ALL_MOMENTS } from './data';
import { loadMomentPrefs, onMomentPrefsChange, type MomentPrefs } from './prefs';
import { momentStartPose, MomentRunner, type MomentFrame, type MomentSink } from './runtime';
import type { MomentContext } from './triggers';
import type { Moment } from './types';
import { MomentView } from './view';

/** Seconds of running game after the ?moment= teleport before the forced moment starts (the camera settles). */
const FORCE_DELAY_S = 2.5;
/** Seconds the ?moment= shortcut of an anchored moment waits for its anchor (the fleet loads late) before giving up. */
const FORCE_ANCHOR_WAIT_S = 90;

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
  const runner = new MomentRunner(ALL_MOMENTS, sink, { availableSounds: actorSounds() });
  const anchorFeed = new AnchorFeed();
  let forceAnchor: number | undefined;
  let forceWait = 0;
  let actor: MomentActor | null = null;
  let actorMoment: Moment | null = null;

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
    c.anchors = anchorFeed.update(ctx.services.tryGet('life'));
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
      const anchor = m?.trigger.place.anchor;
      if (anchor !== undefined) {
        // Anchored moment: wait for an anchor in service, then place the dragon beside it.
        const geo = ctx.services.tryGet('geo');
        anchorFeed.update(ctx.services.tryGet('life'));
        const shortcut = geo ? ferryShortcut(anchorFeed.vesselsOf(anchor), (x, z) => geo.coastDistance(x, z)) : null;
        if (!shortcut) {
          forceWait += dt;
          if (forceWait > FORCE_ANCHOR_WAIT_S) {
            console.warn(`[moments] ?moment=${forceId}: no '${anchor}' in service, giving up`);
            forceId = null;
          }
          return;
        }
        forceAnchor = shortcut.anchorId;
        ctx.events.emit('teleport', shortcut.pose);
      } else {
        const pose = m && momentStartPose(m);
        if (pose) {
          ctx.events.emit('teleport', pose);
        }
      }
      forceTimer = FORCE_DELAY_S;
      return;
    }
    forceTimer -= dt;
    if (forceTimer <= 0) {
      runner.force(forceId, forceAnchor);
      forceId = null;
    }
  }

  /** Builds the playing moment's actor when it starts; runs it until it has wound down. */
  function updateActor(ctx: EngineContext, dt: number): void {
    const current = runner.current;
    if (current && current !== actorMoment) {
      const factory = current.content.actorId ? MOMENT_ACTORS[current.content.actorId] : undefined;
      if (factory) {
        actor?.dispose();
        actor = factory.create(ctx, runner.currentAnchor);
      }
      actorMoment = current;
    }
    if (!current && !actor) {
      actorMoment = null;
    }
    if (!actor) {
      return;
    }
    actor.update(dt, current !== null && current === actorMoment);
    if (actor.done) {
      actor.dispose();
      actor = null;
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
      updateActor(ctx, dt);
    },

    dispose(): void {
      for (const fn of disposers.splice(0)) {
        fn();
      }
      ctxRef?.services.tryGet('audio')?.setAmbienceLift?.(0);
      actor?.dispose();
      actor = null;
      view?.dispose();
      view = null;
    },
  };
}
