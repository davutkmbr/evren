/**
 * Game server protocol (phase 26 stage 1), shared by the client (src/net) and the Worker (worker/rooms.ts). No
 * imports: the Worker type-checks it without three.js or the DOM.
 *
 * Client → server
 *   text    {"type":"hello","name":"…","v":PROTOCOL_VERSION}   first message, once
 *   binary  one snapshot (SNAPSHOT_BYTES, src/net/snapshot.ts), at SEND_RATE_HZ
 *
 * Server → client
 *   text    {"type":"welcome","id":n,"players":[{"id":n,"name":"…"}],"rate":SEND_RATE_HZ}
 *   text    {"type":"join","id":n,"name":"…"} / {"type":"leave","id":n}
 *   text    {"type":"error","code":"full"|"version"|"name"|"hello"}   then the socket closes
 *   binary  MSG_SNAPSHOTS: u8 type, u16 count, count × (u16 player id, snapshot), one batch per BROADCAST_MS
 */

export const PROTOCOL_VERSION = 1;
export const SEND_RATE_HZ = 10;
export const BROADCAST_MS = 100;
export const MAX_PLAYERS = 50;

export const MSG_SNAPSHOTS = 1;
export const BATCH_HEADER_BYTES = 3;
export const BATCH_ENTRY_HEADER_BYTES = 2;

/** Snapshot layout (src/net/snapshot.ts checks it against its fields). */
export const SNAPSHOT_BYTES = 67;
export const SNAP_T = 0;
export const SNAP_POSITION = 4;
export const SNAP_FLAGS = 31;
export const FLAG_FIRING = 1;
export const FLAG_RIDERLESS = 2;
export const FLAG_GROUND = 4;
/** The dragon was placed somewhere new (map, perch or moment teleport): receivers snap instead of interpolating. */
export const FLAG_TELEPORT = 8;

export type ServerErrorCode = 'full' | 'version' | 'name' | 'hello';

export type ServerText =
  | { type: 'welcome'; id: number; players: { id: number; name: string }[]; rate: number }
  | { type: 'join'; id: number; name: string }
  | { type: 'leave'; id: number }
  | { type: 'error'; code: ServerErrorCode };

export interface ClientHello {
  type: 'hello';
  name: string;
  v: number;
}

/** Nickname rules: trimmed, 2–16 characters, letters (any script), digits, space, `_`, `-`, `.`. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 16 || !/^[\p{L}\p{N} _.-]+$/u.test(name)) {
    return null;
  }
  return name;
}

/** Playable volume (m, world): 48 × 48 km around the centre, from below the sea to above the clouds. */
export const WORLD_LIMITS = { halfExtent: 30_000, minY: -200, maxY: 6_000 } as const;
/** Fastest believable movement between two snapshots (m/s): dives reach ~85 m/s; margin for boosts and jitter. */
export const MAX_SPEED = 160;
/** Teleports allowed without the speed check: at most one per this many ms. */
export const TELEPORT_COOLDOWN_MS = 5_000;
