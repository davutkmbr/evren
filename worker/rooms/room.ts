/**
 * One game server's room (phase 26 stage 1): a relay with checks rather than an authoritative simulation. Players send
 * their dragon's snapshot at SEND_RATE_HZ; the room keeps the latest one per player and broadcasts them in one batch
 * every BROADCAST_MS while anything changed. Protocol: src/net/protocol.ts. The Worker (./routes.ts) has checked the
 * session and passes the account and nickname in the seat headers (./seat.ts); the client never names itself.
 *
 * WebSocket hibernation: an idle room (no messages) is evicted from memory and costs nothing; each socket carries its
 * seat as its attachment, so the room rebuilds its player list when it wakes.
 */
import { DurableObject } from 'cloudflare:workers';
import { SEAT_NAME, SEAT_USER } from './seat';
import {
  BATCH_ENTRY_HEADER_BYTES,
  BATCH_HEADER_BYTES,
  BROADCAST_MS,
  FLAG_TELEPORT,
  MAX_PLAYERS,
  MAX_SPEED,
  MSG_SNAPSHOTS,
  PROTOCOL_VERSION,
  SEND_RATE_HZ,
  SNAP_FLAGS,
  SNAP_POSITION,
  SNAPSHOT_BYTES,
  TELEPORT_COOLDOWN_MS,
  WORLD_LIMITS,
  type ServerErrorCode,
  type ServerText,
} from '../../src/net/protocol';

/** Messages per second a client may send (twice the send rate) and the burst it may bank. */
const RATE_PER_S = SEND_RATE_HZ * 2;
const RATE_BURST = SEND_RATE_HZ * 4;
/** Dropped messages (rate, speed, bounds) after which the socket is closed. */
const MAX_STRIKES = 200;
/** Extra distance (m) allowed between two snapshots on top of MAX_SPEED (network jitter, rounding). */
const DISTANCE_SLACK = 30;

/** A socket's attachment: the account from the upgrade, and the player id once the hello is done (0 before). */
interface Seat {
  id: number;
  userId: string;
  name: string;
}

interface SeatState extends Seat {
  x: number;
  y: number;
  z: number;
  /** Server time (ms) of the last accepted snapshot; 0 before the first. */
  lastAccepted: number;
  lastTeleport: number;
  tokens: number;
  lastRefill: number;
  strikes: number;
}

