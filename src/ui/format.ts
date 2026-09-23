/** Turkish number, time and heading formatting (decimal comma, dot thousands). */

const intFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const twoDecimals = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatInt(value: number): string {
  return intFormat.format(Math.round(value));
}

export function formatDecimal(value: number, digits: 1 | 2 = 1): string {
  return (digits === 1 ? oneDecimal : twoDecimals).format(value);
}

/** Minus sign (U+2212) instead of a hyphen for negative values. */
export function formatSigned(value: number, digits: 1 | 2 = 1): string {
  const abs = formatDecimal(Math.abs(value), digits);
  if (Math.abs(value) < 0.05) {
    return formatDecimal(0, digits);
  }
  return value > 0 ? `+${abs}` : `−${abs}`;
}

export function formatDistance(meters: number): string {
  if (meters < 950) {
    return `${formatInt(Math.round(meters / 10) * 10)} m`;
  }
  return `${formatDecimal(meters / 1000)} km`;
}

export function formatClock(hours: number): string {
  const wrapped = ((hours % 24) + 24) % 24;
  const totalMinutes = Math.floor(wrapped * 60 + 1e-6);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export function formatHeading(deg: number): string {
  const wrapped = Math.round(((deg % 360) + 360) % 360) % 360;
  return `${wrapped.toString().padStart(3, '0')}°`;
}

/** Years: negative values are BCE ("MÖ 667"). */
export function formatYear(year: number): string {
  return year < 0 ? `MÖ ${Math.abs(year)}` : String(year);
}

export function formatCount(value: number): string {
  if (value >= 1e6) {
    return `${formatDecimal(value / 1e6, 2)} M`;
  }
  if (value >= 1e4) {
    return `${formatDecimal(value / 1e3)} B`;
  }
  return formatInt(value);
}

const CARDINALS = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'] as const;

/** 8-point Turkish compass abbreviation (K, KD, D, GD, G, GB, B, KB). */
export function cardinal(deg: number): string {
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return CARDINALS[i];
}

/** Wraps an angle difference to (-180, 180]. */
export function wrapDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) {
    d -= 360;
  } else if (d <= -180) {
    d += 360;
  }
  return d;
}
