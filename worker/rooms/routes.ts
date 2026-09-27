/**
 * Game servers, under /api/servers:
 *
 *   GET /api/servers            the server list with player counts
 *   GET /api/servers/<id>/ws    WebSocket into the room: the site's Origin, a session (401) and a profile (403)
 */
import { Hono } from 'hono';
import { MAX_PLAYERS, PROTOCOL_VERSION } from '../../src/net/protocol';
import { getProfile } from '../account/profiles';
import { apiError, noStore } from '../lib/http';
import { requireSiteOrigin } from '../lib/origin';
import { requireUser } from '../lib/session';
import type { AppEnv } from '../lib/types';
import { SEAT_NAME, SEAT_USER } from './seat';
import { isServerId, roomStub, SERVERS } from './servers';

export const roomRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const servers = await Promise.all(
      SERVERS.map(async (s) => ({ id: s.id, name: s.name, players: await roomStub(c.env, s.id).count(), max: MAX_PLAYERS })),
    );
    return noStore(c, { servers, protocol: PROTOCOL_VERSION });
  })
  .get('/:id/ws', requireSiteOrigin, requireUser, async (c) => {
    const id = c.req.param('id');
    if (!isServerId(id)) {
      return apiError(c, 404, 'unknown-server');
    }
    if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
      return apiError(c, 426, 'websocket');
    }
    const user = c.var.user!;
    const profile = await getProfile(c.env.DB, user.id);
    if (!profile) {
      return apiError(c, 403, 'no-profile');
    }
    const headers = new Headers(c.req.raw.headers);
    headers.set(SEAT_USER, user.id);
    headers.set(SEAT_NAME, encodeURIComponent(profile.nickname));
    return roomStub(c.env, id).fetch(new Request(c.req.raw, { headers }));
  });
