/**
 * Online play (phase 26 stage 1): provides the 'net' service. While joined, the local dragon's snapshot goes to the
 * server at SEND_RATE_HZ and every relayed snapshot of another player goes to 'remoteDragons'. A dropped connection is
 * retried a few times with a growing delay; a refusal from the server (full, bad name) is not.
 *
 * Joining needs a signed-in account with a nickname (the 'account' service); the server takes the name from the
 * profile. Local test (DEV_TOOLS only): `?server=bogazici&name=Evren` signs in as a guest with that nickname if
 * needed and joins on start.
 */
import { UpdateOrder, type AccountService, type GameServerInfo, type NetPeer, type NetService, type NetStatus, type RemoteDragonService, type System } from '../core/contracts';
import { devParams, exposeDebug } from '../core/dev-tools';
import { NetClient } from './client';
import { captureSnapshot } from './capture';
import { Presence } from './presence';
import { SEND_RATE_HZ } from './protocol';
import { createSnapshot, encodeSnapshot, SNAPSHOT_BYTES } from './snapshot';

const RETRY_DELAYS_MS = [1_000, 3_000, 8_000];
/** A jump longer than this between two sends is marked as a teleport even without a teleport event (m). */
const JUMP_METERS = 300;

const remoteId = (id: number) => `p${id}`;

