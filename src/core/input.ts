/**
 * Action-mapped input: keyboard, mouse (pointer lock) and gamepad.
 *
 * Axes (-1..1, keyboard is smoothed):
 *   pitch   W/S  (+1 = nose down / W)        gamepad left stick Y
 *   roll    A/D  (+1 = roll right / D)       gamepad left stick X
 *   yaw     Q/E  (+1 = yaw right / E)        gamepad bumpers
 * Buttons (held):
 *   flap    Space        gamepad A / RT     (beat wings: climb / accelerate)
 *   dive    Shift        gamepad LT         (fold wings: dive)
 *   brake   Ctrl / X     gamepad B          (flare wings: slow down / hover)
 *   fire    F / LMB      gamepad X          (fire breath)
 *   look    RMB held, or always in POV (mouse look)
 * Buttons (pressed this frame):
 *   camera C / gamepad Y, pause Esc/P / Start, map M, help H, timeFwd ], timeBack [, photo O, hud U
 * Rider and maneuvers:
 *   urge V / gamepad D-pad up (the "dehh": speed burst), pet G held / D-pad down, stand T, weather N
 *   rollLeft / rollRight: A / D (and arrows) as buttons, for double-tap tricks (gamepad D-pad left/right = a double tap)
 *   pitchUp / pitchDown: S / W (and arrows) as buttons, for double-tap tricks
 * Double taps: wasDoubleTapped(name) is true for one frame when a button is pressed twice within DOUBLE_TAP_MS.
 */
export type AxisName = 'pitch' | 'roll' | 'yaw';
export type ButtonName =
  | 'flap'
  | 'dive'
  | 'brake'
  | 'fire'
  | 'look'
  | 'camera'
  | 'pause'
  | 'map'
  | 'help'
  | 'timeFwd'
  | 'timeBack'
  | 'photo'
  | 'hud'
  | 'roar'
  | 'land'
  | 'urge'
  | 'pet'
  | 'stand'
  | 'weather'
  | 'rollLeft'
  | 'rollRight'
  | 'pitchUp'
  | 'pitchDown';

/** Two presses of the same button within this window count as a double tap (ms). */
export const DOUBLE_TAP_MS = 300;

/** Buttons that only exist as edges (never reported as held). */
const EDGE_ONLY: ReadonlySet<ButtonName> = new Set<ButtonName>(['camera', 'pause', 'map', 'help', 'photo', 'hud', 'weather']);

const KEY_BUTTONS: Record<string, ButtonName> = {
  Space: 'flap',
  ShiftLeft: 'dive',
  ShiftRight: 'dive',
  ControlLeft: 'brake',
  ControlRight: 'brake',
  KeyX: 'brake',
  KeyF: 'fire',
  KeyC: 'camera',
  Escape: 'pause',
  KeyP: 'pause',
  KeyM: 'map',
  KeyH: 'help',
  BracketRight: 'timeFwd',
  BracketLeft: 'timeBack',
  KeyO: 'photo',
  KeyU: 'hud',
  KeyR: 'roar',
  KeyL: 'land',
  KeyV: 'urge',
  KeyG: 'pet',
  KeyT: 'stand',
  KeyN: 'weather',
  KeyA: 'rollLeft',
  ArrowLeft: 'rollLeft',
  KeyD: 'rollRight',
  ArrowRight: 'rollRight',
  KeyS: 'pitchUp',
  ArrowDown: 'pitchUp',
  KeyW: 'pitchDown',
  ArrowUp: 'pitchDown',
};

