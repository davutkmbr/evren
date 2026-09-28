/**
 * The signed-in player's own account (phase 26), under /api/me:
 *
 *   GET    /api/me           { user: { id, guest, email? } | null, profile: { nickname } | null, providers }
 *                            (user null when signed out; providers.google / .steam: sign-in offered; email only for
 *                            a real address, never a Steam account's placeholder)
 *   PUT    /api/me/profile   { nickname } → { profile }   400 invalid, 401 signed-out, 409 taken, 429 rate-limited
 *   DELETE /api/me           deletes the account (KVKK) and clears the session cookies
 *
 * Signing in and out are Better Auth's routes (worker/auth). Writes need the site's own Origin.
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { cleanName } from '../../src/net/protocol';
import { apiError, noStore } from '../lib/http';
import { requireSiteOrigin } from '../lib/origin';
import { rateLimit } from '../lib/rate-limit';
import { requireUser, withUser } from '../lib/session';
import type { AppEnv } from '../lib/types';
import { STEAM_EMAIL_DOMAIN } from '../steam/accounts';
import { steamEnabled } from '../steam/config';
import { deleteAccount, getProfile, setNickname } from './profiles';

/** Better Auth's cookies (plain on http://127.0.0.1, __Secure- on https). */
const SESSION_COOKIES = ['better-auth.session_token', 'better-auth.session_data'];

const nicknameBody = z.object({
  nickname: z.string().transform((raw, ctx) => cleanName(raw) ?? (ctx.addIssue({ code: 'custom', message: 'invalid' }), z.NEVER)),
});

export const accountRoutes = new Hono<AppEnv>()
  .use(requireSiteOrigin)
  .get('/', withUser, async (c) => {
    const providers = { google: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET), steam: steamEnabled(c.env) };
    const user = c.var.user;
    if (!user) {
      // Every page load asks: signed out is a normal answer here, not an error in the console.
      return noStore(c, { user: null, profile: null, providers });
    }
    const profile = await getProfile(c.env.DB, user.id);
    return noStore(c, { user: { id: user.id, guest: user.isAnonymous, email: user.isAnonymous || user.email.endsWith(`@${STEAM_EMAIL_DOMAIN}`) ? undefined : user.email }, profile, providers });
  })
  .put(
    '/profile',
    requireUser,
    rateLimit((env) => env.PROFILE_LIMIT, (c) => c.var.user?.id),
    zValidator('json', nicknameBody, (result, c) => (result.success ? undefined : apiError(c, 400, 'invalid'))),
    async (c) => {
      const { nickname } = c.req.valid('json');
      const result = await setNickname(c.env.DB, c.var.user!.id, nickname);
      return result === 'taken' ? apiError(c, 409, 'taken') : noStore(c, { profile: { nickname } });
    },
  )
  .delete('/', requireUser, async (c) => {
    await deleteAccount(c.env.DB, c.var.user!.id);
    for (const name of SESSION_COOKIES) {
      deleteCookie(c, name, { path: '/' });
      deleteCookie(c, name, { path: '/', prefix: 'secure' });
    }
    return noStore(c, { deleted: true });
  });
