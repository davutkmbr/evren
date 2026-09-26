import '../styles/components.css';
import { keyCap, type KeyCapTone } from './keycap';

/**
 * A sentence that names keys: every "[X]" becomes a small key cap ("Konmak için [L]" → "Konmak için", cap L). Used by
 * toasts and hint lines so copy can mention keys without building nodes by hand.
 */
export function keyText(text: string, tone: KeyCapTone = 'ink'): Array<Node | string> {
  const nodes: Array<Node | string> = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    nodes.push(keyCap(m[1], tone, { size: 's' }));
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}
