import { spectrogram } from './metrics';
import type { RenderResult } from './scenarios';
import { arrayBufferToBase64, encodeWav } from './wav';

const STYLE = `
.ar-root { position:absolute; inset:0; overflow:auto; pointer-events:auto; background:#0b0d10; color:#d9dde3;
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif; padding:28px 32px 48px; }
.ar-head { display:flex; align-items:baseline; gap:16px; margin-bottom:6px; }
.ar-head h1 { font-size:20px; font-weight:600; margin:0; letter-spacing:-0.01em; color:#f1f3f5; }
.ar-sub { color:#8b939e; margin:0 0 20px; max-width:980px; }
.ar-summary { display:flex; gap:10px; margin:0 0 22px; flex-wrap:wrap; }
.ar-chip { border:1px solid #232830; border-radius:8px; padding:6px 10px; color:#aeb5bf; background:#11151a; }
.ar-chip b { color:#f1f3f5; font-weight:600; font-variant-numeric: tabular-nums; }
.ar-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(460px, 1fr)); gap:14px; }
.ar-card { background:#11151a; border:1px solid #1d2229; border-radius:10px; padding:12px 14px 12px; }
.ar-card-head { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
.ar-title { font-weight:600; color:#eef1f4; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ar-id { color:#6f7782; font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
.ar-pill { font-size:11px; font-weight:600; padding:2px 8px; border-radius:999px; }
.ar-pass { background:#12301f; color:#6fd39a; }
.ar-fail { background:#3a1717; color:#ff8a80; }
.ar-metrics { display:grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap:6px 10px; margin:8px 0 0; }
.ar-m b.ar-bad { color:#ff8a80; }
.ar-m { display:flex; flex-direction:column; }
.ar-m span { color:#6f7782; font-size:10.5px; text-transform:uppercase; letter-spacing:0.04em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ar-m b { color:#e3e7ec; font-weight:500; font-variant-numeric: tabular-nums; font-size:12.5px; white-space:nowrap; }
.ar-bands { display:flex; height:6px; border-radius:3px; overflow:hidden; margin-top:8px; background:#1a1f26; }
.ar-bands i { display:block; height:100%; }
.ar-problems { color:#ff8a80; font-size:12px; margin-top:6px; }
.ar-canvas { display:block; width:100%; border-radius:6px; background:#07090b; }
.ar-actions { display:flex; gap:8px; }
.ar-btn { pointer-events:auto; cursor:pointer; border:1px solid #2a3039; background:#171c22; color:#cfd5dc; border-radius:6px;
  padding:3px 9px; font-size:11.5px; text-decoration:none; }
.ar-btn:hover { background:#1f252d; border-color:#3a424d; }
`;

function inferno(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  const c = [
    [0.00021894, 0.001651, -0.0194809],
    [0.1065134, 0.5639564, 3.9327124],
    [11.6024931, -3.972854, -15.9423941],
    [-41.7039961, 17.4363989, 44.3541452],
    [77.1629357, -33.4023589, -81.8073093],
    [-71.3194282, 32.6260643, 73.2095199],
    [25.1311262, -12.242669, -23.070325],
  ];
  const out: [number, number, number] = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    let v = 0;
    for (let k = 6; k >= 0; k--) {
      v = v * x + c[k][ch];
    }
    out[ch] = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  return out;
}

const LUT = Array.from({ length: 256 }, (_, i) => inferno(i / 255));

function drawWaveform(canvas: HTMLCanvasElement, buffer: AudioBuffer): void {
  const w = canvas.width;
  const h = canvas.height;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#07090b';
  g.fillRect(0, 0, w, h);
  const chans = [buffer.getChannelData(0), buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1))];
  const colors = ['rgba(255,166,77,0.85)', 'rgba(120,190,255,0.7)'];
  const half = h / 2;
  g.strokeStyle = '#1b2027';
  g.beginPath();
  for (const db of [-6, -12, -24]) {
    const a = Math.pow(10, db / 20) * (half - 2);
    g.moveTo(0, half - a);
    g.lineTo(w, half - a);
    g.moveTo(0, half + a);
    g.lineTo(w, half + a);
  }
  g.stroke();
  chans.forEach((data, ci) => {
    g.fillStyle = colors[ci];
    const per = data.length / w;
    for (let x = 0; x < w; x++) {
      let mn = 1;
      let mx = -1;
      const s = Math.floor(x * per);
      const e = Math.min(data.length, Math.floor((x + 1) * per));
      for (let i = s; i < e; i++) {
        const v = data[i];
        if (v < mn) {
          mn = v;
        }
        if (v > mx) {
          mx = v;
        }
      }
      if (ci === 0) {
        g.fillRect(x, half - mx * (half - 2), 1, Math.max(1, (mx - Math.max(0, mn)) * (half - 2)));
      } else {
        g.fillRect(x, half - Math.min(0, mx) * (half - 2), 1, Math.max(1, (Math.min(0, mx) - mn) * (half - 2)));
      }
    }
  });
  g.fillStyle = '#ff5b4f';
  g.fillRect(0, 1, w, 1);
  g.fillRect(0, h - 2, w, 1);
}

