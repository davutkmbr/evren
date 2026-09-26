/**
 * Ferry escort system ("Vapur eşliği", phase 13 activities): escort a vapur or city ferry from one pier to the next.
 * A chill activity: no timer, no fail state, no medals.
 *
 * Flying beside a ferry in service (within 120 m, heading its way, no race) offers "[L] Vapura eşlik et" on the hint
 * line; L starts the escort (the escort claims the land key while the offer shows). While escorting, the line under the compass reads "Sıradaki iskele: Kadıköy · 1,4 km"
 * with a small closeness line, the ferry's gull flock (src/moments/gull-simit, shared with the gull-and-simit moment)
 * follows the ferry and the dragon glances at it now and then (a 'dragon-attention' hint). Drifting beyond 200 m shows
 * "Vapurdan uzaklaşıyorsun"; after 30 s away the escort ends quietly. When the ferry comes alongside, a soft horn
 * sounds at the ferry and the arrival card appears in the corner ("Vapur eşliği · Eminönü → Kadıköy", the time, a warm
 * line, "Eşlik edilen hatlar 3/24"); the leg is recorded (./records.ts). Staying along, the escort carries on with
 * the next leg when the ferry leaves. L stops it while drifting away; landing ends it. A race ends it; moments keep playing; pause and photo mode
 * freeze it (dt 0).
 *
 * Debug: ?escort=1 puts the dragon beside a ferry mid-crossing (the offer shows), ?escort=start also starts the
 * escort. window.__evrenEscort (dev server, sandboxes, ?escort=): state(), start(), stop(), place(), records(),
 * clearRecords().
 */
import type { DragonState, EngineContext, FerryLegInfo, System, VesselPose } from '../../core/contracts';
import { UpdateOrder } from '../../core/contracts';
import { ANCHOR_KINDS } from '../../moments/anchors';
import { FerryGullHold } from '../../moments/gull-simit/actor';
import { EscortTracker, type EscortEndReason, type EscortEvent, type EscortFerry } from './escort';
import { EscortPresenter } from './presenter';
import { clearEscortRecords, ESCORT_ROUTES, escortedRouteCount, loadEscortRecords, recordEscort } from './records';
import { escortShortcut } from './shortcut';
import { ESCORT_TEXT, formatEscortDuration } from './text';
import { EscortView } from './view';

/** Flight modes without an escort offer (on the ground or in the water). */
const GROUND_MODES: ReadonlySet<DragonState['mode']> = new Set(['grounded', 'landing', 'swimming']);
/** Seconds between the dragon's glances at the ferry while escorting (jittered). */
const GLANCE_EVERY_S = 9;
/** Seconds after the ?escort= teleport before ?escort=start starts the escort (the flight settles). */
const SHORTCUT_START_DELAY_S = 1.5;
/** Seconds ?escort= waits for a ferry mid-crossing (the fleet loads late) before giving up. */
const SHORTCUT_WAIT_S = 120;

function blankPose(): VesselPose {
  return { id: -1, kind: '', x: 0, z: 0, yaw: 0, heave: 0, speed: 0, underway: false, length: 1, beam: 1, draft: 0, airDraft: 1 };
}

function blankLeg(): FerryLegInfo {
  return { line: '', from: '', to: '', fromName: '', toName: '', phase: 'route', dockX: 0, dockZ: 0 };
}

