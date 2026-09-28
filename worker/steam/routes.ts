/**
 * Steam sign-in for the Steam build, mounted under /api/auth (so the per-IP sign-in limit applies):
 *
 *   POST /api/auth/sign-in/steam   { ticket }  → { token, expiresAt, user: { id }, created }
 *        400 invalid-ticket, 401 ticket-rejected, 403 banned | not-owned, 404 not-found (Steam sign-in off),
 *        429 rate-limited, 503 steam-unavailable
 *
 * `ticket` is the hex ticket of ISteamUser::GetAuthTicketForWebApi(STEAM_TICKET_IDENTITY). The game then sends
 * `Authorization: Bearer <token>` on every API call and room WebSocket, and cancels the Steam ticket.
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAuth } from '../auth/config';
import { apiError, noStore } from '../lib/http';
import type { AppEnv } from '../lib/types';
import { signInSteam } from './accounts';
import { steamConfig } from './config';
import { verifySteamTicket, type VerifyFailure } from './verify';
import { SteamWebApi } from './web-api';

const STATUS: Record<VerifyFailure, 400 | 401 | 403 | 503> = {
  'invalid-ticket': 400,
  'ticket-rejected': 401,
  banned: 403,
  'not-owned': 403,
  'steam-unavailable': 503,
};

const body = z.object({ ticket: z.string().max(8192) });

export const steamRoutes = new Hono<AppEnv>().post(
  '/sign-in/steam',
  async (c, next) => (steamConfig(c.env) ? next() : apiError(c, 404, 'not-found')),
  zValidator('json', body, (result, c) => (result.success ? undefined : apiError(c, 400, 'invalid-ticket'))),
  async (c) => {
    const config = steamConfig(c.env)!;
    const verified = await verifySteamTicket(new SteamWebApi(config), c.req.valid('json').ticket);
    if (!verified.ok) {
      return apiError(c, STATUS[verified.error], verified.error);
    }
    const session = await signInSteam(await getAuth(c.env).$context, verified.steamId);
    return noStore(c, { token: session.token, expiresAt: session.expiresAt.toISOString(), user: { id: session.userId }, created: session.created });
  },
);
