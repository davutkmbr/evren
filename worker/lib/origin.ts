import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './types';
import { apiError } from './http';

/** The site's own origin (BETTER_AUTH_URL; .dev.vars sets the local one). */
export function siteOrigin(env: Env): string {
  return new URL(env.BETTER_AUTH_URL).origin;
}

/**
 * Requests that act with the session cookie must come from the site's own pages: writes (anything but GET / HEAD)
 * and WebSocket upgrades, which browsers send cross-site with cookies attached. Hono's csrf helper only covers form
 * content types, so JSON writes and sockets are checked here.
 */
export const requireSiteOrigin = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method;
  const upgrade = c.req.header('Upgrade')?.toLowerCase() === 'websocket';
  if ((method !== 'GET' && method !== 'HEAD') || upgrade) {
    if (c.req.header('Origin') !== siteOrigin(c.env)) {
      return apiError(c, 403, 'origin');
    }
  }
  await next();
});
