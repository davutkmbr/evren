/**
 * Sessions for native clients (the Steam build): `Authorization: Bearer <signed session token>` is read as the
 * session cookie, so getSession, sign-out and every route behind requireUser work unchanged.
 *
 * The request half of Better Auth's bearer plugin only: that plugin also copies the session token into a
 * `set-auth-token` header on every web sign-in, which would hand the HttpOnly cookie's value to page scripts. Native
 * clients get their token once, in the body of POST /api/auth/sign-in/steam. A request that already carries cookies
 * (a browser) is left alone.
 */
import type { BetterAuthPlugin } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { setRequestCookie } from 'better-auth/cookies';

/** The token of `Authorization: Bearer <token>`, when a request has one and no cookies. */
export function bearerToken(headers: Headers): string | null {
  if (headers.has('cookie')) {
    return null;
  }
  const auth = headers.get('authorization');
  if (!auth || auth.slice(0, 7).toLowerCase() !== 'bearer ') {
    return null;
  }
  const token = auth.slice(7).trim();
  // Signed tokens only: "<token>.<base64 HMAC>" (Better Auth verifies the signature when it reads the cookie).
  return /^[A-Za-z0-9]+\.[A-Za-z0-9+/=]+$/.test(token) ? token : null;
}

export const nativeSession = (): BetterAuthPlugin => ({
  id: 'native-session',
  hooks: {
    before: [
      {
        matcher: (context) => !!(context.request?.headers ?? context.headers)?.get('authorization'),
        handler: createAuthMiddleware(async (c) => {
          const incoming = c.request?.headers ?? c.headers;
          const token = incoming ? bearerToken(incoming) : null;
          if (!incoming || !token) {
            return;
          }
          const headers = new Headers(incoming);
          setRequestCookie(headers, c.context.authCookies.sessionToken.name, token);
          return { context: { headers } };
        }),
      },
    ],
  },
});
