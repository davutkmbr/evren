import type { ServerRoom } from './room';

/** The servers players choose from. Names are shown in the game (Turkish). */
export const SERVERS = [
  { id: 'bogazici', name: 'Boğaziçi' },
  { id: 'halic', name: 'Haliç' },
  { id: 'adalar', name: 'Adalar' },
] as const;

export type ServerId = (typeof SERVERS)[number]['id'];

/** Where the rooms are created (the latency probe: eeur landed in Frankfurt, 49 ms from Istanbul). */
const REGION: DurableObjectLocationHint = 'eeur';

export function isServerId(id: string): id is ServerId {
  return SERVERS.some((s) => s.id === id);
}

export function roomStub(env: Env, id: ServerId): DurableObjectStub<ServerRoom> {
  return env.ROOMS.get(env.ROOMS.idFromName(`room-v1-${id}`), { locationHint: REGION });
}
