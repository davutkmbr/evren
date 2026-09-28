import type { Context } from 'hono';

/** API errors: `{ error: code }` with the status, never cached. Codes are stable strings the client switches on. */
export function apiError(c: Context, status: 400 | 401 | 403 | 404 | 409 | 426 | 429 | 500 | 503, code: string): Response {
  c.header('Cache-Control', 'no-store');
  return c.json({ error: code }, status);
}

/** A JSON answer that must not be cached (per-user or live data). */
export function noStore<T>(c: Context, body: T, status: 200 | 201 = 200): Response {
  c.header('Cache-Control', 'no-store');
  return c.json(body as object, status);
}
