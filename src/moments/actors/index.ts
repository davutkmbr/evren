/** Moment actors by `content.actorId` (see ./types.ts). */
import { createGullSimitActor } from './gull-simit/actor';
import type { MomentActorFactory } from './types';

export type { MomentActor, MomentActorFactory } from './types';

export const MOMENT_ACTORS: Readonly<Record<string, MomentActorFactory>> = {
  'moments/ferry-gull-flock': { sounds: ['moments/gull-call'], create: createGullSimitActor },
};

/** Moment sounds some actor provides (the runner's `availableSounds`). */
export function actorSounds(): Set<string> {
  return new Set(Object.values(MOMENT_ACTORS).flatMap((a) => a.sounds));
}
