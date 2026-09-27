/**
 * Latency probe page (seventeenskies.com/probe, phase 26 stage 1): pings the probe Durable Objects of every location
 * hint over WebSocket and stores the result with the visitor's ISP (worker/probe.ts). Player-facing text is Turkish.
 */
import './probe.css';

type Region = 'auto' | 'eeur' | 'weur' | 'me';

interface NetworkInfo {
  ingressColo: string;
  asn: number;
  org: string;
  country: string;
  city: string;
  regions: Region[];
}

interface SummaryRow {
  org: string;
  asn: number;
  region: Region;
  doColo: string;
  tests: number;
  median: number;
  p90: number;
}

const REGION_LABEL: Record<Region, string> = {
  auto: 'En yakın (otomatik)',
  eeur: 'Doğu Avrupa',
  weur: 'Batı Avrupa',
  me: 'Orta Doğu',
};

/** Cloudflare data centres (IATA) likely to show up for Turkey. */
const COLO_CITY: Record<string, string> = {
  IST: 'İstanbul', ESB: 'Ankara', ADB: 'İzmir', SOF: 'Sofya', OTP: 'Bükreş', ATH: 'Atina', SKG: 'Selanik',
  BEG: 'Belgrad', BUD: 'Budapeşte', VIE: 'Viyana', PRG: 'Prag', WAW: 'Varşova', FRA: 'Frankfurt', MUC: 'Münih',
  DUS: 'Düsseldorf', HAM: 'Hamburg', TXL: 'Berlin', BER: 'Berlin', AMS: 'Amsterdam', BRU: 'Brüksel', CDG: 'Paris',
  MRS: 'Marsilya', LHR: 'Londra', MAN: 'Manchester', DUB: 'Dublin', MAD: 'Madrid', MXP: 'Milano', FCO: 'Roma',
  ZRH: 'Zürih', ARN: 'Stockholm', CPH: 'Kopenhag', HEL: 'Helsinki', OSL: 'Oslo', KBP: 'Kiev', TBS: 'Tiflis',
  EVN: 'Erivan', GYD: 'Bakü', TLV: 'Tel Aviv', AMM: 'Amman', DXB: 'Dubai', AUH: 'Abu Dabi', DOH: 'Doha',
  BAH: 'Bahreyn', KWI: 'Kuveyt', RUH: 'Riyad', JED: 'Cidde', MCT: 'Maskat', CAI: 'Kahire', LCA: 'Larnaka',
};

/** Pings per region; the first WARMUP (connection set-up, cold object) are dropped. */
const PINGS = 35;
const WARMUP = 5;
/** Gap between pings (ms): steady traffic like the game's position updates, not a burst. */
const GAP_MS = 60;

function colo(code: string): string {
  const city = COLO_CITY[code];
  return city ? `${code} · ${city}` : code;
}

function tier(ms: number): 'good' | 'ok' | 'bad' {
  return ms < 50 ? 'good' : ms < 90 ? 'ok' : 'bad';
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) {
    e.className = cls;
  }
  if (text !== undefined) {
    e.textContent = text;
  }
  return e;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One region: WebSocket to its probe object, its colo, then timed echoes. */
