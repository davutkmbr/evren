/**
 * Turns a ticket from the game into a verified SteamID64, with the sign-in policy:
 *
 * - the ticket must be hex from GetAuthTicketForWebApi(identity) for our App ID (Steam checks both);
 * - a publisher ban (set by us in Steamworks) refuses sign-in; a VAC ban does not (the game has no VAC and a
 *   ban from another game says nothing about this one);
 * - the account must own the app; Family Sharing counts (a calm, non-competitive game), reported as familyShared
 *   and not stored.
 */
import type { SteamWebApi } from './web-api';

/** Web API tickets are a few hundred bytes; anything far larger is not a ticket. */
const MAX_TICKET_HEX = 4096;

export type VerifyFailure =
  /** 400: not a ticket at all. */
  | 'invalid-ticket'
  /** 401: Steam refused the ticket (expired, cancelled, wrong identity or app). */
  | 'ticket-rejected'
  /** 403 */
  | 'banned'
  /** 403 */
  | 'not-owned'
  /** 503: Steam or the network failed; the game retries later and stays offline meanwhile. */
  | 'steam-unavailable';

export type VerifyResult = { ok: true; steamId: string; familyShared: boolean } | { ok: false; error: VerifyFailure };

export function isTicketHex(ticket: unknown): ticket is string {
  return typeof ticket === 'string' && ticket.length >= 2 && ticket.length <= MAX_TICKET_HEX && ticket.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(ticket);
}

export async function verifySteamTicket(api: SteamWebApi, ticket: unknown): Promise<VerifyResult> {
  if (!isTicketHex(ticket)) {
    return { ok: false, error: 'invalid-ticket' };
  }
  const auth = await api.authenticateUserTicket(ticket);
  if (!auth.ok) {
    console.warn('[steam] ticket', auth.reason, auth.detail);
    return { ok: false, error: auth.reason === 'rejected' ? 'ticket-rejected' : 'steam-unavailable' };
  }
  const who = auth.value;
  if (who.publisherBanned) {
    return { ok: false, error: 'banned' };
  }
  const own = await api.checkAppOwnership(who.steamId);
  if (!own.ok) {
    console.warn('[steam] ownership', own.reason, own.detail);
    return { ok: false, error: 'steam-unavailable' };
  }
  if (!own.value.ownsApp) {
    return { ok: false, error: 'not-owned' };
  }
  return { ok: true, steamId: who.steamId, familyShared: who.ownerSteamId !== who.steamId };
}
