/**
 * Seventeen Skies Worker (wrangler.jsonc). Static assets are served without it; this script runs only for the
 * `assets.run_worker_first` paths: the geo-gated private music and the /api/ endpoints.
 */
import { MUSIC_PRIVATE_PREFIX, serveGatedMusic } from './music-gate';
import { handleProbe } from './probe';

export { LatencyProbe, ProbeLog } from './probe';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith(MUSIC_PRIVATE_PREFIX)) {
      return serveGatedMusic(request, env);
    }
    if (path.startsWith('/api/probe/')) {
      return handleProbe(request, env, path);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