export function createEscortSystem(): System {
  let ctx: EngineContext | null = null;
  let dragon: DragonState | null = null;
  const tracker = new EscortTracker();
  let presenter: EscortPresenter | null = null;
  let view: EscortView | null = null;
  const poses: VesselPose[] = [];
  const legs: FerryLegInfo[] = [];
  const ferries: EscortFerry[] = [];
  const input = { dragon: null as { x: number; z: number; headingDeg: number } | null, racing: false, airborne: true, ferries: ferries as readonly EscortFerry[] };
  const dragonIn = { x: 0, z: 0, headingDeg: 0 };
  /** The escorted ferry's gulls, and flocks still winding down after an escort. */
  let gulls: FerryGullHold | null = null;
  const winding: FerryGullHold[] = [];
  let glanceIn = 0;
  let ownTeleport = false;
  let loadingDone = false;
  let uiEjd: HTMLElement | null = null;
  /** ?escort= state: 'place' (teleport when a ferry is mid-crossing), then 'start' waits to start. */
  let shortcut: { start: boolean; waited: number; startIn: number; placed: boolean } | null = null;
  const disposers: Array<() => void> = [];

  function prestart(): boolean {
    uiEjd ??= ctx?.uiRoot.querySelector<HTMLElement>('.ejd:not(.race-ui)') ?? null;
    return !!uiEjd?.classList.contains('is-prestart');
  }

  function ensureView(c: EngineContext): EscortPresenter | null {
    if (presenter) {
      return presenter;
    }
    const zones = c.services.tryGet('hudZones');
    if (!zones) {
      return null;
    }
    // Inside the HUD, so the escort's text hides with it (menus, map, photo mode, U, ?nohud).
    let container = c.uiRoot.querySelector<HTMLElement>('.ejd-hud');
    if (!container) {
      container = document.createElement('div');
      container.className = 'ejd';
      c.uiRoot.append(container);
    }
    view = new EscortView(container);
    presenter = new EscortPresenter(zones, view);
    return presenter;
  }

  /** Reads the vapurs and city ferries (poses and legs) from the life service into `ferries`. */
  function readFerries(c: EngineContext): void {
    const life = c.services.tryGet('life');
    if (!life) {
      ferries.length = 0;
      return;
    }
    life.vessels(ANCHOR_KINDS.ferry, poses);
    ferries.length = poses.length;
    for (let i = 0; i < poses.length; i++) {
      legs[i] ??= blankLeg();
      const f = (ferries[i] ??= { pose: poses[i], leg: null });
      f.pose = poses[i];
      f.leg = life.ferryLeg ? life.ferryLeg(poses[i].id, legs[i]) : null;
    }
  }

  function escortedFerry(): EscortFerry | undefined {
    return ferries.find((f) => f.pose.id === tracker.ferryId);
  }

  function glance(c: EngineContext, strength: number): void {
    const f = escortedFerry();
    if (f) {
      const p = f.pose;
      c.events.emit('dragon-attention', { x: p.x, y: p.heave + p.airDraft * 0.5, z: p.z, kind: 'ferry', strength });
    }
  }

  function releaseGulls(hurry: boolean): void {
    if (!gulls) {
      return;
    }
    gulls.playing = false;
    gulls.hurry = hurry;
    winding.push(gulls);
    gulls = null;
  }

  function handle(c: EngineContext, events: readonly EscortEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'started':
          releaseGulls(false);
          gulls = new FerryGullHold(c, e.ferryId);
          glanceIn = 2;
          glance(c, 0.8);
          c.services.tryGet('audio')?.play('ui-click', 0.4);
          break;
        case 'leg':
          if (gulls) {
            gulls.playing = true;
          }
          break;
        case 'arrived': {
          const result = recordEscort(e.routeKey, e.duration);
          presenter?.arrived({
            route: ESCORT_TEXT.card.route(e.leg.fromName, e.leg.toName),
            duration: formatEscortDuration(e.duration),
            warm: ESCORT_TEXT.card.warm(result.done + result.record.count),
            routes: ESCORT_TEXT.card.routes(result.done, result.total),
            first: result.first,
          });
          const f = escortedFerry();
          if (f) {
            const p = f.pose;
            c.services.tryGet('audio')?.momentCue?.('ferry-horn', { x: p.x, y: p.heave + p.airDraft * 0.8, z: p.z }, 0.8);
          }
          glance(c, 0.9);
          break;
        }
        case 'ended': {
          releaseGulls(e.reason === 'race' || e.reason === 'teleport');
          const text = ESCORT_TEXT.ended(e.reason);
          if (text) {
            c.events.emit('toast', { text });
          }
          break;
        }
        case 'away':
        case 'back':
          break;
      }
    }
  }

  function stop(reason: EscortEndReason): void {
    tracker.stop(reason);
  }

  function updateShortcut(c: EngineContext, dt: number): void {
    const s = shortcut;
    if (!s || !loadingDone || !dragon) {
      return;
    }
    if (!s.placed) {
      const geo = c.services.tryGet('geo');
      const pick = geo ? escortShortcut(ferries, (x, z) => geo.coastDistance(x, z)) : null;
      if (!pick) {
        s.waited += dt;
        if (s.waited > SHORTCUT_WAIT_S) {
          console.warn('[escort] ?escort=: no ferry mid-crossing, giving up');
          shortcut = null;
        }
        return;
      }
      ownTeleport = true;
      c.events.emit('teleport', pick.pose);
      ownTeleport = false;
      s.placed = true;
      s.startIn = SHORTCUT_START_DELAY_S;
      if (!s.start) {
        shortcut = null;
      }
      return;
    }
    s.startIn -= dt;
    if (s.startIn <= 0) {
      if (tracker.start() || tracker.active) {
        shortcut = null;
      } else if (s.startIn < -10) {
        console.warn('[escort] ?escort=start: no ferry on offer after the teleport');
        shortcut = null;
      }
    }
  }

  function installDebugHook(): void {
    const hook = {
      state: () => ({
        phase: tracker.phase,
        offer: tracker.offer,
        ferryId: tracker.ferryId,
        leg: tracker.leg ? { ...tracker.leg } : null,
        legTime: tracker.legTime,
        distance: tracker.distance,
        pierDistance: tracker.pierDistance,
        away: tracker.away,
        legsDone: tracker.legsDone,
        line: presenter ? { ...presenter.line } : null,
        card: presenter?.lastCard ? { ...presenter.lastCard } : null,
        routes: `${escortedRouteCount()}/${ESCORT_ROUTES.length}`,
      }),
      start: (): boolean => tracker.start(),
      stop: (): void => stop('player'),
      /** Puts the dragon beside a ferry mid-crossing (as ?escort=1); `start` also starts the escort. */
      place: (start = false): void => {
        shortcut = { start, waited: 0, startIn: 0, placed: false };
      },
      records: () => ({ ...loadEscortRecords() }),
      routes: () => ESCORT_ROUTES.slice(),
      clearRecords: (): void => clearEscortRecords(),
    };
    (window as unknown as { __evrenEscort?: typeof hook }).__evrenEscort = hook;
    disposers.push(() => {
      const w = window as unknown as { __evrenEscort?: typeof hook };
      if (w.__evrenEscort === hook) {
        delete w.__evrenEscort;
      }
    });
  }

  return {
    name: 'escort',
    order: UpdateOrder.World + 12,

    init(c) {
      ctx = c;
      dragon = c.services.tryGet('dragon') ?? null;
      if (!dragon) {
        void c.services.when('dragon').then((d) => (dragon = d));
      }
      const param = c.debug.params.get('escort');
      if (param && param !== '0') {
        shortcut = { start: param === 'start', waited: 0, startIn: 0, placed: false };
      }
      disposers.push(
        c.events.on('loading-done', () => {
          loadingDone = true;
        }),
        c.events.on('teleport', () => {
          // Someone else moved the dragon (map teleport, a race start, a view preset): the escort is over.
          if (!ownTeleport && tracker.active) {
            stop('teleport');
          }
        }),
      );
      if (param || c.sandbox || import.meta.env.DEV) {
        installDebugHook();
      }
    },

    update(dt, c) {
      // Pause and photo mode (the game pauses) freeze everything, the gulls included.
      if (dt <= 0 || c.time.paused || prestart()) {
        return;
      }
      const p = ensureView(c);
      readFerries(c);
      updateShortcut(c, dt);
      const zones = c.services.tryGet('hudZones');
      const d = dragon;
      if (d) {
        dragonIn.x = d.position.x;
        dragonIn.z = d.position.z;
        dragonIn.headingDeg = d.headingDeg;
      }
      input.dragon = d ? dragonIn : null;
      input.racing = !!d?.racing || !!zones?.hasContext?.('race');
      input.airborne = !!d && !GROUND_MODES.has(d.mode) && (d.perch?.phase ?? 'free') === 'free';
      // L (land) doubles as the escort key while the offer or the drifting note shows: the escort claims it (set at
      // the end of the previous frame, before the flight read it), so that press starts / stops the escort instead of
      // landing. Otherwise L lands as usual, and landing ends a running escort.
      if (c.input.enabled && c.input.wasClaimedPress('land')) {
        // Starting queues the 'started' event for this frame's update.
        if (tracker.active) {
          stop('player');
        } else {
          tracker.start();
        }
      } else if (tracker.active && !input.airborne) {
        stop('player');
      }
      handle(c, tracker.update(dt, input));
      c.input.claim('land', (!tracker.active && tracker.offer >= 0) || tracker.drifting);
      p?.sync(tracker);
      if (tracker.active) {
        glanceIn -= dt;
        if (glanceIn <= 0) {
          glanceIn = GLANCE_EVERY_S * (0.75 + Math.random() * 0.5);
          glance(c, 0.6);
        }
      }
      gulls?.update(dt);
      for (let i = winding.length - 1; i >= 0; i--) {
        const h = winding[i];
        h.update(dt);
        if (!h.active) {
          h.release();
          winding.splice(i, 1);
        }
      }
    },

    dispose() {
      for (const fn of disposers.splice(0)) {
        fn();
      }
      ctx?.input.claim('land', false);
      gulls?.release();
      gulls = null;
      for (const h of winding.splice(0)) {
        h.release();
      }
      presenter?.clear();
      view?.dispose();
      presenter = null;
      view = null;
      ctx = null;
    },
  };
}
