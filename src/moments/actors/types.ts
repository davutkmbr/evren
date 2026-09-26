/**
 * Moment actors: the procedural scene content of a moment (creatures, props) that lives only while the moment plays
 * and a little after it, so it costs nothing otherwise. Registered by the record's `content.actorId` in ./index.ts.
 */
import type { EngineContext } from '../../core/contracts';

export interface MomentActor {
  /**
   * Every running frame (dt > 0) from the moment's start until `done`. `momentPlaying` turns false when the moment's
   * lines are over (or it was cut short); the actor then winds down on its own.
   */
  update(dt: number, momentPlaying: boolean): void;
  /** True once the actor has wound down; the system then disposes it. */
  readonly done: boolean;
  /** Removes everything at once (also mid-scene: the system is disposed or another actor starts). */
  dispose(): void;
}

export interface MomentActorFactory {
  /** Moment sound ids the actor plays itself (no ambience fallback needed for them). */
  readonly sounds: readonly string[];
  /** Builds the actor; null when its world object is not there (e.g. the anchored ferry vanished). */
  create(ctx: EngineContext, anchorId: number | undefined): MomentActor | null;
}
