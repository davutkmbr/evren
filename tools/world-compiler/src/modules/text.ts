/**
 * Text as modules: one glyph module per character of the sign font (shopfront/font.ts, authored at cap height 1 from
 * x = 0), and text families whose slots carry the string itself (the slot's style): the runtime sets it with the
 * glyphs (src/street/modules/expand.ts), so a shop name costs a few bytes instead of a few hundred triangles.
 * Families: `text` (fac_letters), `text.glow_red` / `text.glow_green` (neon), `text.spray` (graffiti letters).
 */
import { type Batch } from '../facade/frame';
import type { RGBA } from '../mesh';
import { emitText, glyphChars, hasGlyphs, type TextOptions, textWidth, TRACK } from '../shopfront/font';
import type { SlotSink } from './slots';
import type { AuthorCtx, FamilySpec } from './spec';

const W1: RGBA = [1, 1, 1, 1];

/** Text family of a text material (materials without one stay baked geometry). */
const FAMILY_OF: Record<string, string> = { fac_letters: 'text', fac_glow_red: 'text.glow_red', fac_glow_green: 'text.glow_green', fac_spray: 'text.spray' };

export const TEXT_FAMILIES: FamilySpec[] = [
  {
    name: 'glyph',
    doc: 'Sign font glyphs, one variant per character (cap height 1, from x = 0; `advance` in cap heights). Used by the text families.',
    variants: glyphChars().map((ch) => ({
      id: ch,
      ref: [1, 0, 0] as [number, number, number],
      advance: textWidth(ch),
      ...(ch.trim()
        ? { author: (c: AuthorCtx) => c.tint(0, () => emitText(c.b, ch, { material: 'fac_letters', color: W1, r: (textWidth(ch) * c.w) / 2, y: 0, d: 0, capH: c.w, depth: 0 })) }
        : {}),
    })),
  },
  { name: 'text', doc: 'Flat letters (the slot style is the text; r its centre, y the baseline, w the cap height, tint 0 the colour).', text: { glyphs: 'glyph', track: TRACK }, variants: [] },
  { name: 'text.glow_red', doc: 'Red neon letters.', text: { glyphs: 'glyph', track: TRACK }, remap: { fac_letters: 'fac_glow_red' }, variants: [] },
  { name: 'text.glow_green', doc: 'Green neon letters.', text: { glyphs: 'glyph', track: TRACK }, remap: { fac_letters: 'fac_glow_green' }, variants: [] },
  { name: 'text.spray', doc: 'Sprayed letters (graffiti).', text: { glyphs: 'glyph', track: TRACK }, remap: { fac_letters: 'fac_spray' }, variants: [] },
];

/**
 * A text on the batch's frame as a text slot when `slots` is given and the text fits the module font (flat letters
 * of a text material, every character known); otherwise baked geometry as before (emitText).
 */
export function emitTextSlot(batch: Batch, slots: SlotSink | null | undefined, text: string, o: TextOptions): void {
  const family = FAMILY_OF[o.material];
  if (!slots || !family || o.depth > 0 || o.mirror || !hasGlyphs(text) || !text.trim()) {
    emitText(batch, text, o);
    return;
  }
  slots.add(batch.f, family, { style: text, seed: 0, r: o.r, y: o.y, d: o.d, w: o.capH, tint0: o.color });
}
