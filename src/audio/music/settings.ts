/** Persisted music settings ("Müzik" volume, "Uyarlanabilir müzik", "Müzik tarzı"), next to the master volume (../settings.ts). */
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

/**
 * "Müzik tarzı": `sparse` ("Seyrek") = mostly silence with a short phrase now and then (sprinkle mode, ./sprinkle.ts);
 * `continuous` ("Sürekli") = the looping stem sets. Unset = automatic: sparse when the manifest has sprinkle phrases,
 * continuous otherwise.
 */
export type MusicStyle = 'sparse' | 'continuous';
const STYLE_KEY = 'ejderha.audio.music.style';

/** The stored style, or null while the player never chose one (automatic). */
export function loadMusicStyle(): MusicStyle | null {
  const raw = read(STYLE_KEY);
  return raw === 'sparse' || raw === 'continuous' ? raw : null;
}

export function saveMusicStyle(style: MusicStyle): void {
  write(STYLE_KEY, style);
}

/** The style in effect: the stored choice, else sparse when sprinkle phrases exist. */
export function effectiveMusicStyle(stored: MusicStyle | null, hasPhrases: boolean): MusicStyle {
  return stored ?? (hasPhrases ? 'sparse' : 'continuous');
}
