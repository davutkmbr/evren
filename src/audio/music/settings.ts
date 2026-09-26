/** Persisted music settings ("Müzik" volume and "Uyarlanabilir müzik"), next to the master volume (../settings.ts). */
const VOLUME_KEY = 'ejderha.audio.music.volume';
const ADAPTIVE_KEY = 'ejderha.audio.music.adaptive';
export const DEFAULT_MUSIC_VOLUME = 0.8;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode / blocked) */
  }
}

export function loadMusicVolume(): number {
  const raw = read(VOLUME_KEY);
  const v = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_MUSIC_VOLUME;
}

export function saveMusicVolume(volume: number): void {
  write(VOLUME_KEY, String(Math.round(volume * 1000) / 1000));
}

export function loadAdaptiveMusic(): boolean {
  return read(ADAPTIVE_KEY) !== '0';
}

export function saveAdaptiveMusic(on: boolean): void {
  write(ADAPTIVE_KEY, on ? '1' : '0');
}
