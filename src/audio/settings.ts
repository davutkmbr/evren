const VOLUME_KEY = 'ejderha.audio.volume';
/** Full scale: the mix itself is levelled for game loudness (~-24 LUFS cruise), the slider only turns it down. */
export const DEFAULT_VOLUME = 1;

export function loadVolume(): number {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw === null) {
      return DEFAULT_VOLUME;
    }
    const v = Number(raw);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function saveVolume(volume: number): void {
  try {
    window.localStorage.setItem(VOLUME_KEY, String(Math.round(volume * 1000) / 1000));
  } catch {
    /* storage unavailable (private mode / blocked) */
  }
}
