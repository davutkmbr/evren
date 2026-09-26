/**
 * IndexedDB storage for the photo album, per viewer and local only (nothing leaves the browser). Two object stores:
 * `photos` (metadata + thumbnail, read for the grid) and `images` (the full image, read on demand). Every call is
 * guarded: without IndexedDB (private window, blocked site data) the album reports itself unavailable.
 */
import type { PhotoEntry, PhotoMeta, PhotoRecord, PhotoStore } from './types';

const DB_NAME = 'evren.album';
const DB_VERSION = 1;
const PHOTOS = 'photos';
const IMAGES = 'images';

interface PhotoRow {
  id: string;
  meta: PhotoMeta;
  thumb: Blob;
}

interface ImageRow {
  id: string;
  image: Blob;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

export class IdbPhotoStore implements PhotoStore {
  private db: Promise<IDBDatabase> | null = null;

  /** False when IndexedDB is missing or refused to open. */
  async available(): Promise<boolean> {
    try {
      await this.open();
      return true;
    } catch {
      return false;
    }
  }

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        let r: IDBOpenDBRequest;
        try {
          if (typeof indexedDB === 'undefined') {
            throw new Error('IndexedDB unavailable');
          }
          r = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (e) {
          reject(e);
          return;
        }
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains(PHOTOS)) {
            db.createObjectStore(PHOTOS, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(IMAGES)) {
            db.createObjectStore(IMAGES, { keyPath: 'id' });
          }
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new Error('IndexedDB blocked'));
      });
      this.db.catch(() => {
        this.db = null;
      });
    }
    return this.db;
  }

  async listMeta(): Promise<PhotoMeta[]> {
    return (await this.entries()).map((e) => e.meta);
  }

  /** Metadata and thumbnails, newest first. */
  async entries(): Promise<PhotoEntry[]> {
    const db = await this.open();
    const rows = await req(db.transaction(PHOTOS, 'readonly').objectStore(PHOTOS).getAll() as IDBRequest<PhotoRow[]>);
    return rows
      .filter((r) => r && r.meta && r.thumb)
      .map((r) => ({ meta: r.meta, thumb: r.thumb }))
      .sort((a, b) => b.meta.takenAt - a.meta.takenAt);
  }

  async image(id: string): Promise<Blob | null> {
    const db = await this.open();
    const row = await req(db.transaction(IMAGES, 'readonly').objectStore(IMAGES).get(id) as IDBRequest<ImageRow | undefined>);
    return row?.image ?? null;
  }

  async put(record: PhotoRecord): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([PHOTOS, IMAGES], 'readwrite');
    const finished = done(tx);
    tx.objectStore(IMAGES).put({ id: record.meta.id, image: record.image } satisfies ImageRow);
    tx.objectStore(PHOTOS).put({ id: record.meta.id, meta: record.meta, thumb: record.thumb } satisfies PhotoRow);
    await finished;
  }

  async remove(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([PHOTOS, IMAGES], 'readwrite');
    const finished = done(tx);
    tx.objectStore(PHOTOS).delete(id);
    tx.objectStore(IMAGES).delete(id);
    await finished;
  }

  async estimate(): Promise<{ usage: number; quota: number } | null> {
    try {
      const e = await navigator.storage?.estimate?.();
      return e && typeof e.usage === 'number' && typeof e.quota === 'number' ? { usage: e.usage, quota: e.quota } : null;
    } catch {
      return null;
    }
  }
}
