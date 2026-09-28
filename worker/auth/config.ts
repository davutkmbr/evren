/**
 * Accounts (phase 26): Better Auth on D1. Every online player has an account: a guest one created silently with a
 * nickname (anonymous plugin), which "Google ile kaydet" links to Google later, keeping the profile. Google sign-in
 * is on once GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set. Endpoints under /api/auth/* (Better Auth's own).
 * Steam sign-in (worker/steam) adds Steam accounts and bearer sessions for the Steam build when STEAM_AUTH is on.
 *
 * Data kept to what the game uses (KVKK, and what /legal/privacy says): the e-mail identifies a Google account; the
 * real name, the photo and Google's tokens are dropped before they are written (the game never calls Google), as are
 * IP addresses and user agents. Other players only ever see the profile's nickname (worker/account).
 */
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { anonymous } from 'better-auth/plugins';
import { moveProfile } from '../account/profiles';
import { steamEnabled } from '../steam/config';
import { nativeSession } from '../steam/native-session';

/** Guest accounts get a placeholder e-mail on this domain (never mailed). */
const GUEST_EMAIL_DOMAIN = 'guest.seventeenskies.com';
const DAY_S = 24 * 60 * 60;
/** Stands in for the provider's real name, which the game does not keep (the nickname lives in the profile). */
const PLACEHOLDER_NAME = 'player';
const NO_TOKENS = { accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null };

/** A user update without the provider's name or photo (sign-in may refresh them). */
function stripIdentity<T extends Record<string, unknown>>(user: T): T {
  const out = { ...user };
  if ('name' in out) {
    (out as Record<string, unknown>).name = PLACEHOLDER_NAME;
  }
  if ('image' in out) {
    (out as Record<string, unknown>).image = null;
  }
  return out;
}

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
      user: {
        create: { before: async (user) => ({ data: { ...user, name: PLACEHOLDER_NAME, image: null } }) },
        update: { before: async (user) => ({ data: stripIdentity(user) }) },
      },
      account: {
        create: { before: async (account) => ({ data: { ...account, ...NO_TOKENS } }) },
        update: { before: async (account) => ({ data: { ...account, ...NO_TOKENS } }) },
      },
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
          await moveProfile(env.DB, anonymousUser.user.id, newUser.user.id);
        },
      }),
      ...(steamEnabled(env) ? [nativeSession()] : []),
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
