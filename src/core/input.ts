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
 *   camera C / gamepad Y, pause Esc/P / Start, map M, help H, timeFwd ], timeBack [, photo O, hud U, source I (a moment's sources),
 *   land L also offers the ferry escort: while "[L] Vapura eşlik et" is shown (or "Eşliği bırak" while drifting away)
 *   the escort claims L (claim()), so that press starts / stops the escort instead of landing (src/activities/escort)
 * Rider and maneuvers:
 *   pet G held / D-pad down, stand T, weather N, encourage V / D-pad up (the rider pats the neck and calls to the
 *   dragon: a bond interaction with no effect on speed or physics)
 *   rollLeft / rollRight: A / D (and arrows) as buttons, for double-tap tricks (gamepad D-pad left/right = a double tap)
 *   pitchUp / pitchDown: S / W (and arrows) as buttons, for double-tap tricks (gamepad: a left-stick flick up / down)
 *   yawLeft / yawRight: Q / E as buttons, for the side-slip double tap (gamepad LB / RB)
 * Gamepad buttons double-tap like keys (A / RT = Space, LT = Shift); key hints name the pad buttons (core/pad-keys.ts).
 * Hotbar: slot1..slot5 = Digit1..Digit5 (and the numpad digits); the digit keys are reserved for the hotbar.
 * Double taps: wasDoubleTapped(name) is true for one frame when a button is pressed twice within DOUBLE_TAP_MS
 * (the recogniser and the gesture collisions are documented in core/gestures.ts).
 */
import { AxisPress, DOUBLE_TAP_MS, DoubleTapRecognizer } from './gestures';

export { DOUBLE_TAP_MS };

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
  | 'pet'
  | 'stand'
  | 'encourage'
  | 'weather'
  | 'source'
  | 'rollLeft'
  | 'rollRight'
  | 'pitchUp'
  | 'pitchDown'
  | 'yawLeft'
  | 'yawRight'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'slot4'
  | 'slot5';

/** Hotbar slot buttons in slot order (number keys 1..5). */
export const HOTBAR_BUTTONS: readonly ButtonName[] = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5'];

/** Buttons that only exist as edges (never reported as held). */
const EDGE_ONLY: ReadonlySet<ButtonName> = new Set<ButtonName>(['camera', 'pause', 'map', 'help', 'photo', 'hud', 'weather', 'source', 'encourage', ...HOTBAR_BUTTONS]);

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
  KeyG: 'pet',
  KeyT: 'stand',
  KeyV: 'encourage',
  KeyN: 'weather',
  KeyI: 'source',
  KeyA: 'rollLeft',
  ArrowLeft: 'rollLeft',
  KeyD: 'rollRight',
  ArrowRight: 'rollRight',
  KeyS: 'pitchUp',
  ArrowDown: 'pitchUp',
  KeyW: 'pitchDown',
  ArrowUp: 'pitchDown',
  KeyQ: 'yawLeft',
  KeyE: 'yawRight',
  Digit1: 'slot1',
  Digit2: 'slot2',
  Digit3: 'slot3',
  Digit4: 'slot4',
  Digit5: 'slot5',
  Numpad1: 'slot1',
  Numpad2: 'slot2',
  Numpad3: 'slot3',
  Numpad4: 'slot4',
  Numpad5: 'slot5',
};

/** Groups of the key list (pause menu → Kontroller, H overlay). */
export type ControlGroup = 'flight' | 'hover' | 'ground' | 'water' | 'tricks' | 'dragon' | 'camera' | 'perch' | 'game';

/**
 * The key list shown in the pause menu (Kontroller) and the H overlay. `keys` is parsed by the UI: "A / B" are
 * alternatives, "Ctrl + W" are held together, a trailing "×2" is a double tap; single letters, Space, Shift, Ctrl, Esc,
 * "[", "]", "Sol tık" and "Sağ tık" light up on the keyboard and mouse drawing (extra words such as "bırak" are kept
 * on the key cap).
 */
export const CONTROL_HELP: Array<{ keys: string; action: string; group: ControlGroup }> = [
  { keys: 'W / S', action: 'Burun aşağı / yukarı', group: 'flight' },
  { keys: 'A / D', action: 'Sola / sağa yatış', group: 'flight' },
  { keys: 'Q / E', action: 'Dümen: sola / sağa dön', group: 'flight' },
  { keys: 'Space', action: 'Kanat çırp: tırman, hızlan', group: 'flight' },
  { keys: 'Ctrl / X', action: 'Fren, havada asılı kal', group: 'flight' },
  { keys: 'L', action: 'İniş / kalkış (hızlı ve alçakken: koşarak iniş)', group: 'flight' },
  { keys: 'Ctrl / X', action: 'Yavaşla ve havada asılı kal', group: 'hover' },
  { keys: 'Ctrl + W / S', action: 'Yavaşça ileri, geri', group: 'hover' },
  { keys: 'A / D', action: 'Olduğun yerde dön', group: 'hover' },
  { keys: 'Space / Shift', action: 'Yüksel / alçal', group: 'hover' },
  { keys: 'W', action: 'Freni bırak, uçuşa geç', group: 'hover' },
  { keys: 'L', action: 'Olduğun yere kon', group: 'hover' },
  { keys: 'W / S', action: 'İleri yürü / geri git', group: 'ground' },
  { keys: 'Shift + W', action: 'Koş', group: 'ground' },
  { keys: 'A / D', action: 'Dön', group: 'ground' },
  { keys: 'Space / L', action: 'Sıçrayarak kalk (çatı kenarında: boşluğa atıl)', group: 'ground' },
  { keys: 'Space / L', action: 'Koşarken (Shift + W): koşu hızıyla sıçrayıp havalan', group: 'ground' },
  { keys: 'Ctrl / X', action: 'Koşarak inerken: fren yap, kayarak dur', group: 'ground' },
  { keys: 'Space', action: 'Koşarak inerken: dokun-kalk, hızını koruyarak uçuşa dön', group: 'ground' },
  // The sea (phase 21): the plunge, swimming, under water, the breach and the take-off from the water.
  { keys: 'Shift', action: 'Derin suya dik alçalırken: kanatları kapat, suya dal', group: 'water' },
  { keys: 'W / S', action: 'Yüzerken: ileri yüz / geri git', group: 'water' },
  { keys: 'Shift + W', action: 'Hızlı yüz', group: 'water' },
  { keys: 'A / D', action: 'Suda dön', group: 'water' },
  { keys: 'Space / L', action: 'Yüzerken: suyun üstünde koşup havalan', group: 'water' },
  { keys: 'W / S', action: 'Su altında: burun aşağı / yukarı', group: 'water' },
  { keys: 'Space', action: 'Su altında: kanat vuruşu (yüzeye yakınken: sudan fırla)', group: 'water' },
  { keys: 'Shift', action: 'Kanatları kapat: dalış, serbest düşüş', group: 'tricks' },
  { keys: 'Shift bırak / Space', action: 'Kanatları aç, düşüşü kes', group: 'tricks' },
  { keys: 'Space ×2', action: 'Güç vuruşu: iki derin kanat çırpışıyla hızlan (dayanıklılık harcar)', group: 'tricks' },
  { keys: 'Shift ×2', action: 'Hızlıyken ok gibi atıl: kanatlar yarı kapalı, sığ dalışla hız kazan (yavaşken: serbest düşüş)', group: 'tricks' },
  { keys: 'Q / E ×2', action: 'Kayış: yönünü bozmadan yana kay', group: 'tricks' },
  { keys: 'A / D ×2', action: 'Takla at (basılı tut: dönmeye devam et)', group: 'tricks' },
  { keys: 'S ×2', action: 'Looping', group: 'tricks' },
  { keys: 'A / D basılı + S ×2', action: 'Kanat üstü dönüş: yatışta tırman, yüksek kanadın üstünden dön, dalarak geri dön (enerjini korur)', group: 'tricks' },
  { keys: 'Looping tepesinde A / D', action: 'Immelmann: yarım looping, tepede yarım takla ile düzel (yüksel, geri dön)', group: 'tricks' },
  { keys: 'Dik dalışta A / D ×2', action: 'Split-S: sırtüstü dön, yarım looping ile aşağıdan geri dön (alçal, hızlan; basılı tut: takla atarak dal)', group: 'tricks' },
  { keys: 'W', action: 'Suya ya da düz zemine alçal: hızlı ve kanatlar düzken sıyırma (kendiliğinden)', group: 'tricks' },
  { keys: 'F / Sol tık', action: 'Ateş püskür', group: 'dragon' },
  { keys: 'R', action: 'Kükre', group: 'dragon' },
  { keys: 'G', action: 'Ejderhayı sev (basılı tut)', group: 'dragon' },
  { keys: 'T', action: 'Eyerde ayağa kalk / otur', group: 'dragon' },
  { keys: 'V', action: 'Ejderhayı yüreklendir: boynunu sıvazla, ona seslen', group: 'dragon' },
  { keys: 'Sağ tık', action: 'Etrafa bak (basılı tut)', group: 'camera' },
  { keys: 'C', action: 'Kamera: 3. şahıs, binici, sinematik', group: 'camera' },
  { keys: 'O', action: 'Fotoğraf modu', group: 'camera' },
  { keys: 'Enter', action: 'Fotoğraf modunda: fotoğraf çek (duraklatma menüsü → Albüm)', group: 'camera' },
  { keys: '[ / ]', action: 'Saati yarım saat geri / ileri', group: 'camera' },
  { keys: 'N', action: 'Hava: açık, pus, sis, yağmur, fırtına', group: 'camera' },
  // Viewpoints (phase 03, src/dragon/flight/perch.ts, src/ui/perch-view.ts).
  { keys: 'L', action: 'Seyir noktası yakındayken ("Kon" yazısı çıkınca): kon ve izle', group: 'perch' },
  { keys: 'L / Space', action: 'Konmak üzereyken: vazgeç (yön tuşları da iptal eder)', group: 'perch' },
  { keys: 'Space / L', action: 'Seyir noktasında: havalan, boşluğa atıl', group: 'perch' },
  { keys: 'T', action: 'Seyir noktasında: zamanı hızlandır / normale döndür', group: 'perch' },
  { keys: 'C', action: 'Seyir noktasında: kamera (yörünge, sabit, binici gözü)', group: 'perch' },
  { keys: 'O', action: 'Seyir noktasında: fotoğraf modu', group: 'perch' },
  { keys: '1–5', action: 'Hotbar: yetenek / eşya kullan', group: 'game' },
  { keys: 'Y', action: 'Halka yarışı: parkur seç, parkur editörü (yarışta: iptal et, editörde: çık)', group: 'game' },
  { keys: 'B', action: 'Parkur editöründe: halka koy', group: 'game' },
  { keys: 'Backspace', action: 'Parkur editöründe: son halkayı sil', group: 'game' },
  { keys: 'K / J', action: 'Parkur editöründe: kapı ↔ hız halkası / kapı boyutu', group: 'game' },
  { keys: 'Enter', action: 'Parkur editöründe: kaydet', group: 'game' },
  { keys: 'I', action: 'Bir an sırasında ve biraz sonrasında: kaynağa bak (şiirin, hikâyenin aslı)', group: 'game' },
  { keys: 'L', action: 'Seferdeki bir vapurun yanında aynı yöne uçarken: vapura eşlik et (uzaklaşırken: eşliği bırak; eşlikte L ile inersen eşlik biter)', group: 'game' },
  { keys: 'M', action: 'Harita', group: 'game' },
  { keys: 'U', action: 'Arayüzü gizle', group: 'game' },
  { keys: 'H', action: 'Yardım', group: 'game' },
  { keys: 'Esc / P', action: 'Duraklat', group: 'game' },
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
  /** Buttons whose presses belong to one reader for now (claim()). */
  private readonly claimed = new Set<ButtonName>();
  private pressedQueue = new Set<ButtonName>();
  private doubleNow = new Set<ButtonName>();
  private doubleQueue = new Set<ButtonName>();
  private readonly doubleTaps = new DoubleTapRecognizer<ButtonName>(DOUBLE_TAP_MS);
  private mouseButtons = new Set<number>();
  private axes: Record<AxisName, AxisState> = {
    pitch: { value: 0, target: 0 },
    roll: { value: 0, target: 0 },
    yaw: { value: 0, target: 0 },
  };
  private pendingMouse = { x: 0, y: 0 };
  private pendingWheel = 0;
  private gamepadButtonsPrev: boolean[] = [];
  /** Pad buttons (and triggers) held last frame, by the button they press; the left stick's up / down flicks. */
  private readonly padHeldPrev = new Set<ButtonName>();
  private readonly padPitchFlick = new AxisPress(0.6, 0.25);
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

  /**
   * A light gamepad rumble (0..1 strength for `ms`), when the pad supports it; keyboard players get nothing. Calls
   * closer than the rumble's own length are merged by the browser.
   */
  rumble(strength: number, ms: number): void {
    if (this.lastDevice !== 'gamepad' || !(strength > 0.01)) {
      return;
    }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && Array.from(pads).find((p) => p && p.connected);
    const actuator = (gp as unknown as { vibrationActuator?: { playEffect?: (type: string, params: Record<string, number>) => Promise<unknown> } } | null)?.vibrationActuator;
    if (!actuator?.playEffect) {
      return;
    }
    const s = Math.min(1, strength);
    actuator.playEffect('dual-rumble', { duration: Math.max(16, ms), strongMagnitude: s, weakMagnitude: s * 0.5 }).catch(() => undefined);
  }

  axis(name: AxisName): number {
    return this.axes[name].value;
  }

  isHeld(name: ButtonName): boolean {
    return this.held.has(name);
  }

  wasPressed(name: ButtonName): boolean {
    return this.pressedNow.has(name) && !this.claimed.has(name);
  }

  /**
   * Reserves a button's presses for one reader until released: wasPressed() then reports false for it and the claimant
   * reads it with wasClaimedPress(). Used when a context gives a key a second meaning (L starts a ferry escort while
   * one is offered instead of landing). Readers that update earlier in the frame see the claim set last frame.
   */
  claim(name: ButtonName, on: boolean): void {
    if (on) {
      this.claimed.add(name);
    } else {
      this.claimed.delete(name);
    }
  }

  /** A press of a claimed button this frame (false while the button is not claimed). */
  wasClaimedPress(name: ButtonName): boolean {
    return this.pressedNow.has(name) && this.claimed.has(name);
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
      [12, 'encourage', true],
      [13, 'pet', false],
      [14, 'rollLeft', true],
      [15, 'rollRight', true],
    ];
    let any = false;
    const t = performance.now();
    // Buttons that act like keys: a fresh press is a press, and two within DOUBLE_TAP_MS a double tap (like the keys).
    const padDown = new Map<ButtonName, boolean>();
    for (const [i, name, edge] of map) {
      const now = b(i);
      if (now) {
        any = true;
      }
      if (edge) {
        if (now && !this.gamepadButtonsPrev[i]) {
          this.pressedNow.add(name);
          if (name === 'rollLeft' || name === 'rollRight') {
            // One D-pad press is the roll's double tap.
            this.doubleNow.add(name);
          }
        }
      } else {
        if (now) {
          held.add(name);
        }
        padDown.set(name, (padDown.get(name) ?? false) || now);
      }
      this.gamepadButtonsPrev[i] = now;
    }
    const rt = val(7) > 0.3;
    const lt = val(6) > 0.3;
    if (rt) {
      held.add('flap');
      any = true;
    }
    if (lt) {
      held.add('dive');
      any = true;
    }
    padDown.set('flap', (padDown.get('flap') ?? false) || rt);
    padDown.set('dive', lt);
    padDown.set('yawLeft', b(4));
    padDown.set('yawRight', b(5));
    for (const [name, now] of padDown) {
      if (now && !this.padHeldPrev.has(name)) {
        this.pressedNow.add(name);
        if (this.doubleTaps.press(name, t)) {
          this.doubleNow.add(name);
        }
      }
      if (now) {
        this.padHeldPrev.add(name);
      } else {
        this.padHeldPrev.delete(name);
      }
    }
    const rx = dz(gp.axes[2] ?? 0);
    const ry = dz(gp.axes[3] ?? 0);
    if (rx || ry) {
      this.mouseDelta.x += rx * 12;
      this.mouseDelta.y += ry * 12;
      held.add('look');
      any = true;
    }
    // A flick of the left stick up / down is a press of S / W (the pitch axis before the invert setting, like the
    // keys), so the S double tap (loop, wingover) is two flicks.
    const flick = this.padPitchFlick.update(dz(gp.axes[1] ?? 0));
    if (flick) {
      const name: ButtonName = flick < 0 ? 'pitchUp' : 'pitchDown';
      this.pressedNow.add(name);
      if (this.doubleTaps.press(name, t)) {
        this.doubleNow.add(name);
      }
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
        if (this.doubleTaps.press(b, performance.now())) {
          this.doubleQueue.add(b);
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
