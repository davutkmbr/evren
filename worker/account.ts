/**
 * The signed-in player's own account and public profile (phase 26):
 *
 *   GET  /api/me            { user: { id, guest, email? } | null, profile: { nickname } | null, providers }
 *                           (user null when signed out; providers.google: Google sign-in offered). The other routes
 *                           answer 401 when signed out.
 *   PUT  /api/me/profile    { nickname }  → { profile }   400 invalid, 409 taken
 *   DELETE /api/me          deletes the account: user, sessions, linked Google account and profile (KVKK), signs out
 *
 * Signing in (guest or Google) and signing out are Better Auth's endpoints under /api/auth/*. Writes need the site's
 * own Origin (the session cookie alone is not enough).
 */
import { cleanName } from '../src/net/protocol';
import { sessionUser, siteOrigin } from './auth';

export interface Profile {
  nickname: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** The key that makes nicknames unique regardless of case (Turkish İ/ı fold like the rest). */
export function nicknameKey(nickname: string): string {
  return nickname.toLocaleLowerCase('tr');
}

export async function loadProfile(env: Env, userId: string): Promise<Profile | null> {
  return env.DB.prepare('SELECT nickname FROM profile WHERE user_id = ?1').bind(userId).first<Profile>();
}

export async function handleAccount(request: Request, env: Env, path: string): Promise<Response> {
  const providers = { google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) };
  if (request.method !== 'GET' && request.headers.get('Origin') !== siteOrigin(env)) {
    return json({ error: 'origin' }, 403);
  }
  const user = await sessionUser(request, env);
  if (!user) {
    // Every page load asks: signed out is a normal answer there, not an error in the console.
    return path === '/api/me' && request.method === 'GET' ? json({ user: null, profile: null, providers }) : json({ error: 'signed-out' }, 401);
  }
  if (path === '/api/me' && request.method === 'GET') {
    const profile = await loadProfile(env, user.id);
    return json({ user: { id: user.id, guest: user.isAnonymous, email: user.isAnonymous ? undefined : user.email }, profile, providers });
  }
  if (path === '/api/me/profile' && request.method === 'PUT') {
    const body = (await request.json().catch(() => null)) as { nickname?: unknown } | null;
    const nickname = cleanName(body?.nickname);
    if (!nickname) {
      return json({ error: 'invalid' }, 400);
    }
    const now = Date.now();
    try {
      await env.DB.prepare(
        `INSERT INTO profile (user_id, nickname, nickname_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT (user_id) DO UPDATE SET nickname = excluded.nickname, nickname_key = excluded.nickname_key, updated_at = excluded.updated_at`,
      )
        .bind(user.id, nickname, nicknameKey(nickname), now)
        .run();
    } catch (e) {
      if (String(e).includes('UNIQUE')) {
        return json({ error: 'taken' }, 409);
      }
      throw e;
    }
    return json({ profile: { nickname } });
  }
  if (path === '/api/me' && request.method === 'DELETE') {
    // Sessions, the Google link and the profile go with the user row (foreign keys, on delete cascade).
    await env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(user.id).run();
    const res = json({ deleted: true });
    for (const name of ['better-auth.session_token', '__Secure-better-auth.session_token', 'better-auth.session_data', '__Secure-better-auth.session_data']) {
      res.headers.append('Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${name.startsWith('__Secure') ? '; Secure' : ''}`);
    }
    return res;
  }
  return json({ error: 'not found' }, 404);
}
