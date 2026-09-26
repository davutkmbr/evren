/**
 * Procedural content that moment records may reference (pure ids, no three.js): every actor, animation and sound listed
 * here is built in code (no external asset), so a record whose ids all resolve here needs no model, animation or sound
 * from outside. moments-check verifies that every 'ready' record's ids resolve; the runtime treats the sounds as
 * available (no ambience fallback); the game system (./system.ts) maps actor ids to their implementations
 * (./actors.ts).
 */

/** Procedural actors (models + behaviour), by id → where they live. */
export const PROCEDURAL_ACTORS: Readonly<Record<string, string>> = {
  'moments/white-stork-flock': 'src/moments/storks (instanced white storks, kettle / glide flock simulation)',
};

/** Procedural animations (vertex-shader wing poses driven by the flock simulation). */
export const PROCEDURAL_ANIMATIONS: Readonly<Record<string, string>> = {
  'moments/stork-soar-circle': 'src/moments/storks: soaring pose (wings spread flat, fingers fanned and curled up), circling in the kettle',
  'moments/stork-glide': 'src/moments/storks: gliding pose (hands swept back, fingers closed), occasional deep flaps',
};

/** Procedural (synthesised) sounds. */
export const PROCEDURAL_SOUNDS: Readonly<Record<string, string>> = {
  'moments/stork-bill-clatter': 'src/audio/sfx/storks.ts: bill clatter, soft wing beats and air rush of passing storks; src/audio/voices/moment.ts: soft wind bed',
};

export const AVAILABLE_MOMENT_SOUNDS: ReadonlySet<string> = new Set(Object.keys(PROCEDURAL_SOUNDS));

/** Ids of a record's content that do not resolve to procedural content (empty = complete). */
export function unresolvedContent(content: { actorId?: string; animationIds?: readonly string[]; soundId?: string }): string[] {
  const out: string[] = [];
  if (content.actorId && !(content.actorId in PROCEDURAL_ACTORS)) {
    out.push(content.actorId);
  }
  for (const a of content.animationIds ?? []) {
    if (!(a in PROCEDURAL_ANIMATIONS)) {
      out.push(a);
    }
  }
  if (content.soundId && !(content.soundId in PROCEDURAL_SOUNDS)) {
    out.push(content.soundId);
  }
  return out;
}
