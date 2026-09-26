/**
 * Earned golden-hour badges and the album's photo quality, per viewer in localStorage. Every access is guarded: with
 * blocked storage both live for the session only. Badges stay earned even when their photo is deleted.
 */

const BADGES_KEY = 'evren.album.badges.v1';
const QUALITY_KEY = 'evren.album.quality.v1';

export interface EarnedBadge {
  /** Photo that earned it (may have been deleted since). */
  photoId: string;
  earnedAt: number;
}

export type PhotoQuality = 'high' | 'balanced' | 'small';

/** Encoder settings per quality: WebP quality and the longest image side (px, 0 = the canvas as is). */
export const PHOTO_QUALITY: Record<PhotoQuality, { quality: number; maxSide: number; label: string }> = {
  high: { quality: 0.92, maxSide: 0, label: 'Yüksek' },
  balanced: { quality: 0.85, maxSide: 2560, label: 'Dengeli' },
  small: { quality: 0.78, maxSide: 1600, label: 'Küçük' },
};

let badges: Record<string, EarnedBadge> | null = null;
let quality: PhotoQuality | null = null;
const listeners = new Set<() => void>();

function read(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: kept for this session */
  }
}

export function earnedBadges(): Readonly<Record<string, EarnedBadge>> {
  if (!badges) {
    badges = {};
    const parsed = read(BADGES_KEY);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
        const b = v as Partial<EarnedBadge> | null;
        if (b && typeof b.photoId === 'string' && typeof b.earnedAt === 'number') {
          badges[id] = { photoId: b.photoId, earnedAt: b.earnedAt };
        }
      }
    }
  }
  return badges;
}

/** Records a badge; true when it is new. */
export function earnBadge(id: string, photoId: string, at: number): boolean {
  const all = earnedBadges() as Record<string, EarnedBadge>;
  if (all[id]) {
    return false;
  }
  all[id] = { photoId, earnedAt: at };
  write(BADGES_KEY, all);
  for (const fn of listeners) {
    fn();
  }
  return true;
}

export function onBadgesChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function photoQuality(): PhotoQuality {
  if (!quality) {
    const q = read(QUALITY_KEY);
    quality = q === 'high' || q === 'balanced' || q === 'small' ? q : 'high';
  }
  return quality;
}

export function setPhotoQuality(q: PhotoQuality): void {
  quality = q;
  write(QUALITY_KEY, q);
}
