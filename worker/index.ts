/**
 * Seventeen Skies Worker (wrangler.jsonc). Static assets are served without it; this script runs only for the
 * `assets.run_worker_first` paths. One Hono app composed from feature modules, each owning its routes:
 *
 *   /api/auth/*               auth       Better Auth: guest and Google sign-in, sign-out, OAuth callback
 *   /api/me                   account    the signed-in player's account and profile
 *   /api/servers              rooms      server list and the game rooms' WebSockets
 *   /api/probe                probe      latency probe
 *   /audio/music/private/*    music      US-risky historic recordings, kept away from US visitors
 *
 * Shared pieces live in ./lib (types, HTTP helpers, the session and same-origin middleware).
 */
import { Hono } from 'hono';
import { accountRoutes } from './account/routes';
import { authRoutes } from './auth/routes';
import { apiError } from './lib/http';
import type { AppEnv } from './lib/types';
import { MUSIC_PRIVATE_PREFIX, serveGatedMusic } from './music/gate';
import { probeRoutes } from './probe/routes';
import { roomRoutes } from './rooms/routes';

export { LatencyProbe, ProbeLog } from './probe/objects';
export { ServerRoom } from './rooms/room';

const app = new Hono<AppEnv>()
  .route('/api/auth', authRoutes)
  .route('/api/me', accountRoutes)
  .route('/api/servers', roomRoutes)
  .route('/api/probe', probeRoutes)
  .get(`${MUSIC_PRIVATE_PREFIX}*`, (c) => serveGatedMusic(c.req.raw, c.env))
  .all('/api/*', (c) => apiError(c, 404, 'not-found'))
  // Anything else routed here by run_worker_first is a static file.
  .all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
  console.error('[worker]', c.req.method, new URL(c.req.url).pathname, err);
  return apiError(c, 500, 'internal');
});

export default app satisfies ExportedHandler<Env>;