export function createNetSystem(): System {
  let status: NetStatus = 'offline';
  let server: GameServerInfo | null = null;
  let lastError: string | null = null;
  let client: NetClient | null = null;
  let selfId = 0;
  let retries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSend = -Infinity;
  let teleported = false;
  let lastPos: [number, number, number] | null = null;
  const players = new Map<number, string>();
  const listeners = new Set<() => void>();
  const snap = createSnapshot();
  const out = new ArrayBuffer(SNAPSHOT_BYTES);
  let remotes: RemoteDragonService | undefined;
  let account: AccountService | undefined;

  const changed = () => listeners.forEach((fn) => fn());

  const clearRemotes = () => {
    for (const id of players.keys()) {
      remotes?.remove(remoteId(id));
    }
    players.clear();
  };

  const connect = () => {
    if (!server) {
      return;
    }
    if (!account?.nickname) {
      lastError = account?.status === 'signed-in' ? 'no-profile' : 'signed-out';
      server = null;
      status = 'offline';
      changed();
      return;
    }
    status = 'connecting';
    changed();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const c = new NetClient(`${proto}//${location.host}/api/servers/${server.id}/ws`, {
      welcome(id, list) {
        selfId = id;
        retries = 0;
        status = 'online';
        lastError = null;
        teleported = true;
        for (const p of list) {
          players.set(p.id, p.name);
        }
        console.info(`[net] joined ${server?.id} as #${id} (${list.length} other players)`);
        changed();
      },
      join(id, playerName) {
        players.set(id, playerName);
        changed();
      },
      leave(id) {
        players.delete(id);
        remotes?.remove(remoteId(id));
        changed();
      },
      snapshot(id, data, offset) {
        if (id !== selfId && players.has(id)) {
          remotes?.push(remoteId(id), data, offset);
        }
      },
      closed(error, opened) {
        if (client !== c) {
          return;
        }
        client = null;
        selfId = 0;
        clearRemotes();
        if (error || (!opened && retries === 0)) {
          // Refused by the room, or the upgrade itself was refused (signed out, no profile): no retry.
          lastError = error ?? (account?.status === 'signed-in' ? 'no-profile' : 'signed-out');
          status = 'offline';
          server = null;
          void account?.refresh();
        } else if (server && retries < RETRY_DELAYS_MS.length) {
          lastError = 'lost';
          status = 'connecting';
          retryTimer = setTimeout(connect, RETRY_DELAYS_MS[retries++]);
        } else {
          lastError = server ? 'lost' : null;
          status = 'offline';
          server = null;
        }
        changed();
      },
    });
    client = c;
  };

  const service: NetService = {
    get status() {
      return status;
    },
    get server() {
      return server;
    },
    players,
    get lastError() {
      return lastError;
    },
    async listServers() {
      const res = await fetch('/api/servers', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`server list: HTTP ${res.status}`);
      }
      return ((await res.json()) as { servers: GameServerInfo[] }).servers;
    },
    peers() {
      const out: NetPeer[] = [];
      if (status !== 'online' || !remotes) {
        return out;
      }
      for (const [id, name] of players) {
        const p = remotes.pose(remoteId(id));
        if (p) {
          out.push({ id, name, x: p.x, z: p.z, headingDeg: p.headingDeg });
        }
      }
      return out;
    },
    join(target) {
      service.leave();
      server = target;
      retries = 0;
      lastError = null;
      connect();
    },
    leave() {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      server = null;
      const c = client;
      client = null;
      c?.close();
      selfId = 0;
      clearRemotes();
      if (status !== 'offline') {
        status = 'offline';
        changed();
      }
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  let unsubscribe: (() => void) | undefined;
  let presence: Presence | undefined;

  return {
    name: 'net',
    order: UpdateOrder.Animation + 20,
    init(ctx) {
      ctx.services.provide('net', service);
      void ctx.services.when('remoteDragons').then((r) => {
        remotes = r;
      });
      const accountReady = ctx.services.when('account').then((a) => {
        account = a;
        return a;
      });
      unsubscribe = ctx.events.on('teleport', (e) => {
        teleported ||= !e.resume;
      });
      presence = new Presence({
        online: () => status === 'online' && !!client,
        capture: (now) => {
          const state = ctx.services.tryGet('dragon');
          const rig = ctx.services.tryGet('rig');
          return state && rig ? captureSnapshot(state, rig.getPose(), now, createSnapshot()) : null;
        },
        send: (data) => client?.send(data),
        place: (e) => ctx.events.emit('teleport', e),
        resumed: () => {
          lastPos = null;
        },
      });
      const q = devParams();
      const auto = q.get('server');
      if (auto) {
        void accountReady.then(async (a) => {
          await a.refresh();
          if (!a.nickname) {
            const result = await a.playAsGuest(q.get('name') ?? `Test ${Math.floor(Math.random() * 900 + 100)}`);
            console.info(`[net] guest sign-in: ${result}`);
          }
          const listed = await service.listServers().catch(() => []);
          service.join(listed.find((s) => s.id === auto) ?? { id: auto, name: auto, players: 0, max: 0 });
        });
      }
      exposeDebug('__net', service);
    },
    update(_dt, ctx) {
      // Shared world: menus and the map never stop it while online (the flight autopilot holds the dragon).
      ctx.time.pauseAllowed = status !== 'online';
      if (status !== 'online' || !client || presence?.isAway) {
        return;
      }
      const now = performance.now();
      const interval = 1000 / SEND_RATE_HZ;
      if (now - lastSend < interval) {
        return;
      }
      // Keep the average rate at SEND_RATE_HZ whatever the frame rate (at 24 fps a plain "100 ms since the last send"
      // lands on every third frame: 8 Hz), without a burst after a stall.
      const next = Math.max(lastSend + interval, now - interval);
      const state = ctx.services.tryGet('dragon');
      const rig = ctx.services.tryGet('rig');
      if (!state || !rig) {
        return;
      }
      lastSend = next;
      captureSnapshot(state, rig.getPose(), now, snap);
      const [x, y, z] = snap.position;
      if (lastPos && Math.hypot(x - lastPos[0], y - lastPos[1], z - lastPos[2]) > JUMP_METERS) {
        teleported = true;
      }
      lastPos = [x, y, z];
      snap.teleport = teleported;
      teleported = false;
      client.send(encodeSnapshot(snap, out));
    },
    dispose() {
      unsubscribe?.();
      presence?.dispose();
      service.leave();
    },
  };
}
