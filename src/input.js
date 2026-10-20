// Input: keyboard, gamepads, touch and pointer, unified into per-player
// controllers with press buffering. AI drives the same controller interface.

export const ACTIONS = ['left', 'right', 'up', 'down', 'atk', 'spc', 'ult', 'dash', 'grab'];
const BUFFERED = ['up', 'atk', 'spc', 'ult', 'dash', 'grab'];

export const DEFAULT_BINDINGS = {
  solo: {
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    atk: ['KeyJ', 'KeyZ'],
    spc: ['KeyK', 'KeyX'],
    ult: ['KeyL', 'KeyC'],
    dash: ['Space', 'ShiftLeft', 'ShiftRight'],
    grab: ['KeyU', 'KeyV'],
  },
  p1: {
    left: ['KeyA'],
    right: ['KeyD'],
    up: ['KeyW'],
    down: ['KeyS'],
    atk: ['KeyF'],
    spc: ['KeyG'],
    ult: ['KeyH'],
    dash: ['Space'],
    grab: ['KeyR'],
  },
  p2: {
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    up: ['ArrowUp'],
    down: ['ArrowDown'],
    atk: ['KeyK', 'Numpad1'],
    spc: ['KeyL', 'Numpad2'],
    ult: ['Semicolon', 'Numpad3'],
    dash: ['KeyJ', 'Numpad0'],
    grab: ['KeyI', 'Numpad4'],
  },
};

const KEY_LABELS = {
  Space: 'SPACE', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ArrowLeft: '←', ArrowRight: '→',
  ArrowUp: '↑', ArrowDown: '↓', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Enter: 'ENTER', Escape: 'ESC', Backspace: 'BKSP', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Tab: 'TAB', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL',
  AltLeft: 'L-ALT', AltRight: 'R-ALT',
};
export function keyLabel(code) {
  if (!code) return '—';
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6);
  return code.toUpperCase();
}

// ---------------------------------------------------------------------------
// Raw device state
// ---------------------------------------------------------------------------
const keysDown = new Set();
const keysPressedQueue = new Set(); // pressed since last update (handles very fast taps)
let anyKeyPressed = false;
let lastKeyCode = null;
let listening = false;

export const pointer = {
  x: 0, y: 0, down: false, pressed: false, released: false, moved: false,
  wheel: 0, active: false, isTouch: false,
  _pressQueued: false, _releaseQueued: false,
};

// Touch virtual controller state (written by touch.js)
export const touchState = {
  enabled: false,
  held: { left: false, right: false, up: false, down: false, atk: false, spc: false, ult: false, dash: false, grab: false },
};

let toVirtual = (cx, cy) => [cx, cy];
export function setPointerMapper(fn) {
  toVirtual = fn;
}

const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);

