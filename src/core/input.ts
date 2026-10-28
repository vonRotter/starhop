import { clamp } from './math';

// Keyboard, mouse (virtual stick under pointer lock) and gamepad, adapted from Tachyon's input.

export interface FlightInput {
  pitch: number; // +1 nose up
  yaw: number; // +1 nose right
  roll: number; // +1 roll right
  throttleDelta: number; // -1..1 per second
  strafeX: number;
  strafeY: number;
  boost: boolean;
  slide: boolean;
}

export interface FootInput {
  moveX: number; // +1 right
  moveY: number; // +1 forward
  lookX: number; // rad this frame (mouse) or rate (stick/keys) -> combined as radians
  lookY: number;
  jumpHeld: boolean;
  run: boolean;
  useHeld: boolean;
  scanHeld: boolean;
}

/** One-shot actions polled with `pressed()`. */
export type Action =
  | 'pause'
  | 'confirm'
  | 'back'
  | 'log'
  | 'target'
  | 'autopilot'
  | 'land'
  | 'hyper'
  | 'use'
  | 'jump'
  | 'voice'
  | 'menuUp'
  | 'menuDown'
  | 'menuLeft'
  | 'menuRight';

type HoldAction =
  | 'throttleUp'
  | 'throttleDown'
  | 'pitchUp'
  | 'pitchDown'
  | 'yawLeft'
  | 'yawRight'
  | 'rollLeft'
  | 'rollRight'
  | 'strafeLeft'
  | 'strafeRight'
  | 'strafeUp'
  | 'strafeDown'
  | 'boost'
  | 'slide'
  | 'fwd'
  | 'backward'
  | 'left'
  | 'right'
  | 'lookLeft'
  | 'lookRight'
  | 'lookUp'
  | 'lookDown'
  | 'jump'
  | 'run'
  | 'use'
  | 'scan';

// Flight keys follow Tachyon (W/S throttle, arrows pitch & yaw, Q/E roll, A/D strafe, Shift boost,
// Space slide). On foot WASD walks and the arrows turn the camera.
const FLIGHT_KEYS: Partial<Record<HoldAction, string[]>> = {
  throttleUp: ['KeyW'],
  throttleDown: ['KeyS'],
  pitchUp: ['ArrowUp'],
  pitchDown: ['ArrowDown'],
  yawLeft: ['ArrowLeft'],
  yawRight: ['ArrowRight'],
  rollLeft: ['KeyQ'],
  rollRight: ['KeyE'],
  strafeLeft: ['KeyA'],
  strafeRight: ['KeyD'],
  strafeUp: ['KeyR'],
  strafeDown: ['KeyF'],
  boost: ['ShiftLeft', 'ShiftRight'],
  slide: ['Space'],
};
const FOOT_KEYS: Partial<Record<HoldAction, string[]>> = {
  fwd: ['KeyW'],
  backward: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  lookLeft: ['ArrowLeft'],
  lookRight: ['ArrowRight'],
  lookUp: ['ArrowUp'],
  lookDown: ['ArrowDown'],
  jump: ['Space'],
  run: ['ShiftLeft', 'ShiftRight'],
  use: ['KeyE'],
  scan: ['KeyF', 'Mouse2'],
};

/** Keys that fire one-shot actions in every mode (the game decides what applies). */
const EDGE_KEYS: Record<string, Action[]> = {
  Escape: ['pause', 'back'],
  KeyP: ['pause'],
  Enter: ['confirm'],
  Tab: ['target'],
  KeyZ: ['autopilot'],
  KeyL: ['land'],
  KeyH: ['hyper'],
  KeyE: ['use'],
  Space: ['jump'],
  KeyJ: ['log'],
  KeyV: ['voice'],
  ArrowUp: ['menuUp'],
  ArrowDown: ['menuDown'],
  ArrowLeft: ['menuLeft'],
  ArrowRight: ['menuRight'],
  Backspace: ['back'],
};

/** Standard Gamepad mapping: identical indices for Xbox and PlayStation pads. */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

const deadzone = (v: number, dz = 0.15): number => {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return Math.sign(v) * ((a - dz) / (1 - dz));
};
const curve = (v: number, p = 1.6): number => Math.sign(v) * Math.pow(Math.abs(v), p);

export class Input {
  device: 'keyboard' | 'gamepad' = 'keyboard';
  /** Options: invert up/down for mouse and sticks, and look speeds (1 = normal). */
  invertY = false;
  mouseSens = 1;
  stickSens = 1;
  private readonly held = new Set<string>();
  private readonly actions = new Set<Action>();
  readonly cursor = { x: 0, y: 0 };
  private readonly mouseDelta = { x: 0, y: 0 };
  pointerLocked = false;
  private padButtons: boolean[] = [];
  private padPrev: boolean[] = [];
  private padAxes: number[] = [0, 0, 0, 0];
  private padTriggers = { lt: 0, rt: 0 };
  private padConnected = false;
  private stickPrev = { x: 0, y: 0 };
  anyKeyPressed = false;

