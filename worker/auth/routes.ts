import { Hono } from 'hono';
import { requireSiteOrigin } from '../lib/origin';
import { clientIp, rateLimit } from '../lib/rate-limit';
import type { AppEnv } from '../lib/types';
import { steamRoutes } from '../steam/routes';
import { getAuth } from './config';

/**
 * Better Auth's own endpoints (sign in as a guest or with Google, sign out, the OAuth callback): /api/auth/*, plus
 * Steam sign-in for the Steam build (worker/steam, off unless configured). Sign-ins are limited per IP, so nobody can
 * mint accounts in bulk.
 */
export const authRoutes = new Hono<AppEnv>()
  .use(requireSiteOrigin)
  .use('/sign-in/*', rateLimit((env) => env.SIGN_IN_LIMIT, clientIp))
  .route('/', steamRoutes)
  .on(['GET', 'POST'], '/*', (c) => getAuth(c.env).handler(c.req.raw));
