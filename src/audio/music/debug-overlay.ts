/**
 * `?music=debug` overlay (developer tool, English): current set, bar / beat, each stem's level (target → smoothed),
 * the active state rule and modifiers, the director's phase and next event; in sparse style the sprinkle state (next
 * phrase in N s, the last phrase, the hold or busy reason, the context tags); the moment piece. Updated a few times a
 * second.
 */
import { STEM_ROLES } from './manifest';
import type { MusicSnapshot } from './index';

export class MusicDebugOverlay {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.setAttribute('data-music-debug', '');
    Object.assign(this.root.style, {
      position: 'fixed',
      left: '12px',
      bottom: '12px',
      zIndex: '9999',
      font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
      color: '#e8eef5',
      background: 'rgba(10, 16, 24, 0.82)',
      padding: '8px 10px',
      borderRadius: '6px',
      pointerEvents: 'none',
      whiteSpace: 'pre',
      minWidth: '260px',
    } satisfies Partial<CSSStyleDeclaration>);
    this.body = document.createElement('div');
    this.root.append(this.body);
    parent.append(this.root);
  }

  update(dt: number, s: MusicSnapshot): void {
    this.timer -= dt;
    if (this.timer > 0) {
      return;
    }
    this.timer = 0.2;
    const bar = (v: number): string => '█'.repeat(Math.round(v * 10)).padEnd(10, '·');
    const lines: string[] = [];
    lines.push(`MUSIC  ${s.adaptive ? 'adaptive' : 'full mix'}  vol ${s.volume.toFixed(2)}  duck ${s.duck.toFixed(2)}${s.paused ? '  PAUSED' : ''}`);
    lines.push(`set    ${s.set ?? '—'}${s.setTitle ? `  “${s.setTitle}”` : ''}`);
    lines.push(`pos    ${s.set ? `bar ${s.bar + 1}/${s.bars}  beat ${s.beat + 1}/${s.beatsPerBar}  ${s.bpm} bpm` : '—'}`);
    lines.push(`phase  ${s.phase}  ${s.next}`);
    lines.push(`rule   ${s.state} [${s.policy}]${s.modifiers.length ? ` + ${s.modifiers.join(', ')}` : ''}`);
    for (const r of STEM_ROLES) {
      const has = s.stemsPresent.includes(r);
      lines.push(`${r.padEnd(7)}${bar(s.mix[r])} ${s.mix[r].toFixed(2)} → ${s.target[r].toFixed(2)}${has || !s.set ? '' : '  (not in set)'}`);
    }
    lines.push(`cond   ${s.conditions.join(' ') || '—'}`);
    lines.push(`sets   ${s.sets.join(', ') || 'none (manifest empty — try ?music=test)'}`);
    lines.push(`note   ${s.note}`);
    const sp = s.sprinkle;
    lines.push(`style  ${s.style} (${s.styleSource})`);
    if (s.style === 'sparse') {
      const next = sp.phase === 'playing' ? `playing ${sp.current}` : sp.nextIn !== null ? `next in ${sp.nextIn.toFixed(0)} s${sp.next ? ` (${sp.next})` : ''}` : '—';
      lines.push(`sprnk  ${next}  last ${sp.last ?? '—'}  played ${sp.played}`);
      lines.push(`hold   ${sp.hold ?? (sp.busy ? `busy: ${sp.busy}` : '—')}  ${sp.note}`);
      lines.push(`ctx    ${sp.tags.join(' ') || '—'}`);
      lines.push(`phrs   ${sp.phrases.join(', ') || 'none (manifest has no phrases — try ?music=test)'}`);
    }
    const m = s.moment;
    lines.push(`moment ${m.current ? `playing ${m.current}` : m.pending ? `loading ${m.pending}` : '—'}  last ${m.last ?? '—'}  ${m.note}`);
    this.body.textContent = lines.join('\n');
  }

  dispose(): void {
    this.root.remove();
  }
}
