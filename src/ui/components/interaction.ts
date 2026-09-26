/**
 * Shared interaction states for every interactive component (styles: "Interaction states" in components.css).
 *
 * A component marks its root with `interactive(node, family)`:
 * - `cap`     a key + verb (prompt, option switch): hover lifts the key cap, pressing sinks it;
 * - `surface` a row or square button (list row, layer row, zoom button, menu categories, teleport rows): hover lifts
 *             the surface, pressing darkens it, the focus ring is drawn inside;
 * - `segment` one option inside a track (segmented control, menu tabs, filter chips);
 * - `control` a form control that draws its own states (toggle, slider, text field) and only shares the tokens.
 *
 * Pressed is `:active` or the `is-pressed` class. The class is set here for pointer presses (so buttons that refuse
 * focus on mousedown still show it) and, through `bindKeyPress`, when the key a visible component names is pressed on
 * the keyboard, so pressing Enter visibly presses the "[Enter] Yarışa başla" prompt.
 */

export type InteractionFamily = 'cap' | 'surface' | 'segment' | 'control';

/** The shortest time the pressed state stays visible (a quick tap still reads as a press). */
const PRESS_MIN_MS = 90;

const KEY_ATTR = 'data-ui-key';

/** Key cap labels that differ from the token a KeyboardEvent produces. */
const LABEL_TOKENS: Record<string, string> = {
  esc: 'escape',
  del: 'delete',
  return: 'enter',
  '↵': 'enter',
  '⏎': 'enter',
  space: 'space',
  boşluk: 'space',
  '␣': 'space',
  ctrl: 'control',
  '⌫': 'backspace',
  '↑': 'arrowup',
  '↓': 'arrowdown',
  '←': 'arrowleft',
  '→': 'arrowright',
};

/** The token a key cap label stands for ("Esc" → "escape", "M" → "m"); combos are not matched. */
export function keyToken(label: string): string {
  const l = label.trim().toLowerCase();
  return LABEL_TOKENS[l] ?? l;
}

/** Tokens a key event can match: its physical key (layout independent) and the character it types. */
function eventTokens(e: KeyboardEvent): string[] {
  const code = e.code;
  let fromCode = code.toLowerCase();
  const letter = /^Key([A-Z])$/.exec(code);
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (letter) {
    fromCode = letter[1].toLowerCase();
  } else if (digit) {
    fromCode = digit[1];
  } else if (code === 'NumpadEnter') {
    fromCode = 'enter';
  } else if (code === 'ControlLeft' || code === 'ControlRight') {
    fromCode = 'control';
  }
  const fromKey = e.key.length === 1 ? e.key.toLowerCase() : keyToken(e.key);
  return fromKey && fromKey !== fromCode ? [fromCode, fromKey] : [fromCode];
}

