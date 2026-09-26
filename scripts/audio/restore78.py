"""
Conservative restoration of 78 rpm transfers and objective quality metrics (no listening possible in the build
container). Used by scripts/audio/prep-moment-music.py; importable for analysis.

Chain (denoised variant), all on a mono 48 kHz float signal:
  1. subsonic high-pass (30 Hz, 2nd order) and a gentle rumble high-pass (HPF_HZ, 2nd order);
  2. hum notches at 50 or 60 Hz and two harmonics, only when the groove noise shows a clear mains peak;
  3. declick: impulses found in the residual of a short-term linear predictor (robust threshold), each gap of up to
     CLICK_MAX_MS re-synthesised by least-squares AR interpolation (Janssen / Vaseghi LSAR) from the samples around it;
  4. hiss: stationary spectral gating (noisereduce) with the noise profile taken from the lead-in groove, reduced by
     at most PROP_DECREASE so a thin, even hiss stays (no gating artefacts, no "underwater" sound).
The raw variant only gets the subsonic high-pass: the crackle stays as it is.

Metrics (per variant, on the cut segment unless stated):
  - noise_db: RMS level of the lead-in groove after the same chain;
  - music_db: 70th percentile of the 50 ms frame RMS of the segment; snr_db = music_db - noise_db;
  - flatness_quiet: mean spectral flatness (Wiener entropy) of the quietest 10 % of the segment's frames;
  - kurtosis_ratio: log ratio of the power-spectrum kurtosis of the groove after / before the hiss stage (musical
    noise, the "metallic" artefact of spectral subtraction, raises it; < ~1 is inaudible in the literature);
  - band_change_db: change of the music's own power (loud frames minus the groove noise) in 300 Hz - 3 kHz: the
    music must stay (|change| <= 1.5 dB);
  - hf_change_db: the same in 3 - 6 kHz, the top of an acoustic recording's range (a loss > 3 dB sounds dull or
    underwater); both judge the dehiss stage against the declicked signal (the *_vs_raw values include the clicks);
  - hiss_change_db: groove noise change in 5 - 10 kHz (how much hiss went);
  - clicks_per_s: impulses the detector still finds in the segment.
"""
from __future__ import annotations

import numpy as np
from scipy import linalg, signal

SR = 48000
HPF_HZ = 70.0
CLICK_MAX_MS = 2.5
CLICK_K = 9.0
PROP_DECREASE = 0.5


