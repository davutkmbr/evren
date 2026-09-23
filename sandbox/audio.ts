/**
 * Audio sandbox.
 *   /sandbox/audio.html                 offline validation report (every sound rendered through the real engine + metrics)
 *   /sandbox/audio.html?cases=roar-pov  only the listed case ids
 *   /sandbox/audio.html?mode=live       interactive lab: sliders drive a fake dragon; click once to unlock audio
 */
import type { System } from '../src/core/contracts';
import { UpdateOrder } from '../src/core/contracts';
import { startSandbox } from '../src/core/sandbox';
import { createAudioSystem } from '../src/audio';
import { createLiveHarness, type LiveState } from '../src/audio/analysis/live-panel';
import { createReportView, wavBase64 } from '../src/audio/analysis/report-view';
import { CASES, renderCase, type RenderResult } from '../src/audio/analysis/scenarios';

interface AudioReportApi {
  done: boolean;
  results(): Array<Omit<RenderResult, 'buffer'>>;
  wav(id: string): string | null;
}

const params = new URLSearchParams(window.location.search);

function reportSystem(): System {
  const only = params.get('cases')?.split(',').filter(Boolean);
  const cases = only ? CASES.filter((c) => only.includes(c.id)) : CASES;
  let remaining = cases.length;
  const results: RenderResult[] = [];
  const api: AudioReportApi = {
    done: false,
    results: () => results.map(({ buffer: _b, ...rest }) => rest),
    wav: (id) => {
      const r = results.find((x) => x.id === id);
      return r ? wavBase64(r) : null;
    },
  };
  (window as unknown as { __audioReport: AudioReportApi }).__audioReport = api;
  return {
    name: 'audio-report',
    order: UpdateOrder.UI,
    init(ctx) {
      const view = createReportView(ctx.uiRoot, cases.length);
      void (async () => {
        for (const c of cases) {
          view.setStatus(`çiziliyor: ${c.id} (${cases.length - remaining + 1}/${cases.length})`);
          try {
            const r = await renderCase(c);
            results.push(r);
            view.add(r);
          } catch (err) {
            console.error(`[audio-report] ${c.id} failed`, err);
          }
          remaining--;
        }
        view.setStatus('tamamlandı');
        api.done = true;
      })();
    },
    pending: () => remaining,
  };
}

if (params.get('mode') === 'live') {
  const state: LiveState = { airspeed: 40, aoaDeg: 4, turn: 0, altitude: 120, urban: 0.6, coast: 0.3, firing: false, diving: false, pov: false };
  void startSandbox({
    systems: [createLiveHarness(state), createAudioSystem()],
  });
} else {
  void startSandbox({ systems: [reportSystem()] });
}