function drawSpectrogram(canvas: HTMLCanvasElement, buffer: AudioBuffer): void {
  const w = canvas.width;
  const h = canvas.height;
  const g = canvas.getContext('2d')!;
  const n = buffer.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) {
      mono[i] += d[i] / buffer.numberOfChannels;
    }
  }
  const hop = Math.max(128, Math.floor(n / w / 128) * 128 || 256);
  const spec = spectrogram(mono, buffer.sampleRate, hop);
  const img = g.createImageData(w, h);
  const fMin = 25;
  const fMax = 18000;
  const binHz = buffer.sampleRate / (spec.bins * 2);
  const frames = spec.frames.length || 1;
  for (let y = 0; y < h; y++) {
    const f = fMin * Math.pow(fMax / fMin, 1 - y / (h - 1));
    const bin = Math.min(spec.bins - 1, Math.max(1, Math.round(f / binHz)));
    for (let x = 0; x < w; x++) {
      const fi = Math.min(frames - 1, Math.floor((x / w) * frames));
      const db = spec.frames[fi] ? spec.frames[fi][bin] : -120;
      const t = Math.pow(Math.min(1, Math.max(0, (db + 118) / 92)), 1.25);
      const [r, gg, b] = LUT[Math.max(0, Math.min(255, Math.round(t * 255)))];
      const o = (y * w + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.font = '10px ui-monospace, Menlo, monospace';
  for (const f of [50, 100, 250, 500, 1000, 2500, 5000, 10000]) {
    const y = (1 - Math.log(f / fMin) / Math.log(fMax / fMin)) * (h - 1);
    g.fillRect(0, y, 4, 1);
    g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, 6, y + 3);
  }
}

const fmt = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d) : '-');

export interface ReportView {
  root: HTMLElement;
  add(result: RenderResult): void;
  setStatus(text: string): void;
}