async function measure(region: Region, onProgress: (done: number) => void): Promise<{ doColo: string; samples: number[] }> {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/api/probe/ws?region=${region}`);
  const queue: ((data: string) => void)[] = [];
  ws.onmessage = (e) => queue.shift()?.(String(e.data));
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('socket'));
  });
  const ask = (msg: string) =>
    new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 5000);
      queue.push((data) => {
        clearTimeout(timer);
        resolve(data);
      });
      ws.send(msg);
    });
  try {
    const { colo: doColo } = JSON.parse(await ask('where')) as { colo: string };
    const samples: number[] = [];
    for (let i = 0; i < PINGS; i++) {
      const t0 = performance.now();
      await ask(`p${i}`);
      const rtt = performance.now() - t0;
      if (i >= WARMUP) {
        samples.push(rtt);
      }
      onProgress((i + 1) / PINGS);
      await sleep(GAP_MS);
    }
    return { doColo, samples };
  } finally {
    ws.close();
  }
}

function renderSummary(host: HTMLElement, rows: SummaryRow[]): void {
  host.replaceChildren();
  if (!rows.length) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  host.append(el('h2', undefined, 'Tüm sonuçlar'));
  const scroll = el('div', 'probe-scroll');
  const table = el('table', 'probe-table');
  const head = el('tr');
  for (const h of ['Operatör', 'Sunucu', 'Ortanca', 'p90', 'Test']) {
    head.append(el('th', undefined, h));
  }
  table.append(head);
  for (const r of rows) {
    const tr = el('tr');
    const ms = el('td', undefined, `${Math.round(r.median)} ms`);
    ms.style.color = `var(--${tier(r.median) === 'bad' ? 'warn' : tier(r.median) === 'good' ? 'good' : 'accent'})`;
    tr.append(
      el('td', undefined, r.org),
      el('td', undefined, `${REGION_LABEL[r.region] ?? r.region} · ${r.doColo}`),
      ms,
      el('td', undefined, `${Math.round(r.p90)} ms`),
      el('td', undefined, String(r.tests)),
    );
    table.append(tr);
  }
  scroll.append(table);
  host.append(scroll);
}

async function loadSummary(host: HTMLElement): Promise<void> {
  try {
    const res = await fetch('/api/probe/results');
    if (res.ok) {
      renderSummary(host, ((await res.json()) as { summary: SummaryRow[] }).summary);
    }
  } catch {
    // The summary is optional; the test works without it.
  }
}

async function main(): Promise<void> {
  const root = document.getElementById('probe')!;
  root.append(
    el('p', 'probe-brand', 'Seventeen Skies'),
    el('h1', undefined, 'Bağlantı testi'),
    el(
      'p',
      'probe-lead',
      'Çok oyunculu sunucular için en uygun bölgeyi seçmek üzere bağlantının gecikmesini ölçüyoruz. Test yaklaşık 20 saniye sürer.',
    ),
  );
  const netCard = el('section', 'probe-card');
  const net = el('div', 'probe-net', 'Bağlantın okunuyor…');
  const actions = el('div', 'probe-actions');
  const button = el('button', 'probe-button', 'Testi başlat');
  button.type = 'button';
  button.disabled = true;
  const status = el('span', 'probe-status');
  status.setAttribute('role', 'status');
  actions.append(button, status);
  netCard.append(net, actions);

  const rowsCard = el('section', 'probe-card');
  const rowsHost = el('div', 'probe-rows');
  rowsCard.append(rowsHost);
  rowsCard.hidden = true;
  const summary = el('section', 'probe-card probe-summary');
  summary.hidden = true;
  const note = el('p', 'probe-note', 'Kaydedilenler: operatörün, şehrin ve ölçülen süreler. IP adresin saklanmaz.');
  root.append(netCard, rowsCard, summary, note);

  let info: NetworkInfo;
  try {
    const res = await fetch('/api/probe/info');
    if (!res.ok) {
      throw new Error(String(res.status));
    }
    info = (await res.json()) as NetworkInfo;
  } catch {
    net.textContent = 'Test sunucusuna ulaşılamadı. Biraz sonra tekrar dene.';
    return;
  }
  net.replaceChildren();
  const fact = (label: string, value: string) => {
    const s = el('span', undefined, `${label} `);
    s.append(el('b', undefined, value));
    net.append(s);
  };
  fact('Operatör', info.org);
  fact('Şehir', info.city || info.country);
  fact('Giriş noktası', colo(info.ingressColo));
  button.disabled = false;
  void loadSummary(summary);

  button.addEventListener('click', async () => {
    button.disabled = true;
    rowsCard.hidden = false;
    rowsHost.replaceChildren();
    const rows = new Map<Region, { where: HTMLElement; ms: HTMLElement; bar: HTMLElement }>();
    for (const region of info.regions) {
      const row = el('div', 'probe-row');
      const name = el('div', 'probe-region', REGION_LABEL[region] ?? region);
      const where = el('span', 'probe-where', '…');
      name.append(where);
      const ms = el('div', 'probe-ms', '–');
      const bar = el('div', 'probe-bar');
      bar.append(el('i'));
      row.append(name, ms, bar);
      rowsHost.append(row);
      rows.set(region, { where, ms, bar: bar.firstElementChild as HTMLElement });
    }
    let failed = 0;
    for (const region of info.regions) {
      const ui = rows.get(region)!;
      status.textContent = `${REGION_LABEL[region]} ölçülüyor…`;
      try {
        const { doColo, samples } = await measure(region, (p) => (ui.bar.style.width = `${Math.round(p * 100)}%`));
        const sorted = [...samples].sort((a, b) => a - b);
        const med = quantile(sorted, 0.5);
        ui.where.textContent = colo(doColo);
        ui.ms.dataset.tier = tier(med);
        ui.ms.textContent = `${Math.round(med)} ms`;
        ui.ms.append(el('small', undefined, `p90 ${Math.round(quantile(sorted, 0.9))} ms`));
        await fetch('/api/probe/results', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ region, doColo, samples: samples.map((s) => Math.round(s * 10) / 10) }),
        });
      } catch {
        failed++;
        ui.where.textContent = 'bağlanamadı';
        ui.ms.textContent = '–';
      }
    }
    status.textContent = failed ? 'Bazı bölgelere bağlanılamadı.' : 'Teşekkürler, sonuç kaydedildi.';
    button.textContent = 'Tekrar ölç';
    button.disabled = false;
    void loadSummary(summary);
  });
}

void main();
