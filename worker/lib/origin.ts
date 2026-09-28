import { createMiddleware } from 'hono/factory';
import { steamEnabled } from '../steam/config';
import { apiError } from './http';
import type { AppEnv } from './types';

/** The site's own origin (BETTER_AUTH_URL; .dev.vars sets the local one). */
export function siteOrigin(env: Env): string {
  return new URL(env.BETTER_AUTH_URL).origin;
}

/**
 * Requests that act with the session cookie must come from the site's own pages: writes (anything but GET / HEAD)
 * and WebSocket upgrades, which browsers send cross-site with cookies attached. Hono's csrf helper only covers form
 * content types, so JSON writes and sockets are checked here.
 *
 * Native clients (the Steam build) send neither an Origin nor cookies: they carry their session as a bearer token,
 * which a browser page cannot attach on another site's behalf, so there is nothing to forge. Browsers always send
 * Origin on writes and WebSocket upgrades, so this never lets a cookie-carrying request through. Only while Steam
 * sign-in is on.
 */
export const requireSiteOrigin = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method;
  const upgrade = c.req.header('Upgrade')?.toLowerCase() === 'websocket';
  if ((method !== 'GET' && method !== 'HEAD') || upgrade) {
    const native = !c.req.header('Origin') && !c.req.header('Cookie') && steamEnabled(c.env);
    if (!native && c.req.header('Origin') !== siteOrigin(c.env)) {
      return apiError(c, 403, 'origin');
    }
  }
  await next();
});
