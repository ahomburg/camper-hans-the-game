// Tastatur (Pfeiltasten + WASD) und Touch-Buttons -> einheitlicher Input-State.
export class Controls {
  constructor() {
    this.state = { up: false, down: false, left: false, right: false };
    this.onReset = null;
    this.onHonk = null;
    this.onEscape = null;

    const keymap = {
      ArrowUp: 'up', KeyW: 'up',
      ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
    };
    window.addEventListener('keydown', (e) => {
      const k = keymap[e.code];
      if (k) { this.state[k] = true; e.preventDefault(); }
      if (e.code === 'KeyR' && this.onReset) this.onReset();
      if (e.code === 'KeyH' && !e.repeat && this.onHonk) this.onHonk();
      if (e.code === 'Escape' && this.onEscape) this.onEscape();
    });
    window.addEventListener('keyup', (e) => {
      const k = keymap[e.code];
      if (k) { this.state[k] = false; e.preventDefault(); }
    });
    window.addEventListener('blur', () => this.reset());

    this.bindButton('btn-up', 'up');
    this.bindButton('btn-down', 'down');
    this.bindButton('btn-left', 'left');
    this.bindButton('btn-right', 'right');

    if (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0) {
      document.body.classList.add('touch');
    }
  }

  bindButton(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    const set = (v) => (e) => {
      e.preventDefault();
      this.state[key] = v;
      el.classList.toggle('active', v);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* ignorieren */ }
      set(true)(e);
    });
    el.addEventListener('pointerup', set(false));
    el.addEventListener('pointercancel', set(false));
    el.addEventListener('lostpointercapture', set(false));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  reset() {
    for (const k in this.state) this.state[k] = false;
  }
}