export const CONTROL_HELP: Array<{ keys: string; action: string }> = [
  { keys: 'W / S', action: 'Burun aşağı / yukarı' },
  { keys: 'A / D', action: 'Sola / sağa yatış' },
  { keys: 'Q / E', action: 'Sola / sağa dönüş (dümen)' },
  { keys: 'Space', action: 'Kanat çırp (tırmanış, hız)' },
  { keys: 'V', action: 'Dehh! Dizginleri şaklat, hızlan' },
  { keys: 'Shift', action: 'Kanatları kapat: dalış, serbest düşüş' },
  { keys: 'Shift bırak / Space', action: 'Kanatları aç, düşüşü kes' },
  { keys: 'A / D çift dokun', action: 'Takla at (basılı tut: dönmeye devam et)' },
  { keys: 'S çift dokun', action: 'Looping' },
  { keys: 'Ctrl / X', action: 'Fren, havada asılı kal' },
  { keys: 'F / Sol tık', action: 'Ateş püskür' },
  { keys: 'R', action: 'Kükre' },
  { keys: 'L', action: 'İniş / kalkış' },
  { keys: 'G (basılı)', action: 'Ejderhayı sev' },
  { keys: 'T', action: 'Eyerde ayağa kalk / otur' },
  { keys: 'N', action: 'Hava: açık, pus, sis, yağmur, fırtına' },
  { keys: 'Y', action: 'Halka yarışı: sıradaki parkuru başlat / iptal et' },
  { keys: 'Fare', action: 'Etrafa bak (sağ tık basılı / POV)' },
  { keys: 'C', action: 'Kamera: üçüncü şahıs / POV / sinematik' },
  { keys: '[ / ]', action: 'Günün saatini değiştir' },
  { keys: 'M', action: 'Harita' },
  { keys: 'O', action: 'Fotoğraf modu' },
  { keys: 'U', action: 'Arayüzü gizle' },
  { keys: 'H', action: 'Yardım' },
  { keys: 'Esc / P', action: 'Duraklat' },
];

interface AxisState {
  value: number;
  target: number;
}

export class Input {
  /** Mouse delta in pixels accumulated since the last frame (already consumed each frame). */
  readonly mouseDelta = { x: 0, y: 0 };
  /** Wheel delta accumulated this frame (+ = zoom out). */
  wheel = 0;
  pointerLocked = false;
  /** Set false to route keys to UI (e.g. while a text field has focus). */
  enabled = true;
  lastDevice: 'keyboard' | 'gamepad' = 'keyboard';
  /** User preferences (UI writes, flight/camera read). Pitch inversion is already applied to axis('pitch'). */
  readonly settings = { invertPitch: false, mouseSensitivity: 1, invertMouseY: false };

