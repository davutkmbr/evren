/**
 * Download helpers of scripts/data/fetch-footprints.mjs: streamed downloads with md5 / sha256 (and the server's
 * Content-MD5 checked when it sends one), a one-file zip reader, HTML to text for licence pages, and the Bing Maps
 * quadkeys of a bounding box (Microsoft's footprint tiles).
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inflateRawSync } from 'node:zlib';

const UA = 'seventeen-skies-data/1.0 (scripts/data/fetch-footprints.mjs)';

/** md5 and sha256 (hex) of a file. */
export async function hashFile(path) {
  const md5 = createHash('md5');
  const sha = createHash('sha256');
  await pipeline(
    createReadStream(path),
    new Transform({
      transform(chunk, _enc, done) {
        md5.update(chunk);
        sha.update(chunk);
        done();
      },
    }),
  );
  return { md5: md5.digest('hex'), sha256: sha.digest('hex'), bytes: statSync(path).size };
}

/**
 * Downloads `url` to `file` (via `file.part`) unless it exists (or `force`). Verifies the server's Content-MD5 when
 * it sends one. Returns { url, bytes, md5, sha256, lastModified, contentMd5, cached }.
 */
export async function download(url, file, { force = false, log = console.error } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file) && !force) {
    return { url, ...(await hashFile(file)), cached: true };
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`${url}: HTTP ${res.status}`);
  }
  const md5 = createHash('md5');
  const sha = createHash('sha256');
  const part = `${file}.part`;
  const size = Number(res.headers.get('content-length')) || 0;
  log(`downloading ${url}${size ? ` (${(size / 1e6).toFixed(1)} MB)` : ''}`);
  await pipeline(
    Readable.fromWeb(res.body),
    new Transform({
      transform(chunk, _enc, done) {
        md5.update(chunk);
        sha.update(chunk);
        done(null, chunk);
      },
    }),
    createWriteStream(part),
  );
  const out = { url, bytes: statSync(part).size, md5: md5.digest('hex'), sha256: sha.digest('hex'), lastModified: res.headers.get('last-modified'), contentMd5: res.headers.get('content-md5'), cached: false };
  if (out.contentMd5 && Buffer.from(out.contentMd5, 'base64').toString('hex') !== out.md5) {
    rmSync(part);
    throw new Error(`${url}: md5 ${out.md5} does not match the server's Content-MD5 ${out.contentMd5}`);
  }
  renameSync(part, file);
  return out;
}

/** GET as text (licence pages, CKAN metadata). */
export async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`${url}: HTTP ${res.status}`);
  }
  return res.text();
}

/** The main text of an HTML page (licence snapshots): scripts, styles and navigation dropped, paragraphs kept. */
export function htmlToText(html) {
  const body = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<body[\s\S]*?<\/body>/i)?.[0] ?? html;
  const text = body
    .replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, '')
    // Raw line breaks (CR or LF) are spaces in HTML; only tags break lines.
    .replace(/\s+/g, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|h\d|div|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)));
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Contents of the first zip entry whose name matches `re` (stored or deflated). */
export function unzipEntry(zip, re) {
  // End of central directory: the last 'PK\x05\x06' record.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error('zip: no end of central directory');
  }
  const entries = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let k = 0; k < entries; k++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) {
      throw new Error('zip: bad central directory');
    }
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!re.test(name)) {
      continue;
    }
    const lNameLen = zip.readUInt16LE(local + 26);
    const lExtraLen = zip.readUInt16LE(local + 28);
    const data = zip.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
    if (method === 0) {
      return { name, data: Buffer.from(data) };
    }
    if (method === 8) {
      return { name, data: inflateRawSync(data) };
    }
    throw new Error(`zip: ${name} uses compression method ${method}`);
  }
  throw new Error(`zip: no entry matches ${re}`);
}

/** Bing Maps tile of a lat / lon at `level`. */
export function tileOf(lat, lon, level) {
  const n = 2 ** level;
  const s = Math.sin((Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180);
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

/** Quadkey of tile x, y at `level`. */
export function quadkey(x, y, level) {
  let q = '';
  for (let i = level; i > 0; i--) {
    const m = 1 << (i - 1);
    q += String((x & m ? 1 : 0) + (y & m ? 2 : 0));
  }
  return q;
}

/** Quadkeys of every tile at `level` that a { south, west, north, east } box touches. */
export function quadkeysOf(bbox, level) {
  const [x0, y0] = tileOf(bbox.north, bbox.west, level);
  const [x1, y1] = tileOf(bbox.south, bbox.east, level);
  const out = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      out.push(quadkey(x, y, level));
    }
  }
  return out;
}
