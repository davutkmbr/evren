/**
 * Writes the Seventeen Skies brand SVGs and the web manifest to public/brand/ from src/ui/brand-logo.ts.
 *
 *   npx tsx scripts/brand/build-brand.ts
 *
 * The PNGs (share image, app icons) are screenshots of sandbox/brand.html; see the list printed at the end.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND, BRAND_COLORS } from '../../src/ui/brand';
import { monogramSvg, titleLogoSvg } from '../../src/ui/brand-logo';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'brand');
mkdirSync(OUT, { recursive: true });

const files: Record<string, string> = {
  'logo.svg': titleLogoSvg({ id: 'ss' }),
  'logo-title.svg': titleLogoSvg({ id: 'ss', crest: false }),
  'icon.svg': monogramSvg({ id: 'ss' }),
  'favicon.svg': monogramSvg({ id: 'ss', radius: 0.2 }),
  'site.webmanifest': JSON.stringify(
    {
      name: BRAND.name,
      short_name: BRAND.name,
      description: BRAND.descriptionTr,
      lang: 'tr',
      start_url: '../',
      scope: '../',
      display: 'fullscreen',
      orientation: 'landscape',
      background_color: BRAND_COLORS.night,
      theme_color: BRAND_COLORS.night,
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    },
    null,
    2,
  ) + '\n',
};

for (const [name, body] of Object.entries(files)) {
  writeFileSync(join(OUT, name), body.endsWith('\n') ? body : body + '\n');
  console.log(`public/brand/${name}`);
}

const snap = (url: string, w: number, h: number, out: string): string =>
  `node scripts/snap.mjs --url "${url}" --w ${w} --h ${h} --out public/brand/${out}`;
console.log('\nPNG renders (dev server on 5199):');
console.log(snap('/sandbox/brand.html?show=og', 1200, 630, 'og.jpg'));
console.log(snap('/sandbox/brand.html?show=icon&size=512', 512, 512, 'icon-512.png'));
console.log(snap('/sandbox/brand.html?show=icon&size=192', 192, 192, 'icon-192.png'));
console.log(snap('/sandbox/brand.html?show=icon&size=180&radius=0', 180, 180, 'apple-touch-icon.png'));
console.log(snap('/sandbox/brand.html?show=icon&size=32', 32, 32, 'favicon-32.png'));
