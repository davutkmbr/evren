const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** IEEE float32 -> float16 bits (round to nearest even, clamps to +-65504). */
export function toHalf(value: number): number {
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) {
      return sign;
    }
    mant = (mant | 0x800000) >>> (1 - exp);
    const round = mant & 0x1fff;
    mant >>>= 13;
    if (round > 0x1000 || (round === 0x1000 && (mant & 1))) {
      mant++;
    }
    return sign | mant;
  }
  if (exp >= 31) {
    return sign | 0x7bff;
  }
  const round = mant & 0x1fff;
  mant >>>= 13;
  if (round > 0x1000 || (round === 0x1000 && (mant & 1))) {
    mant++;
    if (mant & 0x400) {
      mant = 0;
      exp++;
      if (exp >= 31) {
        return sign | 0x7bff;
      }
    }
  }
  return sign | (exp << 10) | mant;
}
