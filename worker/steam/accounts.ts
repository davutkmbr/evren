/**
 * Steam identities in Better Auth's tables: an `account` row with providerId "steam" and the SteamID64 as accountId,
 * owned by an ordinary `user`. The user's e-mail is a placeholder on STEAM_EMAIL_DOMAIN (never mailed, never shown),
 * like guests'. A Steam player is a full account (not a guest) with the same profile, rooms and deletion as any other.
 */
import type { betterAuth } from 'better-auth';
import { makeSignature } from 'better-auth/crypto';

export const STEAM_PROVIDER_ID = 'steam';
export const STEAM_EMAIL_DOMAIN = 'steam.seventeenskies.com';

type AuthContext = Awaited<ReturnType<typeof betterAuth>['$context']>;

export interface SteamSession {
  userId: string;
  /** True when this sign-in created the account. */
  created: boolean;
  /** The signed session token the game sends as `Authorization: Bearer <token>`. */
  token: string;
  expiresAt: Date;
}

/** Steam keeps a Web API ticket valid for 21 days unless the game cancels it. */
const TICKET_LIFETIME_MS = 21 * 24 * 60 * 60 * 1000;

/**
 * Marks a ticket as used (Steam: "Session Tickets must only be used once"): true the first time, false for a replay
 * of the same ticket. Only the SHA-256 of the ticket is kept, in Better Auth's verification table, for the ticket's
 * lifetime.
 */
export async function claimTicket(ctx: AuthContext, ticketHex: string): Promise<boolean> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ticketHex.toLowerCase())));
  const hash = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  const identifier = `steam-ticket:${hash}`;
  // The lookup also prunes expired rows; the reservation's primary key settles two concurrent uses of one ticket.
  if (await ctx.internalAdapter.findVerificationValue(identifier)) {
    return false;
  }
  return ctx.internalAdapter.reserveVerificationValue({ identifier, value: 'used', expiresAt: new Date(Date.now() + TICKET_LIFETIME_MS) });
}

async function findSteamUser(ctx: AuthContext, steamId: string): Promise<string | null> {
  const found = await ctx.internalAdapter.findAccountOwnerByKey({ providerId: STEAM_PROVIDER_ID, accountId: steamId });
  return found?.kind === 'owned' ? found.user.id : null;
}

/** The account for a SteamID64, created on the first sign-in. */
async function findOrCreateSteamUser(ctx: AuthContext, steamId: string): Promise<{ userId: string; created: boolean }> {
  const existing = await findSteamUser(ctx, steamId);
  if (existing) {
    return { userId: existing, created: false };
  }
  const email = `${steamId}@${STEAM_EMAIL_DOMAIN}`;
  let user: { id: string };
  try {
    // name and image are replaced by the user.create hook (worker/auth/config.ts): no Steam persona data is stored.
    user = await ctx.internalAdapter.createUser({ name: 'player', email, emailVerified: false, image: null }, { method: STEAM_PROVIDER_ID });
  } catch (e) {
    // Two first sign-ins at once: the other one created the user (e-mail is unique); use it once its account exists.
    const other = await ctx.internalAdapter.findUserByEmail(email);
    if (!other) {
      throw e;
    }
    user = other.user;
  }
  try {
    await ctx.internalAdapter.createAccount({ userId: user.id, providerId: STEAM_PROVIDER_ID, accountId: steamId });
  } catch (e) {
    // The unique (providerId, accountId) index (migrations/0002) turned away the concurrent twin.
    if (!(await findSteamUser(ctx, steamId))) {
      throw e;
    }
  }
  return { userId: (await findSteamUser(ctx, steamId)) ?? user.id, created: true };
}

/** Signs a verified Steam player in: the account (created on first use) and a new session. */
export async function signInSteam(ctx: AuthContext, steamId: string): Promise<SteamSession> {
  const { userId, created } = await findOrCreateSteamUser(ctx, steamId);
  const session = await ctx.internalAdapter.createSession(userId);
  if (!session) {
    throw new Error('session not created');
  }
  // The same signed value Better Auth puts in its session cookie, so every existing session check accepts it.
  const token = `${session.token}.${await makeSignature(session.token, ctx.secret)}`;
  return { userId, created, token, expiresAt: session.expiresAt };
}
