/**
 * Minimal GeoTIFF reader for the height rasters of the building merge (GHS-BUILT-H, Urban Atlas Building Block
 * Height): classic TIFF and BigTIFF, either byte order, strips or tiles, no / LZW / Deflate compression, predictors 1-3,
 * 8/16/32-bit integer and 32/64-bit float samples, first band only. No dependencies (the repository has no GDAL).
 *
 *   const tif = openGeoTiff(bytes);    // tags, georeference (pixel scale + tie point), nodata
 *   tif.window(x0, y0, w, h)           // Float32Array of band 1, row-major; NaN outside the image and at nodata
 *
 * Projections the rasters come in, forward only (lat / lon in degrees -> metres): World Mollweide (ESRI:54009,
 * GHS-BUILT-H) and ETRS89 LAEA Europe (EPSG:3035, Urban Atlas).
 */
import { inflateSync } from 'node:zlib';

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8 };

/** Reads the first IFD of a TIFF / BigTIFF buffer into { tag: number[] | string }. */
function readIfd(buf) {
  const le = buf[0] === 0x49;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = (o) => dv.getUint16(o, le);
  const u32 = (o) => dv.getUint32(o, le);
  const u64 = (o) => Number(dv.getBigUint64(o, le));
  const magic = u16(2);
  if (magic !== 42 && magic !== 43) {
    throw new Error(`not a TIFF (magic ${magic})`);
  }
  const big = magic === 43;
  const ifd = big ? u64(8) : u32(4);
  const n = big ? u64(ifd) : u16(ifd);
  const entry = big ? 20 : 12;
  const inline = big ? 8 : 4;
  const tags = {};
  for (let i = 0; i < n; i++) {
    const e = ifd + (big ? 8 : 2) + i * entry;
    const tag = u16(e);
    const type = u16(e + 2);
    const count = big ? u64(e + 4) : u32(e + 4);
    const size = (TYPE_SIZE[type] ?? 1) * count;
    const at = size > inline ? (big ? u64(e + 12) : u32(e + 8)) : e + (big ? 12 : 8);
    if (type === 2) {
      tags[tag] = Buffer.from(buf.buffer, buf.byteOffset + at, count).toString('latin1').replace(/\0+$/, '');
      continue;
    }
    const vals = new Array(count);
    for (let k = 0; k < count; k++) {
      const o = at + k * (TYPE_SIZE[type] ?? 1);
      vals[k] =
        type === 3
          ? u16(o)
          : type === 4 || type === 13
            ? u32(o)
            : type === 16
              ? u64(o)
              : type === 12
                ? dv.getFloat64(o, le)
                : type === 11
                  ? dv.getFloat32(o, le)
                  : type === 8
                    ? dv.getInt16(o, le)
                    : type === 9
                      ? dv.getInt32(o, le)
                      : type === 5
                        ? u32(o) / u32(o + 4)
                        : buf[o];
    }
    tags[tag] = vals;
  }
  return { le, tags };
}

/** TIFF LZW decoder (MSB-first codes, early change), `expected` output bytes. */
export function lzwDecode(src, expected) {
  const out = new Uint8Array(expected);
  let op = 0;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  for (let i = 0; i < 256; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    first[i] = i;
  }
  const stack = new Uint8Array(4096);
  let next = 258;
  let width = 9;
  let bitPos = 0;
  let prev = -1;
  const nbits = src.length * 8;
  while (bitPos + width <= nbits && op < expected) {
    let code = 0;
    for (let b = 0; b < width; b++, bitPos++) {
      code = (code << 1) | ((src[bitPos >> 3] >> (7 - (bitPos & 7))) & 1);
    }
    if (code === 257) {
      break;
    }
    if (code === 256) {
      next = 258;
      width = 9;
      prev = -1;
      continue;
    }
    let firstByte;
    let entry = code;
    if (code < next) {
      firstByte = first[code];
    } else {
      // KwKwK: the previous string followed by its own first byte.
      if (prev < 0) {
        throw new Error('LZW: code before any string');
      }
      firstByte = first[prev];
      entry = prev;
    }
    let sp = 0;
    for (let c = entry; c >= 0; c = prefix[c]) {
      stack[sp++] = suffix[c];
    }
    while (sp > 0 && op < expected) {
      out[op++] = stack[--sp];
    }
    if (code >= next && op < expected) {
      out[op++] = firstByte;
    }
    if (prev >= 0 && next < 4096) {
      prefix[next] = prev;
      suffix[next] = firstByte;
      first[next] = first[prev];
      next++;
    }
    prev = code;
    if (next + 1 >= 1 << width && width < 12) {
      width++;
    }
  }
  return out;
}