export function initInput(canvas) {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('keydown', (e) => {
    if (PREVENT.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    keysDown.add(e.code);
    keysPressedQueue.add(e.code);
    anyKeyPressed = true;
    lastKeyCode = e.code;
    pointer.isTouch = false;
  });
  window.addEventListener('keyup', (e) => {
    keysDown.delete(e.code);
  });
  window.addEventListener('blur', () => keysDown.clear());

  const pos = (e) => {
    const [x, y] = toVirtual(e.clientX, e.clientY);
    pointer.x = x;
    pointer.y = y;
  };
  canvas.addEventListener('pointerdown', (e) => {
    pos(e);
    pointer.down = true;
    pointer._pressQueued = true;
    pointer.active = true;
    pointer.isTouch = e.pointerType === 'touch';
    anyKeyPressed = true;
  });
  window.addEventListener('pointermove', (e) => {
    pos(e);
    pointer.moved = true;
    if (e.pointerType !== 'touch') pointer.active = true;
  });
  window.addEventListener('pointerup', (e) => {
    pos(e);
    pointer.down = false;
    pointer._releaseQueued = true;
  });
  canvas.addEventListener('wheel', (e) => {
    pointer.wheel += Math.sign(e.deltaY);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---------------------------------------------------------------------------
// Gamepads
// ---------------------------------------------------------------------------
const pads = [];
const padPrev = [];
function readPads() {
  pads.length = 0;
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
  const list = navigator.getGamepads();
  for (const gp of list) if (gp && gp.connected) pads.push(gp);
}
const btn = (gp, i) => !!(gp && gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));

function padHeld(gp) {
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  return {
    left: ax < -0.45 || btn(gp, 14),
    right: ax > 0.45 || btn(gp, 15),
    up: ay < -0.6 || btn(gp, 12) || btn(gp, 0),
    down: ay > 0.55 || btn(gp, 13),
    atk: btn(gp, 2),
    spc: btn(gp, 3),
    ult: btn(gp, 6) || btn(gp, 7),
    dash: btn(gp, 1) || btn(gp, 5),
    grab: btn(gp, 4),
  };
}

export function gamepadCount() {
  return pads.length;
}

// ---------------------------------------------------------------------------
// Player controller
// ---------------------------------------------------------------------------
export class Controller {
  constructor() {
    this.held = {};
    this.prev = {};
    this.pressAt = {};
    this.consumed = {};
    this.frame = 0;
    this.lastTap = { left: -99, right: -99 };
    this.dashTap = 0; // -1/1 when a double-tap dash happened this frame
    this.dashTapAt = -99;
    for (const a of ACTIONS) {
      this.held[a] = false;
      this.prev[a] = false;
      this.pressAt[a] = -999;
      this.consumed[a] = true;
    }
    // sources
    this.keyMap = null; // { action: [codes] }
    this.padIndex = -1; // which gamepad (index into connected list), -1 none, 'any'
    this.useTouch = false;
    this.ai = null; // object with .held written by AI
  }
  reset() {
    for (const a of ACTIONS) {
      this.held[a] = false;
      this.prev[a] = false;
      this.pressAt[a] = -999;
      this.consumed[a] = true;
    }
    this.dashTap = 0;
  }
  // Gather from devices; call once per simulation tick
  update() {
    this.frame++;
    const h = this.held;
    for (const a of ACTIONS) {
      this.prev[a] = h[a];
      h[a] = false;
    }
    if (this.ai) {
      for (const a of ACTIONS) h[a] = !!this.ai.held[a];
    } else {
      if (this.keyMap) {
        for (const a of ACTIONS) {
          const codes = this.keyMap[a];
          if (!codes) continue;
          for (const c of codes) {
            if (keysDown.has(c) || keysPressedQueue.has(c)) {
              h[a] = true;
              break;
            }
          }
        }
      }
      if (this.padIndex !== -1) {
        const list = this.padIndex === 'any' ? pads : [pads[this.padIndex]];
        for (const gp of list) {
          if (!gp) continue;
          const ph = padHeld(gp);
          for (const a of ACTIONS) if (ph[a]) h[a] = true;
        }
      }
      if (this.useTouch && touchState.enabled) {
        for (const a of ACTIONS) if (touchState.held[a]) h[a] = true;
      }
    }
    // grab = atk + spc
    if (h.grab && !this.prev.grab) {
      this.pressAt.atk = this.frame;
      this.pressAt.spc = this.frame;
      this.consumed.atk = false;
      this.consumed.spc = false;
    }
    this.dashTap = 0;
    for (const a of ACTIONS) {
      if (h[a] && !this.prev[a]) {
        this.pressAt[a] = this.frame;
        this.consumed[a] = false;
        if (a === 'left' || a === 'right') {
          if (this.frame - this.lastTap[a] <= 13) {
            this.dashTap = a === 'left' ? -1 : 1;
            this.dashTapAt = this.frame;
          }
          this.lastTap[a] = this.frame;
        }
      }
    }
    // a direction pressed on another axis cancels double-tap memory
    if (h.left && h.right) this.lastTap.left = this.lastTap.right = -99;
  }
  // keep unconsumed button presses from expiring while the fighter is frozen
  freezeBuffer() {
    for (const a of BUFFERED) if (!this.consumed[a]) this.pressAt[a]++;
  }
  // swallow whatever is currently held (e.g. after closing a menu)
  flush() {
    this.update();
    for (const a of ACTIONS) this.consumed[a] = true;
    this.dashTap = 0;
  }
  pressed(a) {
    return this.pressAt[a] === this.frame;
  }
  // Was `a` pressed within the last `win` frames and not consumed yet?
  buffered(a, win = 6) {
    return !this.consumed[a] && this.frame - this.pressAt[a] <= win;
  }
  age(a) {
    return this.frame - this.pressAt[a];
  }
  consume(a) {
    this.consumed[a] = true;
  }
  // both atk and spc pressed within `win` frames of each other, recently
  combo2(win = 4, recent = 6) {
    const a = this.pressAt.atk, s = this.pressAt.spc;
    return (
      !this.consumed.atk && !this.consumed.spc &&
      Math.abs(a - s) <= win && this.frame - Math.min(a, s) <= recent
    );
  }
  dir() {
    return (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
  }
}

// ---------------------------------------------------------------------------
// Menu input (aggregated from every device) with key repeat
// ---------------------------------------------------------------------------
const MENU_KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  confirm: ['Enter', 'Space', 'KeyJ', 'KeyF', 'NumpadEnter', 'KeyZ'],
  back: ['Escape', 'Backspace', 'KeyK', 'KeyX', 'KeyG'],
  pause: ['Escape', 'KeyP', 'Enter'],
  tabL: ['KeyQ', 'PageUp'],
  tabR: ['KeyE', 'PageDown'],
  alt: ['KeyR', 'Tab'],
};

class MenuInput {
  constructor() {
    this.held = {};
    this.timer = {};
    this.fired = {};
    this.source = {}; // which player slot / pad fired (for versus menus)
    for (const k in MENU_KEYS) {
      this.held[k] = false;
      this.timer[k] = 0;
      this.fired[k] = false;
    }
  }
  update() {
    const padStates = pads.map((gp) => {
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      return {
        up: ay < -0.5 || btn(gp, 12),
        down: ay > 0.5 || btn(gp, 13),
        left: ax < -0.5 || btn(gp, 14),
        right: ax > 0.5 || btn(gp, 15),
        confirm: btn(gp, 0),
        back: btn(gp, 1),
        pause: btn(gp, 9),
        tabL: btn(gp, 4),
        tabR: btn(gp, 5),
        alt: btn(gp, 3),
      };
    });
    for (const k in MENU_KEYS) {
      let h = MENU_KEYS[k].some((c) => keysDown.has(c) || keysPressedQueue.has(c));
      for (const ps of padStates) if (ps[k]) h = true;
      const repeatable = k === 'up' || k === 'down' || k === 'left' || k === 'right';
      this.fired[k] = false;
      if (h) {
        if (!this.held[k]) {
          this.fired[k] = true;
          this.timer[k] = 0;
        } else if (repeatable) {
          this.timer[k]++;
          if (this.timer[k] > 20 && (this.timer[k] - 20) % 5 === 0) this.fired[k] = true;
        }
      }
      this.held[k] = h;
    }
  }
  // per-player-side menu input (for versus character select)
  sideFired(side, k) {
    // side 0: keyboard p1 map + pad 0; side 1: p2 map + pad 1
    return this._side?.[side]?.[k] || false;
  }
}

export const menu = new MenuInput();

// Side-specific menu input for simultaneous two-player selection screens
const SIDE_KEYS = [
  { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], confirm: ['KeyF', 'Space'], back: ['KeyG'] },
  { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], confirm: ['KeyK', 'Enter', 'Numpad1'], back: ['KeyL', 'Numpad2', 'Backspace'] },
];
class SideMenu {
  constructor(side) {
    this.side = side;
    this.held = {};
    this.timer = {};
    this.fired = {};
  }
  update() {
    const gp = pads[this.side];
    const ks = SIDE_KEYS[this.side];
    for (const k in ks) {
      let h = ks[k].some((c) => keysDown.has(c) || keysPressedQueue.has(c));
      if (gp) {
        const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
        const m = {
          up: ay < -0.5 || btn(gp, 12), down: ay > 0.5 || btn(gp, 13),
          left: ax < -0.5 || btn(gp, 14), right: ax > 0.5 || btn(gp, 15),
          confirm: btn(gp, 0), back: btn(gp, 1),
        };
        if (m[k]) h = true;
      }
      this.fired[k] = false;
      if (h) {
        if (!this.held[k]) {
          this.fired[k] = true;
          this.timer[k] = 0;
        } else if (k !== 'confirm' && k !== 'back') {
          this.timer[k] = (this.timer[k] || 0) + 1;
          if (this.timer[k] > 20 && (this.timer[k] - 20) % 5 === 0) this.fired[k] = true;
        }
      }
      this.held[k] = h;
    }
  }
}
export const sideMenus = [new SideMenu(0), new SideMenu(1)];

// ---------------------------------------------------------------------------
// Global per-tick update
// ---------------------------------------------------------------------------
export function updateInputs(controllers) {
  readPads();
  for (const gp of pads) {
    const prev = padPrev[gp.index] || [];
    gp.buttons.forEach((b, i) => {
      if (b.pressed && !prev[i]) anyKeyPressed = true;
    });
    padPrev[gp.index] = gp.buttons.map((b) => b.pressed);
  }
  menu.update();
  sideMenus[0].update();
  sideMenus[1].update();
  for (const c of controllers) if (c) c.update();
  pointer.pressed = pointer._pressQueued;
  pointer.released = pointer._releaseQueued;
  pointer._pressQueued = false;
  pointer._releaseQueued = false;
}

// Call at the end of the tick
export function endInputFrame() {
  keysPressedQueue.clear();
  anyKeyPressed = false;
  pointer.wheel = 0;
  pointer.moved = false;
}

export function wasAnyKeyPressed() {
  return anyKeyPressed;
}
export function lastKey() {
  return lastKeyCode;
}
export function isKeyDown(code) {
  return keysDown.has(code);
}
export function keyPressedThisFrame(code) {
  return keysPressedQueue.has(code);
}
