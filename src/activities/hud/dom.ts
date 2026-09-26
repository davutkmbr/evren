/** Small DOM helpers for the race overlays: nodes are built once, hot paths only write when a value changed. */

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  children?: Array<Node | string | null | undefined> | string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (typeof children === 'string') {
    node.textContent = children;
  } else if (children) {
    for (const c of children) {
      if (c !== null && c !== undefined) {
        node.append(c);
      }
    }
  }
  return node;
}

/** Writes textContent only when it changed. */
export class Text {
  private last: string | null = null;
  constructor(readonly node: HTMLElement) {}
  set(value: string): void {
    if (value !== this.last) {
      this.last = value;
      this.node.textContent = value;
    }
  }
}

/** Writes style.transform only when it changed. */
export class Transform {
  private last = '';
  constructor(readonly node: HTMLElement) {}
  set(value: string): void {
    if (value !== this.last) {
      this.last = value;
      this.node.style.transform = value;
    }
  }
}

/** Toggles a class only when the state changes. */
export function toggle(node: Element, name: string, on: boolean): void {
  if (node.classList.contains(name) !== on) {
    node.classList.toggle(name, on);
  }
}

/** Sets the hidden attribute only when the state changes. */
export function show(node: HTMLElement, visible: boolean): void {
  if (node.hidden === visible) {
    node.hidden = !visible;
  }
}
