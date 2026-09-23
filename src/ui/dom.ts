/** Tiny DOM helpers. Everything the UI builds is created once; hot paths only mutate cached nodes. */

type Attrs = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  children?: Array<Node | string | null | undefined> | string,
  attrs?: Attrs,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === false) {
        continue;
      }
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (typeof children === 'string') {
    node.textContent = children;
  } else if (children) {
    for (const child of children) {
      if (child === null || child === undefined) {
        continue;
      }
      node.append(child);
    }
  }
  return node;
}

/** Parses a trusted, code-generated SVG string into an element. */
export function svg(markup: string, className?: string): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  const node = template.content.firstElementChild as SVGSVGElement;
  if (className) {
    node.setAttribute('class', className);
  }
  return node;
}

/** Writes textContent only when it changed (avoids needless style/layout invalidation). */
export class TextSlot {
  private last = '';
  constructor(readonly node: HTMLElement | SVGElement) {}
  set(value: string): void {
    if (value !== this.last) {
      this.last = value;
      this.node.textContent = value;
    }
  }
}

/** Writes a CSS transform only when it changed. */
export class TransformSlot {
  private last = '';
  constructor(readonly node: HTMLElement | SVGElement) {}
  set(value: string): void {
    if (value !== this.last) {
      this.last = value;
      (this.node as HTMLElement).style.transform = value;
    }
  }
}

export function setVisible(node: HTMLElement, visible: boolean): void {
  if (visible) {
    node.removeAttribute('hidden');
  } else {
    node.setAttribute('hidden', '');
  }
}

export function toggleClass(node: Element, name: string, on: boolean): void {
  if (node.classList.contains(name) !== on) {
    node.classList.toggle(name, on);
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