  constructor(private readonly canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) {
        // let focused menu buttons handle Space/Enter themselves; stop page scrolling otherwise
        if (!(e.code === 'Space' && document.activeElement instanceof HTMLButtonElement)) e.preventDefault();
      }
      if (!e.repeat) for (const a of EDGE_KEYS[e.code] ?? []) this.actions.add(a);
      this.held.add(e.code);
      this.device = 'keyboard';
      this.anyKeyPressed = true;
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      const mx = clamp(e.movementX, -300, 300);
      const my = clamp(e.movementY, -300, 300);
      this.mouseDelta.x += mx;
      this.mouseDelta.y += my;
      const s = 0.0028;
      this.cursor.x += mx * s * this.mouseSens;
      this.cursor.y += my * s * this.mouseSens * (this.invertY ? -1 : 1);
      const len = Math.hypot(this.cursor.x, this.cursor.y);
      if (len > 1) {
        this.cursor.x /= len;
        this.cursor.y /= len;
      }
      this.device = 'keyboard';
    });
    window.addEventListener('mousedown', (e) => {
      if (this.pointerLocked) this.held.add(`Mouse${e.button}`);
      this.anyKeyPressed = true;
    });
    window.addEventListener('mouseup', (e) => this.held.delete(`Mouse${e.button}`));
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      this.cursor.x = this.cursor.y = 0;
    });
  }

  requestPointerLock(): void {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const r = this.canvas.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => undefined);
    } catch {
      /* not allowed here */
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private down(map: Partial<Record<HoldAction, string[]>>, a: HoldAction): boolean {
    for (const c of map[a] ?? []) if (this.held.has(c)) return true;
    return false;
  }

  /** Call once per frame before reading. */
  poll(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    this.padConnected = pad !== null;
    if (!pad) return;
    this.padPrev = this.padButtons;
    this.padButtons = pad.buttons.map((b) => b.pressed);
    this.padAxes = [pad.axes[0] ?? 0, pad.axes[1] ?? 0, pad.axes[2] ?? 0, pad.axes[3] ?? 0];
    this.padTriggers.lt = pad.buttons[PAD.LT]?.value ?? 0;
    this.padTriggers.rt = pad.buttons[PAD.RT]?.value ?? 0;
    const active =
      this.padButtons.some((b) => b) || this.padAxes.some((a) => Math.abs(a) > 0.3) || this.padTriggers.rt > 0.2;
    if (active) {
      this.device = 'gamepad';
      this.anyKeyPressed = true;
    }
    const edge = (i: number) => this.padButtons[i] && !this.padPrev[i];
    if (edge(PAD.START)) this.actions.add('pause');
    if (edge(PAD.A)) {
      this.actions.add('confirm');
      this.actions.add('jump');
    }
    if (edge(PAD.B)) {
      this.actions.add('back');
      this.actions.add('autopilot');
    }
    if (edge(PAD.X)) {
      this.actions.add('land');
      this.actions.add('use');
    }
    // Y / LB: next target in flight (the quest log on foot); View / Back: the quest log
    if (edge(PAD.Y) || edge(PAD.LB)) this.actions.add('target');
    if (edge(PAD.BACK)) this.actions.add('log');
    if (edge(PAD.RB)) this.actions.add('hyper');
    if (edge(PAD.UP)) this.actions.add('menuUp');
    if (edge(PAD.DOWN)) this.actions.add('menuDown');
    if (edge(PAD.LEFT)) this.actions.add('menuLeft');
    if (edge(PAD.RIGHT)) this.actions.add('menuRight');
    // left stick flicks also move menu focus
    const ly = this.padAxes[1];
    const lx = this.padAxes[0];
    if (ly < -0.6 && this.stickPrev.y >= -0.6) this.actions.add('menuUp');
    if (ly > 0.6 && this.stickPrev.y <= 0.6) this.actions.add('menuDown');
    if (lx < -0.6 && this.stickPrev.x >= -0.6) this.actions.add('menuLeft');
    if (lx > 0.6 && this.stickPrev.x <= 0.6) this.actions.add('menuRight');
    this.stickPrev = { x: lx, y: ly };
  }

  get gamepadConnected(): boolean {
    return this.padConnected;
  }

  pressed(a: Action): boolean {
    return this.actions.has(a);
  }

  consume(a: Action): void {
    this.actions.delete(a);
  }

  /** Call at the end of each frame. */
  endFrame(): void {
    this.actions.clear();
    this.anyKeyPressed = false;
    this.mouseDelta.x = this.mouseDelta.y = 0;
  }

  readFlight(): FlightInput {
    const k = (a: HoldAction) => (this.down(FLIGHT_KEYS, a) ? 1 : 0);
    const out: FlightInput = { pitch: 0, yaw: 0, roll: 0, throttleDelta: 0, strafeX: 0, strafeY: 0, boost: false, slide: false };
    // mouse virtual stick (Tachyon's "stick" mode)
    if (this.pointerLocked) {
      const dz = 0.05;
      const len = Math.hypot(this.cursor.x, this.cursor.y);
      if (len > dz) {
        const scale = (len - dz) / (1 - dz) / len;
        out.yaw += curve(this.cursor.x * scale, 1.3);
        out.pitch += -curve(this.cursor.y * scale, 1.3);
      }
    }
    out.pitch += k('pitchUp') - k('pitchDown');
    out.yaw += k('yawRight') - k('yawLeft');
    out.roll += k('rollRight') - k('rollLeft');
    out.strafeX += k('strafeRight') - k('strafeLeft');
    out.strafeY += k('strafeUp') - k('strafeDown');
    out.throttleDelta += k('throttleUp') - k('throttleDown');
    out.boost = this.down(FLIGHT_KEYS, 'boost') || this.held.has('Mouse0');
    out.slide = this.down(FLIGHT_KEYS, 'slide');
    if (this.padConnected) {
      const [lx, ly, rx, ry] = this.padAxes.map((a) => deadzone(a));
      const yInv = this.invertY ? -1 : 1;
      const ss = this.stickSens;
      out.yaw += clamp(curve(rx) * ss, -1, 1);
      out.pitch += clamp(-curve(ry) * yInv * ss, -1, 1);
      out.roll += curve(lx, 1.3);
      out.throttleDelta += -ly;
      const b = this.padButtons;
      out.strafeX += (b[PAD.RIGHT] ? 1 : 0) - (b[PAD.LEFT] ? 1 : 0);
      out.strafeY += (b[PAD.UP] ? 1 : 0) - (b[PAD.DOWN] ? 1 : 0);
      out.boost ||= !!b[PAD.A] || this.padTriggers.rt > 0.4;
      out.slide ||= this.padTriggers.lt > 0.4;
    }
    out.pitch = clamp(out.pitch, -1, 1);
    out.yaw = clamp(out.yaw, -1, 1);
    out.roll = clamp(out.roll, -1, 1);
    out.strafeX = clamp(out.strafeX, -1, 1);
    out.strafeY = clamp(out.strafeY, -1, 1);
    out.throttleDelta = clamp(out.throttleDelta, -1, 1);
    return out;
  }

  /** On-foot input. look values are radians for this frame. */
  readFoot(dt: number): FootInput {
    const k = (a: HoldAction) => (this.down(FOOT_KEYS, a) ? 1 : 0);
    const out: FootInput = {
      moveX: k('right') - k('left'),
      moveY: k('fwd') - k('backward'),
      lookX: (k('lookRight') - k('lookLeft')) * 2.2 * dt + this.mouseDelta.x * 0.0035 * this.mouseSens,
      lookY: (k('lookDown') - k('lookUp')) * 1.4 * dt + this.mouseDelta.y * 0.0035 * this.mouseSens * (this.invertY ? -1 : 1),
      jumpHeld: this.down(FOOT_KEYS, 'jump'),
      run: this.down(FOOT_KEYS, 'run'),
      useHeld: this.down(FOOT_KEYS, 'use'),
      scanHeld: this.down(FOOT_KEYS, 'scan'),
    };
    if (this.padConnected) {
      const [lx, ly, rx, ry] = this.padAxes.map((a) => deadzone(a));
      out.moveX += lx;
      out.moveY += -ly;
      out.lookX += curve(rx, 1.4) * 2.6 * dt * this.stickSens;
      out.lookY += curve(ry, 1.4) * 1.8 * dt * (this.invertY ? -1 : 1) * this.stickSens;
      const b = this.padButtons;
      out.jumpHeld ||= !!b[PAD.A];
      out.useHeld ||= !!b[PAD.X];
      out.scanHeld ||= this.padTriggers.lt > 0.4 || this.padTriggers.rt > 0.4;
      out.run ||= !!b[PAD.L3] || !!b[PAD.LB] || Math.hypot(lx, ly) > 0.95;
    }
    const len = Math.hypot(out.moveX, out.moveY);
    if (len > 1) {
      out.moveX /= len;
      out.moveY /= len;
    }
    return out;
  }
}