type VisibilityCheck = { checkVisibility?: (o?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean };

function isShown(node: HTMLElement): boolean {
  if (!node.isConnected) {
    return false;
  }
  const check = (node as HTMLElement & VisibilityCheck).checkVisibility;
  return check ? check.call(node, { checkOpacity: true, checkVisibilityCSS: true }) : node.offsetParent !== null;
}

function isDisabled(node: HTMLElement): boolean {
  return (node as HTMLButtonElement).disabled === true || node.getAttribute('aria-disabled') === 'true' || !!node.closest('.is-disabled');
}

function isEditable(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

const pressedAt = new WeakMap<HTMLElement, number>();
const releaseTimers = new WeakMap<HTMLElement, number>();

/** Shows the pressed state now (until `release`, or for a short flash when `holdMs` is given). */
function press(node: HTMLElement, holdMs?: number): void {
  const timer = releaseTimers.get(node);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    releaseTimers.delete(node);
  }
  pressedAt.set(node, performance.now());
  node.classList.add('is-pressed');
  if (holdMs !== undefined) {
    release(node, holdMs);
  }
}

/** Ends the pressed state, keeping it visible at least `minMs` after it began. */
function release(node: HTMLElement, minMs = PRESS_MIN_MS): void {
  const since = performance.now() - (pressedAt.get(node) ?? 0);
  const wait = Math.max(0, minMs - since);
  const done = (): void => {
    releaseTimers.delete(node);
    node.classList.remove('is-pressed');
  };
  if (wait === 0) {
    done();
    return;
  }
  const previous = releaseTimers.get(node);
  if (previous !== undefined) {
    window.clearTimeout(previous);
  }
  releaseTimers.set(node, window.setTimeout(done, wait));
}

/** Flashes a component's pressed state once (e.g. when a screen triggers its action by another route). */
export function flashPressed(node: HTMLElement, ms = PRESS_MIN_MS): void {
  press(node, ms);
}

let installed = false;
let pointerPressed: HTMLElement | null = null;
/** Nodes pressed by a held key, by KeyboardEvent.code, released on keyup. */
const keyPressed = new Map<string, HTMLElement[]>();

function releaseAll(): void {
  if (pointerPressed) {
    release(pointerPressed);
    pointerPressed = null;
  }
  for (const nodes of keyPressed.values()) {
    nodes.forEach((n) => release(n));
  }
  keyPressed.clear();
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || keyPressed.has(e.code)) {
    return;
  }
  const tokens = eventTokens(e);
  // Typing into a field must not press prompts named by letters; Enter and Esc still answer the field's prompts.
  if (isEditable(e.target) && !tokens.some((t) => t === 'enter' || t === 'escape')) {
    return;
  }
  const hits: HTMLElement[] = [];
  for (const token of tokens) {
    document.querySelectorAll<HTMLElement>(`[${KEY_ATTR}="${CSS.escape(token)}"]`).forEach((node) => {
      if (!hits.includes(node) && !isDisabled(node) && isShown(node)) {
        hits.push(node);
      }
    });
  }
  if (hits.length > 0) {
    hits.forEach((n) => press(n));
    keyPressed.set(e.code, hits);
  }
}

function onKeyUp(e: KeyboardEvent): void {
  const nodes = keyPressed.get(e.code);
  if (nodes) {
    keyPressed.delete(e.code);
    nodes.forEach((n) => release(n));
  }
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) {
    return;
  }
  const node = (e.target as Element | null)?.closest?.<HTMLElement>('.ui-int');
  if (node && !isDisabled(node)) {
    pointerPressed = node;
    press(node);
  }
}

function onPointerUp(): void {
  if (pointerPressed) {
    release(pointerPressed);
    pointerPressed = null;
  }
}

/** Installs the few document-wide listeners the states need (once, on the first interactive component). */
function install(): void {
  if (installed || typeof window === 'undefined') {
    return;
  }
  installed = true;
  const capture = { capture: true, passive: true } as const;
  window.addEventListener('keydown', onKeyDown, capture);
  window.addEventListener('keyup', onKeyUp, capture);
  window.addEventListener('pointerdown', onPointerDown, capture);
  window.addEventListener('pointerup', onPointerUp, capture);
  window.addEventListener('pointercancel', onPointerUp, capture);
  window.addEventListener('blur', releaseAll);
}

/** Marks a node as an interactive component of a state family (classes `ui-int ui-int-<family>`). */
export function interactive<T extends HTMLElement>(node: T, family: InteractionFamily): T {
  node.classList.add('ui-int', `ui-int-${family}`);
  install();
  return node;
}

/**
 * Presses `node` visibly while the keyboard key named by `key` (a key cap label: "Enter", "Esc", "M") is held, as
 * long as the node is shown and enabled. Prompts and option switches bind their own key; call it for any other
 * element that names a key. An empty key unbinds.
 */
export function bindKeyPress(node: HTMLElement, key: string): void {
  if (!key || key.includes('+') || key.includes('/')) {
    node.removeAttribute(KEY_ATTR);
    return;
  }
  node.setAttribute(KEY_ATTR, keyToken(key));
  install();
}
