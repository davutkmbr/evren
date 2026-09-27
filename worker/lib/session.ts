import { createMiddleware } from 'hono/factory';
import { getAuth } from '../auth/config';
import { apiError } from './http';
import type { AppEnv, SessionUser } from './types';

async function load(request: Request, env: Env): Promise<SessionUser | null> {
  const session = await getAuth(env).api.getSession({ headers: request.headers });
  if (!session) {
    return null;
  }
  const u = session.user as { id: string; email: string; isAnonymous?: boolean | null };
  return { id: u.id, isAnonymous: !!u.isAnonymous, email: u.email };
}

/** Loads the signed-in account into `c.var.user` (null when signed out). */
export const withUser = createMiddleware<AppEnv>(async (c, next) => {
  c.set('user', await load(c.req.raw, c.env));
  await next();
});

/** Like withUser, but answers 401 when signed out. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await load(c.req.raw, c.env);
  if (!user) {
    return apiError(c, 401, 'signed-out');
  }
  c.set('user', user);
  await next();
});