  private keys = new Set<string>();
  private held = new Set<ButtonName>();
  private pressedNow = new Set<ButtonName>();
  private pressedQueue = new Set<ButtonName>();
  private doubleNow = new Set<ButtonName>();
  private doubleQueue = new Set<ButtonName>();
  private readonly lastPressAt = new Map<ButtonName, number>();
  private mouseButtons = new Set<number>();
  private axes: Record<AxisName, AxisState> = {
    pitch: { value: 0, target: 0 },
    roll: { value: 0, target: 0 },
    yaw: { value: 0, target: 0 },
  };
  private pendingMouse = { x: 0, y: 0 };
  private pendingWheel = 0;
  private gamepadButtonsPrev: boolean[] = [];
  private canvas: HTMLElement;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
  }

  requestPointerLock(): void {
    if (document.pointerLockElement !== this.canvas) {
      this.canvas.requestPointerLock?.()?.catch?.(() => undefined);
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  axis(name: AxisName): number {
    return this.axes[name].value;
  }

  isHeld(name: ButtonName): boolean {
    return this.held.has(name);
  }

  wasPressed(name: ButtonName): boolean {
    return this.pressedNow.has(name);
  }

  /** True for one frame after the second press of a double tap (gamepad D-pad left/right count as one). */
  wasDoubleTapped(name: ButtonName): boolean {
    return this.doubleNow.has(name);
  }

  /** Call once per frame (engine does it) before systems update. */
  update(dt: number): void {
    this.pressedNow = this.pressedQueue;
    this.pressedQueue = new Set();
    this.doubleNow = this.doubleQueue;
    this.doubleQueue = new Set();
    this.mouseDelta.x = this.pendingMouse.x;
    this.mouseDelta.y = this.pendingMouse.y;
    this.pendingMouse.x = 0;
    this.pendingMouse.y = 0;
    this.wheel = this.pendingWheel;
    this.pendingWheel = 0;

    const k = (code: string) => this.keys.has(code);
    const kb = {
      pitch: (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0),
      roll: (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0),
      yaw: (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0),
    };

    const held = new Set<ButtonName>();
    for (const code of this.keys) {
      const b = KEY_BUTTONS[code];
      if (b && !EDGE_ONLY.has(b)) {
        held.add(b);
      }
    }
    if (this.mouseButtons.has(0) && this.pointerLocked) {
      held.add('fire');
    }
    if (this.mouseButtons.has(2)) {
      held.add('look');
    }

    const pad = this.pollGamepad(held);
    if (this.settings.invertPitch) {
      kb.pitch = -kb.pitch;
      if (pad) {
        pad.pitch = -pad.pitch;
      }
    }
    const rate = 1 - Math.exp(-10 * dt);
    (Object.keys(this.axes) as AxisName[]).forEach((name) => {
      const a = this.axes[name];
      if (pad && Math.abs(pad[name]) > 0.02) {
        a.value = pad[name];
        a.target = pad[name];
      } else {
        a.target = kb[name];
        a.value += (a.target - a.value) * rate;
        if (Math.abs(a.value) < 1e-3) {
          a.value = 0;
        }
      }
    });
    this.held = held;
  }

  private pollGamepad(held: Set<ButtonName>): Record<AxisName, number> | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && Array.from(pads).find((p) => p && p.connected);
    if (!gp) {
      return null;
    }
    const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    const b = (i: number) => !!gp.buttons[i]?.pressed;
    const val = (i: number) => gp.buttons[i]?.value ?? 0;
    const map: Array<[number, ButtonName, boolean]> = [
      [0, 'flap', false],
      [1, 'brake', false],
      [2, 'fire', false],
      [3, 'camera', true],
      [9, 'pause', true],
      [8, 'map', true],
      [10, 'roar', true],
      [11, 'land', true],
      [12, 'urge', true],
      [13, 'pet', false],
      [14, 'rollLeft', true],
      [15, 'rollRight', true],
    ];
    let any = false;
    for (const [i, name, edge] of map) {
      const now = b(i);
      if (now) {
        any = true;
      }
      if (edge) {
        if (now && !this.gamepadButtonsPrev[i]) {
          this.pressedNow.add(name);
          if (name === 'rollLeft' || name === 'rollRight') {
            this.doubleNow.add(name);
          }
        }
      } else if (now) {
        held.add(name);
      }
      this.gamepadButtonsPrev[i] = now;
    }
    if (val(7) > 0.3) {
      held.add('flap');
      any = true;
    }
    if (val(6) > 0.3) {
      held.add('dive');
      any = true;
    }
    const rx = dz(gp.axes[2] ?? 0);
    const ry = dz(gp.axes[3] ?? 0);
    if (rx || ry) {
      this.mouseDelta.x += rx * 12;
      this.mouseDelta.y += ry * 12;
      held.add('look');
      any = true;
    }
    const res = {
      pitch: dz(gp.axes[1] ?? 0),
      roll: dz(gp.axes[0] ?? 0),
      yaw: (b(5) ? 1 : 0) - (b(4) ? 1 : 0),
    };
    if (any || res.pitch || res.roll || res.yaw) {
      this.lastDevice = 'gamepad';
    }
    return res;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) {
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) || (e.ctrlKey && e.code !== 'ControlLeft' && e.code !== 'ControlRight')) {
      e.preventDefault();
    }
    this.lastDevice = 'keyboard';
    if (!e.repeat) {
      const b = KEY_BUTTONS[e.code];
      if (b) {
        this.pressedQueue.add(b);
        const now = performance.now();
        if (now - (this.lastPressAt.get(b) ?? -Infinity) < DOUBLE_TAP_MS) {
          this.doubleQueue.add(b);
          this.lastPressAt.delete(b);
        } else {
          this.lastPressAt.set(b, now);
        }
      }
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
    this.mouseButtons.clear();
  };

  private onMouseDown = (e: MouseEvent) => {
    this.mouseButtons.add(e.button);
  };

  private onMouseUp = (e: MouseEvent) => {
    this.mouseButtons.delete(e.button);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (this.pointerLocked || this.mouseButtons.has(2)) {
      this.pendingMouse.x += e.movementX;
      this.pendingMouse.y += e.movementY;
    }
  };

  private onWheel = (e: WheelEvent) => {
    this.pendingWheel += Math.sign(e.deltaY);
  };
}
