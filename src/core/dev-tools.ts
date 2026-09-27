/**
 * Local-only developer tools: URL overrides (?view=, ?t=, ?race=, ...) and window debug hooks (window.__evren,
 * __weather, ...). The public web build (npm run build:web, EVREN_PUBLIC=1) compiles DEV_TOOLS to false: URL
 * parameters are ignored and the hooks are stripped, so nothing on seventeenskies.com can override the game.
 * Dev servers, sandbox pages and local builds keep them. Node tools that import src/ modules see true.
 */
export const DEV_TOOLS: boolean = typeof __EVREN_DEV_TOOLS__ === 'boolean' ? __EVREN_DEV_TOOLS__ : true;

const NO_PARAMS = new URLSearchParams();

/** The page's URL parameters, or none in the public build. Every URL override reads through this. */
export function devParams(search = typeof location !== 'undefined' ? location.search : ''): URLSearchParams {
  return DEV_TOOLS ? new URLSearchParams(search) : NO_PARAMS;
}

/** Installs a window debug hook (local only). */
export function exposeDebug(name: string, value: unknown): void {
  if (DEV_TOOLS && typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>)[name] = value;
  }
}
