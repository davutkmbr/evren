#!/usr/bin/env python3
"""
Builds the moment pieces cut from historic 78 rpm records (tools/assets/moment-pieces.json) out of the archived
originals in assets-src/audio/78rpm/<recording-id>/ (fetched by `node scripts/data/fetch-assets.mjs --kind=recording`).

    python3 scripts/audio/prep-moment-music.py [--id=a,b] [--dry-run]

For every piece, two variants are made from the same cut, each normalised to -18 LUFS integrated (true peak <= -1 dBTP):
  - denoised: rumble high-pass, hum notch when needed, declick (LSAR), gentle spectral-gating dehiss (restore78.py);
  - raw: only a 30 Hz subsonic high-pass: the record's own crackle stays.
Both are encoded twice (Opus 96 kbps and AAC 128 kbps .m4a, 48 kHz mono). The objective metrics of both variants and
the resulting default ('denoised' when the denoise clearly helps without artefact heuristics, else 'raw'; a piece may
force one with "variant") go to tools/assets/moment-pieces.report.json, and each piece is written into its manifest:
  - target "public"  -> public/audio/music/moments/<id>[.raw].{opus,m4a} and public/audio/music/manifest.json;
  - target "private" -> private-assets/audio/moments/<id>[.raw].{opus,m4a} and private-assets/audio/moments/manifest.json
    (gitignored; served at audio/music/private/ in dev and copied into builds by vite.config.ts).

Needs Python 3 with numpy, scipy, soundfile, noisereduce and pyloudnorm (`pip install numpy scipy soundfile noisereduce
pyloudnorm`) and ffmpeg with libopus (FFMPEG=/path/to/ffmpeg, else `ffmpeg` on PATH; the static builds from
johnvansickle.com/ffmpeg work).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import restore78 as R  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RECIPES = os.path.join(ROOT, 'tools/assets/moment-pieces.json')
REPORT = os.path.join(ROOT, 'tools/assets/moment-pieces.report.json')
APPROVED = os.path.join(ROOT, 'tools/assets/approved.json')
CACHE = os.path.join(ROOT, 'assets-src/audio/78rpm')
TARGETS = {
    'public': {'dir': os.path.join(ROOT, 'public/audio/music/moments'), 'prefix': 'moments/',
               'manifest': os.path.join(ROOT, 'public/audio/music/manifest.json')},
    'private': {'dir': os.path.join(ROOT, 'private-assets/audio/moments'), 'prefix': 'private/',
                'manifest': os.path.join(ROOT, 'private-assets/audio/moments/manifest.json')},
}
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')


def encode(wav: str, out_base: str) -> None:
    common = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-map_metadata', '-1', '-ac', '1']
    subprocess.run(common + ['-c:a', 'libopus', '-b:a', '96k', '-vbr', 'on', '-application', 'audio', out_base + '.opus'], check=True)
    subprocess.run(common + ['-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out_base + '.m4a'], check=True)


def process(piece: dict, rec: dict) -> dict:
    src = os.path.join(CACHE, rec['id'], piece['file'])
    x, sr = sf.read(src, always_2d=True)
    x = R.to_mono_48k(x, sr)
    t0, t1 = piece['segment']
    # Noise profile: the run-in groove before the music, or the quietest second when the transfer has none.
    if piece.get('noise', 'leadin') == 'leadin':
        g0, g1 = R.find_leadin(x)
    else:
        g0, g1 = R.quietest_region(x, 1.0)
    if 'noiseRegion' in piece:
        g0, g1 = piece['noiseRegion']
    gs = slice(int(g0 * R.SR), int(g1 * R.SR))
    work0 = max(0.0, min(t0, g0) - 0.1)
    work1 = min(len(x) / R.SR, max(t1, g1) + 0.1)
    w = x[int(work0 * R.SR): int(work1 * R.SR)]
    rel = lambda a, b: slice(int((a - work0) * R.SR), int((b - work0) * R.SR))  # noqa: E731

    raw = R.highpass(w, 30.0)
    den = R.highpass(w, R.HPF_HZ)
    hum = R.hum_frequency(den[rel(g0, g1)])
    if hum:
        den = R.notch_hum(den, hum)
    den, n_clicks = R.declick(den)
    pre_hiss = den.copy()
    den = R.dehiss(den, den[rel(g0, g1)], piece.get('propDecrease', R.PROP_DECREASE))

    seg = rel(t0, t1)
    m_raw = R.segment_metrics(raw[seg], raw[rel(g0, g1)])
    m_den = R.segment_metrics(den[seg], den[rel(g0, g1)])
    cmp = R.compare(raw[seg], pre_hiss[seg], den[seg], raw[rel(g0, g1)], pre_hiss[rel(g0, g1)], den[rel(g0, g1)])
    auto, why = R.verdict(m_raw, m_den, cmp)
    default = piece.get('variant', auto)

    target = TARGETS[piece['target']]
    os.makedirs(target['dir'], exist_ok=True)
    variants = {}
    with tempfile.TemporaryDirectory() as tmp:
        for name, sig in (('denoised', den), ('raw', raw)):
            y = R.fade(sig[seg], piece.get('fadeIn', 1.0), piece.get('fadeOut', 4.0))
            y = R.normalise(y)
            wav = os.path.join(tmp, f'{name}.wav')
            sf.write(wav, y.astype(np.float32), R.SR, subtype='FLOAT')
            base = piece['id'] + ('' if name == 'denoised' else '.raw')
            encode(wav, os.path.join(target['dir'], base))
            variants[name] = {
                'src': [f"{target['prefix']}{base}.opus", f"{target['prefix']}{base}.m4a"],
                'lufs': round(R.lufs(y), 1),
                'truePeakDb': round(R.true_peak_db(y), 2),
                'durationSec': round(len(y) / R.SR, 3),
            }
    return {
        'id': piece['id'], 'recording': rec['id'], 'file': piece['file'], 'segment': [t0, t1],
        'noiseRegion': [round(g0, 2), round(g1, 2)], 'hum': hum, 'clicksRepaired': n_clicks,
        'metrics': {'raw': m_raw, 'denoised': m_den, 'compare': cmp, 'snrGainDb': round(m_den['snr_db'] - m_raw['snr_db'], 2)},
        'autoVariant': auto, 'autoReasons': why, 'variant': default, 'variants': variants,
    }


def manifest_entry(piece: dict, res: dict, approved_on: str) -> dict:
    v = res['variants'][res['variant']]
    entry = {
        'id': piece['id'], 'role': 'moment', 'src': v['src'], 'durationSec': v['durationSec'],
        'family': piece['family'], 'tags': piece['tags'], 'lufs': v['lufs'],
        'variant': res['variant'],
        'variants': {name: {'src': x['src'], 'lufs': x['lufs']} for name, x in res['variants'].items()},
        'credit': piece['credit'], 'approvedOn': approved_on,
    }
    if 'gain' in piece:
        entry['gain'] = piece['gain']
    return entry


def write_manifest(path: str, entries: list[dict]) -> None:
    data = {'version': 1, 'sets': [], 'phrases': []}
    if os.path.exists(path):
        data = json.load(open(path, encoding='utf-8'))
        data.setdefault('phrases', [])
    ids = {e['id'] for e in entries}
    data['phrases'] = [p for p in data['phrases'] if p.get('id') not in ids] + entries
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


def main() -> None:
    only = next((a.split('=', 1)[1].split(',') for a in sys.argv[1:] if a.startswith('--id=')), None)
    dry = '--dry-run' in sys.argv
    cfg = json.load(open(RECIPES, encoding='utf-8'))
    recs = {a['id']: a for a in json.load(open(APPROVED, encoding='utf-8'))['assets'] if a.get('kind') == 'recording'}
    report = json.load(open(REPORT, encoding='utf-8')) if os.path.exists(REPORT) else {'pieces': {}}
    by_target: dict[str, list[dict]] = {}
    for piece in cfg['pieces']:
        if only and piece['id'] not in only:
            continue
        rec = recs[piece['recording']]
        if piece['target'] == 'public' and rec['risk'] != 'clean':
            raise SystemExit(f"{piece['id']}: {rec['id']} is {rec['risk']}; US-risky recordings go to target 'private' only")
        src = os.path.join(CACHE, rec['id'], piece['file'])
        if not os.path.exists(src):
            print(f"{piece['id']}: missing {os.path.relpath(src, ROOT)} (run node scripts/data/fetch-assets.mjs --kind=recording)")
            continue
        if dry:
            print(f"{piece['id']}: {rec['id']} {piece['segment']} -> {piece['target']}")
            continue
        res = process(piece, rec)
        report['pieces'][piece['id']] = res
        by_target.setdefault(piece['target'], []).append(manifest_entry(piece, res, cfg['approvedOn']))
        m = res['metrics']
        print(f"{piece['id']}: SNR {m['raw']['snr_db']} -> {m['denoised']['snr_db']} dB, clicks/s {m['raw']['clicks_per_s']} -> "
              f"{m['denoised']['clicks_per_s']}, kurtosis ratio {m['compare']['kurtosis_ratio']}, band {m['compare']['band_change_db']} dB, "
              f"HF {m['compare']['hf_change_db']} dB -> default {res['variant']}{' (' + '; '.join(res['autoReasons']) + ')' if res['autoReasons'] else ''}")
    if dry:
        return
    for target, entries in by_target.items():
        write_manifest(TARGETS[target]['manifest'], entries)
    report['generatedBy'] = 'scripts/audio/prep-moment-music.py'
    with open(REPORT, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
        f.write('\n')


if __name__ == '__main__':
    main()
