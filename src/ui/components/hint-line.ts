import '../styles/components.css';
import { el } from '../dom';

/**
 * A quiet one-line hint of pointer controls: "Sürükle: kaydır · Tekerlek: yakınlaştır · Tıkla: ışınlan". Each item
 * is [gesture, verb]; the gesture reads slightly brighter. For keys use keyCap / prompt instead.
 */
export function hintLine(items: ReadonlyArray<readonly [string, string]>): HTMLElement {
  const nodes: Array<Node | string> = [];
  items.forEach(([gesture, verb], i) => {
    if (i > 0) {
      nodes.push(el('span', 'ui-hint-sep', '·'));
    }
    nodes.push(el('span', 'ui-hint-item', [el('b', undefined, `${gesture}:`), ` ${verb}`]));
  });
  return el('p', 'ui-hint', nodes);
}