export class ServerRoom extends DurableObject<Env> {
  private readonly seats = new Map<WebSocket, SeatState>();
  /** Latest accepted snapshot per player id since the last broadcast. */
  private readonly pending = new Map<number, Uint8Array>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // After hibernation: rebuild the seats from the sockets' attachments.
    for (const ws of ctx.getWebSockets()) {
      const seat = ws.deserializeAttachment() as Seat | null;
      if (seat?.id) {
        this.seats.set(ws, fresh(seat));
      }
    }
  }

  /** Players seated (hello done). */
  count(): number {
    return this.seats.size;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    const userId = request.headers.get(SEAT_USER);
    const name = request.headers.get(SEAT_NAME);
    if (!userId || !name) {
      return new Response('Unauthorized', { status: 401 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: 0, userId, name: decodeURIComponent(name) } satisfies Seat);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const seat = this.seats.get(ws);
    if (typeof message === 'string') {
      if (!seat) {
        this.hello(ws, message);
      }
      return;
    }
    if (!seat) {
      return;
    }
    if (!this.allow(seat) || message.byteLength !== SNAPSHOT_BYTES || !this.check(seat, message)) {
      this.strike(ws, seat);
      return;
    }
    this.pending.set(seat.id, new Uint8Array(message));
    this.flushTimer ??= setTimeout(() => this.flush(), BROADCAST_MS);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.leave(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.leave(ws);
  }

  private hello(ws: WebSocket, text: string): void {
    let msg: { type?: unknown; v?: unknown } | null;
    try {
      msg = JSON.parse(text) as { type?: unknown; v?: unknown } | null;
    } catch {
      msg = null;
    }
    if (!msg || msg.type !== 'hello') {
      return this.reject(ws, 'hello');
    }
    if (msg.v !== PROTOCOL_VERSION) {
      return this.reject(ws, 'version');
    }
    const pending = ws.deserializeAttachment() as Seat | null;
    if (!pending) {
      return this.reject(ws, 'hello');
    }
    // One seat per account: joining again (another tab or device) replaces the old seat.
    for (const [other, s] of this.seats) {
      if (s.userId === pending.userId) {
        this.reject(other, 'replaced');
        this.leave(other);
      }
    }
    if (this.seats.size >= MAX_PLAYERS) {
      return this.reject(ws, 'full');
    }
    const used = new Set([...this.seats.values()].map((s) => s.id));
    let id = 1;
    while (used.has(id)) {
      id++;
    }
    const seat: Seat = { id, userId: pending.userId, name: pending.name };
    const name = seat.name;
    ws.serializeAttachment(seat);
    const others = [...this.seats.values()].map((s) => ({ id: s.id, name: s.name }));
    this.seats.set(ws, fresh(seat));
    send(ws, { type: 'welcome', id, players: others, rate: SEND_RATE_HZ });
    this.broadcastText({ type: 'join', id, name }, ws);
  }

  private reject(ws: WebSocket, code: ServerErrorCode): void {
    send(ws, { type: 'error', code });
    ws.close(4000, code);
  }

  private leave(ws: WebSocket): void {
    const seat = this.seats.get(ws);
    this.seats.delete(ws);
    try {
      ws.close(1000, 'bye');
    } catch {
      // Already closed.
    }
    if (seat) {
      this.pending.delete(seat.id);
      this.broadcastText({ type: 'leave', id: seat.id });
    }
  }

  /** Token bucket: RATE_PER_S messages per second with a RATE_BURST reserve. */
  private allow(seat: SeatState): boolean {
    const now = Date.now();
    seat.tokens = Math.min(RATE_BURST, seat.tokens + ((now - seat.lastRefill) / 1000) * RATE_PER_S);
    seat.lastRefill = now;
    if (seat.tokens < 1) {
      return false;
    }
    seat.tokens--;
    return true;
  }

  /** Bounds and speed: the snapshot must stay in the world and within reach of the last one (or be a teleport). */
  private check(seat: SeatState, data: ArrayBuffer): boolean {
    const v = new DataView(data);
    const x = v.getFloat32(SNAP_POSITION, true);
    const y = v.getFloat32(SNAP_POSITION + 4, true);
    const z = v.getFloat32(SNAP_POSITION + 8, true);
    const L = WORLD_LIMITS;
    if (![x, y, z].every(Number.isFinite) || Math.abs(x) > L.halfExtent || Math.abs(z) > L.halfExtent || y < L.minY || y > L.maxY) {
      return false;
    }
    const now = Date.now();
    if (seat.lastAccepted) {
      const teleport = (v.getUint8(SNAP_FLAGS) & FLAG_TELEPORT) !== 0;
      const dt = Math.max(now - seat.lastAccepted, 1000 / SEND_RATE_HZ) / 1000;
      const moved = Math.hypot(x - seat.x, y - seat.y, z - seat.z);
      if (moved > MAX_SPEED * dt + DISTANCE_SLACK) {
        if (!teleport || now - seat.lastTeleport < TELEPORT_COOLDOWN_MS) {
          return false;
        }
        seat.lastTeleport = now;
      }
    }
    seat.x = x;
    seat.y = y;
    seat.z = z;
    seat.lastAccepted = now;
    return true;
  }

  private strike(ws: WebSocket, seat: SeatState): void {
    if (++seat.strikes > MAX_STRIKES) {
      ws.close(4001, 'too many rejected messages');
      this.leave(ws);
    }
  }

  /** One binary batch with every changed snapshot, to every seated player (clients skip their own id). */
  private flush(): void {
    this.flushTimer = null;
    if (!this.pending.size) {
      return;
    }
    const entry = BATCH_ENTRY_HEADER_BYTES + SNAPSHOT_BYTES;
    const buf = new ArrayBuffer(BATCH_HEADER_BYTES + this.pending.size * entry);
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    view.setUint8(0, MSG_SNAPSHOTS);
    view.setUint16(1, this.pending.size, true);
    let o = BATCH_HEADER_BYTES;
    for (const [id, snap] of this.pending) {
      view.setUint16(o, id, true);
      bytes.set(snap, o + BATCH_ENTRY_HEADER_BYTES);
      o += entry;
    }
    this.pending.clear();
    for (const ws of this.seats.keys()) {
      try {
        ws.send(buf);
      } catch {
        this.leave(ws);
      }
    }
  }

  private broadcastText(msg: ServerText, except?: WebSocket): void {
    for (const ws of this.seats.keys()) {
      if (ws !== except) {
        send(ws, msg);
      }
    }
  }
}

function fresh(seat: Seat): SeatState {
  return { ...seat, x: 0, y: 0, z: 0, lastAccepted: 0, lastTeleport: 0, tokens: RATE_BURST, lastRefill: Date.now(), strikes: 0 };
}

function send(ws: WebSocket, msg: ServerText): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // The socket is gone; its close handler cleans up.
  }
}
