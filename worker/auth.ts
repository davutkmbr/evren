/**
 * Accounts (phase 26): Better Auth on D1. Every online player has an account: a guest one created silently with a
 * nickname (anonymous plugin), which "Google ile kaydet" links to Google later, keeping the profile. Google sign-in
 * is on once GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set. Endpoints under /api/auth/* (Better Auth's own).
 *
 * The real name and e-mail Google returns stay in the account tables; other players only ever see the profile's
 * nickname (worker/account.ts).
 */
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { anonymous } from 'better-auth/plugins';

/** Guest accounts get a placeholder e-mail on this domain (never mailed). */
const GUEST_EMAIL_DOMAIN = 'guest.seventeenskies.com';
const DAY_S = 24 * 60 * 60;

export function authOptions(env: Env): BetterAuthOptions {
  const baseURL = env.BETTER_AUTH_URL;
  const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET;
  return {
    appName: 'Seventeen Skies',
    baseURL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [baseURL],
    socialProviders: google ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, prompt: 'select_account' } } : {},
    session: { expiresIn: 90 * DAY_S, updateAge: DAY_S },
    // No IP addresses or user agents in the session rows (KVKK: store only what the game needs).
    advanced: { ipAddress: { disableIpTracking: true } },
    databaseHooks: {
      session: {
        create: { before: async (session) => ({ data: { ...session, ipAddress: null, userAgent: null } }) },
        update: { before: async (session) => ({ data: { ...session, ipAddress: null, userAgent: null } }) },
      },
    },
    telemetry: { enabled: false },
    account: { accountLinking: { enabled: true, trustedProviders: ['google'] } },
    plugins: [
      anonymous({
        emailDomainName: GUEST_EMAIL_DOMAIN,
        // The guest's profile moves to the account it is linked to, unless that account already has one.
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await env.DB.prepare('UPDATE profile SET user_id = ?1 WHERE user_id = ?2 AND NOT EXISTS (SELECT 1 FROM profile WHERE user_id = ?1)')
            .bind(newUser.user.id, anonymousUser.user.id)
            .run();
        },
      }),
    ],
  };
}

type Auth = ReturnType<typeof betterAuth>;
let cached: Auth | null = null;

/** One Better Auth instance per isolate. BETTER_AUTH_URL is the site's origin (.dev.vars sets the local one). */
export function getAuth(env: Env): Auth {
  cached ??= betterAuth(authOptions(env));
  return cached;
}

/** The only origin whose pages may call the API with the session cookie. */
export function siteOrigin(env: Env): string {
  return new URL(env.BETTER_AUTH_URL).origin;
}

/** The signed-in user of a request, or null. */
export async function sessionUser(request: Request, env: Env): Promise<{ id: string; isAnonymous: boolean; email: string } | null> {
  const session = await getAuth(env).api.getSession({ headers: request.headers });
  if (!session) {
    return null;
  }
  const u = session.user as { id: string; email: string; isAnonymous?: boolean | null };
  return { id: u.id, isAnonymous: !!u.isAnonymous, email: u.email };
}