export function createReportView(parent: HTMLElement, total: number): ReportView {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'ar-root';
  root.innerHTML = `
    <div class="ar-head"><h1>Seventeen Skies — ses doğrulama</h1><span class="ar-id" id="ar-status"></span></div>
    <p class="ar-sub">Her ses, oyundaki motorun aynısıyla (tam master zinciri: subsonik filtre, reverb, glue kompresör, limiter, soft-clip;
    ses seviyesi 1.0) OfflineAudioContext'te 48 kHz stereo olarak çizildi; kompresörlerin açılış geçişi için 1.6 s ön-çalma kırpıldı.
    Ölçümler: çıkış tepesi ve dinamik aşamasına giren sinyalin tepesi (limiter'ın dengeyi "sağlamadığını" gösterir), glue/limiter kazanç
    azaltması, ITU-R BS.1770 yüksekliği (tek seferlikler için anlık maks., döngüler için entegre LUFS), 30 Hz altı enerji payı, spektral
    ağırlık merkezi, bant dağılımı (&lt;150 Hz / 150 Hz–2 kHz / &gt;2 kHz), stereo korelasyonu ve maskelenen sesler için rüzgâr üstüne
    yükselme (LU); sürekli yataklarda gürültü döngüsü tekrarı (farkı alınmış sinyalin öz-korelasyonu). Dalga formunda kırmızı çizgiler 0 dBFS, yatay kılavuzlar −6/−12/−24 dB.</p>
    <div class="ar-summary" id="ar-summary"></div>
    <div class="ar-grid" id="ar-grid"></div>`;
  parent.appendChild(root);
  const grid = root.querySelector<HTMLElement>('#ar-grid')!;
  const status = root.querySelector<HTMLElement>('#ar-status')!;
  const summary = root.querySelector<HTMLElement>('#ar-summary')!;
  let player: AudioContext | null = null;
  let playing: AudioBufferSourceNode | null = null;
  const results: RenderResult[] = [];

  const updateSummary = (): void => {
    const passed = results.filter((r) => r.pass).length;
    const maxPeak = Math.max(...results.map((r) => r.metrics.peakDb));
    const maxPre = Math.max(...results.map((r) => r.prePeakDb));
    const maxLimiter = Math.min(...results.map((r) => r.limiterGrDb));
    const clipped = results.reduce((a, r) => a + r.metrics.clipped, 0);
    summary.innerHTML = `
      <div class="ar-chip">Geçen <b>${passed}/${results.length}</b> (toplam ${total})</div>
      <div class="ar-chip">En yüksek çıkış tepesi <b>${fmt(maxPeak)} dBFS</b></div>
      <div class="ar-chip">En yüksek dinamik öncesi tepe <b>${fmt(maxPre)} dBFS</b></div>
      <div class="ar-chip">En büyük limiter azaltması <b>${fmt(maxLimiter)} dB</b></div>
      <div class="ar-chip">Kırpılan örnek <b>${clipped}</b></div>
      <div class="ar-chip">Çizim süresi <b>${fmt(results.reduce((a, r) => a + r.renderMs, 0) / 1000, 2)} s</b></div>`;
  };

  return {
    root,
    setStatus(text: string): void {
      status.textContent = text;
    },
    add(r: RenderResult): void {
      results.push(r);
      const m = r.metrics;
      const card = document.createElement('div');
      card.className = 'ar-card';
      const wav = encodeWav(r.buffer);
      const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      card.innerHTML = `
        <div class="ar-card-head">
          <div class="ar-title">${r.label}</div>
          <span class="ar-id">${r.id}</span>
          <span class="ar-pill ${r.pass ? 'ar-pass' : 'ar-fail'}">${r.pass ? 'OK' : 'KONTROL'}</span>
          <div class="ar-actions"><button class="ar-btn" data-play>Çal</button><a class="ar-btn" download="${r.id}.wav" href="${url}">WAV</a></div>
        </div>
        <canvas class="ar-canvas" width="900" height="64"></canvas>
        <canvas class="ar-canvas" width="900" height="120" style="margin-top:6px"></canvas>
        <div class="ar-metrics">
          <div class="ar-m"><span>${r.measure === 'integrated' ? 'Entegre' : 'Anlık maks'}</span><b>${fmt(r.measured)} LUFS</b></div>
          <div class="ar-m"><span>Hedef</span><b>${r.target[0]}…${r.target[1]}</b></div>
          <div class="ar-m"><span>Tepe</span><b>${fmt(m.peakDb)} dBFS</b></div>
          <div class="ar-m" title="Dinamik aşamasına (glue kompresör) giren sinyalin örnek tepesi"><span>Ön tepe</span><b${r.prePeakDb > -3 ? ' class="ar-bad"' : ''}>${fmt(r.prePeakDb)} dBFS</b></div>
          <div class="ar-m" title="En büyük kazanç azaltması: glue kompresör / limiter"><span>Glue/lim</span><b${r.limiterGrDb < -3 || r.glueGrDb < -6 ? ' class="ar-bad"' : ''}>${fmt(r.glueGrDb)}/${fmt(r.limiterGrDb)}</b></div>
          <div class="ar-m"><span>&lt;30 Hz</span><b${m.sub30 > 0.1 ? ' class="ar-bad"' : ''}>${fmt(m.sub30 * 100)} %</b></div>
          <div class="ar-m"><span>RMS</span><b>${fmt(m.rmsDb)} dB</b></div>
          <div class="ar-m"><span>Merkez</span><b>${fmt(m.centroidHz, 0)} Hz</b></div>
          <div class="ar-m" title="Stereo korelasyonu (1 = mono)"><span>Stereo</span><b>${fmt(m.stereoCorrelation, 2)}</b></div>
          <div class="ar-m" title="Gürültü döngüsü tekrarı: kendisinin gecikmeli kopyasıyla en yüksek korelasyon (0 = hiç tekrar yok) ve gecikme"><span>Tekrar</span><b${r.repeat && r.repeat.corr > 0.2 ? ' class="ar-bad"' : ''}>${r.repeat ? `${fmt(r.repeat.corr, 2)}@${fmt(r.repeat.lagS, r.repeat.lagS >= 10 ? 0 : 1)}s` : '–'}</b></div>
          <div class="ar-m" title="Maskeleyen rüzgâr yatağının üstüne yükselme"><span>Yükselme</span><b>${r.rise === null ? '–' : `+${fmt(r.rise)} LU`}</b></div>
          <div class="ar-m"><span>Çizim</span><b>${fmt(r.renderMs, 0)} ms</b></div>
        </div>
        <div class="ar-bands" title="<150 Hz / 150 Hz-2 kHz / >2 kHz">
          <i style="width:${(m.bands[0] * 100).toFixed(1)}%;background:#c2562d"></i>
          <i style="width:${(m.bands[1] * 100).toFixed(1)}%;background:#e3a33b"></i>
          <i style="width:${(m.bands[2] * 100).toFixed(1)}%;background:#7fb8e8"></i>
        </div>
        ${r.problems.length ? `<div class="ar-problems">${r.problems.join(' · ')}</div>` : ''}`;
      grid.appendChild(card);
      const [wave, spec] = card.querySelectorAll('canvas');
      drawWaveform(wave, r.buffer);
      drawSpectrogram(spec, r.buffer);
      card.querySelector<HTMLButtonElement>('[data-play]')!.addEventListener('click', () => {
        player ??= new AudioContext();
        playing?.stop();
        const src = player.createBufferSource();
        src.buffer = r.buffer;
        src.connect(player.destination);
        src.start();
        playing = src;
      });
      updateSummary();
    },
  };
}

/** Serializable report for the dump script. */
export function wavBase64(result: RenderResult): string {
  return arrayBufferToBase64(encodeWav(result.buffer));
}
