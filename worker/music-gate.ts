/**
 * US-risky historic recordings under /audio/music/private/ (public domain in Turkey, still protected in the US,
 * .docs/assets/private-assets.md). Visitors from the US and its territories, and requests whose country is unknown or
 * Tor, get 451; the game then keeps its mood music (mergePrivatePhrases needs the manifest).
 */

export const MUSIC_PRIVATE_PREFIX = '/audio/music/private/';

/** US, its territories with US copyright law, unknown country (XX) and Tor (T1). */
const BLOCKED = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'XX', 'T1']);

export async function serveGatedMusic(request: Request, env: Env): Promise<Response> {
  const country = (request.cf?.country as string | undefined) ?? 'XX';
  if (BLOCKED.has(country)) {
    return new Response('Unavailable in your region.', {
      status: 451,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const res = await env.ASSETS.fetch(request);
  // Per-country answers: shared caches must not hand this response to another visitor.
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'private, max-age=3600');
  return out;
}