/** Undoes predictor 2 (horizontal differencing) or 3 (floating point) on one decoded block in place. */
function unpredict(bytes, predictor, rowWidth, rows, bps, le) {
  const bpp = bps / 8;
  if (predictor === 2) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let r = 0; r < rows; r++) {
      const o = r * rowWidth * bpp;
      for (let i = 1; i < rowWidth; i++) {
        const a = o + (i - 1) * bpp;
        const b = o + i * bpp;
        if (bpp === 1) {
          bytes[b] = (bytes[b] + bytes[a]) & 255;
        } else if (bpp === 2) {
          dv.setUint16(b, (dv.getUint16(b, le) + dv.getUint16(a, le)) & 0xffff, le);
        } else {
          dv.setUint32(b, (dv.getUint32(b, le) + dv.getUint32(a, le)) >>> 0, le);
        }
      }
    }
  } else if (predictor === 3) {
    // Floating point predictor: every row is byte-differenced and stored as byte planes, most significant first.
    const rowBytes = rowWidth * bpp;
    const tmp = new Uint8Array(rowBytes);
    for (let r = 0; r < rows; r++) {
      const row = bytes.subarray(r * rowBytes, (r + 1) * rowBytes);
      for (let i = 1; i < rowBytes; i++) {
        row[i] = (row[i] + row[i - 1]) & 255;
      }
      tmp.set(row);
      for (let i = 0; i < rowWidth; i++) {
        for (let b = 0; b < bpp; b++) {
          row[i * bpp + (le ? bpp - 1 - b : b)] = tmp[b * rowWidth + i];
        }
      }
    }
  }
}

/**
 * Opens a GeoTIFF held in memory. `window(x0, y0, w, h)` decodes only the tiles / strips it touches.
 * @param {Uint8Array} buf
 */
export function openGeoTiff(buf) {
  const { le, tags } = readIfd(buf);
  const width = tags[256][0];
  const height = tags[257][0];
  const bps = tags[258]?.[0] ?? 1;
  const compression = tags[259]?.[0] ?? 1;
  const spp = tags[277]?.[0] ?? 1;
  const planar = tags[284]?.[0] ?? 1;
  const predictor = tags[317]?.[0] ?? 1;
  const format = tags[339]?.[0] ?? 1;
  if (![1, 5, 8, 32946].includes(compression)) {
    throw new Error(`TIFF compression ${compression} not supported`);
  }
  const tiled = !!tags[322];
  const bw = tiled ? tags[322][0] : width;
  const bh = tiled ? tags[323][0] : Math.min(height, tags[278]?.[0] ?? height);
  const offsets = tiled ? tags[324] : tags[273];
  const counts = tiled ? tags[325] : tags[279];
  const across = Math.ceil(width / bw);
  const scale = tags[33550] ?? [1, 1, 0];
  const tie = tags[33922] ?? [0, 0, 0, 0, 0, 0];
  const nodataText = tags[42113];
  const nodata = typeof nodataText === 'string' && nodataText.trim() !== '' ? Number(nodataText) : null;
  const bpp = bps / 8;
  // Interleaved samples (planar 1): band 1 is every spp-th sample; planar 2 keeps band 1 in the first block set.
  const stride = planar === 1 ? spp : 1;
  const cache = new Map();
  const block = (k) => {
    let data = cache.get(k);
    if (data) {
      return data;
    }
    const raw = buf.subarray(offsets[k], offsets[k] + counts[k]);
    const size = bw * bh * bpp * stride;
    let bytes = compression === 1 ? Uint8Array.from(raw) : compression === 5 ? lzwDecode(raw, size) : new Uint8Array(inflateSync(raw));
    if (bytes.length < size) {
      const full = new Uint8Array(size);
      full.set(bytes);
      bytes = full;
    }
    unpredict(bytes, predictor, bw * stride, bh, bps, le);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    data = new Float32Array(bw * bh);
    for (let i = 0; i < bw * bh; i++) {
      const o = i * stride * bpp;
      let v;
      if (format === 3) {
        v = bps === 64 ? dv.getFloat64(o, le) : dv.getFloat32(o, le);
      } else if (format === 2) {
        v = bps === 8 ? dv.getInt8(o) : bps === 16 ? dv.getInt16(o, le) : dv.getInt32(o, le);
      } else {
        v = bps === 8 ? bytes[o] : bps === 16 ? dv.getUint16(o, le) : dv.getUint32(o, le);
      }
      data[i] = nodata !== null && v === nodata ? NaN : v;
    }
    if (cache.size > 64) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(k, data);
    return data;
  };
  return {
    width,
    height,
    /** Metres per pixel (x, y). */
    pixel: [scale[0], scale[1]],
    /** Projected x of the image's left edge and y of its top edge. */
    origin: [tie[3] - tie[0] * scale[0], tie[4] + tie[1] * scale[1]],
    nodata,
    tags,
    /** Band 1 over pixels [x0, x0 + w) x [y0, y0 + h), row-major; NaN outside the image and at nodata. */
    window(x0, y0, w, h) {
      const out = new Float32Array(w * h).fill(NaN);
      for (let j = Math.max(0, y0); j < Math.min(height, y0 + h); j++) {
        const bj = Math.floor(j / bh);
        for (let i = Math.max(0, x0); i < Math.min(width, x0 + w); i++) {
          const bi = tiled ? Math.floor(i / bw) : 0;
          const data = block(tiled ? bj * across + bi : bj);
          out[(j - y0) * w + (i - x0)] = data[(j - bj * bh) * bw + (i - bi * bw)];
        }
      }
      return out;
    },
  };
}

