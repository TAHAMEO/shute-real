// Keyboard / mouse input with pointer lock and rebindable actions.
export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  crouch: ['KeyC', 'ControlLeft'],
  prone: ['KeyZ'],
  leanLeft: ['KeyQ'],
  leanRight: ['KeyE'],
  reload: ['KeyR'],
  fireMode: ['KeyB'],
  primary: ['Digit1'],
  secondary: ['Digit2'],
  frag: ['KeyG'],
  smoke: ['Digit4', 'KeyH'],
  melee: ['KeyV'],
  scoreboard: ['Tab'],
  map: ['KeyM'],
  chat: ['KeyT', 'Enter'],
  teamChat: ['KeyY'],
  zeroUp: ['PageUp'],
  zeroDown: ['PageDown'],
  toggleHud: ['F1'],
  inspect: ['KeyI'],
};

export class Input {
  constructor(element) {
    this.el = element;
    this.bindings = { ...DEFAULT_BINDINGS };
    this.keys = new Set();
    this.pressed = new Set(); // actions pressed this frame
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, buttons: 0, wheel: 0 };
    this.mousePressed = new Set();
    this.mouseReleased = new Set();
    this.locked = false;
    this.enabled = true;
    this.textFocus = false;
    this.onLockChange = null;
    this._actionOf = new Map();
    this._rebuild();
    this._onKeyDown = (e) => {
      if (this.textFocus || this._isTyping(e)) return;
      if (e.code === 'Tab' || (this.locked && ['Space', 'F1', 'PageUp', 'PageDown'].includes(e.code))) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const acts = this._actionOf.get(e.code);
      if (acts) for (const a of acts) this.pressed.add(a);
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      const acts = this._actionOf.get(e.code);
      if (acts) for (const a of acts) this.released.add(a);
    };
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      // Ignore absurd spikes some browsers produce right after locking.
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    };
    this._onMouseDown = (e) => {
      if (!this.locked) return;
      this.mouse.buttons |= 1 << e.button;
      this.mousePressed.add(e.button);
      e.preventDefault();
    };
    this._onMouseUp = (e) => {
      this.mouse.buttons &= ~(1 << e.button);
      this.mouseReleased.add(e.button);
    };
    this._onWheel = (e) => {
      if (!this.locked) return;
      this.mouse.wheel += Math.sign(e.deltaY);
    };
    this._onLock = () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) { this.keys.clear(); this.mouse.buttons = 0; }
      this.onLockChange?.(this.locked);
    };
    this._onBlur = () => { this.keys.clear(); this.mouse.buttons = 0; };
    this._onContext = (e) => { if (this.locked) e.preventDefault(); };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLock);
  }

  _isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  _rebuild() {
    this._actionOf.clear();
    for (const [action, codes] of Object.entries(this.bindings)) {
      for (const c of codes) {
        if (!this._actionOf.has(c)) this._actionOf.set(c, []);
        this._actionOf.get(c).push(action);
      }
    }
  }

  setBindings(b) {
    this.bindings = { ...DEFAULT_BINDINGS, ...b };
    this._rebuild();
  }

  lock() {
    if (this.locked) return;
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.el.requestPointerLock(); } catch { /* ignore */ } });
    } catch {
      try { this.el.requestPointerLock(); } catch { /* ignore */ }
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Is the action held? */
  down(action) {
    if (!this.enabled) return false;
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** Was the action pressed since the last endFrame()? */
  hit(action) {
    return this.enabled && this.pressed.has(action);
  }

  mouseDown(button = 0) {
    return this.enabled && this.locked && (this.mouse.buttons & (1 << button)) !== 0;
  }

  mouseHit(button = 0) {
    return this.enabled && this.mousePressed.has(button);
  }

  /** Consume accumulated mouse movement. */
  takeMouse() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy, wheel: this.mouse.wheel };
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed.clear();
    this.mouseReleased.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('contextmenu', this._onContext);
    document.removeEventListener('pointerlockchange', this._onLock);
  }
}
