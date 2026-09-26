/**
 * Album storage policy: keep at most ALBUM_LIMITS.maxPhotos photos and maxBytes bytes, and never more than
 * `quotaShare` of the origin's storage quota. When a new photo does not fit, the oldest photos are pruned (photos that
 * earned a golden-hour badge last), but only after the player confirmed and only once the new photo is safely written.
 * Pure logic over the PhotoStore interface (tools/headless/album-check.ts runs it against a fake store).
 */
import type { PhotoMeta, PhotoRecord, PhotoStore } from './types';

const MB = 1024 * 1024;

export interface StorageLimits {
  maxPhotos: number;
  maxBytes: number;
  /** Share of the origin quota the album may fill together with the rest of the site's data. */
  quotaShare: number;
}

export const ALBUM_LIMITS: StorageLimits = { maxPhotos: 60, maxBytes: 150 * MB, quotaShare: 0.8 };

export interface PrunePlan {
  /** Ids to delete (oldest first) so the new photo fits. */
  prune: string[];
  /** False when the photo cannot fit even after pruning everything allowed. */
  fits: boolean;
}

function bytesOf(m: Pick<PhotoMeta, 'bytes'>): number {
  return Number.isFinite(m.bytes) && m.bytes > 0 ? m.bytes : 0;
}

/**
 * Which photos to prune for a new one of `incomingBytes`. `estimate` (usage / quota of the whole origin) tightens the
 * byte budget: the album may grow to quota × quotaShare minus what the rest of the site uses.
 */
export function planPrune(
  existing: readonly Pick<PhotoMeta, 'id' | 'takenAt' | 'bytes' | 'badgeId'>[],
  incomingBytes: number,
  limits: StorageLimits = ALBUM_LIMITS,
  estimate?: { usage: number; quota: number } | null,
): PrunePlan {
  const incoming = Number.isFinite(incomingBytes) && incomingBytes > 0 ? incomingBytes : 0;
  let total = existing.reduce((s, m) => s + bytesOf(m), 0);
  let budget = Math.max(0, limits.maxBytes);
  if (estimate && Number.isFinite(estimate.quota) && estimate.quota > 0 && Number.isFinite(estimate.usage)) {
    const others = Math.max(0, estimate.usage - total);
    budget = Math.min(budget, Math.max(0, estimate.quota * limits.quotaShare - others));
  }
  if (incoming > budget) {
    return { prune: [], fits: false };
  }
  let count = existing.length + 1;
  const maxPhotos = Math.max(1, Math.floor(limits.maxPhotos));
  // Oldest first; photos with a badge go last.
  const order = [...existing].sort((a, b) => Number(!!a.badgeId) - Number(!!b.badgeId) || (a.takenAt || 0) - (b.takenAt || 0));
  const prune: string[] = [];
  for (const m of order) {
    if (count <= maxPhotos && total + incoming <= budget) {
      break;
    }
    prune.push(m.id);
    count--;
    total -= bytesOf(m);
  }
  const fits = count <= maxPhotos && total + incoming <= budget;
  return { prune: fits ? prune : [], fits };
}

export type SaveOutcome =
  | { status: 'saved'; pruned: string[] }
  | { status: 'needs-confirm'; prune: string[] }
  | { status: 'no-space' }
  | { status: 'error'; message: string };

export function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; code?: number } | null;
  return !!err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22);
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Saves a photo under the policy. Without `confirmPrune`, a save that would delete older photos writes nothing and
 * returns 'needs-confirm' with the ids. With it, the new photo is written first and the old ones are deleted only
 * after the write succeeded. A quota error on the write retries once after pruning (confirmed only) one more photo.
 */
export async function savePhoto(
  store: PhotoStore,
  record: PhotoRecord,
  options: { confirmPrune?: boolean; limits?: StorageLimits } = {},
): Promise<SaveOutcome> {
  const limits = options.limits ?? ALBUM_LIMITS;
  let existing: PhotoMeta[];
  let estimate: { usage: number; quota: number } | null = null;
  try {
    existing = await store.listMeta();
    estimate = (await store.estimate?.().catch(() => null)) ?? null;
  } catch (e) {
    return { status: 'error', message: message(e) };
  }
  const plan = planPrune(existing, record.meta.bytes, limits, estimate);
  if (!plan.fits) {
    return { status: 'no-space' };
  }
  if (plan.prune.length > 0 && !options.confirmPrune) {
    return { status: 'needs-confirm', prune: plan.prune };
  }
  const pruned: string[] = [];
  try {
    await store.put(record);
  } catch (e) {
    if (!isQuotaError(e)) {
      return { status: 'error', message: message(e) };
    }
    // The browser ran out of room before our own budget did.
    // One more photo has to go (by the same order: oldest first, badge photos last).
    const oneMore = planPrune(existing, record.meta.bytes, { ...limits, maxPhotos: existing.length - plan.prune.length }).prune;
    if (!options.confirmPrune) {
      return oneMore.length > 0 ? { status: 'needs-confirm', prune: oneMore } : { status: 'no-space' };
    }
    const victims = new Set([...plan.prune, ...oneMore]);
    if (victims.size === 0) {
      return { status: 'no-space' };
    }
    try {
      for (const id of victims) {
        await store.remove(id);
        pruned.push(id);
      }
      await store.put(record);
    } catch (e2) {
      return isQuotaError(e2) ? { status: 'no-space' } : { status: 'error', message: message(e2) };
    }
    return { status: 'saved', pruned };
  }
  for (const id of plan.prune) {
    try {
      await store.remove(id);
      pruned.push(id);
    } catch {
      /* left for the next save */
    }
  }
  return { status: 'saved', pruned };
}
