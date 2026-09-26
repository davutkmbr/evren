/**
 * Scene actors of moments: the procedural creatures and objects a record's `actorId` names (./content.ts lists the
 * ids). The moments system (./system.ts) starts an actor when its moment starts, tells it when the moment ends and
 * updates it every frame while it is alive; an actor may outlive its moment (the storks glide away and fade). While no
 * actor is alive nothing is simulated or drawn.
 */
import type { EngineContext } from '../core/contracts';
import type { MomentEndReason } from './runtime';
import type { Moment } from './types';
import { StorkFlockActor } from './storks/stork-actor';
import { GullSimitActor } from './gull-simit/actor';

export interface MomentActor {
  /** Alive (in the scene, simulated). */
  readonly active: boolean;
  /** `anchorId`: the moving anchor the moment started at (e.g. the ferry of the gull flock), when its place has one. */
  start(moment: Moment, ctx: EngineContext, forced: boolean, anchorId?: number): void;
  /** The moment's lines ended or were cut short; the actor may live on and leave by itself. */
  end(reason: MomentEndReason): void;
  /** Called every running frame while active (dt > 0). */
  update(dt: number, ctx: EngineContext): void;
  dispose(): void;
}

const FACTORIES: Readonly<Record<string, () => MomentActor>> = {
  'moments/white-stork-flock': () => new StorkFlockActor(),
  'moments/ferry-gull-flock': () => new GullSimitActor(),
};

/** A new actor for `actorId`, or null when the id has no scene implementation (subtitle-only moments). */
export function createMomentActor(actorId: string | undefined): MomentActor | null {
  const f = actorId ? FACTORIES[actorId] : undefined;
  return f ? f() : null;
}