def to_mono_48k(x: np.ndarray, sr: int) -> np.ndarray:
    if x.ndim == 2:
        x = x.mean(axis=1)
    x = x.astype(np.float64)
    if sr != SR:
        g = np.gcd(sr, SR)
        x = signal.resample_poly(x, SR // g, sr // g)
    return x - np.mean(x)


def highpass(x: np.ndarray, hz: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, hz, 'highpass', fs=SR, output='sos')
    return signal.sosfiltfilt(sos, x)


def frame_rms_db(x: np.ndarray, hop: float = 0.05) -> np.ndarray:
    n = int(hop * SR)
    m = len(x) // n
    f = x[: m * n].reshape(m, n)
    return 10 * np.log10(np.mean(f ** 2, axis=1) + 1e-12)


def db(x: np.ndarray) -> float:
    return float(10 * np.log10(np.mean(x ** 2) + 1e-12))


def find_leadin(x: np.ndarray, max_s: float = 12.0) -> tuple[float, float]:
    """The run-in groove before the music: from 0.15 s to the first frame 10 dB over the quiet start."""
    r = frame_rms_db(x[: int(max_s * SR)])
    base = np.percentile(r[3:40], 20) if len(r) > 40 else np.min(r)
    loud = np.nonzero(r > base + 10)[0]
    end = (loud[0] * 0.05 - 0.15) if len(loud) else 1.0
    return 0.15, max(0.4, end)


def quietest_region(x: np.ndarray, length: float = 1.0) -> tuple[float, float]:
    """The quietest stretch of groove noise: digital silence (a transfer's gated head or tail) does not count."""
    r = frame_rms_db(x)
    r = np.where(r < -55, 0.0, r)
    k = int(length / 0.05)
    s = np.convolve(r, np.ones(k) / k, mode='valid')
    i = int(np.argmin(s))
    return i * 0.05, i * 0.05 + length


# ------------------------------------------------------------------ hum


def hum_frequency(noise: np.ndarray) -> float | None:
    f, p = signal.welch(noise, SR, nperseg=min(len(noise), 1 << 15))
    for base in (50.0, 60.0):
        hits = 0
        for h in (1, 2, 3):
            i = int(np.argmin(np.abs(f - base * h)))
            around = np.r_[p[max(0, i - 12): max(0, i - 3)], p[i + 4: i + 13]]
            if p[i - 1: i + 2].max() > 10 * np.median(around):  # 10 dB over its neighbours
                hits += 1
        if hits >= 2:
            return base
    return None


def notch_hum(x: np.ndarray, base: float) -> np.ndarray:
    for h in (1, 2, 3):
        b, a = signal.iirnotch(base * h, 30.0, SR)
        x = signal.filtfilt(b, a, x)
    return x


# ------------------------------------------------------------------ clicks

LPC_ORDER = 24
BLOCK = 2048


def _lpc(frame: np.ndarray, order: int) -> np.ndarray:
    r = np.correlate(frame, frame, 'full')[len(frame) - 1: len(frame) + order]
    r[0] *= 1.0001
    if r[0] <= 0:
        return np.zeros(order)
    return linalg.solve_toeplitz(r[:order], r[1: order + 1])


def detect_clicks(x: np.ndarray, k: float = CLICK_K) -> list[tuple[int, int]]:
    """Impulsive samples: the short-term LPC residual beyond k robust sigmas (MAD) of its block, merged and padded."""
    flags = np.zeros(len(x), bool)
    win = np.hanning(BLOCK + 2 * LPC_ORDER)
    for s in range(LPC_ORDER, len(x) - BLOCK - LPC_ORDER, BLOCK):
        seg = x[s - LPC_ORDER: s + BLOCK + LPC_ORDER]
        a = _lpc(seg * win, LPC_ORDER)
        e = signal.lfilter(np.r_[1.0, -a], [1.0], seg)[LPC_ORDER:LPC_ORDER + BLOCK]
        sigma = 1.4826 * np.median(np.abs(e - np.median(e))) + 1e-9
        flags[s: s + BLOCK] = np.abs(e) > k * sigma
    idx = np.nonzero(flags)[0]
    if len(idx) == 0:
        return []
    pad = int(0.0004 * SR)
    runs: list[list[int]] = []
    for i in idx:
        if runs and i - runs[-1][1] <= pad * 2:
            runs[-1][1] = i
        else:
            runs.append([i, i])
    maxlen = int(CLICK_MAX_MS / 1000 * SR)
    out = []
    for a, b in runs:
        a, b = max(0, a - pad), min(len(x) - 1, b + pad)
        if b - a + 1 <= maxlen:
            out.append((a, b + 1))
    return out


def lsar_fill(x: np.ndarray, a0: int, a1: int, order: int = 32, ctx: int = 384) -> None:
    """Least-squares AR interpolation of x[a0:a1] in place (the AR model is fitted on the samples around the gap)."""
    s0, s1 = max(0, a0 - ctx), min(len(x), a1 + ctx)
    seg = x[s0:s1].copy()
    known = np.ones(len(seg), bool)
    known[a0 - s0: a1 - s0] = False
    if known.sum() < 3 * order:
        return
    fit = np.r_[seg[: a0 - s0], seg[a1 - s0:]]
    a = _lpc(fit * np.hanning(len(fit)), order)
    c = np.r_[1.0, -a]
    n = len(seg)
    rows = n - order
    A = np.zeros((rows, n))
    for i in range(rows):
        A[i, i: i + order + 1] = c[::-1]
    Au, Ak = A[:, ~known], A[:, known]
    rhs = -Ak @ seg[known]
    try:
        xu = linalg.lstsq(Au, rhs, lapack_driver='gelsy')[0]
    except linalg.LinAlgError:
        return
    x[a0:a1] = xu


def declick(x: np.ndarray) -> tuple[np.ndarray, int]:
    y = x.copy()
    clicks = detect_clicks(y)
    for a, b in clicks:
        lsar_fill(y, a, b)
    return y, len(clicks)


# ------------------------------------------------------------------ hiss


def dehiss(x: np.ndarray, noise: np.ndarray, prop: float = PROP_DECREASE) -> np.ndarray:
    import noisereduce as nr

    return nr.reduce_noise(
        y=x.astype(np.float32), sr=SR, y_noise=noise.astype(np.float32), stationary=True, prop_decrease=prop,
        n_fft=2048, freq_mask_smooth_hz=500, time_mask_smooth_ms=64, n_std_thresh_stationary=1.0,
    ).astype(np.float64)


# ------------------------------------------------------------------ metrics


def _stft_power(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    f, _, z = signal.stft(x, SR, nperseg=2048, noverlap=1024)
    return f, np.abs(z) ** 2


def spectral_flatness(p: np.ndarray, f: np.ndarray, lo: float = 200, hi: float = 8000) -> np.ndarray:
    band = (f >= lo) & (f <= hi)
    q = p[band] + 1e-14
    return np.exp(np.mean(np.log(q), axis=0)) / np.mean(q, axis=0)


def kurtosis(p: np.ndarray) -> float:
    v = p.ravel()
    m = v.mean()
    return float(np.mean(v ** 2) / (m * m + 1e-30))  # 4th-order moment of the magnitude / power² (Uemura)


def band_db(p: np.ndarray, f: np.ndarray, lo: float, hi: float) -> float:
    band = (f >= lo) & (f < hi)
    return float(10 * np.log10(np.mean(p[band]) + 1e-20))


def segment_metrics(seg: np.ndarray, groove: np.ndarray) -> dict:
    f, p = _stft_power(seg)
    frame_db = 10 * np.log10(np.mean(p, axis=0) + 1e-20)
    quiet = p[:, frame_db <= np.percentile(frame_db, 10)]
    r = frame_rms_db(seg)
    music = float(np.percentile(r, 70))
    noise = db(groove)
    return {
        'music_db': round(music, 2),
        'noise_db': round(noise, 2),
        'snr_db': round(music - noise, 2),
        'flatness_quiet': round(float(np.mean(spectral_flatness(quiet, f))), 4),
        'clicks_per_s': round(len(detect_clicks(seg)) / (len(seg) / SR), 2),
    }


def compare(raw_seg: np.ndarray, pre_seg: np.ndarray, den_seg: np.ndarray, raw_groove: np.ndarray, pre_hiss_groove: np.ndarray,
            den_groove: np.ndarray) -> dict:
    """
    Music preservation: the power the music adds over the groove noise in the loud frames, per band. The dehiss stage
    is judged against the declicked signal before it (clicks are broadband, so against the raw record their removal
    would count as lost treble); the change against the raw record is reported too.
    """
    f, pr = _stft_power(raw_seg)
    _, pp = _stft_power(pre_seg)
    _, pd = _stft_power(den_seg)
    loud = 10 * np.log10(np.mean(pr, axis=0) + 1e-20)
    sel = loud >= np.percentile(loud, 60)
    _, nr_ = _stft_power(raw_groove)
    _, g0 = _stft_power(pre_hiss_groove)
    _, g1 = _stft_power(den_groove)

    def excess(p: np.ndarray, noise: np.ndarray, lo: float, hi: float) -> float:
        band = (f >= lo) & (f < hi)
        return max(float(np.mean(p[band][:, sel]) - np.mean(noise[band])), 1e-20)

    def change(lo: float, hi: float, ref: np.ndarray, ref_noise: np.ndarray) -> float:
        return round(10 * np.log10(excess(pd, g1, lo, hi) / excess(ref, ref_noise, lo, hi)), 2)

    return {
        'band_change_db': change(300, 3000, pp, g0),
        'hf_change_db': change(3000, 6000, pp, g0),
        'band_change_vs_raw_db': change(300, 3000, pr, nr_),
        'hf_change_vs_raw_db': change(3000, 6000, pr, nr_),
        'hiss_change_db': round(band_db(g1, f, 5000, 10000) - band_db(nr_, f, 5000, 10000), 2),
        'kurtosis_ratio': round(float(np.log(kurtosis(g1) / kurtosis(g0))), 3),
    }


def verdict(raw: dict, den: dict, cmp: dict) -> tuple[str, list[str]]:
    """Default variant: 'denoised' when it clearly helps and shows no artefact heuristic, else 'raw'."""
    why = []
    gain = den['snr_db'] - raw['snr_db']
    if gain < 3:
        why.append(f'SNR gain {gain:.1f} dB < 3 dB')
    if cmp['kurtosis_ratio'] > 1.0:
        why.append(f'kurtosis ratio {cmp["kurtosis_ratio"]} > 1 (musical-noise risk)')
    if abs(cmp['band_change_db']) > 1.5:
        why.append(f'music 300 Hz-3 kHz changed {cmp["band_change_db"]} dB (> 1.5 dB)')
    if cmp['hf_change_db'] < -3:
        why.append(f'music 3-6 kHz lost {-cmp["hf_change_db"]} dB (> 3 dB: dull, underwater)')
    return ('denoised' if not why else 'raw'), why


# ------------------------------------------------------------------ loudness


def lufs(x: np.ndarray) -> float:
    import pyloudnorm as pyln

    return float(pyln.Meter(SR).integrated_loudness(x))


def true_peak_db(x: np.ndarray) -> float:
    up = signal.resample_poly(x, 4, 1)
    return float(20 * np.log10(np.max(np.abs(up)) + 1e-12))


def normalise(x: np.ndarray, target: float = -18.0, ceiling: float = -1.0) -> np.ndarray:
    g = target - lufs(x)
    y = x * 10 ** (g / 20)
    tp = true_peak_db(y)
    if tp > ceiling:
        y *= 10 ** ((ceiling - tp) / 20)
    return y


def fade(x: np.ndarray, fade_in: float, fade_out: float) -> np.ndarray:
    y = x.copy()
    ni, no = int(fade_in * SR), int(fade_out * SR)
    if ni:
        y[:ni] *= np.sin(np.linspace(0, np.pi / 2, ni)) ** 2
    if no:
        y[-no:] *= np.cos(np.linspace(0, np.pi / 2, no)) ** 2
    return y
