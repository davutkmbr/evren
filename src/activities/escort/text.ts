/** Player-facing (Turkish) texts of the ferry escort. */
import { formatGateDistance } from '../text';
import type { EscortEndReason } from './escort';

/** The key that offers, starts and stops an escort (input button 'escort'). */
export const ESCORT_KEY = 'Z';

/** "Kadıköy İskelesi" → "Kadıköy". */
export function shortPierName(name: string): string {
  return name.replace(/\s+İskelesi$/u, '').trim();
}

/** Escort length: 45 → "45 sn", 412 → "6 dk 52 sn", 1260 → "21 dk". */
export function formatEscortDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) {
    return `${s} sn`;
  }
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m >= 15 || r === 0 ? `${Math.round(s / 60)} dk` : `${m} dk ${r} sn`;
}

/** Closing lines of the arrival card, picked in turn. */
const WARM_LINES: readonly string[] = [
  'Halatlar atıldı; güzel bir yolculuktu.',
  'Martılar da sen de iskeleye kadar eşlik ettiniz.',
  'Yolcular iniyor, biri sana el sallıyor olabilir.',
  'Vapur yanaştı, çay bardakları son kez tıngırdadı.',
  'İskele memuru başını kaldırıp gökyüzüne baktı.',
];

export const ESCORT_TEXT = {
  prompt: 'Vapura eşlik et',
  stop: 'Eşliği bırak',
  nextPier: (pierName: string): string => `Sıradaki iskele: ${shortPierName(pierName)}`,
  pierDistance: (meters: number): string => formatGateDistance(meters),
  docked: 'Vapur iskelede',
  away: 'Vapurdan uzaklaşıyorsun',
  card: {
    meta: 'Vapur eşliği',
    badge: 'Yeni hat',
    route: (fromName: string, toName: string): string => `${shortPierName(fromName)} → ${shortPierName(toName)}`,
    routes: (done: number, total: number): string => `Eşlik edilen hatlar ${done}/${total}`,
    warm: (n: number): string => WARM_LINES[((n % WARM_LINES.length) + WARM_LINES.length) % WARM_LINES.length],
  },
  /** Quiet toast when an escort ends (none for a race or an arrival: the card says it). */
  ended: (reason: EscortEndReason): string | null => {
    switch (reason) {
      case 'player':
        return 'Vapura eşlik etmeyi bıraktın.';
      case 'drifted':
        return 'Vapurla yollarınız ayrıldı.';
      default:
        return null;
    }
  },
} as const;
