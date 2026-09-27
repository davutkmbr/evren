/** The signed-in account of a request (worker/lib/session.ts). */
export interface SessionUser {
  id: string;
  isAnonymous: boolean;
  email: string;
}

/** Hono environment of every route: the Worker bindings and the per-request values the middleware sets. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    /** Set by withUser / requireUser; null when signed out. */
    user: SessionUser | null;
  };
}
