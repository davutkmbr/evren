/**
 * Seventeen Skies Worker (wrangler.jsonc). Static assets are served without it; this script runs only for the
 * `assets.run_worker_first` paths: the geo-gated private music and the /api/ endpoints
 * (latency probe, game servers, accounts).
 */
import { MUSIC_PRIVATE_PREFIX, serveGatedMusic } from './music-gate';
import { handleAccount } from './account';
import { getAuth } from './auth';
import { handleProbe } from './probe';
import { handleRooms } from './rooms';

export { LatencyProbe, ProbeLog } from './probe';
export { ServerRoom } from './rooms';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith(MUSIC_PRIVATE_PREFIX)) {
      return serveGatedMusic(request, env);
    }
    if (path.startsWith('/api/probe/')) {
      return handleProbe(request, env, path);
    }
    if (path.startsWith('/api/auth/')) {
      return getAuth(env).handler(request);
    }
    if (path === '/api/me' || path.startsWith('/api/me/')) {
      return handleAccount(request, env, path);
    }
    if (path === '/api/servers' || path.startsWith('/api/servers/')) {
      return handleRooms(request, env, path);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
