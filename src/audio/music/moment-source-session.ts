/**
 * The source side of the moment music, one frame at a time (pure, no Web Audio): the glue between what the moments
 * system reports (the playing moment's source, the source of the piece that still plays, the nearest world source)
 * and the moment-music director. The controller (./index.ts) and the headless check run the same code:
 *
 *   session.update(frame)          → which spec the playing piece follows, its SourceMix (tracker), the lead-in
 *                                    candidate and whether the voice's source is still within reach
 *   director.tick(now, req, world, session.state)
 */
import type { MomentMusicRequest, MomentMusicView, MomentSourceState } from './moment-music';
import { isWorldKind, SourceTracker, withinReach, type MomentSourceSpec, type SourceEnv, type SourceMix } from './moment-source';
import type { ListenerPose, Vec3 } from '../spatial';

/** What the moments system hands the music about sources every frame (src/moments/system.ts). */
export interface MomentSourceFrame {
  /** The playing moment's source (null while none plays). */
  current: MomentSourceSpec | null;
  /** The source of the piece that plays now when it is not the current moment's (a lead-in, a world sound after). */
  focus: MomentSourceSpec | null;
  /** The nearest world source that may lead in (only while no moment and no source music plays). */
  nearby: MomentSourceSpec | null;
}

/** A moment piece without a known source (the debug API's fake moment) plays as a memory, centred. */
export const MEMORY_SPEC: MomentSourceSpec = { momentId: '(moment)', kind: 'memory', position: null, from: null, overWater: false, reachScale: 1, musicId: null, category: null, mood: [] };

export interface SessionInput {
  dt: number;
  frame: MomentSourceFrame;
  /** A moment plays (setMomentMusic(true) without a later false). */
  momentActive: boolean;
  /** The director's view before its tick this frame. */
  view: MomentMusicView;
  listener: ListenerPose;
  dragon: Vec3 | null;
  env: SourceEnv;
  /** Lead-ins wait during races and menus. */
  blocked: boolean;
}

export class MomentSourceSession {
  readonly tracker = new SourceTracker();
  /** The spec of the moment piece that plays or waits for its audio (kept while the moments system resolves it). */
  voiceSpec: MomentSourceSpec | null = null;
  mix: SourceMix | null = null;
  readonly state: MomentSourceState = { lead: null, inReach: false };

  /** Updates the tracker and the director's source state; fills `req.momentId` / `req.world` for an active moment. */
  update(i: SessionInput, req: MomentMusicRequest): void {
    const f = i.frame;
    const v = i.view;
    const cur = i.momentActive ? f.current : null;
    let spec: MomentSourceSpec | null = null;
    if (v.momentId) {
      spec = [cur, f.focus, f.nearby].find((x) => x?.momentId === v.momentId) ?? (this.voiceSpec?.momentId === v.momentId ? this.voiceSpec : null);
    } else if (v.current || v.pending) {
      spec = cur ?? MEMORY_SPEC;
    }
    this.voiceSpec = spec;
    const opening = i.momentActive && v.phase === 'moment' && (!cur || cur.momentId === v.momentId);
    if (v.current) {
      this.mix = this.tracker.update({ dt: i.dt, spec, momentActive: opening, listener: i.listener, dragon: i.dragon, env: i.env });
    } else {
      this.tracker.reset();
      this.mix = null;
    }
    if (i.momentActive) {
      req.momentId ??= cur?.momentId ?? null;
      const crossed = this.tracker.tracking === cur?.momentId && !this.tracker.world;
      req.world = !!cur && isWorldKind(cur.kind) && cur.position !== null && !crossed;
    }
    const st = this.state;
    st.inReach = spec !== null && this.tracker.inReach({ listener: i.listener, env: i.env }, spec);
    const n = f.nearby;
    st.lead = !i.momentActive && !i.blocked && n && withinReach(i.listener.position, n, i.env) ? { momentId: n.momentId, musicId: n.musicId, category: n.category, mood: n.mood } : null;
  }

  /** The moment the playing piece belongs to and the anchor it follows (the moments system resolves it next frame). */
  focus(v: MomentMusicView): { momentId: string; anchorId?: number } | null {
    if (!v.momentId || (!v.current && !v.pending)) {
      return null;
    }
    const spec = this.voiceSpec?.momentId === v.momentId ? this.voiceSpec : null;
    return { momentId: v.momentId, anchorId: spec?.anchorId };
  }
}
