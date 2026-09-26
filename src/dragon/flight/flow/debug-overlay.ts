/**
 * Flow tuning overlay (`?flowdebug=1`): the flow value, the payback and the harmony terms of the last transition,
 * live, in a small monospace block in the top-left corner. Diagnostics only (English, not player-facing).
 */
import type { FlowSystem } from './flow';

const REFRESH_MS = 200;

/** Mounts the overlay; returns its remover. No-op without a DOM. */
export function mountFlowDebug(flow: FlowSystem): () => void {
  if (typeof document === 'undefined') {
    return () => undefined;
  }
  const pre = document.createElement('pre');
  pre.setAttribute('aria-hidden', 'true');
  Object.assign(pre.style, {
    position: 'fixed',
    left: '12px',
    top: '72px',
    margin: '0',
    padding: '8px 10px',
    font: '11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#e8ecf2',
    background: 'rgba(8, 10, 14, 0.62)',
    borderRadius: '6px',
    pointerEvents: 'none',
    zIndex: '60',
    whiteSpace: 'pre',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.append(pre);
  const timer = window.setInterval(() => {
    pre.textContent = flow.debugLines().join('\n');
  }, REFRESH_MS);
  return () => {
    window.clearInterval(timer);
    pre.remove();
  };
}