const DEG = Math.PI / 180;

/** World Mollweide (ESRI:54009): spherical formulas on R = 6378137 m, as PROJ applies them. Returns [x, y] m. */
export function mollweide(lat, lon) {
  const R = 6_378_137;
  const phi = lat * DEG;
  const target = Math.PI * Math.sin(phi);
  let t = phi;
  for (let k = 0; k < 40; k++) {
    const d = (2 * t + Math.sin(2 * t) - target) / (2 + 2 * Math.cos(2 * t));
    t -= d;
    if (Math.abs(d) < 1e-13) {
      break;
    }
  }
  return [((2 * Math.SQRT2) / Math.PI) * R * lon * DEG * Math.cos(t), Math.SQRT2 * R * Math.sin(t)];
}

/**
 * ETRS89-extended / LAEA Europe (EPSG:3035): Lambert azimuthal equal area on GRS 1980, origin 52 N 10 E, false
 * easting 4321000 m, false northing 3210000 m (EPSG Guidance Note 7-2, ellipsoidal oblique case). Returns [E, N] m.
 */
export function laeaEurope(lat, lon) {
  const a = 6_378_137;
  const f = 1 / 298.257222101;
  const e2 = f * (2 - f);
  const e = Math.sqrt(e2);
  const q = (phi) => {
    const s = Math.sin(phi);
    return (1 - e2) * (s / (1 - e2 * s * s) - (1 / (2 * e)) * Math.log((1 - e * s) / (1 + e * s)));
  };
  const phi0 = 52 * DEG;
  const lam0 = 10 * DEG;
  const qP = q(Math.PI / 2);
  const beta0 = Math.asin(q(phi0) / qP);
  const Rq = a * Math.sqrt(qP / 2);
  const D = (a * Math.cos(phi0)) / Math.sqrt(1 - e2 * Math.sin(phi0) ** 2) / (Rq * Math.cos(beta0));
  const beta = Math.asin(q(lat * DEG) / qP);
  const dl = lon * DEG - lam0;
  const B = Rq * Math.sqrt(2 / (1 + Math.sin(beta0) * Math.sin(beta) + Math.cos(beta0) * Math.cos(beta) * Math.cos(dl)));
  return [4_321_000 + B * D * Math.cos(beta) * Math.sin(dl), 3_210_000 + (B / D) * (Math.cos(beta0) * Math.sin(beta) - Math.sin(beta0) * Math.cos(beta) * Math.cos(dl))];
}
