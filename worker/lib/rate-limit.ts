import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { apiError } from './http';
import type { AppEnv } from './types';

/**
 * A Workers rate limit binding (wrangler.jsonc `ratelimits`) as middleware. `key` picks the counter: the client's IP
 * for sign-ins (used only as the counter's key, never stored), the account for writes. A request without a key (no
 * CF-Connecting-IP: local `wrangler dev`) is not limited; Cloudflare always sets it in production.
 */
export function rateLimit(binding: (env: Env) => RateLimit, key: (c: Context<AppEnv>) => string | null | undefined): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const k = key(c);
    if (k) {
      const { success } = await binding(c.env).limit({ key: k });
      if (!success) {
        return apiError(c, 429, 'rate-limited');
      }
    }
    await next();
  });
}

/** The client's IP as Cloudflare reports it. */
export const clientIp = (c: Context<AppEnv>): string | undefined => c.req.header('CF-Connecting-IP');
