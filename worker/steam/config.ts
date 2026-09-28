/**
 * Steam sign-in settings (worker/steam). Off unless all three are set:
 *
 *   STEAM_AUTH          var     "on" to enable (wrangler.jsonc; anything else keeps it off)
 *   STEAM_APP_ID        var     the Steamworks App ID the game's tickets are issued for
 *   STEAM_WEB_API_KEY   secret  the publisher Web API key (Steamworks → Users & Permissions → Manage Groups);
 *                               `npx wrangler secret put STEAM_WEB_API_KEY`, locally in .dev.vars. Never in code.
 *
 * Optional: STEAM_TICKET_IDENTITY (default "seventeenskies", must match the identity the game passes to
 * GetAuthTicketForWebApi) and STEAM_API_BASE (default https://partner.steam-api.com; a proxy base if Steam ever
 * refuses requests from Workers).
 */

export const DEFAULT_TICKET_IDENTITY = 'seventeenskies';
export const DEFAULT_STEAM_API_BASE = 'https://partner.steam-api.com';

export interface SteamConfig {
  appId: string;
  apiKey: string;
  identity: string;
  apiBase: string;
}

/** Optional overrides, unset in wrangler.jsonc (so not in the generated Env type). */
interface SteamOverrides {
  STEAM_TICKET_IDENTITY?: string;
  STEAM_API_BASE?: string;
}

/** The Steam settings of this deployment, or null when Steam sign-in is off. */
export function steamConfig(env: Env): SteamConfig | null {
  const appId = env.STEAM_APP_ID?.trim();
  const apiKey = env.STEAM_WEB_API_KEY?.trim();
  if (env.STEAM_AUTH !== 'on' || !appId || !/^\d+$/.test(appId) || !apiKey) {
    return null;
  }
  const overrides = env as Env & SteamOverrides;
  return {
    appId,
    apiKey,
    identity: overrides.STEAM_TICKET_IDENTITY?.trim() || DEFAULT_TICKET_IDENTITY,
    apiBase: (overrides.STEAM_API_BASE?.trim() || DEFAULT_STEAM_API_BASE).replace(/\/+$/, ''),
  };
}

export const steamEnabled = (env: Env): boolean => steamConfig(env) !== null;
