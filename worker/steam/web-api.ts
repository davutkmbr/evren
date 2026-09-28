/**
 * The two Steamworks Web API calls Steam sign-in needs, on the partner host (publisher key, server only):
 *
 *   ISteamUserAuth/AuthenticateUserTicket/v1   ticket (hex) + identity → the player's SteamID64
 *   ISteamUser/CheckAppOwnership/v4            SteamID64 → does the player own the app
 *
 * https://partner.steamgames.com/doc/features/auth, /doc/webapi/ISteamUserAuth, /doc/webapi/ISteamUser.
 * The key travels in the `x-webapi-key` header, never in the URL, so it cannot end up in request logs.
 */
import type { SteamConfig } from './config';

/** Steam answers in a few hundred ms; a sign-in waits at most this long per call. */
const TIMEOUT_MS = 5_000;

/** The first SteamID64 of an individual account in the public universe (universe 1, type 1, instance 1). */
const STEAM_ID64_BASE = 76561197960265728n;
const ACCOUNT_ID_MAX = 0xffffffffn;

/** A SteamID64 of a real individual account, as the decimal string Steam's JSON uses. */
export function isSteamId64(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{17}$/.test(value)) {
    return false;
  }
  const accountId = BigInt(value) - STEAM_ID64_BASE;
  return accountId > 0n && accountId <= ACCOUNT_ID_MAX;
}

export interface TicketOwner {
  steamId: string;
  /** Who owns the licence the game runs under; differs from steamId under Steam Family Sharing. */
  ownerSteamId: string;
  vacBanned: boolean;
  publisherBanned: boolean;
}

export interface Ownership {
  ownsApp: boolean;
  /** False for Family Sharing, free weekends and the like. */
  permanent: boolean;
}

/** `rejected`: Steam refused the input (bad or expired ticket, wrong identity). `unavailable`: Steam or the network failed. */
export type SteamResult<T> = { ok: true; value: T } | { ok: false; reason: 'rejected' | 'unavailable'; detail: string };

export class SteamWebApi {
  constructor(
    private readonly config: SteamConfig,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async authenticateUserTicket(ticketHex: string): Promise<SteamResult<TicketOwner>> {
    const res = await this.get('ISteamUserAuth/AuthenticateUserTicket/v1', { appid: this.config.appId, ticket: ticketHex, identity: this.config.identity });
    if (!res.ok) {
      return res;
    }
    const body = res.value as { response?: { params?: Record<string, unknown>; error?: { errorcode?: number; errordesc?: string } } };
    const error = body.response?.error;
    if (error) {
      return { ok: false, reason: 'rejected', detail: `steam error ${error.errorcode}: ${error.errordesc}` };
    }
    const p = body.response?.params;
    if (!p || p.result !== 'OK' || !isSteamId64(p.steamid)) {
      return { ok: false, reason: 'rejected', detail: `unexpected ticket answer: ${JSON.stringify(p ?? body).slice(0, 200)}` };
    }
    return {
      ok: true,
      value: {
        steamId: p.steamid,
        ownerSteamId: isSteamId64(p.ownersteamid) ? p.ownersteamid : p.steamid,
        vacBanned: p.vacbanned === true,
        publisherBanned: p.publisherbanned === true,
      },
    };
  }

  async checkAppOwnership(steamId: string): Promise<SteamResult<Ownership>> {
    const res = await this.get('ISteamUser/CheckAppOwnership/v4', { appid: this.config.appId, steamid: steamId });
    if (!res.ok) {
      return res;
    }
    const o = (res.value as { appownership?: Record<string, unknown> }).appownership;
    if (!o || typeof o.ownsapp !== 'boolean') {
      return { ok: false, reason: 'unavailable', detail: `unexpected ownership answer: ${JSON.stringify(res.value).slice(0, 200)}` };
    }
    return { ok: true, value: { ownsApp: o.ownsapp, permanent: o.permanent === true } };
  }

  private async get(method: string, params: Record<string, string>): Promise<SteamResult<unknown>> {
    const url = `${this.config.apiBase}/${method}/?${new URLSearchParams(params)}`;
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: { 'x-webapi-key': this.config.apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      return { ok: false, reason: 'unavailable', detail: `${method}: ${String(e)}` };
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    // A rejected ticket comes back as response.error (HTTP 200, or 400 for malformed input); any other failure
    // (403 for a bad key, 5xx, HTML error pages) is Steam's or ours, not the player's.
    if ((body as { response?: { error?: unknown } } | null)?.response?.error) {
      return { ok: true, value: body };
    }
    if (!response.ok || body === null) {
      return { ok: false, reason: 'unavailable', detail: `${method}: HTTP ${response.status}${body === null ? ', not JSON' : ''}` };
    }
    return { ok: true, value: body };
  }
}
