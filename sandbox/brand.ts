/**
 * Brand sandbox: the Seventeen Skies logo, icons and share image, drawn from src/ui/brand-logo.ts.
 *   /sandbox/brand.html                   brand sheet (logos, icons, palette, lines)
 *   ?show=og                              1200 x 630 share image (public/brand/og.jpg)
 *   ?show=icon&size=512[&radius=0]        app icon (public/brand/icon-*.png, apple-touch-icon.png)
 *   ?show=logo&w=1600                     the full logo on a transparent background
 * Rasterise with snap.mjs (the page sets __evren.ready), e.g.
 *   node scripts/snap.mjs --url "/sandbox/brand.html?show=og" --w 1200 --h 630 --out public/brand/og.jpg
 * scripts/brand/build-brand.ts writes the SVG files.
 */
import { BRAND, BRAND_COLORS } from '../src/ui/brand';
import { monogramSvg, titleLogoSvg } from '../src/ui/brand-logo';
import heroShot from '../.docs/media/golden-horn.jpg';
import bridgeShot from '../.docs/media/bosphorus-bridge.jpg';

const params = new URLSearchParams(location.search);
const show = params.get('show') ?? 'sheet';
const app = document.getElementById('app')!;
document.body.style.margin = '0';

const css = (s: string): void => {
  const el = document.createElement('style');
  el.textContent = s;
  document.head.append(el);
};

css(`
  body { background: ${BRAND_COLORS.night}; color: ${BRAND_COLORS.ivory}; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .shot { position: relative; overflow: hidden; background: #000 url(${heroShot}) center / cover; }
  .shot::before { content: ''; position: absolute; inset: 0;
    background: radial-gradient(60% 70% at 50% 45%, rgba(7,10,18,0.25), rgba(7,10,18,0.75)),
      linear-gradient(180deg, rgba(7,10,18,0.55), rgba(7,10,18,0.1) 45%, rgba(7,10,18,0.7)); }
  .shot > * { position: relative; }
`);

if (show === 'og') {
  // A 1200 x 630 window of the 1600 x 900 Bosphorus shot at native scale that leaves out the HUD (compass above,
  // instruments and minimap below); the dragon sits under the logo.
  css(`
    .og { width: 1200px; height: 630px; background: #000 url(${bridgeShot}) -190px -112px / 1600px 900px no-repeat; }
    .og::before { background: radial-gradient(70% 60% at 50% 30%, rgba(7,10,18,0.5), rgba(7,10,18,0) 70%),
      linear-gradient(180deg, rgba(7,10,18,0.35), rgba(7,10,18,0) 55%, rgba(7,10,18,0.72)); }
    .og svg { position: absolute; left: 50%; top: 22px; transform: translateX(-50%); }
    .og .line { position: absolute; left: 0; right: 0; bottom: 64px; margin: 0; text-align: center; font-size: 28px; letter-spacing: 0.01em; color: ${BRAND_COLORS.ivory}; text-shadow: 0 2px 18px rgba(0,0,0,0.75); }
    .og .url { position: absolute; left: 0; right: 0; bottom: 30px; margin: 0; text-align: center; font-size: 15px; letter-spacing: 0.3em; text-transform: uppercase; color: ${BRAND_COLORS.goldPale}; text-shadow: 0 1px 10px rgba(0,0,0,0.8); }
  `);
  app.innerHTML = `<div class="og shot" lang="en">${titleLogoSvg({ width: 600 })}<p class="line">${BRAND.lineEn}</p><p class="url">seventeenskies.com</p></div>`;
} else if (show === 'icon') {
  const size = Number(params.get('size') ?? 512);
  const radius = params.has('radius') ? Number(params.get('radius')) : undefined;
  document.body.style.background = 'transparent';
  app.innerHTML = monogramSvg({ size, radius });
  app.style.cssText = `width:${size}px;height:${size}px;line-height:0`;
} else if (show === 'logo') {
  document.body.style.background = 'transparent';
  app.innerHTML = titleLogoSvg({ width: Number(params.get('w') ?? 1600) });
  app.style.cssText = 'display:inline-block;line-height:0';
} else {
  css(`
    .sheet { max-width: 1200px; margin: 0 auto; padding: 48px 32px 80px; display: grid; gap: 28px; }
    .sheet h1 { margin: 0; font-size: 13px; letter-spacing: 0.24em; text-transform: uppercase; color: ${BRAND_COLORS.gold}; font-weight: 600; }
    .panel { border-radius: 18px; padding: 48px; display: flex; align-items: center; justify-content: center; gap: 40px; flex-wrap: wrap; }
    .dark { background: radial-gradient(80% 90% at 50% 20%, ${BRAND_COLORS.gok}, ${BRAND_COLORS.night}); }
    .light { background: #efe7da; }
    .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .sw { border-radius: 12px; padding: 64px 14px 12px; font-size: 12px; line-height: 1.4; border: 1px solid rgba(255,255,255,0.08); }
    .sw b { display: block; font-size: 13px; }
    .lines p { margin: 6px 0; font-size: 20px; }
    .lines small { color: rgba(251,246,238,0.6); font-size: 14px; }
  `);
  const swatches = (Object.entries(BRAND_COLORS) as [string, string][])
    .map(([k, v]) => `<div class="sw" style="background:${v};color:${['ivory', 'goldPale', 'gold'].includes(k) ? '#1a1208' : '#fbf6ee'}"><b>${k}</b>${v}</div>`)
    .join('');
  app.innerHTML = `
    <div class="sheet">
      <h1><span lang="en">${BRAND.name}</span> · marka</h1>
      <div class="panel dark">${titleLogoSvg({ width: 720, id: 'a' })}</div>
      <div class="panel shot" style="min-height:520px">${titleLogoSvg({ width: 640, id: 'b' })}</div>
      <div class="panel dark">
        ${titleLogoSvg({ width: 320, id: 'c', crest: false })}
        ${titleLogoSvg({ width: 160, id: 'd', crest: false })}
      </div>
      <div class="panel dark">
        ${monogramSvg({ size: 256, id: 'm1' })}${monogramSvg({ size: 128, id: 'm2' })}${monogramSvg({ size: 64, id: 'm3' })}
        ${monogramSvg({ size: 32, id: 'm4' })}${monogramSvg({ size: 16, id: 'm5' })}
      </div>
      <div class="row">${swatches}</div>
      <div class="lines">
        <p>${BRAND.lineTr}</p><p><small>${BRAND.lineEn}</small></p>
        <p>${BRAND.descriptionTr}</p><p><small>${BRAND.descriptionEn}</small></p>
        <p><small>${BRAND.url.replace('https://', '')} · ${BRAND.hashtag}</small></p>
      </div>
    </div>`;
}

// snap.mjs waits for __evren.ready and pending() === 0; the background shot counts as pending until it is decoded.
let pending = 1;
const img = new Image();
img.src = show === 'og' ? bridgeShot : heroShot;
img.decode().catch(() => undefined).finally(() => {
  pending = 0;
});
(window as unknown as { __evren: unknown }).__evren = { ready: true, pending: () => pending, stats: () => ({}) };
