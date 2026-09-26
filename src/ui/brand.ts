/**
 * Seventeen Skies brand constants shared by the UI, the brand sandbox (sandbox/brand.html) and the static files in
 * public/brand/. The logo itself is drawn in brand-logo.ts. Rules and the story behind the name:
 * .docs/brand/README.md.
 */

export const BRAND = {
  name: 'Seventeen Skies',
  /** Player-facing line (the game's locale is Turkish). */
  lineTr: 'Gök on yedi kattır. İlki İstanbul.',
  lineEn: 'The sky has seventeen layers. The first is Istanbul.',
  descriptionTr: 'Türk mitolojisinin uçan yaratıklarıyla gerçek İstanbul üzerinde serbest uçuş. Tarayıcıda, kodla üretilmiş bir dünya.',
  descriptionEn: 'Ride the flying creatures of Turkic myth over a real, living Istanbul, in your browser.',
  url: 'https://seventeenskies.com',
  hashtag: '#SeventeenSkies',
} as const;

export const BRAND_COLORS = {
  /** Night sky: backgrounds. */
  night: '#070a12',
  /** Deep gök blue: secondary backgrounds and gradients. */
  gok: '#14223a',
  /** Ülgen gold: the logo's mid tone and the UI accent (--accent). */
  gold: '#e8b872',
  /** Pale gold: highlights (--accent-2). */
  goldPale: '#f3d3a0',
  /** Bronze: the logo's shadow tone. */
  bronze: '#8c5420',
  /** Outline brown behind the carved letters. */
  outline: '#241406',
  /** Dawn ember: sparing warm accent. */
  ember: '#e0763a',
  /** Ivory: text on dark. */
  ivory: '#fbf6ee',
} as const;
