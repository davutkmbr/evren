// Builds a contact sheet from a burst capture (tools/review/burst-capture.js via scripts/snap.mjs): one tile per
// frame with its time, camera FOV, airspeed and push.  node tools/review/burst-sheet.mjs <capture.json> <out.png> [title]
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const [inPath, outPath, title = ''] = process.argv.slice(2);
const { frames } = JSON.parse(readFileSync(inPath, 'utf8'));
const cols = 4;
const tileW = 480;
const tileH = 270;
const pad = 8;
const head = title ? 34 : 0;
const rows = Math.ceil(frames.length / cols);
const W = cols * tileW + (cols + 1) * pad;
const H = head + rows * (tileH + 26) + (rows + 1) * pad;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const composites = [];
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  const x = pad + (i % cols) * (tileW + pad);
  const y = head + pad + Math.floor(i / cols) * (tileH + 26 + pad);
  const img = await sharp(Buffer.from(f.image.split(',')[1], 'base64')).resize(tileW, tileH).png().toBuffer();
  composites.push({ input: img, left: x, top: y });
  const label = `<svg width="${tileW}" height="24"><text x="2" y="17" font-family="sans-serif" font-size="14" fill="#e8e4dc">${esc(f.label)}  ·  FOV ${f.fov}°  ·  ${f.speed} m/s  ·  push ${f.burst}</text></svg>`;
  composites.push({ input: Buffer.from(label), left: x, top: y + tileH + 2 });
}
if (title) {
  composites.push({ input: Buffer.from(`<svg width="${W}" height="${head}"><text x="${pad}" y="24" font-family="sans-serif" font-size="18" fill="#f3eee5">${esc(title)}</text></svg>`), left: 0, top: 0 });
}
await sharp({ create: { width: W, height: H, channels: 3, background: '#15171c' } }).composite(composites).png().toFile(outPath);
console.log(outPath, W, H);
