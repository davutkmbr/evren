// Review sheets of a chain burst (phase 20 perceived speed): writes the snap batch (tools/review/burst-capture.js in the
// flight sandbox, a race and free flight at low flow), runs scripts/snap.mjs on it and builds one contact sheet per case
// (tools/review/burst-sheet.mjs) under .shots/speed-feel/.
//
//   node tools/review/burst-review.mjs            # needs the dev server (port 5199); SNAP_CHROME=<chromium> on Linux
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const dir = '.shots/speed-feel';
mkdirSync(dir, { recursive: true });
const evalSrc = readFileSync('tools/review/burst-capture.js', 'utf8');
const cases = [
  { id: 'race', query: '', title: 'Chain link 3 in a race, low over the Bosphorus (flow 0.95, speed feel 1)' },
  { id: 'free', query: '&racing=0&flow=0.2', title: 'Chain link 3 in free flight at low flow (flow 0.2, speed feel 0.35, burst ×0.6)' },
];
const jobs = cases.map((c) => ({ url: `/sandbox/flight.html?t=12&hud=0${c.query}`, out: `${dir}/burst-${c.id}-last.png`, eval: evalSrc, result: `${dir}/burst-${c.id}.json`, w: 640, h: 360, settle: 200, timeout: 240000 }));
writeFileSync(`${dir}/batch.json`, JSON.stringify(jobs));
execFileSync('node', ['scripts/snap.mjs', '--batch', `${dir}/batch.json`], { stdio: 'inherit' });
for (const c of cases) {
  execFileSync('node', ['tools/review/burst-sheet.mjs', `${dir}/burst-${c.id}.json`, `${dir}/burst-${c.id}-sheet.png`, c.title], { stdio: 'inherit' });
}
